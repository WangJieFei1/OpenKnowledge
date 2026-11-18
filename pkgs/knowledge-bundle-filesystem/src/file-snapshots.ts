import { createHash, randomUUID } from 'node:crypto'
import { constants, type BigIntStats, type Dirent } from 'node:fs'
import {
	link,
	lstat,
	mkdir,
	open,
	opendir,
	rename,
	rm,
	rmdir,
	type FileHandle,
	unlink
} from 'node:fs/promises'
import path from 'node:path'
import { nodeErrorCode } from './node-error'
import {
	matchesFilesystemPathIdentity,
	PathPolicyError,
	resolveExistingPath,
	resolveNewPath,
	validateEntryName
} from './path-policy'

const ignoredEntries = new Set(['.git', '.open-knowledge', 'node_modules'])

export type FilesystemEntryBase = {
	id: string
	name: string
	path: string
	parentPath: string | null
	revision: string
	modifiedAt: string
}

export type FilesystemDirectoryEntry = FilesystemEntryBase & {
	kind: 'directory'
}

export type FilesystemFileEntry = FilesystemEntryBase & {
	kind: 'file'
	byteLength: number
	contentHash: string
	mediaType?: string
}

export type FilesystemEntry = FilesystemDirectoryEntry | FilesystemFileEntry

export type FilesystemFile = FilesystemFileEntry & {
	content: string
}

export type FilesystemFileBytes = FilesystemFileEntry & {
	bytes: Uint8Array
}

export type FilesystemListing = {
	entries: FilesystemEntry[]
	truncated: boolean
}

type ListingState = {
	entries: FilesystemEntry[]
	limit: number | undefined
	rootDevice: bigint
	truncated: boolean
}

export class FilesystemEntryConflictError extends Error {
	override readonly name = 'FilesystemEntryConflictError'
}

export class FilesystemFileTooLargeError extends Error {
	override readonly name = 'FilesystemFileTooLargeError'
}

export class FilesystemNotAFileError extends Error {
	override readonly name = 'FilesystemNotAFileError'
}

export async function resolveKnowledgeEntryPath(
	root: string,
	bundlePath: string,
	id?: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (id !== undefined) {
		try {
			const absolutePath = await resolveExistingPath(root, bundlePath)
			const stats = await lstat(absolutePath, { bigint: true })
			if (!stats.isSymbolicLink() && statIdentity(stats) === id) {
				return bundlePath
			}
		} catch (error) {
			const code = nodeErrorCode(error)
			if (
				!(error instanceof PathPolicyError && error.code !== 'invalid_name') &&
				code !== 'ENOENT' &&
				code !== 'ENOTDIR'
			) {
				throw error
			}
		}
		return findEntryPathByID(root, id, signal)
	}
	try {
		await resolveExistingPath(root, bundlePath)
		return bundlePath
	} catch (error) {
		if (isMissingPath(error) || nodeErrorCode(error) === 'ENOENT') {
			return null
		}
		throw error
	}
}

export async function readKnowledgeEntry(
	root: string,
	bundlePath: string
): Promise<FilesystemEntry> {
	const absolutePath = await resolveExistingPath(root, bundlePath)
	const [stats, rootStats] = await Promise.all([
		lstat(absolutePath, { bigint: true }),
		lstat(root, { bigint: true })
	])
	if (stats.isSymbolicLink() || stats.dev !== rootStats.dev) {
		throw new PathPolicyError('invalid_path', 'error.mutation.path.symlink')
	}
	if (stats.isDirectory()) {
		return directoryEntry(bundlePath, stats)
	}
	if (!stats.isFile()) {
		throw new Error('The requested entry is not a regular file or directory.')
	}
	return fileEntryFromBytes(await readStableFileBytes(root, bundlePath))
}

