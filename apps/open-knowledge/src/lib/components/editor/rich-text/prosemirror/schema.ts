import { schema as commonMarkSchema } from 'prosemirror-markdown'
import { Schema, type MarkType, type NodeType } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

export const editorSchema = new Schema({
	nodes: commonMarkSchema.spec.nodes.append(
		tableNodes({
			tableGroup: 'block',
			cellContent: 'block+',
			cellAttributes: {}
		})
	),
	marks: commonMarkSchema.spec.marks.addToEnd('strike', {
		parseDOM: [
			{ tag: 's' },
			{ tag: 'del' },
			{ tag: 'strike' },
			{ style: 'text-decoration=line-through' }
		],
		toDOM: () => ['s', 0]
	})
})

export function editorNode(name: string): NodeType {
	const type = editorSchema.nodes[name]
	if (!type) {
		throw new Error(`Editor schema node is missing: ${name}`)
	}
	return type
}

export function editorMark(name: string): MarkType {
	const type = editorSchema.marks[name]
	if (!type) {
		throw new Error(`Editor schema mark is missing: ${name}`)
	}
	return type
}
