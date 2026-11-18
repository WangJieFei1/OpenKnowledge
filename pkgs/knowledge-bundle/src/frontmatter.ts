import * as v from 'valibot'
import { isAlias, isMap, isScalar, parseDocument, stringify, visit } from 'yaml'
import { isReservedKnowledgeDocument } from './paths'
import { NonArrayObjectSchema } from './validation'

const NonEmptyStringSchema = v.pipe(v.string(), v.trim(), v.nonEmpty())
const OpenKnowledgeIndexFrontmatterSchema = v.object({
	okf_version: NonEmptyStringSchema
})
const OpenKnowledgeConceptFrontmatterSchema = v.object({
	type: NonEmptyStringSchema
})
const ErrorDetailSchema = v.union([
	v.pipe(
		v.instance(Error),
		v.transform((error) => error.message)
	),
	v.string()
])

export interface ParsedKnowledgeMarkdown {
	body: string
	frontmatter: Record<string, unknown>
	hasFrontmatter: boolean
	rawFrontmatter: string
	rawFrontmatterBlock: string
	bodyPrefix: string
}

export type FrontmatterMessageID =
	'error.frontmatter.invalid-yaml' | 'error.frontmatter.alias' | 'error.frontmatter.mapping'

export type FrontmatterResult =
	| { ok: true; value: ParsedKnowledgeMarkdown }
	| { ok: false; message: FrontmatterMessageID; detail?: string }

export type KnowledgeMarkdownFormat =
	'markdown' | 'frontmatter' | 'open-knowledge-concept' | 'open-knowledge-index'

export type OpenKnowledgeConformanceMessageID =
	'error.open-knowledge.frontmatter-required' | 'error.open-knowledge.type-required'

export type FrontmatterValueKind = 'text' | 'number' | 'boolean' | 'list' | 'object' | 'null'

export type FrontmatterValueMessageID =
	| 'error.frontmatter.value.invalid-yaml'
	| 'error.frontmatter.value.alias'
	| 'error.frontmatter.value.unsupported-yaml'

export type FrontmatterValueResult =
	{ ok: true; value: unknown } | { ok: false; message: FrontmatterValueMessageID; detail?: string }

export function splitKnowledgeMarkdown(markdown: string): FrontmatterResult {
	const byteOrderMarkLength = markdown.startsWith('\uFEFF') ? 1 : 0
	const source = markdown.slice(byteOrderMarkLength)
	if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
		return markdownWithoutFrontmatter(markdown)
	}

	const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source)
	if (!match) {
		return markdownWithoutFrontmatter(markdown)
	}
	const additionalBodyPrefix = match[2]
		? (/^(?:\r?\n)*/.exec(source.slice(match[0].length))?.[0] ?? '')
		: ''
	const frontmatterBlockLength = match[0].length + additionalBodyPrefix.length
	const document = parseDocument(match[1] ?? '', {
		prettyErrors: false,
		uniqueKeys: true
	})
	const parseError = document.errors[0]
	if (parseError) {
		return {
			ok: false,
			message: 'error.frontmatter.invalid-yaml',
			detail: parseError.message
		}
	}

	let value: unknown
	try {
		value = document.toJS({ maxAliasCount: 100 })
	} catch (error) {
		return yamlFailure('error.frontmatter.alias', error)
	}
	if (!v.is(NonArrayObjectSchema, value)) {
		return { ok: false, message: 'error.frontmatter.mapping' }
	}

	return {
		ok: true,
		value: {
			body: source.slice(frontmatterBlockLength),
			frontmatter: value,
			hasFrontmatter: true,
			rawFrontmatter: match[1] ?? '',
			rawFrontmatterBlock: markdown.slice(0, byteOrderMarkLength + frontmatterBlockLength),
			bodyPrefix: `${match[2] ?? ''}${additionalBodyPrefix}`
		}
	}
}

export function classifyKnowledgeMarkdown(
	parsed: ParsedKnowledgeMarkdown,
	bundlePath: string
): KnowledgeMarkdownFormat {
	if (!parsed.hasFrontmatter) {
		return 'markdown'
	}
	if (bundlePath === 'index.md' && v.is(OpenKnowledgeIndexFrontmatterSchema, parsed.frontmatter)) {
		return 'open-knowledge-index'
	}
	if (
		!isReservedKnowledgeDocument(bundlePath) &&
		v.is(OpenKnowledgeConceptFrontmatterSchema, parsed.frontmatter)
	) {
		return 'open-knowledge-concept'
	}
	return 'frontmatter'
}

export function isOpenKnowledgeWorkspaceIndex(markdown: string): boolean {
	const parsed = splitKnowledgeMarkdown(markdown)
	return parsed.ok && classifyKnowledgeMarkdown(parsed.value, 'index.md') === 'open-knowledge-index'
}

