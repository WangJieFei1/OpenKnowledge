import type {
	CreateKnowledgeBundleDirectoryInput,
	CreateKnowledgeBundleDirectoryResult,
	CreateKnowledgeBundleFileInput,
	CreateKnowledgeBundleFileResult,
	DeleteKnowledgeBundleEntryInput,
	DeleteKnowledgeBundleEntryResult,
	EditableKnowledgeBundle,
	KnowledgeBundleContentHash,
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntry,
	KnowledgeBundleEntryID,
	KnowledgeBundleEntryLocator,
	KnowledgeBundleEntryRevision,
	KnowledgeBundleFile,
	KnowledgeBundleFileEntry,
	KnowledgeBundleInfo,
	KnowledgeBundleListing,
	KnowledgeBundleMutationError,
	KnowledgeBundlePath,
	KnowledgeBundleTextEdit,
	ListKnowledgeBundleInput,
	MoveKnowledgeBundleEntryInput,
	MoveKnowledgeBundleEntryResult,
	PatchKnowledgeBundleFileInput,
	PatchKnowledgeBundleFileResult,
	ReadKnowledgeBundleFileInput,
	WriteKnowledgeBundleFileInput,
	WriteKnowledgeBundleFileResult
} from '@open-knowledge/knowledge-bundle-api'
import { applyExactTextPatch, ExactTextPatchError } from '@open-knowledge/knowledge-bundle-patch'
import { RpcTarget } from 'capnweb'
import * as v from 'valibot'

export type RemoteTestKnowledgeBundleMetadata = {
	readonly title: string
	readonly description: string
	readonly transport: 'capnweb-http-batch'
	readonly limits: {
		readonly maximumEntries: number
		readonly maximumFileBytes: number
		readonly maximumPathBytes: number
		readonly maximumPathSegmentBytes: number
	}
}

type StoredEntryBase = {
	id: KnowledgeBundleEntryID
	path: KnowledgeBundlePath
	name: string
	parentPath: KnowledgeBundlePath | null
	revision: KnowledgeBundleEntryRevision
	modifiedAt: string
}

type StoredDirectory = StoredEntryBase & {
	kind: 'directory'
}

type StoredFile = StoredEntryBase & {
	kind: 'file'
	content: string
	byteLength: number
	contentHash: KnowledgeBundleContentHash
	mediaType?: string
}

type StoredEntry = StoredDirectory | StoredFile

type MutationFailure = {
	readonly ok: false
	readonly error: KnowledgeBundleMutationError
}

const MAXIMUM_ENTRIES = 1_024
const MAXIMUM_FILE_BYTES = 1_048_576
const MAXIMUM_PATH_BYTES = 4_096
const MAXIMUM_PATH_SEGMENT_BYTES = 255
const MAXIMUM_MEDIA_TYPE_BYTES = 255
const textEncoder = new TextEncoder()

const PlainObjectSchema = v.custom<Record<string, unknown>>(
	(value) => typeof value === 'object' && value !== null && !Array.isArray(value)
)
const LocatorSchema = v.pipe(
	PlainObjectSchema,
	v.object({ id: v.optional(v.string()), path: v.unknown() })
)
const CanonicalPathSchema = v.pipe(
	v.string('A bundle path must be an absolute path beginning with /.'),
	v.startsWith('/', 'A bundle path must be an absolute path beginning with /.'),
	v.maxBytes(MAXIMUM_PATH_BYTES, `A bundle path cannot exceed ${MAXIMUM_PATH_BYTES} UTF-8 bytes.`),
	v.check(
		(value) => !value.includes('\\') && !value.includes('\0'),
		'Bundle paths cannot contain backslashes or NUL characters.'
	),
	v.check(
		(value) =>
			value === '/' ||
			value
				.slice(1)
				.split('/')
				.every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
		'Bundle paths cannot contain empty, dot, or parent-directory segments.'
	),
	v.check(
		(value) =>
			value === '/' ||
			value
				.slice(1)
				.split('/')
				.every((segment) => utf8Length(segment) <= MAXIMUM_PATH_SEGMENT_BYTES),
		`A path segment cannot exceed ${MAXIMUM_PATH_SEGMENT_BYTES} UTF-8 bytes.`
	)
)
const ListingDepthSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const OptionalPositiveIntegerSchema = v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1)))
const invalidMediaTypeMessage = 'The media type is not valid.'
const MediaTypeSchema = v.optional(
	v.pipe(
		v.string(invalidMediaTypeMessage),
		v.nonEmpty(invalidMediaTypeMessage),
		v.maxBytes(MAXIMUM_MEDIA_TYPE_BYTES, invalidMediaTypeMessage),
		v.regex(/^[^\u0000-\u001f\u007f]+$/, invalidMediaTypeMessage)
	)
)
const FileContentInputSchema = v.pipe(
	PlainObjectSchema,
	v.object({
		content: v.string('File content must be a string.'),
		mediaType: MediaTypeSchema
	})
)
const PatchEditSchema = v.pipe(
	PlainObjectSchema,
	v.object({ oldText: v.string(), newText: v.string() })
)
const PatchEditsSchema = v.array(PatchEditSchema)

