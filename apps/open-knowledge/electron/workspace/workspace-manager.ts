import { createHash } from 'node:crypto'
import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import type {
	EditableKnowledgeBundle,
	KnowledgeBundle,
	KnowledgeBundleEntry,
	KnowledgeBundleFileEntry,
	SubscribableKnowledgeBundle
} from '@open-knowledge/knowledge-bundle-api'
import {
	canonicalizeRoot,
	filesystemPathIdentity,
	FilesystemKnowledgeBundle,
	matchesFilesystemPathIdentity,
	PathPolicyError,
	type FilesystemKnowledgeBundleFileBytes
} from '@open-knowledge/knowledge-bundle-filesystem'
import { isMarkdownDocumentPath } from '@open-knowledge/knowledge-bundle'
import type {
	KnowledgeBundleMCPDocument,
	KnowledgeBundleMCPDocumentReaderInput,
	KnowledgeBundleMCPSearchInput,
	KnowledgeBundleMCPUnsupportedDocument
} from '@open-knowledge/knowledge-bundle-mcp'
import type {
	WorkspaceSelectorBrowseError,
	WorkspaceSelectorBrowseResult,
	WorkspaceSelectorSnapshot
} from '../../src/lib/workspace/selector-api'
import type {
	CreateKnowledgeBundleDirectoryResult,
	CreateKnowledgeBundleFileResult,
	DeleteKnowledgeBundleEntryResult,
	KnowledgeBundleFile,
	KnowledgeBundleInfo,
	KnowledgeBundleListing,
	KnowledgeBundlePath,
	MoveKnowledgeBundleEntryResult,
	OpenSystemPathInput,
	OpenWorkspaceInput,
	PatchKnowledgeBundleFileResult,
	RenderedDocument,
	SearchKnowledgeInput,
	KnowledgeSearchResult,
	Workspace,
	WorkspaceChange,
	WorkspaceCreateKnowledgeBundleDirectoryInput,
	WorkspaceCreateKnowledgeBundleFileInput,
	WorkspaceDeleteKnowledgeBundleEntryInput,
	WorkspaceInput,
	WorkspaceListKnowledgeBundleInput,
	WorkspaceMoveKnowledgeBundleEntryInput,
	WorkspacePatchKnowledgeBundleFileInput,
	WorkspaceReadKnowledgeBundleFileInput,
	WorkspaceReadRenderedDocumentInput,
	WorkspaceEntry,
	WorkspaceFileEntry,
	WorkspaceSnapshot,
	WorkspaceWriteKnowledgeBundleFileInput,
	WriteKnowledgeBundleFileResult
} from '../../src/lib/knowledge/api'
import { isAnydocPath } from '../../src/lib/knowledge/anydoc'
import { documentAccessForFile } from '../../src/lib/knowledge/document-access'
import { ApplicationStore } from '../settings/application-store'
import { RemoteAuthorizationStore } from '../settings/remote-authorization-store'
import { errorMessage, nodeErrorCode } from '../validation'
import { detectOpenKnowledgeRoots } from './workspace-format'
import { connectRemoteKnowledgeBundle, remoteKnowledgeBundleName } from './remote-knowledge-bundle'
import { normalizedSystemPath } from './system-path'
import { renderAnydocDocument } from './anydoc'
import { searchWorkspaceWithRipgrep, type RipgrepSearchOptions } from './ripgrep-search'

type WorkspaceChangeListener = (change: WorkspaceChange) => void
type WorkspaceReauthorized = (workspaceID: string) => void | Promise<void>
type SystemPathAuthorization = () => Promise<boolean>
type WorkspaceBackend = KnowledgeBundle & Partial<Pick<SubscribableKnowledgeBundle, 'subscribe'>>
type WorkspaceRegistrationStage = 'folder' | 'filesystem-root' | 'application-storage'
const REMOTE_MAXIMUM_DEPTH = 256
const REMOTE_MAXIMUM_ENTRIES = 10_000
const REMOTE_MAXIMUM_FILE_BYTES = 16 * 1_024 * 1_024
const REMOTE_MAXIMUM_INDEX_FILES = 32
const REMOTE_MAXIMUM_INDEX_BYTES = 256 * 1_024
const REMOTE_SNAPSHOT_TIMEOUT_MS = 30_000
const LOCAL_MAXIMUM_BINARY_FILE_BYTES = 128 * 1_024 * 1_024
const LOCAL_MAXIMUM_SEARCH_FILE_BYTES = 4 * 1_024 * 1_024
const MCP_MAXIMUM_SEARCH_FILE_BYTES = 1_024 * 1_024

type OpenedWorkspace = {
	summary: Workspace
	access: 'readonly' | 'editable'
	backend: WorkspaceBackend
	editableBackend?: EditableKnowledgeBundle
	subscribed: boolean
	validatedSnapshot?: WorkspaceSnapshot
	revealPath?: string
	ready: Promise<void>
	close(): Promise<void>
}

class WorkspaceRegistrationError extends Error {
	override readonly name = 'WorkspaceRegistrationError'

	constructor(
		readonly stage: WorkspaceRegistrationStage,
		cause: unknown
	) {
		super(
			stage === 'folder'
				? 'The selected workspace folder could not be inspected.'
				: stage === 'filesystem-root'
					? 'A filesystem root cannot be used as a workspace.'
					: 'The workspace could not be saved in the application data.',
			{ cause }
		)
	}
}

