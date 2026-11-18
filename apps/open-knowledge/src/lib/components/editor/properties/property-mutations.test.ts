import { describe, expect, test } from 'bun:test'
import {
	splitKnowledgeMarkdown,
	type ParsedKnowledgeMarkdown
} from '@open-knowledge/knowledge-bundle/frontmatter'
import { addProperty, renameProperty } from './property-mutations'

describe('property mutations', () => {
	test('validates property names and duplicates', () => {
		const parsed = parse('---\nfirst: one\nsecond: two\n---\nBody')

		expect(addProperty(parsed, '  ', '')).toEqual({
			ok: false,
			error: { code: 'name-required' }
		})
		expect(addProperty(parsed, ' first ', '')).toEqual({
			ok: false,
			error: { code: 'property-exists', key: 'first' }
		})
		expect(renameProperty(parsed, 'second', ' first ')).toEqual({
			ok: false,
			error: { code: 'property-exists', key: 'first' }
		})
	})

	test('returns an error when adding fails so the form can remain open', () => {
		const parsed = parse('---\nfirst: one\n---\nBody')

		expect(addProperty(parsed, 'second', Symbol('unsupported'))).toEqual({
			ok: false,
			error: { code: 'update-failed' }
		})
	})
})

function parse(markdown: string): ParsedKnowledgeMarkdown {
	const result = splitKnowledgeMarkdown(markdown)
	if (!result.ok) {
		throw new Error(`Invalid test markdown: ${result.message}`)
	}
	return result.value
}
