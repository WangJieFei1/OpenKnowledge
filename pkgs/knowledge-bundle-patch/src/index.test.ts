import { describe, expect, test } from 'bun:test'
import {
	applyExactTextPatch,
	ExactTextPatchError,
	maximumExactTextPatchCharacters,
	maximumExactTextPatchEdits
} from './index'

describe('exact text patch', () => {
	test('applies edits sequentially', () => {
		expect(
			applyExactTextPatch('# Draft\n\nRemove this.\n', [
				{ oldText: '# Draft', newText: '# Guide' },
				{ oldText: '# Guide\n\n', newText: '# Published Guide\n\nIntroduction.\n\n' },
				{ oldText: 'Remove this.\n', newText: '' }
			])
		).toBe('# Published Guide\n\nIntroduction.\n\n')
	})

	test('rejects missing text without returning a partial result', () => {
		expect(() =>
			applyExactTextPatch('Alpha\nBeta\n', [
				{ oldText: 'Alpha', newText: 'Changed' },
				{ oldText: 'Missing', newText: 'Never applied' }
			])
		).toThrow(new ExactTextPatchError(2, 'not_found'))
	})

	test('rejects repeated and overlapping matches', () => {
		expect(() =>
			applyExactTextPatch('repeat\nrepeat\n', [{ oldText: 'repeat', newText: 'changed' }])
		).toThrow(new ExactTextPatchError(1, 'ambiguous'))
		expect(() => applyExactTextPatch('aaaa', [{ oldText: 'aaa', newText: 'changed' }])).toThrow(
			new ExactTextPatchError(1, 'ambiguous')
		)
	})

	test('matches complete Unicode code points and rejects split surrogate pairs', () => {
		expect(applyExactTextPatch('Status: 😀\n', [{ oldText: '😀', newText: 'ready' }])).toBe(
			'Status: ready\n'
		)
		expect(() =>
			applyExactTextPatch('Status: 😀\n', [{ oldText: '\ud83d', newText: 'broken' }])
		).toThrow(new ExactTextPatchError(1, 'invalid_unicode'))
	})

	test('preserves line endings and final-newline state exactly', () => {
		expect(
			applyExactTextPatch('First\r\nSecond\r\n', [
				{ oldText: 'Second\r\n', newText: 'Updated\r\n' }
			])
		).toBe('First\r\nUpdated\r\n')
	})

	test('rejects empty, no-op, and oversized patches', () => {
		expect(() => applyExactTextPatch('text', [])).toThrow(
			new ExactTextPatchError(null, 'empty_patch')
		)
		expect(() => applyExactTextPatch('text', [{ oldText: '', newText: 'new' }])).toThrow(
			new ExactTextPatchError(1, 'invalid_edit')
		)
		expect(() => applyExactTextPatch('text', [{ oldText: 'text', newText: 'text' }])).toThrow(
			new ExactTextPatchError(1, 'invalid_edit')
		)
		expect(() =>
			applyExactTextPatch(
				'text',
				Array.from({ length: maximumExactTextPatchEdits + 1 }, () => ({
					oldText: 'text',
					newText: 'changed'
				}))
			)
		).toThrow(new ExactTextPatchError(null, 'too_many_edits'))
		expect(() =>
			applyExactTextPatch('x', [
				{ oldText: 'x', newText: 'y'.repeat(maximumExactTextPatchCharacters) }
			])
		).toThrow(new ExactTextPatchError(null, 'too_large'))
	})
})
