import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import type { MarkType, NodeType, Schema } from 'prosemirror-model'
import { liftListItem, sinkListItem, wrapInList } from 'prosemirror-schema-list'
import { TextSelection, type Command, type EditorState } from 'prosemirror-state'

export function isMarkActive(state: EditorState | null, mark: MarkType | undefined): boolean {
	if (!state || !mark) {
		return false
	}
	const { from, to, empty, $from } = state.selection
	if (empty) {
		return Boolean(mark.isInSet(state.storedMarks ?? $from.marks()))
	}
	return state.doc.rangeHasMark(from, to, mark)
}

export function isNodeActive(state: EditorState | null, type: NodeType | undefined): boolean {
	return Boolean(state && type && ancestorDepth(state, type) !== undefined)
}

export function currentBlockType(state: EditorState | null): string {
	if (!state) {
		return 'paragraph'
	}
	const parent = state.selection.$from.parent
	if (parent.type === state.schema.nodes.heading) {
		return `heading-${parent.attrs.level}`
	}
	if (parent.type === state.schema.nodes.code_block) {
		return 'code_block'
	}
	return 'paragraph'
}

export function setTextBlock(schema: Schema, block: string): Command {
	if (block.startsWith('heading-')) {
		return setBlockType(requiredNode(schema, 'heading'), {
			level: Number(block.slice('heading-'.length))
		})
	}
	if (block === 'code_block') {
		return setBlockType(requiredNode(schema, 'code_block'), { params: '' })
	}
	return setBlockType(requiredNode(schema, 'paragraph'))
}

export function toggleBlockquote(schema: Schema): Command {
	const blockquote = requiredNode(schema, 'blockquote')
	return (state, dispatch, view) => {
		if (ancestorDepth(state, blockquote) !== undefined) {
			return lift(state, dispatch)
		}
		return wrapIn(blockquote)(state, dispatch, view)
	}
}

export function toggleList(schema: Schema, listType: NodeType): Command {
	return (state, dispatch, view) => {
		const itemType = requiredNode(schema, 'list_item')
		const ownDepth = ancestorDepth(state, listType)
		if (ownDepth !== undefined) {
			return liftListItem(itemType)(state, dispatch, view)
		}

		const otherType =
			listType === requiredNode(schema, 'bullet_list')
				? requiredNode(schema, 'ordered_list')
				: requiredNode(schema, 'bullet_list')
		const otherDepth = ancestorDepth(state, otherType)
		if (otherDepth !== undefined) {
			if (dispatch) {
				dispatch(state.tr.setNodeMarkup(state.selection.$from.before(otherDepth), listType))
			}
			return true
		}
		return wrapInList(listType)(state, dispatch, view)
	}
}

export function insertTable(schema: Schema, rows = 3, columns = 3): Command {
	const paragraph = requiredNode(schema, 'paragraph')
	const tableHeader = requiredNode(schema, 'table_header')
	const tableCell = requiredNode(schema, 'table_cell')
	const tableRow = requiredNode(schema, 'table_row')
	const tableType = requiredNode(schema, 'table')
	return (state, dispatch) => {
		function createCell(type: NodeType) {
			return type.create(null, paragraph.create())
		}
		const tableRows = Array.from({ length: rows }, (_, rowIndex) => {
			const cellType = rowIndex === 0 ? tableHeader : tableCell
			return tableRow.create(
				null,
				Array.from({ length: columns }, () => createCell(cellType))
			)
		})
		const table = tableType.create(null, tableRows)
		if (dispatch) {
			dispatch(state.tr.replaceSelectionWith(table).scrollIntoView())
		}
		return true
	}
}

export function insertHorizontalRule(schema: Schema): Command {
	const horizontalRule = requiredNode(schema, 'horizontal_rule')
	return (state, dispatch) => {
		if (dispatch) {
			dispatch(state.tr.replaceSelectionWith(horizontalRule.create()).scrollIntoView())
		}
		return true
	}
}

export function insertHardBreak(schema: Schema): Command {
	return insertInlineNode(requiredNode(schema, 'hard_break'))
}

export function insertImage(
	schema: Schema,
	src: string,
	alt: string,
	title: string | null
): Command {
	return insertInlineNode(requiredNode(schema, 'image'), { src, alt, title })
}

export function indentListItem(schema: Schema): Command {
	const itemType = requiredNode(schema, 'list_item')
	const indent = sinkListItem(itemType)
	return (state, dispatch, view) => {
		if (ancestorDepth(state, itemType) === undefined) {
			return false
		}
		indent(state, dispatch, view)
		return true
	}
}

export function outdentListItem(schema: Schema): Command {
	const itemType = requiredNode(schema, 'list_item')
	const outdent = liftListItem(itemType)
	return (state, dispatch, view) => {
		if (ancestorDepth(state, itemType) === undefined) {
			return false
		}
		outdent(state, dispatch, view)
		return true
	}
}

export function insertTab(): Command {
	return (state, dispatch) => {
		if (state.selection instanceof TextSelection && dispatch) {
			dispatch(state.tr.insertText('\t').scrollIntoView())
		}
		return true
	}
}

export function markCommand(mark: MarkType): Command {
	return toggleMark(mark)
}

export function canInsertInlineNode(
	state: EditorState | null,
	type: NodeType | undefined
): boolean {
	if (!state || !type) {
		return false
	}
	const { $from, $to } = state.selection
	return (
		$from.parent === $to.parent &&
		$from.parent.inlineContent &&
		$from.parent.type.contentMatch.matchType(type) !== null
	)
}

function insertInlineNode(type: NodeType, attrs?: Record<string, unknown>): Command {
	return (state, dispatch) => {
		if (!canInsertInlineNode(state, type)) {
			return false
		}
		if (dispatch) {
			dispatch(state.tr.replaceSelectionWith(type.create(attrs)).scrollIntoView())
		}
		return true
	}
}

function ancestorDepth(state: EditorState, type: NodeType): number | undefined {
	for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
		if (state.selection.$from.node(depth).type === type) {
			return depth
		}
	}
}

function requiredNode(schema: Schema, name: string): NodeType {
	const type = schema.nodes[name]
	if (!type) {
		throw new Error(`Editor schema node is missing: ${name}`)
	}
	return type
}