export class WorkspaceManager {
	private readonly store: ApplicationStore
	private readonly remoteAuthorizations: RemoteAuthorizationStore
	private readonly workspaces = new Map<string, OpenedWorkspace>()
	private readonly pendingRemoteWorkspaceIDs = new Set<string>()
	private readonly reauthorizedWorkspaces = new Set<string>()
	private readonly listeners = new Set<WorkspaceChangeListener>()
	private remoteOperationTail = Promise.resolve()
	private renderedDocumentTail = Promise.resolve()

	constructor(
		retainedWorkspaceIDs?: () => ReadonlySet<string>,
		private readonly workspaceReauthorized: WorkspaceReauthorized = () => undefined
	) {
		this.store = new ApplicationStore(
			path.join(app.getPath('userData'), 'workspaces.json'),
			retainedWorkspaceIDs
		)
		this.remoteAuthorizations = new RemoteAuthorizationStore(
			path.join(app.getPath('userData'), 'remote-credentials'),
			{
				isSecure: () =>
					safeStorage.isEncryptionAvailable() &&
					(process.platform !== 'linux' ||
						safeStorage.getSelectedStorageBackend() !== 'basic_text'),
				encrypt: (value) => safeStorage.encryptString(value),
				decrypt: (value) => safeStorage.decryptString(value)
			}
		)
	}

	async initialize(): Promise<void> {
		await this.store.load()
		await this.pruneRemoteAuthorizations()
		const developmentWorkspace = app.isPackaged ? undefined : process.env.OPEN_KNOWLEDGE_WORKSPACE
		if (developmentWorkspace) {
			await this.registerWorkspace(developmentWorkspace, true)
		}
	}

	activeWorkspace(): Workspace | null {
		return this.store.activeWorkspace()
	}

	selectorSnapshot(): WorkspaceSelectorSnapshot {
		return { recentWorkspaces: this.store.recentWorkspaces() }
	}

	async browseWorkspace(window: BrowserWindow): Promise<WorkspaceSelectorBrowseResult> {
		let selection
		try {
			selection = await dialog.showOpenDialog(window, {
				properties: ['openDirectory', 'createDirectory'],
				title: 'Open Markdown workspace',
				buttonLabel: 'Open workspace'
			})
		} catch (error) {
			console.error('The system folder picker could not be opened.', error)
			return browseFailure('picker-unavailable', error)
		}
		const selectedPath = selection.filePaths[0]
		if (selection.canceled || !selectedPath) {
			return { status: 'cancelled' }
		}
		try {
			return { status: 'selected', workspace: await this.registerWorkspace(selectedPath, false) }
		} catch (error) {
			console.error('The selected folder could not be added as a workspace.', error)
			return { status: 'failed', error: registrationFailure(error) }
		}
	}

	openWorkspace(input: OpenWorkspaceInput, activate = true): Promise<WorkspaceSnapshot> {
		const saved = this.store.workspace(input.workspaceID)
		return saved?.kind === 'remote'
			? this.runRemoteOperation(saved.id, () => this.openWorkspaceNow(input, activate, true))
			: this.openWorkspaceNow(input, activate, false)
	}

	private async openWorkspaceNow(
		input: OpenWorkspaceInput,
		activate: boolean,
		remoteOperationActive: boolean
	): Promise<WorkspaceSnapshot> {
		const workspace = await this.ensureWorkspace(input.workspaceID, false, remoteOperationActive)
		const snapshot = workspace.validatedSnapshot ?? (await workspaceSnapshot(workspace))
		await this.store.rememberWorkspace(
			workspace.summary,
			activate,
			workspace.summary.kind === 'local'
				? (this.store.workspaceRootIdentity(workspace.summary.id) ?? undefined)
				: undefined
		)
		workspace.validatedSnapshot = undefined
		return snapshot
	}

	connectRemoteWorkspace(
		candidate: string,
		authorization: string | null,
		activate = false
	): Promise<Workspace> {
		this.remoteAuthorizations.assertCanPersist(authorization)
		return this.queueRemoteOperation(() =>
			this.connectRemoteWorkspaceSerial(candidate, authorization, activate)
		)
	}

	private async connectRemoteWorkspaceSerial(
		candidate: string,
		normalizedAuthorization: string | null,
		activate: boolean
	): Promise<Workspace> {
		const connection = await connectRemoteKnowledgeBundle(candidate, normalizedAuthorization)
		const summary: Workspace = {
			kind: 'remote',
			id: remoteWorkspaceID(connection.uri),
			name: remoteKnowledgeBundleName(connection.uri),
			uri: connection.uri,
			lastOpenedAt: new Date().toISOString()
		}
		this.pendingRemoteWorkspaceIDs.add(summary.id)
		const previous = this.workspaces.get(summary.id)
		const workspace = this.openedWorkspace(
			summary,
			connection.access,
			connection.bundle,
			connection.access === 'editable' ? connection.bundle : undefined
		)
		try {
			await workspace.ready
			workspace.validatedSnapshot = await workspaceSnapshot(workspace)
			await this.remoteAuthorizations.reserve(summary.id, normalizedAuthorization)
			await this.store.rememberWorkspace(summary, activate)
			await this.remoteAuthorizations.set(summary.id, normalizedAuthorization)
			await this.pruneRemoteAuthorizations().catch((error: unknown) => {
				console.error('Stale remote credentials could not be pruned.', error)
			})
			this.workspaces.set(summary.id, workspace)
			await previous?.close().catch(() => undefined)
			if (previous) {
				this.emit({ workspaceID: summary.id, kind: 'changed', path: '/' })
			}
			return summary
		} catch (error) {
			await workspace.close().catch(() => undefined)
			throw error
		} finally {
			this.pendingRemoteWorkspaceIDs.delete(summary.id)
		}
	}

