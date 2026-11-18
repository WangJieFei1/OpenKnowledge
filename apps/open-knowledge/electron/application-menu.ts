import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { ApplicationLanguage } from '../src/lib/settings/api'
import { channels } from './channels'
import type { ApplicationWindows } from './windows/application-windows'
import { closeFromApplicationMenu } from './windows/native-window-behavior'

const formatSpecificationURL =
	'https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md'

const menuLabels = {
	en: {
		file: 'File',
		newDocument: 'New Document',
		newFolder: 'New Folder',
		switchWorkspace: 'Switch Workspace…',
		openWorkspaceWindow: 'Open Workspace in New Window…',
		openDocumentWindow: 'Open Document in Dedicated Window',
		revealWorkspace: 'Reveal Workspace in Finder',
		save: 'Save',
		close: 'Close',
		closeWindow: 'Close Window',
		edit: 'Edit',
		commandPalette: 'Command Palette…',
		view: 'View',
		showSidebar: 'Show Sidebar',
		previousTab: 'Previous Tab',
		nextTab: 'Next Tab',
		richText: 'Rich Text',
		markdownSource: 'Markdown Source',
		darkTheme: 'Dark Theme',
		settings: 'Settings…',
		mcp: 'MCP',
		includeWorkspace: 'Include Current Workspace',
		allowWorkspaceEditing: 'Allow Editing Current Workspace',
		mcpSettings: 'MCP Settings…',
		window: 'Window',
		help: 'Help',
		formatSpecification: 'Open Knowledge Format Specification',
		keyboardQuickActions: 'Show Keyboard Quick Actions'
	},
	'zh-cn': {
		file: '文件',
		newDocument: '新建文档',
		newFolder: '新建文件夹',
		switchWorkspace: '切换工作区…',
		openWorkspaceWindow: '在新窗口中打开工作区…',
		openDocumentWindow: '在独立窗口中打开文档',
		revealWorkspace: '在访达中显示工作区',
		save: '保存',
		close: '关闭',
		closeWindow: '关闭窗口',
		edit: '编辑',
		commandPalette: '命令面板…',
		view: '视图',
		showSidebar: '显示侧边栏',
		previousTab: '上一个标签页',
		nextTab: '下一个标签页',
		richText: '富文本',
		markdownSource: 'Markdown 源代码',
		darkTheme: '深色主题',
		settings: '设置…',
		mcp: 'MCP',
		includeWorkspace: '包含当前工作区',
		allowWorkspaceEditing: '允许编辑当前工作区',
		mcpSettings: 'MCP 设置…',
		window: '窗口',
		help: '帮助',
		formatSpecification: 'Open Knowledge 格式规范',
		keyboardQuickActions: '显示键盘快捷操作'
	}
} as const

export function installApplicationMenu(
	windows: ApplicationWindows,
	language: ApplicationLanguage
): void {
	if (process.platform !== 'darwin') {
		Menu.setApplicationMenu(null)
		return
	}

	const labels = menuLabels[language]
	const dispatch = (commandID: string): void => {
		const focusedWindow = BrowserWindow.getFocusedWindow()
		if (!focusedWindow || windows.roleFor(focusedWindow.webContents) !== 'workspace') {
			return
		}
		focusedWindow.webContents.send(channels.applicationCommand, commandID)
	}
	const command = (
		label: string,
		commandID: string,
		accelerator?: string
	): MenuItemConstructorOptions => ({
		label,
		accelerator,
		click: () => dispatch(commandID)
	})
	const closeCommand = (
		label: string,
		commandID: 'document.close' | 'window.close',
		accelerator: string
	): MenuItemConstructorOptions => ({
		label,
		accelerator,
		click: () => {
			const window = BrowserWindow.getFocusedWindow()
			closeFromApplicationMenu(
				window,
				window ? windows.roleFor(window.webContents) : null,
				commandID
			)
		}
	})

	const template: MenuItemConstructorOptions[] = [
		{
			label: app.name,
			submenu: [
				{ role: 'about' },
				{ type: 'separator' },
				{
					label: labels.settings,
					accelerator: 'Command+,',
					click: () => {
						void windows
							.showApplicationSettings(windows.focusedSettingsWorkspaceID())
							.catch((error: unknown) => {
								console.error('Application settings could not be opened from the menu.', error)
							})
					}
				},
				{ type: 'separator' },
				{ role: 'services', submenu: [] },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		},
		{
			label: labels.file,
			submenu: [
				command(labels.newDocument, 'file.new-document', 'Command+N'),
				command(labels.newFolder, 'file.new-folder'),
				{ type: 'separator' },
				command(labels.switchWorkspace, 'workspace.switch', 'Command+Shift+O'),
				command(labels.openWorkspaceWindow, 'workspace.new-window', 'Command+Shift+N'),
				command(labels.openDocumentWindow, 'document.new-window'),
				command(labels.revealWorkspace, 'workspace.reveal'),
				{ type: 'separator' },
				command(labels.save, 'document.save', 'Command+S'),
				closeCommand(labels.close, 'document.close', 'Command+W'),
				closeCommand(labels.closeWindow, 'window.close', 'Command+Shift+W')
			]
		},
		{
			label: labels.edit,
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				{ role: 'selectAll' },
				{ type: 'separator' },
				command(labels.commandPalette, 'app.command-palette', 'Command+Shift+P')
			]
		},
		{
			label: labels.view,
			submenu: [
				// Leave Command-B to the renderer so a rich-text editor can consume Bold first.
				// registerAccelerator:false does not disable native accelerators on macOS.
				command(labels.showSidebar, 'view.sidebar'),
				{ type: 'separator' },
				command(labels.previousTab, 'view.previous-tab', 'Control+Shift+Tab'),
				command(labels.nextTab, 'view.next-tab', 'Control+Tab'),
				{ type: 'separator' },
				command(labels.richText, 'view.rich-text'),
				command(labels.markdownSource, 'view.markdown'),
				{ type: 'separator' },
				command(labels.darkTheme, 'view.dark-theme'),
				{ type: 'separator' },
				{ role: 'togglefullscreen' }
			]
		},
		{
			label: labels.mcp,
			submenu: [
				command(labels.includeWorkspace, 'mcp.workspace-read'),
				command(labels.allowWorkspaceEditing, 'mcp.workspace-write'),
				{ type: 'separator' },
				{
					label: labels.mcpSettings,
					click: () => {
						void windows.showMCPSettings().catch((error: unknown) => {
							console.error('MCP settings could not be opened from the menu.', error)
						})
					}
				}
			]
		},
		{
			label: labels.window,
			submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
		},
		{
			label: labels.help,
			submenu: [
				{
					label: labels.formatSpecification,
					click: () => {
						void shell.openExternal(formatSpecificationURL)
					}
				},
				command(labels.keyboardQuickActions, 'help.shortcuts', 'F1')
			]
		}
	]

	Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
