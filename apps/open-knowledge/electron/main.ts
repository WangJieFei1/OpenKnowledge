import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, Menu, nativeTheme, net, protocol } from 'electron'
import squirrelStartup from 'electron-squirrel-startup'
import { loadApplicationIcons } from './application-icons'
import { installApplicationMenu } from './application-menu'
import { ApplicationQuitIntent } from './application-quit-intent'
import { ApplicationTray } from './application-tray'
import { registerKnowledgeIPC } from './ipc'
import {
	fallbackMCPStdioConfiguration,
	installMCPStdioBridge,
	mcpApplicationArguments,
	mcpStdioSwitch
} from './mcp/bridge-installation'
import { MCPConfigStore } from './mcp/mcp-config-store'
import { runMCPStdioBridge } from './mcp/stdio-bridge'
import { hardenPackagedCommandLine } from './packaged-command-line'
import { selectApplicationLanguage } from '../src/lib/settings/api'
import { WorkspaceMCPGateway } from './mcp/workspace-gateway'
import { SettingsService } from './settings/settings-service'
import { ApplicationWindows } from './windows/application-windows'
import { TabTransfers } from './windows/tab-transfers'
import { WorkspaceManager } from './workspace/workspace-manager'
import { appEdition } from '../src/lib/app-edition'
import { configureEditionIdentity } from './app-identity'

// Set these before the single-instance lock, default session, settings, or MCP bridge are used.
// Neither edition silently inherits the legacy app's grants, credentials or memory opt-in.
configureEditionIdentity(app, appEdition)

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const applicationScheme = 'open-knowledge'
let workspaceManager: WorkspaceManager | null = null
let applicationWindows: ApplicationWindows | null = null
let applicationTray: ApplicationTray | null = null
let mcpGateway: WorkspaceMCPGateway | null = null
let settingsService: SettingsService | null = null
let unsubscribeIPC: (() => void) | undefined
let unsubscribeApplicationSettings: (() => void) | undefined
let startupPromise: Promise<void> | null = null
let shutdownStarted = false
let shutdownComplete = false
const quitIntent = new ApplicationQuitIntent(() => app.quit())

if (process.argv.includes(mcpStdioSwitch)) {
	void runMCPStdioBridge()
		.then((exitCode) => app.exit(exitCode))
		.catch(() => {
			process.stderr.write(
				'Open Knowledge MCP could not start. Ensure the desktop app is running and the shared connection includes at least one workspace.\n'
			)
			app.exit(1)
		})
} else {
	startDesktopApplication()
}

function startDesktopApplication(): void {
	hardenPackagedCommandLine(app.isPackaged, app.commandLine)
	app.on('before-quit', () => quitIntent.requestQuit())
	protocol.registerSchemesAsPrivileged([
		{
			scheme: applicationScheme,
			privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
		}
	])
	app.enableSandbox()

	if (process.platform === 'win32') {
		app.setAppUserModelId(appEdition.windowsAppID)
	}

	if (squirrelStartup) {
		app.quit()
	} else if (!app.requestSingleInstanceLock()) {
		app.quit()
	} else {
		app.on('second-instance', () => {
			void focusCurrentOrShowInitialWindow().catch(reportStartupError)
		})
		app
			.whenReady()
			.then(() => {
				if (shutdownStarted) {
					return
				}
				startupPromise = startApplication()
				return startupPromise
			})
			.catch(reportStartupError)
	}
}

async function startApplication(): Promise<void> {
	if (process.platform !== 'darwin') {
		Menu.setApplicationMenu(null)
	}
	const userDataPath = app.getPath('userData')
	const mcpConfig = new MCPConfigStore(path.join(userDataPath, 'mcp', 'config.json'))
	await mcpConfig.load().catch(() => undefined)
	workspaceManager = new WorkspaceManager(
		() => new Set(Object.keys(mcpConfig.snapshot().grants)),
		async (workspaceID) => {
			await Promise.all([
				settingsService?.forgetWorkspace(workspaceID),
				mcpGateway
					? mcpGateway.update({ workspaceID, access: 'off' })
					: mcpConfig.setGrant(workspaceID, null)
			])
		}
	)
	await workspaceManager.initialize()
	settingsService = new SettingsService(
		path.join(app.getPath('userData'), 'settings.json'),
		(workspaceID) => workspaceManager?.workspaceRoot(workspaceID) ?? null,
		(workspaceID) => workspaceManager?.workspaceRootIdentity(workspaceID) ?? null
	)
	await settingsService.initialize(
		selectApplicationLanguage([...app.getPreferredSystemLanguages(), app.getLocale()])
	)
	const globalSettings = await settingsService.get(null)
	nativeTheme.themeSource = globalSettings.colorMode
	if (shutdownStarted) {
		return
	}
	const mcpArguments = mcpApplicationArguments(Boolean(process.defaultApp), app.getAppPath())
	const stdio = await installMCPStdioBridge(userDataPath, process.execPath, mcpArguments).catch(
		(error: unknown) => {
			console.error('The MCP stdio bridge could not be installed.', error)
			return fallbackMCPStdioConfiguration(userDataPath, process.execPath, mcpArguments)
		}
	)
	mcpGateway = new WorkspaceMCPGateway(
		workspaceManager,
		mcpConfig,
		userDataPath,
		stdio,
		appEdition.codexMemory
			? path.resolve(process.env.CODEX_HOME || path.join(app.getPath('home'), '.codex'), 'sessions')
			: undefined
	)
	try {
		await mcpGateway.initialize()
	} catch (error) {
		console.error('MCP access is unavailable.', error)
	}
	if (shutdownStarted) {
		return
	}
	const tabTransfers = new TabTransfers()
	const icons = loadApplicationIcons()
	if (process.platform === 'darwin') {
		app.dock?.setIcon(icons.application)
	}
	applicationWindows = new ApplicationWindows(
		path.join(currentDirectory, 'preload.cjs'),
		tabTransfers,
		icons.application,
		quitIntent
	)
	let applicationMenuLanguage = globalSettings.language
	installApplicationMenu(applicationWindows, applicationMenuLanguage)
	const activeSettingsService = settingsService
	unsubscribeApplicationSettings = activeSettingsService.subscribe(({ workspaceID }) => {
		if (workspaceID !== null) {
			return
		}
		void activeSettingsService
			.get(null)
			.then(({ colorMode, language }) => {
				nativeTheme.themeSource = colorMode
				applicationTray?.setLanguage(language)
				if (language !== applicationMenuLanguage && applicationWindows) {
					applicationMenuLanguage = language
					installApplicationMenu(applicationWindows, language)
				}
			})
			.catch((error: unknown) => {
				console.error('Application settings could not be applied.', error)
			})
	})
	unsubscribeIPC = registerKnowledgeIPC(
		workspaceManager,
		settingsService,
		mcpGateway,
		applicationWindows,
		tabTransfers
	)
	await registerApplicationProtocol()
	if (shutdownStarted) {
		return
	}
	applicationTray = new ApplicationTray(applicationWindows, globalSettings.language, icons.tray)
	await showInitialWindow()

	app.on('activate', () => {
		void focusCurrentOrShowInitialWindow().catch(reportStartupError)
	})
}

