import type { OpenKnowledgeAPI } from '#lib/desktop/api.js'
import type {
	KnowledgeBundleEntry,
	KnowledgeBundleFileAccess,
	KnowledgeBundlePath,
	KnowledgeSearchResult,
	Workspace,
	WorkspaceChange,
	WorkspaceEntry,
	WorkspaceFile,
	WorkspaceFileEntry,
	WorkspaceFormat,
	WorkspaceSnapshot
} from '#lib/knowledge/api.js'
import {
	hasSameAnydocExtension,
	isAnydocPath,
	markdownPathForAnydoc
} from '#lib/knowledge/anydoc.js'
import { mcpMessageIDFromError, type MCPAccess, type MCPWorkspaceStatus } from '#lib/mcp/api.js'
import {
	defaultApplicationSettings,
	type ApplicationSettings,
	type UpdateApplicationSettingsInput
} from '#lib/settings/api.js'
import type { DocumentWindowPresentation, TabTransferCommitted } from '#lib/window/api.js'
import { isMarkdownDocumentPath } from '@open-knowledge/knowledge-bundle'
import {
	childKnowledgeBundlePath,
	isPathInOpenKnowledgeRoots,
	newMarkdownDocumentContent,
	normalizeMarkdownFileName
} from '#lib/knowledge/open-knowledge.js'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { DocumentDraft, type SaveState } from './document-draft.svelte'
import { currentDocumentEntry } from './document-entry'
import { mutationMessageID, type WorkspaceMessageID } from './workspace-message.translation'

type DocumentRouteListener = (
	path: KnowledgeBundlePath | null,
	replace: boolean
) => void | Promise<void>
export type EditorMode = 'rich' | 'source'
const ANYDOC_MAXIMUM_FILE_BYTES = 128 * 1_024 * 1_024

type WorkspaceSessionOptions = {
	singleDocument?: boolean
}

export class WorkspaceDocumentTab {
	requestedPath = $state<KnowledgeBundlePath>('/')
	requestedID = $state<WorkspaceFileEntry['id'] | undefined>()
	loading = $state(true)
	editorMode = $state<EditorMode>('rich')
	renderedDocument = $state<WorkspaceFileEntry | null>(null)
	unsupportedDocument = $state<WorkspaceFileEntry | null>(null)
	renderedMarkdown = $state<string | null>(null)
	request = 0

	constructor(
		readonly id: string,
		path: KnowledgeBundlePath,
		readonly draft: DocumentDraft
	) {
		this.requestedPath = path
	}

	get document(): WorkspaceFileEntry | null {
		return this.unsupportedDocument ?? this.renderedDocument ?? this.draft.document
	}

	get path(): KnowledgeBundlePath {
		return this.document?.path ?? this.requestedPath
	}

	get saveState(): SaveState {
		return this.draft.saveState
	}

	get rendered(): boolean {
		return this.renderedDocument !== null
	}

	get unsupported(): boolean {
		return this.unsupportedDocument !== null
	}

	get content(): string {
		return this.renderedMarkdown ?? this.draft.content
	}

	openMarkdown(document: WorkspaceFile): void {
		this.renderedDocument = null
		this.unsupportedDocument = null
		this.renderedMarkdown = null
		this.draft.open(document)
	}

	openRendered(document: WorkspaceFileEntry, markdown: string): void {
		this.draft.clear()
		this.renderedDocument = document
		this.unsupportedDocument = null
		this.renderedMarkdown = markdown
		this.editorMode = 'rich'
	}

	openUnsupported(document: WorkspaceFileEntry): void {
		this.draft.clear()
		this.renderedDocument = null
		this.unsupportedDocument = document
		this.renderedMarkdown = null
		this.editorMode = 'rich'
	}

	dispose(): void {
		this.request += 1
		this.draft.dispose()
	}
}

export class WorkspaceSession {
	loading = $state(true)
	workspace = $state<Workspace | null>(null)
	access = $state<'readonly' | 'editable'>('readonly')
	workspaceFormat = $state<WorkspaceFormat>('markdown')
	openKnowledgeRoots = $state<KnowledgeBundlePath[]>([])
	entries = $state<WorkspaceEntry[]>([])
	settings = $state<ApplicationSettings>(defaultApplicationSettings)
	mcpStatus = $state<MCPWorkspaceStatus | null>(null)
	message = $state<WorkspaceMessageID | ''>('')
	tabs = $state<WorkspaceDocumentTab[]>([])
	activeTabID = $state<string | null>(null)
	lastActiveDocumentPath = $state<KnowledgeBundlePath | null>(null)
	draggingTabID = $state<string | null>(null)
	frontmatterEditorOpen = $state(false)

