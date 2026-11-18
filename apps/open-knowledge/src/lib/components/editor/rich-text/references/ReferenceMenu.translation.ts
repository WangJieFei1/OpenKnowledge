import { translation } from '#lib/i18n/index.js'

export const referenceMenuTranslation = translation({
	en: {
		menuLabel: 'Workspace files and folders',
		heading: 'Link a file or folder',
		empty: 'No matching files or folders',
		fileOption: (label: string, path: string): string => `${label}, file, ${path}`,
		folderOption: (label: string, path: string): string => `${label}, folder, ${path}`
	},
	'zh-cn': {
		menuLabel: '工作区文件和文件夹',
		heading: '链接文件或文件夹',
		empty: '没有匹配的文件或文件夹',
		fileOption: (label: string, path: string): string => `${label}，文件，${path}`,
		folderOption: (label: string, path: string): string => `${label}，文件夹，${path}`
	}
})
