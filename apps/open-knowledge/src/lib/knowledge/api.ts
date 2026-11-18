import type {
	CreateKnowledgeBundleDirectoryInput,
	CreateKnowledgeBundleDirectoryResult,
	CreateKnowledgeBundleFileInput,
	CreateKnowledgeBundleFileResult,
	DeleteKnowledgeBundleEntryInput,
	DeleteKnowledgeBundleEntryResult,
	KnowledgeBundleChange,
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntry,
	KnowledgeBundleEntryLocator,
	KnowledgeBundleFile,
	KnowledgeBundleFileAccess,
	KnowledgeBundleFileEntry,
	KnowledgeBundleInfo,
	KnowledgeBundleListing,
	KnowledgeBundleMutationError,
	KnowledgeBundlePath,
	ListKnowledgeBundleInput,
	MoveKnowledgeBundleEntryInput,
	MoveKnowledgeBundleEntryResult,
	PatchKnowledgeBundleFileInput,
	PatchKnowledgeBundleFileResult,
	ReadKnowledgeBundleFileInput,
	WriteKnowledgeBundleFileInput,
	WriteKnowledgeBundleFileResult
} from '@open-knowledge/knowledge-bundle-api'
import {
	isWellFormedText,
	maximumExactTextPatchCharacters,
	maximumExactTextPatchEdits
} from '@open-knowledge/knowledge-bundle-patch'
import * as v from 'valibot'
import { object, strictObject } from '../validation'

export type {
	CreateKnowledgeBundleDirectoryResult,
	CreateKnowledgeBundleFileResult,
	DeleteKnowledgeBundleEntryResult,
	KnowledgeBundleChange,
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntry,
	KnowledgeBundleEntryLocator,
	KnowledgeBundleFile,
	KnowledgeBundleFileAccess,
	KnowledgeBundleFileEntry,
	KnowledgeBundleInfo,
	KnowledgeBundleListing,
	KnowledgeBundleMutationError,
	KnowledgeBundlePath,
	MoveKnowledgeBundleEntryResult,
	PatchKnowledgeBundleFileResult,
	WriteKnowledgeBundleFileResult
}

export function isKnowledgeBundlePath(value: unknown): value is KnowledgeBundlePath {
	if (typeof value !== 'string' || !value.startsWith('/')) {
		return false
	}
	if (value === '/') {
		return true
	}
	if (value.endsWith('/') || value.includes('\\') || value.includes('\0')) {
		return false
	}
	return value
		.slice(1)
		.split('/')
		.every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}

export const KnowledgeBundlePathSchema = v.custom<KnowledgeBundlePath>(
	isKnowledgeBundlePath,
	'Use a canonical bundle-scoped absolute path.'
)
const EntryIDSchema = v.pipe(v.string(), v.nonEmpty())
const EntryRevisionSchema = v.pipe(v.string(), v.nonEmpty())
const ContentHashSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))
const UTCDateTimeSchema = v.pipe(
	v.string(),
	v.regex(
		/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/
	)
)
const entryLocatorEntries = {
	id: v.optional(EntryIDSchema),
	path: KnowledgeBundlePathSchema
}
const EntryBaseEntries = {
	id: EntryIDSchema,
	path: KnowledgeBundlePathSchema,
	name: v.string(),
	parentPath: v.nullable(KnowledgeBundlePathSchema),
	revision: EntryRevisionSchema,
	modifiedAt: UTCDateTimeSchema
}
const KnowledgeBundleDirectoryEntryEntries = {
	...EntryBaseEntries,
	kind: v.literal('directory')
}
export const KnowledgeBundleDirectoryEntrySchema = object(KnowledgeBundleDirectoryEntryEntries)
export const KnowledgeBundleFileAccessSchema = v.picklist(['writable', 'readonly', 'not_supported'])
const KnowledgeBundleFileEntryEntries = {
	...EntryBaseEntries,
	kind: v.literal('file'),
	byteLength: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
	contentHash: ContentHashSchema,
	mediaType: v.optional(v.pipe(v.string(), v.nonEmpty())),
	documentAccess: v.optional(KnowledgeBundleFileAccessSchema)
}
export const KnowledgeBundleFileEntrySchema = object(KnowledgeBundleFileEntryEntries)
export const KnowledgeBundleEntrySchema = v.union([
	KnowledgeBundleDirectoryEntrySchema,
	KnowledgeBundleFileEntrySchema
])
export const KnowledgeBundleFileSchema = object({
	...KnowledgeBundleFileEntryEntries,
	content: v.string()
})
export const RenderedDocumentSchema = object({
	...KnowledgeBundleFileEntryEntries,
	markdown: v.string()
})
export const KnowledgeBundleInfoSchema = object({
	access: v.picklist(['readonly', 'editable']),
	metadata: v.unknown()
})
export const KnowledgeBundleListingSchema = object({
	directory: KnowledgeBundleDirectoryEntrySchema,
	entries: v.array(KnowledgeBundleEntrySchema),
	truncated: v.boolean()
})
const KnowledgeBundleChangeEntries = {
	kind: v.picklist(['created', 'changed', 'removed']),
	path: KnowledgeBundlePathSchema,
	id: v.optional(EntryIDSchema)
}
export const KnowledgeBundleChangeSchema = object(KnowledgeBundleChangeEntries)
export const KnowledgeBundleMutationErrorSchema = v.pipe(
	object({
		code: v.picklist([
			'not_found',
			'revision_conflict',
			'content_conflict',
			'patch_not_found',
			'patch_ambiguous',
			'invalid_patch',
			'already_exists',
			'invalid_path',
			'not_empty',
			'not_a_file',
			'not_a_directory',
			'too_large',
			'unsupported',
			'io_error'
		]),
		message: v.string(),
		editNumber: v.optional(
			v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(maximumExactTextPatchEdits))
		),
		current: v.optional(KnowledgeBundleEntrySchema)
	}),
	v.forward(
		v.check(
			(error) =>
				(error.code !== 'patch_not_found' && error.code !== 'patch_ambiguous') ||
				error.editNumber !== undefined,
			'Patch match failures must identify the failing edit.'
		),
		['editNumber']
	)
)

