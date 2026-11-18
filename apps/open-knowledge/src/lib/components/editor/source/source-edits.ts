export type SourceEdit = {
	replacement: string
	start: number
	end: number
	nextSelectionStart: number
	nextSelectionEnd: number
}

export function indentSource(
	value: string,
	selectionStart: number,
	selectionEnd: number
): SourceEdit {
	if (selectionStart === selectionEnd) {
		return {
			replacement: '\t',
			start: selectionStart,
			end: selectionEnd,
			nextSelectionStart: selectionStart + 1,
			nextSelectionEnd: selectionStart + 1
		}
	}

	const { start, end } = selectedLineRange(value, selectionStart, selectionEnd)
	const replacement = value
		.slice(start, end)
		.split('\n')
		.map((line) => `\t${line}`)
		.join('\n')
	return {
		replacement,
		start,
		end,
		nextSelectionStart: start,
		nextSelectionEnd: start + replacement.length
	}
}

export function outdentSource(
	value: string,
	selectionStart: number,
	selectionEnd: number
): SourceEdit | null {
	const { start, end } = selectedLineRange(value, selectionStart, selectionEnd)
	const source = value.slice(start, end)
	const replacement = source
		.split('\n')
		.map((line) => line.replace(/^(\t| {1,2})/, ''))
		.join('\n')
	if (source === replacement) {
		return null
	}

	const collapsed = selectionStart === selectionEnd
	const nextSelectionStart = collapsed
		? Math.max(start, selectionStart - (source.length - replacement.length))
		: start
	return {
		replacement,
		start,
		end,
		nextSelectionStart,
		nextSelectionEnd: collapsed ? nextSelectionStart : start + replacement.length
	}
}

function selectedLineRange(
	value: string,
	selectionStart: number,
	selectionEnd: number
): { start: number; end: number } {
	const start = value.lastIndexOf('\n', selectionStart - 1) + 1
	const adjustedEnd =
		selectionEnd > selectionStart && value[selectionEnd - 1] === '\n'
			? selectionEnd - 1
			: selectionEnd
	const nextBreak = value.indexOf('\n', adjustedEnd)
	return { start, end: nextBreak < 0 ? value.length : nextBreak }
}
