import * as v from 'valibot'
import { isCanonicalBundlePath } from './paths'
import { NonArrayObjectSchema, object } from './validation'

const ContentHashSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))
export const BundlePathSchema = v.pipe(
	v.string(),
	v.check(isCanonicalBundlePath, 'Use a canonical bundle-relative path.')
)
export const EntryPathSchema = v.pipe(
	v.string(),
	v.minLength(1),
	v.check(isCanonicalBundlePath, 'Use a canonical bundle-relative path.')
)

const UTCDateTimeSchema = v.pipe(
	v.string(),
	v.regex(
		/^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/
	)
)

const NonEmptyStringSchema = v.pipe(v.string(), v.minLength(1))
const NonNegativeIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0))

const EntryBaseEntries = {
	id: NonEmptyStringSchema,
	name: NonEmptyStringSchema,
	path: EntryPathSchema,
	parentPath: BundlePathSchema,
	revision: NonEmptyStringSchema,
	modifiedAt: UTCDateTimeSchema
}

export const KnowledgeEntrySchema = v.pipe(
	NonArrayObjectSchema,
	v.variant('kind', [
		v.object({
			...EntryBaseEntries,
			kind: v.literal('folder')
		}),
		v.object({
			...EntryBaseEntries,
			kind: v.literal('document'),
			byteSize: NonNegativeIntegerSchema,
			contentHash: ContentHashSchema,
			reserved: v.boolean()
		})
	])
)

export const KnowledgeDocumentSchema = object({
	...EntryBaseEntries,
	kind: v.literal('document'),
	byteSize: NonNegativeIntegerSchema,
	contentHash: ContentHashSchema,
	reserved: v.boolean(),
	markdown: v.string()
})

export const EntryExpectationSchema = object({
	id: NonEmptyStringSchema,
	path: EntryPathSchema,
	revision: NonEmptyStringSchema
})

export const ReadDocumentInputSchema = object({
	path: EntryPathSchema
})

export const SaveDocumentInputSchema = object({
	document: EntryExpectationSchema,
	expectedContentHash: ContentHashSchema,
	markdown: v.string()
})

export const CreateEntryInputSchema = object({
	parent: v.nullable(EntryExpectationSchema),
	kind: v.picklist(['folder', 'document']),
	name: v.string()
})

export const RenameEntryInputSchema = object({
	entry: EntryExpectationSchema,
	name: v.string()
})

export const DeleteEntryInputSchema = object({
	entry: EntryExpectationSchema
})

export const mutationMessageIDs = [
	'error.mutation.workspace.not-directory',
	'error.mutation.workspace.root-unavailable',
	'error.mutation.workspace.root-replace',
	'error.mutation.workspace.root-changed',
	'error.mutation.name.required',
	'error.mutation.name.unsupported',
	'error.mutation.name.too-long',
	'error.mutation.name.reserved',
	'error.mutation.entry.not-found',
	'error.mutation.entry.already-exists',
	'error.mutation.entry.create',
	'error.mutation.entry.rename.conflict',
	'error.mutation.entry.rename',
	'error.mutation.entry.delete.conflict',
	'error.mutation.entry.delete',
	'error.mutation.document.not-found',
	'error.mutation.document.save.conflict',
	'error.mutation.document.save.read-back',
	'error.mutation.document.save',
	'error.mutation.folder.not-empty',
	'error.mutation.parent.not-folder',
	'error.mutation.parent.conflict',
	'error.mutation.path.symlink',
	'error.mutation.path.not-portable',
	'error.mutation.path.not-canonical',
	'error.mutation.path.not-directory',
	'error.mutation.path.changed'
] as const

export const MutationMessageIDSchema = v.picklist(mutationMessageIDs)

export const MutationErrorSchema = object({
	code: v.picklist([
		'conflict',
		'not_found',
		'already_exists',
		'invalid_name',
		'invalid_path',
		'not_empty',
		'io_error'
	]),
	message: MutationMessageIDSchema
})

export const SaveDocumentResultSchema = v.pipe(
	NonArrayObjectSchema,
	v.variant('ok', [
		v.object({
			ok: v.literal(true),
			status: v.picklist(['saved', 'unchanged']),
			document: KnowledgeDocumentSchema
		}),
		v.object({
			ok: v.literal(false),
			error: MutationErrorSchema,
			currentDocument: v.optional(KnowledgeDocumentSchema)
		})
	])
)

