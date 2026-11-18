import { translation, type Translation } from '#lib/i18n/index.js'
import type { ApplicationCommandGroup } from './application-command'

type ApplicationCommandGroupLabels = Record<ApplicationCommandGroup, string>

export const applicationCommandGroupLabels = translation({
	en: {
		File: 'File',
		Edit: 'Edit',
		View: 'View',
		MCP: 'MCP',
		Help: 'Help',
		Open: 'Open'
	},
	'zh-cn': {
		File: '文件',
		Edit: '编辑',
		View: '视图',
		MCP: 'MCP',
		Help: '帮助',
		Open: '打开'
	}
} satisfies Translation<ApplicationCommandGroupLabels>)
