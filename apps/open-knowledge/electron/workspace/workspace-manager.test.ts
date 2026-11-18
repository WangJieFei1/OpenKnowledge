import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
	lstat,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	truncate,
	writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { filesystemPathIdentity } from '@open-knowledge/knowledge-bundle-filesystem'

const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-manager-store-'))
const temporaryDirectories: string[] = [userDataPath]
let releaseConversion: (() => void) | undefined
let conversionStarted: (() => void) | undefined
let conversionCalls = 0
let selectedFolder: string | null = null
let folderPickerError: Error | null = null
const showOpenDialog = mock(async () => {
	if (folderPickerError) {
		throw folderPickerError
	}
	return selectedFolder
		? { canceled: false, filePaths: [selectedFolder] }
		: { canceled: true, filePaths: [] }
})

mock.module('electron', () => ({
	app: { getPath: () => userDataPath, isPackaged: true },
	BrowserWindow: class {},
	dialog: { showOpenDialog },
	safeStorage: {},
	shell: {}
}))

mock.module('./anydoc', () => ({
	renderAnydocDocument: async (
		documentPath: string,
		bytes: Uint8Array,
		signal?: AbortSignal,
		maximumMarkdownBytes?: number
	) => {
		conversionCalls += 1
		conversionStarted?.()
		if (releaseConversion) {
			await Promise.race([
				new Promise<void>((resolve) => {
					releaseConversion = resolve
				}),
				new Promise<never>((_, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
				})
			])
		}
		const markdown = `# Converted ${documentPath}\n\n${new TextDecoder().decode(bytes)}`
		if (maximumMarkdownBytes !== undefined && Buffer.byteLength(markdown) > maximumMarkdownBytes) {
			throw new RangeError('Rendered document is too large.')
		}
		return markdown
	}
}))

let WorkspaceManager: typeof import('./workspace-manager').WorkspaceManager

beforeAll(async () => {
	;({ WorkspaceManager } = await import('./workspace-manager'))
})

