import { expect, test } from 'bun:test'
import { markdownTableRows } from './schema-chunks'

function lines(markdown: string): { text: string; start: number; end: number }[] {
	let start = 0
	return markdown.match(/[^\n]*\n|[^\n]+$/g)!.map((text) => {
		const line = { text, start, end: start + text.length }
		start = line.end
		return line
	})
}

test('fiscal-year rows retain independent named string values and exact source indices', () => {
	const source = lines(
		'# Revenue\r\n\r\n| Year | Revenue | Growth |\r\n| :--- | ---: | ---: |\r\n| FY23 | 00120 | 8% |\r\n| FY24 | 145 | 20.8% |\r\n'
	)
	const rows = markdownTableRows(source, 0)
	expect(rows).toHaveLength(2)
	expect(rows[0]).toEqual({
		startIndex: 4,
		endIndex: 4,
		headerStartIndex: 2,
		headers: ['Year', 'Revenue', 'Growth'],
		values: ['FY23', '00120', '8%'],
		record: { Year: 'FY23', Revenue: '00120', Growth: '8%' },
		searchText: '{"Year":"FY23","Revenue":"00120","Growth":"8%"}'
	})
	expect(rows[1]!.record).toEqual({ Year: 'FY24', Revenue: '145', Growth: '20.8%' })
	expect(rows[1]!.startIndex).toBe(5)
	expect(source[rows[0]!.startIndex]!.text).toBe('| FY23 | 00120 | 8% |\r\n')
	expect(JSON.parse(rows[1]!.searchText)).toEqual(rows[1]!.record)
})

test('escaped pipes and code spans preserve cell boundaries without interpreting values', () => {
	const rows = markdownTableRows(
		lines('Name | Expression\\|unit\n--- | ---\nAda\\|Lee | `a\\|b`\nBob | ``x`y``\n'),
		0
	)
	expect(rows.map((row) => row.record)).toEqual([
		{ Name: 'Ada|Lee', 'Expression|unit': '`a|b`' },
		{ Name: 'Bob', 'Expression|unit': '``x`y``' }
	])
})

test('empty cells stay empty strings and optional outer pipes are supported', () => {
	const rows = markdownTableRows(lines('Year | Notes | Value\n- | :-: | -:\nFY24 | | 0\n'), 0)
	expect(rows[0]!.record).toEqual({ Year: 'FY24', Notes: '', Value: '0' })
	expect(rows[0]!.values).toEqual(['FY24', '', '0'])
	expect(markdownTableRows(lines('| Notes |\n| --- |\n| |\n'), 0)[0]!.record).toEqual({
		Notes: ''
	})
})

test('duplicate, empty, or differently sized headers reject the table', () => {
	for (const header of ['| Year | Year |', '| Year | |', '| Year |']) {
		expect(markdownTableRows(lines(`${header}\n| --- | --- |\n| FY24 | 10 |\n`), 0)).toEqual([])
	}
	expect(markdownTableRows(lines('| A\\|B | A\\|B |\n| --- | --- |\n| a | b |\n'), 0)).toEqual([])
})

test('one malformed row rejects earlier and later rows from the same table', () => {
	for (const malformed of ['| FY24 |', '| FY24 | 11 | extra |', 'FY24']) {
		const rows = markdownTableRows(
			lines(`| Year | Value |\n| --- | --- |\n| FY23 | 10 |\n${malformed}\n| FY25 | 12 |\n`),
			0
		)
		expect(rows).toEqual([])
	}
})

test('ambiguous or unclosed code spans fall back to plain retrieval', () => {
	for (const value of ['`a|b`', '`unclosed', '``a`']) {
		expect(
			markdownTableRows(lines(`| Name | Code |\n| --- | --- |\n| Ada | ${value} |\n`), 0)
		).toEqual([])
	}
})

test('backtick and tilde fenced tables are ignored until a matching full closing fence', () => {
	const table = '| Year | Value |\n| --- | --- |\n| FY24 | 10 |\n'
	for (const fence of ['````', '~~~~']) {
		const markdown = `${fence}md\n${table}${fence.slice(0, 3)}\n${table}${fence} trailing\n${table}${fence}\n\n${table}`
		const rows = markdownTableRows(lines(markdown), 0)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.startIndex).toBe(16)
	}
})

test('bodyStart skips metadata and blank or heading boundaries separate valid tables', () => {
	const rows = markdownTableRows(
		lines(
			'| Hidden | Value |\n| --- | --- |\n| FY22 | 9 |\n\n| Year | Value |\n| --- | --- |\n| FY23 | 10 |\n# Next\n| Year | Value |\n| --- | --- |\n| FY24 | 11 |\n'
		),
		4
	)
	expect(rows.map((row) => row.headerStartIndex)).toEqual([4, 8])
	expect(rows.map((row) => row.startIndex)).toEqual([6, 10])
})

test('ordinary text, indented code, and separator-like prose do not become records', () => {
	for (const source of [
		'Heading\n---\nParagraph\n',
		'    | Year | Value |\n    | --- | --- |\n    | FY24 | 10 |\n',
		'| Year | Value |\n| --- | text |\n| FY24 | 10 |\n'
	]) {
		expect(markdownTableRows(lines(source), 0)).toEqual([])
	}
})

test('column, row and cell bounds reject oversized tables without truncating records', () => {
	const row = (values: string[]) => `| ${values.join(' | ')} |\n`
	for (const count of [64, 65]) {
		const source = [
			row(Array.from({ length: count }, (_, index) => `Column ${index}`)),
			row(Array.from({ length: count }, () => '---')),
			row(Array.from({ length: count }, () => 'value'))
		].join('')
		expect(markdownTableRows(lines(source), 0)).toHaveLength(count === 64 ? 1 : 0)
	}
	expect(
		markdownTableRows(lines(`| Name | Value |\n| --- | --- |\n| Ada | ${'x'.repeat(4_097)} |\n`), 0)
	).toEqual([])
	const oversized = row(Array.from({ length: 5 }, () => 'x'.repeat(4_000)))
	expect(
		markdownTableRows(lines(`| A | B | C | D | E |\n| - | - | - | - | - |\n${oversized}`), 0)
	).toEqual([])
})

test('prototype-like column names are retained as ordinary own data properties', () => {
	const rows = markdownTableRows(
		lines('| __proto__ | constructor |\n| --- | --- |\n| untrusted | literal |\n'),
		0
	)
	expect(Object.hasOwn(rows[0]!.record, '__proto__')).toBe(true)
	expect(JSON.parse(rows[0]!.searchText)).toEqual({
		['__proto__']: 'untrusted',
		constructor: 'literal'
	})
})
