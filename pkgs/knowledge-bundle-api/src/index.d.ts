/**
 * A canonical, bundle-scoped absolute path. `/` identifies the bundle root.
 *
 * The template type only enforces the leading slash. Implementations must reject empty, `.`, and
 * `..` segments, repeated or trailing separators, backslashes, NULs, and paths outside the bundle.
 */
export type KnowledgeBundlePath = `/${string}`

/** An opaque ID whose meaning is scoped to one knowledge bundle. */
export type KnowledgeBundleEntryID = string

/** An opaque entry revision used for optimistic concurrency. */
export type KnowledgeBundleEntryRevision = string

/** A lowercase hexadecimal SHA-256 digest of file content. */
export type KnowledgeBundleContentHash = string

export type KnowledgeBundleAccess = 'readonly' | 'editable'
export type KnowledgeBundleFileAccess = 'writable' | 'readonly' | 'not_supported'

export type KnowledgeBundleInfo<
	Metadata = unknown,
	Access extends KnowledgeBundleAccess = KnowledgeBundleAccess
> = {
	readonly access: Access
	readonly metadata: Metadata
}

/**
 * Locates an entry without allowing a stale path to silently select another entry.
 *
 * `path` is always required and is the caller's last-known path. When `id` is present, it is the
 * authoritative identity: an implementation follows that ID to its current path and must not fall
 * back to a different entry which now occupies `path`. If the ID cannot be resolved, the operation
 * fails even when `path` currently resolves.
 */
export type KnowledgeBundleEntryLocator = {
	readonly id?: KnowledgeBundleEntryID
	readonly path: KnowledgeBundlePath
}

export type KnowledgeBundleEntryBase = {
	readonly id: KnowledgeBundleEntryID
	readonly path: KnowledgeBundlePath
	readonly name: string
	readonly parentPath: KnowledgeBundlePath | null
	readonly revision: KnowledgeBundleEntryRevision
	readonly modifiedAt: string
}

export type KnowledgeBundleDirectoryEntry = KnowledgeBundleEntryBase & {
	readonly kind: 'directory'
}

export type KnowledgeBundleFileEntry = KnowledgeBundleEntryBase & {
	readonly kind: 'file'
	readonly byteLength: number
	readonly contentHash: KnowledgeBundleContentHash
	readonly mediaType?: string
	/**
	 * Optional presentation hint for document clients. This never grants more authority than the
	 * bundle-level access and mutation methods remain authoritative.
	 */
	readonly documentAccess?: KnowledgeBundleFileAccess
}

export type KnowledgeBundleEntry = KnowledgeBundleDirectoryEntry | KnowledgeBundleFileEntry

export type KnowledgeBundleFile = KnowledgeBundleFileEntry & {
	readonly content: string
}

export type ListKnowledgeBundleInput = KnowledgeBundleEntryLocator & {
	/** A non-negative integer. Zero returns no descendants; one returns immediate children. */
	readonly depth: number
	/** An optional positive upper bound on returned descendants. */
	readonly limit?: number
}

export type KnowledgeBundleListing = {
	/** The resolved directory, including its canonical current path. */
	readonly directory: KnowledgeBundleDirectoryEntry
	/** A flat list of descendants no deeper than the requested depth. */
	readonly entries: readonly KnowledgeBundleEntry[]
	/** True when the result stopped at the requested limit. */
	readonly truncated: boolean
}

export type ReadKnowledgeBundleFileInput = KnowledgeBundleEntryLocator & {
	/** Reject rather than transfer content larger than this optional positive byte limit. */
	readonly maximumBytes?: number
}

export type KnowledgeBundleChange = {
	readonly kind: 'created' | 'changed' | 'removed'
	readonly path: KnowledgeBundlePath
	readonly id?: KnowledgeBundleEntryID
}

export type KnowledgeBundleChangeListener = (
	change: KnowledgeBundleChange
) => void | Promise<void>

export type KnowledgeBundleMutationErrorCode =
	| 'not_found'
	| 'revision_conflict'
	| 'content_conflict'
	| 'patch_not_found'
	| 'patch_ambiguous'
	| 'invalid_patch'
	| 'already_exists'
	| 'invalid_path'
	| 'not_empty'
	| 'not_a_file'
	| 'not_a_directory'
	| 'too_large'
	| 'unsupported'
	| 'io_error'

export type KnowledgeBundleMutationError = {
	readonly code: KnowledgeBundleMutationErrorCode
	readonly message: string
	/** The one-based failing edit for a patch-specific error. */
	readonly editNumber?: number
	/** The current entry when disclosing it can help the caller recover from drift. */
	readonly current?: KnowledgeBundleEntry
}

export type KnowledgeBundleMutationResult<Value> =
	| { readonly ok: true; readonly value: Value }
	| { readonly ok: false; readonly error: KnowledgeBundleMutationError }

export type CreateKnowledgeBundleDirectoryInput = KnowledgeBundleEntryLocator

export type CreateKnowledgeBundleDirectoryValue = {
	readonly directory: KnowledgeBundleDirectoryEntry
}

export type CreateKnowledgeBundleDirectoryResult =
	KnowledgeBundleMutationResult<CreateKnowledgeBundleDirectoryValue>

export type CreateKnowledgeBundleFileInput = KnowledgeBundleEntryLocator & {
	readonly content: string
	readonly mediaType?: string
}

export type CreateKnowledgeBundleFileValue = {
	readonly file: KnowledgeBundleFileEntry
}