	private refreshTimer: ReturnType<typeof setTimeout> | undefined
	private unsubscribeWorkspace: (() => void) | undefined
	private unsubscribeSettings: (() => void) | undefined
	private unsubscribeMCP: (() => void) | undefined
	private unsubscribeTabTransfers: (() => void) | undefined
	private tabSequence = 0
	private refreshRequest = 0
	private readonly outgoingTabTransfers = new SvelteMap<string, string>()
	private readonly outgoingTabTransferTimers = new SvelteMap<
		string,
		ReturnType<typeof setTimeout>
	>()
	private readonly convertingDocumentIDs = new SvelteSet<string>()
	private readonly singleDocument: boolean

	constructor(
		private readonly api: OpenKnowledgeAPI,
		private readonly workspaceID: string,
		private readonly onDocumentRoute: DocumentRouteListener,
		options: WorkspaceSessionOptions = {}
	) {
		this.singleDocument = options.singleDocument ?? false
	}

	get activeTab(): WorkspaceDocumentTab | null {
		return this.tabs.find((tab) => tab.id === this.activeTabID) ?? null
	}

	get document(): WorkspaceFileEntry | null {
		return this.activeTab?.document ?? null
	}

	get documentLoading(): boolean {
		return this.activeTab?.loading ?? false
	}

	get draft(): string {
		return this.activeTab?.content ?? ''
	}

	get saveState(): SaveState {
		return this.activeTab?.saveState ?? 'saved'
	}

	get editorMode(): EditorMode {
		return this.activeTab?.editorMode ?? 'rich'
	}

	get hasUnsavedChanges(): boolean {
		return this.tabs.some((tab) => tab.draft.hasUnsavedChanges)
	}

	get editable(): boolean {
		return this.access === 'editable'
	}

	get documentAccess(): KnowledgeBundleFileAccess | null {
		return this.document?.documentAccess ?? null
	}

	get documentEditable(): boolean {
		return this.editable && this.documentAccess === 'writable'
	}

	get documentReadonly(): boolean {
		return this.documentAccess === 'readonly'
	}

	get documentRendered(): boolean {
		return this.activeTab?.rendered ?? false
	}

	get documentUnsupported(): boolean {
		return this.activeTab?.unsupported ?? false
	}

	get local(): boolean {
		return this.workspace?.kind === 'local'
	}

	usesOpenKnowledgeFormat(path: KnowledgeBundlePath): boolean {
		if (!isMarkdownDocumentPath(path)) {
			return false
		}
		return (
			this.settings.strictOpenKnowledgeFormat ||
			isPathInOpenKnowledgeRoots(path, this.openKnowledgeRoots)
		)
	}

	async initialize(): Promise<void> {
		this.loading = true
		let settingsChanged = false
		let workspaceChangedWhileOpening = false
		try {
			this.unsubscribeSettings?.()
			this.unsubscribeSettings = this.api.settings.onChange((nextSettings) => {
				settingsChanged = true
				this.settings = nextSettings
			})
			this.unsubscribeWorkspace?.()
			this.unsubscribeWorkspace = this.api.knowledge.onWorkspaceChange((change) => {
				if (change.workspaceID === this.workspaceID && !this.workspace) {
					workspaceChangedWhileOpening = true
				}
				this.workspaceChanged(change)
			})
			const mcpStatusRequest = this.api.mcp.get({ workspaceID: this.workspaceID }).catch(() => null)
			const [snapshot, settings, mcpStatus] = await Promise.all([
				this.api.knowledge.openWorkspace({ workspaceID: this.workspaceID }),
				this.api.settings.get(),
				mcpStatusRequest
			])
			this.applyWorkspace(snapshot)
			if (!settingsChanged) {
				this.settings = settings
			}
			this.mcpStatus = mcpStatus
			if (workspaceChangedWhileOpening) {
				await this.refreshWorkspace(true)
			}
			this.unsubscribeMCP = this.api.mcp.onChange((nextStatus) => {
				if (nextStatus.workspaceID !== this.workspaceID) {
					return
				}
				this.mcpStatus = nextStatus
			})
			this.unsubscribeTabTransfers = this.api.window.onTabTransferCommitted((transfer) => {
				this.tabTransferCommitted(transfer)
			})
		} catch {
			this.message = 'error.workspace.initialize'
		} finally {
			this.loading = false
		}
	}

	dispose(): void {
		this.refreshRequest += 1
		for (const tab of this.tabs) {
			tab.dispose()
		}
		clearTimeout(this.refreshTimer)
		this.unsubscribeWorkspace?.()
		this.unsubscribeSettings?.()
		this.unsubscribeMCP?.()
		this.unsubscribeTabTransfers?.()
		this.outgoingTabTransfers.clear()
		for (const timer of this.outgoingTabTransferTimers.values()) {
			clearTimeout(timer)
		}
		this.outgoingTabTransferTimers.clear()
	}

	async openWorkspaceSelector(
		target: 'replace-current-window' | 'new-window' = 'replace-current-window'
	): Promise<void> {
		if (target === 'replace-current-window' && !(await this.flushAll())) {
			return
		}
		try {
			await this.api.workspaceSelector.open({ target })
		} catch {
			this.message = 'error.workspace.selector.open'
		}
	}