	private async ensureWorkspace(
		id: string,
		activate: boolean,
		remoteOperationActive = false
	): Promise<OpenedWorkspace> {
		const saved = this.store.workspace(id)
		if (!saved) {
			throw new Error('The workspace is not in the recent workspace list.')
		}
		if (saved.kind === 'remote') {
			return remoteOperationActive
				? this.ensureRemoteWorkspace(saved)
				: this.runRemoteOperation(saved.id, () => this.ensureRemoteWorkspace(saved))
		}
		const canonicalRoot = await canonicalizeRoot(saved.rootPath)
		if (workspaceID(canonicalRoot) !== saved.id) {
			throw new Error('The workspace path no longer identifies the same root.')
		}
		const currentRootStats = await filesystemStats(canonicalRoot)
		const expectedRootIdentity = this.store.workspaceRootIdentity(saved.id)
		if (!expectedRootIdentity) {
			throw new Error('The workspace root must be selected again before it can be opened.')
		}
		if (!matchesFilesystemPathIdentity(expectedRootIdentity, currentRootStats)) {
			throw new Error('The workspace root changed on disk and must be selected again.')
		}
		const currentRootIdentity = expectedRootIdentity

		const summary = { ...saved, rootPath: canonicalRoot, lastOpenedAt: new Date().toISOString() }
		await this.store.rememberWorkspace(summary, activate, currentRootIdentity)
		let workspace = this.workspaces.get(summary.id)
		if (!workspace) {
			const backend = new FilesystemKnowledgeBundle(canonicalRoot, {
				expectedRootIdentity: currentRootIdentity
			})
			workspace = this.openedWorkspace(summary, 'editable', backend, backend, canonicalRoot, () =>
				backend.close()
			)
			this.workspaces.set(summary.id, workspace)
		} else {
			workspace.summary = summary
		}
		try {
			await workspace.ready
		} catch (error) {
			if (this.workspaces.get(summary.id) === workspace) {
				this.workspaces.delete(summary.id)
				await workspace.close().catch(() => undefined)
			}
			throw error
		}
		return workspace
	}

	private async ensureRemoteWorkspace(saved: Workspace & { kind: 'remote' }) {
		if (remoteWorkspaceID(saved.uri) !== saved.id) {
			throw new Error('The remote URI no longer identifies the same workspace.')
		}
		const summary = { ...saved, lastOpenedAt: new Date().toISOString() }
		const previous = this.workspaces.get(summary.id)
		if (previous?.validatedSnapshot) {
			previous.summary = summary
			previous.validatedSnapshot = { ...previous.validatedSnapshot, workspace: summary }
			return previous
		}
		const authorization = await this.remoteAuthorizations.get(summary.id)
		const connection = await connectRemoteKnowledgeBundle(summary.uri, authorization)
		const workspace = this.openedWorkspace(
			summary,
			connection.access,
			connection.bundle,
			connection.access === 'editable' ? connection.bundle : undefined
		)
		try {
			await workspace.ready
			workspace.validatedSnapshot = await workspaceSnapshot(workspace)
			this.workspaces.set(summary.id, workspace)
			await previous?.close().catch(() => undefined)
			if (previous) {
				this.emit({ workspaceID: summary.id, kind: 'changed', path: '/' })
			}
		} catch (error) {
			await workspace.close().catch(() => undefined)
			throw error
		}
		return workspace
	}

	async refreshWorkspace(input: WorkspaceInput): Promise<WorkspaceSnapshot> {
		const workspace = await this.workspace(input.workspaceID)
		return workspaceSnapshot(workspace)
	}

	async getInfo(input: WorkspaceInput): Promise<KnowledgeBundleInfo> {
		return (await this.workspace(input.workspaceID)).backend.getInfo()
	}

	async list(input: WorkspaceListKnowledgeBundleInput): Promise<KnowledgeBundleListing | null> {
		const { workspaceID, ...request } = input
		const workspace = await this.workspace(workspaceID)
		if (workspace.summary.kind === 'remote') {
			if (request.depth > REMOTE_MAXIMUM_DEPTH) {
				throw new RangeError(`Remote listings are limited to depth ${REMOTE_MAXIMUM_DEPTH}.`)
			}
			request.limit = Math.min(request.limit ?? REMOTE_MAXIMUM_ENTRIES, REMOTE_MAXIMUM_ENTRIES)
		}
		const listing = await workspace.backend.list(request)
		return listing
			? {
					...listing,
					entries: listing.entries.map((entry) => workspaceEntry(workspace, entry))
				}
			: null
	}

	async search(input: SearchKnowledgeInput, signal?: AbortSignal): Promise<KnowledgeSearchResult> {
		const workspace = await this.workspace(input.workspaceID)
		if (
			workspace.summary.kind !== 'local' ||
			!(workspace.backend instanceof FilesystemKnowledgeBundle)
		) {
			throw new Error('Ripgrep search is only available for local workspaces.')
		}
		return this.searchLocalWorkspace(
			workspace.backend,
			{
				query: input.query,
				caseMode: 'smart',
				fixedStrings: true,
				wholeWord: false,
				searchPath: '/',
				excludeGlobs: [],
				limit: input.limit,
				maximumFileBytes: LOCAL_MAXIMUM_SEARCH_FILE_BYTES
			},
			signal,
			isMarkdownDocumentPath
		)
	}

