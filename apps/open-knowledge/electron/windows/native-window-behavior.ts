import type { BrowserWindowConstructorOptions } from 'electron'
import { applicationBackgroundColors, type ApplicationThemeMode } from '../../src/lib/theme/theme'
import type { WindowRole } from '../../src/lib/window/api'
import { channels } from '../channels'

export function nativeWindowChrome(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
	return platform === 'darwin'
		? { frame: true, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } }
		: { frame: false }
}

type WindowDimensions = { width: number; height: number; minWidth: number; minHeight: number }
type WorkArea = { x: number; y: number; width: number; height: number }

/** Leave 24px on each side; on very small displays visibility wins over the usual UI minimum. */
export function fitNativeWindowToWorkArea(dimensions: WindowDimensions, workArea: WorkArea) {
	const availableWidth = Math.max(1, workArea.width - 48)
	const availableHeight = Math.max(1, workArea.height - 48)
	const width = Math.min(dimensions.width, availableWidth)
	const height = Math.min(dimensions.height, availableHeight)
	return {
		width,
		height,
		minWidth: Math.min(dimensions.minWidth, availableWidth),
		minHeight: Math.min(dimensions.minHeight, availableHeight),
		x: Math.round(workArea.x + (workArea.width - width) / 2),
		y: Math.round(workArea.y + (workArea.height - height) / 2)
	}
}

type CommandTarget = {
	isDestroyed(): boolean
	send(channel: string, commandID: string): void
}
type MenuWindow = {
	isDestroyed(): boolean
	close(): void
	webContents: CommandTarget
}

export function closeFromApplicationMenu(
	window: MenuWindow | null,
	role: WindowRole | null,
	commandID: 'document.close' | 'window.close'
): void {
	if (!window || !role || window.isDestroyed()) {
		return
	}
	if (role === 'workspace') {
		if (!window.webContents.isDestroyed()) {
			window.webContents.send(channels.applicationCommand, commandID)
		}
	} else {
		window.close()
	}
}

/** Keep the native close blocked until the existing renderer save flow succeeds. */
export function retryPreventedWorkspaceClose(webContents: CommandTarget, role: WindowRole): void {
	if (role === 'workspace' && !webContents.isDestroyed()) {
		webContents.send(channels.applicationCommand, 'window.close')
	}
}

/** A blocked reload/navigation must never be mistaken for an explicit native close. */
export class NativeWindowCloseIntent {
	private closing = false

	constructor(private readonly onBlockedClose: () => void) {}

	requestClose(): void {
		this.closing = true
	}

	preventUnload(): void {
		if (this.closing) {
			this.closing = false
			this.onBlockedClose()
		}
	}
}

type BackgroundWindow = {
	isDestroyed(): boolean
	setBackgroundColor(color: string): void
	once(event: 'closed', listener: () => void): unknown
}
type ThemeSource = {
	readonly shouldUseDarkColors: boolean
	on(event: 'updated', listener: () => void): unknown
	off(event: 'updated', listener: () => void): unknown
}

export function synchronizeWindowBackground(
	window: BackgroundWindow,
	theme: ThemeSource
): (mode: ApplicationThemeMode) => void {
	let colorMode: ApplicationThemeMode = 'system'
	const update = () => {
		if (window.isDestroyed()) {
			return
		}
		const dark = colorMode === 'dark' || (colorMode === 'system' && theme.shouldUseDarkColors)
		window.setBackgroundColor(
			dark ? applicationBackgroundColors.dark : applicationBackgroundColors.light
		)
	}
	theme.on('updated', update)
	window.once('closed', () => theme.off('updated', update))
	update()
	return (mode) => {
		colorMode = mode
		update()
	}
}

export function isTrustedRendererURL(value: string, developmentURL?: string): boolean {
	try {
		const url = new URL(value)
		if (url.username || url.password) {
			return false
		}
		if (developmentURL) {
			const development = new URL(developmentURL)
			return ['http:', 'https:'].includes(development.protocol) && url.origin === development.origin
		}
		return url.protocol === 'open-knowledge:' && url.host === 'app'
	} catch {
		return false
	}
}

/** Writing a copied connection string is the only browser permission the UI needs. */
export function allowsRendererPermission(
	permission: string,
	isMainFrame: boolean,
	requestingURL: string,
	contentsURL: string,
	developmentURL?: string
): boolean {
	return (
		permission === 'clipboard-sanitized-write' &&
		isMainFrame &&
		isTrustedRendererURL(requestingURL, developmentURL) &&
		isTrustedRendererURL(contentsURL, developmentURL)
	)
}
