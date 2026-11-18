import { describe, expect, test } from 'bun:test'
import {
	projectEditorDocument,
	replaceEditorDocumentBody,
	type EditorDocumentProjectionInput
} from './editor-document'

const markdown = '---\ntype: note\ntitle: Frontmatter title\n---\n\nBody'
const baseInput = {
	markdown,
	workspaceName: 'Knowledge base',
	document: { name: 'Current.md', path: '/notes/Current.md' },
	entries: [
		{ kind: 'directory', name: 'notes', path: '/notes' },
		{ kind: 'file', name: 'Current.md', path: '/notes/Current.md' },
		{ kind: 'file', name: 'Alpha.MD', path: '/Alpha.MD' },
		{ kind: 'file', name: 'data.json', path: '/data.json' },
		{ kind: 'file', name: 'Beta.md', path: '/Beta.md' }
	],
	documentRendered: false,
	documentUnsupported: false,
	strictOpenKnowledgeFormat: true
} satisfies EditorDocumentProjectionInput

describe('editor document projection', () => {
	test('projects parsed body, title, references, and document paths in source order', () => {
		const projection = projectEditorDocument(baseInput)

		expect(projection.richMarkdown).toBe('Body')
		expect(projection.documentTitle).toBe('Frontmatter title')
		expect(projection.conformanceIssue).toBeNull()
		expect(projection.canRepairFrontmatter).toBe(true)
		expect(projection.references).toEqual([
			{ kind: 'directory', path: '/', label: 'Knowledge base' },
			{ kind: 'directory', path: '/notes', label: 'notes' },
			{ kind: 'file', path: '/Alpha.MD', label: 'Alpha.MD' },
			{ kind: 'file', path: '/data.json', label: 'data.json' },
			{ kind: 'file', path: '/Beta.md', label: 'Beta.md' }
		])
		expect(projection.documentPaths).toEqual([
			'/notes/Current.md',
			'/Alpha.MD',
			'/data.json',
			'/Beta.md'
		])
	})

	test('preserves frontmatter while replacing a parsed document body', () => {
		const projection = projectEditorDocument(baseInput)

		expect(replaceEditorDocumentBody(projection.parsed, 'Updated')).toBe(
			'---\ntype: note\ntitle: Frontmatter title\n---\n\nUpdated'
		)
	})

	test('treats invalid frontmatter as ordinary Markdown and replaces the whole document', () => {
		const invalidMarkdown = '---\ntitle: [one\n---\nBody'
		const projection = projectEditorDocument({ ...baseInput, markdown: invalidMarkdown })

		expect(projection.parsed.ok).toBe(false)
		expect(projection.richMarkdown).toBe(invalidMarkdown)
		expect(projection.documentTitle).toBe('Current')
		expect(projection.conformanceIssue).toBeNull()
		expect(projection.canRepairFrontmatter).toBe(false)
		expect(replaceEditorDocumentBody(projection.parsed, '# Replaced document')).toBe(
			'# Replaced document'
		)
	})

	test('projects strict conformance without blocking ordinary Markdown', () => {
		const projection = projectEditorDocument({ ...baseInput, markdown: '# Notes' })

		expect(projection.richMarkdown).toBe('# Notes')
		expect(projection.conformanceIssue).toBe('error.open-knowledge.frontmatter-required')
		expect(projection.canRepairFrontmatter).toBe(true)
	})

	test('disables structured projections for rendered documents', () => {
		const projection = projectEditorDocument({ ...baseInput, documentRendered: true })

		expect(projection.richMarkdown).toBe(markdown)
		expect(projection.documentTitle).toBe('Current.md')
		expect(projection.conformanceIssue).toBeNull()
		expect(projection.canRepairFrontmatter).toBe(false)
		expect(projection.references).toEqual([])
	})

	test('offers workspace links in ordinary Markdown projects', () => {
		const projection = projectEditorDocument(baseInput)

		expect(projection.references.map(({ path }) => path)).toEqual([
			'/',
			'/notes',
			'/Alpha.MD',
			'/data.json',
			'/Beta.md'
		])
	})
})
