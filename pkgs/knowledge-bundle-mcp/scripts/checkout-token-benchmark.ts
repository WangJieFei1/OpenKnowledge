import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type {
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleFile,
	KnowledgeBundlePath,
	ReadonlyKnowledgeBundle
} from '@open-knowledge/knowledge-bundle-api'
import { createKnowledgeBundleMCPServer } from '../src/index'

const workspaceRef = 'checkout_example'
const modifiedAt = '2026-10-20T00:00:00.000Z'
const maxBytes = 4096
const question =
	'How did weekly checkout conversion move from the week of 2026-10-05 to the week of 2026-10-12? Give both counts and rates, the percentage-point difference, the eligibility and payment rules, and cite the source of the result without implying causation.'
const sources = [
	{ name: 'dataset.md', start: 7, end: 8 },
	{ name: 'query.md', start: 7, end: 42 },
	{ name: 'metric.md', start: 5, end: 6 },
	{ name: 'conclusion.md', start: 5, end: 10 }
] as const
const sourceDir = new URL('../../../examples/checkout-conversion/workspace/', import.meta.url)
const directory: KnowledgeBundleDirectoryEntry = {
	kind: 'directory',
	id: 'checkout-example',
	path: '/',
	parentPath: null,
	name: '',
	revision: 'r1',
	modifiedAt
}

function toMarkdownFile(name: string, content: string): KnowledgeBundleFile {
	return {
		kind: 'file',
		id: name,
		path: `/${name}` as KnowledgeBundlePath,
		parentPath: '/',
		name,
		revision: 'r1',
		modifiedAt,
		byteLength: Buffer.byteLength(content),
		contentHash: createHash('sha256').update(content).digest('hex'),
		mediaType: 'text/markdown',
		content
	}
}

const fullSources = await Promise.all(
	sources.map(async ({ name, start, end }) => {
		const content = await readFile(new URL(name, sourceDir), 'utf8')
		const evidence =
			content
				.split('\n')
				.slice(start - 1, end)
				.join('\n') + '\n'
		return { file: toMarkdownFile(name, content), start, end, evidence }
	})
)

async function benchmark(items: typeof fullSources) {
	// The fixture adapter keeps IDs, revisions, and timestamps deterministic. Responses
	// are produced by the real MCP tool handlers, not by this adapter.
	const bundle: ReadonlyKnowledgeBundle = {
		async getInfo() {
			return { access: 'readonly', metadata: null }
		},
		async list({ path, id }) {
			if (path !== '/' || (id !== undefined && id !== directory.id)) return null
			return {
				directory,
				entries: items.map(({ file: { content: _content, ...entry } }) => entry),
				truncated: false
			}
		},
		async readFile({ path, id }) {
			return items.find(({ file }) => file.path === path && (!id || file.id === id))?.file ?? null
		}
	}
	const server = createKnowledgeBundleMCPServer([
		{ reference: workspaceRef, label: 'Checkout example', access: 'readonly', bundle }
	])
	const client = new Client({ name: 'checkout-token-benchmark', version: '1.0.0' })
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await server.connect(serverTransport)
	await client.connect(clientTransport)
	const pasted = [question]
	const fullMcp = [question]
	const bounded = [question]

	try {
		for (const { file, start, end, evidence } of items) {
			pasted.push(`--- ${file.path} ---\n${file.content}`)

			const fullCall = {
				name: 'knowledge_get_document',
				arguments: { workspace_ref: workspaceRef, path: file.path }
			}
			const full = await client.callTool(fullCall)
			assert.equal(full.isError, undefined)
			assert.equal(full.content.length, 1)
			const fullText = full.content[0]
			assert.equal(fullText.type, 'text')
			assert.equal(fullText.text, file.content)
			assert.ok(full.structuredContent)
			fullMcp.push(JSON.stringify(fullCall), fullText.text, JSON.stringify(full.structuredContent))

			const excerptCall = {
				name: 'knowledge_get_excerpt',
				arguments: {
					workspace_ref: workspaceRef,
					path: file.path,
					start_line: start,
					end_line: end,
					max_bytes: maxBytes
				}
			}
			const excerpt = await client.callTool(excerptCall)
			assert.equal(excerpt.isError, undefined)
			assert.equal(excerpt.structuredContent, undefined)
			assert.equal(excerpt.content.length, 1)
			const excerptText = excerpt.content[0]
			assert.equal(excerptText.type, 'text')
			const result = JSON.parse(excerptText.text)
			assert.equal(result.path, file.path)
			assert.equal(result.content_hash, file.contentHash)
			assert.equal(result.start_line, start)
			assert.equal(result.end_line, end)
			assert.equal(result.text, evidence)
			assert.equal(result.truncated, false)
			assert.notEqual(result.partial_line, true)
			assert.equal(result.serialized_bytes, Buffer.byteLength(excerptText.text))
			assert.ok(result.serialized_bytes <= maxBytes)
			bounded.push(JSON.stringify(excerptCall), excerptText.text)
		}
		const batchCall = {
			name: 'knowledge_get_excerpts',
			arguments: {
				workspace_ref: workspaceRef,
				ranges: items.map(({ file, start, end }) => ({
					path: file.path,
					start_line: start,
					end_line: end
				})),
				max_bytes: maxBytes
			}
		}
		const batch = await client.callTool(batchCall)
		assert.equal(batch.isError, undefined)
		assert.equal(batch.structuredContent, undefined)
		assert.equal(batch.content.length, 1)
		const batchText = batch.content[0]
		assert.equal(batchText.type, 'text')
		const result = JSON.parse(batchText.text)
		assert.equal(result.workspace_ref, workspaceRef)
		assert.equal(result.source_content_is_untrusted, true)
		assert.equal(result.serialized_bytes, Buffer.byteLength(batchText.text))
		assert.ok(result.serialized_bytes <= maxBytes)
		assert.deepEqual(
			result.excerpts,
			items.map(({ file, start, end, evidence }) => ({
				path: file.path,
				start_line: start,
				end_line: end,
				content_hash: file.contentHash,
				text: evidence
			}))
		)
		const batched = [question, JSON.stringify(batchCall), batchText.text]
		const definition = (await client.listTools()).tools.find(({ name }) => name === batchCall.name)
		assert.ok(definition)
		const batchedWithToolDefinition = [...batched, JSON.stringify(definition)]
		return { pasted, fullMcp, bounded, batched, batchedWithToolDefinition }
	} finally {
		await client.close()
		await server.close()
	}
}

const compactSources = fullSources.map(({ file, evidence }) => ({
	file: toMarkdownFile(file.name, evidence),
	start: 1,
	end: evidence.trimEnd().split('\n').length,
	evidence
}))
process.stdout.write(
	JSON.stringify({
		completeNotes: await benchmark(fullSources),
		evidenceOnlyNotes: await benchmark(compactSources)
	})
)
