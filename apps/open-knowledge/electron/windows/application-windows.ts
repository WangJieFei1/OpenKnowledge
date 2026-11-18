import {
	BrowserWindow,
	app,
	nativeTheme,
	screen,
	shell,
	type NativeImage,
	type WebContents
} from 'electron'
import type { KnowledgeBundlePath, WorkspaceChange } from '../../src/lib/knowledge/api'
import type { MCPWorkspaceStatus } from '../../src/lib/mcp/api'
import { appEdition } from '../../src/lib/app-edition'
import type { ApplicationSettings } from '../../src/lib/settings/api'
import {
	applicationSettingsRoute,
	documentRoute,
	mcpRoute,
	workspaceRoute,
	workspaceSelectorRoute
} from '../../src/lib/navigation/routes'
import { applicationBackgroundColors } from '../../src/lib/theme/theme'
import type { DocumentWindowPresentation, WindowRole, WindowState } from '../../src/lib/window/api'
import type { WorkspaceSelectorOpenInput } from '../../src/lib/workspace/selector-api'
import { channels } from '../channels'
import type { ApplicationQuitIntent } from '../application-quit-intent'
import type { TabTransfers } from './tab-transfers'
import {
	allowsRendererPermission,
	fitNativeWindowToWorkArea,
	isTrustedRendererURL,
	NativeWindowCloseIntent,
	nativeWindowChrome,
	retryPreventedWorkspaceClose,
	synchronizeWindowBackground
} from './native-window-behavior'

const rendererReadyFallbackMilliseconds = 2_000

interface ApplicationWindowRecord {
	window: BrowserWindow
	webContents: WebContents
	webContentsID: number
	lastActiveOrder: number
	rendererReady: boolean
	nativeReady: boolean
	displayReady: boolean
	focusWhenReady: boolean
	readyFallback: ReturnType<typeof setTimeout> | null
}

interface WorkspaceWindowRecord extends ApplicationWindowRecord {
	role: 'workspace'
	workspaceID: string
	presentation: DocumentWindowPresentation
}

interface SelectorWindowRecord extends ApplicationWindowRecord {
	role: 'selector'
	target: WorkspaceSelectorOpenInput['target']
	requestingWorkspace: WorkspaceWindowRecord | null
}

interface MCPWindowRecord extends ApplicationWindowRecord {
	role: 'mcp'
}

interface SettingsWindowRecord extends ApplicationWindowRecord {
	role: 'settings'
	workspaceID: string | null
}

type WindowRecord =
	WorkspaceWindowRecord | SelectorWindowRecord | MCPWindowRecord | SettingsWindowRecord

export class ApplicationWindows {
	private readonly workspaceWindows = new Map<WebContents, WorkspaceWindowRecord>()
	private readonly selectorWindows = new Map<WebContents, SelectorWindowRecord>()
	private mcpWindow: MCPWindowRecord | null = null
	private settingsWindow: SettingsWindowRecord | null = null
	private activeOrder = 0
	private readonly backgroundModes = new WeakMap<
		BrowserWindow,
		(mode: ApplicationSettings['colorMode']) => void
	>()

	constructor(
		private readonly preloadPath: string,
		private readonly tabTransfers: TabTransfers,
		private readonly applicationIcon: NativeImage,
		private readonly quitIntent?: ApplicationQuitIntent
	) {}

	async showWorkspace(workspaceID: string): Promise<void> {
		await this.createWorkspaceWindow(workspaceID, workspaceRoute(workspaceID))
	}

	async showMCPSettings(): Promise<void> {
		const existing = this.mcpWindow
		if (existing && this.isRegistered(existing)) {
			this.focus(existing.window)
			return
		}

		const window = this.createWindow('mcp')
		const record: MCPWindowRecord = {
			role: 'mcp',
			window,
			webContents: window.webContents,
			webContentsID: window.webContents.id,
			lastActiveOrder: 0,
			rendererReady: false,
			nativeReady: false,
			displayReady: false,
			focusWhenReady: true,
			readyFallback: null
		}
		this.register(record)
		await this.loadRegisteredWindow(record, rendererURL(mcpRoute()))
	}

