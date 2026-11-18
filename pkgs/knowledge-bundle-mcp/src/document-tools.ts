import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server'
import type { KnowledgeBundleFileEntry } from '@open-knowledge/knowledge-bundle-api'
import {
	isWellFormedText,
	maximumExactTextPatchCharacters,
	maximumExactTextPatchEdits
} from '@open-knowledge/knowledge-bundle-patch'
import * as v from 'valibot'
import {
	ContentHashSchema,
	createMarkdownDocument,
	EntryIDSchema,
	MarkdownDocumentPathSchema,
	maximumDocumentBytes,
	patchDocument,
	readKnowledgeDocument,
	RevisionSchema,
	VisibleBundlePathSchema,
	writeDocument
} from './bundle-access'
import { fileMetadataOutput, FileMetadataOutputSchema } from './entry-presentation'
import {
	resolveEditableBundle,
	resolveWorkspaceGrant,
	type SessionGrant,
	WorkspaceReferenceInputSchema
} from './grant'
import { runDocumentTool, runTool } from './mcp-response'
import { mcpSchema } from './mcp-schema'

const readOnlyAnnotations: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
}

const editAnnotations: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false
}

const createAnnotations: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
}

const EntryIDInputSchema = v.pipe(
	v.optional(EntryIDSchema),
	v.description(
		'Stable bundle-scoped ID returned by an earlier list or read. When present, it is authoritative.'
	)
)
const PatchEditSchema = v.pipe(
	v.object({
		old_text: v.pipe(
			v.string(),
			v.minLength(1),
			v.maxLength(maximumExactTextPatchCharacters),
			v.check(isWellFormedText, 'old_text must contain valid Unicode.'),
			v.description(
				'Exact text to replace, including whitespace and enough surrounding context to match once.'
			)
		),
		new_text: v.pipe(
			v.string(),
			v.maxLength(maximumExactTextPatchCharacters),
			v.check(isWellFormedText, 'new_text must contain valid Unicode.'),
			v.description(
				'Replacement text, which must differ from old_text. Use an empty string to delete the match.'
			)
		)
	}),
	v.check(({ old_text, new_text }) => old_text !== new_text, 'old_text and new_text must differ.')
)

const PatchEditsSchema = v.pipe(
	v.array(PatchEditSchema),
	v.minLength(1),
	v.maxLength(maximumExactTextPatchEdits),
	v.check(
		(edits) =>
			edits.reduce(
				(total, { old_text, new_text }) => total + old_text.length + new_text.length,
				0
			) <= maximumExactTextPatchCharacters,
		`Patch text cannot exceed ${maximumExactTextPatchCharacters} characters.`
	)
)

const DocumentOutputSchema = v.object({
	workspace_ref: v.string(),
	...FileMetadataOutputSchema.entries,
	representation: v.picklist(['source_markdown', 'converted_markdown']),
	markdown_byte_length: v.pipe(v.number(), v.safeInteger(), v.minValue(0))
})

const WriteDocumentOutputSchema = v.object({
	workspace_ref: v.string(),
	status: v.picklist(['updated', 'unchanged']),
	...FileMetadataOutputSchema.entries
})

const CreateDocumentOutputSchema = v.object({
	workspace_ref: v.string(),
	...FileMetadataOutputSchema.entries
})

const PatchDocumentOutputSchema = v.object({
	workspace_ref: v.string(),
	status: v.picklist(['patched', 'unchanged']),
	...FileMetadataOutputSchema.entries,
	applied_edits: v.pipe(v.number(), v.safeInteger(), v.minValue(1))
})

