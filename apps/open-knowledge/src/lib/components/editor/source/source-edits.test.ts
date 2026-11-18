import { describe, expect, test } from 'bun:test'
import { indentSource, outdentSource, type SourceEdit } from './source-edits'

type SourceEditCase<Edit extends SourceEdit | null = SourceEdit | null> = {
	name: string
	value: string
	selectionStart: number
	selectionEnd: number
	expected: Edit
	result: string
}

describe('source indentation edits', () => {
	const matrix: SourceEditCase<SourceEdit>[] = [
		{
			name: 'inserts a tab at a collapsed selection',
			value: 'alpha',
			selectionStart: 2,
			selectionEnd: 2,
			expected: {
				replacement: '\t',
				start: 2,
				end: 2,
				nextSelectionStart: 3,
				nextSelectionEnd: 3
			},
			result: 'al\tpha'
		},
		{
			name: 'uses UTF-16 indexes after a supplementary character',
			value: '😀alpha',
			selectionStart: 2,
			selectionEnd: 2,
			expected: {
				replacement: '\t',
				start: 2,
				end: 2,
				nextSelectionStart: 3,
				nextSelectionEnd: 3
			},
			result: '😀\talpha'
		},
		{
			name: 'expands a partial selection to every selected line',
			value: '😀a\nbeta',
			selectionStart: 2,
			selectionEnd: 8,
			expected: {
				replacement: '\t😀a\n\tbeta',
				start: 0,
				end: 8,
				nextSelectionStart: 0,
				nextSelectionEnd: 10
			},
			result: '\t😀a\n\tbeta'
		},
		{
			name: 'does not indent the next line when the selection ends with a newline',
			value: 'one\ntwo\nthree',
			selectionStart: 0,
			selectionEnd: 4,
			expected: {
				replacement: '\tone',
				start: 0,
				end: 3,
				nextSelectionStart: 0,
				nextSelectionEnd: 4
			},
			result: '\tone\ntwo\nthree'
		},
		{
			name: 'preserves carriage returns in selected lines',
			value: 'one\r\ntwo',
			selectionStart: 0,
			selectionEnd: 5,
			expected: {
				replacement: '\tone\r',
				start: 0,
				end: 4,
				nextSelectionStart: 0,
				nextSelectionEnd: 5
			},
			result: '\tone\r\ntwo'
		}
	]

	for (const { name, value, selectionStart, selectionEnd, expected, result } of matrix) {
		test(name, () => {
			const edit = indentSource(value, selectionStart, selectionEnd)
			expect(edit).toEqual(expected)
			expect(applySourceEdit(value, edit)).toBe(result)
		})
	}
})

describe('source outdent edits', () => {
	const mixedIndentation = '\tone\n two\n  three\n   four\nplain'
	const matrix: SourceEditCase[] = [
		{
			name: 'adjusts a collapsed UTF-16 selection after removing a tab',
			value: '\t😀alpha',
			selectionStart: 3,
			selectionEnd: 3,
			expected: {
				replacement: '😀alpha',
				start: 0,
				end: 8,
				nextSelectionStart: 2,
				nextSelectionEnd: 2
			},
			result: '😀alpha'
		},
		{
			name: 'clamps a cursor inside removed spaces to the line start',
			value: '  alpha',
			selectionStart: 1,
			selectionEnd: 1,
			expected: {
				replacement: 'alpha',
				start: 0,
				end: 7,
				nextSelectionStart: 0,
				nextSelectionEnd: 0
			},
			result: 'alpha'
		},
		{
			name: 'removes one tab or up to two spaces from selected lines',
			value: mixedIndentation,
			selectionStart: 1,
			selectionEnd: 31,
			expected: {
				replacement: 'one\ntwo\nthree\n four\nplain',
				start: 0,
				end: 31,
				nextSelectionStart: 0,
				nextSelectionEnd: 25
			},
			result: 'one\ntwo\nthree\n four\nplain'
		},
		{
			name: 'does not outdent the next line when the selection ends with a newline',
			value: '\tone\n\ttwo',
			selectionStart: 0,
			selectionEnd: 5,
			expected: {
				replacement: 'one',
				start: 0,
				end: 4,
				nextSelectionStart: 0,
				nextSelectionEnd: 3
			},
			result: 'one\n\ttwo'
		},
		{
			name: 'returns no edit when selected lines have no indentation',
			value: 'one\ntwo',
			selectionStart: 1,
			selectionEnd: 6,
			expected: null,
			result: 'one\ntwo'
		}
	]

	for (const { name, value, selectionStart, selectionEnd, expected, result } of matrix) {
		test(name, () => {
			const edit = outdentSource(value, selectionStart, selectionEnd)
			expect(edit).toEqual(expected)
			expect(edit ? applySourceEdit(value, edit) : value).toBe(result)
		})
	}
})

function applySourceEdit(value: string, edit: SourceEdit): string {
	return `${value.slice(0, edit.start)}${edit.replacement}${value.slice(edit.end)}`
}