	async showApplicationSettings(workspaceID: string | null = null): Promise<void> {
		const existing = this.settingsWindow
		if (existing && this.isRegistered(existing)) {
			if (existing.workspaceID !== workspaceID) {
				existing.workspaceID = workspaceID
				await existing.window.loadURL(rendererURL(applicationSettingsRoute()))
			}
			this.focus(existing.window)
			return
		}

		const window = this.createWindow('settings')
		const record: SettingsWindowRecord = {
			role: 'settings',
			workspaceID,
			window,
			webContents: window.webContents,
			webContentsID: window.webContents.id,
			lastActiveOrder: 0,
			rendererReady: false,
			nativeReady: false,
			displayReady: false,
			focusWhenReady: true,
			readyFallback: null
		}
		this.register(record)
		await this.loadRegisteredWindow(record, rendererURL(applicationSettingsRoute()))
	}

	async openDocumentWindow(
		workspaceID: string,
		path: KnowledgeBundlePath,
		presentation: DocumentWindowPresentation
	): Promise<void> {
		await this.createWorkspaceWindow(
			workspaceID,
			documentRoute(workspaceID, path, { editorWindow: presentation === 'editor' }),
			presentation
		)
	}

	async showSelector(
		input: WorkspaceSelectorOpenInput,
		requestingWindow?: BrowserWindow
	): Promise<void> {
		const requestingWorkspace = requestingWindow ? this.workspaceRecordFor(requestingWindow) : null
		if (requestingWindow && !requestingWorkspace) {
			throw new Error('The requesting workspace window is not available.')
		}
		if (requestingWorkspace && requestingWorkspace.presentation !== 'workspace') {
			throw new Error('Dedicated document windows cannot switch workspaces.')
		}
		if (input.target === 'replace-current-window' && !requestingWorkspace) {
			throw new Error('A workspace window is required for replacement.')
		}

		const window = this.createWindow('selector', requestingWorkspace?.window)
		const record: SelectorWindowRecord = {
			role: 'selector',
			target: input.target,
			requestingWorkspace,
			window,
			webContents: window.webContents,
			webContentsID: window.webContents.id,
			lastActiveOrder: 0,
			rendererReady: false,
			nativeReady: false,
			displayReady: false,
			focusWhenReady: false,
			readyFallback: null
		}
		this.register(record)
		await this.loadRegisteredWindow(record, rendererURL(workspaceSelectorRoute()))
	}

	async completeSelector(
		webContents: WebContents,
		workspaceID: string,
		forceReload = false
	): Promise<void> {
		const selector = this.selectorWindows.get(webContents)
		if (!selector || !this.isRegistered(selector)) {
			return
		}

		const requestingWorkspace = selector.requestingWorkspace
		if (
			selector.target === 'replace-current-window' &&
			requestingWorkspace &&
			this.isRegistered(requestingWorkspace)
		) {
			if (requestingWorkspace.workspaceID !== workspaceID || forceReload) {
				requestingWorkspace.workspaceID = workspaceID
				await requestingWorkspace.window.loadURL(rendererURL(workspaceRoute(workspaceID)))
			}
			this.close(selector.window)
			this.focus(requestingWorkspace.window)
			return
		}

		const window = await this.createWorkspaceWindow(workspaceID, workspaceRoute(workspaceID))
		this.close(selector.window)
		this.focus(window)
	}

	focusCurrent(): boolean {
		const focusedWindow = BrowserWindow.getFocusedWindow()
		const focusedRecord = focusedWindow ? this.recordFor(focusedWindow.webContents) : null
		if (focusedRecord && this.focus(focusedRecord.window)) {
			return true
		}

		let mostRecent: WindowRecord | null = null
		for (const record of this.records()) {
			if (
				this.isRegistered(record) &&
				(!mostRecent || record.lastActiveOrder > mostRecent.lastActiveOrder)
			) {
				mostRecent = record
			}
		}
		return mostRecent ? this.focus(mostRecent.window) : false
	}

	roleFor(webContents: WebContents): WindowRole | null {
		return this.recordFor(webContents)?.role ?? null
	}

	workspaceIDFor(webContents: WebContents): string | null {
		return this.workspaceWindows.get(webContents)?.workspaceID ?? null
	}

