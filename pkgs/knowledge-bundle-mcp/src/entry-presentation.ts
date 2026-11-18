import type {
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntry,
	KnowledgeBundleFileEntry
} from '@open-knowledge/knowledge-bundle-api'
import * as v from 'valibot'
import { effectiveDocumentAccess } from './bundle-access'
import type { SessionGrant } from './grant'

const entryOutputBaseShape = {
	id: v.string(),
	path: v.string(),
	name: v.string(),
	parent_path: v.nullable(v.string()),
	revision: v.string(),
	modified_at: v.string()
}

export const DirectoryOutputSchema = v.object({
	...entryOutputBaseShape,
	kind: v.literal('directory')
})

export const FileMetadataOutputSchema = v.object({
	...entryOutputBaseShape,
	kind: v.literal('file'),
	byte_length: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
	content_hash: v.string(),
	media_type: v.optional(v.string()),
	document_access: v.picklist(['writable', 'readonly', 'not_supported'])
})

export const EntryOutputSchema = v.variant('kind', [
	DirectoryOutputSchema,
	FileMetadataOutputSchema
])

export function directoryOutput(
	directory: KnowledgeBundleDirectoryEntry
): v.InferOutput<typeof DirectoryOutputSchema> {
	return {
		kind: 'directory',
		id: directory.id,
		path: directory.path,
		name: directory.name,
		parent_path: directory.parentPath,
		revision: directory.revision,
		modified_at: directory.modifiedAt
	}
}

export function fileMetadataOutput(
	file: KnowledgeBundleFileEntry,
	grant: SessionGrant
): v.InferOutput<typeof FileMetadataOutputSchema> {
	return {
		kind: 'file',
		id: file.id,
		path: file.path,
		name: file.name,
		parent_path: file.parentPath,
		revision: file.revision,
		modified_at: file.modifiedAt,
		byte_length: file.byteLength,
		content_hash: file.contentHash,
		document_access: effectiveDocumentAccess(grant, file),
		...(file.mediaType === undefined ? {} : { media_type: file.mediaType })
	}
}

export function entryOutput(
	entry: KnowledgeBundleEntry,
	grant: SessionGrant
): v.InferOutput<typeof EntryOutputSchema> {
	return entry.kind === 'directory' ? directoryOutput(entry) : fileMetadataOutput(entry, grant)
}