export const CreateKnowledgeBundleDirectoryResultSchema = v.union([
	object({
		ok: v.literal(true),
		value: object({ directory: KnowledgeBundleDirectoryEntrySchema })
	}),
	object({ ok: v.literal(false), error: KnowledgeBundleMutationErrorSchema })
])
export const CreateKnowledgeBundleFileResultSchema = v.union([
	object({ ok: v.literal(true), value: object({ file: KnowledgeBundleFileEntrySchema }) }),
	object({ ok: v.literal(false), error: KnowledgeBundleMutationErrorSchema })
])
export const WriteKnowledgeBundleFileResultSchema = v.union([
	object({
		ok: v.literal(true),
		value: object({
			status: v.picklist(['updated', 'unchanged']),
			file: KnowledgeBundleFileEntrySchema
		})
	}),
	object({ ok: v.literal(false), error: KnowledgeBundleMutationErrorSchema })
])
export const PatchKnowledgeBundleFileResultSchema = v.union([
	strictObject({
		ok: v.literal(true),
		value: strictObject({
			status: v.picklist(['patched', 'unchanged']),
			file: strictObject(KnowledgeBundleFileEntryEntries)
		})
	}),
	strictObject({ ok: v.literal(false), error: KnowledgeBundleMutationErrorSchema })
])
export const MoveKnowledgeBundleEntryResultSchema = v.union([
	object({
		ok: v.literal(true),
		value: object({
			status: v.picklist(['moved', 'unchanged']),
			entry: KnowledgeBundleEntrySchema
		})
	}),
	object({ ok: v.literal(false), error: KnowledgeBundleMutationErrorSchema })
])
export const DeleteKnowledgeBundleEntryResultSchema = v.union([
	object({ ok: v.literal(true), value: object({ entry: KnowledgeBundleEntrySchema }) }),
	object({ ok: v.literal(false), error: KnowledgeBundleMutationErrorSchema })
])

