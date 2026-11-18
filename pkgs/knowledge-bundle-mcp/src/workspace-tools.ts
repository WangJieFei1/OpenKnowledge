import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server'
import * as v from 'valibot'
import {
	readBundleMetadata,
	resolveWorkspaceGrant,
	type SessionGrant,
	WorkspaceReferenceInputSchema
} from './grant'
import { runTool } from './mcp-response'
import { mcpSchema } from './mcp-schema'

const readOnlyAnnotations: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
}

const AccessSchema = v.picklist(['readonly', 'editable'])

const WorkspaceListOutputSchema = v.object({
	workspaces: v.array(
		v.object({
			workspace_ref: v.string(),
			label: v.string(),
			access: AccessSchema
		})
	)
})

const BundleInfoOutputSchema = v.object({
	workspace_ref: v.string(),
	label: v.string(),
	access: AccessSchema,
	metadata: v.unknown()
})

export function registerWorkspaceTools(
	server: McpServer,
	grants: ReadonlyMap<string, SessionGrant>
): void {
	server.registerTool(
		'knowledge_list_workspaces',
		{
			title: 'List knowledge workspaces',
			description:
				'Lists the workspaces authorized for this session as opaque references, labels, and explicit access grants.',
			outputSchema: mcpSchema(WorkspaceListOutputSchema),
			annotations: readOnlyAnnotations
		},
		async () =>
			runTool(
				async () => ({
					workspaces: [...grants.values()].map(({ reference, label, access }) => ({
						workspace_ref: reference,
						label,
						access
					}))
				}),
				'The knowledge workspaces could not be listed.'
			)
	)

	server.registerTool(
		'knowledge_bundle_info',
		{
			title: 'Knowledge bundle information',
			description:
				'Returns pass-by-value metadata and access information for an authorized knowledge workspace.',
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema
				})
			),
			outputSchema: mcpSchema(BundleInfoOutputSchema),
			annotations: readOnlyAnnotations
		},
		async ({ workspace_ref }) =>
			runTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				const metadata = await readBundleMetadata(grant)
				return {
					workspace_ref: grant.reference,
					label: grant.label,
					access: grant.access,
					metadata
				}
			}, 'The knowledge bundle information could not be read.')
	)
}
