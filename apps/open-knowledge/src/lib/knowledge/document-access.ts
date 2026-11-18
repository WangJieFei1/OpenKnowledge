import type {
	KnowledgeBundleAccess,
	KnowledgeBundleFileAccess,
	KnowledgeBundleFileEntry
} from '@open-knowledge/knowledge-bundle-api'
import { isMarkdownDocumentPath } from '@open-knowledge/knowledge-bundle'
import { isAnydocPath } from './anydoc'

export function documentAccessForFile(
	file: KnowledgeBundleFileEntry,
	workspaceKind: 'local' | 'remote',
	workspaceAccess: KnowledgeBundleAccess
): KnowledgeBundleFileAccess {
	if (workspaceKind === 'local') {
		if (isMarkdownDocumentPath(file.path)) {
			return workspaceAccess === 'editable' ? 'writable' : 'readonly'
		}
		return isAnydocPath(file.path) ? 'readonly' : 'not_supported'
	}

	const declared = file.documentAccess
	if (declared === 'writable') {
		return workspaceAccess === 'editable' ? 'writable' : 'readonly'
	}
	if (declared) {
		return declared
	}
	if (!isMarkdownDocumentPath(file.path)) {
		return 'not_supported'
	}
	return workspaceAccess === 'editable' ? 'writable' : 'readonly'
}