const WorkspaceBaseEntries = {
	id: v.pipe(v.string(), v.nonEmpty()),
	name: v.pipe(v.string(), v.nonEmpty()),
	lastOpenedAt: UTCDateTimeSchema
}
export const LocalWorkspaceSchema = object({
	...WorkspaceBaseEntries,
	kind: v.literal('local'),
	rootPath: v.pipe(v.string(), v.nonEmpty())
})
export const RemoteWorkspaceSchema = object({
	...WorkspaceBaseEntries,
	kind: v.literal('remote'),
	uri: v.pipe(v.string(), v.trim(), v.url(), v.startsWith('okb://'))
})
export const WorkspaceSchema = v.union([LocalWorkspaceSchema, RemoteWorkspaceSchema])
export const WorkspaceFormatSchema = v.picklist(['markdown', 'open-knowledge'])
const WorkspaceFileEntryEntries = {
	...KnowledgeBundleFileEntryEntries,
	documentAccess: KnowledgeBundleFileAccessSchema
}
export const WorkspaceFileEntrySchema = object(WorkspaceFileEntryEntries)
export const WorkspaceEntrySchema = v.union([
	KnowledgeBundleDirectoryEntrySchema,
	WorkspaceFileEntrySchema
])
export const WorkspaceSnapshotSchema = object({
	workspace: WorkspaceSchema,
	access: v.picklist(['readonly', 'editable']),
	format: WorkspaceFormatSchema,
	openKnowledgeRoots: v.array(KnowledgeBundlePathSchema),
	entries: v.array(WorkspaceEntrySchema)
})
const WorkspaceInputEntries = {
	workspaceID: v.pipe(v.string(), v.nonEmpty())
}
export const WorkspaceInputSchema = object(WorkspaceInputEntries)
export const OpenWorkspaceInputSchema = WorkspaceInputSchema
export const maximumKnowledgeSearchQueryCharacters = 1_000
export const maximumKnowledgeSearchResults = 200
export const maximumKnowledgeSearchPreviewCharacters = 1_000
export const SearchKnowledgeInputSchema = object({
	...WorkspaceInputEntries,
	query: v.pipe(
		v.string(),
		v.nonEmpty(),
		v.maxLength(maximumKnowledgeSearchQueryCharacters),
		v.check((value) => !value.includes('\0'), 'Search queries cannot contain NUL.')
	),
	limit: v.pipe(
		v.number(),
		v.safeInteger(),
		v.minValue(1),
		v.maxValue(maximumKnowledgeSearchResults)
	)
})
export const KnowledgeSearchMatchSchema = object({
	path: KnowledgeBundlePathSchema,
	lineNumber: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
	columnNumber: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
	preview: v.pipe(v.string(), v.maxLength(maximumKnowledgeSearchPreviewCharacters)),
	match: v.pipe(v.string(), v.maxLength(maximumKnowledgeSearchPreviewCharacters))
})
export const KnowledgeSearchResultSchema = object({
	matches: v.pipe(v.array(KnowledgeSearchMatchSchema), v.maxLength(maximumKnowledgeSearchResults)),
	truncated: v.boolean()
})
export const OpenSystemPathInputSchema = object({
	...WorkspaceInputEntries,
	path: v.pipe(
		v.string(),
		v.nonEmpty(),
		v.maxLength(32_768),
		v.check((value) => !value.includes('\0'), 'System paths cannot contain NUL.')
	)
})
const WorkspaceEntryLocatorEntries = {
	...WorkspaceInputEntries,
	...entryLocatorEntries
}
export const WorkspaceEntryLocatorSchema = object(WorkspaceEntryLocatorEntries)
export const ListKnowledgeBundleInputSchema = object({
	...WorkspaceEntryLocatorEntries,
	depth: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
	limit: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1)))
})
export const ReadKnowledgeBundleFileInputSchema = object({
	...WorkspaceEntryLocatorEntries,
	maximumBytes: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1)))
})
export const CreateKnowledgeBundleDirectoryInputSchema = WorkspaceEntryLocatorSchema
export const CreateKnowledgeBundleFileInputSchema = object({
	...WorkspaceEntryLocatorEntries,
	content: v.string(),
	mediaType: v.optional(v.pipe(v.string(), v.nonEmpty()))
})
export const WriteKnowledgeBundleFileInputSchema = object({
	...WorkspaceEntryLocatorEntries,
	expectedRevision: v.optional(EntryRevisionSchema),
	expectedContentHash: v.optional(ContentHashSchema),
	content: v.string(),
	mediaType: v.optional(v.pipe(v.string(), v.nonEmpty()))
})
const KnowledgeBundleTextEditSchema = v.pipe(
	object({
		oldText: v.pipe(
			v.string(),
			v.nonEmpty(),
			v.maxLength(maximumExactTextPatchCharacters),
			v.check(isWellFormedText, 'oldText must contain valid Unicode.')
		),
		newText: v.pipe(
			v.string(),
			v.maxLength(maximumExactTextPatchCharacters),
			v.check(isWellFormedText, 'newText must contain valid Unicode.')
		)
	}),
	v.check(({ oldText, newText }) => oldText !== newText, 'oldText and newText must differ.')
)
const KnowledgeBundleTextEditsSchema = v.pipe(
	v.array(KnowledgeBundleTextEditSchema),
	v.minLength(1),
	v.maxLength(maximumExactTextPatchEdits),
	v.check(
		(edits) =>
			edits.reduce((total, { oldText, newText }) => total + oldText.length + newText.length, 0) <=
			maximumExactTextPatchCharacters,
		`Patch text cannot exceed ${maximumExactTextPatchCharacters} characters.`
	)
)
export const PatchKnowledgeBundleFileInputSchema = object({
	...WorkspaceEntryLocatorEntries,
	expectedRevision: v.optional(EntryRevisionSchema),
	expectedContentHash: v.optional(ContentHashSchema),
	maximumBytes: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
	edits: KnowledgeBundleTextEditsSchema
})
export const MoveKnowledgeBundleEntryInputSchema = object({
	...WorkspaceEntryLocatorEntries,
	expectedRevision: v.optional(EntryRevisionSchema),
	destinationPath: KnowledgeBundlePathSchema
})
export const DeleteKnowledgeBundleEntryInputSchema = object({
	...WorkspaceEntryLocatorEntries,
	expectedRevision: v.optional(EntryRevisionSchema)
})
export const WorkspaceChangeSchema = object({
	...WorkspaceInputEntries,
	...KnowledgeBundleChangeEntries
})

