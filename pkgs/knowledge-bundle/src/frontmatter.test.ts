import { describe, expect, test } from 'bun:test'
import {
	canEditFrontmatterProperties,
	classifyKnowledgeMarkdown,
	deleteFrontmatterProperty,
	isOpenKnowledgeWorkspaceIndex,
	openKnowledgeConceptConformance,
	parseFrontmatterValue,
	renameFrontmatterProperty,
	replaceKnowledgeBody,
	splitKnowledgeMarkdown,
	updateFrontmatterProperty
} from './frontmatter'

describe('knowledge frontmatter preservation', () => {
	test('preserves a CRLF frontmatter block during body-only edits', () => {
		const source = '---\r\ntype: concept\r\ncustom: retained\r\n---\r\nOld body\r\n'
		const parsed = splitKnowledgeMarkdown(source)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) {
			return
		}
		expect(replaceKnowledgeBody(parsed.value, 'New body\n')).toBe(
			'---\r\ntype: concept\r\ncustom: retained\r\n---\r\nNew body\n'
		)
	})

	test('preserves a UTF-8 byte order mark during body and property edits', () => {
		const source = '\uFEFF---\ntype: concept\ntitle: Old\n---\nBody'
		const parsed = splitKnowledgeMarkdown(source)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) {
			return
		}
		expect(replaceKnowledgeBody(parsed.value, 'Updated')).toBe(
			'\uFEFF---\ntype: concept\ntitle: Old\n---\nUpdated'
		)
		expect(updateFrontmatterProperty(parsed.value, 'title', 'New')).toBe(
			'\uFEFF---\ntype: concept\ntitle: New\n---\nBody'
		)
	})

	test('keeps the closing delimiter valid when adding a body after frontmatter at EOF', () => {
		const parsed = splitKnowledgeMarkdown('---\ntype: note\n---')
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) {
			return
		}
		expect(replaceKnowledgeBody(parsed.value, 'Body')).toBe('---\ntype: note\n---\nBody')
	})

	test('preserves blank lines between frontmatter and a rich-edited body', () => {
		const parsed = splitKnowledgeMarkdown('---\ntype: note\n---\n\n# Old body\n')
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) {
			return
		}
		expect(parsed.value.body).toBe('# Old body\n')
		expect(replaceKnowledgeBody(parsed.value, '# New body')).toBe(
			'---\ntype: note\n---\n\n# New body'
		)
	})

	test('updates one property without dropping unknown nested values or comments', () => {
		const source = [
			'---',
			'type: concept',
			'title: Old title # retained comment',
			'custom:',
			'  score: 9',
			'  flags: [one, two]',
			'---',
			'Body',
			''
		].join('\n')
		const parsed = splitKnowledgeMarkdown(source)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) {
			return
		}
		const updated = updateFrontmatterProperty(parsed.value, 'title', 'New title')
		expect(updated).toContain('title: New title # retained comment')
		expect(updated).toContain('custom:\n  score: 9\n  flags: [one, two]')
		expect(updated.endsWith('---\nBody\n')).toBe(true)
	})

	test('adds, renames, and removes arbitrary properties', () => {
		const parsed = splitKnowledgeMarkdown('---\ntype: note\n---\nBody')
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) {
			return
		}
		const added = updateFrontmatterProperty(parsed.value, 'custom_score', 12)
		const addedParsed = splitKnowledgeMarkdown(added)
		expect(addedParsed.ok).toBe(true)
		if (!addedParsed.ok) {
			return
		}
		const renamed = renameFrontmatterProperty(addedParsed.value, 'custom_score', 'confidence')
		const renamedParsed = splitKnowledgeMarkdown(renamed)
		expect(renamedParsed.ok).toBe(true)
		if (!renamedParsed.ok) {
			return
		}
		expect(renamedParsed.value.frontmatter.confidence).toBe(12)
		expect(renamedParsed.value.frontmatter.custom_score).toBeUndefined()
		const removed = deleteFrontmatterProperty(renamedParsed.value, 'confidence')
		expect(removed).toBe('---\ntype: note\n---\nBody')
	})

	test('parses complex YAML values independently', () => {
		expect(parseFrontmatterValue('[one, two]')).toEqual({
			ok: true,
			value: ['one', 'two']
		})
	})
})

