import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type {
	CreateKnowledgeBundleDirectoryInput,
	CreateKnowledgeBundleDirectoryResult,
	CreateKnowledgeBundleFileInput,
	CreateKnowledgeBundleFileResult,
	DeleteKnowledgeBundleEntryInput,
	DeleteKnowledgeBundleEntryResult,
	EditableKnowledgeBundle,
	KnowledgeBundleChange,
	KnowledgeBundleChangeListener,
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntry,
	KnowledgeBundleEntryLocator,
	KnowledgeBundleFile,
	KnowledgeBundleFileEntry,
	KnowledgeBundleInfo,
	KnowledgeBundleListing,
	KnowledgeBundleMutationError,
	KnowledgeBundleMutationResult,
	KnowledgeBundlePath,
	KnowledgeBundleSubscription,
	ListKnowledgeBundleInput,
	MoveKnowledgeBundleEntryInput,
	MoveKnowledgeBundleEntryResult,
	PatchKnowledgeBundleFileInput,
	PatchKnowledgeBundleFileResult,
	ReadKnowledgeBundleFileInput,
	SubscribableKnowledgeBundle,
	WriteKnowledgeBundleFileInput,
	WriteKnowledgeBundleFileResult
} from '@open-knowledge/knowledge-bundle-api'
import { applyExactTextPatch, ExactTextPatchError } from '@open-knowledge/knowledge-bundle-patch'
import { nodeErrorCode } from './node-error'
import {
	createKnowledgeDirectory,
	createKnowledgeFile,
	deleteKnowledgeEntry,
	FilesystemEntryConflictError,
	FilesystemFileTooLargeError,
	FilesystemNotAFileError,
	moveKnowledgeEntry,
	readKnowledgeEntry,
	readKnowledgeFileMetadata,
	readKnowledgeEntryID,
	readKnowledgeFile,
	readKnowledgeFileBytes,
	replaceKnowledgeFile,
	resolveKnowledgeEntryPath,
	scanKnowledgeDirectory,
	type FilesystemDirectoryEntry,
	type FilesystemEntry,
	type FilesystemFile,
	type FilesystemFileBytes,
	type FilesystemFileEntry
} from './file-snapshots'
import {
	absoluteBundlePath,
	filesystemPathIdentity,
	internalBundlePath,
	matchesFilesystemPathIdentity,
	PathPolicyError,
	relativeBundlePath,
	validateEntryName
} from './path-policy'

export type FilesystemKnowledgeBundleMetadata = null

export type FilesystemKnowledgeBundleOptions = {
	expectedRootIdentity?: string
}

export type FilesystemKnowledgeBundleFileBytes = KnowledgeBundleFileEntry & {
	bytes: Uint8Array
}