async function focusCurrentOrShowInitialWindow(): Promise<void> {
	if (shutdownStarted) {
		return
	}
	if (!applicationWindows || applicationWindows.focusCurrent()) {
		return
	}
	await showInitialWindow()
}

async function showInitialWindow(): Promise<void> {
	if (shutdownStarted || !workspaceManager || !applicationWindows) {
		return
	}
	const active = workspaceManager.activeWorkspace()
	if (active) {
		try {
			await workspaceManager.openWorkspace({ workspaceID: active.id })
			await applicationWindows.showWorkspace(active.id)
			return
		} catch {
			await applicationWindows.showSelector({ target: 'new-window' })
			return
		}
	}
	await applicationWindows.showSelector({ target: 'new-window' })
}

async function registerApplicationProtocol(): Promise<void> {
	const rendererRoot = path.join(app.getAppPath(), 'build')
	protocol.handle(applicationScheme, async (request) => {
		const url = new URL(request.url)
		if (url.host !== 'app') {
			return new Response('Not found', { status: 404 })
		}
		const relativePath = decodePathname(url.pathname)
		if (relativePath === null) {
			return new Response('Invalid path', { status: 400 })
		}

		const requestedPath = safeRendererPath(rendererRoot, relativePath)
		if (!requestedPath) {
			return new Response('Invalid path', { status: 400 })
		}
		if (await isFile(requestedPath)) {
			return net.fetch(pathToFileURL(requestedPath).href)
		}

		const acceptsHTML = request.headers.get('accept')?.includes('text/html') ?? false
		if (acceptsHTML || relativePath === '') {
			return net.fetch(pathToFileURL(path.join(rendererRoot, '200.html')).href)
		}
		return new Response('Not found', { status: 404 })
	})
}

function decodePathname(pathname: string): string | null {
	try {
		return decodeURIComponent(pathname).replace(/^\/+/, '')
	} catch {
		return null
	}
}

function safeRendererPath(root: string, relativePath: string): string | null {
	const candidate = path.resolve(root, relativePath || '200.html')
	const relative = path.relative(root, candidate)
	if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		return null
	}
	return candidate
}

async function isFile(candidate: string): Promise<boolean> {
	try {
		return (await stat(candidate)).isFile()
	} catch {
		return false
	}
}

function reportStartupError(error: unknown): void {
	console.error('Open Knowledge failed to start.', error)
	app.quit()
}

process.on('message', (message) => {
	if (message === 'electron-vite&type=hot-reload') {
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.reload()
		}
	}
})

app.on('will-quit', (event) => {
	if (shutdownComplete) {
		return
	}
	event.preventDefault()
	if (shutdownStarted) {
		return
	}
	shutdownStarted = true
	void shutdownApplication().finally(() => {
		shutdownComplete = true
		app.quit()
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

async function shutdownApplication(): Promise<void> {
	await startupPromise?.catch(() => undefined)
	unsubscribeApplicationSettings?.()
	unsubscribeApplicationSettings = undefined
	settingsService?.close()
	settingsService = null
	applicationTray?.destroy()
	applicationTray = null
	unsubscribeIPC?.()
	unsubscribeIPC = undefined
	await mcpGateway?.close().catch((error: unknown) => {
		console.error('The MCP server could not be closed cleanly.', error)
	})
	await workspaceManager?.close().catch((error: unknown) => {
		console.error('The workspace manager could not be closed cleanly.', error)
	})
}
