import { translation } from '#lib/i18n/index.js'

export const layoutTranslation = translation({
	en: {
		appName: 'Open Knowledge',
		pageTitle: (title: string) => `${title} · Open Knowledge`,
		desktopRuntimeUnavailable: 'Desktop runtime unavailable'
	},
	'zh-cn': {
		appName: 'Open Knowledge',
		pageTitle: (title: string) => `${title} · Open Knowledge`,
		desktopRuntimeUnavailable: '桌面运行环境不可用'
	}
})
