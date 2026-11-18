import { translation } from '#lib/i18n/index.js'

export const documentTabsTranslation = translation({
	en: {
		document: 'Document',
		openDocuments: 'Open documents',
		unsaved: 'Unsaved',
		actionsFor: (name: string) => `Actions for ${name}`,
		openDedicated: 'Open in dedicated window',
		close: 'Close',
		closeOtherTabs: 'Close other tabs',
		closeTabsRight: 'Close tabs to the right'
	},
	'zh-cn': {
		document: '文档',
		openDocuments: '打开的文档',
		unsaved: '未保存',
		actionsFor: (name: string) => `${name} 的操作`,
		openDedicated: '在独立窗口中打开',
		close: '关闭',
		closeOtherTabs: '关闭其他标签页',
		closeTabsRight: '关闭右侧标签页'
	}
})
