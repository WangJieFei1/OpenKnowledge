import { describe, expect, test } from 'bun:test'
import { displayShortcut } from '../application-command'
import {
	resolveWorkspaceShortcut,
	type WorkspaceShortcutCommandID,
	type WorkspaceShortcutInput
} from './workspace-shortcuts'

type ModShortcutCase = {
	key: string
	shiftKey?: boolean
	workspace: WorkspaceShortcutCommandID | null
	editor: WorkspaceShortcutCommandID | null
}

const modShortcutMatrix: ModShortcutCase[] = [
	{ key: 'P', shiftKey: true, workspace: 'app.command-palette', editor: 'app.command-palette' },
	{ key: 'p', workspace: 'app.command-palette', editor: 'app.command-palette' },
	{ key: 'k', workspace: 'app.command-palette', editor: 'app.command-palette' },
	{ key: 'n', shiftKey: true, workspace: 'workspace.new-window', editor: null },
	{ key: 'o', shiftKey: true, workspace: 'workspace.switch', editor: null },
	{ key: 'w', shiftKey: true, workspace: 'window.close', editor: 'window.close' },
	{ key: 'n', workspace: 'file.new-document', editor: null },
	{ key: 's', workspace: 'document.save', editor: 'document.save' },
	{ key: 'w', workspace: 'document.close', editor: 'document.close' },
	{ key: 'b', workspace: 'view.sidebar', editor: null },
	{ key: ',', workspace: 'view.settings', editor: 'view.settings' }
]

function shortcut(
	key: string,
	overrides: Partial<Omit<WorkspaceShortcutInput, 'key'>> = {}
): WorkspaceShortcutInput {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...overrides
	}
}

describe('resolveWorkspaceShortcut', () => {
	for (const [platform, modifier] of [
		['macos', 'metaKey'],
		['other', 'ctrlKey']
	] as const) {
		test(`resolves the ${platform} ${modifier} command matrix for workspace and editor windows`, () => {
			for (const entry of modShortcutMatrix) {
				const input = shortcut(entry.key, {
					[modifier]: true,
					shiftKey: entry.shiftKey ?? false
				})
				expect(resolveWorkspaceShortcut(input, false, platform)).toBe(entry.workspace)
				expect(resolveWorkspaceShortcut(input, true, platform)).toBe(entry.editor)
			}
		})
	}

	test('resolves function-key and control-tab shortcuts exactly', () => {
		const matrix: Array<{
			input: WorkspaceShortcutInput
			expected: WorkspaceShortcutCommandID | null
		}> = [
			{ input: shortcut('F1'), expected: 'app.command-palette' },
			{ input: shortcut('Tab', { ctrlKey: true }), expected: 'view.next-tab' },
			{
				input: shortcut('Tab', { ctrlKey: true, shiftKey: true }),
				expected: 'view.previous-tab'
			},
			{ input: shortcut('Tab', { metaKey: true }), expected: null },
			{ input: shortcut('tab', { ctrlKey: true }), expected: null }
		]

		for (const platform of ['macos', 'other'] as const) {
			for (const entry of matrix) {
				expect(resolveWorkspaceShortcut(entry.input, false, platform)).toBe(entry.expected)
				expect(resolveWorkspaceShortcut(entry.input, true, platform)).toBe(entry.expected)
			}
		}
	})

	test('does not resolve incomplete or unsupported modifier combinations', () => {
		const matrix = [
			shortcut('s'),
			shortcut('s', { ctrlKey: true, shiftKey: true }),
			shortcut('k', { metaKey: true, shiftKey: true }),
			shortcut(',', { ctrlKey: true, shiftKey: true }),
			shortcut('s', { ctrlKey: true, metaKey: true }),
			shortcut('Tab', { ctrlKey: true, metaKey: true }),
			shortcut('F1', { ctrlKey: true }),
			shortcut('F1', { metaKey: true }),
			shortcut('F1', { shiftKey: true }),
			shortcut('F2')
		]

		for (const platform of ['macos', 'other'] as const) {
			for (const input of matrix) {
				expect(resolveWorkspaceShortcut(input, false, platform)).toBeNull()
				expect(resolveWorkspaceShortcut(input, true, platform)).toBeNull()
			}
		}
	})

	test('leaves macOS Control editing keys and non-macOS system keys untouched', () => {
		for (const entry of modShortcutMatrix) {
			for (const editorWindow of [false, true]) {
				const control = shortcut(entry.key, { ctrlKey: true, shiftKey: entry.shiftKey ?? false })
				const command = shortcut(entry.key, { metaKey: true, shiftKey: entry.shiftKey ?? false })
				expect(resolveWorkspaceShortcut(control, editorWindow, 'macos')).toBeNull()
				expect(resolveWorkspaceShortcut(command, editorWindow, 'other')).toBeNull()
			}
		}
	})

	test('does not intercept Option/Alt combinations or composing input', () => {
		for (const [platform, modifier] of [
			['macos', 'metaKey'],
			['other', 'ctrlKey']
		] as const) {
			for (const entry of modShortcutMatrix) {
				for (const blocked of [{ altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
					const input = shortcut(entry.key, {
						[modifier]: true,
						shiftKey: entry.shiftKey ?? false,
						...blocked
					})
					expect(resolveWorkspaceShortcut(input, false, platform)).toBeNull()
					expect(resolveWorkspaceShortcut(input, true, platform)).toBeNull()
				}
			}
			for (const blocked of [{ altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
				expect(resolveWorkspaceShortcut(shortcut('F1', blocked), false, platform)).toBeNull()
				expect(
					resolveWorkspaceShortcut(shortcut('Tab', { ctrlKey: true, ...blocked }), false, platform)
				).toBeNull()
			}
		}
	})

	test('lets editor-handled Bold take precedence over the sidebar shortcut', () => {
		for (const [platform, modifier] of [
			['macos', 'metaKey'],
			['other', 'ctrlKey']
		] as const) {
			const editorHandled = shortcut('b', { [modifier]: true, defaultPrevented: true })
			expect(resolveWorkspaceShortcut(editorHandled, false, platform)).toBeNull()
			const outsideEditor = shortcut('b', { [modifier]: true })
			expect(resolveWorkspaceShortcut(outsideEditor, false, platform)).toBe('view.sidebar')
		}
	})
})

describe('displayShortcut', () => {
	test('uses explicit macOS capabilities and native modifier order', () => {
		expect(displayShortcut('Mod+B', true)).toBe('⌘B')
		expect(displayShortcut('Mod+Shift+P', true)).toBe('⇧⌘P')
		expect(displayShortcut('Ctrl+Shift+Tab', true)).toBe('⌃⇧⇥')
		expect(displayShortcut('Mod+Alt+Enter', true)).toBe('⌥⌘↩')
	})
	test('retains Control labels outside macOS without browser sniffing', () => {
		expect(displayShortcut('Mod+B', false)).toBe('Ctrl+B')
		expect(displayShortcut('Mod+Shift+P', false)).toBe('Ctrl+Shift+P')
		expect(displayShortcut('Ctrl+Shift+Tab', false)).toBe('Ctrl+Shift+Tab')
	})
})