	async openMCPSettings(): Promise<void> {
		try {
			await this.api.mcp.openSettings()
		} catch (error) {
			this.message = mcpMessageIDFromError(error) ?? 'error.mcp.settings.open'
		}
	}

	async revealWorkspace(): Promise<void> {
		if (!this.workspace || !this.local) {
			return
		}
		try {
			await this.api.knowledge.revealWorkspace({ workspaceID: this.workspace.id })
		} catch {
			this.message = 'error.workspace.reveal'
		}
	}

	async search(query: string): Promise<KnowledgeSearchResult | null> {
		const workspace = this.workspace
		if (!workspace || workspace.kind !== 'local') {
			return null
		}
		try {
			return await this.api.knowledge.search({ workspaceID: workspace.id, query, limit: 100 })
		} catch {
			return null
		}
	}

	async openDocument(path: KnowledgeBundlePath, id?: WorkspaceFileEntry['id']): Promise<boolean> {
		const existing =
			id === undefined
				? this.tabs.find((tab) => tab.path === path || tab.requestedPath === path)
				: this.tabs.find((tab) => tab.document?.id === id || tab.requestedID === id)
		if (existing) {
			this.activateTab(existing)
			if (!existing.document && !existing.loading) {
				return this.loadTab(existing, path, id)
			}
			return true
		}
		if (this.singleDocument && this.tabs.length > 0) {
			if (!(await this.flushAll())) {
				return false
			}
			for (const tab of this.tabs) {
				tab.dispose()
			}
			this.tabs = []
			this.activeTabID = null
		}
		const tab = this.createTab(path)
		this.tabs.push(tab)
		this.activateTab(tab)
		return this.loadTab(tab, path, id)
	}

	activateNoDocument(): void {
		if (this.activeTab) {
			this.lastActiveDocumentPath = this.activeTab.path
		}
		this.activeTabID = null
		this.frontmatterEditorOpen = false
	}

	selectTab(tabID: string): void {
		const tab = this.tabs.find((candidate) => candidate.id === tabID)
		if (!tab) {
			return
		}
		this.activateTab(tab)
		this.onDocumentRoute(tab.path, false)
	}

	selectAdjacentTab(direction: -1 | 1): void {
		if (this.tabs.length < 2) {
			return
		}
		const currentIndex = Math.max(
			0,
			this.tabs.findIndex((tab) => tab.id === this.activeTabID)
		)
		const nextIndex = (currentIndex + direction + this.tabs.length) % this.tabs.length
		const tab = this.tabs[nextIndex]
		if (tab) {
			this.selectTab(tab.id)
		}
	}

	moveTab(tabID: string, direction: -1 | 1): void {
		const index = this.tabs.findIndex((tab) => tab.id === tabID)
		const nextIndex = index + direction
		if (index < 0 || nextIndex < 0 || nextIndex >= this.tabs.length) {
			return
		}
		const [tab] = this.tabs.splice(index, 1)
		if (tab) {
			this.tabs.splice(nextIndex, 0, tab)
		}
	}

	async closeTab(tabID: string, discard = false): Promise<boolean> {
		const index = this.tabs.findIndex((tab) => tab.id === tabID)
		const tab = this.tabs[index]
		if (!tab) {
			return true
		}
		if (!discard && !(await tab.draft.flush())) {
			this.activateTab(tab)
			this.onDocumentRoute(tab.path, false)
			this.message ||= 'error.document.close.unsaved'
			return false
		}

		const wasActive = this.activeTabID === tabID
		tab.dispose()
		this.tabs.splice(index, 1)
		if (!wasActive) {
			return true
		}
		const nextTab = this.tabs[index] ?? this.tabs[index - 1] ?? null
		if (nextTab) {
			this.activateTab(nextTab)
			this.onDocumentRoute(nextTab.path, true)
		} else {
			this.activeTabID = null
			this.onDocumentRoute(null, true)
		}
		return true
	}

	async closeActiveTab(discard = false): Promise<boolean> {
		return this.activeTab ? this.closeTab(this.activeTab.id, discard) : true
	}

	async closeOtherTabs(tabID: string): Promise<boolean> {
		for (const tab of [...this.tabs]) {
			if (tab.id !== tabID && !(await this.closeTab(tab.id))) {
				return false
			}
		}
		return true
	}

	async closeTabsToRight(tabID: string): Promise<boolean> {
		const index = this.tabs.findIndex((tab) => tab.id === tabID)
		if (index < 0) {
			return true
		}
		for (const tab of [...this.tabs].slice(index + 1)) {
			if (!(await this.closeTab(tab.id))) {
				return false
			}
		}
		return true
	}

	async openReference(path: KnowledgeBundlePath): Promise<void> {
		this.onDocumentRoute(path, false)
	}

	async openSystemPath(path: string): Promise<void> {
		const workspace = this.workspace
		if (!workspace || workspace.kind !== 'local') {
			return
		}
		try {
			await this.api.knowledge.openSystemPath({ workspaceID: workspace.id, path })
		} catch {
			this.message = 'error.document.system-path.open'
		}
	}

