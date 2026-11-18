import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server'
import * as v from 'valibot'
import {
	createBundleDirectory,
	CreatableDirectoryPathSchema,
	EntryIDSchema,
	listBundleEntries,
	maximumBundleEntries,
	VisibleBundlePathSchema
} from './bundle-access'
import {
	directoryOutput,
	DirectoryOutputSchema,
	entryOutput,
	EntryOutputSchema
} from './entry-presentation'
import {
	resolveEditableBundle,
	resolveWorkspaceGrant,
	type SessionGrant,
	WorkspaceReferenceInputSchema
} from './grant'
import { runTool } from './mcp-response'
import { mcpSchema } from './mcp-schema'

const maximumListingDepth = 100

const readOnlyAnnotations: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
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

const ListEntriesOutputSchema = v.object({
	workspace_ref: v.string(),
	depth: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
	directory: DirectoryOutputSchema,
	entries: v.array(EntryOutputSchema),
	truncated: v.boolean()
})

const CreateDirectoryOutputSchema = v.object({
	workspace_ref: v.string(),
	...DirectoryOutputSchema.entries
})

export function registerEntryTools(
	server: McpServer,
	grants: ReadonlyMap<string, SessionGrant>,
	hasEditableWorkspace: boolean
): void {
	server.registerTool(
		'knowledge_list_entries',
		{
			title: 'List knowledge entries',
			description: `Lists bounded descendants of a canonical absolute directory path. File entries include document_access: writable files may be updated, readonly files may be read but not changed, and not_supported files expose metadata only. Pass a previously returned directory id with its last-known path to follow relocation safely. Depth defaults to one; at most ${maximumBundleEntries} entries are returned.`,
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema,
					id: EntryIDInputSchema,
					path: v.pipe(
						VisibleBundlePathSchema,
						v.description(
							'Last-known canonical absolute directory path. Use / for the bundle root.'
						)
					),
					depth: v.pipe(
						v.optional(
							v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(maximumListingDepth)),
							1
						),
						v.description('Maximum descendant depth; one lists immediate children.')
					),
					limit: v.pipe(
						v.optional(
							v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(maximumBundleEntries)),
							maximumBundleEntries
						),
						v.description(`Maximum returned entries, capped at ${maximumBundleEntries}.`)
					)
				})
			),
			outputSchema: mcpSchema(ListEntriesOutputSchema),
			annotations: readOnlyAnnotations
		},
		async ({ workspace_ref, id, path, depth, limit }) =>
			runTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				const listing = await listBundleEntries(grant, { id, path }, depth, limit)
				return {
					workspace_ref: grant.reference,
					depth,
					directory: directoryOutput(listing.directory),
					entries: listing.entries.map((entry) => entryOutput(entry, grant)),
					truncated: listing.truncated
				}
			}, 'The knowledge entries could not be listed.')
	)

	if (!hasEditableWorkspace) {
		return
	}

	server.registerTool(
		'knowledge_create_directory',
		{
			title: 'Create a knowledge directory',
			description:
				"Creates exactly one empty directory at a new path inside an editable knowledge workspace. The path is bundle-scoped: `/projects/alpha` means that location under the selected workspace, never an operating-system path. Its immediate parent must already exist and the target must be unused; this tool does not create missing parents or replace any file or directory. Use knowledge_list_entries on the parent when unsure. Returns the created directory's stable id and canonical path; retain both for later calls.",
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema,
					path: v.pipe(
						CreatableDirectoryPathSchema,
						v.description(
							'Canonical absolute bundle path for the new directory. / is invalid; the immediate parent must exist and the target path must be unused.'
						)
					)
				})
			),
			outputSchema: mcpSchema(CreateDirectoryOutputSchema),
			annotations: createAnnotations
		},
		async ({ workspace_ref, path }) =>
			runTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				const editableBundle = resolveEditableBundle(grant)
				const directory = await createBundleDirectory(editableBundle, path)
				return {
					workspace_ref: grant.reference,
					...directoryOutput(directory)
				}
			}, 'The knowledge directory could not be created.')
	)
}
