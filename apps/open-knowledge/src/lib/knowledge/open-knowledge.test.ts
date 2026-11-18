import { describe, expect, test } from 'bun:test'
import {
	isPathInOpenKnowledgeRoots,
	newMarkdownDocumentContent,
	normalizeMarkdownFileName,
	openKnowledgeRootForPath
} from './open-knowledge'

describe('Open Knowledge root matching', () => {
	test('matches root bundles recursively', () => {
		expect(isPathInOpenKnowledgeRoots('/guide.md', ['/'])).toBe(true)
		expect(isPathInOpenKnowledgeRoots('/guides/topic.md', ['/'])).toBe(true)
	})

	test('keeps nested bundles scoped to their subtree', () => {
		const roots = ['/knowledge', '/knowledge/special'] as const
		expect(isPathInOpenKnowledgeRoots('/notes.md', roots)).toBe(false)
		expect(isPathInOpenKnowledgeRoots('/knowledge/topic.md', roots)).toBe(true)
		expect(openKnowledgeRootForPath('/knowledge/special/topic.md', roots)).toBe(
			'/knowledge/special'
		)
	})

	test('creates Markdown names and Open Knowledge templates', () => {
		expect(normalizeMarkdownFileName('release-checklist')).toBe('release-checklist.md')
		expect(newMarkdownDocumentContent('plain.md', false)).toBe('')
		expect(newMarkdownDocumentContent('release-checklist.md', true)).toBe(
			'---\ntype: note\ntitle: Release checklist\nstatus: draft\n---\n\n# Release checklist\n\n'
		)
		expect(newMarkdownDocumentContent('index.md', true)).toBe('# Index\n\n')
	})
})