export type CreateKnowledgeBundleFileResult =
	KnowledgeBundleMutationResult<CreateKnowledgeBundleFileValue>

/** Replaces the contents of an existing file identified by `id` or `path`. */
export type WriteKnowledgeBundleFileInput = KnowledgeBundleEntryLocator & {
	readonly expectedRevision?: KnowledgeBundleEntryRevision
	readonly expectedContentHash?: KnowledgeBundleContentHash
	readonly content: string
	readonly mediaType?: string
}

export type WriteKnowledgeBundleFileValue = {
	readonly status: 'updated' | 'unchanged'
	/** The written file, including its canonical current path and revision. */
	readonly file: KnowledgeBundleFileEntry
}

export type WriteKnowledgeBundleFileResult =
	KnowledgeBundleMutationResult<WriteKnowledgeBundleFileValue>

/** One exact, content-addressed replacement within a text file. */
export type KnowledgeBundleTextEdit = {
	/** Non-empty text which must occur exactly once when this edit is reached. */
	readonly oldText: string
	/** Replacement text. An empty string deletes the matched text. */
	readonly newText: string
}

/** Applies ordered exact-text edits to an existing file identified by `id` or `path`. */
export type PatchKnowledgeBundleFileInput = KnowledgeBundleEntryLocator & {
	readonly expectedRevision?: KnowledgeBundleEntryRevision
	readonly expectedContentHash?: KnowledgeBundleContentHash
	/** Reject rather than read or commit content larger than this optional positive byte limit. */
	readonly maximumBytes?: number
	/** One to 100 edits with at most 262,144 combined old/new characters. */
	readonly edits: readonly KnowledgeBundleTextEdit[]
}

export type PatchKnowledgeBundleFileValue = {
	readonly status: 'patched' | 'unchanged'
	/** The patched file, including its canonical current path and revision. */
	readonly file: KnowledgeBundleFileEntry
}

export type PatchKnowledgeBundleFileResult =
	KnowledgeBundleMutationResult<PatchKnowledgeBundleFileValue>

export type MoveKnowledgeBundleEntryInput = KnowledgeBundleEntryLocator & {
	readonly expectedRevision?: KnowledgeBundleEntryRevision
	readonly destinationPath: KnowledgeBundlePath
}

export type MoveKnowledgeBundleEntryValue = {
	readonly status: 'moved' | 'unchanged'
	/** The moved entry at its canonical resulting path. */
	readonly entry: KnowledgeBundleEntry
}

export type MoveKnowledgeBundleEntryResult =
	KnowledgeBundleMutationResult<MoveKnowledgeBundleEntryValue>

export type DeleteKnowledgeBundleEntryInput = KnowledgeBundleEntryLocator & {
	readonly expectedRevision?: KnowledgeBundleEntryRevision
}

export type DeleteKnowledgeBundleEntryValue = {
	/** The entry as resolved immediately before deletion. */
	readonly entry: KnowledgeBundleEntry
}

export type DeleteKnowledgeBundleEntryResult =
	KnowledgeBundleMutationResult<DeleteKnowledgeBundleEntryValue>

/** A retained change subscription. Remote implementations expose it as an RPC capability. */
export interface KnowledgeBundleSubscription {
	close(): Promise<void>
}

/**
 * The root capability for a remote or local knowledge bundle.
 *
 * It is suitable as the type argument to a Cap'n Web session. Implementations exposed through
 * Cap'n Web extend `RpcTarget`; this declaration intentionally has no runtime dependency on it.
 */
export interface KnowledgeBundle<
	Metadata = unknown,
	Access extends KnowledgeBundleAccess = KnowledgeBundleAccess
> {
	getInfo(): Promise<KnowledgeBundleInfo<Metadata, Access>>
	list(input: ListKnowledgeBundleInput): Promise<KnowledgeBundleListing | null>
	readFile(input: ReadKnowledgeBundleFileInput): Promise<KnowledgeBundleFile | null>
}

/** Optional extension for persistent transports which support retained callback capabilities. */
export interface SubscribableKnowledgeBundle<
	Metadata = unknown,
	Access extends KnowledgeBundleAccess = KnowledgeBundleAccess
> extends KnowledgeBundle<Metadata, Access> {
	subscribe(listener: KnowledgeBundleChangeListener): Promise<KnowledgeBundleSubscription>
}

export interface ReadonlyKnowledgeBundle<Metadata = unknown> extends KnowledgeBundle<
	Metadata,
	'readonly'
> {}

/** Bundle-level editing authority. Per-file document access is an advisory presentation hint. */
export interface EditableKnowledgeBundle<Metadata = unknown> extends KnowledgeBundle<
	Metadata,
	'editable'
> {
	createDirectory(
		input: CreateKnowledgeBundleDirectoryInput
	): Promise<CreateKnowledgeBundleDirectoryResult>
	createFile(input: CreateKnowledgeBundleFileInput): Promise<CreateKnowledgeBundleFileResult>
	writeFile(input: WriteKnowledgeBundleFileInput): Promise<WriteKnowledgeBundleFileResult>
	patchFile(input: PatchKnowledgeBundleFileInput): Promise<PatchKnowledgeBundleFileResult>
	moveEntry(input: MoveKnowledgeBundleEntryInput): Promise<MoveKnowledgeBundleEntryResult>
	deleteEntry(input: DeleteKnowledgeBundleEntryInput): Promise<DeleteKnowledgeBundleEntryResult>
}
