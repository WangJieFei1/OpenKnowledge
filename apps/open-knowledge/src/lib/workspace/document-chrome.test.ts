import { describe, expect, test } from 'bun:test'
import {
	deriveDocumentChromeState,
	type DocumentChromeInput,
	type DocumentChromeState
} from './document-chrome'

const conceptMarkdown = '---\ntype: note\ntitle: Frontmatter title\n---\n\nBody'
const genericMarkdown = '---\ntitle: Generic title\nlayout: page\n---\n\nBody'
const baseInput = {
	markdown: conceptMarkdown,
	document: { name: 'Guide.md', path: '/Guide.md' },
	documentEditable: true,
	documentRendered: false,
	documentUnsupported: false,
	usesOpenKnowledgeFormat: true,
	strictOpenKnowledgeFormat: false
} satisfies DocumentChromeInput

type ChromeSummary = Pick<
	DocumentChromeState,
	'markdownFormat' | 'propertiesAvailable' | 'documentTitle' | 'showRecommendations'
>

describe('document chrome policy matrix', () => {
	const matrix: {
		name: string
		input: Partial<DocumentChromeInput>
		expected: ChromeSummary
	}[] = [
		{
			name: 'uses a concept title and enables its Open Knowledge properties',
			input: {},
			expected: {
				markdownFormat: 'open-knowledge-concept',
				propertiesAvailable: true,
				documentTitle: 'Frontmatter title',
				showRecommendations: true
			}
		},
		{
			name: 'keeps generic frontmatter unavailable outside strict mode',
			input: { markdown: genericMarkdown },
			expected: {
				markdownFormat: 'frontmatter',
				propertiesAvailable: false,
				documentTitle: 'Generic title',
				showRecommendations: false
			}
		},
		{
			name: 'keeps ordinary Markdown properties unavailable outside strict mode',
			input: { markdown: '# Guide' },
			expected: {
				markdownFormat: 'markdown',
				propertiesAvailable: false,
				documentTitle: 'Guide',
				showRecommendations: false
			}
		},
		{
			name: 'allows strict mode to add properties to ordinary Markdown',
			input: { markdown: '# Guide', strictOpenKnowledgeFormat: true },
			expected: {
				markdownFormat: 'markdown',
				propertiesAvailable: true,
				documentTitle: 'Guide',
				showRecommendations: true
			}
		},
		{
			name: 'excludes nested reserved files from strict properties and recommendations',
			input: {
				markdown: genericMarkdown,
				document: { name: 'index.md', path: '/nested/index.md' },
				strictOpenKnowledgeFormat: true
			},
			expected: {
				markdownFormat: 'frontmatter',
				propertiesAvailable: false,
				documentTitle: 'Generic title',
				showRecommendations: false
			}
		},
		{
			name: 'allows root Open Knowledge index properties without concept recommendations',
			input: {
				markdown: '---\nokf_version: "0.2"\ntitle: Home\n---\n',
				document: { name: 'index.md', path: '/index.md' }
			},
			expected: {
				markdownFormat: 'open-knowledge-index',
				propertiesAvailable: true,
				documentTitle: 'Home',
				showRecommendations: false
			}
		},
		{
			name: 'retains concept recommendations when the document is not editable',
			input: { documentEditable: false },
			expected: {
				markdownFormat: 'open-knowledge-concept',
				propertiesAvailable: false,
				documentTitle: 'Frontmatter title',
				showRecommendations: true
			}
		},
		{
			name: 'retains concept recommendations outside an Open Knowledge root',
			input: { usesOpenKnowledgeFormat: false },
			expected: {
				markdownFormat: 'open-knowledge-concept',
				propertiesAvailable: false,
				documentTitle: 'Frontmatter title',
				showRecommendations: true
			}
		},
		{
			name: 'rejects unsafe frontmatter while retaining concept recommendations',
			input: {
				markdown: '---\ntype: note\ntitle: Unsafe\ncount: 9007199254740992\n---\n\nBody'
			},
			expected: {
				markdownFormat: 'open-knowledge-concept',
				propertiesAvailable: false,
				documentTitle: 'Unsafe',
				showRecommendations: true
			}
		},
		{
			name: 'forces rendered documents to Markdown while preserving strict policy',
			input: {
				markdown: genericMarkdown,
				documentRendered: true,
				strictOpenKnowledgeFormat: true
			},
			expected: {
				markdownFormat: 'markdown',
				propertiesAvailable: true,
				documentTitle: 'Guide.md',
				showRecommendations: true
			}
		},
		{
			name: 'keeps unsupported filenames intact and disables non-strict concept policy',
			input: { documentUnsupported: true },
			expected: {
				markdownFormat: 'markdown',
				propertiesAvailable: false,
				documentTitle: 'Guide.md',
				showRecommendations: false
			}
		},
		{
			name: 'falls back to the filename for an empty frontmatter title',
			input: {
				markdown: '---\ntype: note\ntitle: "   "\n---\n',
				document: { name: 'Notes.MD', path: '/Notes.MD' }
			},
			expected: {
				markdownFormat: 'open-knowledge-concept',
				propertiesAvailable: true,
				documentTitle: 'Notes',
				showRecommendations: true
			}
		},
		{
			name: 'falls back to Markdown and filename policy when frontmatter is invalid',
			input: {
				markdown: '---\ntitle: [one\n---\nBody',
				strictOpenKnowledgeFormat: true
			},
			expected: {
				markdownFormat: 'markdown',
				propertiesAvailable: false,
				documentTitle: 'Guide',
				showRecommendations: true
			}
		},
		{
			name: 'returns no title or document policy without a document',
			input: {
				document: null,
				usesOpenKnowledgeFormat: false,
				strictOpenKnowledgeFormat: true
			},
			expected: {
				markdownFormat: 'markdown',
				propertiesAvailable: false,
				documentTitle: undefined,
				showRecommendations: false
			}
		}
	]

	for (const { name, input, expected } of matrix) {
		test(name, () => {
			const state = deriveDocumentChromeState({ ...baseInput, ...input })
			expect({
				markdownFormat: state.markdownFormat,
				propertiesAvailable: state.propertiesAvailable,
				documentTitle: state.documentTitle,
				showRecommendations: state.showRecommendations
			}).toEqual(expected)
		})
	}
})