export async function readKnowledgeFileMetadata(
	root: string,
	bundlePath: string,
	maximumBytes?: number,
	signal?: AbortSignal
): Promise<FilesystemFileEntry> {
	signal?.throwIfAborted()
	const absolutePath = await resolveExistingPath(root, bundlePath)
	const rootStats = await lstat(root, { bigint: true })
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const handle = await open(absolutePath, secureOpenFlags(false))
		try {
			signal?.throwIfAborted()
			const before = await handle.stat({ bigint: true })
			if (!before.isFile()) {
				throw new FilesystemNotAFileError('The requested entry is not a file.')
			}
			if (before.nlink > 1n || before.dev !== rootStats.dev) {
				throw new Error('The requested entry is not a supported file.')
			}
			const revalidatedPath = await resolveExistingPath(root, bundlePath)
			await assertOpenPathIdentity(revalidatedPath, before)
			if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
				throw new FilesystemFileTooLargeError('The knowledge bundle file is too large.')
			}
			if (maximumBytes !== undefined && before.size > BigInt(maximumBytes)) {
				throw new FilesystemFileTooLargeError('The knowledge bundle file is too large.')
			}
			const contentHash = createHash('sha256')
			const buffer = Buffer.allocUnsafe(64 * 1024)
			let position = 0
			while (position < Number(before.size)) {
				signal?.throwIfAborted()
				const { bytesRead } = await handle.read(
					buffer,
					0,
					Math.min(buffer.byteLength, Number(before.size) - position),
					position
				)
				if (bytesRead === 0) {
					break
				}
				contentHash.update(buffer.subarray(0, bytesRead))
				position += bytesRead
			}
			const after = await handle.stat({ bigint: true })
			if (
				position !== Number(before.size) ||
				statRevision(before) !== statRevision(after) ||
				after.size !== before.size
			) {
				continue
			}
			return {
				kind: 'file',
				id: statIdentity(after),
				name: path.posix.basename(bundlePath),
				path: bundlePath,
				parentPath: parentPath(bundlePath),
				revision: statRevision(after),
				modifiedAt: statModifiedAt(after),
				byteLength: position,
				contentHash: contentHash.digest('hex'),
				...mediaTypeProperty(bundlePath)
			}
		} finally {
			await handle.close()
		}
	}
	throw new Error('The file changed while it was being read.')
}

export async function readKnowledgeFile(
	root: string,
	bundlePath: string,
	maximumBytes?: number
): Promise<FilesystemFile> {
	const { bytes, ...entry } = await readStableFileBytes(root, bundlePath, maximumBytes)
	return {
		...entry,
		content: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')
	}
}

export async function readKnowledgeFileBytes(
	root: string,
	bundlePath: string,
	maximumBytes?: number,
	signal?: AbortSignal
): Promise<FilesystemFileBytes> {
	return readStableFileBytes(root, bundlePath, maximumBytes, signal)
}

export async function readKnowledgeEntryID(
	root: string,
	bundlePath: string
): Promise<string | undefined> {
	try {
		const absolutePath = await resolveExistingPath(root, bundlePath)
		const [stats, rootStats] = await Promise.all([
			lstat(absolutePath, { bigint: true }),
			lstat(root, { bigint: true })
		])
		if (
			stats.isSymbolicLink() ||
			stats.dev !== rootStats.dev ||
			(!stats.isDirectory() && (!stats.isFile() || stats.nlink > 1n))
		) {
			return undefined
		}
		return statIdentity(stats)
	} catch (error) {
		if (isMissingPath(error) || nodeErrorCode(error) === 'ENOENT') {
			return undefined
		}
		throw error
	}
}

export async function scanKnowledgeDirectory(
	root: string,
	directoryPath: string,
	depth: number,
	limit?: number
): Promise<FilesystemListing> {
	const rootStats = await lstat(root, { bigint: true })
	const state: ListingState = {
		entries: [],
		limit,
		rootDevice: rootStats.dev,
		truncated: false
	}
	if (depth > 0) {
		await scanDirectory(root, directoryPath, depth, state)
	}
	return { entries: state.entries, truncated: state.truncated }
}