	async readFile(
		input: WorkspaceReadKnowledgeBundleFileInput
	): Promise<KnowledgeBundleFile | null> {
		const { workspaceID, ...request } = input
		const workspace = await this.workspace(workspaceID)
		if (workspace.summary.kind === 'remote') {
			request.maximumBytes = Math.min(
				request.maximumBytes ?? REMOTE_MAXIMUM_FILE_BYTES,
				REMOTE_MAXIMUM_FILE_BYTES
			)
		}
		const file =
			workspace.backend instanceof FilesystemKnowledgeBundle
				? await workspace.backend.readFile(request, isMarkdownDocumentPath)
				: await workspace.backend.readFile(request)
		if (file && workspace.summary.kind === 'local' && !isMarkdownDocumentPath(file.path)) {
			throw new Error('The requested file is no longer a Markdown document.')
		}
		return file
			? {
					...file,
					documentAccess: documentAccessForFile(file, workspace.summary.kind, workspace.access)
				}
			: null
	}

	private async readLocalFileBytes(
		input: WorkspaceReadKnowledgeBundleFileInput
	): Promise<FilesystemKnowledgeBundleFileBytes | null> {
		const { workspaceID, ...request } = input
		const workspace = await this.workspace(workspaceID)
		if (
			workspace.summary.kind !== 'local' ||
			!(workspace.backend instanceof FilesystemKnowledgeBundle)
		) {
			throw new Error('Binary document reads are only available for local workspaces.')
		}
		request.maximumBytes = Math.min(
			request.maximumBytes ?? LOCAL_MAXIMUM_BINARY_FILE_BYTES,
			LOCAL_MAXIMUM_BINARY_FILE_BYTES
		)
		const file = await workspace.backend.readFileBytes(request, isAnydocPath)
		return file
	}

	async readRenderedDocument(
		input: WorkspaceReadRenderedDocumentInput
	): Promise<RenderedDocument | null> {
		const result = this.renderedDocumentTail.then(() => this.readRenderedDocumentNow(input))
		this.renderedDocumentTail = result.then(
			() => undefined,
			() => undefined
		)
		return result
	}

	private async readRenderedDocumentNow(
		input: WorkspaceReadRenderedDocumentInput
	): Promise<RenderedDocument | null> {
		const file = await this.readLocalFileBytes(input)
		if (!file) {
			return null
		}
		const { bytes, ...entry } = file
		return {
			...entry,
			documentAccess: 'readonly',
			markdown: await renderAnydocDocument(entry.path, bytes)
		}
	}

	async resolveDocument(
		input: WorkspaceReadKnowledgeBundleFileInput
	): Promise<KnowledgeBundlePath | null> {
		const { workspaceID, ...request } = input
		const workspace = await this.workspace(workspaceID)
		if (
			workspace.summary.kind === 'local' &&
			workspace.backend instanceof FilesystemKnowledgeBundle
		) {
			return workspace.backend.resolveEntryPath(request)
		}
		const listing = await this.list({
			workspaceID,
			path: '/',
			depth: REMOTE_MAXIMUM_DEPTH,
			limit: REMOTE_MAXIMUM_ENTRIES
		})
		if (!listing || listing.truncated) {
			return null
		}
		const entry = request.id
			? listing.entries.find((candidate) => candidate.id === request.id)
			: listing.entries.find((candidate) => candidate.path === request.path)
		return entry?.kind === 'file' ? entry.path : null
	}

	mcpBundle(workspaceID: string): EditableKnowledgeBundle {
		const authorize = async () => {
			await this.mcpWorkspace(workspaceID)
		}
		return {
			getInfo: async () => {
				const workspace = await this.mcpWorkspace(workspaceID)
				if (!workspace.editableBackend) {
					throw new Error('The MCP workspace is read-only.')
				}
				return workspace.editableBackend.getInfo()
			},
			list: async (input) => {
				await authorize()
				return this.list({ workspaceID, ...input })
			},
			readFile: async (input) => {
				await authorize()
				return this.readFile({ workspaceID, ...input })
			},
			createDirectory: async (input) => {
				await authorize()
				return this.createDirectory({ ...input, workspaceID })
			},
			createFile: async (input) => {
				await authorize()
				return this.createFile({ ...input, workspaceID })
			},
			writeFile: async (input) => {
				await authorize()
				return this.writeFile({ workspaceID, ...input })
			},
			patchFile: async (input) => {
				await authorize()
				return this.patchFile({ workspaceID, ...input })
			},
			moveEntry: async () => {
				await authorize()
				return mcpUnsupportedMutation('MCP does not support moving entries.')
			},
			deleteEntry: async () => {
				await authorize()
				return mcpUnsupportedMutation('MCP does not support deleting entries.')
			}
		}
	}

