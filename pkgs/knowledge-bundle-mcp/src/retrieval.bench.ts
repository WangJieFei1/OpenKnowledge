import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type {
	KnowledgeBundleFile,
	ReadonlyKnowledgeBundle
} from '@open-knowledge/knowledge-bundle-api'
import { createKnowledgeBundleMCPServer } from './index'
import type { ExcerptResult, SearchResult } from './retrieval'

// Reproducible synthetic payload comparison; bytes are not model tokens or prices.
const fact =
	'唯一验收事实 / Verified target: 青鹭计划的训练间隔为 37 分钟；verification code QL-7429.'
const lines = ['# Synthetic bilingual project notes', '']
for (let index = 0; index < 300; index++) {
	lines.push(
		`## Routine entry ${index}`,
		'',
		index === 147
			? fact
			: '日常记录：整理资料、复查引用、记录反馈。Routine notes document planning, reading, and reviewing references. '.repeat(
					4
				),
		''
	)
}
const markdown = lines.join('\n')
const factLine = lines.indexOf(fact) + 1
const maxBytes = 2048
const file: KnowledgeBundleFile = {
	kind: 'file',
	id: 'synthetic-bilingual-notes',
	path: '/bilingual-notes.md',
	name: 'bilingual-notes.md',
	parentPath: '/',
	revision: 'synthetic-r1',
	modifiedAt: '2026-09-14T00:00:00.000Z',
	mediaType: 'text/markdown',
	byteLength: Buffer.byteLength(markdown),
	contentHash: createHash('sha256').update(markdown).digest('hex'),
	content: markdown
}
const { content: _content, ...fileMetadata } = file
const bundle: ReadonlyKnowledgeBundle = {
	async getInfo() {
		return { access: 'readonly', metadata: { title: 'Synthetic benchmark' } }
	},
	async list(input) {
		if (input.path !== '/') return null
		return {
			directory: {
				kind: 'directory',
				id: 'root',
				path: '/',
				name: '',
				parentPath: null,
				revision: 'root-r1',
				modifiedAt: file.modifiedAt
			},
			entries: input.depth > 0 ? [fileMetadata].slice(0, input.limit ?? 1) : [],
			truncated: false
		}
	},
	async readFile(input) {
		if (
			(input.id === undefined ? input.path !== file.path : input.id !== file.id) ||
			(input.maximumBytes !== undefined && file.byteLength > input.maximumBytes)
		)
			return null
		return file
	}
}
const server = createKnowledgeBundleMCPServer([
	{ reference: 'ws_benchmark', label: 'Synthetic benchmark', access: 'readonly', bundle }
])
const client = new Client({ name: 'retrieval-payload-benchmark', version: '1.0.0' })
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
type Result = Awaited<ReturnType<Client['callTool']>>
function text(result: Result): string {
	assert.notEqual(result.isError, true)
	assert.equal(result.content.length, 1)
	const block = result.content[0]!
	assert.equal(block.type, 'text')
	if (block.type !== 'text') throw new Error('Expected one text content block.')
	return block.text
}
function metrics(result: Result, jsonText: boolean) {
	return {
		call_tool_result_json_utf8_bytes: Buffer.byteLength(JSON.stringify(result)),
		text_content_utf8_bytes: Buffer.byteLength(text(result)),
		json_text_utf8_bytes: jsonText ? Buffer.byteLength(text(result)) : null
	}
}
await server.connect(serverTransport)
await client.connect(clientTransport)
try {
	assert.equal(markdown.split(fact).length - 1, 1)
	const full = await client.callTool({
		name: 'knowledge_get_document',
		arguments: { path: file.path }
	})
	assert.equal(text(full), markdown)
	const fullMetadata = full.structuredContent as Record<string, unknown>
	assert.equal(fullMetadata.path, file.path)
	assert.equal(fullMetadata.content_hash, file.contentHash)
	const recall = await client.callTool({
		name: 'knowledge_recall',
		arguments: { query: 'QL-7429 青鹭计划', max_results: 1, max_bytes: maxBytes }
	})
	const recalled = JSON.parse(text(recall)) as SearchResult
	assert.equal(recall.structuredContent, undefined)
	assert.equal(recalled.results.length, 1)
	const match = recalled.results[0]!
	assert.ok(match.text.includes(fact))
	assert.equal(match.path, file.path)
	assert.equal(match.content_hash, file.contentHash)
	assert.ok(match.start_line <= factLine && match.end_line >= factLine)
	assert.equal(match.text, lines.slice(match.start_line - 1, match.end_line).join('\n') + '\n')
	assert.ok(Buffer.byteLength(text(recall)) <= maxBytes)
	assert.equal(recalled.serialized_bytes, Buffer.byteLength(text(recall)))
	const excerpt = await client.callTool({
		name: 'knowledge_get_excerpt',
		arguments: {
			id: match.id,
			path: match.path,
			start_line: factLine,
			end_line: factLine,
			expected_content_hash: match.content_hash,
			max_bytes: maxBytes
		}
	})
	const extracted = JSON.parse(text(excerpt)) as ExcerptResult
	assert.equal(extracted.text, fact + '\n')
	assert.equal(extracted.path, file.path)
	assert.equal(extracted.content_hash, file.contentHash)
	assert.equal(extracted.start_line, factLine)
	assert.equal(extracted.end_line, factLine)
	assert.ok(Buffer.byteLength(text(excerpt)) <= maxBytes)
	assert.equal(extracted.serialized_bytes, Buffer.byteLength(text(excerpt)))
	console.log(
		JSON.stringify(
			{
				dataset: 'synthetic-bilingual-single-fact',
				source_utf8_bytes: file.byteLength,
				fact_line: factLine,
				budget_utf8_bytes: maxBytes,
				fact_and_provenance_verified: true,
				knowledge_get_document: metrics(full, false),
				knowledge_recall: metrics(recall, true),
				knowledge_get_excerpt: metrics(excerpt, true)
			},
			null,
			2
		)
	)
} finally {
	await client.close()
	await server.close()
}