export async function createKnowledgeDirectory(
	root: string,
	bundlePath: string,
	expectedRootIdentity: string
): Promise<void> {
	const parent = await openCreationParent(root, bundlePath, expectedRootIdentity)
	const targetPath = path.join(parent.operationPath, parent.targetName)
	let createdStats: BigIntStats | undefined
	try {
		await assertCreationParent(root, parent)
		await mkdir(targetPath)
		createdStats = await lstat(targetPath, { bigint: true })
		if (!createdStats.isDirectory() || createdStats.isSymbolicLink()) {
			throw new PathPolicyError('invalid_path', 'error.mutation.path.changed')
		}
		await assertCreatedPath(root, bundlePath, targetPath, createdStats, parent)
		await syncOpenDirectory(parent.handle)
		await assertCreationParent(root, parent)
		await assertCreatedPath(root, bundlePath, targetPath, createdStats, parent)
	} catch (error) {
		if (createdStats) {
			await removeCreatedDirectory(targetPath, createdStats)
		}
		throw error
	} finally {
		await closeCreationParent(parent)
	}
}

export async function createKnowledgeFile(
	root: string,
	bundlePath: string,
	content: string,
	expectedRootIdentity: string
): Promise<void> {
	const parent = await openCreationParent(root, bundlePath, expectedRootIdentity)
	const targetPath = path.join(parent.operationPath, parent.targetName)
	const temporaryPath = path.join(parent.operationPath, `.open-knowledge-${randomUUID()}.tmp`)
	let temporaryStats: BigIntStats | undefined
	let published = false
	try {
		await assertCreationParent(root, parent)
		const handle = await open(temporaryPath, 'wx', 0o600)
		let handleOpen = true
		try {
			const openedStats = await handle.stat({ bigint: true })
			if (!openedStats.isFile()) {
				throw new PathPolicyError('invalid_path', 'error.mutation.path.changed')
			}
			temporaryStats = openedStats
			await handle.writeFile(content, 'utf8')
			await handle.sync()
			const writtenStats = await handle.stat({ bigint: true })
			if (statIdentity(writtenStats) !== statIdentity(openedStats)) {
				throw new PathPolicyError('invalid_path', 'error.mutation.path.changed')
			}
			temporaryStats = writtenStats
			await assertFileLink(temporaryPath, temporaryStats, 1n)
			await assertCreationParent(root, parent)
			await link(temporaryPath, targetPath)
			published = true
			await assertFileLink(temporaryPath, temporaryStats, 2n)
			await assertFileLink(targetPath, temporaryStats, 2n)
			await assertCreatedPath(root, bundlePath, targetPath, temporaryStats, parent)
			await handle.close()
			handleOpen = false
			await removeCreatedFile(temporaryPath, temporaryStats)
			await assertFileLink(targetPath, temporaryStats, 1n)
			await syncOpenDirectory(parent.handle)
			await assertCreationParent(root, parent)
			await assertCreatedPath(root, bundlePath, targetPath, temporaryStats, parent)
			await assertFileLink(targetPath, temporaryStats, 1n)
		} finally {
			if (handleOpen) {
				await handle.close()
			}
		}
	} catch (error) {
		if (published && temporaryStats) {
			await removeCreatedFile(targetPath, temporaryStats)
		}
		throw error
	} finally {
		if (temporaryStats) {
			await removeCreatedFile(temporaryPath, temporaryStats)
		}
		await closeCreationParent(parent)
	}
}