export type Workspace = v.InferOutput<typeof WorkspaceSchema>
export type LocalWorkspace = v.InferOutput<typeof LocalWorkspaceSchema>
export type RemoteWorkspace = v.InferOutput<typeof RemoteWorkspaceSchema>
export type WorkspaceFormat = v.InferOutput<typeof WorkspaceFormatSchema>
export type WorkspaceFileEntry = v.InferOutput<typeof WorkspaceFileEntrySchema>
export type WorkspaceEntry = v.InferOutput<typeof WorkspaceEntrySchema>
export type WorkspaceFile = KnowledgeBundleFile & { documentAccess: KnowledgeBundleFileAccess }
export type WorkspaceSnapshot = v.InferOutput<typeof WorkspaceSnapshotSchema>
export type OpenWorkspaceInput = v.InferOutput<typeof OpenWorkspaceInputSchema>
export type WorkspaceInput = v.InferOutput<typeof WorkspaceInputSchema>
export type SearchKnowledgeInput = v.InferOutput<typeof SearchKnowledgeInputSchema>
export type KnowledgeSearchMatch = v.InferOutput<typeof KnowledgeSearchMatchSchema>
export type KnowledgeSearchResult = v.InferOutput<typeof KnowledgeSearchResultSchema>
export type OpenSystemPathInput = v.InferOutput<typeof OpenSystemPathInputSchema>
export type WorkspaceListKnowledgeBundleInput = WorkspaceInput & ListKnowledgeBundleInput
export type WorkspaceReadKnowledgeBundleFileInput = WorkspaceInput & ReadKnowledgeBundleFileInput
export type WorkspaceReadRenderedDocumentInput = WorkspaceReadKnowledgeBundleFileInput
export type RenderedDocument = v.InferOutput<typeof RenderedDocumentSchema>
export type WorkspaceCreateKnowledgeBundleDirectoryInput = WorkspaceInput &
	CreateKnowledgeBundleDirectoryInput
export type WorkspaceCreateKnowledgeBundleFileInput = WorkspaceInput &
	CreateKnowledgeBundleFileInput
export type WorkspaceWriteKnowledgeBundleFileInput = WorkspaceInput & WriteKnowledgeBundleFileInput
export type WorkspacePatchKnowledgeBundleFileInput = WorkspaceInput & PatchKnowledgeBundleFileInput
export type WorkspaceMoveKnowledgeBundleEntryInput = WorkspaceInput & MoveKnowledgeBundleEntryInput
export type WorkspaceDeleteKnowledgeBundleEntryInput = WorkspaceInput &
	DeleteKnowledgeBundleEntryInput
export type WorkspaceChange = WorkspaceInput & KnowledgeBundleChange

export interface KnowledgeAPI {
	openWorkspace(input: OpenWorkspaceInput): Promise<WorkspaceSnapshot>
	refreshWorkspace(input: WorkspaceInput): Promise<WorkspaceSnapshot>
	getInfo(input: WorkspaceInput): Promise<KnowledgeBundleInfo>
	list(input: WorkspaceListKnowledgeBundleInput): Promise<KnowledgeBundleListing | null>
	search(input: SearchKnowledgeInput): Promise<KnowledgeSearchResult>
	readFile(input: WorkspaceReadKnowledgeBundleFileInput): Promise<KnowledgeBundleFile | null>
	readRenderedDocument(input: WorkspaceReadRenderedDocumentInput): Promise<RenderedDocument | null>
	createDirectory(
		input: WorkspaceCreateKnowledgeBundleDirectoryInput
	): Promise<CreateKnowledgeBundleDirectoryResult>
	createFile(
		input: WorkspaceCreateKnowledgeBundleFileInput
	): Promise<CreateKnowledgeBundleFileResult>
	writeFile(input: WorkspaceWriteKnowledgeBundleFileInput): Promise<WriteKnowledgeBundleFileResult>
	patchFile(input: WorkspacePatchKnowledgeBundleFileInput): Promise<PatchKnowledgeBundleFileResult>
	moveEntry(input: WorkspaceMoveKnowledgeBundleEntryInput): Promise<MoveKnowledgeBundleEntryResult>
	deleteEntry(
		input: WorkspaceDeleteKnowledgeBundleEntryInput
	): Promise<DeleteKnowledgeBundleEntryResult>
	openSystemPath(input: OpenSystemPathInput): Promise<void>
	revealWorkspace(input: WorkspaceInput): Promise<void>
	onWorkspaceChange(listener: (change: WorkspaceChange) => void): () => void
}