	async mcpReadDocument(
		workspaceID: string,
		input: KnowledgeBundleMCPDocumentReaderInput,
		signal: AbortSignal
	): Promise<KnowledgeBundleMCPDocument | KnowledgeBundleMCPUnsupportedDocument | null> {
		signal.throwIfAborted()
		const workspace = await this.mcpWorkspace(workspaceID)
		if (!(workspace.backend instanceof FilesystemKnowledgeBundle)) {
			throw new Error('MCP document reads are only available for local workspaces.')
		}
		const resolvedPath = await workspace.backend.resolveEntryPath(input, signal)
		if (!resolvedPath) {
			return null
		}
		if (isAnydocPath(resolvedPath)) {
			return this.convertMCPDocument(workspace.backend, input, signal)
		}

		if (!isMarkdownDocumentPath(resolvedPath)) {
			const file = await workspace.backend.resolveFileMetadata(
				input,
				LOCAL_MAXIMUM_BINARY_FILE_BYTES,
				signal
			)
			if (!file) {
				return null
			}
			if (isAnydocPath(file.path)) {
				return this.convertMCPDocument(workspace.backend, input, signal)
			}
			if (isMarkdownDocumentPath(file.path)) {
				return this.readMCPMarkdown(workspaceID, workspace, input, signal)
			}
			return {
				status: 'not_supported',
				file: { ...file, documentAccess: 'not_supported' }
			}
		}
		return this.readMCPMarkdown(workspaceID, workspace, input, signal)
	}

	async mcpSearch(
		workspaceID: string,
		input: KnowledgeBundleMCPSearchInput,
		signal: AbortSignal
	): Promise<KnowledgeSearchResult> {
		signal.throwIfAborted()
		const workspace = await this.mcpWorkspace(workspaceID)
		if (!(workspace.backend instanceof FilesystemKnowledgeBundle)) {
			throw new Error('MCP search is only available for local workspaces.')
		}
		return this.searchLocalWorkspace(
			workspace.backend,
			{
				query: input.query,
				caseMode: input.caseMode,
				fixedStrings: input.fixedStrings,
				wholeWord: input.wholeWord,
				searchPath: input.path as KnowledgeBundlePath,
				excludeGlobs: input.excludeGlobs,
				limit: input.limit,
				maximumFileBytes: MCP_MAXIMUM_SEARCH_FILE_BYTES
			},
			signal,
			isMarkdownDocumentPath
		)
	}

	private async searchLocalWorkspace(
		backend: FilesystemKnowledgeBundle,
		options: RipgrepSearchOptions,
		signal?: AbortSignal,
		pathAllowed: (path: KnowledgeBundlePath) => boolean = () => true
	): Promise<KnowledgeSearchResult> {
		await backend.getInfo()
		const rootStats = await filesystemStats(backend.rootPath)
		const result = await searchWorkspaceWithRipgrep(backend.rootPath, options, signal)
		const validity = new Map<KnowledgeBundlePath, boolean>()
		const matches = []
		for (const match of result.matches) {
			signal?.throwIfAborted()
			let valid = validity.get(match.path)
			if (valid === undefined) {
				valid =
					pathAllowed(match.path) &&
					(await isSafeSearchResult(backend.rootPath, rootStats.dev, match.path))
				validity.set(match.path, valid)
			}
			if (valid) {
				matches.push(match)
			}
		}
		await backend.getInfo()
		return {
			matches,
			truncated: result.truncated && matches.length === result.matches.length
		}
	}

	private async readMCPMarkdown(
		workspaceID: string,
		workspace: OpenedWorkspace,
		input: KnowledgeBundleMCPDocumentReaderInput,
		signal: AbortSignal
	): Promise<KnowledgeBundleMCPDocument | null> {
		const source = await this.readFile({
			workspaceID,
			id: input.id,
			path: input.path,
			maximumBytes: input.maximumMarkdownBytes
		})
		signal.throwIfAborted()
		if (!source) {
			return null
		}
		const { content: markdown, ...sourceFile } = source
		const file = workspaceFileEntry(workspace, sourceFile)
		if (file.documentAccess === 'not_supported') {
			throw new Error('The Markdown source is not available as a knowledge document.')
		}
		return {
			status: 'readable',
			file: { ...file, documentAccess: file.documentAccess },
			markdown,
			representation: 'source_markdown'
		}
	}

	private async convertMCPDocument(
		backend: FilesystemKnowledgeBundle,
		input: KnowledgeBundleMCPDocumentReaderInput,
		signal: AbortSignal
	): Promise<KnowledgeBundleMCPDocument | null> {
		const conversion = this.renderedDocumentTail.then(async () => {
			signal.throwIfAborted()
			const source = await backend.readFileBytes(
				{ id: input.id, path: input.path, maximumBytes: LOCAL_MAXIMUM_BINARY_FILE_BYTES },
				isAnydocPath,
				signal
			)
			signal.throwIfAborted()
			if (!source) {
				return null
			}
			const { bytes, ...sourceFile } = source
			const markdown = await renderAnydocDocument(
				sourceFile.path,
				bytes,
				signal,
				input.maximumMarkdownBytes
			)
			signal.throwIfAborted()
			return {
				status: 'readable' as const,
				file: { ...sourceFile, documentAccess: 'readonly' as const },
				markdown,
				representation: 'converted_markdown' as const
			}
		})
		this.renderedDocumentTail = conversion.then(
			() => undefined,
			() => undefined
		)
		return abortableWait(conversion, signal)
	}