export async function replaceKnowledgeFile(
	root: string,
	bundlePath: string,
	content: string,
	expected: Pick<FilesystemFileEntry, 'id' | 'revision'>
): Promise<void> {
	const absolutePath = await resolveExistingPath(root, bundlePath)
	const stats = await lstat(absolutePath, { bigint: true })
	if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1n) {
		throw new Error('The requested entry is not a writable file.')
	}
	assertExpectedEntry(stats, expected)

	const parent = path.dirname(absolutePath)
	const parentBundlePath = parentPath(bundlePath) ?? ''
	const parentHandle = await open(parent, secureOpenFlags(true))
	try {
		const parentStats = await parentHandle.stat({ bigint: true })
		if (!parentStats.isDirectory()) {
			throw new PathPolicyError('invalid_path', 'error.mutation.parent.not-folder')
		}
		await assertBundlePathIdentity(root, parentBundlePath, parentStats)
		const operationParent = secureDescriptorPath(parentHandle.fd) ?? parent
		const targetPath = path.join(operationParent, path.basename(absolutePath))
		const temporaryPath = path.join(
			operationParent,
			`.${path.basename(absolutePath)}.open-knowledge-${randomUUID()}.tmp`
		)
		try {
			const handle = await open(temporaryPath, 'wx', Number(stats.mode & 0o777n))
			try {
				await handle.writeFile(content, 'utf8')
				await handle.sync()
			} finally {
				await handle.close()
			}
			await assertBundlePathIdentity(root, parentBundlePath, parentStats)
			const currentStats = await lstat(targetPath, { bigint: true })
			if (!currentStats.isFile() || currentStats.isSymbolicLink() || currentStats.nlink > 1n) {
				throw new Error('The requested entry is not a writable file.')
			}
			assertExpectedEntry(currentStats, expected)
			await rename(temporaryPath, targetPath)
			if (process.platform !== 'win32') {
				await parentHandle.sync()
			}
			await assertBundlePathIdentity(root, parentBundlePath, parentStats)
		} finally {
			await rm(temporaryPath, { force: true })
		}
	} finally {
		await parentHandle.close()
	}
}

export async function moveKnowledgeEntry(
	root: string,
	fromPath: string,
	toPath: string,
	expected: Pick<FilesystemEntry, 'id' | 'revision'>
): Promise<void> {
	const source = await resolveExistingPath(root, fromPath)
	const sourceStats = await lstat(source, { bigint: true })
	assertExpectedEntry(sourceStats, expected)
	const target = await resolveNewPath(root, toPath)
	try {
		await lstat(target)
		throw nodeError('EEXIST', 'The destination entry already exists.')
	} catch (error) {
		if (nodeErrorCode(error) !== 'ENOENT') {
			throw error
		}
	}
	await rename(source, target)
	const sourceParent = path.dirname(source)
	const targetParent = path.dirname(target)
	await syncDirectory(sourceParent)
	if (targetParent !== sourceParent) {
		await syncDirectory(targetParent)
	}
}

export async function deleteKnowledgeEntry(root: string, entry: FilesystemEntry): Promise<void> {
	const absolutePath = await resolveExistingPath(root, entry.path)
	const stats = await lstat(absolutePath, { bigint: true })
	assertExpectedEntry(stats, entry)
	if (entry.kind === 'directory') {
		if (!stats.isDirectory()) {
			throw new FilesystemEntryConflictError('The directory changed before deletion.')
		}
		await rmdir(absolutePath)
	} else {
		if (!stats.isFile() || stats.nlink > 1n) {
			throw new FilesystemEntryConflictError('The file changed before deletion.')
		}
		await unlink(absolutePath)
	}
	await syncDirectory(path.dirname(absolutePath))
}

