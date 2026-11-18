import { translation } from '#lib/i18n/index.js'
import { slashCommandIDs, type SlashCommandID } from './slash-commands'

type SlashCommandCopy = {
	label: string
	description: string
	keywords: string
}

const englishCopy: Record<SlashCommandID, SlashCommandCopy> = {
	text: {
		label: 'Text',
		description: 'Plain paragraph',
		keywords: 'paragraph body'
	},
	'heading-1': {
		label: 'Heading 1',
		description: 'Large section heading',
		keywords: 'title h1'
	},
	'heading-2': {
		label: 'Heading 2',
		description: 'Medium section heading',
		keywords: 'subtitle h2'
	},
	'heading-3': {
		label: 'Heading 3',
		description: 'Small section heading',
		keywords: 'subtitle h3'
	},
	'heading-4': {
		label: 'Heading 4',
		description: 'Fourth-level heading',
		keywords: 'subtitle h4'
	},
	'heading-5': {
		label: 'Heading 5',
		description: 'Fifth-level heading',
		keywords: 'subtitle h5'
	},
	'heading-6': {
		label: 'Heading 6',
		description: 'Sixth-level heading',
		keywords: 'subtitle h6'
	},
	'bullet-list': {
		label: 'Bulleted list',
		description: 'Create an unordered list',
		keywords: 'unordered bullets'
	},
	'ordered-list': {
		label: 'Numbered list',
		description: 'Create an ordered list',
		keywords: 'numbers ordered'
	},
	blockquote: {
		label: 'Quote',
		description: 'Capture a quotation',
		keywords: 'blockquote callout'
	},
	'code-block': {
		label: 'Code block',
		description: 'Add a fenced code block',
		keywords: 'code fence'
	},
	'horizontal-rule': {
		label: 'Horizontal rule',
		description: 'Separate sections with a line',
		keywords: 'divider separator thematic break hr'
	},
	table: {
		label: 'Table',
		description: 'Insert a 3 by 3 table',
		keywords: 'grid cells'
	},
	image: {
		label: 'Image',
		description: 'Insert an image from a URL',
		keywords: 'picture photo media alt'
	},
	'hard-break': {
		label: 'Hard break',
		description: 'Force a line break',
		keywords: 'newline shift enter br'
	}
}

const chineseCopy: Record<SlashCommandID, SlashCommandCopy> = {
	text: {
		label: '正文',
		description: '普通段落',
		keywords: '段落 正文 文本'
	},
	'heading-1': {
		label: '一级标题',
		description: '大型章节标题',
		keywords: '标题 一级 h1'
	},
	'heading-2': {
		label: '二级标题',
		description: '中型章节标题',
		keywords: '标题 二级 h2'
	},
	'heading-3': {
		label: '三级标题',
		description: '小型章节标题',
		keywords: '标题 三级 h3'
	},
	'heading-4': {
		label: '四级标题',
		description: '四级章节标题',
		keywords: '标题 四级 h4'
	},
	'heading-5': {
		label: '五级标题',
		description: '五级章节标题',
		keywords: '标题 五级 h5'
	},
	'heading-6': {
		label: '六级标题',
		description: '六级章节标题',
		keywords: '标题 六级 h6'
	},
	'bullet-list': {
		label: '项目符号列表',
		description: '创建无序列表',
		keywords: '无序 项目符号 列表'
	},
	'ordered-list': {
		label: '编号列表',
		description: '创建有序列表',
		keywords: '有序 编号 数字 列表'
	},
	blockquote: {
		label: '引用',
		description: '插入一段引用',
		keywords: '引用 引用块 标注'
	},
	'code-block': {
		label: '代码块',
		description: '添加围栏代码块',
		keywords: '代码 围栏'
	},
	'horizontal-rule': {
		label: '水平分隔线',
		description: '用线条分隔章节',
		keywords: '分隔线 分割线 水平线 主题分隔 hr'
	},
	table: {
		label: '表格',
		description: '插入 3 × 3 表格',
		keywords: '网格 单元格'
	},
	image: {
		label: '图片',
		description: '通过 URL 插入图片',
		keywords: '图片 图像 照片 媒体 替代文本'
	},
	'hard-break': {
		label: '硬换行',
		description: '强制插入换行',
		keywords: '换行 新行 shift enter br'
	}
}

export const slashCommandTranslation = translation({
	en: {
		menuLabel: 'Markdown commands',
		heading: 'Markdown',
		empty: 'No matching commands',
		label: (id: SlashCommandID): string => englishCopy[id].label,
		description: (id: SlashCommandID): string => englishCopy[id].description,
		keywords: (id: SlashCommandID): string => englishCopy[id].keywords
	},
	'zh-cn': {
		menuLabel: 'Markdown 命令',
		heading: 'Markdown',
		empty: '没有匹配的命令',
		label: (id: SlashCommandID): string => chineseCopy[id].label,
		description: (id: SlashCommandID): string => chineseCopy[id].description,
		keywords: (id: SlashCommandID): string => chineseCopy[id].keywords
	}
})

export function localizedSlashCommandSearch(): Record<SlashCommandID, string> {
	return Object.fromEntries(
		slashCommandIDs.map((id) => [
			id,
			`${slashCommandTranslation.label(id)} ${slashCommandTranslation.keywords(id)}`
		])
	) as Record<SlashCommandID, string>
}