export function registerDocumentTools(
	server: McpServer,
	grants: ReadonlyMap<string, SessionGrant>,
	hasEditableWorkspace: boolean
): void {
	server.registerTool(
		'knowledge_get_document',
		{
			title: 'Read a knowledge document',
			description: `Returns bounded Markdown plus source-file identity and metadata. Native Markdown is returned directly; supported read-only document formats may be converted to Markdown by the host. representation identifies the returned form, markdown_byte_length describes the representation, and byte_length plus content_hash describe the source file. Pass id with the required last-known absolute path to follow relocation. Returned Markdown larger than ${maximumDocumentBytes} bytes is rejected.`,
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema,
					id: EntryIDInputSchema,
					path: v.pipe(
						VisibleBundlePathSchema,
						v.description('Last-known canonical absolute file path.')
					)
				})
			),
			outputSchema: mcpSchema(DocumentOutputSchema),
			annotations: readOnlyAnnotations
		},
		async ({ workspace_ref, id, path }, ctx) =>
			runDocumentTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				const document = await readKnowledgeDocument(grant, { id, path }, ctx.mcpReq.signal)
				return {
					metadata: documentOutput(document, grant),
					markdown: document.markdown
				}
			}, 'The knowledge document could not be read.')
	)

	if (!hasEditableWorkspace) {
		return
	}

	server.registerTool(
		'knowledge_create_document',
		{
			title: 'Create a Markdown knowledge document',
			description: `Creates exactly one UTF-8 Markdown document at a new path inside an editable knowledge workspace. The path is bundle-scoped: \`/notes/plan.md\` means that location under the selected workspace, never an operating-system path. It must end in .md, its immediate parent must already exist, and the target must be unused. This tool does not create missing parents or replace an entry; use knowledge_patch_document or knowledge_update_document for an existing document. Markdown is limited to ${maximumDocumentBytes} UTF-8 bytes. Returns compact identity metadata without echoing the Markdown; retain the id and canonical path for later calls.`,
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema,
					path: v.pipe(
						MarkdownDocumentPathSchema,
						v.description(
							'Canonical absolute bundle path for the new Markdown document. It must end in .md; the immediate parent must exist and the target path must be unused.'
						)
					),
					markdown: v.pipe(
						v.string(),
						v.maxBytes(maximumDocumentBytes),
						v.check(isWellFormedText, 'markdown must contain valid Unicode.'),
						v.description(
							`Complete initial Markdown source. May be empty; its UTF-8 encoding must not exceed ${maximumDocumentBytes} bytes.`
						)
					)
				})
			),
			outputSchema: mcpSchema(CreateDocumentOutputSchema),
			annotations: createAnnotations
		},
		async ({ workspace_ref, path, markdown }) =>
			runTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				const editableBundle = resolveEditableBundle(grant)
				const file = await createMarkdownDocument(editableBundle, path, markdown)
				return {
					workspace_ref: grant.reference,
					...fileMetadataOutput(file, grant)
				}
			}, 'The knowledge document could not be created.')
	)

	server.registerTool(
		'knowledge_patch_document',
		{
			title: 'Patch knowledge document',
			description: `Applies sequential exact-text replacements to an editable Markdown document under revision and content-hash preconditions. Each old_text must match exactly once at its turn. Include more surrounding text when a match is repeated. Use an empty new_text to delete; to insert, replace a unique anchor with itself plus the inserted text. Supports at most ${maximumExactTextPatchEdits} edits and ${maximumExactTextPatchCharacters} combined old/new characters. The bundle applies the patch atomically without retransmitting the full document. Returns compact metadata; retain its id and canonical path for the next call.`,
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema,
					id: EntryIDInputSchema,
					path: v.pipe(
						MarkdownDocumentPathSchema,
						v.description('Last-known canonical absolute Markdown path.')
					),
					expected_revision: v.pipe(
						RevisionSchema,
						v.description('Revision returned by the latest list or read.')
					),
					expected_content_hash: v.pipe(
						ContentHashSchema,
						v.description('Content hash returned by the latest read.')
					),
					edits: v.pipe(
						PatchEditsSchema,
						v.description(
							`One to ${maximumExactTextPatchEdits} exact replacements with at most ${maximumExactTextPatchCharacters} combined old/new characters, applied atomically and in array order.`
						)
					)
				})
			),
			outputSchema: mcpSchema(PatchDocumentOutputSchema),
			annotations: editAnnotations
		},
		async ({ workspace_ref, id, path, expected_revision, expected_content_hash, edits }) =>
			runTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				const editableBundle = resolveEditableBundle(grant)
				const patched = await patchDocument(
					editableBundle,
					{ id, path },
					expected_revision,
					expected_content_hash,
					edits.map(({ old_text, new_text }) => ({
						oldText: old_text,
						newText: new_text
					}))
				)
				return patchDocumentOutput(patched.file, grant, patched.status, edits.length)
			}, 'The knowledge document could not be patched.')
	)

	server.registerTool(
		'knowledge_update_document',
		{
			title: 'Update a knowledge document',
			description:
				'Replaces an entire Markdown document under required revision and content-hash preconditions. Pass id with the last-known absolute path; the result reports the canonical path after any relocation. Prefer knowledge_patch_document for targeted changes or large documents.',
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema,
					id: EntryIDInputSchema,
					path: v.pipe(
						MarkdownDocumentPathSchema,
						v.description('Last-known canonical absolute Markdown path.')
					),
					expected_revision: v.pipe(
						RevisionSchema,
						v.description('Revision returned by the latest list or read.')
					),
					expected_content_hash: v.pipe(
						ContentHashSchema,
						v.description('Content hash returned by the latest read.')
					),
					markdown: v.pipe(
						v.string(),
						v.maxBytes(maximumDocumentBytes),
						v.check(isWellFormedText, 'markdown must contain valid Unicode.')
					)
				})
			),
			outputSchema: mcpSchema(WriteDocumentOutputSchema),
			annotations: editAnnotations
		},
		async ({ workspace_ref, id, path, expected_revision, expected_content_hash, markdown }) =>
			runTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				const editableBundle = resolveEditableBundle(grant)
				const written = await writeDocument(
					editableBundle,
					{ id, path },
					expected_revision,
					expected_content_hash,
					markdown
				)
				return writeDocumentOutput(written.file, grant, written.status)
			}, 'The knowledge document could not be updated.')
	)
}

function documentOutput(
	document: Awaited<ReturnType<typeof readKnowledgeDocument>>,
	grant: SessionGrant
): v.InferOutput<typeof DocumentOutputSchema> {
	return {
		workspace_ref: grant.reference,
		...fileMetadataOutput(document.file, grant),
		representation: document.representation,
		markdown_byte_length: document.markdownByteLength
	}
}

function writeDocumentOutput(
	file: KnowledgeBundleFileEntry,
	grant: SessionGrant,
	status: 'updated' | 'unchanged'
): v.InferOutput<typeof WriteDocumentOutputSchema> {
	return {
		workspace_ref: grant.reference,
		status,
		...fileMetadataOutput(file, grant)
	}
}

function patchDocumentOutput(
	file: KnowledgeBundleFileEntry,
	grant: SessionGrant,
	status: 'patched' | 'unchanged',
	appliedEdits: number
): v.InferOutput<typeof PatchDocumentOutputSchema> {
	return {
		workspace_ref: grant.reference,
		status,
		...fileMetadataOutput(file, grant),
		applied_edits: appliedEdits
	}
}
