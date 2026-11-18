import { translation } from '#lib/i18n/index.js'

export const sidebarResizerTranslation = translation({
	en: {
		resizeSidebar: (width: number) => `Resize sidebar, ${width} pixels`,
		resizeInstructions: 'Drag or use arrow keys to resize sidebar'
	},
	'zh-cn': {
		resizeSidebar: (width: number) => `调整侧边栏大小，当前宽度为 ${width} 像素`,
		resizeInstructions: '拖动或使用方向键调整侧边栏大小'
	}
})