	async createDirectory(
		input: WorkspaceCreateKnowledgeBundleDirectoryInput
	): Promise<CreateKnowledgeBundleDirectoryResult> {
		const { workspaceID, ...request } = input
		const { workspace, bundle } = await this.editableWorkspace(workspaceID)
		const result = await bundle.createDirectory(request)
		if (result.ok && !workspace.subscribed) {
			this.emit({
				workspaceID,
				kind: 'created',
				path: result.value.directory.path,
				id: result.value.directory.id
			})
		}
		return result
	}

	async createFile(
		input: WorkspaceCreateKnowledgeBundleFileInput
	): Promise<CreateKnowledgeBundleFileResult> {
		const { workspaceID, ...request } = input
		const { workspace, bundle } = await this.editableWorkspace(workspaceID)
		if (workspace.summary.kind === 'local' && !isMarkdownDocumentPath(input.path)) {
			throw new Error('Only Markdown documents can be created by the editor.')
		}
		const result = await bundle.createFile(request)
		if (result.ok && !workspace.subscribed) {
			this.emit({
				workspaceID,
				kind: 'created',
				path: result.value.file.path,
				id: result.value.file.id
			})
		}
		return result
	}

	async writeFile(
		input: WorkspaceWriteKnowledgeBundleFileInput
	): Promise<WriteKnowledgeBundleFileResult> {
		const { workspaceID, ...request } = input
		const { workspace, bundle } = await this.editableWorkspace(workspaceID)
		let result: WriteKnowledgeBundleFileResult
		if (workspace.backend instanceof FilesystemKnowledgeBundle) {
			result = await workspace.backend.writeFile(request, isMarkdownDocumentPath)
		} else {
			result = await bundle.writeFile(request)
		}
		if (result.ok && result.value.status === 'updated' && !workspace.subscribed) {
			this.emit({
				workspaceID,
				kind: 'changed',
				path: result.value.file.path,
				id: result.value.file.id
			})
		}
		return result
	}

	async patchFile(
		input: WorkspacePatchKnowledgeBundleFileInput
	): Promise<PatchKnowledgeBundleFileResult> {
		const { workspaceID, ...request } = input
		const { workspace, bundle } = await this.editableWorkspace(workspaceID)
		let result: PatchKnowledgeBundleFileResult
		if (workspace.backend instanceof FilesystemKnowledgeBundle) {
			result = await workspace.backend.patchFile(request, isMarkdownDocumentPath)
		} else {
			result = await bundle.patchFile(request)
		}
		if (result.ok && result.value.status === 'patched' && !workspace.subscribed) {
			this.emit({
				workspaceID,
				kind: 'changed',
				path: result.value.file.path,
				id: result.value.file.id
			})
		}
		return result
	}

	async moveEntry(
		input: WorkspaceMoveKnowledgeBundleEntryInput
	): Promise<MoveKnowledgeBundleEntryResult> {
		const { workspaceID, ...request } = input
		const { workspace, bundle } = await this.editableWorkspace(workspaceID)
		const result = await bundle.moveEntry(request)
		if (result.ok && result.value.status === 'moved' && !workspace.subscribed) {
			this.emit({
				workspaceID,
				kind: 'changed',
				path: result.value.entry.path,
				id: result.value.entry.id
			})
		}
		return result
	}

	async deleteEntry(
		input: WorkspaceDeleteKnowledgeBundleEntryInput
	): Promise<DeleteKnowledgeBundleEntryResult> {
		const { workspaceID, ...request } = input
		const { workspace, bundle } = await this.editableWorkspace(workspaceID)
		const result = await bundle.deleteEntry(request)
		if (result.ok && !workspace.subscribed) {
			this.emit({
				workspaceID,
				kind: 'removed',
				path: result.value.entry.path,
				id: result.value.entry.id
			})
		}
		return result
	}

	async openSystemPath(
		input: OpenSystemPathInput,
		authorize: SystemPathAuthorization
	): Promise<void> {
		await this.workspace(input.workspaceID)
		const saved = this.store.workspace(input.workspaceID)
		const expectedRootIdentity = this.store.workspaceRootIdentity(input.workspaceID)
		if (
			!saved ||
			saved.kind !== 'local' ||
			!expectedRootIdentity ||
			!matchesFilesystemPathIdentity(expectedRootIdentity, await filesystemStats(saved.rootPath))
		) {
			throw new Error('The workspace root changed on disk.')
		}
		const normalizedPath = normalizedSystemPath(input.path)
		if (!(await authorize())) {
			throw new Error('System path resolution is disabled for this project.')
		}
		const message = await shell.openPath(normalizedPath)
		if (message) {
			throw new Error(message)
		}
	}

	async revealWorkspace(input: WorkspaceInput): Promise<void> {
		const workspace = await this.workspace(input.workspaceID)
		if (!workspace.revealPath) {
			throw new Error('This workspace does not have a local path to reveal.')
		}
		const message = await shell.openPath(workspace.revealPath)
		if (message) {
			throw new Error(message)
		}
	}

	mcpWorkspaceLabel(workspaceID: string): string | null {
		return this.store.workspace(workspaceID)?.name ?? null
	}

	mcpWorkspaceIDs(): string[] {
		return this.store
			.recentWorkspaces()
			.filter((workspace) => workspace.kind === 'local')
			.map(({ id }) => id)
	}

	consumeWorkspaceReauthorization(workspaceID: string): boolean {
		const reauthorized = this.reauthorizedWorkspaces.has(workspaceID)
		this.reauthorizedWorkspaces.delete(workspaceID)
		return reauthorized
	}

