import type { Command, EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import {
	insertHardBreak,
	insertHorizontalRule,
	insertTable,
	setTextBlock,
	toggleBlockquote,
	toggleList
} from '../prosemirror/commands'
import { editorNode, editorSchema } from '../prosemirror/schema'

export const slashCommandIDs = [
	'text',
	'heading-1',
	'heading-2',
	'heading-3',
	'heading-4',
	'heading-5',
	'heading-6',
	'bullet-list',
	'ordered-list',
	'blockquote',
	'code-block',
	'horizontal-rule',
	'table',
	'image',
	'hard-break'
] as const

export type SlashCommandID = (typeof slashCommandIDs)[number]
export type SlashCommandSearchText = Readonly<Record<SlashCommandID, string>>

export interface SlashCommandMatch {
	from: number
	to: number
	query: string
}

const commands: Record<Exclude<SlashCommandID, 'image'>, Command> = {
	text: setTextBlock(editorSchema, 'paragraph'),
	'heading-1': setTextBlock(editorSchema, 'heading-1'),
	'heading-2': setTextBlock(editorSchema, 'heading-2'),
	'heading-3': setTextBlock(editorSchema, 'heading-3'),
	'heading-4': setTextBlock(editorSchema, 'heading-4'),
	'heading-5': setTextBlock(editorSchema, 'heading-5'),
	'heading-6': setTextBlock(editorSchema, 'heading-6'),
	'bullet-list': toggleList(editorSchema, editorNode('bullet_list')),
	'ordered-list': toggleList(editorSchema, editorNode('ordered_list')),
	blockquote: toggleBlockquote(editorSchema),
	'code-block': setTextBlock(editorSchema, 'code_block'),
	'horizontal-rule': insertHorizontalRule(editorSchema),
	table: insertTable(editorSchema),
	'hard-break': insertHardBreak(editorSchema)
}

export function detectSlashCommand(state: EditorState): SlashCommandMatch | null {
	if (!state.selection.empty || !state.selection.$from.parent.isTextblock) {
		return null
	}
	if (state.selection.$from.parent.type === editorNode('code_block')) {
		return null
	}
	const textBefore = state.selection.$from.parent.textBetween(
		0,
		state.selection.$from.parentOffset,
		undefined,
		'\ufffc'
	)
	const match = /^\/([^\s/]*)$/.exec(textBefore)
	if (!match) {
		return null
	}
	return {
		from: state.selection.from - match[0].length,
		to: state.selection.from,
		query: match[1] ?? ''
	}
}

export function filterSlashCommands(
	query: string,
	searchText: SlashCommandSearchText
): SlashCommandID[] {
	const normalized = query.trim().toLowerCase()
	if (!normalized) {
		return [...slashCommandIDs]
	}
	return slashCommandIDs.filter((id) =>
		`${id} ${searchText[id]}`.toLowerCase().includes(normalized)
	)
}

export function runSlashCommand(
	view: EditorView,
	match: SlashCommandMatch,
	commandID: SlashCommandID
): 'image' | null {
	view.dispatch(view.state.tr.delete(match.from, match.to))
	if (commandID === 'image') {
		view.focus()
		return 'image'
	}
	commands[commandID](view.state, view.dispatch, view)
	view.focus()
	return null
}
