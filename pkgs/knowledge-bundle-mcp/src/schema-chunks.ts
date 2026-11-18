type SourceLine = { readonly text: string; readonly start: number; readonly end: number }

export type MarkdownTableRow = {
	/** Inclusive, zero-based source line indices. */
	startIndex: number
	endIndex: number
	headerStartIndex: number
	headers: string[]
	values: string[]
	record: Record<string, string>
	searchText: string
}

const MAX_COLUMNS = 64
const MAX_ROW_CHARACTERS = 16_384
const MAX_CELL_CHARACTERS = 4_096

function plainLine(line: SourceLine): string {
	return line.text.replace(/\r?\n$/, '')
}

/** Keep Markdown cell text, decoding only the pipe escape used by GFM tables. */
function cells(source: string): { values: string[]; hasPipe: boolean } | undefined {
	if (source.length > MAX_ROW_CHARACTERS || /^(?: {4}| *\t)/.test(source)) return
	const text = source.trim()
	if (!text) return
	const values: string[] = []
	let value = ''
	let codeTicks = 0
	let lastSeparator = -1
	for (let index = 0; index < text.length; index++) {
		const character = text[index]!
		if (character === '\\') {
			const next = text[index + 1]
			if (next === '|') {
				value += '|'
				index++
				continue
			}
			if (next === '\\' || (next === '`' && !codeTicks)) {
				value += character + next
				index++
				continue
			}
		}
		if (character === '`') {
			let end = index + 1
			while (text[end] === '`') end++
			const ticks = end - index
			if (!codeTicks) codeTicks = ticks
			else if (codeTicks === ticks) codeTicks = 0
			value += text.slice(index, end)
			index = end - 1
			continue
		}
		if (character === '|') {
			// GFM requires pipes inside code spans to be escaped as well. Ambiguous
			// code spans fall back to plain retrieval instead of guessing columns.
			if (codeTicks) return
			values.push(value.trim())
			if (values.length > MAX_COLUMNS + 1) return
			value = ''
			lastSeparator = index
		} else value += character
	}
	if (codeTicks) return
	values.push(value.trim())
	if (text.startsWith('|')) values.shift()
	if (lastSeparator === text.length - 1) values.pop()
	if (
		!values.length ||
		values.length > MAX_COLUMNS ||
		values.some((cell) => cell.length > MAX_CELL_CHARACTERS)
	)
		return
	return { values, hasPipe: lastSeparator !== -1 }
}

function startsBlock(text: string): boolean {
	return /^ {0,3}(?:#{1,6}(?:\s|$)|>|(?:[-+*]|\d+[.)])\s|`{3,}|~{3,})/.test(text)
}

/**
 * Extract only unambiguous GFM table records. One malformed row invalidates its
 * whole table, leaving the caller free to retrieve the original plain chunks.
 * Source offsets and raw source text remain entirely under the caller's control.
 */
export function markdownTableRows(
	lines: readonly SourceLine[],
	bodyStart: number
): MarkdownTableRow[] {
	if (!Number.isInteger(bodyStart) || bodyStart < 0 || bodyStart >= lines.length) return []
	const rows: MarkdownTableRow[] = []
	let fence: { character: string; length: number } | undefined
	for (let index = bodyStart; index < lines.length; index++) {
		const text = plainLine(lines[index]!)
		const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
		if (fence) {
			if (
				fenceMatch &&
				fenceMatch[1]![0] === fence.character &&
				fenceMatch[1]!.length >= fence.length &&
				!fenceMatch[2]!.trim()
			)
				fence = undefined
			continue
		}
		if (fenceMatch && (fenceMatch[1]![0] !== '`' || !fenceMatch[2]!.includes('`'))) {
			fence = { character: fenceMatch[1]![0]!, length: fenceMatch[1]!.length }
			continue
		}
		if (index + 1 >= lines.length || startsBlock(text)) continue
		const delimiter = cells(plainLine(lines[index + 1]!))
		if (!delimiter || !delimiter.values.every((cell) => /^:?-+:?$/.test(cell))) continue
		const header = cells(text)
		const headers = header?.values ?? []
		let valid = Boolean(
			header &&
			(header.hasPipe || delimiter.hasPipe) &&
			headers.length === delimiter.values.length &&
			headers.every(Boolean) &&
			new Set(headers).size === headers.length
		)
		const tableRows: MarkdownTableRow[] = []
		let end = index + 2
		for (; end < lines.length; end++) {
			const rowText = plainLine(lines[end]!)
			if (!rowText.trim() || startsBlock(rowText)) break
			const parsed = cells(rowText)
			if (!parsed || parsed.values.length !== headers.length) {
				valid = false
				continue
			}
			if (!valid) continue
			const values = parsed.values
			const record = Object.fromEntries(headers.map((header, column) => [header, values[column]!]))
			tableRows.push({
				startIndex: end,
				endIndex: end,
				headerStartIndex: index,
				headers: [...headers],
				values,
				record,
				searchText: JSON.stringify(record)
			})
		}
		if (valid) for (const row of tableRows) rows.push(row)
		index = end - 1
	}
	return rows
}
