import {
	parseFrontmatterValue,
	type FrontmatterValueResult
} from '@open-knowledge/knowledge-bundle/frontmatter'
import * as v from 'valibot'

type NumberInputMessageID = 'numberRequired' | 'safeIntegerRequired'

export type NumberInputResult =
	{ ok: true; value: number } | { ok: false; message: NumberInputMessageID }

export type RecommendedProperty = {
	key: string
	value: unknown
}

export const recommendedProperties: readonly RecommendedProperty[] = [
	{ key: 'type', value: 'note' },
	{ key: 'title', value: '' },
	{ key: 'description', value: '' },
	{ key: 'resource', value: '' },
	{ key: 'tags', value: [] },
	{ key: 'status', value: 'draft' },
	{ key: 'sources', value: [] }
]

const RequiredNumberInputSchema = v.pipe(v.string(), v.trim(), v.nonEmpty())
const SafeIntegerInputSchema = v.pipe(
	v.string(),
	v.regex(/^-?(?:0|[1-9]\d*)$/),
	v.transform(Number),
	v.safeInteger()
)

export function parseNumberInput(source: string): NumberInputResult {
	if (!v.is(RequiredNumberInputSchema, source)) {
		return { ok: false, message: 'numberRequired' }
	}
	const result = v.safeParse(SafeIntegerInputSchema, source)
	if (!result.success) {
		return { ok: false, message: 'safeIntegerRequired' }
	}
	return { ok: true, value: result.output }
}

export function parseYAMLInput(source: string): FrontmatterValueResult {
	return parseFrontmatterValue(source)
}