export const EntryMutationResultSchema = v.pipe(
	NonArrayObjectSchema,
	v.variant('ok', [
		v.object({ ok: v.literal(true), entry: KnowledgeEntrySchema }),
		v.object({ ok: v.literal(false), error: MutationErrorSchema })
	])
)

export const DeleteEntryResultSchema = v.pipe(
	NonArrayObjectSchema,
	v.variant('ok', [
		v.object({ ok: v.literal(true), deletedPath: EntryPathSchema }),
		v.object({ ok: v.literal(false), error: MutationErrorSchema })
	])
)

const EntryMetadataBaseEntries = {
	name: NonEmptyStringSchema,
	path: EntryPathSchema,
	parentPath: BundlePathSchema,
	modifiedAt: UTCDateTimeSchema
}

export const KnowledgeEntryMetadataSchema = v.pipe(
	NonArrayObjectSchema,
	v.variant('kind', [
		v.object({
			...EntryMetadataBaseEntries,
			kind: v.literal('folder')
		}),
		v.object({
			...EntryMetadataBaseEntries,
			kind: v.literal('document'),
			byteSize: NonNegativeIntegerSchema,
			reserved: v.boolean()
		})
	])
)

export const KnowledgeBundleMetadataSnapshotSchema = object({
	entries: v.array(KnowledgeEntryMetadataSchema),
	truncated: v.boolean()
})

export const KnowledgeBundleChangeSchema = object({
	path: BundlePathSchema,
	kind: v.picklist(['created', 'changed', 'removed'])
})

export type KnowledgeEntry = v.InferOutput<typeof KnowledgeEntrySchema>
export type KnowledgeDocument = v.InferOutput<typeof KnowledgeDocumentSchema>
export type EntryExpectation = v.InferOutput<typeof EntryExpectationSchema>
export type ReadDocumentInput = v.InferOutput<typeof ReadDocumentInputSchema>
export type SaveDocumentInput = v.InferOutput<typeof SaveDocumentInputSchema>
export type CreateEntryInput = v.InferOutput<typeof CreateEntryInputSchema>
export type RenameEntryInput = v.InferOutput<typeof RenameEntryInputSchema>
export type DeleteEntryInput = v.InferOutput<typeof DeleteEntryInputSchema>
export type MutationMessageID = v.InferOutput<typeof MutationMessageIDSchema>
export type MutationError = v.InferOutput<typeof MutationErrorSchema>
export type SaveDocumentResult = v.InferOutput<typeof SaveDocumentResultSchema>
export type EntryMutationResult = v.InferOutput<typeof EntryMutationResultSchema>
export type DeleteEntryResult = v.InferOutput<typeof DeleteEntryResultSchema>
export type KnowledgeEntryMetadata = v.InferOutput<typeof KnowledgeEntryMetadataSchema>
export type KnowledgeBundleMetadataSnapshot = v.InferOutput<
	typeof KnowledgeBundleMetadataSnapshotSchema
>
export type KnowledgeBundleChange = v.InferOutput<typeof KnowledgeBundleChangeSchema>

export interface KnowledgeBundleBackend {
	listEntries(): Promise<KnowledgeEntry[]>
	readDocument(path: string): Promise<KnowledgeDocument | null>
	saveDocument(input: SaveDocumentInput): Promise<SaveDocumentResult>
	createEntry(input: CreateEntryInput): Promise<EntryMutationResult>
	renameEntry(input: RenameEntryInput): Promise<EntryMutationResult>
	deleteEntry(input: DeleteEntryInput): Promise<DeleteEntryResult>
}

export interface BoundedKnowledgeBundleBackend {
	listEntryMetadata(
		maximumEntries: number,
		signal?: AbortSignal
	): Promise<KnowledgeBundleMetadataSnapshot>
	readDocumentBounded(
		path: string,
		maximumBytes: number,
		signal?: AbortSignal
	): Promise<KnowledgeDocument | null>
	updateDocumentByHash(
		path: string,
		expectedContentHash: string,
		markdown: string,
		maximumBytes: number,
		signal?: AbortSignal
	): Promise<KnowledgeDocument | null>
}

export class KnowledgeDocumentTooLargeError extends Error {
	override readonly name = 'KnowledgeDocumentTooLargeError'
}

export class KnowledgeDocumentConflictError extends Error {
	override readonly name = 'KnowledgeDocumentConflictError'
}
