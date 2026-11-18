import type { KnowledgeBundlePath } from '#lib/knowledge/api.js'
import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { editorMark, editorNode } from '../prosemirror/schema'

export type WorkspaceReference = {
	kind: 'directory' | 'file'
	path: KnowledgeBundlePath
	label: string
}

export type ReferenceMatch = {
	from: number
	to: number
	query: string
}

export function detectReference(state: EditorState): ReferenceMatch | null {
	if (!state.selection.empty || !state.selection.$from.parent.isTextblock) {
		return null
	}
	if (state.selection.$from.parent.type === editorNode('code_block')) {
		return null
	}
	const marks = state.selection.$from.marks()
	if (editorMark('code').isInSet(marks) || editorMark('link').isInSet(marks)) {
		return null
	}
	const textBefore = state.selection.$from.parent.textBetween(
		0,
		state.selection.$from.parentOffset,
		undefined,
		'\ufffc'
	)
	const match = /(?:^|\s)@([^\s@]{0,80})$/.exec(textBefore)
	if (!match) {
		return null
	}
	const triggerLength = (match[1]?.length ?? 0) + 1
	return {
		from: state.selection.from - triggerLength,
		to: state.selection.from,
		query: match[1] ?? ''
	}
}

export function filterReferences(
	references: WorkspaceReference[],
	query: string
): WorkspaceReference[] {
	const normalized = query.trim().toLowerCase()
	return references
		.filter((reference) => {
			if (!normalized) {
				return true
			}
			return `${reference.label} ${reference.path}`.toLowerCase().includes(normalized)
		})
		.slice(0, 12)
}

export function insertReference(
	view: EditorView,
	match: ReferenceMatch,
	reference: WorkspaceReference,
	currentDocumentPath: KnowledgeBundlePath,
	resolveAbsolutePathsFromProjectRoot: boolean
): void {
	const href = markdownReferenceHref(
		reference.path,
		currentDocumentPath,
		resolveAbsolutePathsFromProjectRoot
	)
	const link = editorMark('link').create({ href, title: null })
	const label = view.state.schema.text(reference.label, [link])
	const trailingSpace = view.state.schema.text(' ')
	view.dispatch(
		view.state.tr
			.replaceWith(match.from, match.to, [label, trailingSpace])
			.removeStoredMark(editorMark('link'))
			.scrollIntoView()
	)
	view.focus()
}

export function markdownReferenceHref(
	targetPath: KnowledgeBundlePath,
	currentDocumentPath: KnowledgeBundlePath,
	resolveAbsolutePathsFromProjectRoot: boolean
): string {
	const targetSegments = pathSegments(targetPath)
	if (resolveAbsolutePathsFromProjectRoot) {
		return `/${targetSegments.map(encodePathSegment).join('/')}`
	}

	const currentDirectorySegments = pathSegments(currentDocumentPath).slice(0, -1)
	let sharedSegments = 0
	while (
		sharedSegments < currentDirectorySegments.length &&
		sharedSegments < targetSegments.length &&
		currentDirectorySegments[sharedSegments] === targetSegments[sharedSegments]
	) {
		sharedSegments += 1
	}
	const relativeSegments = [
		...currentDirectorySegments.slice(sharedSegments).map(() => '..'),
		...targetSegments.slice(sharedSegments).map(encodePathSegment)
	]
	return relativeSegments.join('/') || '.'
}

function pathSegments(path: KnowledgeBundlePath): string[] {
	return path === '/' ? [] : path.slice(1).split('/')
}

function encodePathSegment(segment: string): string {
	return encodeURIComponent(segment.toWellFormed()).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	)
}
