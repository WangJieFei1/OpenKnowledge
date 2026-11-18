import MarkdownIt from 'markdown-it'
import Token from 'markdown-it/lib/token.mjs'
import {
	MarkdownParser,
	MarkdownSerializer,
	defaultMarkdownParser,
	defaultMarkdownSerializer,
	type MarkdownSerializerState
} from 'prosemirror-markdown'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { editorSchema } from './schema'

const tokenizer = new MarkdownIt('commonmark', {
	html: false,
	linkify: false,
	typographer: false
}).enable(['table', 'strikethrough'])
const parseTokens = tokenizer.parse.bind(tokenizer)

tokenizer.parse = function parseWithTableParagraphs(source, environment) {
	const tokens = parseTokens(source, environment)
	const result: Token[] = []
	for (const token of tokens) {
		if (token.type === 'th_close' || token.type === 'td_close') {
			result.push(new Token('paragraph_close', 'p', -1))
		}
		result.push(token)
		if (token.type === 'th_open' || token.type === 'td_open') {
			result.push(new Token('paragraph_open', 'p', 1))
		}
	}
	return result
}

const markdownParser = new MarkdownParser(editorSchema, tokenizer, {
	...defaultMarkdownParser.tokens,
	table: { block: 'table' },
	thead: { ignore: true },
	tbody: { ignore: true },
	tr: { block: 'table_row' },
	th: { block: 'table_header' },
	td: { block: 'table_cell' },
	s: { mark: 'strike' }
})

const serializerNodes: ConstructorParameters<typeof MarkdownSerializer>[0] = {
	...defaultMarkdownSerializer.nodes,
	text(state, node) {
		const inCode = node.marks.some((mark) => mark.type.name === 'code')
		const value = inCode ? node.text : node.text?.replace(/\t/g, '&#9;')
		const inAutolink = (state as MarkdownSerializerState & { inAutolink?: boolean }).inAutolink
		state.text(value ?? '', !inAutolink)
	},
	table(state, node) {
		const rows: string[][] = []
		node.forEach((row) => {
			const cells: string[] = []
			row.forEach((cell) => cells.push(serializeTableCell(cell)))
			rows.push(cells)
		})
		if (rows.length === 0) {
			return
		}

		const columnCount = Math.max(...rows.map((row) => row.length))
		function renderRow(row: string[]): string {
			return `| ${Array.from({ length: columnCount }, (_, index) => row[index] ?? '').join(' | ')} |`
		}
		const firstRow = rows[0] ?? []
		const lines = [
			renderRow(firstRow),
			`| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`,
			...rows.slice(1).map(renderRow)
		]
		state.write(lines.join('\n'))
		state.closeBlock(node)
	}
}

const serializerMarks: ConstructorParameters<typeof MarkdownSerializer>[1] = {
	...defaultMarkdownSerializer.marks,
	strike: {
		open: '~~',
		close: '~~',
		mixable: true,
		expelEnclosingWhitespace: true
	}
}

const markdownSerializer = new MarkdownSerializer(serializerNodes, serializerMarks)

export function parseMarkdown(markdown: string): ProseMirrorNode {
	return markdownParser.parse(markdown)
}

export function serializeMarkdown(document: ProseMirrorNode): string {
	return markdownSerializer.serialize(document)
}

export function withMarkdownTrailingLineBreaks(serialized: string, source: string): string {
	return `${serialized}${/(?:\r?\n)+$/.exec(source)?.[0] ?? ''}`
}

function serializeTableCell(cell: ProseMirrorNode): string {
	return escapeTableCell(markdownSerializer.serialize(cell))
}

function escapeTableCell(value: string): string {
	return value
		.trim()
		.replace(/(^|[^\\])\|/g, '$1\\|')
		.replace(/\n+/g, '<br>')
}
