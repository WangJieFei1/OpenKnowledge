import { describe, expect, test } from 'bun:test'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import {
	indentListItem,
	insertHardBreak,
	insertHorizontalRule,
	insertImage,
	insertTab,
	outdentListItem
} from './prosemirror/commands'
import {
	parseMarkdown,
	serializeMarkdown,
	withMarkdownTrailingLineBreaks
} from './prosemirror/markdown'
import {
	detectReference,
	filterReferences,
	markdownReferenceHref,
	type WorkspaceReference
} from './references/references'
import { editorSchema } from './prosemirror/schema'
import { detectSlashCommand, filterSlashCommands } from './slash-commands/slash-commands'

describe('slash commands', () => {
	test('detects a query only at the start of a text block', () => {
		expect(detectSlashCommand(stateAtEnd('/hea'))).toEqual({ from: 1, to: 5, query: 'hea' })
		expect(detectSlashCommand(stateAtEnd('text /hea'))).toBeNull()
	})

	test('filters commands by labels and keywords', () => {
		const searchText = {
			text: 'Text paragraph body',
			'heading-1': 'Heading 1 title h1',
			'heading-2': 'Heading 2 subtitle h2',
			'heading-3': 'Heading 3 subtitle h3',
			'heading-4': 'Heading 4 subtitle h4',
			'heading-5': 'Heading 5 subtitle h5',
			'heading-6': 'Heading 6 subtitle h6',
			'bullet-list': 'Bulleted list unordered bullets',
			'ordered-list': 'Numbered list numbers ordered',
			blockquote: 'Quote blockquote callout',
			'code-block': 'Code block code fence',
			'horizontal-rule': 'Horizontal rule divider separator',
			table: 'Table grid cells',
			image: 'Image picture photo',
			'hard-break': 'Hard break newline'
		}
		expect(filterSlashCommands('grid', searchText)).toEqual(['table'])
		expect(filterSlashCommands('h6', searchText)).toEqual(['heading-6'])
		expect(filterSlashCommands('divider', searchText)).toEqual(['horizontal-rule'])
	})
})

describe('Markdown helper commands', () => {
	test('keeps temporary non-canonical Markdown editable in rich mode', () => {
		let state = stateAtEnd('Created')
		state = state.apply(state.tr.insertText(' '))
		expect(serializeMarkdown(state.doc)).toBe('Created ')

		state = state.apply(state.tr.insertText('through Electron'))
		expect(serializeMarkdown(state.doc)).toBe('Created through Electron')
		expect(withMarkdownTrailingLineBreaks('Body', 'Body\n\n')).toBe('Body\n\n')
	})

	test('inserts images with complete Markdown attributes', () => {
		const result = apply(
			insertImage(editorSchema, 'https://example.com/diagram.png', 'Architecture', 'Overview'),
			stateAtEnd('')
		)

		expect(result.handled).toBe(true)
		expect(serializeMarkdown(result.state.doc)).toBe(
			'![Architecture](https://example.com/diagram.png "Overview")'
		)
	})

	test('inserts thematic and hard breaks', () => {
		const thematicBreak = apply(insertHorizontalRule(editorSchema), stateAtEnd(''))
		expect(thematicBreak.handled).toBe(true)
		expect(serializeMarkdown(thematicBreak.state.doc)).toBe('---')

		const hardBreak = apply(insertHardBreak(editorSchema), stateAtEnd('line'))
		expect(hardBreak.handled).toBe(true)
		expect(hardBreak.state.doc.firstChild?.lastChild?.type.name).toBe('hard_break')
		const continued = hardBreak.state.apply(hardBreak.state.tr.insertText('next'))
		expect(serializeMarkdown(continued.doc)).toBe('line\\\nnext')
	})
})

describe('knowledge references', () => {
	test('detects references after whitespace but not email-like text', () => {
		expect(detectReference(stateAtEnd('See @index'))).toEqual({
			from: 5,
			to: 11,
			query: 'index'
		})
		expect(detectReference(stateAtEnd('admin@example.com'))).toBeNull()
		expect(detectReference(stateAtEnd('`@index`'))).toBeNull()
		expect(detectReference(stateAtEnd('```\n@index\n```'))).toBeNull()
	})

	test('searches labels and paths', () => {
		const references: WorkspaceReference[] = [
			{ kind: 'file', path: '/index.md', label: 'Home' },
			{ kind: 'file', path: '/topics/editor.md', label: 'Editor architecture' }
		]
		expect(filterReferences(references, 'topics')).toEqual([
			{ kind: 'file', path: '/topics/editor.md', label: 'Editor architecture' }
		])
		expect(filterReferences(references, 'home')).toEqual([
			{ kind: 'file', path: '/index.md', label: 'Home' }
		])
	})

	test('creates Markdown-safe absolute and relative workspace hrefs', () => {
		expect(markdownReferenceHref('/资料/My (draft).md', '/notes/current.md', true)).toBe(
			'/%E8%B5%84%E6%96%99/My%20%28draft%29.md'
		)
		expect(markdownReferenceHref('/资料/My (draft).md', '/notes/current.md', false)).toBe(
			'../%E8%B5%84%E6%96%99/My%20%28draft%29.md'
		)
		expect(markdownReferenceHref('/', '/notes/deep/current.md', false)).toBe('../..')
	})
})

describe('editor Tab behavior', () => {
	test('inserts a tab without relinquishing an ordinary text selection', () => {
		const result = apply(insertTab(), stateAtEnd('alpha'))
		const serialized = serializeMarkdown(result.state.doc)

		expect(result.handled).toBe(true)
		expect(parseMarkdown(serialized).textContent).toBe('alpha\t')

		const document = parseMarkdown('alpha')
		const atStart = EditorState.create({
			schema: editorSchema,
			doc: document,
			selection: TextSelection.create(document, 1)
		})
		const leading = serializeMarkdown(apply(insertTab(), atStart).state.doc)
		expect(leading).toBe('&#9;alpha')
		expect(parseMarkdown(leading).firstChild?.type.name).toBe('paragraph')
	})

	test('nests and lifts list items', () => {
		const document = parseMarkdown('- first\n- second')
		const initial = EditorState.create({
			schema: editorSchema,
			doc: document,
			selection: TextSelection.create(document, textPosition(document, 'second'))
		})
		const nested = apply(indentListItem(editorSchema), initial)

		expect(nested.handled).toBe(true)
		expect(serializeMarkdown(nested.state.doc)).toBe('* first\n  * second')

		const lifted = apply(outdentListItem(editorSchema), nested.state)
		expect(lifted.handled).toBe(true)
		expect(serializeMarkdown(lifted.state.doc)).toBe('* first\n* second')
	})
})

function stateAtEnd(markdown: string): EditorState {
	const doc = parseMarkdown(markdown)
	return EditorState.create({
		schema: editorSchema,
		doc,
		selection: TextSelection.atEnd(doc)
	})
}

function apply(command: Command, state: EditorState): { handled: boolean; state: EditorState } {
	let nextState = state
	const handled = command(state, (transaction) => {
		nextState = state.apply(transaction)
	})
	return { handled, state: nextState }
}

function textPosition(document: EditorState['doc'], text: string): number {
	let position: number | undefined
	document.descendants((node, nodePosition) => {
		if (position === undefined && node.isText && node.text?.includes(text)) {
			position = nodePosition + 1
		}
	})
	if (position === undefined) {
		throw new Error(`Text not found: ${text}`)
	}
	return position
}