	async openDocumentInNewWindow(
		path = this.activeTab?.path,
		presentation: DocumentWindowPresentation = 'editor'
	): Promise<boolean> {
		const workspace = this.workspace
		const tab = this.tabs.find((candidate) => candidate.path === path)
		if (!workspace || !path) {
			return false
		}
		if (tab && !(await tab.draft.flush())) {
			this.message ||= 'error.document.window.unsaved'
			return false
		}
		try {
			await this.api.window.openDocumentWindow({
				workspaceID: workspace.id,
				path,
				...(tab?.document ? { id: tab.document.id } : {}),
				presentation
			})
			return true
		} catch {
			this.message = 'error.document.window.open'
			return false
		}
	}

	async prepareTabTransfer(tabID: string, token: string): Promise<boolean> {
		const workspace = this.workspace
		const tab = this.tabs.find((candidate) => candidate.id === tabID)
		if (!workspace || !tab?.document || tab.loading) {
			return false
		}
		if (!(await tab.draft.flush())) {
			this.activateTab(tab)
			this.onDocumentRoute(tab.path, false)
			this.message ||= 'error.tab.transfer.unsaved'
			return false
		}
		this.outgoingTabTransfers.set(token, tab.id)
		try {
			await this.api.window.prepareTabTransfer({
				token,
				path: tab.path,
				sourceTabID: tab.id
			})
			const timer = setTimeout(() => {
				this.forgetOutgoingTabTransfer(token)
			}, 35_000)
			this.outgoingTabTransferTimers.set(token, timer)
			return true
		} catch {
			this.forgetOutgoingTabTransfer(token)
			this.message = 'error.tab.transfer.prepare'
			return false
		}
	}

	async cancelTabTransfer(token: string): Promise<void> {
		if (!this.outgoingTabTransfers.has(token)) {
			return
		}
		try {
			await this.api.window.cancelTabTransfer({ token })
			this.forgetOutgoingTabTransfer(token)
		} catch {
			// A destination may have claimed the token while the drag was ending.
		}
	}

	async tearOffTab(tabID: string, token: string): Promise<boolean> {
		if (this.outgoingTabTransfers.get(token) !== tabID) {
			return false
		}
		try {
			const status = await this.api.window.tabTransferStatus({ token })
			if (status !== 'pending') {
				return false
			}
			await this.api.window.cancelTabTransfer({ token })
			this.forgetOutgoingTabTransfer(token)
		} catch {
			return false
		}
		const tab = this.tabs.find((candidate) => candidate.id === tabID)
		if (!tab) {
			return false
		}
		return this.openDocumentInNewWindow(tab.path, 'workspace')
	}

	async receiveTabTransfer(token: string, insertionIndex = this.tabs.length): Promise<boolean> {
		let transfer
		try {
			transfer = await this.api.window.acceptTabTransfer({ token })
		} catch {
			this.message = 'error.tab.transfer.incompatible'
			return false
		}
		if (!(await this.openTransferredDocument(transfer.path, insertionIndex))) {
			return false
		}
		try {
			await this.api.window.commitTabTransfer({ token: transfer.token })
			return true
		} catch {
			this.message = 'error.tab.transfer.commit'
			return false
		}
	}

	setEditorMode(mode: EditorMode): void {
		if (
			this.activeTab &&
			!this.activeTab.unsupported &&
			(!this.activeTab.rendered || mode === 'rich')
		) {
			this.activeTab.editorMode = mode
		}
	}

	openFrontmatterEditor(): void {
		if (this.documentEditable) {
			this.frontmatterEditorOpen = true
		}
	}

	updateDraft(markdown: string, tabID = this.activeTabID): void {
		const tab = this.tabs.find((candidate) => candidate.id === tabID)
		if (this.editable && tab?.document?.documentAccess === 'writable' && !tab.rendered) {
			tab.draft.update(markdown)
		}
	}

	async save(): Promise<void> {
		if (this.documentEditable) {
			await this.activeTab?.draft.save()
		}
	}

	async flushAll(): Promise<boolean> {
		for (const tab of this.tabs) {
			if (await tab.draft.flush()) {
				continue
			}
			this.activateTab(tab)
			this.onDocumentRoute(tab.path, false)
			this.message ||= 'error.workspace.leave.unsaved'
			return false
		}
		return true
	}

	async flushBeforeNavigation(): Promise<boolean> {
		return this.flushAll()
	}

	async reloadDocument(): Promise<void> {
		const tab = this.activeTab
		const document = tab?.document
		if (!tab || !document) {
			return
		}
		const sameEntry = currentDocumentEntry(this.entries, document.id)
		const path = sameEntry?.path ?? document.path
		const previousPath = tab.path
		if (
			(await this.loadTab(tab, path, document.id)) &&
			tab.id === this.activeTabID &&
			tab.path !== previousPath
		) {
			await this.onDocumentRoute(tab.path, true)
		}
	}

