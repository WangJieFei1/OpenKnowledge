import type { KnowledgeBundlePath } from '#lib/knowledge/api.js'
import { NonBlankStringSchema } from '#lib/validation.js'
import {
	canEditFrontmatterProperties,
	openKnowledgeConceptConformance,
	replaceKnowledgeBody,
	splitKnowledgeMarkdown,
	type FrontmatterResult,
	type OpenKnowledgeConformanceMessageID
} from '@open-knowledge/knowledge-bundle/frontmatter'
import * as v from 'valibot'
import type { WorkspaceReference } from '../rich-text/references/references.js'

export type EditorDocumentEntry = {
	kind: 'directory' | 'file'
	name: string
	path: KnowledgeBundlePath
}

export type EditorDocumentProjectionInput = {
	markdown: string
	workspaceName: string
	document: { name: string; path: KnowledgeBundlePath } | null
	entries: readonly EditorDocumentEntry[]
	documentRendered: boolean
	documentUnsupported: boolean
	strictOpenKnowledgeFormat: boolean
}

export type EditorDocumentProjection = {
	parsed: FrontmatterResult
	richMarkdown: string
	conformanceIssue: OpenKnowledgeConformanceMessageID | null
	canRepairFrontmatter: boolean
	references: WorkspaceReference[]
	documentPaths: KnowledgeBundlePath[]
	documentTitle: string | undefined
}

export function projectEditorDocument(
	input: EditorDocumentProjectionInput
): EditorDocumentProjection {
	const parsed = splitKnowledgeMarkdown(input.markdown)
	const structuredDocument = !input.documentRendered && !input.documentUnsupported
	const conformanceIssue =
		structuredDocument && input.strictOpenKnowledgeFormat && input.document && parsed.ok
			? openKnowledgeConceptConformance(parsed.value, input.document.path.slice(1))
			: null
	const canRepairFrontmatter = Boolean(
		structuredDocument && parsed.ok && canEditFrontmatterProperties(parsed.value)
	)
	const references: WorkspaceReference[] =
		structuredDocument && input.document
			? [
					{ kind: 'directory', path: '/', label: input.workspaceName },
					...input.entries
						.filter((entry) => entry.path !== input.document?.path)
						.map((entry) => ({
							kind: entry.kind,
							path: entry.path,
							label: entry.name
						}))
				]
			: []
	const documentPaths = input.entries
		.filter((entry) => entry.kind === 'file')
		.map((entry) => entry.path)
	const filename =
		input.documentRendered || input.documentUnsupported
			? input.document?.name
			: input.document?.name.replace(/\.md$/i, '')
	let documentTitle = filename
	if (filename && structuredDocument && parsed.ok) {
		const frontmatterTitle = parsed.value.frontmatter.title
		documentTitle = v.is(NonBlankStringSchema, frontmatterTitle) ? frontmatterTitle : filename
	}

	return {
		parsed,
		richMarkdown: input.documentRendered
			? input.markdown
			: parsed.ok
				? parsed.value.body
				: input.markdown,
		conformanceIssue,
		canRepairFrontmatter,
		references,
		documentPaths,
		documentTitle
	}
}

export function replaceEditorDocumentBody(parsed: FrontmatterResult, body: string): string {
	return parsed.ok ? replaceKnowledgeBody(parsed.value, body) : body
}
