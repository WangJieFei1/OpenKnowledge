import type {
	EditableKnowledgeBundle,
	KnowledgeBundleEntryLocator,
	KnowledgeBundleFileEntry,
	ReadonlyKnowledgeBundle
} from '@open-knowledge/knowledge-bundle-api'
import * as v from 'valibot'

export type KnowledgeBundleMCPDocumentRepresentation = 'source_markdown' | 'converted_markdown'

type KnowledgeBundleMCPFile<Access extends 'writable' | 'readonly' | 'not_supported'> =
	KnowledgeBundleFileEntry & { readonly documentAccess: Access }

export type KnowledgeBundleMCPDocument =
	| {
			readonly status: 'readable'
			readonly file: KnowledgeBundleMCPFile<'writable' | 'readonly'>
			readonly markdown: string
			readonly representation: 'source_markdown'
	  }
	| {
			readonly status: 'readable'
			readonly file: KnowledgeBundleMCPFile<'readonly'>
			readonly markdown: string
			readonly representation: 'converted_markdown'
	  }

export type KnowledgeBundleMCPUnsupportedDocument = {
	readonly status: 'not_supported'
	readonly file: KnowledgeBundleMCPFile<'not_supported'>
}

export type KnowledgeBundleMCPDocumentReaderInput = KnowledgeBundleEntryLocator & {
	readonly maximumMarkdownBytes: number
}

export type KnowledgeBundleMCPDocumentReader = (
	input: KnowledgeBundleMCPDocumentReaderInput,
	signal: AbortSignal
) => Promise<KnowledgeBundleMCPDocument | KnowledgeBundleMCPUnsupportedDocument | null>

export type KnowledgeBundleMCPSearchInput = {
	readonly query: string
	readonly caseMode: 'smart' | 'sensitive' | 'insensitive'
	readonly fixedStrings: boolean
	readonly wholeWord: boolean
	readonly path: string
	readonly excludeGlobs: readonly string[]
	readonly limit: number
}

export type KnowledgeBundleMCPSearchResult = {
	readonly matches: readonly {
		readonly path: string
		readonly lineNumber: number
		readonly columnNumber: number
		readonly preview: string
		readonly match: string
		readonly representation: 'source_markdown'
		readonly documentAccess: 'writable' | 'readonly'
	}[]
	readonly truncated: boolean
}

export type KnowledgeBundleMCPSearcher = (
	input: KnowledgeBundleMCPSearchInput,
	signal: AbortSignal
) => Promise<KnowledgeBundleMCPSearchResult>

/** Host-local embedding ranking, over the current authorized source snapshot only. */
export type KnowledgeBundleMCPSemanticRanker = (
	query: string,
	passages: readonly string[],
	signal: AbortSignal
) => Promise<{
	scores: readonly number[]
	model: string
	cacheHits: number
	minimumScore?: number
	maximumScoreDrop?: number
	queryCacheHit?: boolean
}>

export type KnowledgeBundleMCPMemoryTurn = {
	readonly index: number
	readonly role: 'user' | 'assistant'
	readonly text: string
	readonly timestamp?: string
}

export type KnowledgeBundleMCPMemorySession = {
	readonly id: string
	readonly timestamp?: string
	readonly turns: readonly KnowledgeBundleMCPMemoryTurn[]
	readonly warnings: readonly string[]
}

export type KnowledgeBundleMCPMemorySnapshot = {
	readonly sessions: readonly KnowledgeBundleMCPMemorySession[]
	readonly complete: boolean
	readonly warnings: readonly string[]
}

/** Explicitly authorized, project-scoped history. Never supplies host filesystem paths. */
export type KnowledgeBundleMCPMemorySource = {
	snapshot(signal: AbortSignal): Promise<KnowledgeBundleMCPMemorySnapshot>
	readonly semanticRank?: KnowledgeBundleMCPSemanticRanker
}

type KnowledgeBundleMCPGrantBase = {
	readonly reference: string
	readonly label: string
	/** Optional host-specific reader for derived Markdown representations. */
	readonly readDocument?: KnowledgeBundleMCPDocumentReader
	/** Optional host-specific full-text search constrained to this grant. */
	readonly search?: KnowledgeBundleMCPSearcher
	readonly semanticRank?: KnowledgeBundleMCPSemanticRanker
	readonly sessionMemory?: KnowledgeBundleMCPMemorySource
}

export type KnowledgeBundleMCPGrant<Metadata = unknown> = KnowledgeBundleMCPGrantBase &
	(
		| {
				readonly access: 'readonly'
				readonly bundle: ReadonlyKnowledgeBundle<Metadata>
		  }
		| {
				readonly access: 'editable'
				readonly bundle: EditableKnowledgeBundle<Metadata>
		  }
	)

export type SessionGrant = KnowledgeBundleMCPGrant<unknown>

const WorkspaceReferenceSchema = v.pipe(
	v.string(),
	v.minLength(1),
	v.maxLength(128),
	v.regex(/^[A-Za-z0-9_-]+$/)
)
type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue }

const PlainObjectSchema = v.custom<Record<string, unknown>>(
	(value) =>
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		[Object.prototype, null].includes(Object.getPrototypeOf(value)),
	'Expected a plain object.'
)

const JSONValueSchema: v.GenericSchema<JSONValue> = v.lazy(() =>
	v.union([
		v.null(),
		v.boolean(),
		v.pipe(v.number(), v.finite()),
		v.string(),
		v.array(JSONValueSchema),
		v.intersect([PlainObjectSchema, v.objectWithRest({}, JSONValueSchema)])
	])
)

export const WorkspaceReferenceInputSchema = v.pipe(
	v.optional(WorkspaceReferenceSchema),
	v.description('Opaque reference returned by knowledge_list_workspaces.')
)

export class MCPWorkspaceReferenceError extends Error {}
export class MCPWorkspaceReadOnlyError extends Error {}
export class MCPWorkspaceSearchUnavailableError extends Error {}

export function resolveWorkspaceGrant(
	grants: ReadonlyMap<string, SessionGrant>,
	workspaceRef: string | undefined
): SessionGrant {
	if (workspaceRef !== undefined) {
		const grant = grants.get(workspaceRef)
		if (!grant) {
			throw new MCPWorkspaceReferenceError(
				'The workspace_ref is not available in this session. Call knowledge_list_workspaces again.'
			)
		}
		return grant
	}
	if (grants.size === 1) {
		return grants.values().next().value as SessionGrant
	}
	throw new MCPWorkspaceReferenceError(
		'workspace_ref is required when more than one workspace is available. Call knowledge_list_workspaces first.'
	)
}

export async function readBundleMetadata(grant: SessionGrant): Promise<JSONValue> {
	const info = await grant.bundle.getInfo()
	return v.parse(JSONValueSchema, info.metadata)
}

export function resolveEditableBundle(grant: SessionGrant): EditableKnowledgeBundle<unknown> {
	if (grant.access !== 'editable') {
		throw new MCPWorkspaceReadOnlyError(
			'This workspace is read-only. Enable editable MCP access in Open Knowledge first.'
		)
	}
	return grant.bundle
}
