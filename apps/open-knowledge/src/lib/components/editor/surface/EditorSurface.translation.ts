import { translation } from '#lib/i18n/index.js'

export const editorSurfaceTranslation = translation({
	en: {
		document: 'Document',
		pageTitle: (title: string): string => `${title} · Open Knowledge`,
		openingDocument: 'Opening document',
		noDocument: 'No document selected',
		chooseDocument: 'Choose a document from the workspace.',
		previewUnavailable: 'Preview unavailable',
		unsupportedFileType: 'Open Knowledge cannot display or edit this file type yet.',
		'error.open-knowledge.frontmatter-required':
			'Open Knowledge concept files require YAML frontmatter with a non-empty type property.',
		'error.open-knowledge.type-required':
			'Open Knowledge concept frontmatter requires a non-empty string type property.',
		editFrontmatter: 'Edit frontmatter',
		'error.frontmatter.invalid-yaml': 'The YAML frontmatter is invalid.',
		'error.frontmatter.alias': 'The YAML frontmatter aliases could not be resolved safely.',
		'error.frontmatter.mapping': 'YAML frontmatter must be a key-value mapping.',
		yamlParserDetail: (detail: string): string => `YAML parser detail: ${detail}`
	},
	'zh-cn': {
		document: '文档',
		pageTitle: (title: string): string => `${title} · Open Knowledge`,
		openingDocument: '正在打开文档',
		noDocument: '未选择文档',
		chooseDocument: '请从工作区中选择一个文档。',
		previewUnavailable: '无法预览',
		unsupportedFileType: 'Open Knowledge 暂时无法显示或编辑此文件类型。',
		'error.open-knowledge.frontmatter-required':
			'Open Knowledge 概念文件需要包含具有非空 type 属性的 YAML frontmatter。',
		'error.open-knowledge.type-required':
			'Open Knowledge 概念的 frontmatter 需要包含非空字符串 type 属性。',
		editFrontmatter: '编辑 frontmatter',
		'error.frontmatter.invalid-yaml': 'YAML frontmatter 无效。',
		'error.frontmatter.alias': '无法安全解析 YAML frontmatter 中的别名。',
		'error.frontmatter.mapping': 'YAML frontmatter 必须是键值映射。',
		yamlParserDetail: (detail: string): string => `YAML 解析器详情：${detail}`
	}
})