async function scanDirectory(
	root: string,
	directoryPath: string,
	depth: number,
	state: ListingState
): Promise<boolean> {
	const absoluteDirectory = await resolveExistingPath(root, directoryPath)
	const handle = await open(absoluteDirectory, secureOpenFlags(true))
	try {
		const openedStats = await handle.stat({ bigint: true })
		if (!openedStats.isDirectory() || openedStats.dev !== state.rootDevice) {
			throw new PathPolicyError('invalid_path', 'error.mutation.path.not-directory')
		}
		const readableDirectory = secureDescriptorPath(handle.fd) ?? absoluteDirectory
		const children: Dirent[] = []
		const directory = await opendir(readableDirectory)
		for await (const child of directory) {
			children.push(child)
		}
		children.sort(compareDirectoryEntries)

		for (const child of children) {
			if (isIgnoredEntry(child.name) || child.isSymbolicLink()) {
				continue
			}
			const bundlePath = joinPath(directoryPath, child.name)
			try {
				const stats = await lstat(path.join(readableDirectory, child.name), {
					bigint: true
				})
				if (
					stats.isSymbolicLink() ||
					stats.dev !== state.rootDevice ||
					(!stats.isDirectory() && (!stats.isFile() || stats.nlink > 1n))
				) {
					continue
				}
				await assertBundlePathIdentity(root, bundlePath, stats)
				if (state.limit !== undefined && state.entries.length >= state.limit) {
					state.truncated = true
					return false
				}
				if (stats.isDirectory()) {
					state.entries.push(directoryEntry(bundlePath, stats))
					if (depth > 1 && !(await scanDirectory(root, bundlePath, depth - 1, state))) {
						return false
					}
				} else {
					state.entries.push(await readKnowledgeFileMetadata(root, bundlePath))
				}
			} catch (error) {
				if (!isMissingPath(error) && nodeErrorCode(error) !== 'ENOENT') {
					throw error
				}
			}
		}
		if (!secureDescriptorPath(handle.fd)) {
			await assertOpenPathIdentity(absoluteDirectory, openedStats)
		}
		return true
	} finally {
		await handle.close()
	}
}

async function findEntryPathByID(
	root: string,
	id: string,
	signal?: AbortSignal
): Promise<string | null> {
	signal?.throwIfAborted()
	const rootStats = await lstat(root, { bigint: true })
	if (statIdentity(rootStats) === id) {
		return ''
	}
	return findInDirectory(root, '', id, rootStats.dev, signal)
}

async function findInDirectory(
	root: string,
	directoryPath: string,
	id: string,
	rootDevice: bigint,
	signal?: AbortSignal
): Promise<string | null> {
	signal?.throwIfAborted()
	const absoluteDirectory = await resolveExistingPath(root, directoryPath)
	const handle = await open(absoluteDirectory, secureOpenFlags(true))
	try {
		const openedStats = await handle.stat({ bigint: true })
		if (!openedStats.isDirectory() || openedStats.dev !== rootDevice) {
			return null
		}
		const readableDirectory = secureDescriptorPath(handle.fd) ?? absoluteDirectory
		const children: Dirent[] = []
		const directory = await opendir(readableDirectory)
		for await (const child of directory) {
			children.push(child)
		}
		children.sort(compareDirectoryEntries)
		for (const child of children) {
			signal?.throwIfAborted()
			if (isIgnoredEntry(child.name) || child.isSymbolicLink()) {
				continue
			}
			const childBundlePath = joinPath(directoryPath, child.name)
			try {
				const stats = await lstat(path.join(readableDirectory, child.name), {
					bigint: true
				})
				if (
					stats.isSymbolicLink() ||
					stats.dev !== rootDevice ||
					(!stats.isDirectory() && (!stats.isFile() || stats.nlink > 1n))
				) {
					continue
				}
				await assertBundlePathIdentity(root, childBundlePath, stats)
				if (statIdentity(stats) === id) {
					return childBundlePath
				}
				if (stats.isDirectory()) {
					const nested = await findInDirectory(root, childBundlePath, id, rootDevice, signal)
					if (nested !== null) {
						return nested
					}
				}
			} catch (error) {
				if (!isMissingPath(error) && nodeErrorCode(error) !== 'ENOENT') {
					throw error
				}
			}
		}
		if (!secureDescriptorPath(handle.fd)) {
			await assertOpenPathIdentity(absoluteDirectory, openedStats)
		}
		return null
	} finally {
		await handle.close()
	}
}