export function openKnowledgeConceptConformance(
	parsed: ParsedKnowledgeMarkdown,
	bundlePath: string
): OpenKnowledgeConformanceMessageID | null {
	if (isReservedKnowledgeDocument(bundlePath)) {
		return null
	}
	if (!parsed.hasFrontmatter) {
		return 'error.open-knowledge.frontmatter-required'
	}
	return v.is(OpenKnowledgeConceptFrontmatterSchema, parsed.frontmatter)
		? null
		: 'error.open-knowledge.type-required'
}

export function canEditFrontmatterProperties(parsed: ParsedKnowledgeMarkdown): boolean {
	const document = parseDocument(parsed.rawFrontmatter.trim() ? parsed.rawFrontmatter : '{}', {
		intAsBigInt: true,
		prettyErrors: false,
		uniqueKeys: true
	})
	return structuredYAMLDocumentIsSafe(document, false)
}

export function replaceKnowledgeBody(parsed: ParsedKnowledgeMarkdown, body: string): string {
	if (!parsed.hasFrontmatter) {
		return body
	}
	if (!parsed.bodyPrefix && body) {
		const newline = parsed.rawFrontmatterBlock.includes('\r\n') ? '\r\n' : '\n'
		return `${parsed.rawFrontmatterBlock}${newline}${body}`
	}
	return `${parsed.rawFrontmatterBlock}${body}`
}

export function frontmatterValueKind(value: unknown): FrontmatterValueKind {
	if (value === null) {
		return 'null'
	}
	if (Array.isArray(value)) {
		return 'list'
	}
	if (typeof value === 'number') {
		return 'number'
	}
	if (typeof value === 'boolean') {
		return 'boolean'
	}
	if (typeof value === 'object') {
		return 'object'
	}
	return 'text'
}

export function stringifyFrontmatterValue(value: unknown): string {
	return stringify(value, { lineWidth: 0 }).trimEnd()
}

export function parseFrontmatterValue(source: string): FrontmatterValueResult {
	const document = parseDocument(source, {
		intAsBigInt: true,
		prettyErrors: false,
		uniqueKeys: true
	})
	const parseError = document.errors[0]
	if (parseError) {
		return {
			ok: false,
			message: 'error.frontmatter.value.invalid-yaml',
			detail: parseError.message
		}
	}
	if (!structuredYAMLDocumentIsSafe(document, true)) {
		return { ok: false, message: 'error.frontmatter.value.unsupported-yaml' }
	}
	try {
		return { ok: true, value: document.toJS({ maxAliasCount: 100 }) }
	} catch (error) {
		return yamlFailure('error.frontmatter.value.alias', error)
	}
}

export function updateFrontmatterProperty(
	parsed: ParsedKnowledgeMarkdown,
	key: string,
	value: unknown
): string {
	const normalizedKey = key.trim()
	if (!normalizedKey) {
		throw new Error('Property names cannot be empty.')
	}
	const document = frontmatterDocument(parsed)
	const pair = topLevelPair(document, normalizedKey)
	if (!pair || !pair.key || !isScalar(pair.key) || !pair.key.range) {
		const separator = parsed.rawFrontmatter && !parsed.rawFrontmatter.endsWith('\n') ? '\n' : ''
		return rebuildKnowledgeMarkdown(
			parsed,
			`${parsed.rawFrontmatter}${separator}${singlePropertySource(normalizedKey, value)}`
		)
	}

	if (pair.value && isScalar(pair.value) && pair.value.range && isScalarValue(value)) {
		const [start, end] = pair.value.range
		const source = stringifyFrontmatterValue(value)
		return rebuildKnowledgeMarkdown(
			parsed,
			`${parsed.rawFrontmatter.slice(0, start)}${source}${parsed.rawFrontmatter.slice(end)}`
		)
	}

	const start = pair.key.range[0]
	const end = pair.value?.range?.[2] ?? pair.key.range[2]
	const replaced = parsed.rawFrontmatter.slice(start, end)
	const trailingNewline = /\r?\n$/.test(replaced) ? '\n' : ''
	return rebuildKnowledgeMarkdown(
		parsed,
		`${parsed.rawFrontmatter.slice(0, start)}${singlePropertySource(normalizedKey, value)}${trailingNewline}${parsed.rawFrontmatter.slice(end)}`
	)
}

export function renameFrontmatterProperty(
	parsed: ParsedKnowledgeMarkdown,
	currentKey: string,
	nextKey: string
): string {
	const normalizedKey = nextKey.trim()
	if (!normalizedKey || normalizedKey === currentKey) {
		return rebuildKnowledgeMarkdown(parsed, parsed.rawFrontmatter)
	}
	if (Object.hasOwn(parsed.frontmatter, normalizedKey)) {
		throw new Error(`A property named ${normalizedKey} already exists.`)
	}
	const document = frontmatterDocument(parsed)
	const pair = topLevelPair(document, currentKey)
	if (!pair?.key || !isScalar(pair.key) || !pair.key.range) {
		throw new Error(`The property ${currentKey} no longer exists.`)
	}
	const [start, end] = pair.key.range
	return rebuildKnowledgeMarkdown(
		parsed,
		`${parsed.rawFrontmatter.slice(0, start)}${serializedKey(normalizedKey)}${parsed.rawFrontmatter.slice(end)}`
	)
}