	settingsWorkspaceIDFor(webContents: WebContents): string | null {
		const record = this.recordFor(webContents)
		if (record?.role === 'workspace' || record?.role === 'settings') {
			return record.workspaceID
		}
		return null
	}

	focusedSettingsWorkspaceID(): string | null {
		const focused = BrowserWindow.getFocusedWindow()
		return focused ? this.settingsWorkspaceIDFor(focused.webContents) : null
	}

	presentationFor(webContents: WebContents): DocumentWindowPresentation | null {
		return this.workspaceWindows.get(webContents)?.presentation ?? null
	}

	windowFor(webContents: WebContents): BrowserWindow | null {
		return this.recordFor(webContents)?.window ?? null
	}

	webContentsForID(webContentsID: number): WebContents | null {
		for (const record of this.records()) {
			if (record.webContentsID === webContentsID && this.isRegistered(record)) {
				return record.webContents
			}
		}
		return null
	}

	stateFor(webContents: WebContents): WindowState | null {
		const record = this.recordFor(webContents)
		if (!record || !this.isRegistered(record)) {
			return null
		}
		return {
			role: record.role,
			maximized: record.window.isMaximized(),
			presentation: record.role === 'workspace' ? record.presentation : null
		}
	}

	rendererReady(webContents: WebContents): void {
		const record = this.recordFor(webContents)
		if (!record || !this.isRegistered(record)) {
			throw new Error('The application window is not available.')
		}
		record.rendererReady = true
		if (record.nativeReady) {
			this.reveal(record)
		}
	}

	broadcastWorkspaceChange(change: WorkspaceChange): void {
		for (const record of this.workspaceWindows.values()) {
			if (record.workspaceID === change.workspaceID && this.isRegistered(record)) {
				record.webContents.send(channels.workspaceChange, change)
			}
		}
	}

	async broadcastSettingsChange(
		changedWorkspaceID: string | null,
		settingsFor: (workspaceID: string | null) => Promise<ApplicationSettings>
	): Promise<void> {
		await Promise.all(
			this.records().map(async (record) => {
				if (!this.isRegistered(record)) {
					return
				}
				const workspaceID =
					record.role === 'workspace' || record.role === 'settings' ? record.workspaceID : null
				if (changedWorkspaceID !== null && workspaceID !== changedWorkspaceID) {
					return
				}
				const settings = await settingsFor(workspaceID)
				if (!this.isRegistered(record)) {
					return
				}
				const currentWorkspaceID =
					record.role === 'workspace' || record.role === 'settings' ? record.workspaceID : null
				if (currentWorkspaceID === workspaceID) {
					this.backgroundModes.get(record.window)?.(settings.colorMode)
					record.webContents.send(channels.settingsChange, settings)
				}
			})
		)
	}

	broadcastMCPChange(status: MCPWorkspaceStatus): void {
		for (const record of this.workspaceWindows.values()) {
			if (record.workspaceID === status.workspaceID && this.isRegistered(record)) {
				record.webContents.send(channels.mcpChange, status)
			}
		}
		const mcpWindow = this.mcpWindow
		if (mcpWindow && this.isRegistered(mcpWindow)) {
			mcpWindow.webContents.send(channels.mcpChange, status)
		}
	}

	private async createWorkspaceWindow(
		workspaceID: string,
		route: string,
		presentation: DocumentWindowPresentation = 'workspace'
	): Promise<BrowserWindow> {
		const window = this.createWindow('workspace', undefined, presentation)
		const record: WorkspaceWindowRecord = {
			role: 'workspace',
			workspaceID,
			presentation,
			window,
			webContents: window.webContents,
			webContentsID: window.webContents.id,
			lastActiveOrder: 0,
			rendererReady: false,
			nativeReady: false,
			displayReady: false,
			focusWhenReady: false,
			readyFallback: null
		}
		this.register(record)
		await this.loadRegisteredWindow(record, rendererURL(route))
		return window
	}

