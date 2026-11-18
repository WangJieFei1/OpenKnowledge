import { Menu, Tray, type NativeImage } from 'electron'
import type { ApplicationLanguage } from '../src/lib/settings/api'
import type { ApplicationWindows } from './windows/application-windows'
import { appEdition } from '../src/lib/app-edition'

const trayLabels = {
	en: {
		settings: 'Global Settings…',
		mcpSettings: 'Global MCP Settings…'
	},
	'zh-cn': {
		settings: '全局设置…',
		mcpSettings: '全局 MCP 设置…'
	}
} satisfies Record<ApplicationLanguage, { settings: string; mcpSettings: string }>

export class ApplicationTray {
	private readonly tray: Tray

	constructor(
		private readonly windows: ApplicationWindows,
		language: ApplicationLanguage,
		icon: NativeImage
	) {
		this.tray = new Tray(icon)
		this.tray.setToolTip(appEdition.name)
		this.setLanguage(language)
	}

	setLanguage(language: ApplicationLanguage): void {
		const labels = trayLabels[language]
		this.tray.setContextMenu(
			Menu.buildFromTemplate([
				{
					label: labels.settings,
					click: () => {
						void this.windows.showApplicationSettings().catch((error: unknown) => {
							console.error('Application settings could not be opened from the tray.', error)
						})
					}
				},
				{
					label: labels.mcpSettings,
					click: () => {
						void this.windows.showMCPSettings().catch((error: unknown) => {
							console.error('MCP settings could not be opened from the tray.', error)
						})
					}
				}
			])
		)
	}

	destroy(): void {
		if (!this.tray.isDestroyed()) {
			this.tray.destroy()
		}
	}
}
