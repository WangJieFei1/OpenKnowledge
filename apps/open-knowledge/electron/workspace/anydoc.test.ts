import { describe, expect, test } from 'bun:test'
import { renderAnydocDocument } from './anydoc-runtime'

describe('Anydoc rendering', () => {
	test('converts bytes to Markdown in the Electron backend', async () => {
		const markdown = await renderAnydocDocument(
			'/scores.csv',
			new TextEncoder().encode('Name,Score\nAda,10\n')
		)
		expect(markdown).toContain('| Name | Score |')
		expect(markdown).toContain('| Ada | 10 |')
	})
})