afterEach(async () => {
	releaseConversion = undefined
	conversionStarted = undefined
	conversionCalls = 0
	selectedFolder = null
	folderPickerError = null
	showOpenDialog.mockClear()
	await Promise.all(
		temporaryDirectories
			.splice(1)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

afterAll(async () => {
	await rm(userDataPath, { recursive: true, force: true })
})

describe('workspace folder selection', () => {
	test('distinguishes cancellation from a folder-opening failure', async () => {
		const manager = new WorkspaceManager()
		await manager.initialize()
		try {
			expect(await browseSelection(manager)).toEqual({ status: 'cancelled' })
		} finally {
			await manager.close()
		}
	})

	test('does not reauthorize a folder that has never been registered', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-new-workspace-'))
		temporaryDirectories.push(root)
		selectedFolder = root
		const reauthorizedWorkspaceIDs: string[] = []
		const manager = new WorkspaceManager(undefined, (workspaceID) => {
			reauthorizedWorkspaceIDs.push(workspaceID)
			throw new Error('error.mcp.workspace.not-recent')
		})
		await manager.initialize()
		try {
			const result = await browseSelection(manager)
			expect(result).toMatchObject({
				status: 'selected',
				workspace: { kind: 'local', rootPath: root }
			})
			expect(reauthorizedWorkspaceIDs).toEqual([])
		} finally {
			await manager.close()
		}
	})

	test('reauthorizes a previously registered folder when its root identity changed', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-reauthorized-workspace-'))
		temporaryDirectories.push(root)
		selectedFolder = root
		const workspaceID = createHash('sha256').update(root).digest('hex')
		await writeFile(
			path.join(userDataPath, 'workspaces.json'),
			JSON.stringify({
				version: 1,
				recentWorkspaces: [localWorkspace(workspaceID, root)],
				activeWorkspaceID: null,
				workspaceRootIdentities: { [workspaceID]: 'stale-root-identity' }
			})
		)
		const reauthorizedWorkspaceIDs: string[] = []
		const manager = new WorkspaceManager(undefined, (id) => {
			reauthorizedWorkspaceIDs.push(id)
		})
		await manager.initialize()
		try {
			expect(await browseSelection(manager)).toMatchObject({ status: 'selected' })
			expect(reauthorizedWorkspaceIDs).toEqual([workspaceID])
		} finally {
			await manager.close()
		}
	})

	test('reports when the selected folder no longer exists', async () => {
		selectedFolder = path.join(userDataPath, 'missing-workspace')
		const manager = new WorkspaceManager()
		await manager.initialize()
		try {
			expect(await browseSelection(manager)).toMatchObject({
				status: 'failed',
				error: { code: 'folder-not-found' }
			})
		} finally {
			await manager.close()
		}
	})

	test('reports when the selected path is not a folder', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-not-folder-'))
		temporaryDirectories.push(directory)
		selectedFolder = path.join(directory, 'notes.md')
		await writeFile(selectedFolder, '# Notes')
		const manager = new WorkspaceManager()
		await manager.initialize()
		try {
			expect(await browseSelection(manager)).toMatchObject({
				status: 'failed',
				error: { code: 'folder-not-directory' }
			})
		} finally {
			await manager.close()
		}
	})

	test('reports a system folder-picker failure separately', async () => {
		folderPickerError = new Error('Desktop portal is unavailable.')
		const manager = new WorkspaceManager()
		await manager.initialize()
		try {
			expect(await browseSelection(manager)).toEqual({
				status: 'failed',
				error: { code: 'picker-unavailable', detail: 'Desktop portal is unavailable.' }
			})
		} finally {
			await manager.close()
		}
	})

	test('reports application storage failures without blaming the selected folder', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-storage-failure-'))
		temporaryDirectories.push(root)
		selectedFolder = root
		const workspaceID = createHash('sha256').update(root).digest('hex')
		await writeFile(
			path.join(userDataPath, 'workspaces.json'),
			JSON.stringify({
				version: 1,
				recentWorkspaces: [localWorkspace(workspaceID, root)],
				activeWorkspaceID: null,
				workspaceRootIdentities: { [workspaceID]: 'stale-root-identity' }
			})
		)
		const storageError = Object.assign(new Error('No space left in application data.'), {
			code: 'ENOSPC'
		})
		const manager = new WorkspaceManager(undefined, () => {
			throw storageError
		})
		await manager.initialize()
		try {
			expect(await browseSelection(manager)).toEqual({
				status: 'failed',
				error: { code: 'storage-full', detail: storageError.message }
			})
		} finally {
			await manager.close()
		}
	})

	test('explains that an entire filesystem cannot be opened as a workspace', async () => {
		selectedFolder = path.parse(process.cwd()).root
		const manager = new WorkspaceManager()
		await manager.initialize()
		try {
			expect(await browseSelection(manager)).toEqual({
				status: 'failed',
				error: { code: 'folder-root-not-supported' }
			})
		} finally {
			await manager.close()
		}
	})
})