export function deleteFrontmatterProperty(parsed: ParsedKnowledgeMarkdown, key: string): string {
	const document = frontmatterDocument(parsed)
	const pair = topLevelPair(document, key)
	if (!pair?.key || !isScalar(pair.key) || !pair.key.range) {
		return rebuildKnowledgeMarkdown(parsed, parsed.rawFrontmatter)
	}
	const start = pair.key.range[0]
	const end = pair.value?.range?.[2] ?? pair.key.range[2]
	return rebuildKnowledgeMarkdown(
		parsed,
		`${parsed.rawFrontmatter.slice(0, start)}${parsed.rawFrontmatter.slice(end)}`
	)
}

function frontmatterDocument(parsed: ParsedKnowledgeMarkdown) {
	return parseDocument(parsed.rawFrontmatter.trim() ? parsed.rawFrontmatter : '{}', {
		prettyErrors: false,
		uniqueKeys: true,
		keepSourceTokens: true
	})
}

function topLevelPair(document: ReturnType<typeof frontmatterDocument>, key: string) {
	if (!isMap(document.contents)) {
		return undefined
	}
	return document.contents.items.find(
		(pair) => pair.key && isScalar(pair.key) && pair.key.value === key
	)
}

function singlePropertySource(key: string, value: unknown): string {
	return stringify({ [key]: value }, { lineWidth: 0 }).trimEnd()
}

function serializedKey(key: string): string {
	const source = singlePropertySource(key, null)
	const document = parseDocument(source)
	if (!isMap(document.contents)) {
		return key
	}
	const node = document.contents.items[0]?.key
	return node?.range ? source.slice(node.range[0], node.range[1]) : key
}

function isScalarValue(value: unknown): boolean {
	return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function rebuildKnowledgeMarkdown(parsed: ParsedKnowledgeMarkdown, yamlSource: string): string {
	const newline = parsed.rawFrontmatterBlock.includes('\r\n') ? '\r\n' : '\n'
	const yaml = yamlSource.replace(/\r?\n/g, newline).replace(new RegExp(`${newline}$`), '')
	const bodyPrefix = parsed.hasFrontmatter ? parsed.bodyPrefix : newline
	const byteOrderMark = parsed.rawFrontmatterBlock.startsWith('\uFEFF') ? '\uFEFF' : ''
	return `${byteOrderMark}---${newline}${yaml}${yaml ? newline : ''}---${bodyPrefix}${parsed.body}`
}

function markdownWithoutFrontmatter(markdown: string): FrontmatterResult {
	return {
		ok: true,
		value: {
			body: markdown,
			frontmatter: {},
			hasFrontmatter: false,
			rawFrontmatter: '',
			rawFrontmatterBlock: '',
			bodyPrefix: ''
		}
	}
}

function structuredYAMLDocumentIsSafe(
	document: ReturnType<typeof parseDocument>,
	allowLargeIntegers: boolean
): boolean {
	let safe = true
	visit(document, {
		Pair(_key, pair) {
			if (!pair.key || !isScalar(pair.key) || typeof pair.key.value !== 'string') {
				safe = false
				return visit.BREAK
			}
		},
		Node(_key, node) {
			if (isAlias(node) || node.anchor || node.tag) {
				safe = false
				return visit.BREAK
			}
			if (!isScalar(node)) {
				return
			}
			if (
				(typeof node.value === 'number' || typeof node.value === 'bigint') &&
				(!/^-?(?:0|[1-9]\d*)$/.test(node.source ?? '') ||
					(!allowLargeIntegers &&
						typeof node.value === 'bigint' &&
						(node.value > BigInt(Number.MAX_SAFE_INTEGER) ||
							node.value < BigInt(Number.MIN_SAFE_INTEGER))))
			) {
				safe = false
				return visit.BREAK
			}
			if (typeof node.value === 'string' && /[\r\n]/.test(node.value)) {
				safe = false
				return visit.BREAK
			}
		}
	})
	return safe
}

function yamlFailure<MessageID extends FrontmatterMessageID | FrontmatterValueMessageID>(
	message: MessageID,
	error: unknown
): { ok: false; message: MessageID; detail?: string } {
	const result = v.safeParse(ErrorDetailSchema, error)
	const detail = result.success ? result.output : ''
	return detail ? { ok: false, message, detail } : { ok: false, message }
}
