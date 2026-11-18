import type { CallToolResult } from '@modelcontextprotocol/server'
import {
	MCPCreationError,
	MCPDocumentNotFoundOrInvalidError,
	MCPDocumentNotSupportedError,
	MCPMutationError
} from './bundle-access'
import {
	MCPWorkspaceReadOnlyError,
	MCPWorkspaceReferenceError,
	MCPWorkspaceSearchUnavailableError
} from './grant'

export async function runTool<T extends Record<string, unknown>>(
	operation: () => Promise<T>,
	fallbackMessage: string
): Promise<CallToolResult> {
	try {
		const result = await operation()
		return {
			content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
			structuredContent: result
		}
	} catch (error) {
		return {
			isError: true,
			content: [{ type: 'text', text: safeErrorMessage(error, fallbackMessage) }]
		}
	}
}

export async function runDocumentTool<T extends Record<string, unknown>>(
	operation: () => Promise<{ readonly metadata: T; readonly markdown: string }>,
	fallbackMessage: string
): Promise<CallToolResult> {
	try {
		const { metadata, markdown } = await operation()
		return {
			content: [{ type: 'text', text: markdown }],
			structuredContent: metadata
		}
	} catch (error) {
		return {
			isError: true,
			content: [{ type: 'text', text: safeErrorMessage(error, fallbackMessage) }]
		}
	}
}

function safeErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof MCPWorkspaceReadOnlyError || error instanceof MCPWorkspaceReferenceError) {
		return error.message
	}
	if (error instanceof MCPWorkspaceSearchUnavailableError) {
		return 'Full-text search is not available for this knowledge workspace.'
	}
	if (error instanceof MCPDocumentNotFoundOrInvalidError) {
		return 'The knowledge document was not found.'
	}
	if (error instanceof MCPDocumentNotSupportedError) {
		return 'This file is not supported as a knowledge document.'
	}
	if (error instanceof MCPCreationError) {
		switch (error.code) {
			case 'already_exists':
				return 'A knowledge entry already exists at that path. Choose a new path; creation never replaces an entry.'
			case 'not_found':
				return 'The parent knowledge directory was not found. Create it first or choose an existing parent.'
			case 'not_a_directory':
				return 'The parent knowledge path is not a directory.'
			case 'invalid_path':
				return `The new knowledge ${error.entryKind} path is invalid.`
			case 'too_large':
				return error.entryKind === 'document'
					? 'The knowledge document could not be created because the document or workspace exceeds a creation limit.'
					: 'The knowledge directory could not be created because the workspace exceeds a creation limit.'
			case 'unsupported':
				return `This knowledge bundle does not support ${error.entryKind} creation.`
			default:
				return fallback
		}
	}
	if (error instanceof MCPMutationError) {
		const edit = error.editNumber === undefined ? 'The patch' : `Edit ${error.editNumber}`
		switch (error.code) {
			case 'revision_conflict':
			case 'content_conflict':
				return 'The knowledge document changed. Read it again before updating it.'
			case 'patch_not_found':
				return `${edit} did not match the current document exactly. Read it again and include exact whitespace.`
			case 'patch_ambiguous':
				return `${edit} matched more than once. Include more surrounding text to make it unique.`
			case 'invalid_patch':
				return `${edit} is invalid.`
			case 'not_found':
			case 'not_a_file':
				return 'The knowledge document was not found.'
			case 'too_large':
				return 'The knowledge document is too large for MCP access.'
			case 'invalid_path':
				return 'The knowledge document path is invalid.'
			case 'unsupported':
				return 'This knowledge bundle does not support document updates.'
			default:
				return fallback
		}
	}
	return fallback
}

export async function runResource<T>(
	operation: () => Promise<T>,
	fallbackMessage: string
): Promise<T> {
	try {
		return await operation()
	} catch {
		throw new Error(fallbackMessage)
	}
}