	private createWindow(
		role: WindowRole,
		parent?: BrowserWindow,
		presentation: DocumentWindowPresentation = 'workspace'
	): BrowserWindow {
		const workspace = role === 'workspace'
		const mcp = role === 'mcp'
		const settings = role === 'settings'
		const utility = mcp || settings
		const editor = workspace && presentation === 'editor'
		const dimensions = {
			width: editor ? 1080 : workspace ? 1440 : utility ? 880 : 680,
			height: editor ? 760 : workspace ? 900 : utility ? 760 : 560,
			minWidth: editor ? 720 : workspace ? 960 : utility ? 640 : 560,
			minHeight: editor ? 520 : workspace ? 640 : utility ? 520 : 440
		}
		const bounds =
			process.platform === 'darwin'
				? fitNativeWindowToWorkArea(
						dimensions,
						(parent
							? screen.getDisplayMatching(parent.getBounds())
							: screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
						).workArea
					)
				: dimensions
		const window = new BrowserWindow({
			icon: this.applicationIcon,
			title: workspace
				? appEdition.name
				: mcp
					? `MCP · ${appEdition.name}`
					: settings
						? `Settings · ${appEdition.name}`
						: `Choose a workspace · ${appEdition.name}`,
			...bounds,
			show: false,
			...nativeWindowChrome(process.platform),
			hasShadow: true,
			modal: Boolean(parent),
			parent,
			backgroundColor: nativeTheme.shouldUseDarkColors
				? applicationBackgroundColors.dark
				: applicationBackgroundColors.light,
			webPreferences: {
				preload: this.preloadPath,
				allowRunningInsecureContent: false,
				contextIsolation: true,
				devTools: !app.isPackaged,
				experimentalFeatures: false,
				nodeIntegration: false,
				nodeIntegrationInSubFrames: false,
				nodeIntegrationInWorker: false,
				sandbox: true,
				spellcheck: true,
				webSecurity: true,
				webviewTag: false
			}
		})

		secureWindowNavigation(window)
		this.backgroundModes.set(window, synchronizeWindowBackground(window, nativeTheme))
		window.webContents.session.setPermissionRequestHandler(
			(webContents, permission, callback, details) => {
				callback(
					!webContents.isDestroyed() &&
						allowsRendererPermission(
							permission,
							details.isMainFrame,
							details.requestingUrl,
							webContents.getURL(),
							process.env.VITE_DEV_SERVER_URL
						)
				)
			}
		)
		window.webContents.session.setPermissionCheckHandler(
			(webContents, permission, requestingOrigin, details) =>
				Boolean(
					webContents &&
					!webContents.isDestroyed() &&
					allowsRendererPermission(
						permission,
						details.isMainFrame,
						details.requestingUrl ?? requestingOrigin,
						webContents.getURL(),
						process.env.VITE_DEV_SERVER_URL
					)
				)
		)
		const windowID = window.id
		const closeIntent = new NativeWindowCloseIntent(() => {
			if (role === 'workspace') {
				this.quitIntent?.waitForSavedWindow(windowID)
			}
			retryPreventedWorkspaceClose(window.webContents, role)
		})
		window.on('close', () => closeIntent.requestClose())
		window.webContents.on('will-prevent-unload', () => closeIntent.preventUnload())
		window.on('closed', () => this.quitIntent?.windowClosed(windowID))
		window.on('maximize', () => {
			window.webContents.send(channels.maximizedChange, true)
		})
		window.on('unmaximize', () => {
			window.webContents.send(channels.maximizedChange, false)
		})
		return window
	}

	private register(record: WindowRecord): void {
		record.lastActiveOrder = ++this.activeOrder
		if (record.role === 'workspace') {
			this.workspaceWindows.set(record.webContents, record)
		} else if (record.role === 'selector') {
			this.selectorWindows.set(record.webContents, record)
		} else if (record.role === 'mcp') {
			this.mcpWindow = record
		} else if (record.role === 'settings') {
			this.settingsWindow = record
		}

		record.window.once('ready-to-show', () => {
			if (!this.isRegistered(record) || record.displayReady) {
				return
			}
			record.nativeReady = true
			if (record.rendererReady) {
				this.reveal(record)
				return
			}
			record.readyFallback = setTimeout(() => {
				record.readyFallback = null
				this.reveal(record)
			}, rendererReadyFallbackMilliseconds)
		})

		record.window.on('focus', () => {
			if (this.recordFor(record.webContents) === record) {
				record.lastActiveOrder = ++this.activeOrder
			}
		})
		record.window.on('closed', () => {
			this.unregister(record)
		})
	}

