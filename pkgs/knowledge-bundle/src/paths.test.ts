import { describe, expect, test } from 'bun:test'
import {
	isCanonicalBundlePath,
	isMarkdownDocumentPath,
	isReservedKnowledgeDocument,
	parentBundlePath,
	parseBundlePath
} from './paths'

describe('bundle paths', () => {
	test('accepts canonical paths including the bundle root', () => {
		expect(isCanonicalBundlePath('')).toBe(true)
		expect(isCanonicalBundlePath('guides/getting-started.md')).toBe(true)
		expect(parseBundlePath('guides/getting-started.md')).toEqual(['guides', 'getting-started.md'])
		expect(parentBundlePath('guides/getting-started.md')).toBe('guides')
	})

	test('rejects absolute, platform-specific, and traversing paths', () => {
		for (const path of [
			'/guide.md',
			'guides\\guide.md',
			'guides/../guide.md',
			'guides//guide.md'
		]) {
			expect(isCanonicalBundlePath(path)).toBe(false)
			expect(() => parseBundlePath(path)).toThrow('canonical bundle-relative path')
		}
	})

	test('identifies Markdown and reserved documents', () => {
		expect(isMarkdownDocumentPath('guides/README.MD')).toBe(true)
		expect(isReservedKnowledgeDocument('guides/index.md')).toBe(true)
		expect(isReservedKnowledgeDocument('guides/Index.md')).toBe(false)
	})
})
