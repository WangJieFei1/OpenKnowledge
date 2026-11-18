export const maximumExactTextPatchEdits = 100
export const maximumExactTextPatchCharacters = 256 * 1024

export type ExactTextEdit = {
	readonly oldText: string
	readonly newText: string
}

export type ExactTextPatchErrorReason =
	| 'empty_patch'
	| 'too_many_edits'
	| 'too_large'
	| 'invalid_edit'
	| 'invalid_unicode'
	| 'not_found'
	| 'ambiguous'

export class ExactTextPatchError extends Error {
	override readonly name = 'ExactTextPatchError'

	constructor(
		readonly editNumber: number | null,
		readonly reason: ExactTextPatchErrorReason
	) {
		super(errorMessage(editNumber, reason))
	}
}

/** Applies ordered, uniquely anchored replacements without mutating the source string. */
export function applyExactTextPatch(source: string, edits: readonly ExactTextEdit[]): string {
	validateEdits(edits)

	let result = source
	for (const [index, edit] of edits.entries()) {
		const matchIndex = result.indexOf(edit.oldText)
		if (matchIndex === -1) {
			throw new ExactTextPatchError(index + 1, 'not_found')
		}
		if (result.indexOf(edit.oldText, matchIndex + 1) !== -1) {
			throw new ExactTextPatchError(index + 1, 'ambiguous')
		}
		result = `${result.slice(0, matchIndex)}${edit.newText}${result.slice(matchIndex + edit.oldText.length)}`
	}
	return result
}

export function isWellFormedText(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index)
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1)
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				return false
			}
			index += 1
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			return false
		}
	}
	return true
}

function validateEdits(edits: readonly ExactTextEdit[]): void {
	if (edits.length === 0) {
		throw new ExactTextPatchError(null, 'empty_patch')
	}
	if (edits.length > maximumExactTextPatchEdits) {
		throw new ExactTextPatchError(null, 'too_many_edits')
	}

	let characters = 0
	for (const [index, edit] of edits.entries()) {
		if (!edit.oldText || edit.oldText === edit.newText) {
			throw new ExactTextPatchError(index + 1, 'invalid_edit')
		}
		if (!isWellFormedText(edit.oldText) || !isWellFormedText(edit.newText)) {
			throw new ExactTextPatchError(index + 1, 'invalid_unicode')
		}
		characters += edit.oldText.length + edit.newText.length
		if (characters > maximumExactTextPatchCharacters) {
			throw new ExactTextPatchError(null, 'too_large')
		}
	}
}

function errorMessage(editNumber: number | null, reason: ExactTextPatchErrorReason): string {
	const edit = editNumber === null ? 'The patch' : `Edit ${editNumber}`
	switch (reason) {
		case 'empty_patch':
			return 'The patch must contain at least one edit.'
		case 'too_many_edits':
			return `The patch cannot contain more than ${maximumExactTextPatchEdits} edits.`
		case 'too_large':
			return `Patch text cannot exceed ${maximumExactTextPatchCharacters} characters.`
		case 'invalid_edit':
			return `${edit} must have non-empty old text and different replacement text.`
		case 'invalid_unicode':
			return `${edit} contains invalid Unicode.`
		case 'not_found':
			return `${edit} did not match the current text exactly. Read it again and include exact whitespace.`
		case 'ambiguous':
			return `${edit} matched more than once. Include more surrounding text to make it unique.`
	}
}