	private async loadRegisteredWindow(record: WindowRecord, url: string): Promise<void> {
		try {
			await record.window.loadURL(url)
		} catch (error) {
			this.unregister(record)
			if (!record.window.isDestroyed()) {
				record.window.destroy()
			}
			throw error
		}
	}

	private unregister(record: WindowRecord): void {
		if (record.role === 'workspace') {
			if (this.workspaceWindows.get(record.webContents) !== record) {
				return
			}
			this.workspaceWindows.delete(record.webContents)
		} else if (record.role === 'selector') {
			if (this.selectorWindows.get(record.webContents) !== record) {
				return
			}
			this.selectorWindows.delete(record.webContents)
		} else if (record.role === 'mcp') {
			if (this.mcpWindow !== record) {
				return
			}
			this.mcpWindow = null
		} else if (record.role === 'settings') {
			if (this.settingsWindow !== record) {
				return
			}
			this.settingsWindow = null
		}
		if (record.readyFallback) {
			clearTimeout(record.readyFallback)
			record.readyFallback = null
		}
		this.tabTransfers.removeWebContents(record.webContentsID)
	}

	private recordFor(webContents: WebContents): WindowRecord | null {
		return (
			this.workspaceWindows.get(webContents) ??
			this.selectorWindows.get(webContents) ??
			(this.mcpWindow?.webContents === webContents ? this.mcpWindow : null) ??
			(this.settingsWindow?.webContents === webContents ? this.settingsWindow : null)
		)
	}

	private workspaceRecordFor(window: BrowserWindow): WorkspaceWindowRecord | null {
		for (const record of this.workspaceWindows.values()) {
			if (record.window === window && this.isRegistered(record)) {
				return record
			}
		}
		return null
	}

	private records(): WindowRecord[] {
		return [
			...this.workspaceWindows.values(),
			...this.selectorWindows.values(),
			...(this.mcpWindow ? [this.mcpWindow] : []),
			...(this.settingsWindow ? [this.settingsWindow] : [])
		]
	}

	private isRegistered(record: WindowRecord): boolean {
		return (
			this.recordFor(record.webContents) === record &&
			!record.window.isDestroyed() &&
			!record.webContents.isDestroyed()
		)
	}

	private focus(window: BrowserWindow): boolean {
		if (window.isDestroyed()) {
			return false
		}
		const record = this.recordFor(window.webContents)
		if (record && this.isRegistered(record) && !record.displayReady) {
			record.focusWhenReady = true
			return true
		}
		if (window.isMinimized()) {
			window.restore()
		}
		window.show()
		window.focus()
		return true
	}

	private reveal(record: WindowRecord): void {
		if (!this.isRegistered(record) || record.displayReady) {
			return
		}
		record.displayReady = true
		if (record.readyFallback) {
			clearTimeout(record.readyFallback)
			record.readyFallback = null
		}
		if (record.window.isMinimized()) {
			record.window.restore()
		}
		record.window.show()
		if (record.focusWhenReady) {
			record.focusWhenReady = false
			record.window.focus()
		}
	}

	private close(window: BrowserWindow): void {
		if (!window.isDestroyed()) {
			window.close()
		}
	}
}

function rendererURL(route: string): string {
	const developmentURL = process.env.VITE_DEV_SERVER_URL
	if (developmentURL) {
		return new URL(route, developmentURL).href
	}
	return `open-knowledge://app${route}`
}

function secureWindowNavigation(window: BrowserWindow): void {
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isAllowedExternalURL(url)) {
			void shell.openExternal(url)
		}
		return { action: 'deny' }
	})
	window.webContents.on('will-navigate', (event, url) => {
		if (isTrustedRendererURL(url, process.env.VITE_DEV_SERVER_URL)) {
			return
		}
		event.preventDefault()
		if (isAllowedExternalURL(url)) {
			void shell.openExternal(url)
		}
	})
}

function isAllowedExternalURL(value: string): boolean {
	try {
		return new URL(value).protocol === 'https:'
	} catch {
		return false
	}
}
