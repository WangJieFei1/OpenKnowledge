import { afterEach, describe, expect, test } from 'bun:test'
import { watch } from 'node:fs'
import {
	link,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	unlink,
	writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleFileEntry,
	KnowledgeBundlePath
} from '@open-knowledge/knowledge-bundle-api'
import { createKnowledgeDirectory, createKnowledgeFile } from './file-snapshots'
import { FilesystemKnowledgeBundle } from './filesystem-knowledge-bundle'
import { filesystemPathIdentity, matchesFilesystemPathIdentity } from './path-policy'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

type TestWorkspace = {
	base: string
	root: string
	bundle: FilesystemKnowledgeBundle
}

async function createWorkspace(): Promise<TestWorkspace> {
	const base = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-filesystem-'))
	temporaryDirectories.push(base)
	const root = path.join(base, 'bundle')
	await mkdir(root)
	return { base, root, bundle: new FilesystemKnowledgeBundle(root) }
}

describe('filesystem knowledge bundle reads', () => {
	test('uses birth time only when the filesystem exposes a stable creation time', () => {
		const fallback = { dev: 1n, ino: 2n, birthtimeNs: 3n, ctimeNs: 3n }
		const stable = { ...fallback, ctimeNs: 4n }
		expect(filesystemPathIdentity(fallback)).toBe('1:2')
		expect(matchesFilesystemPathIdentity('1:2', stable)).toBe(true)
		expect(filesystemPathIdentity(stable)).toBe('1:2:3')
		expect(matchesFilesystemPathIdentity('1:2:3', { ...stable, birthtimeNs: 5n })).toBe(false)
	})

	test('returns the root descriptor and honors listing depth and limits', async () => {
		const { root, bundle } = await createWorkspace()
		await mkdir(path.join(root, 'notes', 'deep'), { recursive: true })
		await writeFile(path.join(root, 'root.txt'), 'root')
		await writeFile(path.join(root, 'notes', 'guide.md'), '# Guide')
		await writeFile(path.join(root, 'notes', 'deep', 'nested.md'), '# Nested')
		await writeFile(path.join(root, '.git'), 'gitdir: elsewhere')
		await writeFile(path.join(root, '.OPEN-KNOWLEDGE'), 'protected')
		await mkdir(path.join(root, 'Node_Modules'))
		await writeFile(path.join(root, '.draft.OPEN-KNOWLEDGE-test.TMP'), 'temporary')
		await writeFile(path.join(root, 'CON'), 'portable-invalid')
		await writeFile(path.join(root, 'foo:bar'), 'portable-invalid')
		await writeFile(path.join(root, 'trailing.'), 'portable-invalid')

		const empty = await bundle.list({ path: '/', depth: 0 })
		expect(empty).toMatchObject({
			directory: { kind: 'directory', path: '/', name: '', parentPath: null },
			entries: [],
			truncated: false
		})

		const shallow = await bundle.list({ path: '/', depth: 1 })
		expect(shallow?.entries.map(({ path }) => path)).toEqual(['/notes', '/root.txt'])

		const nested = await bundle.list({ path: '/', depth: 2 })
		expect(nested?.entries.map(({ path }) => path)).toEqual([
			'/notes',
			'/notes/deep',
			'/notes/guide.md',
			'/root.txt'
		])

		const bounded = await bundle.list({ path: '/', depth: 4, limit: 2 })
		expect(bounded?.entries).toHaveLength(2)
		expect(bounded?.truncated).toBe(true)
		expect((await bundle.list({ path: '/', depth: 4, limit: 20 }))?.truncated).toBe(false)
	})

	test('reads arbitrary files with canonical metadata and enforces maximumBytes', async () => {
		const { root, bundle } = await createWorkspace()
		await writeFile(path.join(root, 'guide.md'), '# Guide')
		const file = await bundle.readFile({
			path: '/guide.md',
			maximumBytes: 1024
		})
		expect(file).toMatchObject({
			kind: 'file',
			path: '/guide.md',
			parentPath: '/',
			byteLength: 7,
			mediaType: 'text/markdown',
			content: '# Guide'
		})
		await expect(bundle.readFile({ path: '/guide.md', maximumBytes: 3 })).rejects.toThrow(
			'too large'
		)
		expect(await bundle.readFile({ path: '/', maximumBytes: 1024 })).toBeNull()
	})

	test('reads binary files without decoding or replacing their real identity', async () => {
		const { root, bundle } = await createWorkspace()
		const content = Uint8Array.from([0, 255, 128, 65, 0, 66])
		await writeFile(path.join(root, 'report.pdf'), content)
		const listed = (await bundle.list({ path: '/', depth: 1 }))?.entries[0]
		if (!listed || listed.kind !== 'file') {
			throw new Error('Expected the binary test file.')
		}

		const file = await bundle.readFileBytes({
			id: listed.id,
			path: '/report.pdf',
			maximumBytes: content.byteLength
		})
		expect(file).toMatchObject({
			id: listed.id,
			kind: 'file',
			path: '/report.pdf',
			byteLength: content.byteLength,
			contentHash: listed.contentHash
		})
		expect(Array.from(file?.bytes ?? [])).toEqual(Array.from(content))
		await expect(
			bundle.readFileBytes({
				path: '/report.pdf',
				maximumBytes: content.byteLength - 1
			})
		).rejects.toThrow('too large')
	})

	test('uses a supplied ID authoritatively after relocation', async () => {
		const { root, bundle } = await createWorkspace()
		await writeFile(path.join(root, 'guide.md'), '# Original')
		const original = await bundle.readFile({ path: '/guide.md' })
		if (!original) {
			throw new Error('Expected the test file.')
		}
		await rename(path.join(root, 'guide.md'), path.join(root, 'moved.md'))
		await writeFile(path.join(root, 'guide.md'), '# Occupant')

		expect(await bundle.readFile({ id: original.id, path: '/guide.md' })).toMatchObject({
			id: original.id,
			path: '/moved.md',
			content: '# Original'
		})
		expect(await bundle.resolveEntryPath({ id: original.id, path: '/guide.md' })).toBe('/moved.md')
		expect(await bundle.resolveEntryPath({ id: 'missing-id', path: '/guide.md' })).toBeNull()
		expect(await bundle.resolveFileMetadata({ id: original.id, path: '/guide.md' })).toMatchObject({
			id: original.id,
			kind: 'file',
			path: '/moved.md'
		})
		expect(await bundle.readFile({ id: 'missing-id', path: '/guide.md' })).toBeNull()
		expect(await bundle.readFile({ path: '/guide.md' })).toMatchObject({
			content: '# Occupant'
		})

		await unlink(path.join(root, 'guide.md'))
		await symlink(path.join(root, 'moved.md'), path.join(root, 'guide.md'))
		expect(await bundle.resolveEntryPath({ id: original.id, path: '/guide.md' })).toBe('/moved.md')
	})

	test('does not resolve retained IDs into protected workspace paths', async () => {
		const { root, bundle } = await createWorkspace()
		await writeFile(path.join(root, 'guide.md'), '# Original')
		const original = await bundle.readFile({ path: '/guide.md' })
		if (!original) {
			throw new Error('Expected the test file.')
		}
		await mkdir(path.join(root, '.GIT'))
		await rename(path.join(root, 'guide.md'), path.join(root, '.GIT', 'guide.md'))

		expect(await bundle.resolveEntryPath({ id: original.id, path: '/guide.md' })).toBeNull()
		expect(
			await bundle.writeFile(
				{
					id: original.id,
					path: '/guide.md',
					expectedRevision: original.revision,
					expectedContentHash: original.contentHash,
					content: '# Replaced'
				},
				(candidate) => candidate.endsWith('.md')
			)
		).toMatchObject({ ok: false, error: { code: 'not_found' } })
		expect(await readFile(path.join(root, '.GIT', 'guide.md'), 'utf8')).toBe('# Original')
	})

	test('applies resolved path guards before reading or mutating authoritative IDs', async () => {
		const { root, bundle } = await createWorkspace()
		await writeFile(path.join(root, 'report.pdf'), '# Original')
		const original = await bundle.readFile({ path: '/report.pdf' })
		if (!original) {
			throw new Error('Expected the test file.')
		}
		const markdownOnly = (candidate: KnowledgeBundlePath) => candidate.endsWith('.md')
		const locator = {
			id: original.id,
			path: '/decoy.md' as KnowledgeBundlePath
		}

		await expect(bundle.readFile(locator, markdownOnly)).rejects.toThrow('not allowed')
		await expect(bundle.readFileBytes(locator, markdownOnly)).rejects.toThrow('not allowed')
		expect(
			await bundle.writeFile({ ...locator, content: '# Replaced' }, markdownOnly)
		).toMatchObject({ ok: false, error: { code: 'unsupported' } })
		expect(
			await bundle.patchFile(
				{ ...locator, edits: [{ oldText: 'Original', newText: 'Patched' }] },
				markdownOnly
			)
		).toMatchObject({ ok: false, error: { code: 'unsupported' } })
		expect(await readFile(path.join(root, 'report.pdf'), 'utf8')).toBe('# Original')
	})

	test('rejects relative, traversal, and symlink paths at the API boundary', async () => {
		if (process.platform === 'win32') {
			return
		}
		const { base, root, bundle } = await createWorkspace()
		const outside = path.join(base, 'outside')
		await mkdir(outside)
		await writeFile(path.join(outside, 'secret.md'), '# Outside')
		await symlink(outside, path.join(root, 'linked'), 'dir')

		for (const candidate of ['guide.md', '/../outside/secret.md', '/linked/secret.md']) {
			await expect(bundle.readFile({ path: candidate as KnowledgeBundlePath })).rejects.toThrow()
		}
	})

	test('rejects a replaced root and unsafe hard-linked files', async () => {
		const { base, root, bundle } = await createWorkspace()
		const outsideFile = path.join(base, 'outside.md')
		await writeFile(outsideFile, '# Outside')
		await link(outsideFile, path.join(root, 'linked.md'))
		await expect(bundle.readFile({ path: '/linked.md' })).rejects.toThrow('not a supported file')
		expect((await bundle.list({ path: '/', depth: 1 }))?.entries).toEqual([])

		const identity = filesystemPathIdentity(await lstat(root, { bigint: true }))
		await rename(root, path.join(base, 'original'))
		await mkdir(root)
		const replacement = new FilesystemKnowledgeBundle(root, {
			expectedRootIdentity: identity
		})
		await expect(replacement.list({ path: '/', depth: 1 })).rejects.toThrow(
			'error.mutation.workspace.root-changed'
		)
	})
})