async function readStableFileBytes(
	root: string,
	bundlePath: string,
	maximumBytes?: number,
	signal?: AbortSignal
): Promise<FilesystemFileBytes> {
	signal?.throwIfAborted()
	const absolutePath = await resolveExistingPath(root, bundlePath)
	const rootStats = await lstat(root, { bigint: true })
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const handle = await open(absolutePath, secureOpenFlags(false))
		try {
			const before = await handle.stat({ bigint: true })
			if (!before.isFile()) {
				throw new FilesystemNotAFileError('The requested entry is not a file.')
			}
			if (before.nlink > 1n || before.dev !== rootStats.dev) {
				throw new Error('The requested entry is not a supported file.')
			}
			const revalidatedPath = await resolveExistingPath(root, bundlePath)
			await assertOpenPathIdentity(revalidatedPath, before)
			if (
				before.size > BigInt(Number.MAX_SAFE_INTEGER) ||
				(maximumBytes !== undefined && before.size > BigInt(maximumBytes))
			) {
				throw new FilesystemFileTooLargeError('The knowledge bundle file is too large.')
			}
			const contentBuffer = await handle.readFile(signal ? { signal } : undefined)
			if (maximumBytes !== undefined && contentBuffer.byteLength > maximumBytes) {
				throw new FilesystemFileTooLargeError('The knowledge bundle file is too large.')
			}
			const after = await handle.stat({ bigint: true })
			if (
				statRevision(before) !== statRevision(after) ||
				after.size !== BigInt(contentBuffer.byteLength)
			) {
				continue
			}
			return {
				kind: 'file',
				id: statIdentity(after),
				name: path.posix.basename(bundlePath),
				path: bundlePath,
				parentPath: parentPath(bundlePath),
				revision: statRevision(after),
				modifiedAt: statModifiedAt(after),
				byteLength: contentBuffer.byteLength,
				contentHash: sha256(contentBuffer),
				...mediaTypeProperty(bundlePath),
				bytes: contentBuffer
			}
		} finally {
			await handle.close()
		}
	}
	throw new Error('The file changed while it was being read.')
}

function directoryEntry(bundlePath: string, stats: BigIntStats): FilesystemDirectoryEntry {
	return {
		kind: 'directory',
		id: statIdentity(stats),
		name: bundlePath ? path.posix.basename(bundlePath) : '',
		path: bundlePath,
		parentPath: parentPath(bundlePath),
		revision: statRevision(stats),
		modifiedAt: statModifiedAt(stats)
	}
}

function fileEntry(file: FilesystemFile): FilesystemFileEntry {
	const { content: _content, ...entry } = file
	return entry
}

function fileEntryFromBytes(file: FilesystemFileBytes): FilesystemFileEntry {
	const { bytes: _bytes, ...entry } = file
	return entry
}

function parentPath(bundlePath: string): string | null {
	if (!bundlePath) {
		return null
	}
	const parent = path.posix.dirname(bundlePath)
	return parent === '.' ? '' : parent
}

function joinPath(parent: string, name: string): string {
	return parent ? `${parent}/${name}` : name
}

function statIdentity(stats: BigIntStats): string {
	return `${stats.dev}:${stats.ino}`
}

function statRevision(stats: BigIntStats): string {
	return `${stats.ctimeNs}:${stats.mtimeNs}:${stats.size}`
}

function statModifiedAt(stats: BigIntStats): string {
	return new Date(Number(stats.mtimeMs)).toISOString()
}

function assertExpectedEntry(
	stats: BigIntStats,
	expected: Pick<FilesystemEntry, 'id' | 'revision'>
): void {
	if (statIdentity(stats) !== expected.id || statRevision(stats) !== expected.revision) {
		throw new FilesystemEntryConflictError('The entry changed before the operation completed.')
	}
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex')
}