describe('knowledge markdown format detection', () => {
	test('keeps plain Markdown and generic YAML independent from Open Knowledge', () => {
		const plain = splitKnowledgeMarkdown('# Plain Markdown')
		const generic = splitKnowledgeMarkdown('---\ntitle: Generic\nlayout: page\n---\nBody')
		const emptyType = splitKnowledgeMarkdown('---\ntype: ""\n---\nBody')
		expect(plain.ok).toBe(true)
		expect(generic.ok).toBe(true)
		expect(emptyType.ok).toBe(true)
		if (!plain.ok || !generic.ok || !emptyType.ok) {
			return
		}
		expect(classifyKnowledgeMarkdown(plain.value, 'guide.md')).toBe('markdown')
		expect(classifyKnowledgeMarkdown(generic.value, 'guide.md')).toBe('frontmatter')
		expect(classifyKnowledgeMarkdown(emptyType.value, 'guide.md')).toBe('frontmatter')
	})

	test('detects concepts and an explicitly versioned root index', () => {
		const concept = splitKnowledgeMarkdown('---\ntype: Metric\n---\nBody')
		const index = splitKnowledgeMarkdown('---\nokf_version: "0.2"\n---\n# Index')
		expect(concept.ok).toBe(true)
		expect(index.ok).toBe(true)
		if (!concept.ok || !index.ok) {
			return
		}
		expect(classifyKnowledgeMarkdown(concept.value, 'metrics/revenue.md')).toBe(
			'open-knowledge-concept'
		)
		expect(classifyKnowledgeMarkdown(concept.value, 'log.md')).toBe('frontmatter')
		expect(classifyKnowledgeMarkdown(index.value, 'index.md')).toBe('open-knowledge-index')
		expect(classifyKnowledgeMarkdown(index.value, 'nested/index.md')).toBe('frontmatter')
	})

	test('requires an explicit string version marker for workspace detection', () => {
		expect(isOpenKnowledgeWorkspaceIndex('---\nokf_version: "0.2"\n---\n# Index')).toBe(true)
		expect(isOpenKnowledgeWorkspaceIndex('---\ntype: post\n---\n# Generic site')).toBe(false)
		expect(isOpenKnowledgeWorkspaceIndex('---\nokf_version: 0.2\n---\n# Index')).toBe(false)
		expect(isOpenKnowledgeWorkspaceIndex('# Plain index')).toBe(false)
	})

	test('returns to generic frontmatter when a user removes the concept type', () => {
		const concept = splitKnowledgeMarkdown('---\ntype: Metric\ntitle: Revenue\n---\nBody')
		expect(concept.ok).toBe(true)
		if (!concept.ok) {
			return
		}
		const updated = splitKnowledgeMarkdown(deleteFrontmatterProperty(concept.value, 'type'))
		expect(updated.ok).toBe(true)
		if (!updated.ok) {
			return
		}
		expect(updated.value.frontmatter).toEqual({ title: 'Revenue' })
		expect(classifyKnowledgeMarkdown(updated.value, 'revenue.md')).toBe('frontmatter')
	})

	test('reports required concept frontmatter without applying reserved-file rules', () => {
		const plain = splitKnowledgeMarkdown('# Plain Markdown')
		const generic = splitKnowledgeMarkdown('---\ntitle: Generic\n---\nBody')
		const invalidType = splitKnowledgeMarkdown('---\ntype: 42\n---\nBody')
		const concept = splitKnowledgeMarkdown('---\ntype: Custom\n---\nBody')
		expect(plain.ok && openKnowledgeConceptConformance(plain.value, 'plain.md')).toBe(
			'error.open-knowledge.frontmatter-required'
		)
		expect(generic.ok && openKnowledgeConceptConformance(generic.value, 'generic.md')).toBe(
			'error.open-knowledge.type-required'
		)
		expect(invalidType.ok && openKnowledgeConceptConformance(invalidType.value, 'invalid.md')).toBe(
			'error.open-knowledge.type-required'
		)
		expect(concept.ok && openKnowledgeConceptConformance(concept.value, 'concept.md')).toBeNull()
		expect(plain.ok && openKnowledgeConceptConformance(plain.value, 'index.md')).toBeNull()
		expect(generic.ok && openKnowledgeConceptConformance(generic.value, 'nested/log.md')).toBeNull()
	})

	test('keeps unusual YAML out of structured property editing', () => {
		const safe = splitKnowledgeMarkdown('---\ntype: Metric\ncount: 42\n---\nBody')
		const largeInteger = splitKnowledgeMarkdown(
			'---\ntype: Metric\ncount: 9007199254740993\n---\nBody'
		)
		const alias = splitKnowledgeMarkdown(
			'---\ntype: Metric\nbase: &base { score: 1 }\ncopy: *base\n---\nBody'
		)
		const numericKey = splitKnowledgeMarkdown('---\ntype: Metric\n1: one\n---\nBody')
		const preciseFloat = splitKnowledgeMarkdown(
			'---\ntype: Metric\nratio: 0.123456789012345678901\n---\nBody'
		)
		const multiline = splitKnowledgeMarkdown(
			'---\ntype: Metric\ndescription: |\n  first\n  second\n---\nBody'
		)
		expect(safe.ok).toBe(true)
		expect(largeInteger.ok).toBe(true)
		expect(alias.ok).toBe(true)
		expect(numericKey.ok).toBe(true)
		expect(preciseFloat.ok).toBe(true)
		expect(multiline.ok).toBe(true)
		if (
			!safe.ok ||
			!largeInteger.ok ||
			!alias.ok ||
			!numericKey.ok ||
			!preciseFloat.ok ||
			!multiline.ok
		) {
			return
		}
		expect(canEditFrontmatterProperties(safe.value)).toBe(true)
		expect(canEditFrontmatterProperties(largeInteger.value)).toBe(false)
		expect(canEditFrontmatterProperties(alias.value)).toBe(false)
		expect(canEditFrontmatterProperties(numericKey.value)).toBe(false)
		expect(canEditFrontmatterProperties(preciseFloat.value)).toBe(false)
		expect(canEditFrontmatterProperties(multiline.value)).toBe(false)
	})
})