describe('filesystem knowledge bundle mutations', () => {
	test('implements standard create, write, move, and delete operations', async () => {
		const { bundle } = await createWorkspace()
		const createdDirectory = await bundle.createDirectory({ path: '/notes' })
		expect(createdDirectory.ok).toBe(true)
		const createdFile = await bundle.createFile({
			path: '/notes/guide.md',
			content: '# Guide'
		})
		expect(createdFile.ok).toBe(true)
		if (!createdFile.ok) {
			throw new Error('Expected the test file.')
		}

		expect(
			await bundle.writeFile({
				id: createdFile.value.file.id,
				path: '/stale.md',
				expectedRevision: 'stale-revision',
				content: '# Changed'
			})
		).toMatchObject({ ok: false, error: { code: 'revision_conflict' } })
		expect(
			await bundle.writeFile({
				id: createdFile.value.file.id,
				path: '/stale.md',
				expectedContentHash: 'a'.repeat(64),
				content: '# Changed'
			})
		).toMatchObject({ ok: false, error: { code: 'content_conflict' } })

		const written = await bundle.writeFile({
			id: createdFile.value.file.id,
			path: createdFile.value.file.path,
			expectedRevision: createdFile.value.file.revision,
			expectedContentHash: createdFile.value.file.contentHash,
			content: '# Changed'
		})
		expect(written).toMatchObject({ ok: true, value: { status: 'updated' } })

		const currentDirectory = await directory(bundle, '/notes')
		const moved = await bundle.moveEntry({
			id: currentDirectory.id,
			path: '/old-notes',
			expectedRevision: currentDirectory.revision,
			destinationPath: '/archive'
		})
		expect(moved).toMatchObject({
			ok: true,
			value: {
				status: 'moved',
				entry: { kind: 'directory', path: '/archive' }
			}
		})
		expect(await bundle.readFile({ path: '/archive/guide.md' })).toMatchObject({
			content: '# Changed'
		})

		const nonEmpty = await directory(bundle, '/archive')
		expect(
			await bundle.deleteEntry({
				id: nonEmpty.id,
				path: nonEmpty.path,
				expectedRevision: nonEmpty.revision
			})
		).toMatchObject({ ok: false, error: { code: 'not_empty' } })
		const child = await file(bundle, '/archive/guide.md')
		expect(await bundle.deleteEntry(locator(child))).toMatchObject({
			ok: true,
			value: { entry: { path: '/archive/guide.md' } }
		})
		const emptyDirectory = await directory(bundle, '/archive')
		expect(await bundle.deleteEntry(locator(emptyDirectory))).toMatchObject({
			ok: true
		})
		expect((await bundle.list({ path: '/', depth: 2 }))?.entries).toEqual([])
	})

	test('rejects caller IDs on create and never silently normalizes target paths', async () => {
		const { bundle } = await createWorkspace()
		expect(await bundle.createFile({ id: 'requested', path: '/plain', content: '' })).toEqual({
			ok: false,
			error: {
				code: 'unsupported',
				message: 'Caller-supplied entry IDs are not supported.'
			}
		})
		expect(await bundle.createFile({ path: '/plain', content: 'text' })).toMatchObject({
			ok: true,
			value: { file: { path: '/plain', name: 'plain' } }
		})
		expect(await bundle.createDirectory({ path: '/bad:name' })).toMatchObject({
			ok: false,
			error: {
				code: 'invalid_path',
				message: 'error.mutation.name.unsupported'
			}
		})
		const maximumName = `${'a'.repeat(237)}.md`
		expect(Buffer.byteLength(maximumName)).toBe(240)
		expect(
			await bundle.createFile({ path: `/${maximumName}`, content: '# Boundary' })
		).toMatchObject({ ok: true, value: { file: { name: maximumName } } })
	})

	test('rejects traversal and symlink creation paths without writing outside the bundle', async () => {
		if (process.platform === 'win32') {
			return
		}
		const { base, root, bundle } = await createWorkspace()
		const outside = path.join(base, 'outside')
		await mkdir(outside)
		await symlink(outside, path.join(root, 'linked'), 'dir')
		const outsideFile = path.join(outside, 'existing.md')
		await writeFile(outsideFile, '# Outside')
		await symlink(outsideFile, path.join(root, 'existing.md'))

		for (const candidate of [
			'guide.md',
			'/../outside/guide.md',
			'/.. /outside.md',
			'/. /outside.md',
			'/node_modules./guide.md',
			'/ node_modules/guide.md',
			'/notes/file:stream.md',
			'/CON/guide.md',
			'/notes/\u{10ffff}.md',
			'/linked/guide.md'
		]) {
			expect(
				await bundle.createFile({
					path: candidate as KnowledgeBundlePath,
					content: '# Guide'
				})
			).toMatchObject({ ok: false, error: { code: 'invalid_path' } })
		}
		for (const candidate of [
			'notes',
			'/../outside/notes',
			'/.. /outside',
			'/. /outside',
			'/node_modules./notes',
			'/ node_modules/notes',
			'/CON/notes',
			'/linked/notes'
		]) {
			expect(
				await bundle.createDirectory({
					path: candidate as KnowledgeBundlePath
				})
			).toMatchObject({ ok: false, error: { code: 'invalid_path' } })
		}
		expect(
			await bundle.createFile({
				path: '/existing.md',
				content: '# Replacement'
			})
		).toMatchObject({ ok: false, error: { code: 'already_exists' } })

		expect(await readFile(outsideFile, 'utf8')).toBe('# Outside')
		expect(await readdir(outside)).toEqual(['existing.md'])
	})

	test('removes its anchored temporary file when the parent changes during creation', async () => {
		if (process.platform !== 'linux') {
			return
		}
		const { base, root, bundle } = await createWorkspace()
		const parent = path.join(root, 'notes')
		const displacedParent = path.join(base, 'displaced-notes')
		const outside = path.join(base, 'outside')
		await mkdir(parent)
		await mkdir(outside)

		let swapping = false
		let watcher: ReturnType<typeof watch>
		const swapped = new Promise<void>((resolve, reject) => {
			watcher = watch(parent, (_event, filename) => {
				const name = filename?.toString() ?? ''
				if (swapping || !name.includes('.open-knowledge-') || !name.endsWith('.tmp')) {
					return
				}
				swapping = true
				void (async () => {
					await rename(parent, displacedParent)
					await symlink(outside, parent, 'dir')
				})().then(resolve, reject)
			})
		})

		try {
			const creating = bundle.createFile({
				path: '/notes/raced.md',
				content: 'race-safe content\n'.repeat(2 * 1024 * 1024)
			})
			await Promise.race([swapped, timeout(5_000)])
			const result = await creating

			expect(result.ok).toBe(false)
			expect(await readdir(displacedParent)).toEqual([])
			expect(await readdir(outside)).toEqual([])
		} finally {
			watcher!.close()
		}
	})

	test('does not remove a replacement at its temporary path while rolling back', async () => {
		if (process.platform !== 'linux') {
			return
		}
		const { base, root, bundle } = await createWorkspace()
		const parent = path.join(root, 'notes')
		const displacedParent = path.join(base, 'displaced-notes')
		const outside = path.join(base, 'outside')
		await mkdir(parent)
		await mkdir(outside)

		let replacementPath = ''
		let swapping = false
		let watcher: ReturnType<typeof watch>
		const swapped = new Promise<void>((resolve, reject) => {
			watcher = watch(parent, (_event, filename) => {
				const name = filename?.toString() ?? ''
				if (swapping || !name.includes('.open-knowledge-') || !name.endsWith('.tmp')) {
					return
				}
				swapping = true
				void (async () => {
					await rename(parent, displacedParent)
					replacementPath = path.join(displacedParent, name)
					await unlink(replacementPath)
					await writeFile(replacementPath, 'replacement inode')
					await symlink(outside, parent, 'dir')
				})().then(resolve, reject)
			})
		})

		try {
			const creating = bundle.createFile({
				path: '/notes/raced.md',
				content: 'race-safe content\n'.repeat(2 * 1024 * 1024)
			})
			await Promise.race([swapped, timeout(5_000)])
			const result = await creating

			expect(result.ok).toBe(false)
			expect(await readFile(replacementPath, 'utf8')).toBe('replacement inode')
			expect(await readdir(outside)).toEqual([])
		} finally {
			watcher!.close()
		}
	})

	test('removes its anchored temporary file when the bundle root changes during creation', async () => {
		if (process.platform !== 'linux') {
			return
		}
		const { base, root, bundle } = await createWorkspace()
		const displacedRoot = path.join(base, 'displaced-bundle')
		const outside = path.join(base, 'outside')
		await mkdir(outside)

		let swapping = false
		let watcher: ReturnType<typeof watch>
		const swapped = new Promise<void>((resolve, reject) => {
			watcher = watch(root, (_event, filename) => {
				const name = filename?.toString() ?? ''
				if (swapping || !name.includes('.open-knowledge-') || !name.endsWith('.tmp')) {
					return
				}
				swapping = true
				void (async () => {
					await rename(root, displacedRoot)
					await symlink(outside, root, 'dir')
				})().then(resolve, reject)
			})
		})

		try {
			const creating = bundle.createFile({
				path: '/raced.md',
				content: 'race-safe content\n'.repeat(2 * 1024 * 1024)
			})
			await Promise.race([swapped, timeout(5_000)])
			const result = await creating

			expect(result.ok).toBe(false)
			expect(await readdir(displacedRoot)).toEqual([])
			expect(await readdir(outside)).toEqual([])
		} finally {
			watcher!.close()
		}
	})

	test('rejects a root replaced after the caller captures its identity', async () => {
		const { base, root } = await createWorkspace()
		const expectedRootIdentity = filesystemPathIdentity(await lstat(root, { bigint: true }))
		const displacedRoot = path.join(base, 'displaced-bundle')
		await rename(root, displacedRoot)
		await mkdir(root)

		await expect(
			createKnowledgeFile(root, 'raced.md', '# Must not be created', expectedRootIdentity)
		).rejects.toThrow('error.mutation.workspace.root-changed')
		await expect(
			createKnowledgeDirectory(root, 'raced-directory', expectedRootIdentity)
		).rejects.toThrow('error.mutation.workspace.root-changed')
		expect(await readdir(root)).toEqual([])
	})

	test('applies exact patches atomically under content preconditions', async () => {
		const { bundle } = await createWorkspace()
		const created = await bundle.createFile({
			path: '/guide.md',
			content: '# Draft\n\nRepeat.\nRepeat.\n'
		})
		if (!created.ok) {
			throw new Error('Expected the test file.')
		}
		const original = created.value.file

		expect(
			await bundle.patchFile({
				id: original.id,
				path: '/stale-path.md',
				expectedRevision: original.revision,
				expectedContentHash: '0'.repeat(64),
				edits: [{ oldText: '# Draft', newText: '# Guide' }]
			})
		).toMatchObject({ ok: false, error: { code: 'content_conflict' } })

		const ambiguous = await bundle.patchFile({
			id: original.id,
			path: original.path,
			expectedRevision: original.revision,
			expectedContentHash: original.contentHash,
			edits: [{ oldText: 'Repeat.', newText: 'Changed.' }]
		})
		expect(ambiguous).toMatchObject({
			ok: false,
			error: { code: 'patch_ambiguous', editNumber: 1 }
		})
		expect(await bundle.readFile({ path: original.path })).toMatchObject({
			content: '# Draft\n\nRepeat.\nRepeat.\n'
		})

		const patched = await bundle.patchFile({
			id: original.id,
			path: original.path,
			expectedRevision: original.revision,
			expectedContentHash: original.contentHash,
			maximumBytes: 64,
			edits: [
				{ oldText: '# Draft', newText: '# Guide' },
				{ oldText: 'Repeat.\nRepeat.', newText: 'Published.' }
			]
		})
		expect(patched).toMatchObject({
			ok: true,
			value: { status: 'patched', file: { path: '/guide.md' } }
		})
		if (!patched.ok) {
			throw new Error('Expected the file to be patched.')
		}
		expect(await bundle.readFile({ path: original.path })).toMatchObject({
			content: '# Guide\n\nPublished.\n'
		})

		expect(
			await bundle.patchFile({
				id: patched.value.file.id,
				path: original.path,
				expectedRevision: patched.value.file.revision,
				expectedContentHash: patched.value.file.contentHash,
				maximumBytes: 8,
				edits: [{ oldText: '# Guide\n\nPublished.\n', newText: 'Short.' }]
			})
		).toMatchObject({ ok: false, error: { code: 'too_large' } })
		expect(
			await bundle.patchFile({
				id: patched.value.file.id,
				path: original.path,
				expectedRevision: patched.value.file.revision,
				expectedContentHash: patched.value.file.contentHash,
				maximumBytes: 24,
				edits: [{ oldText: 'Published.', newText: 'A longer published section.' }]
			})
		).toMatchObject({ ok: false, error: { code: 'too_large' } })
		expect(await bundle.readFile({ path: original.path })).toMatchObject({
			content: '# Guide\n\nPublished.\n'
		})
	})

	test('serializes competing mutations', async () => {
		const { bundle } = await createWorkspace()
		const results = await Promise.all([
			bundle.createFile({ path: '/same.md', content: 'first' }),
			bundle.createFile({ path: '/same.md', content: 'second' })
		])
		expect(results.filter(({ ok }) => ok)).toHaveLength(1)
		expect(results.filter(({ ok }) => !ok)).toMatchObject([
			{ ok: false, error: { code: 'already_exists' } }
		])
	})

	test('publishes canonical change notifications', async () => {
		const { root, bundle } = await createWorkspace()
		let resolveChange: (path: KnowledgeBundlePath) => void = () => undefined
		const changed = new Promise<KnowledgeBundlePath>((resolve) => {
			resolveChange = resolve
		})
		const subscription = await bundle.subscribe((change) => {
			if (change.kind === 'created') {
				resolveChange(change.path)
			}
		})
		try {
			await writeFile(path.join(root, 'watched.md'), '# Watched')
			expect(await Promise.race([changed, timeout(2_000)])).toBe('/watched.md')
		} finally {
			await subscription.close()
			await bundle.close()
		}
	})
})

async function directory(
	bundle: FilesystemKnowledgeBundle,
	bundlePath: KnowledgeBundlePath
): Promise<KnowledgeBundleDirectoryEntry> {
	const listing = await bundle.list({ path: bundlePath, depth: 0 })
	if (!listing) {
		throw new Error(`Expected directory ${bundlePath}.`)
	}
	return listing.directory
}

async function file(
	bundle: FilesystemKnowledgeBundle,
	bundlePath: KnowledgeBundlePath
): Promise<KnowledgeBundleFileEntry> {
	const value = await bundle.readFile({ path: bundlePath })
	if (!value) {
		throw new Error(`Expected file ${bundlePath}.`)
	}
	const { content: _content, ...entry } = value
	return entry
}

function locator(entry: KnowledgeBundleDirectoryEntry | KnowledgeBundleFileEntry) {
	return { id: entry.id, path: entry.path, expectedRevision: entry.revision }
}

async function timeout(milliseconds: number): Promise<never> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds))
	throw new Error('Timed out waiting for a filesystem change.')
}