const welcomeMarkdown = `# Remote Knowledge Bundle

This editable bundle is kept in memory and exposed over Cap'n Web for integration testing.

Use it to verify canonical-path reads, optimistic edits, native exact-text patches, stable entry IDs,
and persistence across independent HTTP batch sessions. Restarting the server restores the original
documents.
`

const gettingStartedMarkdown = `# Getting Started

1. List the bundle root to discover entries and their stable IDs.
2. Read a Markdown file with an optional byte bound.
3. Supply the latest revision and content hash when patching or replacing content.
4. Send exact old/new text to patch a document without retransmitting the complete file.
5. Open a new HTTP session and confirm that the edit is still present.
`

const rpcReferenceMarkdown = `# RPC Reference

The endpoint supports metadata, bounded listings, bounded reads, native exact-text patches, and other
editable bundle mutations.

Paths are bundle-scoped absolute paths. IDs remain stable through moves, while revisions change
whenever observable entry metadata or content changes.
`

class InvalidBundlePathError extends Error {
	override readonly name = 'InvalidBundlePathError'
}

export class InMemoryKnowledgeBundle
	extends RpcTarget
	implements EditableKnowledgeBundle<RemoteTestKnowledgeBundleMetadata>
{
	#entriesByID = new Map<KnowledgeBundleEntryID, StoredEntry>()
	#entryIDsByPath = new Map<KnowledgeBundlePath, KnowledgeBundleEntryID>()
	#nextEntryID = 1
	#nextRevision = 1
	#lastModifiedTime = 0

	constructor() {
		super()
		this.#seed()
	}

	async getInfo(): Promise<KnowledgeBundleInfo<RemoteTestKnowledgeBundleMetadata, 'editable'>> {
		return {
			access: 'editable',
			metadata: {
				title: 'Open Knowledge remote test bundle',
				description: "A shared in-memory bundle for exercising editable Cap'n Web clients.",
				transport: 'capnweb-http-batch',
				limits: {
					maximumEntries: MAXIMUM_ENTRIES,
					maximumFileBytes: MAXIMUM_FILE_BYTES,
					maximumPathBytes: MAXIMUM_PATH_BYTES,
					maximumPathSegmentBytes: MAXIMUM_PATH_SEGMENT_BYTES
				}
			}
		}
	}

	async list(input: ListKnowledgeBundleInput): Promise<KnowledgeBundleListing | null> {
		const locator = parseLocator(input)
		assertDepth(input.depth)
		assertLimit(input.limit)
		const directory = this.#resolve(locator)
		if (!directory || directory.kind !== 'directory') {
			return null
		}

		const descendants = [...this.#entriesByID.values()]
			.filter((entry) => {
				const depth = descendantDepth(directory.path, entry.path)
				return depth !== null && depth <= input.depth
			})
			.sort(compareStoredEntries)
		const truncated = input.limit !== undefined && descendants.length > input.limit
		const selected = input.limit === undefined ? descendants : descendants.slice(0, input.limit)
		return {
			directory: publicDirectory(directory),
			entries: selected.map(publicEntry),
			truncated
		}
	}

	async readFile(input: ReadKnowledgeBundleFileInput): Promise<KnowledgeBundleFile | null> {
		const locator = parseLocator(input)
		assertMaximumBytes(input.maximumBytes)
		const file = this.#resolve(locator)
		if (!file || file.kind !== 'file') {
			return null
		}
		if (input.maximumBytes !== undefined && file.byteLength > input.maximumBytes) {
			throw new RangeError(
				`File ${file.path} is ${file.byteLength} bytes, exceeding the ${input.maximumBytes}-byte read bound.`
			)
		}
		return publicFile(file)
	}

	async createDirectory(
		input: CreateKnowledgeBundleDirectoryInput
	): Promise<CreateKnowledgeBundleDirectoryResult> {
		let locator: KnowledgeBundleEntryLocator
		try {
			locator = parseLocator(input)
		} catch (error) {
			return invalidPathFailure(error)
		}
		if (locator.id !== undefined) {
			return mutationFailure('unsupported', 'Caller-supplied entry IDs are not supported.')
		}
		const targetPath = locator.path
		if (targetPath === '/') {
			return mutationFailure('invalid_path', 'The bundle root cannot be replaced.')
		}
		if (this.#entryAt(targetPath)) {
			return mutationFailure('already_exists', `An entry already exists at ${targetPath}.`)
		}
		const parent = this.#creationParent(targetPath)
		if (!parent.ok) {
			return parent.result
		}
		if (this.#entriesByID.size >= MAXIMUM_ENTRIES) {
			return mutationFailure('too_large', `The bundle is limited to ${MAXIMUM_ENTRIES} entries.`)
		}

		const directory = this.#newDirectory(targetPath)
		this.#store(directory)
		this.#touch(parent.directory)
		return { ok: true, value: { directory: publicDirectory(directory) } }
	}

	async createFile(
		input: CreateKnowledgeBundleFileInput
	): Promise<CreateKnowledgeBundleFileResult> {
		let locator: KnowledgeBundleEntryLocator
		try {
			locator = parseLocator(input)
		} catch (error) {
			return invalidPathFailure(error)
		}
		if (locator.id !== undefined) {
			return mutationFailure('unsupported', 'Caller-supplied entry IDs are not supported.')
		}
		const targetPath = locator.path
		if (targetPath === '/') {
			return mutationFailure('invalid_path', 'The bundle root cannot be replaced.')
		}
		const fileInput = validateFileContentInput(input)
		if (!fileInput.ok) {
			return fileInput
		}
		const { content, mediaType } = fileInput.value
		const byteLength = utf8Length(content)
		if (byteLength > MAXIMUM_FILE_BYTES) {
			return mutationFailure(
				'too_large',
				`File content exceeds the ${MAXIMUM_FILE_BYTES}-byte limit.`
			)
		}
		if (this.#entryAt(targetPath)) {
			return mutationFailure('already_exists', `An entry already exists at ${targetPath}.`)
		}
		const parent = this.#creationParent(targetPath)
		if (!parent.ok) {
			return parent.result
		}
		if (this.#entriesByID.size >= MAXIMUM_ENTRIES) {
			return mutationFailure('too_large', `The bundle is limited to ${MAXIMUM_ENTRIES} entries.`)
		}

		const file = this.#newFile(targetPath, content, mediaType)
		this.#store(file)
		this.#touch(parent.directory)
		return { ok: true, value: { file: publicFileEntry(file) } }
	}

	async writeFile(input: WriteKnowledgeBundleFileInput): Promise<WriteKnowledgeBundleFileResult> {
		let locator: KnowledgeBundleEntryLocator
		try {
			locator = parseLocator(input)
		} catch (error) {
			return invalidPathFailure(error)
		}
		const fileInput = validateFileContentInput(input)
		if (!fileInput.ok) {
			return fileInput
		}
		const { content, mediaType: requestedMediaType } = fileInput.value
		const byteLength = utf8Length(content)
		if (byteLength > MAXIMUM_FILE_BYTES) {
			return mutationFailure(
				'too_large',
				`File content exceeds the ${MAXIMUM_FILE_BYTES}-byte limit.`
			)
		}

		const current = this.#resolve(locator)
		if (!current) {
			return mutationFailure('not_found', 'The file no longer exists.')
		}
		if (current.kind !== 'file') {
			return mutationFailure(
				'not_a_file',
				'The requested entry is not a file.',
				publicEntry(current)
			)
		}
		if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
			return mutationFailure(
				'revision_conflict',
				'The file revision changed.',
				publicFileEntry(current)
			)
		}
		if (
			input.expectedContentHash !== undefined &&
			input.expectedContentHash !== current.contentHash
		) {
			return mutationFailure(
				'content_conflict',
				'The file content changed.',
				publicFileEntry(current)
			)
		}

		const mediaType = requestedMediaType ?? current.mediaType
		const nextHash = hashContent(content)
		if (
			content === current.content &&
			mediaType === current.mediaType &&
			nextHash === current.contentHash
		) {
			return {
				ok: true,
				value: { status: 'unchanged', file: publicFileEntry(current) }
			}
		}

		current.content = content
		current.byteLength = byteLength
		current.contentHash = nextHash
		current.mediaType = mediaType
		this.#touch(current)
		return {
			ok: true,
			value: { status: 'updated', file: publicFileEntry(current) }
		}
	}

	async patchFile(input: PatchKnowledgeBundleFileInput): Promise<PatchKnowledgeBundleFileResult> {
		let locator: KnowledgeBundleEntryLocator
		try {
			locator = parseLocator(input)
			assertMaximumBytes(input.maximumBytes)
		} catch (error) {
			return invalidPathFailure(error)
		}

		const current = this.#resolve(locator)
		if (!current) {
			return mutationFailure('not_found', 'The file no longer exists.')
		}
		if (current.kind !== 'file') {
			return mutationFailure(
				'not_a_file',
				'The requested entry is not a file.',
				publicEntry(current)
			)
		}
		if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
			return mutationFailure(
				'revision_conflict',
				'The file revision changed.',
				publicFileEntry(current)
			)
		}
		if (
			input.expectedContentHash !== undefined &&
			input.expectedContentHash !== current.contentHash
		) {
			return mutationFailure(
				'content_conflict',
				'The file content changed.',
				publicFileEntry(current)
			)
		}
		if (input.maximumBytes !== undefined && current.byteLength > input.maximumBytes) {
			return mutationFailure(
				'too_large',
				`Current content exceeds the ${input.maximumBytes}-byte limit.`,
				publicFileEntry(current)
			)
		}

		let content: string
		try {
			content = applyExactTextPatch(current.content, parsePatchEdits(input.edits))
		} catch (error) {
			if (!(error instanceof ExactTextPatchError)) {
				throw error
			}
			return exactTextPatchFailure(error, current)
		}
		const byteLength = utf8Length(content)
		const maximumBytes = Math.min(input.maximumBytes ?? MAXIMUM_FILE_BYTES, MAXIMUM_FILE_BYTES)
		if (byteLength > maximumBytes) {
			return mutationFailure(
				'too_large',
				`Patched content exceeds the ${maximumBytes}-byte limit.`,
				publicFileEntry(current)
			)
		}
		if (content === current.content) {
			return {
				ok: true,
				value: { status: 'unchanged', file: publicFileEntry(current) }
			}
		}

		current.content = content
		current.byteLength = byteLength
		current.contentHash = hashContent(content)
		this.#touch(current)
		return {
			ok: true,
			value: { status: 'patched', file: publicFileEntry(current) }
		}
	}

	async moveEntry(input: MoveKnowledgeBundleEntryInput): Promise<MoveKnowledgeBundleEntryResult> {
		let locator: KnowledgeBundleEntryLocator
		let destinationPath: KnowledgeBundlePath
		try {
			locator = parseLocator(input)
			destinationPath = canonicalPath(input.destinationPath)
		} catch (error) {
			return invalidPathFailure(error)
		}

		const current = this.#resolve(locator)
		if (!current) {
			return mutationFailure('not_found', 'The entry no longer exists.')
		}
		if (current.path === '/') {
			return mutationFailure('unsupported', 'The bundle root cannot be moved.')
		}
		if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
			return mutationFailure(
				'revision_conflict',
				'The entry revision changed.',
				publicEntry(current)
			)
		}
		if (destinationPath === current.path) {
			return {
				ok: true,
				value: { status: 'unchanged', entry: publicEntry(current) }
			}
		}
		if (current.kind === 'directory' && destinationPath.startsWith(`${current.path}/`)) {
			return mutationFailure('invalid_path', 'A directory cannot be moved inside itself.')
		}
		if (this.#entryAt(destinationPath)) {
			return mutationFailure('already_exists', `An entry already exists at ${destinationPath}.`)
		}
		const destinationParent = this.#creationParent(destinationPath)
		if (!destinationParent.ok) {
			return destinationParent.result
		}

		const oldPath = current.path
		const movingEntries = [...this.#entriesByID.values()]
			.filter((entry) => entry.path === oldPath || entry.path.startsWith(`${oldPath}/`))
			.sort(compareStoredEntries)
		const plannedPaths = new Map<KnowledgeBundleEntryID, KnowledgeBundlePath>()
		try {
			for (const entry of movingEntries) {
				const nextPath =
					entry.path === oldPath
						? destinationPath
						: (`${destinationPath}${entry.path.slice(oldPath.length)}` as KnowledgeBundlePath)
				plannedPaths.set(entry.id, canonicalPath(nextPath))
			}
		} catch (error) {
			return invalidPathFailure(error)
		}

		const sourceParent = current.parentPath === null ? undefined : this.#entryAt(current.parentPath)
		for (const entry of movingEntries) {
			this.#entryIDsByPath.delete(entry.path)
		}
		const modifiedAt = this.#now()
		for (const entry of movingEntries) {
			const nextPath = plannedPaths.get(entry.id)
			if (!nextPath) {
				throw new Error(`Missing planned path for entry ${entry.id}.`)
			}
			entry.path = nextPath
			entry.name = pathName(nextPath)
			entry.parentPath = parentPath(nextPath)
			entry.revision = this.#newRevision()
			entry.modifiedAt = modifiedAt
			this.#entryIDsByPath.set(entry.path, entry.id)
		}
		if (sourceParent?.kind === 'directory') {
			this.#touch(sourceParent)
		}
		if (destinationParent.directory.id !== sourceParent?.id) {
			this.#touch(destinationParent.directory)
		}

		return {
			ok: true,
			value: { status: 'moved', entry: publicEntry(current) }
		}
	}

	async deleteEntry(
		input: DeleteKnowledgeBundleEntryInput
	): Promise<DeleteKnowledgeBundleEntryResult> {
		let locator: KnowledgeBundleEntryLocator
		try {
			locator = parseLocator(input)
		} catch (error) {
			return invalidPathFailure(error)
		}

		const current = this.#resolve(locator)
		if (!current) {
			return mutationFailure('not_found', 'The entry no longer exists.')
		}
		if (current.path === '/') {
			return mutationFailure('unsupported', 'The bundle root cannot be deleted.')
		}
		if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
			return mutationFailure(
				'revision_conflict',
				'The entry revision changed.',
				publicEntry(current)
			)
		}
		if (
			current.kind === 'directory' &&
			[...this.#entriesByID.values()].some((entry) => entry.parentPath === current.path)
		) {
			return mutationFailure('not_empty', 'The directory is not empty.', publicDirectory(current))
		}

		const deleted = publicEntry(current)
		this.#entriesByID.delete(current.id)
		this.#entryIDsByPath.delete(current.path)
		if (current.parentPath !== null) {
			const parent = this.#entryAt(current.parentPath)
			if (parent?.kind === 'directory') {
				this.#touch(parent)
			}
		}
		return { ok: true, value: { entry: deleted } }
	}

	#seed(): void {
		this.#store(this.#newDirectory('/'))
		this.#store(this.#newFile('/welcome.md', welcomeMarkdown, 'text/markdown'))
		this.#store(this.#newDirectory('/guides'))
		this.#store(
			this.#newFile('/guides/getting-started.md', gettingStartedMarkdown, 'text/markdown')
		)
		this.#store(this.#newDirectory('/reference'))
		this.#store(this.#newFile('/reference/rpc.md', rpcReferenceMarkdown, 'text/markdown'))
	}

	#newDirectory(path: KnowledgeBundlePath): StoredDirectory {
		return {
			kind: 'directory',
			id: this.#newEntryID(),
			path,
			name: pathName(path),
			parentPath: parentPath(path),
			revision: this.#newRevision(),
			modifiedAt: this.#now()
		}
	}

	#newFile(path: KnowledgeBundlePath, content: string, mediaType?: string): StoredFile {
		const effectiveMediaType = mediaType ?? inferredMediaType(path)
		return {
			kind: 'file',
			id: this.#newEntryID(),
			path,
			name: pathName(path),
			parentPath: parentPath(path),
			revision: this.#newRevision(),
			modifiedAt: this.#now(),
			content,
			byteLength: utf8Length(content),
			contentHash: hashContent(content),
			...(effectiveMediaType === undefined ? {} : { mediaType: effectiveMediaType })
		}
	}

	#store(entry: StoredEntry): void {
		this.#entriesByID.set(entry.id, entry)
		this.#entryIDsByPath.set(entry.path, entry.id)
	}

	#entryAt(path: KnowledgeBundlePath): StoredEntry | undefined {
		const id = this.#entryIDsByPath.get(path)
		return id === undefined ? undefined : this.#entriesByID.get(id)
	}

	#resolve(locator: KnowledgeBundleEntryLocator): StoredEntry | undefined {
		if (locator.id !== undefined) {
			return this.#entriesByID.get(locator.id)
		}
		return this.#entryAt(locator.path)
	}

	#creationParent(
		path: KnowledgeBundlePath
	):
		| { readonly ok: true; readonly directory: StoredDirectory }
		| { readonly ok: false; readonly result: MutationFailure } {
		const candidatePath = parentPath(path)
		if (candidatePath === null) {
			return {
				ok: false,
				result: mutationFailure('invalid_path', 'The bundle root cannot be replaced.')
			}
		}
		const candidate = this.#entryAt(candidatePath)
		if (!candidate) {
			return {
				ok: false,
				result: mutationFailure('not_found', `Parent directory ${candidatePath} does not exist.`)
			}
		}
		if (candidate.kind !== 'directory') {
			return {
				ok: false,
				result: mutationFailure(
					'not_a_directory',
					`Parent entry ${candidatePath} is not a directory.`,
					publicEntry(candidate)
				)
			}
		}
		return { ok: true, directory: candidate }
	}

	#touch(entry: StoredEntry): void {
		entry.revision = this.#newRevision()
		entry.modifiedAt = this.#now()
	}

	#newEntryID(): KnowledgeBundleEntryID {
		return `entry-${String(this.#nextEntryID++).padStart(6, '0')}`
	}

	#newRevision(): KnowledgeBundleEntryRevision {
		return `revision-${String(this.#nextRevision++).padStart(8, '0')}`
	}

	#now(): string {
		this.#lastModifiedTime = Math.max(Date.now(), this.#lastModifiedTime + 1)
		return new Date(this.#lastModifiedTime).toISOString()
	}
}