	async refreshRemoteWorkspace(): Promise<void> {
		if (this.workspace?.kind === 'remote') {
			await this.refreshWorkspace(true)
		}
	}

	async updateSettings(input: UpdateApplicationSettingsInput): Promise<void> {
		try {
			this.settings = await this.api.settings.update({
				workspaceID: this.workspaceID,
				scope: 'project',
				patch: input
			})
		} catch {
			this.message = 'error.settings.save'
		}
	}

	async updateMCPAccess(access: MCPAccess): Promise<boolean> {
		const workspace = this.workspace
		if (!workspace || workspace.kind !== 'local') {
			return false
		}
		try {
			this.mcpStatus = await this.api.mcp.update({ workspaceID: workspace.id, access })
			return true
		} catch (error) {
			this.message = mcpMessageIDFromError(error) ?? 'error.mcp.access.update'
			return false
		}
	}

	async createEntry(
		kind: 'directory' | 'file',
		parentPath: KnowledgeBundlePath,
		name: string
	): Promise<KnowledgeBundleEntry | null> {
		const workspace = this.workspace
		if (!workspace || !this.editable) {
			return null
		}
		await this.refreshWorkspace()
		const parent =
			parentPath === '/' ? null : this.entries.find((entry) => entry.path === parentPath)
		if (parentPath !== '/' && parent?.kind !== 'directory') {
			this.message = 'error.entry.destination-missing'
			return null
		}
		const entryName = validatedEntryName(name, kind, kind === 'file')
		if (!entryName.ok) {
			this.message = entryName.message
			return null
		}
		if (kind === 'directory') {
			const messageBeforeMutation = this.message
			try {
				const result = await this.api.knowledge.createDirectory({
					workspaceID: workspace.id,
					path: childKnowledgeBundlePath(parentPath, entryName.value)
				})
				if (!result.ok) {
					this.message = mutationMessageID(result.error, 'create')
					return null
				}
				if (this.message === messageBeforeMutation) {
					this.message = ''
				}
				await this.refreshWorkspace()
				return result.value.directory
			} catch {
				this.message = 'error.mutation.entry.create'
				return null
			}
		}

		const fileName = entryName.value
		const filePath = childKnowledgeBundlePath(parentPath, fileName)
		const messageBeforeMutation = this.message
		try {
			const result = await this.api.knowledge.createFile({
				workspaceID: workspace.id,
				path: filePath,
				content: newMarkdownDocumentContent(fileName, this.usesOpenKnowledgeFormat(filePath)),
				mediaType: 'text/markdown'
			})
			if (!result.ok) {
				this.message = mutationMessageID(result.error, 'create')
				return null
			}
			if (this.message === messageBeforeMutation) {
				this.message = ''
			}
			await this.refreshWorkspace()
			this.onDocumentRoute(result.value.file.path, false)
			return result.value.file
		} catch {
			this.message = 'error.mutation.entry.create'
			return null
		}
	}

	async convertDocumentToMarkdown(
		entry: KnowledgeBundleEntry | null = this.document
	): Promise<KnowledgeBundleEntry | null> {
		const workspace = this.workspace
		if (!workspace || workspace.kind !== 'local' || !this.editable || entry?.kind !== 'file') {
			return null
		}
		await this.refreshWorkspace()
		const source = currentDocumentEntry(this.entries, entry.id)
		const initialDestination = source ? markdownPathForAnydoc(source.path) : null
		if (!source || !initialDestination) {
			this.message = source ? 'error.document.convert' : 'error.document.convert.missing'
			return null
		}
		if (this.entries.some((candidate) => candidate.path === initialDestination)) {
			this.message = 'error.document.convert.conflict'
			return null
		}
		if (this.convertingDocumentIDs.has(source.id)) {
			return null
		}
		this.convertingDocumentIDs.add(source.id)

		const messageBeforeMutation = this.message
		try {
			const rendered = await this.api.knowledge.readRenderedDocument({
				workspaceID: workspace.id,
				path: source.path,
				id: source.id,
				maximumBytes: ANYDOC_MAXIMUM_FILE_BYTES
			})
			if (!rendered) {
				this.message = 'error.document.convert.missing'
				return null
			}
			const destination = markdownPathForAnydoc(rendered.path) as KnowledgeBundlePath | null
			if (!destination) {
				this.message = 'error.document.convert'
				return null
			}
			const result = await this.api.knowledge.createFile({
				workspaceID: workspace.id,
				path: destination,
				content: rendered.markdown,
				mediaType: 'text/markdown'
			})
			if (!result.ok) {
				this.message =
					result.error.code === 'already_exists'
						? 'error.document.convert.conflict'
						: mutationMessageID(result.error, 'create')
				return null
			}
			if (this.message === messageBeforeMutation) {
				this.message = ''
			}
			await this.refreshWorkspace()
			this.onDocumentRoute(result.value.file.path, false)
			return result.value.file
		} catch {
			this.message = 'error.document.convert'
			return null
		} finally {
			this.convertingDocumentIDs.delete(source.id)
		}
	}

