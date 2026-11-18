import { describe, expect, test } from 'bun:test'
import { resolveMarkdownLinkTarget } from './markdown-links'

describe('Markdown link resolution', () => {
	test('resolves relative links from the current document directory', () => {
		expect(resolveMarkdownLinkTarget('child.md', '/notes/current.md', true)).toEqual({
			kind: 'workspace',
			path: '/notes/child.md'
		})
		expect(resolveMarkdownLinkTarget('../guide.md#intro', '/notes/current.md', true)).toEqual({
			kind: 'workspace',
			path: '/guide.md'
		})
		expect(resolveMarkdownLinkTarget('../../outside.md', '/notes/current.md', true)).toBeNull()
		expect(resolveMarkdownLinkTarget('/%2e%2e/outside.md', '/notes/current.md', true)).toBeNull()
	})

	test('resolves local documents supported by Anydoc', () => {
		expect(resolveMarkdownLinkTarget('../reports/results.xlsx', '/notes/current.md', true)).toEqual(
			{
				kind: 'workspace',
				path: '/reports/results.xlsx'
			}
		)
	})

	test('resolves absolute links from the project root by default', () => {
		expect(
			resolveMarkdownLinkTarget('/guides/start%20here.md?view=rich', '/notes/current.md', true)
		).toEqual({
			kind: 'workspace',
			path: '/guides/start here.md'
		})
		expect(resolveMarkdownLinkTarget('C:/guides/start.md', '/notes/current.md', true)).toEqual({
			kind: 'workspace',
			path: '/guides/start.md'
		})
		expect(resolveMarkdownLinkTarget('\\guides\\start.md', '/notes/current.md', true)).toEqual({
			kind: 'workspace',
			path: '/guides/start.md'
		})
		expect(
			resolveMarkdownLinkTarget('\\\\server\\share\\guides\\start.md', '/notes/current.md', true)
		).toEqual({ kind: 'workspace', path: '/guides/start.md' })
	})

	test('returns true system paths only when project-root resolution is disabled', () => {
		expect(resolveMarkdownLinkTarget('/home/user/guide.md', '/notes/current.md', false)).toEqual({
			kind: 'system',
			path: '/home/user/guide.md'
		})
		expect(resolveMarkdownLinkTarget('C:/Users/name/guide.md', '/notes/current.md', false)).toEqual(
			{
				kind: 'system',
				path: 'C:/Users/name/guide.md'
			}
		)
		expect(
			resolveMarkdownLinkTarget('\\\\server\\share\\guide.md', '/notes/current.md', false)
		).toEqual({ kind: 'system', path: '\\\\server\\share\\guide.md' })
	})

	test('does not reinterpret external, fragment-only, malformed, or non-document links', () => {
		for (const href of [
			'https://example.com/guide.md',
			'//example.com/guide.md',
			'#section',
			'%E0%A4%A',
			'../asset.png'
		]) {
			expect(resolveMarkdownLinkTarget(href, '/notes/current.md', true)).toBeNull()
		}
	})
})
