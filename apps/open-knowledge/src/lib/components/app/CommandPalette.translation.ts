import { translation } from '#lib/i18n/index.js'

export const commandPaletteTranslation = translation({
	en: {
		commandPalette: 'Command palette',
		description: 'Search application actions and workspace documents.',
		applicationCommands: 'Application commands',
		placeholder: 'Type a command or document name',
		useLightTheme: 'Use light theme',
		useDarkTheme: 'Use dark theme',
		escape: 'Esc',
		noMatches: 'No matching actions'
	},
	'zh-cn': {
		commandPalette: '命令面板',
		description: '搜索应用操作和工作区文档。',
		applicationCommands: '应用命令',
		placeholder: '输入命令或文档名称',
		useLightTheme: '使用浅色主题',
		useDarkTheme: '使用深色主题',
		escape: 'Esc',
		noMatches: '没有匹配的操作'
	}
})
