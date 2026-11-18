import { baseKeymap, chainCommands } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import {
	inputRules,
	textblockTypeInputRule,
	wrappingInputRule,
	type InputRule
} from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import type { Command, Plugin } from 'prosemirror-state'
import { goToNextCell, tableEditing } from 'prosemirror-tables'
import {
	indentListItem,
	insertHardBreak,
	insertTab,
	isNodeActive,
	markCommand,
	outdentListItem
} from './commands'
import { editorMark, editorNode, editorSchema } from './schema'

export function createEditorPlugins(): Plugin[] {
	const keepEditorFocus: Command = () => true
	const keepTableFocus: Command = (state) => isNodeActive(state, editorNode('table'))
	return [
		inputRules({ rules: markdownInputRules() }),
		keymap({
			'Mod-z': undo,
			'Mod-Shift-z': redo,
			'Mod-y': redo,
			'Mod-b': markCommand(editorMark('strong')),
			'Mod-i': markCommand(editorMark('em')),
			'Shift-Enter': insertHardBreak(editorSchema)
		}),
		keymap({
			Tab: chainCommands(
				goToNextCell(1),
				keepTableFocus,
				indentListItem(editorSchema),
				insertTab()
			),
			'Shift-Tab': chainCommands(
				goToNextCell(-1),
				keepTableFocus,
				outdentListItem(editorSchema),
				keepEditorFocus
			)
		}),
		keymap(baseKeymap),
		history(),
		tableEditing()
	]
}

function markdownInputRules(): InputRule[] {
	return [
		textblockTypeInputRule(/^(#{1,6})\s$/, editorNode('heading'), (match) => ({
			level: match[1]?.length ?? 1
		})),
		wrappingInputRule(/^\s*>\s$/, editorNode('blockquote')),
		wrappingInputRule(/^\s*([-+*])\s$/, editorNode('bullet_list')),
		wrappingInputRule(/^(\d+)\.\s$/, editorNode('ordered_list'), (match) => ({
			order: Number(match[1] ?? 1)
		})),
		textblockTypeInputRule(/^```([a-zA-Z0-9_+-]*)\s$/, editorNode('code_block'), (match) => ({
			params: match[1] ?? ''
		}))
	]
}