	subscribe(listener: WorkspaceChangeListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	async close(): Promise<void> {
		await Promise.all([...this.workspaces.values()].map((workspace) => workspace.close()))
		this.workspaces.clear()
	}

	workspaceRoot(workspaceID: string): string | null {
		const workspace = this.store.workspace(workspaceID)
		return workspace?.kind === 'local' ? workspace.rootPath : null
	}

	workspaceRootIdentity(workspaceID: string): string | null {
		return this.store.workspaceRootIdentity(workspaceID)
	}

	private async registerWorkspace(candidate: string, activate: boolean): Promise<Workspace> {
		let rootPath: string
		let rootIdentity: string
		try {
			rootPath = await canonicalizeRoot(candidate)
			rootIdentity = await filesystemIdentity(rootPath)
			if (rootPath !== path.parse(rootPath).root) {
				const directory = await opendir(rootPath)
				await directory.close()
			}
		} catch (error) {
			throw new WorkspaceRegistrationError('folder', error)
		}
		if (rootPath === path.parse(rootPath).root) {
			throw new WorkspaceRegistrationError('filesystem-root', null)
		}
		const workspace: Workspace = {
			kind: 'local',
			id: workspaceID(rootPath),
			name: path.basename(rootPath),
			rootPath,
			lastOpenedAt: new Date().toISOString()
		}
		let reauthorized: boolean
		try {
			const previousWorkspace = this.store.workspace(workspace.id)
			const previousIdentity = this.store.workspaceRootIdentity(workspace.id)
			const opened = this.workspaces.get(workspace.id)
			const requiresReauthorization =
				previousWorkspace !== null && previousIdentity !== rootIdentity
			reauthorized = opened !== undefined && requiresReauthorization
			if (requiresReauthorization) {
				if (opened) {
					this.workspaces.delete(workspace.id)
					await opened.close()
				}
				await this.workspaceReauthorized(workspace.id)
			}
			await this.store.rememberWorkspace(workspace, activate, rootIdentity)
			await this.pruneRemoteAuthorizations()
		} catch (error) {
			throw new WorkspaceRegistrationError('application-storage', error)
		}
		if (reauthorized) {
			this.reauthorizedWorkspaces.add(workspace.id)
		}
		return workspace
	}

	private async workspace(id: string): Promise<OpenedWorkspace> {
		const existing = this.workspaces.get(id)
		if (existing) {
			return existing
		}
		return this.ensureWorkspace(id, false)
	}

	private async editableWorkspace(id: string): Promise<{
		workspace: OpenedWorkspace
		bundle: EditableKnowledgeBundle
	}> {
		const workspace = await this.workspace(id)
		if (!workspace.editableBackend) {
			throw new Error('This knowledge bundle is read-only.')
		}
		return { workspace, bundle: workspace.editableBackend }
	}

	private async mcpWorkspace(id: string): Promise<OpenedWorkspace> {
		const summary = this.store.workspace(id)
		if (summary?.kind !== 'local' || !this.store.workspaceRootIdentity(id)) {
			throw new Error('The MCP workspace must be selected again before it can be shared.')
		}
		return this.workspace(id)
	}

	private openedWorkspace(
		summary: Workspace,
		access: OpenedWorkspace['access'],
		backend: WorkspaceBackend,
		editableBackend?: EditableKnowledgeBundle,
		revealPath?: string,
		closeBackend: () => Promise<void> = async () => undefined
	): OpenedWorkspace {
		const subscribed = backend.subscribe?.((change) =>
			this.emit({ workspaceID: summary.id, ...change })
		)
		return {
			summary,
			access,
			backend,
			...(editableBackend ? { editableBackend } : {}),
			subscribed: subscribed !== undefined,
			...(revealPath ? { revealPath } : {}),
			ready: subscribed?.then(() => undefined) ?? Promise.resolve(),
			close: async () => {
				const subscription = await subscribed?.catch(() => undefined)
				await subscription?.close()
				await closeBackend()
			}
		}
	}

	private emit(change: WorkspaceChange): void {
		for (const listener of this.listeners) {
			try {
				listener(change)
			} catch (error) {
				console.error('A workspace listener failed.', error)
			}
		}
	}

	private async pruneRemoteAuthorizations(): Promise<void> {
		await this.remoteAuthorizations.prune(
			new Set([
				...this.pendingRemoteWorkspaceIDs,
				...this.store
					.recentWorkspaces()
					.filter((workspace) => workspace.kind === 'remote')
					.map((workspace) => workspace.id)
			])
		)
	}

	private queueRemoteOperation<Value>(operation: () => Promise<Value>): Promise<Value> {
		const result = this.remoteOperationTail.then(operation)
		this.remoteOperationTail = result.then(
			() => undefined,
			() => undefined
		)
		return result
	}

	private runRemoteOperation<Value>(
		workspaceID: string,
		operation: () => Promise<Value>
	): Promise<Value> {
		return this.queueRemoteOperation(async () => {
			this.pendingRemoteWorkspaceIDs.add(workspaceID)
			try {
				return await operation()
			} finally {
				this.pendingRemoteWorkspaceIDs.delete(workspaceID)
			}
		})
	}
}

function workspaceID(rootPath: string): string {
	return createHash('sha256').update(rootPath).digest('hex')
}

function remoteWorkspaceID(uri: string): string {
	return createHash('sha256').update(`okb\0${uri}`).digest('hex')
}

function registrationFailure(error: unknown): WorkspaceSelectorBrowseError {
	if (!(error instanceof WorkspaceRegistrationError)) {
		return browseError('unexpected', error)
	}
	const cause = error.cause
	const code = nodeErrorCode(cause)
	if (error.stage === 'filesystem-root') {
		return browseError('folder-root-not-supported', cause)
	}
	if (error.stage === 'application-storage') {
		return browseError(
			code === 'ENOSPC' || code === 'EDQUOT' ? 'storage-full' : 'storage-unavailable',
			cause
		)
	}
	if (cause instanceof PathPolicyError && cause.code === 'invalid_path') {
		return browseError('folder-not-directory', cause)
	}
	if (code === 'ENOENT') {
		return browseError('folder-not-found', cause)
	}
	if (code === 'EACCES' || code === 'EPERM') {
		return browseError('folder-permission-denied', cause)
	}
	if (code === 'ENOTDIR') {
		return browseError('folder-not-directory', cause)
	}
	return browseError('folder-unavailable', cause)
}

function browseFailure(
	code: WorkspaceSelectorBrowseError['code'],
	error: unknown
): WorkspaceSelectorBrowseResult {
	return { status: 'failed', error: browseError(code, error) }
}

function browseError(
	code: WorkspaceSelectorBrowseError['code'],
	error: unknown
): WorkspaceSelectorBrowseError {
	const detail = errorDetail(error)
	return { code, ...(detail ? { detail } : {}) }
}

function errorDetail(error: unknown): string | null {
	const message = errorMessage(error) ?? ''
	const detail = message.replace(/\s+/g, ' ').trim()
	return detail && !detail.startsWith('error.') ? detail.slice(0, 512) : null
}

async function filesystemIdentity(rootPath: string): Promise<string> {
	return filesystemPathIdentity(await filesystemStats(rootPath))
}

async function isSafeSearchResult(
	rootPath: string,
	rootDevice: bigint,
	bundlePath: KnowledgeBundlePath
): Promise<boolean> {
	try {
		const stats = await lstat(path.join(rootPath, ...bundlePath.slice(1).split('/')), {
			bigint: true
		})
		return (
			stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1n && stats.dev === rootDevice
		)
	} catch {
		return false
	}
}

async function filesystemStats(rootPath: string) {
	const stats = await lstat(rootPath, { bigint: true })
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		throw new Error('The workspace root is unavailable.')
	}
	return stats
}