function parseLocator(input: unknown): KnowledgeBundleEntryLocator {
	const locator = v.safeParse(LocatorSchema, input)
	if (!locator.success) {
		throw new InvalidBundlePathError('A locator object with a canonical path is required.')
	}
	return {
		...locator.output,
		path: canonicalPath(locator.output.path)
	}
}

function canonicalPath(value: unknown): KnowledgeBundlePath {
	const path = v.safeParse(CanonicalPathSchema, value, { abortEarly: true })
	if (!path.success) {
		throw new InvalidBundlePathError(path.issues[0].message)
	}
	return path.output as KnowledgeBundlePath
}

function parentPath(path: KnowledgeBundlePath): KnowledgeBundlePath | null {
	if (path === '/') {
		return null
	}
	const separator = path.lastIndexOf('/')
	return separator === 0 ? '/' : (path.slice(0, separator) as KnowledgeBundlePath)
}

function pathName(path: KnowledgeBundlePath): string {
	return path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1)
}

function descendantDepth(
	directoryPath: KnowledgeBundlePath,
	candidatePath: KnowledgeBundlePath
): number | null {
	const prefix = directoryPath === '/' ? '/' : `${directoryPath}/`
	if (candidatePath === directoryPath || !candidatePath.startsWith(prefix)) {
		return null
	}
	return candidatePath.slice(prefix.length).split('/').length
}

