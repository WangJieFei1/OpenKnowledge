import { translation, type Translation } from '#lib/i18n/index.js'
import type { SaveState } from '#lib/workspace/document-draft.svelte.js'

type WindowTitleBarCatalog = Record<SaveState, string> & {
	hideSidebar: string
	showSidebar: string
	switchWorkspace: string
	reloadFromDisk: string
	saveDocument: string
	readonlyDocument: string
	convertToMarkdown: string
	editorMode: string
	richText: string
	markdownSource: string
	markdown: string
	commandPalette: string
	applicationSettings: string
	minimize: string
	restoreWindow: string
	maximizeWindow: string
	close: string
}

export const windowTitleBarTranslation = translation({
	en: {
		saved: 'Saved',
		dirty: 'Unsaved changes',
		saving: 'Saving',
		error: 'Save failed',
		conflict: 'Version conflict',
		hideSidebar: 'Hide sidebar',
		showSidebar: 'Show sidebar',
		switchWorkspace: 'Switch workspace',
		reloadFromDisk: 'Reload document',
		saveDocument: 'Save document',
		readonlyDocument: 'Read-only document',
		convertToMarkdown: 'Convert to Markdown',
		editorMode: 'Editor mode',
		richText: 'Rich text',
		markdownSource: 'Markdown source',
		markdown: 'Markdown',
		commandPalette: 'Command palette',
		applicationSettings: 'Application settings',
		minimize: 'Minimize',
		restoreWindow: 'Restore window',
		maximizeWindow: 'Maximize window',
		close: 'Close'
	},
	'zh-cn': {
		saved: '已保存',
		dirty: '有未保存的更改',
		saving: '正在保存',
		error: '保存失败',
		conflict: '版本冲突',
		hideSidebar: '隐藏侧边栏',
		showSidebar: '显示侧边栏',
		switchWorkspace: '切换工作区',
		reloadFromDisk: '重新加载文档',
		saveDocument: '保存文档',
		readonlyDocument: '只读文档',
		convertToMarkdown: '转换为 Markdown',
		editorMode: '编辑器模式',
		richText: '富文本',
		markdownSource: 'Markdown 源代码',
		markdown: 'Markdown',
		commandPalette: '命令面板',
		applicationSettings: '应用设置',
		minimize: '最小化',
		restoreWindow: '还原窗口',
		maximizeWindow: '最大化窗口',
		close: '关闭'
	}
} satisfies Translation<WindowTitleBarCatalog>)
