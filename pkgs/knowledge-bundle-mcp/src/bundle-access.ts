import type {
	EditableKnowledgeBundle,
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntryLocator,
	KnowledgeBundleFile,
	KnowledgeBundleFileEntry,
	KnowledgeBundleListing,
	KnowledgeBundleMutationErrorCode,
	KnowledgeBundlePath,
	KnowledgeBundleTextEdit
} from '@open-knowledge/knowledge-bundle-api'
import { isWellFormedText } from '@open-knowledge/knowledge-bundle-patch'
import * as v from 'valibot'
import type { KnowledgeBundleMCPDocumentRepresentation, SessionGrant } from './grant'

export const maximumDocumentBytes = 1024 * 1024
export const maximumBundleEntries = 10_000

export const VisibleBundlePathSchema = v.pipe(
	v.string(),
	v.minLength(1),
	v.maxLength(1024),
	v.check(isMCPVisibleBundlePath, 'Use an available canonical absolute bundle path such as /.')
)
export const MarkdownDocumentPathSchema = v.pipe(
	VisibleBundlePathSchema,
	v.check(isMarkdownDocumentPath, 'Use a Markdown document path ending in .md.')
)
export const CreatableDirectoryPathSchema = v.pipe(
	VisibleBundlePathSchema,
	v.notValue('/', 'The bundle root already exists.')
)
export const EntryIDSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(1024))
export const RevisionSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(1024))
export const ContentHashSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))

export type MCPReadableDocument = {
	readonly file: KnowledgeBundleFileEntry
	readonly markdown: string
	readonly markdownByteLength: number
	readonly representation: KnowledgeBundleMCPDocumentRepresentation
}

export class MCPDocumentNotFoundOrInvalidError extends Error {}
export class MCPDocumentNotSupportedError extends Error {}
export class MCPCreationError extends Error {
	constructor(
		readonly code: KnowledgeBundleMutationErrorCode,
		readonly entryKind: 'directory' | 'document'
	) {
		super(code)
	}
}
export class MCPMutationError extends Error {
	constructor(
		readonly code: KnowledgeBundleMutationErrorCode,
		readonly editNumber?: number
	) {
		super(code)
	}
}

export async function createBundleDirectory(
	bundle: EditableKnowledgeBundle<unknown>,
	path: string
): Promise<KnowledgeBundleDirectoryEntry> {
	const result = await bundle.createDirectory({ path: path as KnowledgeBundlePath })
	if (!result.ok) {
		throw new MCPCreationError(result.error.code, 'directory')
	}
	return result.value.directory
}

export async function createMarkdownDocument(
	bundle: EditableKnowledgeBundle<unknown>,
	path: string,
	markdown: string
): Promise<KnowledgeBundleFileEntry> {
	const result = await bundle.createFile({
		path: path as KnowledgeBundlePath,
		content: markdown,
		mediaType: 'text/markdown'
	})
	if (!result.ok) {
		throw new MCPCreationError(result.error.code, 'document')
	}
	return result.value.file
}

export async function listBundleEntries(
	grant: SessionGrant,
	locator: { readonly id?: string; readonly path: string },
	depth: number,
	limit: number
): Promise<KnowledgeBundleListing> {
	const listing = await grant.bundle.list({ ...apiLocator(locator), depth, limit })
	if (!listing) {
		throw new Error('The knowledge directory was not found.')
	}
	return listing
}

export async function readBoundedDocument(
	grant: SessionGrant,
	locator: { readonly id?: string; readonly path: string }
): Promise<KnowledgeBundleFile> {
	const file = await grant.bundle.readFile({
		...apiLocator(locator),
		maximumBytes: maximumDocumentBytes
	})
	if (!file || !isMarkdownDocumentPath(file.path)) {
		throw new MCPDocumentNotFoundOrInvalidError()
	}
	return file
}

export async function readKnowledgeDocument(
	grant: SessionGrant,
	locator: { readonly id?: string; readonly path: string },
	signal: AbortSignal
): Promise<MCPReadableDocument> {
	signal.throwIfAborted()
	if (!grant.readDocument) {
		if (locator.id === undefined && !isMarkdownDocumentPath(locator.path)) {
			throw new MCPDocumentNotSupportedError()
		}
		const source = await readBoundedDocument(grant, locator)
		if (source.documentAccess === 'not_supported') {
			throw new MCPDocumentNotSupportedError()
		}
		return {
			file: source,
			markdown: source.content,
			markdownByteLength: source.byteLength,
			representation: 'source_markdown'
		}
	}

	const document = await grant.readDocument(
		{ ...apiLocator(locator), maximumMarkdownBytes: maximumDocumentBytes },
		signal
	)
	signal.throwIfAborted()
	if (!document) {
		throw new MCPDocumentNotFoundOrInvalidError()
	}
	if (document.status === 'not_supported') {
		throw new MCPDocumentNotSupportedError()
	}
	return {
		file: document.file,
		markdown: document.markdown,
		markdownByteLength: new TextEncoder().encode(document.markdown).byteLength,
		representation: document.representation
	}
}

