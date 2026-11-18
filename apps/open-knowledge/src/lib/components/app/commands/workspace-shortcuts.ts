export type WorkspaceShortcutInput = {
	key: string
	ctrlKey: boolean
	metaKey: boolean
	shiftKey: boolean
	altKey?: boolean
	defaultPrevented?: boolean
	isComposing?: boolean
	keyCode?: number
}

export type WorkspaceShortcutPlatform = 'macos' | 'other'

export type WorkspaceShortcutCommandID =
	| 'app.command-palette'
	| 'workspace.new-window'
	| 'workspace.switch'
	| 'window.close'
	| 'file.new-document'
	| 'document.save'
	| 'document.close'
	| 'view.previous-tab'
	| 'view.next-tab'
	| 'view.sidebar'
	| 'view.settings'

export function resolveWorkspaceShortcut(
	input: WorkspaceShortcutInput,
	editorWindow: boolean,
	platform: WorkspaceShortcutPlatform
): WorkspaceShortcutCommandID | null {
	if (input.defaultPrevented || input.altKey || input.isComposing || input.keyCode === 229) {
		return null
	}
	const mod =
		platform === 'macos' ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey
	const key = input.key.toLowerCase()

	if (
		(input.key === 'F1' && !input.ctrlKey && !input.metaKey && !input.shiftKey) ||
		(mod && input.shiftKey && key === 'p')
	) {
		return 'app.command-palette'
	}
	if (mod && !input.shiftKey && (key === 'k' || key === 'p')) {
		return 'app.command-palette'
	}
	if (!editorWindow && mod && input.shiftKey && key === 'n') {
		return 'workspace.new-window'
	}
	if (!editorWindow && mod && input.shiftKey && key === 'o') {
		return 'workspace.switch'
	}
	if (mod && input.shiftKey && key === 'w') {
		return 'window.close'
	}
	if (!editorWindow && mod && !input.shiftKey && key === 'n') {
		return 'file.new-document'
	}
	if (mod && !input.shiftKey && key === 's') {
		return 'document.save'
	}
	if (mod && !input.shiftKey && key === 'w') {
		return 'document.close'
	}
	if (input.ctrlKey && !input.metaKey && input.key === 'Tab') {
		return input.shiftKey ? 'view.previous-tab' : 'view.next-tab'
	}
	if (!editorWindow && mod && !input.shiftKey && key === 'b') {
		return 'view.sidebar'
	}
	if (mod && !input.shiftKey && input.key === ',') {
		return 'view.settings'
	}
	return null
}
