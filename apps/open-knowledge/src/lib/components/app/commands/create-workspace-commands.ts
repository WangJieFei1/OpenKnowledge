import type { WindowEditActionInput } from '#lib/window/api.js'
import type { WorkspaceSession } from '#lib/workspace/workspace-session.svelte.js'
import { appShellTranslation as t } from '../AppShell.translation'
import type { ApplicationCommand } from '../application-command'

type CreateKind = 'file' | 'directory'

type WorkspaceCommandActions = {
	create(kind: CreateKind): void
	closeWindow(): Promise<void>
	edit(action: WindowEditActionInput['action']): Promise<void>
	openExternal(url: string): void
	openPalette(): void
	openSettings(): Promise<void>
}

type CreateWorkspaceCommandsOptions = {
	session: WorkspaceSession
	editorWindow: boolean
	workspaceID: string
	sidebarShown: boolean
	darkTheme: boolean
	actions: WorkspaceCommandActions
}

function localizedKeywords(value: string): string[] {
	return value.split('|')
}

export function createWorkspaceCommands({
	session,
	editorWindow,
	workspaceID,
	sidebarShown,
	darkTheme,
	actions
}: CreateWorkspaceCommandsOptions): ApplicationCommand[] {
	const activeDocument = Boolean(session.document)
	const items: ApplicationCommand[] = [
		{
			id: 'file.new-document',
			label: t.newDocumentCommand,
			group: 'File',
			shortcut: 'Mod+N',
			disabled: !session.editable,
			keywords: localizedKeywords(t.newDocumentKeywords),
			run: () => actions.create('file')
		},
		{
			id: 'file.new-folder',
			label: t.newFolderCommand,
			group: 'File',
			disabled: !session.editable,
			keywords: localizedKeywords(t.newFolderKeywords),
			run: () => actions.create('directory')
		},
		{
			id: 'workspace.switch',
			label: t.switchWorkspaceCommand,
			group: 'File',
			separatorBefore: true,
			shortcut: 'Mod+Shift+O',
			keywords: localizedKeywords(t.switchWorkspaceKeywords),
			run: () => session.openWorkspaceSelector('replace-current-window')
		},
		{
			id: 'workspace.new-window',
			label: t.openWorkspaceNewWindowCommand,
			group: 'File',
			shortcut: 'Mod+Shift+N',
			keywords: localizedKeywords(t.newWorkspaceWindowKeywords),
			run: () => session.openWorkspaceSelector('new-window')
		},
		{
			id: 'document.new-window',
			label: t.openDocumentDedicatedCommand,
			group: 'File',
			disabled: !activeDocument,
			keywords: localizedKeywords(t.documentWindowKeywords),
			run: () => session.openDocumentInNewWindow()
		},
		{
			id: 'workspace.reveal',
			label: t.revealWorkspaceCommand,
			group: 'File',
			keywords: localizedKeywords(t.revealWorkspaceKeywords),
			disabled: !session.local,
			run: () => session.revealWorkspace()
		},
		{
			id: 'document.save',
			label: t.saveCommand,
			group: 'File',
			separatorBefore: true,
			shortcut: 'Mod+S',
			disabled: !session.documentEditable || !activeDocument || session.saveState === 'saved',
			run: () => session.save()
		},
		{
			id: 'document.close',
			label: editorWindow ? t.closeWindowCommand : t.closeTabCommand,
			group: 'File',
			shortcut: 'Mod+W',
			disabled: editorWindow ? false : !session.activeTab,
			run: editorWindow ? actions.closeWindow : () => session.closeActiveTab()
		},
		{
			id: 'window.close',
			label: t.closeWindowCommand,
			group: 'File',
			separatorBefore: true,
			shortcut: 'Mod+Shift+W',
			run: actions.closeWindow
		},
		{
			id: 'edit.undo',
			label: t.undoCommand,
			group: 'Edit',
			shortcut: 'Mod+Z',
			run: () => actions.edit('undo')
		},
		{
			id: 'edit.redo',
			label: t.redoCommand,
			group: 'Edit',
			shortcut: 'Mod+Shift+Z',
			run: () => actions.edit('redo')
		},
		{
			id: 'edit.cut',
			label: t.cutCommand,
			group: 'Edit',
			separatorBefore: true,
			shortcut: 'Mod+X',
			run: () => actions.edit('cut')
		},
		{
			id: 'edit.copy',
			label: t.copyCommand,
			group: 'Edit',
			shortcut: 'Mod+C',
			run: () => actions.edit('copy')
		},
		{
			id: 'edit.paste',
			label: t.pasteCommand,
			group: 'Edit',
			shortcut: 'Mod+V',
			run: () => actions.edit('paste')
		},
		{
			id: 'edit.select-all',
			label: t.selectAllCommand,
			group: 'Edit',
			shortcut: 'Mod+A',
			run: () => actions.edit('select-all')
		},
		{
			id: 'app.command-palette',
			label: t.commandPaletteCommand,
			group: 'Edit',
			separatorBefore: true,
			shortcut: 'Mod+Shift+P',
			keywords: localizedKeywords(t.commandPaletteKeywords),
			run: actions.openPalette
		},
		{
			id: 'view.sidebar',
			label: t.showSidebarCommand,
			group: 'View',
			shortcut: 'Mod+B',
			checked: sidebarShown,
			disabled: editorWindow,
			run: () => session.updateSettings({ sidebarVisible: !session.settings.sidebarVisible })
		},
		{
			id: 'view.previous-tab',
			label: t.previousTabCommand,
			group: 'View',
			separatorBefore: true,
			shortcut: 'Ctrl+Shift+Tab',
			disabled: session.tabs.length < 2,
			run: () => session.selectAdjacentTab(-1)
		},
		{
			id: 'view.next-tab',
			label: t.nextTabCommand,
			group: 'View',
			shortcut: 'Ctrl+Tab',
			disabled: session.tabs.length < 2,
			run: () => session.selectAdjacentTab(1)
		},
		{
			id: 'view.rich-text',
			label: t.richTextCommand,
			group: 'View',
			separatorBefore: true,
			checked: activeDocument && session.editorMode === 'rich',
			disabled: !activeDocument || session.documentRendered || session.documentUnsupported,
			run: () => session.setEditorMode('rich')
		},
		{
			id: 'view.markdown',
			label: t.markdownSourceCommand,
			group: 'View',
			checked: activeDocument && session.editorMode === 'source',
			disabled: !activeDocument || session.documentRendered || session.documentUnsupported,
			run: () => session.setEditorMode('source')
		},
		{
			id: 'view.dark-theme',
			label: t.darkThemeCommand,
			group: 'View',
			separatorBefore: true,
			checked: darkTheme,
			keywords: localizedKeywords(t.darkThemeKeywords),
			run: () => session.updateSettings({ colorMode: darkTheme ? 'light' : 'dark' })
		},
		{
			id: 'view.settings',
			label: t.settings,
			group: 'View',
			shortcut: 'Mod+,',
			run: actions.openSettings
		},
		{
			id: 'mcp.workspace-off',
			label: t.mcpAccessOffCommand,
			group: 'MCP',
			checked: session.mcpStatus?.access === 'off',
			disabled: !session.local || !session.mcpStatus,
			run: () => session.updateMCPAccess('off')
		},
		{
			id: 'mcp.workspace-read',
			label: t.mcpAccessReadCommand,
			group: 'MCP',
			checked: session.mcpStatus?.access === 'read',
			disabled: !session.local || !session.mcpStatus,
			run: () => session.updateMCPAccess('read')
		},
		{
			id: 'mcp.workspace-write',
			label: t.mcpAccessWriteCommand,
			group: 'MCP',
			checked: session.mcpStatus?.access === 'write',
			disabled: !session.local || !session.mcpStatus,
			run: () => session.updateMCPAccess('write')
		},
		{
			id: 'mcp.settings',
			label: t.mcpSettingsCommand,
			group: 'MCP',
			separatorBefore: true,
			keywords: localizedKeywords(t.mcpSettingsKeywords),
			run: () => session.openMCPSettings()
		},
		{
			id: 'help.format',
			label: t.formatSpecificationCommand,
			group: 'Help',
			keywords: localizedKeywords(t.formatKeywords),
			run: () =>
				actions.openExternal(
					'https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md'
				)
		},
		{
			id: 'help.shortcuts',
			label: t.keyboardQuickActionsCommand,
			group: 'Help',
			shortcut: 'F1',
			run: actions.openPalette
		}
	]

	if (editorWindow) {
		return items.filter(
			(command) =>
				command.id === 'document.save' ||
				command.id === 'document.close' ||
				command.id === 'window.close' ||
				command.id.startsWith('edit.') ||
				command.id === 'app.command-palette' ||
				command.id === 'view.rich-text' ||
				command.id === 'view.markdown' ||
				command.id === 'view.dark-theme' ||
				command.id === 'view.settings' ||
				command.id.startsWith('mcp.') ||
				command.id.startsWith('help.')
		)
	}

	if (workspaceID) {
		for (const entry of session.entries) {
			if (entry.kind !== 'file') {
				continue
			}
			items.push({
				id: `open:${entry.path}`,
				label: entry.name.replace(/\.md$/i, ''),
				group: 'Open',
				paletteOnly: true,
				keywords: [entry.path, ...localizedKeywords(t.openDocumentKeywords)],
				run: () => session.openReference(entry.path)
			})
		}
	}
	return items
}