	async renameEntry(
		entry: KnowledgeBundleEntry,
		name: string
	): Promise<KnowledgeBundleEntry | null> {
		const workspace = this.workspace
		if (!workspace || !this.editable) {
			return null
		}
		const affectedTabs = this.tabs.filter((tab) => pathIncludes(entry, tab.path))
		for (const tab of affectedTabs) {
			if (!(await tab.draft.flush())) {
				this.message ||= 'error.document.rename.unsaved'
				return null
			}
		}
		await this.refreshWorkspace()
		const currentEntry = currentEntryFor(entry, affectedTabs, this.entries, this.local)
		if (!currentEntry || !currentEntry.parentPath) {
			this.message = 'error.entry.missing'
			return null
		}

		const entryName = validatedEntryName(
			name,
			currentEntry.kind,
			currentEntry.kind === 'file' && isMarkdownDocumentPath(currentEntry.path)
		)
		if (!entryName.ok) {
			this.message = entryName.message
			return null
		}
		if (
			workspace.kind === 'local' &&
			currentEntry.kind === 'file' &&
			isAnydocPath(currentEntry.path) &&
			!hasSameAnydocExtension(currentEntry.path, entryName.value)
		) {
			this.message = 'error.mutation.name.unsupported-document'
			return null
		}
		if (
			workspace.kind === 'local' &&
			currentEntry.kind === 'file' &&
			currentEntry.documentAccess === 'not_supported' &&
			(isMarkdownDocumentPath(entryName.value) || isAnydocPath(entryName.value))
		) {
			this.message = 'error.mutation.name.change-file-type'
			return null
		}
		let result
		const messageBeforeMutation = this.message
		try {
			result = await this.api.knowledge.moveEntry({
				workspaceID: workspace.id,
				id: currentEntry.id,
				path: currentEntry.path,
				expectedRevision: currentEntry.revision,
				destinationPath: childKnowledgeBundlePath(currentEntry.parentPath, entryName.value)
			})
		} catch {
			this.message = 'error.mutation.entry.rename'
			return null
		}
		if (!result.ok) {
			this.message = mutationMessageID(result.error, 'rename')
			return null
		}
		const movedEntry = result.value.entry
		if (this.message === messageBeforeMutation) {
			this.message = ''
		}
		await this.refreshWorkspace()
		for (const tab of affectedTabs) {
			const nextPath =
				`${movedEntry.path}${tab.path.slice(entry.path.length)}` as KnowledgeBundlePath
			tab.requestedPath = nextPath
			if (tab.id === this.activeTabID) {
				this.onDocumentRoute(nextPath, true)
			}
			await this.loadTab(tab, nextPath, tab.document?.id)
		}
		return movedEntry
	}

	async deleteEntry(entry: KnowledgeBundleEntry): Promise<boolean> {
		const workspace = this.workspace
		if (!workspace || !this.editable) {
			return false
		}
		const affectedTabs = this.tabs.filter((tab) => pathIncludes(entry, tab.path))
		for (const tab of affectedTabs) {
			if (!(await tab.draft.flush())) {
				this.message ||= 'error.document.delete.unsaved'
				return false
			}
		}
		await this.refreshWorkspace()
		const currentEntry = currentEntryFor(entry, affectedTabs, this.entries, this.local)
		if (!currentEntry) {
			this.message = 'error.entry.missing'
			return false
		}
		let result
		const messageBeforeMutation = this.message
		try {
			result = await this.api.knowledge.deleteEntry({
				workspaceID: workspace.id,
				id: currentEntry.id,
				path: currentEntry.path,
				expectedRevision: currentEntry.revision
			})
		} catch {
			this.message = 'error.mutation.entry.delete'
			return false
		}
		if (!result.ok) {
			this.message = mutationMessageID(result.error, 'delete')
			return false
		}
		const activeDeleted = affectedTabs.some((tab) => tab.id === this.activeTabID)
		for (const tab of affectedTabs) {
			tab.dispose()
		}
		this.tabs = this.tabs.filter((tab) => !affectedTabs.includes(tab))
		if (activeDeleted) {
			const nextTab = this.tabs[0] ?? null
			this.activeTabID = nextTab?.id ?? null
			this.onDocumentRoute(nextTab?.path ?? null, true)
		}
		if (this.message === messageBeforeMutation) {
			this.message = ''
		}
		await this.refreshWorkspace()
		return true
	}

	dismissMessage(): void {
		this.message = ''
	}

	private async openTransferredDocument(
		path: KnowledgeBundlePath,
		insertionIndex: number
	): Promise<boolean> {
		const existing = this.tabs.find((tab) => tab.path === path || tab.requestedPath === path)
		if (existing) {
			this.activateTab(existing)
			if ((!existing.document || existing.loading) && !(await this.loadTab(existing, path))) {
				return false
			}
			try {
				await this.onDocumentRoute(existing.path, false)
				return true
			} catch {
				this.message = 'error.tab.transfer.route'
				return false
			}
		}

		const tab = this.createTab(path)
		const index = Math.max(0, Math.min(Math.trunc(insertionIndex), this.tabs.length))
		this.tabs.splice(index, 0, tab)
		this.activateTab(tab)
		if (!(await this.loadTab(tab, path))) {
			if (this.tabs.includes(tab)) {
				await this.closeTab(tab.id, true)
			}
			return false
		}
		try {
			await this.onDocumentRoute(tab.path, false)
			return true
		} catch {
			this.message = 'error.tab.transfer.route'
			return false
		}
	}