export class FilesystemKnowledgeBundle
	implements
		EditableKnowledgeBundle<FilesystemKnowledgeBundleMetadata>,
		SubscribableKnowledgeBundle<FilesystemKnowledgeBundleMetadata, 'editable'>
{
	private watcher: FSWatcher | undefined
	private mutationTail = Promise.resolve()
	private rootIdentity: string | undefined
	private readonly listeners = new Set<KnowledgeBundleChangeListener>()

	constructor(
		readonly rootPath: string,
		options: FilesystemKnowledgeBundleOptions = {}
	) {
		this.rootIdentity = options.expectedRootIdentity
	}

	async getInfo(): Promise<KnowledgeBundleInfo<FilesystemKnowledgeBundleMetadata, 'editable'>> {
		await this.assertStableRoot()
		return { access: 'editable', metadata: null }
	}

	async list(input: ListKnowledgeBundleInput): Promise<KnowledgeBundleListing | null> {
		await this.assertStableRoot()
		const requestedPath = internalBundlePath(input.path)
		const resolvedPath = await resolveKnowledgeEntryPath(this.rootPath, requestedPath, input.id)
		if (resolvedPath === null) {
			return null
		}
		const directory = await readKnowledgeEntry(this.rootPath, resolvedPath)
		if (directory.kind !== 'directory') {
			return null
		}
		const listing = await scanKnowledgeDirectory(
			this.rootPath,
			directory.path,
			input.depth,
			input.limit
		)
		return {
			directory: publicDirectory(directory),
			entries: listing.entries.map(publicEntry),
			truncated: listing.truncated
		}
	}

	async readFile(
		input: ReadKnowledgeBundleFileInput,
		pathAllowed: (path: KnowledgeBundlePath) => boolean = allowAnyPath
	): Promise<KnowledgeBundleFile | null> {
		await this.assertStableRoot()
		const requestedPath = internalBundlePath(input.path)
		const resolvedPath = await resolveKnowledgeEntryPath(this.rootPath, requestedPath, input.id)
		if (resolvedPath === null) {
			return null
		}
		if (!pathAllowed(absoluteBundlePath(resolvedPath))) {
			throw new Error('The resolved file path is not allowed.')
		}
		try {
			const file = await readKnowledgeFile(this.rootPath, resolvedPath, input.maximumBytes)
			return input.id === undefined || file.id === input.id ? publicFile(file) : null
		} catch (error) {
			if (error instanceof FilesystemNotAFileError) {
				return null
			}
			throw error
		}
	}

	async resolveEntryPath(
		input: KnowledgeBundleEntryLocator,
		signal?: AbortSignal
	): Promise<KnowledgeBundlePath | null> {
		await this.assertStableRoot()
		const requestedPath = internalBundlePath(input.path)
		const resolvedPath = await resolveKnowledgeEntryPath(
			this.rootPath,
			requestedPath,
			input.id,
			signal
		)
		return resolvedPath === null ? null : absoluteBundlePath(resolvedPath)
	}

	async resolveFileMetadata(
		input: KnowledgeBundleEntryLocator,
		maximumBytes?: number,
		signal?: AbortSignal
	): Promise<KnowledgeBundleFileEntry | null> {
		await this.assertStableRoot()
		const requestedPath = internalBundlePath(input.path)
		const resolvedPath = await resolveKnowledgeEntryPath(
			this.rootPath,
			requestedPath,
			input.id,
			signal
		)
		if (resolvedPath === null) {
			return null
		}
		try {
			const file = await readKnowledgeFileMetadata(
				this.rootPath,
				resolvedPath,
				maximumBytes,
				signal
			)
			return input.id === undefined || file.id === input.id ? publicFileEntry(file) : null
		} catch (error) {
			if (error instanceof FilesystemNotAFileError) {
				return null
			}
			throw error
		}
	}

	async readFileBytes(
		input: ReadKnowledgeBundleFileInput,
		pathAllowed: (path: KnowledgeBundlePath) => boolean = allowAnyPath,
		signal?: AbortSignal
	): Promise<FilesystemKnowledgeBundleFileBytes | null> {
		await this.assertStableRoot()
		const requestedPath = internalBundlePath(input.path)
		const resolvedPath = await resolveKnowledgeEntryPath(
			this.rootPath,
			requestedPath,
			input.id,
			signal
		)
		if (resolvedPath === null) {
			return null
		}
		if (!pathAllowed(absoluteBundlePath(resolvedPath))) {
			throw new Error('The resolved file path is not allowed.')
		}
		try {
			const file = await readKnowledgeFileBytes(
				this.rootPath,
				resolvedPath,
				input.maximumBytes,
				signal
			)
			return input.id === undefined || file.id === input.id ? publicFileBytes(file) : null
		} catch (error) {
			if (error instanceof FilesystemNotAFileError) {
				return null
			}
			throw error
		}
	}

	async createDirectory(
		input: CreateKnowledgeBundleDirectoryInput
	): Promise<CreateKnowledgeBundleDirectoryResult> {
		return this.exclusive(async () => {
			try {
				if (input.id !== undefined) {
					return mutationFailure('unsupported', 'Caller-supplied entry IDs are not supported.')
				}
				const rootIdentity = await this.assertStableRoot()
				const targetPath = creatablePath(input.path)
				await createKnowledgeDirectory(this.rootPath, targetPath, rootIdentity)
				const created = await readKnowledgeEntry(this.rootPath, targetPath)
				if (created.kind !== 'directory') {
					return mutationFailure('io_error', 'The created directory could not be read back.')
				}
				return { ok: true, value: { directory: publicDirectory(created) } }
			} catch (error) {
				return {
					ok: false,
					error: mutationError(error, 'The directory could not be created.')
				}
			}
		})
	}

	async createFile(
		input: CreateKnowledgeBundleFileInput
	): Promise<CreateKnowledgeBundleFileResult> {
		return this.exclusive(async () => {
			try {
				if (input.id !== undefined) {
					return mutationFailure('unsupported', 'Caller-supplied entry IDs are not supported.')
				}
				if (input.mediaType !== undefined && input.mediaType !== inferredMediaType(input.path)) {
					return mutationFailure(
						'unsupported',
						'The filesystem bundle derives media types from file extensions.'
					)
				}
				const rootIdentity = await this.assertStableRoot()
				const targetPath = creatablePath(input.path)
				await createKnowledgeFile(this.rootPath, targetPath, input.content, rootIdentity)
				const created = await readKnowledgeEntry(this.rootPath, targetPath)
				if (created.kind !== 'file') {
					return mutationFailure('io_error', 'The created file could not be read back.')
				}
				return { ok: true, value: { file: publicFileEntry(created) } }
			} catch (error) {
				return {
					ok: false,
					error: mutationError(error, 'The file could not be created.')
				}
			}
		})
	}

	async writeFile(
		input: WriteKnowledgeBundleFileInput,
		pathAllowed: (path: KnowledgeBundlePath) => boolean = allowAnyPath
	): Promise<WriteKnowledgeBundleFileResult> {
		return this.exclusive(async () => {
			let current: FilesystemEntry | undefined
			try {
				await this.assertStableRoot()
				const requestedPath = internalBundlePath(input.path)
				const resolvedPath = await resolveKnowledgeEntryPath(this.rootPath, requestedPath, input.id)
				if (resolvedPath === null) {
					return mutationFailure('not_found', 'The file no longer exists.')
				}
				if (!pathAllowed(absoluteBundlePath(resolvedPath))) {
					return mutationFailure('unsupported', 'The resolved file path is not allowed.')
				}
				current = await readKnowledgeEntry(this.rootPath, resolvedPath)
				if (input.id !== undefined && current.id !== input.id) {
					return mutationFailure('not_found', 'The file no longer exists.')
				}
				if (current.kind !== 'file') {
					return mutationFailure(
						'not_a_file',
						'The requested entry is not a file.',
						publicEntry(current)
					)
				}
				if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
					return mutationFailure(
						'revision_conflict',
						'The file revision changed.',
						publicEntry(current)
					)
				}
				if (
					input.expectedContentHash !== undefined &&
					input.expectedContentHash !== current.contentHash
				) {
					return mutationFailure(
						'content_conflict',
						'The file content changed.',
						publicEntry(current)
					)
				}
				if (input.mediaType !== undefined && input.mediaType !== current.mediaType) {
					return mutationFailure(
						'unsupported',
						'The filesystem bundle derives media types from file extensions.',
						publicEntry(current)
					)
				}
				const currentFile = await readKnowledgeFile(this.rootPath, current.path)
				if (currentFile.content === input.content) {
					return {
						ok: true,
						value: { status: 'unchanged', file: publicFileEntry(currentFile) }
					}
				}
				await replaceKnowledgeFile(this.rootPath, current.path, input.content, current)
				const written = await readKnowledgeFile(this.rootPath, current.path)
				return {
					ok: true,
					value: { status: 'updated', file: publicFileEntry(written) }
				}
			} catch (error) {
				return {
					ok: false,
					error: mutationError(
						error,
						'The file could not be written.',
						current && publicEntry(current)
					)
				}
			}
		})
	}

	async patchFile(
		input: PatchKnowledgeBundleFileInput,
		pathAllowed: (path: KnowledgeBundlePath) => boolean = allowAnyPath
	): Promise<PatchKnowledgeBundleFileResult> {
		return this.exclusive(async () => {
			let current: FilesystemEntry | undefined
			try {
				await this.assertStableRoot()
				const requestedPath = internalBundlePath(input.path)
				const resolvedPath = await resolveKnowledgeEntryPath(this.rootPath, requestedPath, input.id)
				if (resolvedPath === null) {
					return mutationFailure('not_found', 'The file no longer exists.')
				}
				if (!pathAllowed(absoluteBundlePath(resolvedPath))) {
					return mutationFailure('unsupported', 'The resolved file path is not allowed.')
				}

				let currentFile: FilesystemFile
				try {
					currentFile = await readKnowledgeFile(this.rootPath, resolvedPath, input.maximumBytes)
				} catch (error) {
					if (!(error instanceof FilesystemNotAFileError)) {
						throw error
					}
					current = await readKnowledgeEntry(this.rootPath, resolvedPath)
					return mutationFailure(
						'not_a_file',
						'The requested entry is not a file.',
						publicEntry(current)
					)
				}
				if (input.id !== undefined && currentFile.id !== input.id) {
					return mutationFailure('not_found', 'The file no longer exists.')
				}
				current = currentFile
				if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
					return mutationFailure(
						'revision_conflict',
						'The file revision changed.',
						publicFileEntry(current)
					)
				}
				if (
					input.expectedContentHash !== undefined &&
					input.expectedContentHash !== current.contentHash
				) {
					return mutationFailure(
						'content_conflict',
						'The file content changed.',
						publicFileEntry(current)
					)
				}

				const content = applyExactTextPatch(currentFile.content, input.edits)
				const byteLength = Buffer.byteLength(content)
				if (input.maximumBytes !== undefined && byteLength > input.maximumBytes) {
					return mutationFailure(
						'too_large',
						`Patched content exceeds the ${input.maximumBytes}-byte limit.`,
						publicFileEntry(current)
					)
				}
				if (content === currentFile.content) {
					return {
						ok: true,
						value: { status: 'unchanged', file: publicFileEntry(currentFile) }
					}
				}

				await replaceKnowledgeFile(this.rootPath, current.path, content, current)
				const patched = await readKnowledgeFile(this.rootPath, current.path, input.maximumBytes)
				return {
					ok: true,
					value: { status: 'patched', file: publicFileEntry(patched) }
				}
			} catch (error) {
				return {
					ok: false,
					error: mutationError(
						error,
						'The file could not be patched.',
						current && publicEntry(current)
					)
				}
			}
		})
	}

	async moveEntry(input: MoveKnowledgeBundleEntryInput): Promise<MoveKnowledgeBundleEntryResult> {
		return this.exclusive(async () => {
			let current: FilesystemEntry | undefined
			try {
				await this.assertStableRoot()
				current = (await this.resolveFilesystemEntry(input)) ?? undefined
				if (!current) {
					return mutationFailure('not_found', 'The entry no longer exists.')
				}
				if (!current.path) {
					return mutationFailure('unsupported', 'The bundle root cannot be moved.')
				}
				if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
					return mutationFailure(
						'revision_conflict',
						'The entry revision changed.',
						publicEntry(current)
					)
				}
				const destinationPath = creatablePath(input.destinationPath)
				if (destinationPath === current.path) {
					return {
						ok: true,
						value: { status: 'unchanged', entry: publicEntry(current) }
					}
				}
				if (current.kind === 'directory' && destinationPath.startsWith(`${current.path}/`)) {
					return mutationFailure('invalid_path', 'A directory cannot be moved inside itself.')
				}
				if ((await resolveKnowledgeEntryPath(this.rootPath, destinationPath)) !== null) {
					return mutationFailure('already_exists', 'The destination entry already exists.')
				}
				await moveKnowledgeEntry(this.rootPath, current.path, destinationPath, current)
				const moved = await readKnowledgeEntry(this.rootPath, destinationPath)
				return {
					ok: true,
					value: { status: 'moved', entry: publicEntry(moved) }
				}
			} catch (error) {
				return {
					ok: false,
					error: mutationError(
						error,
						'The entry could not be moved.',
						current && publicEntry(current)
					)
				}
			}
		})
	}

	async deleteEntry(
		input: DeleteKnowledgeBundleEntryInput
	): Promise<DeleteKnowledgeBundleEntryResult> {
		return this.exclusive(async () => {
			let current: FilesystemEntry | undefined
			try {
				await this.assertStableRoot()
				current = (await this.resolveFilesystemEntry(input)) ?? undefined
				if (!current) {
					return mutationFailure('not_found', 'The entry no longer exists.')
				}
				if (!current.path) {
					return mutationFailure('unsupported', 'The bundle root cannot be deleted.')
				}
				if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
					return mutationFailure(
						'revision_conflict',
						'The entry revision changed.',
						publicEntry(current)
					)
				}
				await deleteKnowledgeEntry(this.rootPath, current)
				return { ok: true, value: { entry: publicEntry(current) } }
			} catch (error) {
				if (nodeErrorCode(error) === 'EEXIST' && current?.kind === 'directory') {
					return mutationFailure(
						'not_empty',
						'error.mutation.folder.not-empty',
						publicEntry(current)
					)
				}
				return {
					ok: false,
					error: mutationError(
						error,
						'The entry could not be deleted.',
						current && publicEntry(current)
					)
				}
			}
		})
	}

	async subscribe(listener: KnowledgeBundleChangeListener): Promise<KnowledgeBundleSubscription> {
		this.listeners.add(listener)
		try {
			await this.startWatching()
		} catch (error) {
			this.listeners.delete(listener)
			throw error
		}
		let closed = false
		return {
			close: async () => {
				if (!closed) {
					closed = true
					this.listeners.delete(listener)
				}
			}
		}
	}

	private async startWatching(): Promise<void> {
		if (this.watcher) {
			return
		}
		await this.assertStableRoot()
		const watcher = watch(this.rootPath, {
			ignoreInitial: true,
			followSymlinks: false,
			ignored: (candidate) => shouldIgnorePath(this.rootPath, candidate)
		})
		this.watcher = watcher
		watcher.on('add', (filePath) => void this.emitChange(filePath, 'created'))
		watcher.on('addDir', (filePath) => void this.emitChange(filePath, 'created'))
		watcher.on('change', (filePath) => void this.emitChange(filePath, 'changed'))
		watcher.on('unlink', (filePath) => void this.emitChange(filePath, 'removed'))
		watcher.on('unlinkDir', (filePath) => void this.emitChange(filePath, 'removed'))
		try {
			await watcherReady(watcher)
		} catch (error) {
			await watcher.close()
			if (this.watcher === watcher) {
				this.watcher = undefined
			}
			throw error
		}
	}

	async close(): Promise<void> {
		await this.watcher?.close()
		this.watcher = undefined
		this.listeners.clear()
	}

	private async resolveFilesystemEntry(
		input: KnowledgeBundleEntryLocator
	): Promise<FilesystemEntry | null> {
		const requestedPath = internalBundlePath(input.path)
		const resolvedPath = await resolveKnowledgeEntryPath(this.rootPath, requestedPath, input.id)
		return resolvedPath === null ? null : readKnowledgeEntry(this.rootPath, resolvedPath)
	}

	private async emitChange(
		absolutePath: string,
		kind: KnowledgeBundleChange['kind']
	): Promise<void> {
		const relativePath = relativeBundlePath(this.rootPath, absolutePath)
		if (relativePath === null) {
			return
		}
		let id: string | undefined
		if (kind !== 'removed') {
			try {
				id = await readKnowledgeEntryID(this.rootPath, relativePath)
			} catch {
				id = undefined
			}
		}
		const change: KnowledgeBundleChange = {
			kind,
			path: absoluteBundlePath(relativePath),
			...(id ? { id } : {})
		}
		for (const listener of this.listeners) {
			void Promise.resolve(listener(change)).catch(() => undefined)
		}
	}

	private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.mutationTail
		let release = () => {}
		this.mutationTail = new Promise<void>((resolve) => {
			release = resolve
		})
		await previous
		try {
			return await operation()
		} finally {
			release()
		}
	}

	private async assertStableRoot(): Promise<string> {
		const stats = await lstat(this.rootPath, { bigint: true })
		if (!stats.isDirectory() || stats.isSymbolicLink()) {
			throw new PathPolicyError('invalid_path', 'error.mutation.workspace.root-unavailable')
		}
		const identity = filesystemPathIdentity(stats)
		if (this.rootIdentity && !matchesFilesystemPathIdentity(this.rootIdentity, stats)) {
			throw new PathPolicyError('invalid_path', 'error.mutation.workspace.root-changed')
		}
		this.rootIdentity ??= identity
		return this.rootIdentity
	}
}