describe('frontmatter error messages', () => {
	test('separates invalid frontmatter YAML IDs from parser details', () => {
		const result = splitKnowledgeMarkdown('---\ntags: [one\n---\nBody')
		expect(result.ok).toBe(false)
		if (result.ok) {
			return
		}
		expect(result.message).toBe('error.frontmatter.invalid-yaml')
		expect(result.detail).toBeTruthy()
		expect(result.message).not.toBe(result.detail)
	})

	test('treats an unmatched thematic rule as Markdown', () => {
		const result = splitKnowledgeMarkdown('---\n\n# Notes\n')
		expect(result.ok).toBe(true)
		if (!result.ok) {
			return
		}
		expect(result.value.hasFrontmatter).toBe(false)
		expect(result.value.body).toBe('---\n\n# Notes\n')
	})

	test('distinguishes alias and mapping failures', () => {
		expect(splitKnowledgeMarkdown('---\n- note\n---\n')).toEqual({
			ok: false,
			message: 'error.frontmatter.mapping'
		})

		const alias = splitKnowledgeMarkdown('---\ntype: *missing\n---\n')
		expect(alias.ok).toBe(false)
		if (!alias.ok) {
			expect(alias.message).toBe('error.frontmatter.alias')
			expect(alias.detail).toBeTruthy()
		}
	})

	test('separates invalid value YAML IDs from parser details', () => {
		const result = parseFrontmatterValue('[one')
		expect(result.ok).toBe(false)
		if (result.ok) {
			return
		}
		expect(result.message).toBe('error.frontmatter.value.invalid-yaml')
		expect(result.detail).toBeTruthy()
		expect(result.message).not.toBe(result.detail)

		expect(parseFrontmatterValue('*missing')).toEqual({
			ok: false,
			message: 'error.frontmatter.value.unsupported-yaml'
		})
		expect(parseFrontmatterValue('0.123456789012345678901')).toEqual({
			ok: false,
			message: 'error.frontmatter.value.unsupported-yaml'
		})
	})
})