export function effectiveDocumentAccess(
	grant: SessionGrant,
	file: KnowledgeBundleFileEntry
): 'writable' | 'readonly' | 'not_supported' {
	if (file.documentAccess === 'not_supported') {
		return 'not_supported'
	}
	if (file.documentAccess === 'readonly') {
		return !grant.readDocument && !isMarkdownDocumentPath(file.path) ? 'not_supported' : 'readonly'
	}
	if (file.documentAccess === 'writable') {
		return grant.access === 'editable' ? 'writable' : 'readonly'
	}
	if (!isMarkdownDocumentPath(file.path)) {
		return 'not_supported'
	}
	return grant.access === 'editable' ? 'writable' : 'readonly'
}

export async function writeDocument(
	bundle: EditableKnowledgeBundle<unknown>,
	locator: { readonly id?: string; readonly path: string },
	expectedRevision: string,
	expectedContentHash: string,
	content: string,
	mediaType?: string
): Promise<{
	readonly status: 'updated' | 'unchanged'
	readonly file: KnowledgeBundleFileEntry
}> {
	const result = await bundle.writeFile({
		...apiLocator(locator),
		expectedRevision,
		expectedContentHash,
		content,
		...(mediaType === undefined ? {} : { mediaType })
	})
	if (!result.ok) {
		throw new MCPMutationError(result.error.code)
	}
	return result.value
}

export async function patchDocument(
	bundle: EditableKnowledgeBundle<unknown>,
	locator: { readonly id?: string; readonly path: string },
	expectedRevision: string,
	expectedContentHash: string,
	edits: readonly KnowledgeBundleTextEdit[]
): Promise<{
	readonly status: 'patched' | 'unchanged'
	readonly file: KnowledgeBundleFileEntry
}> {
	const result = await bundle.patchFile({
		...apiLocator(locator),
		expectedRevision,
		expectedContentHash,
		maximumBytes: maximumDocumentBytes,
		edits
	})
	if (!result.ok) {
		throw new MCPMutationError(result.error.code, result.error.editNumber)
	}
	return result.value
}

function apiLocator(locator: {
	readonly id?: string
	readonly path: string
}): KnowledgeBundleEntryLocator {
	return {
		...(locator.id === undefined ? {} : { id: locator.id }),
		path: locator.path as KnowledgeBundlePath
	}
}

function isCanonicalAbsoluteBundlePath(bundlePath: string): boolean {
	if (!isWellFormedText(bundlePath)) {
		return false
	}
	if (bundlePath === '/') {
		return true
	}
	if (
		!bundlePath.startsWith('/') ||
		bundlePath.endsWith('/') ||
		bundlePath.includes('\\') ||
		/[\u0000-\u001f]/.test(bundlePath)
	) {
		return false
	}
	return bundlePath.slice(1).split('/').every(isPortableBundlePathSegment)
}

function isPortableBundlePathSegment(segment: string): boolean {
	if (
		!segment.trim() ||
		segment === '.' ||
		segment === '..' ||
		/[<>:"/\\|?*\u0000-\u001f]/.test(segment) ||
		/^ |[. ]$/.test(segment) ||
		segment.includes('\u{10ffff}') ||
		new TextEncoder().encode(segment).byteLength > 240
	) {
		return false
	}
	const portableBase = segment.split('.', 1)[0]?.trim().toLowerCase() ?? ''
	return !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/.test(portableBase)
}

function isMCPVisibleBundlePath(bundlePath: string): boolean {
	if (!isCanonicalAbsoluteBundlePath(bundlePath)) {
		return false
	}
	return bundlePath.split('/').every((segment) => {
		const normalized = segment.toLowerCase()
		return (
			normalized !== '.git' &&
			normalized !== '.open-knowledge' &&
			normalized !== 'node_modules' &&
			!(normalized.includes('.open-knowledge-') && normalized.endsWith('.tmp'))
		)
	})
}

function isMarkdownDocumentPath(bundlePath: string): boolean {
	return bundlePath.toLowerCase().endsWith('.md')
}