async function workspaceSnapshot(workspace: OpenedWorkspace): Promise<WorkspaceSnapshot> {
	const remote = workspace.summary.kind === 'remote'
	const listing = await workspace.backend.list({
		path: '/',
		depth: remote ? REMOTE_MAXIMUM_DEPTH : Number.MAX_SAFE_INTEGER,
		...(remote ? { limit: REMOTE_MAXIMUM_ENTRIES } : {})
	})
	if (!listing) {
		throw new Error('The workspace root is unavailable.')
	}
	if (remote && listing.truncated) {
		throw new Error(`Remote workspaces are limited to ${REMOTE_MAXIMUM_ENTRIES} entries.`)
	}
	const entries = listing.entries.map((entry) => workspaceEntry(workspace, entry))
	const indexFileCount = entries.filter(
		(entry) => entry.kind === 'file' && entry.name === 'index.md'
	).length
	if (remote && indexFileCount > REMOTE_MAXIMUM_INDEX_FILES) {
		throw new Error(`Remote workspaces are limited to ${REMOTE_MAXIMUM_INDEX_FILES} index files.`)
	}
	const snapshotSignal = remote ? AbortSignal.timeout(REMOTE_SNAPSHOT_TIMEOUT_MS) : undefined
	const openKnowledgeRoots = await detectOpenKnowledgeRoots(
		entries.filter(
			(entry) => entry.kind === 'directory' || entry.documentAccess !== 'not_supported'
		),
		(path) =>
			Promise.resolve().then(() => {
				snapshotSignal?.throwIfAborted()
				return workspace.backend.readFile({
					path,
					...(remote ? { maximumBytes: REMOTE_MAXIMUM_INDEX_BYTES } : {})
				})
			})
	)
	snapshotSignal?.throwIfAborted()
	return {
		workspace: workspace.summary,
		access: workspace.access,
		format: openKnowledgeRoots.includes('/') ? 'open-knowledge' : 'markdown',
		openKnowledgeRoots,
		entries
	}
}

function workspaceEntry(workspace: OpenedWorkspace, entry: KnowledgeBundleEntry): WorkspaceEntry {
	return entry.kind === 'directory' ? entry : workspaceFileEntry(workspace, entry)
}

function workspaceFileEntry(
	workspace: OpenedWorkspace,
	entry: KnowledgeBundleFileEntry
): WorkspaceFileEntry {
	return {
		...entry,
		documentAccess: documentAccessForFile(entry, workspace.summary.kind, workspace.access)
	}
}

function mcpUnsupportedMutation(message: string) {
	return { ok: false as const, error: { code: 'unsupported' as const, message } }
}

function abortableWait<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
	if (signal.aborted) {
		return Promise.reject(signal.reason)
	}
	return new Promise((resolve, reject) => {
		const aborted = () => reject(signal.reason)
		signal.addEventListener('abort', aborted, { once: true })
		void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
	})
}
