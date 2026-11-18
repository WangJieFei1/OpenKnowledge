import { describe, expect, test } from 'bun:test'
import { hasSameAnydocExtension, isAnydocPath, markdownPathForAnydoc } from './anydoc'

describe('Anydoc file paths', () => {
	test('recognizes supported extensions case-insensitively', () => {
		expect(isAnydocPath('/documents/report.pdf')).toBe(true)
		expect(isAnydocPath('/documents/REPORT.DOCX')).toBe(true)
	})

	test('rejects Markdown and unsupported or extensionless paths', () => {
		for (const path of [
			'/documents/report.md',
			'/documents/report.tsv',
			'/documents/report.potx',
			'/documents/report',
			'/documents.with.dot/report',
			'/.csv',
			'/documents/.pdf'
		]) {
			expect(isAnydocPath(path)).toBe(false)
		}
	})

	test('distinguishes extensions that select different parsers', () => {
		expect(hasSameAnydocExtension('/report.PDF', 'renamed.pdf')).toBe(true)
		expect(hasSameAnydocExtension('/report.csv', 'renamed.pdf')).toBe(false)
		expect(hasSameAnydocExtension('/report.md', 'renamed.md')).toBe(false)
	})

	test('replaces a supported extension with Markdown', () => {
		expect(markdownPathForAnydoc('/documents/quarterly.report.PDF')).toBe(
			'/documents/quarterly.report.md'
		)
		expect(markdownPathForAnydoc('/documents/report.md')).toBeNull()
	})
})
