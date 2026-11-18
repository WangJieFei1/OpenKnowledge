import { translation } from '#lib/i18n/index.js'

export const fileTreeTranslation = translation({
	en: {
		workspaceFiles: 'Workspace files',
		noMatchingFiles: 'No matching files',
		workspaceEmpty: 'This workspace is empty',
		actionsFor: (name: string) => `Actions for ${name}`,
		workspaceActions: 'Workspace actions'
	},
	'zh-cn': {
		workspaceFiles: '工作区文件',
		noMatchingFiles: '没有匹配的文件',
		workspaceEmpty: '此工作区为空',
		actionsFor: (name: string) => `${name} 的操作`,
		workspaceActions: '工作区操作'
	}
})