function mediaTypeProperty(bundlePath: string): { mediaType?: string } {
	const extension = path.posix.extname(bundlePath).toLowerCase()
	const mediaType =
		extension === '.md' || extension === '.markdown'
			? 'text/markdown'
			: extension === '.txt'
				? 'text/plain'
				: extension === '.json'
					? 'application/json'
					: extension === '.yaml' || extension === '.yml'
						? 'application/yaml'
						: undefined
	return mediaType ? { mediaType } : {}
}

function isIgnoredEntry(name: string): boolean {
	try {
		validateEntryName(name)
	} catch (error) {
		if (error instanceof PathPolicyError) {
			return true
		}
		throw error
	}
	const normalized = name.toLowerCase()
	return (
		ignoredEntries.has(normalized) ||
		(normalized.includes('.open-knowledge-') && normalized.endsWith('.tmp'))
	)
}

function compareDirectoryEntries(left: Dirent, right: Dirent): number {
	if (left.isDirectory() !== right.isDirectory()) {
		return left.isDirectory() ? -1 : 1
	}
	return left.name.localeCompare(right.name, undefined, {
		sensitivity: 'base',
		numeric: true
	})
}

function secureOpenFlags(directory: boolean): number {
	let flags = constants.O_RDONLY
	if (process.platform !== 'win32') {
		flags |= constants.O_NOFOLLOW | constants.O_NONBLOCK
		if (directory) {
			flags |= constants.O_DIRECTORY
		}
	}
	return flags
}

function secureDescriptorPath(fileDescriptor: number): string | null {
	return process.platform === 'linux' ? `/proc/self/fd/${fileDescriptor}` : null
}

type CreationParent = {
	readonly absolutePath: string
	readonly bundlePath: string
	readonly handle: FileHandle
	readonly operationPath: string
	readonly rootHandle: FileHandle
	readonly rootPath: string
	readonly rootStats: BigIntStats
	readonly stats: BigIntStats
	readonly targetName: string
}

async function openCreationParent(
	root: string,
	bundlePath: string,
	expectedRootIdentity: string
): Promise<CreationParent> {
	const rootHandle = await open(root, secureOpenFlags(true))
	let handle: FileHandle | undefined
	try {
		const rootStats = await rootHandle.stat({ bigint: true })
		if (
			!rootStats.isDirectory() ||
			!matchesFilesystemPathIdentity(expectedRootIdentity, rootStats)
		) {
			throw new PathPolicyError('invalid_path', 'error.mutation.workspace.root-changed')
		}
		await assertCreationPathIdentity(root, rootStats)

		const absoluteTarget = await resolveNewPath(root, bundlePath)
		const absolutePath = path.dirname(absoluteTarget)
		const bundleParentPath = parentPath(bundlePath)
		if (bundleParentPath === null) {
			throw new PathPolicyError('invalid_path', 'error.mutation.workspace.root-replace')
		}

		handle = await open(absolutePath, secureOpenFlags(true))
		const stats = await handle.stat({ bigint: true })
		if (!stats.isDirectory()) {
			throw new PathPolicyError('invalid_path', 'error.mutation.parent.not-folder')
		}
		if (stats.dev !== rootStats.dev) {
			throw new PathPolicyError('invalid_path', 'error.mutation.path.symlink')
		}
		const result: CreationParent = {
			absolutePath,
			bundlePath: bundleParentPath,
			handle,
			operationPath: secureDescriptorPath(handle.fd) ?? absolutePath,
			rootHandle,
			rootPath: root,
			rootStats,
			stats,
			targetName: path.basename(absoluteTarget)
		}
		await assertCreationParent(root, result)
		return result
	} catch (error) {
		await handle?.close()
		await rootHandle.close()
		throw error
	}
}

