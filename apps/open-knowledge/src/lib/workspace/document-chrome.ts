import { isReservedKnowledgeFile } from '../knowledge/open-knowledge'
import type { KnowledgeBundlePath } from '../knowledge/api'
import { NonBlankStringSchema } from '../validation'
import {
	canEditFrontmatterProperties,
	classifyKnowledgeMarkdown,
	splitKnowledgeMarkdown,
	type FrontmatterResult,
	type KnowledgeMarkdownFormat
} from '@open-knowledge/knowledge-bundle/frontmatter'
import * as v from 'valibot'

export type DocumentChromeInput = {
	markdown: string
	document: { name: string; path: KnowledgeBundlePath } | null
	documentEditable: boolean
	documentRendered: boolean
	documentUnsupported: boolean
	usesOpenKnowledgeFormat: boolean
	strictOpenKnowledgeFormat: boolean
}

export type DocumentChromeState = {
	parsed: FrontmatterResult
	markdownFormat: KnowledgeMarkdownFormat
	propertiesAvailable: boolean
	documentTitle: string | undefined
	showRecommendations: boolean
}

export function deriveDocumentChromeState(input: DocumentChromeInput): DocumentChromeState {
	const parsed = splitKnowledgeMarkdown(input.markdown)
	const markdownFormat =
		!input.documentRendered && !input.documentUnsupported && parsed.ok && input.document
			? classifyKnowledgeMarkdown(parsed.value, input.document.path.slice(1))
			: 'markdown'
	const propertiesAvailable = Boolean(
		input.documentEditable &&
		input.document &&
		parsed.ok &&
		canEditFrontmatterProperties(parsed.value) &&
		input.usesOpenKnowledgeFormat &&
		(markdownFormat.startsWith('open-knowledge-') ||
			(input.strictOpenKnowledgeFormat && !isReservedKnowledgeFile(input.document.path)))
	)
	const name = input.document?.name
	const filename =
		input.documentRendered || input.documentUnsupported ? name : name?.replace(/\.md$/i, '')
	let documentTitle = filename
	if (filename && !input.documentRendered && !input.documentUnsupported && parsed.ok) {
		const title = parsed.value.frontmatter.title
		documentTitle = v.is(NonBlankStringSchema, title) ? title : filename
	}
	const showRecommendations = Boolean(
		markdownFormat === 'open-knowledge-concept' ||
		(input.strictOpenKnowledgeFormat &&
			input.document &&
			!isReservedKnowledgeFile(input.document.path))
	)

	return {
		parsed,
		markdownFormat,
		propertiesAvailable,
		documentTitle,
		showRecommendations
	}
}