function compareStoredEntries(left: StoredEntry, right: StoredEntry): number {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

function publicEntry(entry: StoredEntry): KnowledgeBundleEntry {
	return entry.kind === 'directory' ? publicDirectory(entry) : publicFileEntry(entry)
}

function publicDirectory(entry: StoredDirectory): KnowledgeBundleDirectoryEntry {
	return {
		kind: 'directory',
		id: entry.id,
		path: entry.path,
		name: entry.name,
		parentPath: entry.parentPath,
		revision: entry.revision,
		modifiedAt: entry.modifiedAt
	}
}

function publicFileEntry(entry: StoredFile): KnowledgeBundleFileEntry {
	return {
		kind: 'file',
		id: entry.id,
		path: entry.path,
		name: entry.name,
		parentPath: entry.parentPath,
		revision: entry.revision,
		modifiedAt: entry.modifiedAt,
		byteLength: entry.byteLength,
		contentHash: entry.contentHash,
		documentAccess: 'writable',
		...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType })
	}
}

function publicFile(file: StoredFile): KnowledgeBundleFile {
	return { ...publicFileEntry(file), content: file.content }
}

function mutationFailure(
	code: KnowledgeBundleMutationError['code'],
	message: string,
	current?: KnowledgeBundleEntry,
	editNumber?: number
): MutationFailure {
	return {
		ok: false,
		error: {
			code,
			message,
			...(editNumber === undefined ? {} : { editNumber }),
			...(current === undefined ? {} : { current })
		}
	}
}

