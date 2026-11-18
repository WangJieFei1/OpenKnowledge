import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server'
import * as v from 'valibot'
import { MarkdownDocumentPathSchema, VisibleBundlePathSchema } from './bundle-access'
import {
	MCPWorkspaceSearchUnavailableError,
	resolveWorkspaceGrant,
	type SessionGrant,
	WorkspaceReferenceInputSchema
} from './grant'
import { runTool } from './mcp-response'
import { mcpSchema } from './mcp-schema'

const maximumSearchQueryCharacters = 1_000
const maximumSearchResults = 200
const maximumSearchPreviewCharacters = 1_000
const maximumGlobCharacters = 256
const maximumGlobs = 16

const readOnlyAnnotations: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
}

const SearchMatchOutputSchema = v.object({
	path: MarkdownDocumentPathSchema,
	line_number: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
	column_number: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
	preview: v.pipe(v.string(), v.maxLength(maximumSearchPreviewCharacters)),
	match: v.pipe(v.string(), v.maxLength(maximumSearchPreviewCharacters)),
	representation: v.literal('source_markdown'),
	document_access: v.picklist(['writable', 'readonly'])
})

const SearchOutputSchema = v.object({
	workspace_ref: v.string(),
	matches: v.pipe(v.array(SearchMatchOutputSchema), v.maxLength(maximumSearchResults)),
	truncated: v.boolean()
})

export function registerSearchTools(
	server: McpServer,
	grants: ReadonlyMap<string, SessionGrant>
): void {
	server.registerTool(
		'knowledge_search',
		{
			title: 'Search knowledge workspace',
			description:
				'Searches native Markdown source in one authorized knowledge workspace with ripgrep. Use this before broad directory listings or document reads when locating concepts, phrases, identifiers, or references. Results are bounded matching lines with canonical bundle paths, 1-based line and UTF-8 byte columns, source_markdown representation, and effective document_access; call knowledge_get_excerpt with a result path and line range to inspect context, or knowledge_get_document when the full source is needed. Queries use ripgrep Rust regex syntax by default; set fixed_strings for literal text. Narrow with path and exclude_globs. Search respects workspace ignore rules, does not follow symlinks, and may report truncated results. Converted and not_supported files are not searched because their source bytes are not exposed.',
			inputSchema: mcpSchema(
				v.object({
					workspace_ref: WorkspaceReferenceInputSchema,
					query: v.pipe(
						v.string(),
						v.minLength(1),
						v.maxLength(maximumSearchQueryCharacters),
						v.check((value) => Boolean(value.trim()), 'Search queries cannot be blank.'),
						v.check((value) => !value.includes('\0'), 'Search queries cannot contain NUL.'),
						v.description(
							'Rust regex to search for, or exact text when fixed_strings is true. Do not add surrounding slash delimiters.'
						)
					),
					case_mode: v.pipe(
						v.optional(v.picklist(['smart', 'sensitive', 'insensitive']), 'smart'),
						v.description(
							'Case handling. smart ignores case only when query has no uppercase letters; sensitive and insensitive are explicit.'
						)
					),
					fixed_strings: v.pipe(
						v.optional(v.boolean(), false),
						v.description(
							'Treat query as literal text instead of regex syntax. Prefer true for exact phrases or punctuation-heavy text.'
						)
					),
					whole_word: v.pipe(
						v.optional(v.boolean(), false),
						v.description('Require each match to be bounded by word boundaries.')
					),
					path: v.pipe(
						v.optional(VisibleBundlePathSchema, '/'),
						v.description(
							'Canonical absolute directory path to search within. Use / for the whole workspace.'
						)
					),
					exclude_globs: v.pipe(
						v.optional(
							v.pipe(
								v.array(
									v.pipe(
										v.string(),
										v.minLength(1),
										v.maxLength(maximumGlobCharacters),
										v.check((value) => !value.includes('\0'), 'Search globs cannot contain NUL.'),
										v.check(
											(value) => !value.startsWith('!'),
											'Do not prefix exclusion globs with !.'
										)
									)
								),
								v.maxLength(maximumGlobs)
							),
							[]
						),
						v.description(
							'Optional workspace-relative ripgrep globs to exclude, such as **/drafts/** or /notes/archive/**. Do not prefix them with !.'
						)
					),
					limit: v.pipe(
						v.optional(
							v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(maximumSearchResults)),
							50
						),
						v.description(
							`Maximum matching lines to return, from 1 to ${maximumSearchResults}. Lower this for broad queries.`
						)
					)
				})
			),
			outputSchema: mcpSchema(SearchOutputSchema),
			annotations: readOnlyAnnotations
		},
		async (
			{ workspace_ref, query, case_mode, fixed_strings, whole_word, path, exclude_globs, limit },
			ctx
		) =>
			runTool(async () => {
				const grant = resolveWorkspaceGrant(grants, workspace_ref)
				if (!grant.search) {
					throw new MCPWorkspaceSearchUnavailableError()
				}
				const result = await grant.search(
					{
						query,
						caseMode: case_mode,
						fixedStrings: fixed_strings,
						wholeWord: whole_word,
						path,
						excludeGlobs: exclude_globs,
						limit
					},
					ctx.mcpReq.signal
				)
				return {
					workspace_ref: grant.reference,
					matches: result.matches.map(
						({
							path,
							lineNumber,
							columnNumber,
							preview,
							match,
							representation,
							documentAccess
						}) => ({
							path,
							line_number: lineNumber,
							column_number: columnNumber,
							preview,
							match,
							representation,
							document_access: grant.access === 'readonly' ? 'readonly' : documentAccess
						})
					),
					truncated: result.truncated
				}
			}, 'The knowledge workspace could not be searched.')
	)
}
