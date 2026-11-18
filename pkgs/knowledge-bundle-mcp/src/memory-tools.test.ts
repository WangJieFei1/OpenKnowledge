import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import type { ReadonlyKnowledgeBundle } from '@open-knowledge/knowledge-bundle-api'
import type {
	KnowledgeBundleMCPGrant,
	KnowledgeBundleMCPMemorySnapshot,
	KnowledgeBundleMCPMemorySource,
	KnowledgeBundleMCPSemanticRanker,
	SessionGrant
} from './grant'
import { registerMemoryTools } from './memory-tools'

const emptyBundle: ReadonlyKnowledgeBundle = {
	async getInfo() {
		return { access: 'readonly', metadata: { title: 'Memory fixture' } }
	},
	async list() {
		return null
	},
	async readFile() {
		return null
	}
}

function hash(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function snapshot(
	sessions: KnowledgeBundleMCPMemorySnapshot['sessions'],
	overrides: Partial<KnowledgeBundleMCPMemorySnapshot> = {}
): KnowledgeBundleMCPMemorySnapshot {
	return { sessions, complete: true, warnings: [], ...overrides }
}

function grant(reference: string, sessionMemory?: KnowledgeBundleMCPMemorySource): SessionGrant {
	const value: KnowledgeBundleMCPGrant = {
		reference,
		label: reference,
		access: 'readonly',
		bundle: emptyBundle,
		...(sessionMemory ? { sessionMemory } : {})
	}
	return value
}

async function connectedClient(grants: readonly SessionGrant[]) {
	const server = new McpServer({ name: 'memory-tools-test', version: '1.0.0' })
	registerMemoryTools(server, new Map(grants.map((item) => [item.reference, item])))
	const client = new Client({ name: 'memory-tools-client', version: '1.0.0' })
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await server.connect(serverTransport)
	await client.connect(clientTransport)
	return {
		client,
		async close() {
			await client.close()
			await server.close()
		}
	}
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>

function errorText(result: ToolResult): string {
	expect(result.isError).toBe(true)
	expect(result.content).toHaveLength(1)
	const content = result.content[0]
	if (content?.type !== 'text') throw new Error('Expected exactly one text error.')
	return content.text
}

function payload<Payload extends { budget_bytes: number; serialized_bytes: number }>(
	result: ToolResult,
	expectedBudget = 8000
): Payload {
	expect(result.isError).not.toBe(true)
	expect(result.structuredContent).toBeUndefined()
	expect(result.content).toHaveLength(1)
	const content = result.content[0]
	if (content?.type !== 'text') throw new Error('Expected exactly one JSON text response.')
	const decoded = JSON.parse(content.text) as Payload
	expect(content.text).toBe(JSON.stringify(decoded))
	expect(Buffer.byteLength(content.text, 'utf8')).toBeLessThanOrEqual(expectedBudget)
	expect(decoded.serialized_bytes).toBe(Buffer.byteLength(content.text, 'utf8'))
	expect(decoded.budget_bytes).toBe(expectedBudget)
	expect(decoded).toMatchObject({ source_content_is_untrusted: true })
	return decoded
}

describe('Codex session-memory MCP tools', () => {
	test('does not advertise memory tools while memory is disabled for every workspace', async () => {
		const connection = await connectedClient([grant('ws_disabled')])
		try {
			const listed = await connection.client.listTools()
			expect(listed.tools).toEqual([])
		} finally {
			await connection.close()
		}
	})

	test('advertises read-only tools but denies unknown and memory-disabled workspace scopes', async () => {
		let snapshotCalls = 0
		const memory: KnowledgeBundleMCPMemorySource = {
			async snapshot() {
				snapshotCalls++
				return snapshot([])
			}
		}
		const connection = await connectedClient([
			grant('ws_memory', memory),
			grant('ws_without_memory')
		])
		try {
			const listed = await connection.client.listTools()
			expect(listed.tools.map(({ name }) => name)).toEqual([
				'knowledge_list_memory_sessions',
				'knowledge_search_memory',
				'knowledge_get_memory_context'
			])
			for (const tool of listed.tools) {
				expect(tool.annotations).toMatchObject({
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false
				})
			}

			const unknown = await connection.client.callTool({
				name: 'knowledge_search_memory',
				arguments: { workspace_ref: 'ws_unknown', query: 'decision' }
			})
			expect(errorText(unknown)).toBe(
				'Session memory could not be read. Check the workspace authorization and retry.'
			)
			expect(JSON.stringify(unknown)).not.toContain('ws_unknown')

			const disabled = await connection.client.callTool({
				name: 'knowledge_list_memory_sessions',
				arguments: { workspace_ref: 'ws_without_memory' }
			})
			expect(errorText(disabled)).toBe('Codex session memory is not enabled for this workspace.')

			const ambiguous = await connection.client.callTool({
				name: 'knowledge_list_memory_sessions',
				arguments: {}
			})
			expect(errorText(ambiguous)).toBe(
				'Session memory could not be read. Check the workspace authorization and retry.'
			)
			expect(snapshotCalls).toBe(0)
		} finally {
			await connection.close()
		}
	})

	test('requires the exact session ID and a current anchor hash, then returns chronological context', async () => {
		const turns = [
			{ index: 4, role: 'user' as const, text: 'Earlier user context.' },
			{
				index: 9,
				role: 'assistant' as const,
				text: 'The approved decision is option B.',
				timestamp: '2026-09-18T02:03:04.000Z'
			},
			{ index: 15, role: 'user' as const, text: 'Later follow-up context.' }
		]
		const memory: KnowledgeBundleMCPMemorySource = {
			async snapshot() {
				return snapshot([
					{
						id: 'session_exact_123',
						timestamp: '2026-09-18T01:00:00.000Z',
						turns,
						warnings: []
					}
				])
			}
		}
		const connection = await connectedClient([grant('ws_memory', memory)])
		try {
			const prefix = await connection.client.callTool({
				name: 'knowledge_get_memory_context',
				arguments: {
					workspace_ref: 'ws_memory',
					session_id: 'session_exact',
					turn_index: 9
				}
			})
			expect(errorText(prefix)).toContain('session or turn is unavailable')

			const stale = await connection.client.callTool({
				name: 'knowledge_get_memory_context',
				arguments: {
					workspace_ref: 'ws_memory',
					session_id: 'session_exact_123',
					turn_index: 9,
					expected_content_hash: '0'.repeat(64)
				}
			})
			expect(errorText(stale)).toBe('The anchor turn changed. Search again before citing it.')

			const current = payload<{
				budget_bytes: number
				serialized_bytes: number
				session_id: string
				anchor_turn_index: number
				window_complete: boolean
				turns: Array<{
					turn_index: number
					text: string
					content_hash: string
					partial_text: boolean
				}>
			}>(
				await connection.client.callTool({
					name: 'knowledge_get_memory_context',
					arguments: {
						workspace_ref: 'ws_memory',
						session_id: 'session_exact_123',
						turn_index: 9,
						before: 1,
						after: 1,
						expected_content_hash: hash(turns[1]!.text)
					}
				})
			)
			expect(current).toMatchObject({
				session_id: 'session_exact_123',
				anchor_turn_index: 9,
				window_complete: true
			})
			expect(current.turns.map(({ turn_index }) => turn_index)).toEqual([4, 9, 15])
			expect(current.turns[1]).toMatchObject({
				text: turns[1]!.text,
				content_hash: hash(turns[1]!.text),
				partial_text: false
			})
		} finally {
			await connection.close()
		}
	})

	test('keeps the Unicode anchor and full-turn hash inside the minimum byte budget', async () => {
		const anchorText = '研究🚀数据'.repeat(1000)
		const memory: KnowledgeBundleMCPMemorySource = {
			async snapshot() {
				return snapshot([
					{
						id: 'unicode_session',
						turns: [
							{ index: 20, role: 'user', text: 'Before.' },
							{ index: 21, role: 'assistant', text: anchorText },
							{ index: 22, role: 'user', text: 'After.' }
						],
						warnings: []
					}
				])
			}
		}
		const connection = await connectedClient([grant('ws_unicode', memory)])
		try {
			const result = payload<{
				budget_bytes: number
				serialized_bytes: number
				anchor_turn_index: number
				window_complete: boolean
				turns: Array<{
					turn_index: number
					text: string
					content_hash: string
					partial_text: boolean
				}>
			}>(
				await connection.client.callTool({
					name: 'knowledge_get_memory_context',
					arguments: {
						workspace_ref: 'ws_unicode',
						session_id: 'unicode_session',
						turn_index: 21,
						before: 1,
						after: 1,
						max_bytes: 2048
					}
				}),
				2048
			)
			expect(result.anchor_turn_index).toBe(21)
			expect(result.window_complete).toBe(false)
			expect(result.turns).toHaveLength(1)
			expect(result.turns[0]).toMatchObject({
				turn_index: 21,
				content_hash: hash(anchorText),
				partial_text: true
			})
			const excerpt = result.turns[0]!.text
			expect(excerpt.length).toBeGreaterThan(0)
			expect(anchorText.startsWith(excerpt)).toBe(true)
			expect(excerpt).not.toContain('\uFFFD')
		} finally {
			await connection.close()
		}
	})

	test('preserves the anchor and recomputes completeness when warning metadata is trimmed', async () => {
		const anchorText = 'Anchor context must survive trimming.'
		const memory: KnowledgeBundleMCPMemorySource = {
			async snapshot() {
				return snapshot([
					{
						id: 'warning_session',
						turns: [
							{ index: 1, role: 'user', text: 'Before context.' },
							{ index: 2, role: 'assistant', text: anchorText }
						],
						warnings: Array.from({ length: 12 }, (_, index) => `${index}:`.padEnd(240, 'w'))
					}
				])
			}
		}
		const connection = await connectedClient([grant('ws_warnings', memory)])
		try {
			const result = payload<{
				budget_bytes: number
				serialized_bytes: number
				anchor_turn_index: number
				window_complete: boolean
				truncated: boolean
				coverage: {
					warnings: string[]
					warnings_truncated?: boolean
					total_warnings?: number
				}
				turns: Array<{
					turn_index: number
					text: string
					content_hash: string
					partial_text: boolean
				}>
			}>(
				await connection.client.callTool({
					name: 'knowledge_get_memory_context',
					arguments: {
						workspace_ref: 'ws_warnings',
						session_id: 'warning_session',
						turn_index: 2,
						before: 1,
						after: 0,
						max_bytes: 2048
					}
				}),
				2048
			)
			expect(result.anchor_turn_index).toBe(2)
			expect(result.turns).toContainEqual(
				expect.objectContaining({
					turn_index: 2,
					text: anchorText,
					content_hash: hash(anchorText),
					partial_text: false
				})
			)
			expect(result.window_complete).toBe(false)
			expect(result.truncated).toBe(true)
			expect(result.coverage).toMatchObject({
				warnings_truncated: true,
				total_warnings: 12
			})
			expect(result.coverage.warnings.length).toBeLessThan(12)
		} finally {
			await connection.close()
		}
	})

	test('searches and preserves dialogue that resembles memory frontmatter', async () => {
		const text = '---\nstatus: archived\n---\nVisible session evidence.'
		const memory: KnowledgeBundleMCPMemorySource = {
			async snapshot() {
				return snapshot([
					{
						id: 'frontmatter_session',
						turns: [{ index: 3, role: 'user', text }],
						warnings: []
					}
				])
			}
		}
		const connection = await connectedClient([grant('ws_frontmatter', memory)])
		try {
			const result = payload<{
				budget_bytes: number
				serialized_bytes: number
				results: Array<{
					session_id: string
					turn_index: number
					text: string
					content_hash: string
				}>
			}>(
				await connection.client.callTool({
					name: 'knowledge_search_memory',
					arguments: {
						workspace_ref: 'ws_frontmatter',
						query: 'status archived',
						mode: 'keyword'
					}
				})
			)
			expect(result.results).toMatchObject([
				{
					session_id: 'frontmatter_session',
					turn_index: 3,
					text,
					content_hash: hash(text)
				}
			])
		} finally {
			await connection.close()
		}
	})

	test('semantic ranking sees only the selected provider current snapshot and hides cache telemetry', async () => {
		let current = snapshot([
			{
				id: 'alpha_session',
				turns: [
					{ index: 1, role: 'user', text: 'Current alpha evidence.' },
					{ index: 2, role: 'assistant', text: 'Current alpha conclusion.' }
				],
				warnings: []
			}
		])
		const rankedPassages: string[][] = []
		const ranker: KnowledgeBundleMCPSemanticRanker = async (_query, passages) => {
			rankedPassages.push([...passages])
			return {
				scores: passages.map(() => 0.95),
				model: 'local-memory-test',
				cacheHits: passages.length,
				queryCacheHit: true,
				minimumScore: 0.35,
				maximumScoreDrop: 0.2
			}
		}
		const selectedMemory: KnowledgeBundleMCPMemorySource = {
			async snapshot() {
				return current
			},
			semanticRank: ranker
		}
		let otherRankerCalled = false
		const otherMemory: KnowledgeBundleMCPMemorySource = {
			async snapshot() {
				return snapshot([
					{
						id: 'other_session',
						turns: [{ index: 1, role: 'user', text: 'Other workspace secret.' }],
						warnings: []
					}
				])
			},
			semanticRank: async () => {
				otherRankerCalled = true
				return { scores: [1], model: 'wrong-provider', cacheHits: 0 }
			}
		}
		const connection = await connectedClient([
			grant('ws_selected', selectedMemory),
			grant('ws_other', otherMemory)
		])
		try {
			const first = payload<{
				budget_bytes: number
				serialized_bytes: number
				retrieval: Record<string, unknown>
				results: Array<{ session_id: string; text: string }>
			}>(
				await connection.client.callTool({
					name: 'knowledge_search_memory',
					arguments: {
						workspace_ref: 'ws_selected',
						query: '跨语言查询',
						mode: 'semantic',
						max_bytes: 4096
					}
				}),
				4096
			)
			expect(rankedPassages[0]).toEqual(['Current alpha evidence.', 'Current alpha conclusion.'])
			expect(first.results.every(({ session_id }) => session_id === 'alpha_session')).toBe(true)
			expect(JSON.stringify(first)).not.toContain('Other workspace secret.')
			expect(first.retrieval).toMatchObject({
				requested_mode: 'semantic',
				used_mode: 'semantic',
				model: 'local-memory-test'
			})
			expect(first.retrieval).not.toHaveProperty('cache_hits')
			expect(first.retrieval).not.toHaveProperty('embedded_passages')
			expect(first.retrieval).not.toHaveProperty('query_cache_hit')

			current = snapshot([
				{
					id: 'replacement_session',
					turns: [
						{
							index: 7,
							role: 'assistant',
							text: 'Replacement current evidence.'
						}
					],
					warnings: []
				}
			])
			const second = payload<{
				budget_bytes: number
				serialized_bytes: number
				retrieval: Record<string, unknown>
				results: Array<{ session_id: string; text: string }>
			}>(
				await connection.client.callTool({
					name: 'knowledge_search_memory',
					arguments: {
						workspace_ref: 'ws_selected',
						query: '更新查询',
						mode: 'semantic',
						max_bytes: 4096
					}
				}),
				4096
			)
			expect(rankedPassages[1]).toEqual(['Replacement current evidence.'])
			expect(second.results).toMatchObject([
				{
					session_id: 'replacement_session',
					text: 'Replacement current evidence.'
				}
			])
			expect(JSON.stringify(second)).not.toContain('Current alpha evidence.')
			expect(otherRankerCalled).toBe(false)
		} finally {
			await connection.close()
		}
	})
})