function creatablePath(bundlePath: KnowledgeBundlePath): string {
	const internalPath = internalBundlePath(bundlePath)
	if (!internalPath) {
		throw new PathPolicyError('invalid_path', 'error.mutation.workspace.root-replace')
	}
	validateEntryName(path.posix.basename(internalPath))
	return internalPath
}

function publicEntry(entry: FilesystemEntry): KnowledgeBundleEntry {
	return entry.kind === 'directory' ? publicDirectory(entry) : publicFileEntry(entry)
}

function publicDirectory(entry: FilesystemDirectoryEntry): KnowledgeBundleDirectoryEntry {
	return {
		kind: 'directory',
		id: entry.id,
		path: absoluteBundlePath(entry.path),
		name: entry.name,
		parentPath: entry.parentPath === null ? null : absoluteBundlePath(entry.parentPath),
		revision: entry.revision,
		modifiedAt: entry.modifiedAt
	}
}

function publicFileEntry(entry: FilesystemFileEntry): KnowledgeBundleFileEntry {
	return {
		kind: 'file',
		id: entry.id,
		path: absoluteBundlePath(entry.path),
		name: entry.name,
		parentPath: entry.parentPath === null ? null : absoluteBundlePath(entry.parentPath),
		revision: entry.revision,
		modifiedAt: entry.modifiedAt,
		byteLength: entry.byteLength,
		contentHash: entry.contentHash,
		...(entry.mediaType ? { mediaType: entry.mediaType } : {})
	}
}