describe('workspace manager MCP document access', () => {
	test('creates directories and Markdown documents inside the authorized local workspace', async () => {
		const { manager, root, workspaceID } = await createManager({})
		try {
			const bundle = manager.mcpBundle(workspaceID)
			const directory = await bundle.createDirectory({ path: '/notes' })
			expect(directory).toMatchObject({
				ok: true,
				value: {
					directory: { kind: 'directory', path: '/notes', parentPath: '/', name: 'notes' }
				}
			})

			const document = await bundle.createFile({
				path: '/notes/created.md',
				content: '# Created through MCP',
				mediaType: 'text/markdown'
			})
			expect(document).toMatchObject({
				ok: true,
				value: {
					file: {
						kind: 'file',
						path: '/notes/created.md',
						parentPath: '/notes',
						name: 'created.md',
						mediaType: 'text/markdown'
					}
				}
			})
			expect(await readFile(path.join(root, 'notes', 'created.md'), 'utf8')).toBe(
				'# Created through MCP'
			)

			await expect(
				bundle.createFile({
					path: '/notes/source.txt',
					content: 'Not Markdown',
					mediaType: 'text/plain'
				})
			).rejects.toThrow('Only Markdown documents can be created')
			await expect(lstat(path.join(root, 'notes', 'source.txt'))).rejects.toMatchObject({
				code: 'ENOENT'
			})
		} finally {
			await manager.close()
		}
	})

	test('confines MCP creation against traversal and symlink parents', async () => {
		const { manager, root, workspaceID } = await createManager({})
		const outside = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-manager-outside-'))
		temporaryDirectories.push(outside)
		const escapeName = `escape-${path.basename(root)}`
		const escapedDirectory = path.join(root, '..', escapeName)
		const escapedFile = path.join(root, '..', `${escapeName}.md`)
		try {
			const bundle = manager.mcpBundle(workspaceID)
			expect(await bundle.createDirectory({ path: `/../${escapeName}` })).toMatchObject({
				ok: false,
				error: { code: 'invalid_path' }
			})
			expect(
				await bundle.createFile({
					path: `/../${escapeName}.md`,
					content: '# Escape',
					mediaType: 'text/markdown'
				})
			).toMatchObject({ ok: false, error: { code: 'invalid_path' } })
			await expect(lstat(escapedDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
			await expect(lstat(escapedFile)).rejects.toMatchObject({ code: 'ENOENT' })

			if (process.platform !== 'win32') {
				await symlink(outside, path.join(root, 'linked'), 'dir')
				expect(await bundle.createDirectory({ path: '/linked/nested' })).toMatchObject({
					ok: false,
					error: { code: 'invalid_path' }
				})
				expect(
					await bundle.createFile({
						path: '/linked/outside.md',
						content: '# Outside',
						mediaType: 'text/markdown'
					})
				).toMatchObject({ ok: false, error: { code: 'invalid_path' } })
				expect(await readdir(outside)).toEqual([])
			}
		} finally {
			await rm(escapedDirectory, { recursive: true, force: true })
			await rm(escapedFile, { force: true })
			await manager.close()
		}
	})

	test('lists every file and reads source, converted, and unsupported documents safely', async () => {
		const { manager, workspaceID } = await createManager({
			'guide.md': '# Guide',
			'scores.csv': 'Name,Score\nAda,10\n',
			'archive.zip': 'private source bytes'
		})
		try {
			const listing = await manager.mcpBundle(workspaceID).list({ path: '/', depth: 1 })
			expect(
				listing?.entries.map((entry) =>
					entry.kind === 'file'
						? { path: entry.path, documentAccess: entry.documentAccess }
						: { path: entry.path }
				)
			).toEqual([
				{ path: '/archive.zip', documentAccess: 'not_supported' },
				{ path: '/guide.md', documentAccess: 'writable' },
				{ path: '/scores.csv', documentAccess: 'readonly' }
			])

			const source = await manager.mcpReadDocument(
				workspaceID,
				{ path: '/guide.md', maximumMarkdownBytes: 1024 },
				new AbortController().signal
			)
			expect(source).toMatchObject({
				status: 'readable',
				file: { path: '/guide.md', documentAccess: 'writable' },
				markdown: '# Guide',
				representation: 'source_markdown'
			})

			const converted = await manager.mcpReadDocument(
				workspaceID,
				{ path: '/scores.csv', maximumMarkdownBytes: 1024 },
				new AbortController().signal
			)
			expect(converted).toMatchObject({
				status: 'readable',
				file: {
					path: '/scores.csv',
					documentAccess: 'readonly'
				},
				markdown: '# Converted /scores.csv\n\nName,Score\nAda,10\n',
				representation: 'converted_markdown'
			})

			const unsupported = await manager.mcpReadDocument(
				workspaceID,
				{ path: '/archive.zip', maximumMarkdownBytes: 1024 },
				new AbortController().signal
			)
			expect(unsupported).toMatchObject({
				status: 'not_supported',
				file: { path: '/archive.zip', documentAccess: 'not_supported' }
			})
			expect(unsupported).not.toHaveProperty('markdown')
			expect(unsupported).not.toHaveProperty('bytes')
		} finally {
			await manager.close()
		}
	})

	test('uses authoritative IDs while enforcing the resolved Markdown policy', async () => {
		const { manager, root, workspaceID } = await createManager({ 'guide.md': '# Original' })
		try {
			const bundle = manager.mcpBundle(workspaceID)
			const original = await bundle.readFile({ path: '/guide.md' })
			if (!original) {
				throw new Error('Expected the source document.')
			}
			await rename(path.join(root, 'guide.md'), path.join(root, 'guide.pdf'))

			const converted = await manager.mcpReadDocument(
				workspaceID,
				{ id: original.id, path: '/guide.md', maximumMarkdownBytes: 1024 },
				new AbortController().signal
			)
			expect(converted).toMatchObject({
				status: 'readable',
				file: { id: original.id, path: '/guide.pdf', documentAccess: 'readonly' },
				representation: 'converted_markdown'
			})
			expect(
				await bundle.writeFile({ id: original.id, path: '/guide.md', content: '# Replaced' })
			).toMatchObject({ ok: false, error: { code: 'unsupported' } })
			expect(
				await bundle.patchFile({
					id: original.id,
					path: '/guide.md',
					edits: [{ oldText: 'Original', newText: 'Replaced' }]
				})
			).toMatchObject({ ok: false, error: { code: 'unsupported' } })
		} finally {
			await manager.close()
		}
	})

	test('rejects oversized unsupported files before hashing their contents', async () => {
		const { manager, root, workspaceID } = await createManager({ 'archive.zip': '' })
		await truncate(path.join(root, 'archive.zip'), 128 * 1024 * 1024 + 1)
		try {
			await expect(
				manager.mcpReadDocument(
					workspaceID,
					{ path: '/archive.zip', maximumMarkdownBytes: 1024 },
					new AbortController().signal
				)
			).rejects.toThrow('too large')
		} finally {
			await manager.close()
		}
	})

	test('passes the MCP Markdown bound into document conversion', async () => {
		const { manager, workspaceID } = await createManager({ 'scores.csv': 'Name\nAda\n' })
		try {
			await expect(
				manager.mcpReadDocument(
					workspaceID,
					{ path: '/scores.csv', maximumMarkdownBytes: 8 },
					new AbortController().signal
				)
			).rejects.toThrow('too large')
		} finally {
			await manager.close()
		}
	})

	test('aborts a queued conversion before reading its source bytes', async () => {
		const { manager, workspaceID } = await createManager({
			'first.csv': 'Name\nFirst\n',
			'second.csv': 'Name\nSecond\n'
		})
		let started: (() => void) | undefined
		const firstStarted = new Promise<void>((resolve) => {
			started = resolve
		})
		conversionStarted = () => started?.()
		releaseConversion = () => undefined
		const first = manager.mcpReadDocument(
			workspaceID,
			{ path: '/first.csv', maximumMarkdownBytes: 1024 },
			new AbortController().signal
		)
		await firstStarted
		const controller = new AbortController()
		const second = manager.mcpReadDocument(
			workspaceID,
			{ path: '/second.csv', maximumMarkdownBytes: 1024 },
			controller.signal
		)
		controller.abort(new Error('cancelled'))
		try {
			await expect(second).rejects.toThrow('cancelled')
			expect(conversionCalls).toBe(1)
			releaseConversion?.()
			await first
		} finally {
			await manager.close()
		}
	})
})

async function browseSelection(manager: InstanceType<typeof WorkspaceManager>) {
	const log = spyOn(console, 'error').mockImplementation(() => undefined)
	try {
		return await manager.browseWorkspace({} as never)
	} finally {
		log.mockRestore()
	}
}

function localWorkspace(id: string, rootPath: string) {
	return {
		kind: 'local' as const,
		id,
		name: path.basename(rootPath),
		rootPath,
		lastOpenedAt: new Date().toISOString()
	}
}

async function createManager(files: Record<string, string>): Promise<{
	manager: InstanceType<typeof WorkspaceManager>
	root: string
	workspaceID: string
}> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-manager-'))
	temporaryDirectories.push(root)
	for (const [name, content] of Object.entries(files)) {
		await writeFile(path.join(root, name), content)
	}
	const workspaceID = createHash('sha256').update(root).digest('hex')
	await writeFile(
		path.join(userDataPath, 'workspaces.json'),
		JSON.stringify({
			version: 1,
			recentWorkspaces: [
				{
					kind: 'local',
					id: workspaceID,
					name: path.basename(root),
					rootPath: root,
					lastOpenedAt: new Date().toISOString()
				}
			],
			activeWorkspaceID: workspaceID,
			workspaceRootIdentities: {
				[workspaceID]: filesystemPathIdentity(await lstat(root, { bigint: true }))
			}
		})
	)
	const manager = new WorkspaceManager()
	await manager.initialize()
	return { manager, root, workspaceID }
}
