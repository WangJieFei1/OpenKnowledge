import { describe, expect, test } from 'bun:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { registerResearchPrompts } from './research-prompts'

async function connectedClient(
	hasSessionMemory?: (workspaceRef: string | undefined) => boolean
): Promise<{
	client: Client
	close(): Promise<void>
}> {
	const server = new McpServer({
		name: 'research-prompts-test',
		version: '1.0.0'
	})
	registerResearchPrompts(server, hasSessionMemory)
	const client = new Client({
		name: 'research-prompts-client',
		version: '1.0.0'
	})
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

describe('research assistant prompts', () => {
	test('advertises three prompts with scoped arguments', async () => {
		const connection = await connectedClient()
		try {
			const result = await connection.client.listPrompts()
			expect(result.prompts).toMatchObject([
				{
					name: 'research_brief',
					arguments: [
						{ name: 'question', required: true },
						{ name: 'workspace_ref', required: false }
					]
				},
				{
					name: 'quant_research_review',
					arguments: [
						{ name: 'hypothesis', required: true },
						{ name: 'workspace_ref', required: false }
					]
				},
				{
					name: 'consulting_handoff',
					arguments: [
						{ name: 'engagement', required: true },
						{ name: 'workspace_ref', required: false }
					]
				}
			])
		} finally {
			await connection.close()
		}
	})

	test('builds an evidence-grounded research workflow', async () => {
		const connection = await connectedClient()
		try {
			const prompt = await connection.client.getPrompt({
				name: 'research_brief',
				arguments: {
					question: 'What should the launch team prioritize?',
					workspace_ref: 'ws_research'
				}
			})
			const text = JSON.stringify(prompt)
			expect(text).toContain('What should the launch team prioritize?')
			expect(text).toContain('ws_research')
			for (const tool of [
				'knowledge_list_workspaces',
				'knowledge_recall',
				'knowledge_get_excerpt'
			]) {
				expect(text).toContain(tool)
			}
			expect(text).not.toContain('Codex')
			expect(text).not.toContain('knowledge_search_memory')
			expect(text).not.toContain('lower-authority recollection')
			expect(text).toContain('content_hash')
			expect(text).toContain('as-of date')
			expect(text).toContain('Never invent data')
			expect(text).toContain('assumptions')
			expect(text).toContain('limitations')
			expect(text).toContain('do not call write/mutation tools unless the user explicitly asks')
		} finally {
			await connection.close()
		}
	})

	for (const [name, subject] of [
		['research_brief', 'question'],
		['quant_research_review', 'hypothesis'],
		['consulting_handoff', 'engagement']
	]) {
		test(`${name} emits session-memory guidance only for the granted capability`, async () => {
			const connection = await connectedClient(
				(workspaceRef) => workspaceRef === undefined || workspaceRef === 'ws_enabled'
			)
			try {
				for (const workspaceRef of [undefined, 'ws_enabled', 'ws_disabled', 'ws_unknown']) {
					const prompt = await connection.client.getPrompt({
						name: name!,
						arguments: {
							[subject!]: 'Synthetic review',
							...(workspaceRef === undefined ? {} : { workspace_ref: workspaceRef })
						}
					})
					const text = JSON.stringify(prompt)
					const enabled = workspaceRef === undefined || workspaceRef === 'ws_enabled'
					for (const marker of [
						'Codex',
						'knowledge_list_memory_sessions',
						'knowledge_search_memory',
						'knowledge_get_memory_context',
						'lower-authority recollection'
					]) {
						expect(text.includes(marker)).toBe(enabled)
					}
					expect(text).toContain('knowledge_recall')
					if (enabled) {
						expect(text).toContain('selected workspace has explicitly enabled')
					}
				}
			} finally {
				await connection.close()
			}
		})
	}

	test('requires quant bias, timing, cost, and non-execution checks', async () => {
		const connection = await connectedClient()
		try {
			const prompt = await connection.client.getPrompt({
				name: 'quant_research_review',
				arguments: { hypothesis: 'The signal predicts next-month returns.' }
			})
			const text = JSON.stringify(prompt)
			expect(text).toContain('select the clearly relevant authorized workspace')
			expect(text).toContain('point-in-time integrity')
			expect(text).toContain('lookahead leakage')
			expect(text).toContain('survivorship bias')
			expect(text).toContain('fees')
			expect(text).toContain('slippage')
			expect(text).toContain('Do not silently substitute zero costs')
			expect(text).toContain('do not fabricate a backtest')
			expect(text).toContain('not trade execution')
		} finally {
			await connection.close()
		}
	})

	test('builds a handoff with decisions, ownership, and unresolved work', async () => {
		const connection = await connectedClient()
		try {
			const prompt = await connection.client.getPrompt({
				name: 'consulting_handoff',
				arguments: { engagement: 'Pricing transformation' }
			})
			const text = JSON.stringify(prompt)
			expect(text).toContain('confirmed decisions')
			expect(text).toContain('decision log')
			expect(text).toContain('action register')
			expect(text).toContain('owner')
			expect(text).toContain('due date')
			expect(text).toContain('TBD')
			expect(text).toContain('open issues')
			expect(text).toContain('risks')
			expect(text).toContain('dependencies')
		} finally {
			await connection.close()
		}
	})

	test('rejects blank required subjects', async () => {
		const connection = await connectedClient()
		try {
			await expect(
				connection.client.getPrompt({
					name: 'research_brief',
					arguments: { question: '   ' }
				})
			).rejects.toThrow()
		} finally {
			await connection.close()
		}
	})
})