function exactTextPatchFailure(error: ExactTextPatchError, current: StoredFile): MutationFailure {
	const code =
		error.reason === 'not_found'
			? 'patch_not_found'
			: error.reason === 'ambiguous'
				? 'patch_ambiguous'
				: error.reason === 'too_many_edits' || error.reason === 'too_large'
					? 'too_large'
					: 'invalid_patch'
	return mutationFailure(
		code,
		error.message,
		publicFileEntry(current),
		error.editNumber ?? undefined
	)
}

function invalidPathFailure(error: unknown): MutationFailure {
	if (!(error instanceof InvalidBundlePathError)) {
		throw error
	}
	return mutationFailure('invalid_path', error.message)
}

function validateFileContentInput(input: unknown):
	| {
			readonly ok: true
			readonly value: v.InferOutput<typeof FileContentInputSchema>
	  }
	| MutationFailure {
	const result = v.safeParse(FileContentInputSchema, input, {
		abortEarly: true
	})
	return result.success
		? { ok: true, value: result.output }
		: mutationFailure('unsupported', result.issues[0].message)
}

function parsePatchEdits(input: unknown): readonly KnowledgeBundleTextEdit[] {
	const result = v.safeParse(PatchEditsSchema, input, { abortEarly: true })
	if (result.success) {
		return result.output
	}
	const editIndex = result.issues[0].path?.[0]?.key
	throw new ExactTextPatchError(
		typeof editIndex === 'number' ? editIndex + 1 : null,
		typeof editIndex === 'number' ? 'invalid_edit' : 'empty_patch'
	)
}

function assertDepth(depth: unknown): asserts depth is number {
	if (!v.is(ListingDepthSchema, depth)) {
		throw new RangeError('Listing depth must be a non-negative integer.')
	}
}

function assertLimit(limit: unknown): asserts limit is number | undefined {
	if (!v.is(OptionalPositiveIntegerSchema, limit)) {
		throw new RangeError('Listing limit must be a positive integer.')
	}
}

function assertMaximumBytes(value: unknown): asserts value is number | undefined {
	if (!v.is(OptionalPositiveIntegerSchema, value)) {
		throw new RangeError('The maximum byte count must be a positive integer.')
	}
}

function inferredMediaType(path: KnowledgeBundlePath): string | undefined {
	const lowerPath = path.toLowerCase()
	if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
		return 'text/markdown'
	}
	if (lowerPath.endsWith('.txt')) {
		return 'text/plain'
	}
	if (lowerPath.endsWith('.json')) {
		return 'application/json'
	}
	if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
		return 'application/yaml'
	}
	return undefined
}

function utf8Length(value: string): number {
	return textEncoder.encode(value).byteLength
}

function hashContent(content: string): KnowledgeBundleContentHash {
	return new Bun.CryptoHasher('sha256').update(content).digest('hex')
}
