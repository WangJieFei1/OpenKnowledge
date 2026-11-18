import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { applicationBackgroundColors } from '../../src/lib/theme/theme'
import type { WindowRole } from '../../src/lib/window/api'
import { channels } from '../channels'
import {
	allowsRendererPermission,
	closeFromApplicationMenu,
	fitNativeWindowToWorkArea,
	isTrustedRendererURL,
	NativeWindowCloseIntent,
	nativeWindowChrome,
	retryPreventedWorkspaceClose,
	synchronizeWindowBackground
} from './native-window-behavior'

function commandWindow() {
	const sent: [string, string][] = []
	return {
		closed: false,
		destroyed: false,
		isDestroyed() {
			return this.destroyed
		},
		close() {
			this.closed = true
		},
		webContents: {
			isDestroyed: () => false,
			send: (channel: string, command: string) => {
				sent.push([channel, command])
			}
		},
		sent
	}
}

describe('native macOS window behavior', () => {
	test('fits initial window inside the selected work area with margins and usable minimums', () => {
		const dimensions = { width: 1440, height: 900, minWidth: 960, minHeight: 640 }
		expect(
			fitNativeWindowToWorkArea(dimensions, { x: 0, y: 25, width: 1280, height: 750 })
		).toEqual({
			width: 1232,
			height: 702,
			minWidth: 960,
			minHeight: 640,
			x: 24,
			y: 49
		})
		expect(
			fitNativeWindowToWorkArea(dimensions, { x: -1920, y: 25, width: 1920, height: 1055 })
		).toEqual({
			...dimensions,
			x: -1680,
			y: 103
		})
		const small = fitNativeWindowToWorkArea(dimensions, { x: 0, y: 0, width: 900, height: 600 })
		expect(small).toEqual({ width: 852, height: 552, minWidth: 852, minHeight: 552, x: 24, y: 24 })
	})

	test('uses native macOS controls while retaining existing non-macOS frames', () => {
		expect(nativeWindowChrome('darwin')).toEqual({
			frame: true,
			titleBarStyle: 'hiddenInset',
			trafficLightPosition: { x: 14, y: 16 }
		})
		expect(nativeWindowChrome('win32')).toEqual({ frame: false })
		expect(nativeWindowChrome('linux')).toEqual({ frame: false })
	})

	test('menu close keeps workspace save flow and closes utility windows natively', () => {
		for (const command of ['document.close', 'window.close'] as const) {
			const workspace = commandWindow()
			closeFromApplicationMenu(workspace, 'workspace', command)
			expect(workspace.closed).toBe(false)
			expect(workspace.sent).toEqual([[channels.applicationCommand, command]])
			for (const role of ['selector', 'mcp', 'settings'] as const satisfies readonly WindowRole[]) {
				const utility = commandWindow()
				closeFromApplicationMenu(utility, role, command)
				expect(utility.closed).toBe(true)
				expect(utility.sent).toEqual([])
			}
		}
	})

	test('menu close does not act on destroyed or unregistered windows', () => {
		const window = commandWindow()
		closeFromApplicationMenu(window, null, 'window.close')
		window.destroyed = true
		closeFromApplicationMenu(window, 'settings', 'window.close')
		closeFromApplicationMenu(null, null, 'window.close')
		expect(window.closed).toBe(false)
		expect(window.sent).toEqual([])
	})

	test('a prevented workspace close requests saving without forcing native close', () => {
		const window = commandWindow()
		retryPreventedWorkspaceClose(window.webContents, 'workspace')
		expect(window.sent).toEqual([[channels.applicationCommand, 'window.close']])
		expect(window.closed).toBe(false)
		retryPreventedWorkspaceClose(window.webContents, 'settings')
		expect(window.sent).toHaveLength(1)
	})

	test('blocked reloads never trigger saving-and-closing, including after a failed native close', () => {
		const window = commandWindow()
		const intent = new NativeWindowCloseIntent(() => {
			retryPreventedWorkspaceClose(window.webContents, 'workspace')
		})
		intent.preventUnload()
		expect(window.sent).toEqual([])
		intent.requestClose()
		intent.preventUnload()
		expect(window.sent).toEqual([[channels.applicationCommand, 'window.close']])
		// Failed saving leaves the window open; a subsequent blocked reload is a separate action.
		intent.preventUnload()
		expect(window.sent).toHaveLength(1)
		expect(window.closed).toBe(false)
	})

	test('background tracks native appearance, respects explicit modes, and removes its listener', () => {
		const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
		const colors: string[] = []
		const window = Object.assign(new EventEmitter(), {
			isDestroyed: () => false,
			setBackgroundColor: (color: string) => {
				colors.push(color)
			}
		})
		const setMode = synchronizeWindowBackground(window, theme)
		expect(colors.at(-1)).toBe(applicationBackgroundColors.light)
		theme.shouldUseDarkColors = true
		theme.emit('updated')
		expect(colors.at(-1)).toBe(applicationBackgroundColors.dark)
		setMode('light')
		theme.emit('updated')
		expect(colors.at(-1)).toBe(applicationBackgroundColors.light)
		setMode('system')
		expect(colors.at(-1)).toBe(applicationBackgroundColors.dark)
		window.emit('closed')
		expect(theme.listenerCount('updated')).toBe(0)
	})
})

describe('renderer permission scope', () => {
	test('allows only clipboard writes from the trusted application main frame', () => {
		const url = 'open-knowledge://app/mcp'
		expect(allowsRendererPermission('clipboard-sanitized-write', true, url, url)).toBe(true)
		for (const permission of [
			'clipboard-read',
			'media',
			'notifications',
			'fileSystem',
			'geolocation',
			'fullscreen'
		]) {
			expect(allowsRendererPermission(permission, true, url, url)).toBe(false)
		}
		expect(allowsRendererPermission('clipboard-sanitized-write', false, url, url)).toBe(false)
		for (const untrusted of [
			'https://example.com',
			'http://localhost:5173',
			'file:///tmp/a.html',
			'open-knowledge://other/mcp',
			'open-knowledge://user@app/mcp'
		]) {
			expect(allowsRendererPermission('clipboard-sanitized-write', true, untrusted, url)).toBe(
				false
			)
			expect(allowsRendererPermission('clipboard-sanitized-write', true, url, untrusted)).toBe(
				false
			)
		}
	})

	test('development permission and navigation trust stay within the configured origin', () => {
		const development = 'http://localhost:5173/'
		const url = 'http://localhost:5173/mcp'
		expect(isTrustedRendererURL(url, development)).toBe(true)
		expect(allowsRendererPermission('clipboard-sanitized-write', true, url, url, development)).toBe(
			true
		)
		for (const untrusted of [
			'http://localhost:5174/mcp',
			'http://localhost.evil:5173/mcp',
			'file:///tmp/a.html',
			'open-knowledge://app/mcp'
		]) {
			expect(isTrustedRendererURL(untrusted, development)).toBe(false)
		}
		expect(isTrustedRendererURL('file:///tmp/b.html', 'file:///tmp/a.html')).toBe(false)
	})
})