async function assertCreationParent(root: string, parent: CreationParent): Promise<void> {
	try {
		await assertCreationPathIdentity(parent.rootPath, parent.rootStats)
		await assertBundlePathIdentity(root, parent.bundlePath, parent.stats)
		if (!secureDescriptorPath(parent.handle.fd)) {
			await assertCreationPathIdentity(parent.absolutePath, parent.stats)
		}
	} catch (error) {
		const code = nodeErrorCode(error)
		if (isMissingPath(error) || code === 'ENOENT' || code === 'ENOTDIR') {
			throw new PathPolicyError('invalid_path', 'error.mutation.path.changed')
		}
		throw error
	}
}

async function closeCreationParent(parent: CreationParent): Promise<void> {
	try {
		await parent.handle.close()
	} finally {
		await parent.rootHandle.close()
	}
}

async function assertCreatedPath(
	root: string,
	bundlePath: string,
	operationPath: string,
	createdStats: BigIntStats,
	parent: CreationParent
): Promise<void> {
	if (createdStats.dev !== parent.stats.dev) {
		throw new PathPolicyError('invalid_path', 'error.mutation.path.symlink')
	}
	await assertOpenPathIdentity(operationPath, createdStats)
	await assertBundlePathIdentity(root, bundlePath, createdStats)
}

async function removeCreatedDirectory(candidate: string, expected: BigIntStats): Promise<void> {
	const current = await existingStats(candidate)
	if (
		current &&
		current.isDirectory() &&
		!current.isSymbolicLink() &&
		statIdentity(current) === statIdentity(expected)
	) {
		await rmdir(candidate)
	}
}

async function removeCreatedFile(candidate: string, expected: BigIntStats): Promise<void> {
	const current = await existingStats(candidate)
	if (
		current &&
		current.isFile() &&
		!current.isSymbolicLink() &&
		statIdentity(current) === statIdentity(expected)
	) {
		await unlink(candidate)
	}
}

async function assertFileLink(
	candidate: string,
	expected: BigIntStats,
	expectedLinkCount: bigint
): Promise<void> {
	const current = await lstat(candidate, { bigint: true })
	if (
		!current.isFile() ||
		current.isSymbolicLink() ||
		statIdentity(current) !== statIdentity(expected) ||
		current.nlink !== expectedLinkCount
	) {
		throw new PathPolicyError('invalid_path', 'error.mutation.path.changed')
	}
}

async function existingStats(candidate: string): Promise<BigIntStats | null> {
	try {
		return await lstat(candidate, { bigint: true })
	} catch (error) {
		if (nodeErrorCode(error) === 'ENOENT') {
			return null
		}
		throw error
	}
}

async function syncOpenDirectory(handle: FileHandle): Promise<void> {
	if (process.platform !== 'win32') {
		await handle.sync()
	}
}

async function assertCreationPathIdentity(
	candidate: string,
	openedStats: BigIntStats
): Promise<void> {
	try {
		await assertOpenPathIdentity(candidate, openedStats)
	} catch (error) {
		const code = nodeErrorCode(error)
		if (code === 'ENOENT' || code === 'ENOTDIR') {
			throw new PathPolicyError('invalid_path', 'error.mutation.path.changed')
		}
		throw error
	}
}

async function assertOpenPathIdentity(candidate: string, openedStats: BigIntStats): Promise<void> {
	const current = await lstat(candidate, { bigint: true })
	if (current.isSymbolicLink() || statIdentity(current) !== statIdentity(openedStats)) {
		throw new PathPolicyError('invalid_path', 'error.mutation.path.changed')
	}
}

async function assertBundlePathIdentity(
	root: string,
	bundlePath: string,
	openedStats: BigIntStats
): Promise<void> {
	const candidate = await resolveExistingPath(root, bundlePath)
	await assertOpenPathIdentity(candidate, openedStats)
}

async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') {
		return
	}
	const handle = await open(directory, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

function nodeError(code: string, message: string): Error & { code: string } {
	return Object.assign(new Error(message), { code })
}

function isMissingPath(error: unknown): boolean {
	return error instanceof PathPolicyError && error.code === 'not_found'
}
