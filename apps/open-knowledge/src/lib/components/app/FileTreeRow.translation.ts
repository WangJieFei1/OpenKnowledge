import { translation } from '#lib/i18n/index.js'

export const fileTreeRowTranslation = translation({
	en: {
		actionsFor: (name: string) => `Actions for ${name}`,
		fileLabel: (name: string, access: string) => `${name}, ${access}`,
		writable: 'Writable document',
		readonly: 'Read-only document',
		notSupported: 'Preview not supported'
	},
	'zh-cn': {
		actionsFor: (name: string) => `${name} 的操作`,
		fileLabel: (name: string, access: string) => `${name}，${access}`,
		writable: '可编辑文档',
		readonly: '只读文档',
		notSupported: '不支持预览'
	}
})