function publicFile(file: FilesystemFile): KnowledgeBundleFile {
	return { ...publicFileEntry(file), content: file.content }
}

function publicFileBytes(file: FilesystemFileBytes): FilesystemKnowledgeBundleFileBytes {
	return { ...publicFileEntry(file), bytes: file.bytes }
}

function mutationFailure<Value>(
	code: KnowledgeBundleMutationError['code'],
	message: string,
	current?: KnowledgeBundleEntry
): KnowledgeBundleMutationResult<Value> {
	return {
		ok: false,
		error: { code, message, ...(current ? { current } : {}) }
	}
}

function mutationError(
	error: unknown,
	fallback: string,
	current?: KnowledgeBundleEntry
): KnowledgeBundleMutationError {
	if (error instanceof ExactTextPatchError) {
		const code =
			error.reason === 'not_found'
				? 'patch_not_found'
				: error.reason === 'ambiguous'
					? 'patch_ambiguous'
					: error.reason === 'too_many_edits' || error.reason === 'too_large'
						? 'too_large'
						: 'invalid_patch'
		return {
			code,
			message: error.message,
			...(error.editNumber === null ? {} : { editNumber: error.editNumber }),
			...(current ? { current } : {})
		}
	}
	if (error instanceof FilesystemEntryConflictError) {
		return {
			code: 'revision_conflict',
			message: error.message,
			...(current ? { current } : {})
		}
	}
	if (error instanceof FilesystemFileTooLargeError) {
		return {
			code: 'too_large',
			message: error.message,
			...(current ? { current } : {})
		}
	}
	if (error instanceof PathPolicyError) {
		const code =
			error.code === 'not_found'
				? 'not_found'
				: error.messageID === 'error.mutation.parent.not-folder' ||
					  error.messageID === 'error.mutation.path.not-directory'
					? 'not_a_directory'
					: 'invalid_path'
		return {
			code,
			message: error.messageID,
			...(current ? { current } : {})
		}
	}
	const code = nodeErrorCode(error)
	if (code === 'ENOENT') {
		return { code: 'not_found', message: 'error.mutation.entry.not-found' }
	}
	if (code === 'EEXIST') {
		return {
			code: 'already_exists',
			message: 'error.mutation.entry.already-exists'
		}
	}
	if (code === 'ENOTEMPTY') {
		return { code: 'not_empty', message: 'error.mutation.folder.not-empty' }
	}
	if (code === 'EISDIR') {
		return {
			code: 'not_a_file',
			message: 'The requested entry is not a file.'
		}
	}
	if (code === 'ENOTDIR') {
		return {
			code: 'not_a_directory',
			message: 'The requested entry is not a directory.'
		}
	}
	return {
		code: 'io_error',
		message: fallback,
		...(current ? { current } : {})
	}
}

