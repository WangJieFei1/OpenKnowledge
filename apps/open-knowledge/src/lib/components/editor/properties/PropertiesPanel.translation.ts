import { translation } from '#lib/i18n/index.js'

export const propertiesPanelTranslation = translation({
	en: {
		updateFailed: 'The property could not be updated.',
		numberRequired:
			'Number properties need a numeric value. Remove the property to make it absent.',
		safeIntegerRequired: 'Use a safe whole number here, or edit YAML for other numeric values.',
		'error.frontmatter.value.invalid-yaml': (key: string): string =>
			`${key} must contain a valid YAML value.`,
		'error.frontmatter.value.alias': (key: string): string =>
			`${key} contains YAML aliases that could not be resolved safely.`,
		'error.frontmatter.value.unsupported-yaml': (key: string): string =>
			`${key} uses YAML syntax that must be edited in source mode.`,
		yamlParserDetail: (detail: string): string => `YAML parser detail: ${detail}`,
		renameFailed: 'The property could not be renamed.',
		removeFailed: 'The property could not be removed.',
		enterPropertyName: 'Enter a property name.',
		propertyExists: (key: string): string => `${key} already exists.`,
		propertyCount: (count: number): string => `Document properties, ${count}`,
		documentProperties: 'Document properties',
		openKnowledgeFrontmatter: 'Open Knowledge frontmatter',
		closeProperties: 'Close properties',
		recommendedProperties: 'Recommended properties',
		addProperty: 'Add property',
		editYAML: 'Edit YAML',
		propertyName: 'Property name',
		add: 'Add',
		renameProperty: (key: string): string => `Rename ${key}`,
		text: 'text',
		number: 'number',
		boolean: 'boolean',
		list: 'list',
		object: 'object',
		null: 'null',
		trueValue: 'True',
		falseValue: 'False',
		yamlValue: (key: string): string => `${key} YAML value`,
		removeProperty: (key: string): string => `Remove ${key}`,
		emptyProperties: 'No properties yet.'
	},
	'zh-cn': {
		updateFailed: '无法更新属性。',
		numberRequired: '数字属性需要数值。要使其不存在，请移除该属性。',
		safeIntegerRequired: '请在此输入安全整数；其他数值请编辑 YAML。',
		'error.frontmatter.value.invalid-yaml': (key: string): string =>
			`${key} 必须包含有效的 YAML 值。`,
		'error.frontmatter.value.alias': (key: string): string =>
			`${key} 包含无法安全解析的 YAML 别名。`,
		'error.frontmatter.value.unsupported-yaml': (key: string): string =>
			`${key} 使用了必须在源码模式中编辑的 YAML 语法。`,
		yamlParserDetail: (detail: string): string => `YAML 解析器详情：${detail}`,
		renameFailed: '无法重命名属性。',
		removeFailed: '无法移除属性。',
		enterPropertyName: '请输入属性名称。',
		propertyExists: (key: string): string => `${key} 已存在。`,
		propertyCount: (count: number): string => `文档属性，${count} 项`,
		documentProperties: '文档属性',
		openKnowledgeFrontmatter: 'Open Knowledge frontmatter',
		closeProperties: '关闭属性',
		recommendedProperties: '推荐属性',
		addProperty: '添加属性',
		editYAML: '编辑 YAML',
		propertyName: '属性名称',
		add: '添加',
		renameProperty: (key: string): string => `重命名 ${key}`,
		text: '文本',
		number: '数字',
		boolean: '布尔值',
		list: '列表',
		object: '对象',
		null: '空值',
		trueValue: '真',
		falseValue: '假',
		yamlValue: (key: string): string => `${key} 的 YAML 值`,
		removeProperty: (key: string): string => `移除 ${key}`,
		emptyProperties: '还没有属性。'
	}
})
