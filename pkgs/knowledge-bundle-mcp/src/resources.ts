import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/server'
import * as v from 'valibot'
import { readKnowledgeDocument, VisibleBundlePathSchema } from './bundle-access'
import { readBundleMetadata, resolveWorkspaceGrant, type SessionGrant } from './grant'
import { runResource } from './mcp-response'

const TemplateVariableSchema = v.string()

export function registerKnowledgeResources(
	server: McpServer,
	grants: ReadonlyMap<string, SessionGrant>
): void {
	for (const grant of grants.values()) {
		server.registerResource(
			`knowledge-bundle-overview-${grant.reference}`,
			`knowledge://workspace/${grant.reference}/overview`,
			{
				title: `${grant.label} overview`,
				description: 'A filesystem-root-free summary of an authorized knowledge workspace.',
				mimeType: 'application/json'
			},
			async (uri) =>
				runResource(async () => {
					const metadata = await readBundleMetadata(grant)
					return {
						contents: [
							{
								uri: uri.href,
								mimeType: 'application/json',
								text: JSON.stringify(
									{
										workspace_ref: grant.reference,
										label: grant.label,
										access: grant.access,
										metadata
									},
									null,
									2
								)
							}
						]
					}
				}, 'The knowledge bundle overview could not be read.')
		)
	}

	server.registerResource(
		'knowledge-document',
		new ResourceTemplate('knowledge://workspace/{workspace_ref}/document/{path}', {
			list: undefined
		}),
		{
			title: 'Knowledge document',
			description:
				'Current source or converted Markdown for a canonical absolute file path in an authorized workspace.',
			mimeType: 'text/markdown'
		},
		async (uri, variables, ctx) =>
			runResource(async () => {
				const workspaceRef = decodeTemplateVariable(variables.workspace_ref)
				const encodedPath = decodeTemplateVariable(variables.path)
				const parsedPath = v.safeParse(VisibleBundlePathSchema, encodedPath)
				if (!parsedPath.success) {
					throw new Error('The knowledge document path is invalid.')
				}
				const grant = resolveWorkspaceGrant(grants, workspaceRef)
				const document = await readKnowledgeDocument(
					grant,
					{ path: parsedPath.output },
					ctx.mcpReq.signal
				)
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: 'text/markdown',
							text: document.markdown
						}
					]
				}
			}, 'The knowledge document resource could not be read.')
	)
}

function decodeTemplateVariable(value: string | string[] | undefined): string {
	const parsed = v.safeParse(TemplateVariableSchema, value)
	if (!parsed.success) {
		throw new Error('The knowledge resource is invalid.')
	}
	try {
		return decodeURIComponent(parsed.output)
	} catch {
		throw new Error('The knowledge resource is invalid.')
	}
}