function inferredMediaType(bundlePath: KnowledgeBundlePath): string | undefined {
	const extension = path.posix.extname(bundlePath).toLowerCase()
	if (extension === '.md' || extension === '.markdown') {
		return 'text/markdown'
	}
	if (extension === '.txt') {
		return 'text/plain'
	}
	if (extension === '.json') {
		return 'application/json'
	}
	if (extension === '.yaml' || extension === '.yml') {
		return 'application/yaml'
	}
	return undefined
}

function allowAnyPath(): boolean {
	return true
}

function shouldIgnorePath(root: string, candidate: string): boolean {
	const bundlePath = relativeBundlePath(root, candidate)
	if (bundlePath === null) {
		return true
	}
	if (!bundlePath) {
		return false
	}
	const segments = bundlePath.split('/')
	if (
		segments.some((segment) => {
			try {
				validateEntryName(segment)
				return false
			} catch (error) {
				if (error instanceof PathPolicyError) {
					return true
				}
				throw error
			}
		})
	) {
		return true
	}
	return (
		segments.some((segment) => {
			const normalized = segment.toLowerCase()
			return (
				normalized === '.git' || normalized === '.open-knowledge' || normalized === 'node_modules'
			)
		}) ||
		segments.some((segment) => {
			const normalized = segment.toLowerCase()
			return normalized.includes('.open-knowledge-') && normalized.endsWith('.tmp')
		})
	)
}

function watcherReady(watcher: FSWatcher): Promise<void> {
	return new Promise((resolve, reject) => {
		const ready = () => {
			watcher.off('error', failed)
			resolve()
		}
		const failed = (error: unknown) => {
			watcher.off('ready', ready)
			reject(error)
		}
		watcher.once('ready', ready)
		watcher.once('error', failed)
	})
}
