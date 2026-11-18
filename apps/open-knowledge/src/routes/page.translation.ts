import { translation } from '#lib/i18n/index.js'

export const pageTranslation = translation({
	en: {
		pageTitle: 'Open Knowledge',
		desktopRuntimeRequired: 'Desktop runtime required',
		runtimeInstruction: 'Start the Electron application to access local workspaces.',
		starting: 'Starting Open Knowledge'
	},
	'zh-cn': {
		pageTitle: 'Open Knowledge',
		desktopRuntimeRequired: '需要桌面运行环境',
		runtimeInstruction: '请启动 Electron 应用以访问本地工作区。',
		starting: '正在启动 Open Knowledge'
	}
})