	private tabTransferCommitted(transfer: TabTransferCommitted): void {
		if (this.outgoingTabTransfers.get(transfer.token) !== transfer.sourceTabID) {
			return
		}
		this.forgetOutgoingTabTransfer(transfer.token)
		void this.closeTab(transfer.sourceTabID)
	}

	private forgetOutgoingTabTransfer(token: string): void {
		this.outgoingTabTransfers.delete(token)
		const timer = this.outgoingTabTransferTimers.get(token)
		if (timer) {
			clearTimeout(timer)
			this.outgoingTabTransferTimers.delete(token)
		}
	}

	private createTab(path: KnowledgeBundlePath): WorkspaceDocumentTab {
		const draft = new DocumentDraft(
			this.api.knowledge,
			() => this.workspace?.id ?? null,
			() => this.editable,
			(message, expected) => {
				if (expected === undefined || this.message === expected) {
					this.message = message
				}
			}
		)
		return new WorkspaceDocumentTab(`document-tab-${++this.tabSequence}`, path, draft)
	}

	private activateTab(tab: WorkspaceDocumentTab): void {
		this.activeTabID = tab.id
		this.lastActiveDocumentPath = tab.path
		this.frontmatterEditorOpen = false
	}

	private async loadTab(
		tab: WorkspaceDocumentTab,
		path: KnowledgeBundlePath,
		id?: WorkspaceFileEntry['id']
	): Promise<boolean> {
		const workspace = this.workspace
		if (!workspace || !this.tabs.includes(tab)) {
			return false
		}
		const request = ++tab.request
		tab.requestedPath = path
		tab.requestedID = id
		tab.loading = true
		let canonicalPath: KnowledgeBundlePath | undefined
		try {
			let document: WorkspaceFileEntry | null
			const listedDocument =
				id === undefined
					? this.entries.find(
							(entry): entry is WorkspaceFileEntry => entry.kind === 'file' && entry.path === path
						)
					: currentDocumentEntry(this.entries, id)
			if (!listedDocument) {
				document = null
			} else if (listedDocument.documentAccess === 'not_supported') {
				document = listedDocument
				tab.openUnsupported(listedDocument)
			} else if (workspace.kind === 'local' && isAnydocPath(listedDocument.path)) {
				const file = await this.api.knowledge.readRenderedDocument({
					workspaceID: workspace.id,
					path: listedDocument.path,
					id: listedDocument.id,
					maximumBytes: ANYDOC_MAXIMUM_FILE_BYTES
				})
				if (request !== tab.request || !this.tabs.includes(tab)) {
					return false
				}
				if (!file) {
					document = null
				} else {
					const { markdown, ...entry } = file
					const rendered: WorkspaceFileEntry = {
						...entry,
						documentAccess: listedDocument.documentAccess
					}
					document = rendered
					tab.openRendered(rendered, markdown)
				}
			} else {
				const file = await this.api.knowledge.readFile({
					workspaceID: workspace.id,
					path: listedDocument.path,
					id: listedDocument.id
				})
				if (request !== tab.request || !this.tabs.includes(tab)) {
					return false
				}
				if (file && workspace.kind === 'local' && !isMarkdownDocumentPath(file.path)) {
					throw new Error('The requested file is no longer a Markdown document.')
				}
				if (file) {
					const markdown: WorkspaceFile = {
						...file,
						documentAccess: listedDocument.documentAccess
					}
					document = markdown
					tab.openMarkdown(markdown)
				} else {
					document = null
				}
			}
			if (request !== tab.request || !this.tabs.includes(tab)) {
				return false
			}
			if (!document) {
				this.message = 'error.document.missing'
				await this.closeTab(tab.id, true)
				return false
			}
			tab.requestedPath = document.path
			tab.requestedID = document.id
			if (tab.id === this.activeTabID) {
				this.lastActiveDocumentPath = document.path
				this.message = ''
				canonicalPath = document.path !== path ? document.path : undefined
			}
		} catch {
			if (request === tab.request) {
				this.message = 'error.document.open'
			}
			return false
		} finally {
			if (request === tab.request) {
				tab.loading = false
			}
		}
		if (canonicalPath && request === tab.request && tab.id === this.activeTabID) {
			try {
				await this.onDocumentRoute(canonicalPath, true)
			} catch {
				// A newer navigation owns the route; the document still opened successfully.
			}
		}
		return true
	}

	private applyWorkspace(snapshot: WorkspaceSnapshot): void {
		for (const tab of this.tabs) {
			tab.dispose()
		}
		this.workspace = snapshot.workspace
		this.access = snapshot.access
		this.workspaceFormat = snapshot.format
		this.openKnowledgeRoots = snapshot.openKnowledgeRoots
		this.entries = snapshot.entries
		this.tabs = []
		this.activeTabID = null
		this.lastActiveDocumentPath = null
		this.draggingTabID = null
		this.frontmatterEditorOpen = false
		this.message = ''
	}

	private workspaceChanged(change: WorkspaceChange): void {
		if (change.workspaceID !== this.workspace?.id) {
			return
		}
		clearTimeout(this.refreshTimer)
		this.refreshTimer = setTimeout(() => {
			void this.refreshWorkspace(true)
		}, 180)
	}

	private async refreshWorkspace(refreshDocuments = false): Promise<void> {
		const workspace = this.workspace
		if (!workspace) {
			return
		}
		const request = ++this.refreshRequest
		try {
			const snapshot = await this.api.knowledge.refreshWorkspace({ workspaceID: workspace.id })
			if (request !== this.refreshRequest || this.workspace?.id !== workspace.id) {
				return
			}
			this.entries = snapshot.entries
			this.access = snapshot.access
			this.workspaceFormat = snapshot.format
			this.openKnowledgeRoots = snapshot.openKnowledgeRoots
			if (refreshDocuments) {
				await this.refreshOpenDocuments(snapshot.entries, request)
			}
		} catch {
			if (request === this.refreshRequest) {
				this.message = 'error.workspace.refresh'
			}
		}
	}

	private async refreshOpenDocuments(
		entries: WorkspaceEntry[],
		refreshRequest: number
	): Promise<void> {
		for (const tab of [...this.tabs]) {
			if (refreshRequest !== this.refreshRequest) {
				return
			}
			const document = tab.document
			if (!document) {
				continue
			}
			const current = currentDocumentEntry(entries, document.id)
			if (!current) {
				if (tab.saveState !== 'saved') {
					continue
				}
				if (tab.id === this.activeTabID) {
					this.message = 'error.document.removed'
				}
				await this.closeTab(tab.id, true)
				if (refreshRequest !== this.refreshRequest) {
					return
				}
				continue
			}
			if (tab.saveState !== 'saved') {
				if (current.documentAccess !== document.documentAccess) {
					// Keep unsaved Markdown visible, but prevent further edits and saves.
					tab.draft.setDocumentAccess(
						current.documentAccess === 'not_supported' ? 'readonly' : current.documentAccess
					)
				}
				continue
			}
			if (current.path !== document.path && tab.id === this.activeTabID) {
				this.onDocumentRoute(current.path, true)
			}
			if (
				current.path !== document.path ||
				current.revision !== document.revision ||
				current.documentAccess !== document.documentAccess
			) {
				await this.loadTab(tab, current.path, current.id)
				if (refreshRequest !== this.refreshRequest) {
					return
				}
			}
		}
	}
}

function currentEntryFor(
	entry: KnowledgeBundleEntry,
	tabs: readonly WorkspaceDocumentTab[],
	entries: readonly WorkspaceEntry[],
	allowTabIdentityFallback: boolean
): KnowledgeBundleEntry | undefined {
	const byOriginalID = entries.find((candidate) => candidate.id === entry.id)
	if (byOriginalID || entry.kind !== 'file' || !allowTabIdentityFallback) {
		return byOriginalID
	}
	const currentIDs = new Set(tabs.map((tab) => tab.document?.id).filter(Boolean))
	return entries.find((candidate) => currentIDs.has(candidate.id))
}

function pathIncludes(entry: KnowledgeBundleEntry, path: KnowledgeBundlePath): boolean {
	return path === entry.path || (entry.kind === 'directory' && path.startsWith(`${entry.path}/`))
}

type ValidatedEntryName = { ok: true; value: string } | { ok: false; message: WorkspaceMessageID }

function validatedEntryName(
	name: string,
	kind: KnowledgeBundleEntry['kind'],
	normalizeMarkdown = false
): ValidatedEntryName {
	const normalized = name.trim()
	if (!normalized || normalized === '.' || normalized === '..') {
		return { ok: false, message: 'error.mutation.name.required' }
	}
	if (
		[...normalized].some(
			(character) => '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) <= 0x1f
		) ||
		/[. ]$/.test(normalized)
	) {
		return { ok: false, message: 'error.mutation.name.unsupported' }
	}
	if (new TextEncoder().encode(normalized).byteLength > 240) {
		return { ok: false, message: 'error.mutation.name.too-long' }
	}
	const portableBase = normalized.split('.', 1)[0]?.trimEnd().toLowerCase() ?? ''
	if (
		/^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/.test(
			portableBase
		)
	) {
		return { ok: false, message: 'error.mutation.name.reserved' }
	}
	return {
		ok: true,
		value: kind === 'file' && normalizeMarkdown ? normalizeMarkdownFileName(normalized) : normalized
	}
}
