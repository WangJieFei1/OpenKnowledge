import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type {
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntry,
	KnowledgeBundleFile,
	KnowledgeBundleFileEntry,
	KnowledgeBundlePath,
	ListKnowledgeBundleInput,
	ReadKnowledgeBundleFileInput,
	ReadonlyKnowledgeBundle
} from '@open-knowledge/knowledge-bundle-api'
import {
	createKnowledgeBundleMCPServer,
	type KnowledgeBundleMCPDocumentReader,
	type KnowledgeBundleMCPGrant
} from './index'

const workspaceRef = 'ws_retrieval-tests'
const modifiedAt = '2026-07-27T12:00:00.000Z'
const scanLimits = { entries: 1000, documents: 200, bytes: 16 * 1024 * 1024, depth: 32 }

function hash(content: string): string {
	return createHash('sha256').update(content).digest('hex')
}

function entryBase(path: KnowledgeBundlePath) {
	const separator = path.lastIndexOf('/')
	return {
		id: `id:${path}`,
		path,
		name: path.slice(separator + 1),
		parentPath: path === '/' ? null : ((path.slice(0, separator) || '/') as KnowledgeBundlePath),
		revision: `r1:${path}`,
		modifiedAt
	}
}

function makeFile(
	path: KnowledgeBundlePath,
	content: string,
	overrides: Partial<KnowledgeBundleFileEntry> = {}
): KnowledgeBundleFile {
	return {
		kind: 'file',
		...entryBase(path),
		byteLength: Buffer.byteLength(content),
		contentHash: hash(content),
		mediaType: 'text/markdown',
		...overrides,
		content
	}
}

function metadata(file: KnowledgeBundleFile): KnowledgeBundleFileEntry {
	const { content: _content, ...entry } = file
	return entry
}

function fixture(initialFiles: KnowledgeBundleFile[]) {
	const files = [...initialFiles]
	const calls = {
		lists: [] as ListKnowledgeBundleInput[],
		reads: [] as ReadKnowledgeBundleFileInput[]
	}
	const state = {
		forceTruncated: false,
		readError: undefined as Error | undefined,
		missingIDs: new Set<string>(),
		extraEntries: [] as KnowledgeBundleEntry[]
	}
	const bundle: ReadonlyKnowledgeBundle = {
		async getInfo() {
			return { access: 'readonly', metadata: { title: 'Retrieval fixture' } }
		},
		async list(input) {
			calls.lists.push({ ...input })
			const directories = new Map<KnowledgeBundlePath, KnowledgeBundleDirectoryEntry>([
				['/', { kind: 'directory', ...entryBase('/') }]
			])
			for (const file of files) {
				let parent = file.parentPath
				while (parent && parent !== '/') {
					const directory = { kind: 'directory', ...entryBase(parent) } as const
					directories.set(parent, directory)
					parent = directory.parentPath
				}
			}
			const directory = input.id
				? [...directories.values()].find(({ id }) => id === input.id)
				: directories.get(input.path)
			if (!directory) return null
			const prefix = directory.path === '/' ? '/' : `${directory.path}/`
			const allEntries = [...directories.values(), ...files.map(metadata), ...state.extraEntries]
				.filter((entry) => {
					if (!entry.path.startsWith(prefix)) return false
					const relative = entry.path.slice(prefix.length)
					return relative.length > 0 && relative.split('/').length <= input.depth
				})
				.sort((left, right) => left.path.localeCompare(right.path))
			const entries = allEntries.slice(0, input.limit ?? allEntries.length)
			return {
				directory,
				entries,
				truncated: state.forceTruncated || entries.length < allEntries.length
			}
		},
		async readFile(input) {
			calls.reads.push({ ...input })
			if (state.readError) throw state.readError
			const file = files.find((entry) =>
				input.id !== undefined ? entry.id === input.id : entry.path === input.path
			)
			if (
				!file ||
				state.missingIDs.has(file.id) ||
				(input.maximumBytes !== undefined && file.byteLength > input.maximumBytes)
			) {
				return null
			}
			return { ...file }
		}
	}
	const grant: KnowledgeBundleMCPGrant = {
		reference: workspaceRef,
		label: 'Retrieval tests',
		access: 'readonly',
		bundle
	}
	return { files, calls, state, bundle, grant }
}

async function connectedClient(grants: readonly KnowledgeBundleMCPGrant[]) {
	const server = createKnowledgeBundleMCPServer(grants)
	const client = new Client({ name: 'retrieval-tools-test', version: '1.0.0' })
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
type RetrievalItem = {
	path: string
	id: string
	text: string
	start_line: number
	end_line: number
	content_hash: string
	inactive_reasons?: string[]
	conflict?: { memory_key: string; paths: string[]; resolution: string }
}
type RetrievalPayload = RetrievalItem & {
	retrieval?: { used_mode: string; complete: boolean }
	results: RetrievalItem[]
	truncated: boolean
	total_matches: number
	excluded_documents: number
	serialized_bytes: number
	budget_bytes: number
	coverage: {
		listed_entries: number
		scanned_documents: number
		scanned_bytes: number
		skipped_documents: number
		complete: boolean
	}
}

test('MCP hybrid recall ranks only current authorized passages in the requested directory', async () => {
	const context = fixture([
		makeFile('/allowed/entry.md', 'Collect the keys from the lockbox after 3 pm.'),
		makeFile('/private/secret.md', 'Never send this unrelated directory to the embedding host.'),
		makeFile('/allowed/archived.md', '---\nstatus: archived\n---\nOld secret code 1234.')
	])
	let hostCalls = 0
	const connection = await connectedClient([
		{
			...context.grant,
			semanticRank: async (_query, passages) => {
				hostCalls++
				expect(passages).toEqual(['Collect the keys from the lockbox after 3 pm.'])
				return { scores: [0.92], model: 'local-test', cacheHits: 0 }
			}
		}
	])
	try {
		const recalled = payload(
			await connection.client.callTool({
				name: 'knowledge_recall',
				arguments: {
					query: '几点办理入住',
					path: '/allowed',
					max_bytes: 2048
				}
			}),
			2048
		)
		expect(recalled.retrieval).toMatchObject({ used_mode: 'hybrid', complete: true })
		expect(recalled.results[0]?.path).toBe('/allowed/entry.md')
		expect(hostCalls).toBe(1)
		context.files.splice(0, context.files.length)
		const deleted = payload(
			await connection.client.callTool({
				name: 'knowledge_recall',
				arguments: { query: '几点办理入住' }
			})
		)
		expect(deleted.results).toEqual([])
		expect(hostCalls).toBe(1)
		const denied = await connection.client.callTool({
			name: 'knowledge_recall',
			arguments: { query: '入住', workspace_ref: 'not_authorized' }
		})
		expect(denied.isError).toBe(true)
		expect(hostCalls).toBe(1)
	} finally {
		await connection.close()
	}
})

test('MCP exposes financial prefilters and withholds canonical values from incomplete scans', async () => {
	const financial = (period: string) =>
		`---\nentity: ACME\nperiod: ${period}\nmetric: revenue\nbasis: GAAP\ndefinition_version: v2\nvalue: 125\nunit: USD million\nas_of: 2025-05-01\n---\nRevenue was 125 million.`
	const context = fixture([
		makeFile('/current.md', financial('FY24')),
		makeFile('/prior.md', financial('FY23'))
	])
	const connection = await connectedClient([
		{
			...context.grant,
			semanticRank: async (_query, passages) => {
				expect(passages).toEqual(['Revenue was 125 million.'])
				return { scores: [0.99], model: 'financial-filter-test', cacheHits: 0 }
			}
		}
	])
	const args = {
		query: 'Revenue',
		max_bytes: 2048,
		filters: {
			entity: 'ACME',
			period: 'FY24',
			metric: 'revenue',
			basis: 'GAAP',
			definition_version: 'v2'
		},
		canonical_only: true
	}
	try {
		const first = payload(
			await connection.client.callTool({ name: 'knowledge_recall', arguments: args }),
			2048
		)
		expect(first.results.map(({ path }) => path)).toEqual(['/current.md'])
		expect(first.excluded_documents).toBe(1)
		context.state.forceTruncated = true
		const incomplete = payload(
			await connection.client.callTool({ name: 'knowledge_recall', arguments: args }),
			2048
		)
		expect(incomplete.results).toEqual([])
		expect(incomplete.coverage.complete).toBe(false)
		const readCount = context.calls.reads.length
		const invalid = await connection.client.callTool({
			name: 'knowledge_recall',
			arguments: { ...args, filters: { unsupported: 'FY24' } }
		})
		expect(invalid.isError).toBe(true)
		expect(context.calls.reads).toHaveLength(readCount)
	} finally {
		await connection.close()
	}
})

function payload(result: ToolResult, budget = 8000): RetrievalPayload {
	expect(result.isError).not.toBe(true)
	expect(result.structuredContent).toBeUndefined()
	expect(result.content).toHaveLength(1)
	const content = result.content[0]
	if (content?.type !== 'text') throw new Error('Expected exactly one JSON text response.')
	const decoded = JSON.parse(content.text) as RetrievalPayload
	expect(content.text).toBe(JSON.stringify(decoded))
	expect(Buffer.byteLength(content.text, 'utf8')).toBeLessThanOrEqual(budget)
	expect(decoded.serialized_bytes).toBe(Buffer.byteLength(content.text, 'utf8'))
	expect(decoded.budget_bytes).toBe(budget)
	expect(decoded).toMatchObject({ source_content_is_untrusted: true })
	return decoded
}

describe('native MCP knowledge retrieval', () => {
	test('advertises both retrieval tools for a readonly grant without a host searcher', async () => {
		const context = fixture([makeFile('/guide.md', '# Guide\nRetrieval evidence.')])
		const connection = await connectedClient([context.grant])
		try {
			const listed = await connection.client.listTools()
			for (const name of ['knowledge_recall', 'knowledge_get_excerpt']) {
				const tool = listed.tools.find((candidate) => candidate.name === name)
				expect(tool).toBeDefined()
				expect(tool?.annotations).toMatchObject({
					readOnlyHint: true,
					destructiveHint: false,
					openWorldHint: false
				})
				expect(tool?.outputSchema).toBeUndefined()
			}
			expect(listed.tools.map(({ name }) => name)).not.toContain('knowledge_update_document')
			const recall = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'evidence' }
				})
			)
			expect(recall.results).toHaveLength(1)
			expect(recall.results[0]).toMatchObject({ path: '/guide.md', document_access: 'readonly' })
			expect(context.files[0]?.content).toBe('# Guide\nRetrieval evidence.')
		} finally {
			await connection.close()
		}
	})

	test('returns exact original lines, source identity, and a derived default end line', async () => {
		const lines = Array.from({ length: 150 }, (_, index) => `Line ${index + 1}: 学习 evidence`)
		const file = makeFile('/notes/guide.md', lines.join('\n'))
		const context = fixture([file])
		const connection = await connectedClient([context.grant])
		try {
			const explicit = payload(
				await connection.client.callTool({
					name: 'knowledge_get_excerpt',
					arguments: { path: file.path, start_line: 2, end_line: 4 }
				})
			)
			expect(explicit).toMatchObject({
				workspace_ref: workspaceRef,
				id: file.id,
				path: file.path,
				revision: file.revision,
				content_hash: file.contentHash,
				representation: 'source_markdown',
				document_access: 'readonly',
				start_line: 2,
				end_line: 4,
				total_lines: 150,
				text: `${lines.slice(1, 4).join('\n')}\n`
			})
			const derived = payload(
				await connection.client.callTool({
					name: 'knowledge_get_excerpt',
					arguments: { path: file.path, start_line: 100 }
				})
			)
			expect(derived).toMatchObject({ start_line: 100, end_line: 139 })
			expect(derived.text).toBe(`${lines.slice(99, 139).join('\n')}\n`)
		} finally {
			await connection.close()
		}
	})

	test('follows stable IDs and rejects stale hashes or unknown IDs without falling back to a path', async () => {
		const relocated = makeFile('/archive/new.md', '# Current\nVerified evidence.', {
			id: 'stable-id'
		})
		const occupant = makeFile('/old.md', '# Different\nDo not select this document.')
		const context = fixture([relocated, occupant])
		const connection = await connectedClient([context.grant])
		try {
			const read = payload(
				await connection.client.callTool({
					name: 'knowledge_get_excerpt',
					arguments: {
						id: relocated.id,
						path: '/old.md',
						expected_content_hash: relocated.contentHash
					}
				})
			)
			expect(read).toMatchObject({
				id: relocated.id,
				path: relocated.path,
				text: relocated.content
			})
			for (const arguments_ of [
				{ id: relocated.id, path: '/old.md', expected_content_hash: hash('older source') },
				{ id: 'unknown-id', path: '/old.md' }
			]) {
				const result = await connection.client.callTool({
					name: 'knowledge_get_excerpt',
					arguments: arguments_
				})
				expect(result.isError).toBe(true)
				expect(JSON.stringify(result)).not.toContain(occupant.content)
				expect(JSON.stringify(result)).not.toContain(relocated.content)
			}
		} finally {
			await connection.close()
		}
	})

	test('strictly budgets UTF-8 JSON including escaping, metadata, and coverage', async () => {
		const line = '学习🧠 evidence "quoted" \\path\t'.repeat(400)
		const context = fixture(
			Array.from({ length: 20 }, (_, index) => makeFile(`/doc-${index}.md`, `${line}\n${line}`))
		)
		const connection = await connectedClient([context.grant])
		try {
			for (const budget of [2048, 4096, 8000]) {
				const excerpt = payload(
					await connection.client.callTool({
						name: 'knowledge_get_excerpt',
						arguments: { path: '/doc-0.md', max_bytes: budget }
					}),
					budget
				)
				expect(excerpt.truncated).toBe(true)
				expect(excerpt.text.length).toBeGreaterThan(0)
				expect(line.startsWith(excerpt.text)).toBe(true)
				expect(excerpt.text).not.toContain('\ufffd')
				const recall = payload(
					await connection.client.callTool({
						name: 'knowledge_recall',
						arguments: { query: 'evidence', max_results: 20, max_bytes: budget }
					}),
					budget
				)
				expect(recall.truncated).toBe(true)
				expect(recall.coverage).toMatchObject({ scanned_documents: 20, limits: scanLimits })
			}
		} finally {
			await connection.close()
		}
	})

	test('rejects missing or unauthorized workspace references before touching a capability', async () => {
		const context = fixture([makeFile('/guide.md', 'private evidence')])
		const other = fixture([makeFile('/guide.md', 'other workspace secret')])
		const connection = await connectedClient([
			context.grant,
			{ ...other.grant, reference: 'ws_other' }
		])
		try {
			for (const workspace_ref of [undefined, 'ws_not_authorized']) {
				for (const name of ['knowledge_recall', 'knowledge_get_excerpt']) {
					const result = await connection.client.callTool({
						name,
						arguments: {
							...(workspace_ref === undefined ? {} : { workspace_ref }),
							...(name === 'knowledge_recall' ? { query: 'evidence' } : { path: '/guide.md' })
						}
					})
					expect(result.isError).toBe(true)
				}
			}
			for (const item of [context, other]) {
				expect(item.calls.lists).toHaveLength(0)
				expect(item.calls.reads).toHaveLength(0)
			}
		} finally {
			await connection.close()
		}
	})

	test('rejects noncanonical, protected, and invalid parameters before reads or scans', async () => {
		const context = fixture([makeFile('/guide.md', 'evidence')])
		const connection = await connectedClient([context.grant])
		try {
			const invalidPaths = [
				'',
				'guide.md',
				'/../guide.md',
				'/notes//guide.md',
				'/notes/../guide.md',
				'/.git/secret.md',
				'/notes/.GIT/secret.md',
				'/.open-knowledge/secret.md',
				'/node_modules/guide.md',
				'/draft.open-knowledge-session.tmp/secret.md'
			]
			const excerptInputs = [
				{},
				...invalidPaths.map((path) => ({ path })),
				...[
					{ start_line: 0 },
					{ start_line: 1.5 },
					{ end_line: 0 },
					{ start_line: 5, end_line: 4 },
					{ start_line: 1, end_line: 201 },
					{ max_bytes: 2047 },
					{ max_bytes: 64001 },
					{ max_bytes: 2048.5 },
					{ expected_content_hash: 'not-a-hash' }
				].map((input) => ({ path: '/guide.md', ...input }))
			]
			const recallInputs = [
				{},
				{ query: '' },
				{ query: 'x'.repeat(1001) },
				...invalidPaths.map((path) => ({ query: 'evidence', path })),
				...[
					{ max_results: 0 },
					{ max_results: 21 },
					{ max_results: 1.5 },
					{ max_bytes: 2047 },
					{ max_bytes: 64001 },
					{ include_inactive: 'yes' }
				].map((input) => ({ query: 'evidence', ...input }))
			]
			for (const [name, inputs] of [
				['knowledge_get_excerpt', excerptInputs],
				['knowledge_recall', recallInputs]
			] as const) {
				for (const input of inputs) {
					const result = await connection.client.callTool({ name, arguments: input })
					expect(result.isError).toBe(true)
				}
			}
			expect(context.calls.reads).toHaveLength(0)
			expect(context.calls.lists).toHaveLength(0)
		} finally {
			await connection.close()
		}
	})

	test('never exposes protected canonical paths returned by an authoritative ID or listing', async () => {
		const secret = makeFile('/.open-knowledge/secret.md', 'hidden source token', { id: 'moved-id' })
		const context = fixture([makeFile('/visible.md', 'visible evidence'), secret])
		const connection = await connectedClient([context.grant])
		try {
			const result = await connection.client.callTool({
				name: 'knowledge_get_excerpt',
				arguments: { path: '/previous.md', id: secret.id }
			})
			expect(result.isError).toBe(true)
			expect(JSON.stringify(result)).not.toContain(secret.content)
			expect(JSON.stringify(result)).not.toContain(secret.path)
			context.calls.reads.length = 0
			const recall = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'source' }
				})
			)
			expect(recall.results).toEqual([])
			expect(context.calls.reads.some(({ path }) => path === secret.path)).toBe(false)
			expect(JSON.stringify(recall)).not.toContain(secret.path)
		} finally {
			await connection.close()
		}
	})

	test('excludes inactive memories by default and exposes their reasons only on explicit request', async () => {
		const states = [
			['active', 'status: active'],
			['archived', 'status: archived'],
			['superseded', 'status: superseded'],
			['expired-status', 'status: expired'],
			['draft', 'status: draft'],
			['review', 'status: needs_review'],
			['expired-date', 'expires_at: 2000-01-01'],
			['future', 'valid_from: 2999-01-01']
		]
		const context = fixture(
			states.map(([name, field]) =>
				makeFile(`/${name}.md`, `---\n${field}\n---\nEvidence for training.`)
			)
		)
		const connection = await connectedClient([context.grant])
		try {
			const active = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'training' }
				})
			)
			expect(active.results.map(({ path }) => path)).toEqual(['/active.md'])
			expect(active.excluded_documents).toBe(7)
			const all = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: {
						query: 'training',
						include_inactive: true,
						max_results: 20,
						max_bytes: 16000
					}
				}),
				16000
			)
			expect(all.results).toHaveLength(states.length)
			for (const item of all.results.filter(({ path }) => path !== '/active.md')) {
				expect(item.inactive_reasons?.length).toBeGreaterThan(0)
			}
		} finally {
			await connection.close()
		}
	})

	test('surfaces conflicting active memory keys without letting archived alternatives become authoritative', async () => {
		const context = fixture([
			makeFile('/one.md', '---\nmemory_key: training.duration\n---\nTraining lasts 20 minutes.'),
			makeFile('/two.md', '---\nmemory_key: training.duration\n---\nTraining lasts 40 minutes.'),
			makeFile(
				'/old.md',
				'---\nmemory_key: training.duration\nstatus: archived\n---\nTraining lasts 10 minutes.'
			)
		])
		const connection = await connectedClient([context.grant])
		try {
			const result = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'Training' }
				})
			)
			expect(result.results).toHaveLength(2)
			for (const item of result.results) {
				expect(item.conflict).toMatchObject({
					memory_key: 'training.duration',
					resolution: 'unresolved'
				})
				expect(item.conflict?.paths.toSorted()).toEqual(['/one.md', '/two.md'])
			}
		} finally {
			await connection.close()
		}
	})

	test('reads converted excerpts with source hashes and readonly access without scanning PDFs during recall', async () => {
		const file = makeFile('/notes/research.pdf', '%PDF-source-bytes', {
			mediaType: 'application/pdf',
			documentAccess: 'readonly'
		})
		const markdown = '# Converted research\n\nTraining evidence from the source PDF.'
		const context = fixture([file])
		const readerCalls: Parameters<KnowledgeBundleMCPDocumentReader>[0][] = []
		const readDocument: KnowledgeBundleMCPDocumentReader = async (input, signal) => {
			signal.throwIfAborted()
			readerCalls.push(input)
			if (input.id !== undefined ? input.id !== file.id : input.path !== file.path) return null
			return {
				status: 'readable',
				file: { ...metadata(file), documentAccess: 'readonly' },
				markdown,
				representation: 'converted_markdown'
			}
		}
		const connection = await connectedClient([{ ...context.grant, readDocument }])
		try {
			const excerpt = payload(
				await connection.client.callTool({
					name: 'knowledge_get_excerpt',
					arguments: {
						path: file.path,
						start_line: 3,
						end_line: 3,
						expected_content_hash: file.contentHash
					}
				})
			)
			expect(excerpt).toMatchObject({
				id: file.id,
				path: file.path,
				content_hash: file.contentHash,
				representation: 'converted_markdown',
				document_access: 'readonly',
				start_line: 3,
				end_line: 3,
				text: markdown.split('\n')[2]
			})
			expect(excerpt.content_hash).not.toBe(hash(markdown))
			const recall = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'training' }
				})
			)
			expect(recall.results).toEqual([])
			expect(readerCalls).toHaveLength(1)
			const wrongRepresentationHash = await connection.client.callTool({
				name: 'knowledge_get_excerpt',
				arguments: { path: file.path, expected_content_hash: hash(markdown) }
			})
			expect(wrongRepresentationHash.isError).toBe(true)
			expect(context.calls.reads).toHaveLength(0)
			expect(readerCalls).toHaveLength(2)
			expect(
				readerCalls.every(({ maximumMarkdownBytes }) => maximumMarkdownBytes <= 1024 * 1024)
			).toBe(true)
		} finally {
			await connection.close()
		}
	})

	test('skips unsupported documents and rejects invalid paths returned by a host reader', async () => {
		const file = makeFile('/source.pdf', 'pdf source', {
			mediaType: 'application/pdf',
			documentAccess: 'readonly'
		})
		const unsupported = makeFile('/image.png', 'png source', {
			mediaType: 'image/png',
			documentAccess: 'not_supported'
		})
		const context = fixture([file, unsupported])
		const readDocument: KnowledgeBundleMCPDocumentReader = async (input) => {
			if (input.path === unsupported.path) {
				return {
					status: 'not_supported',
					file: { ...metadata(unsupported), documentAccess: 'not_supported' }
				}
			}
			return {
				status: 'readable',
				file: { ...metadata(file), path: '/.git/private.md', documentAccess: 'readonly' },
				markdown: 'host-internal-secret',
				representation: 'converted_markdown'
			}
		}
		const connection = await connectedClient([{ ...context.grant, readDocument }])
		try {
			const excerpt = await connection.client.callTool({
				name: 'knowledge_get_excerpt',
				arguments: { path: file.path }
			})
			expect(excerpt.isError).toBe(true)
			expect(JSON.stringify(excerpt)).not.toContain('host-internal-secret')
			const recall = await connection.client.callTool({
				name: 'knowledge_recall',
				arguments: { query: 'host-internal-secret' }
			})
			expect(JSON.stringify(recall)).not.toContain('host-internal-secret')
			expect(JSON.stringify(recall)).not.toContain('/.git/private.md')
		} finally {
			await connection.close()
		}
	})

	test('searches only the selected directory and reports bounded scan coverage', async () => {
		const context = fixture([
			makeFile('/notes/guide.md', '# Evidence\nSelected training plan.'),
			makeFile('/outside.md', 'Secret training plan.')
		])
		const connection = await connectedClient([context.grant])
		try {
			const result = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'training', path: '/notes' }
				})
			)
			expect(result.results.map(({ path }) => path)).toEqual(['/notes/guide.md'])
			expect(context.calls.lists).toEqual([{ path: '/notes', depth: 32, limit: 1000 }])
			expect(context.calls.reads.map(({ path }) => path)).toEqual(['/notes/guide.md'])
			expect(result.coverage).toMatchObject({
				listed_entries: 1,
				scanned_documents: 1,
				scanned_bytes: context.files[0]?.byteLength,
				skipped_documents: 0,
				complete: true,
				limits: scanLimits
			})
		} finally {
			await connection.close()
		}
	})

	test('marks incomplete coverage when the listing or 200-document scan limit is reached', async () => {
		const context = fixture(
			Array.from({ length: 1001 }, (_, index) =>
				makeFile(`/doc-${String(index).padStart(4, '0')}.md`, 'Ordinary notes.')
			)
		)
		const connection = await connectedClient([context.grant])
		try {
			const result = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'absent keyword' }
				})
			)
			expect(result.results).toEqual([])
			expect(context.calls.lists).toEqual([{ path: '/', depth: 32, limit: 1000 }])
			expect(context.calls.reads.length).toBeLessThanOrEqual(200)
			expect(result.coverage).toMatchObject({
				listed_entries: 1000,
				scanned_documents: 200,
				complete: false,
				limits: scanLimits
			})
		} finally {
			await connection.close()
		}
	})

	test('bounds scan bytes independently from the response budget', async () => {
		const content = 'x'.repeat(1024 * 1024)
		const context = fixture(
			Array.from({ length: 17 }, (_, index) => makeFile(`/large-${index}.md`, content))
		)
		const connection = await connectedClient([context.grant])
		try {
			const result = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'absent keyword', max_bytes: 2048 }
				}),
				2048
			)
			expect(result.coverage.scanned_bytes).toBeLessThanOrEqual(scanLimits.bytes)
			expect(result.coverage.complete).toBe(false)
			expect(
				context.calls.reads.reduce((total, call) => total + (call.maximumBytes ?? 0), 0)
			).toBeLessThanOrEqual(scanLimits.bytes)
		} finally {
			await connection.close()
		}
	})

	test('marks depth-limited coverage when directories continue beyond depth 32', async () => {
		const deepPath =
			`/${Array.from({ length: 33 }, (_, index) => `level-${index}`).join('/')}/evidence.md` as KnowledgeBundlePath
		const context = fixture([makeFile(deepPath, 'Hidden by the scan depth limit.')])
		const connection = await connectedClient([context.grant])
		try {
			const result = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'evidence' }
				})
			)
			expect(result.results).toEqual([])
			expect(result.coverage).toMatchObject({
				depth_limited: true,
				complete: false,
				scanned_documents: 0,
				limits: scanLimits
			})
			expect(context.calls.reads).toHaveLength(0)
		} finally {
			await connection.close()
		}
	})

	test('does not exceed the budget when source identity alone is oversized', async () => {
		const file = makeFile('/large-metadata.md', 'Relevant evidence.', {
			id: 'opaque-identity-'.repeat(180),
			revision: 'revision-'.repeat(180)
		})
		const context = fixture([file])
		const connection = await connectedClient([context.grant])
		try {
			const excerpt = await connection.client.callTool({
				name: 'knowledge_get_excerpt',
				arguments: { path: file.path, max_bytes: 2048 }
			})
			expect(excerpt.isError).toBe(true)
			expect(Buffer.byteLength(JSON.stringify(excerpt))).toBeLessThanOrEqual(2048)
			expect(JSON.stringify(excerpt)).not.toContain(file.id)
			expect(JSON.stringify(excerpt)).not.toContain(file.content)
			const recall = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'evidence', max_bytes: 2048 }
				}),
				2048
			)
			expect(recall.results).toEqual([])
			expect(recall.truncated).toBe(true)
		} finally {
			await connection.close()
		}
	})

	test('honors cancellation while awaiting a host read and stops subsequent scan reads', async () => {
		for (const name of ['knowledge_get_excerpt', 'knowledge_recall']) {
			const files = [
				makeFile('/first.md', 'first evidence'),
				makeFile('/second.md', 'second evidence')
			]
			const context = fixture(files)
			const entered = Promise.withResolvers<void>()
			const release = Promise.withResolvers<void>()
			const cancelled = Promise.withResolvers<void>()
			let readCalls = 0
			const readDocument: KnowledgeBundleMCPDocumentReader = async (input, signal) => {
				readCalls++
				const file = files.find((candidate) => candidate.path === input.path)!
				signal.addEventListener('abort', () => cancelled.resolve(), { once: true })
				entered.resolve()
				await release.promise
				return {
					status: 'readable',
					file: { ...metadata(file), documentAccess: 'readonly' },
					markdown: file.content,
					representation: 'source_markdown'
				}
			}
			const connection = await connectedClient([{ ...context.grant, readDocument }])
			try {
				const controller = new AbortController()
				const request = connection.client
					.callTool(
						{
							name,
							arguments: name === 'knowledge_recall' ? { query: 'evidence' } : { path: '/first.md' }
						},
						{ signal: controller.signal }
					)
					.then(
						() => 'succeeded',
						() => 'cancelled'
					)
				await entered.promise
				controller.abort(new Error('Test request cancelled'))
				await cancelled.promise
				release.resolve()
				expect(await request).toBe('cancelled')
				await connection.client.ping()
				expect(readCalls).toBe(1)
			} finally {
				release.resolve()
				await connection.close()
			}
		}
	})

	test('skips documents that disappeared but fails a scan on unexpected capability errors', async () => {
		const context = fixture([
			makeFile('/gone.md', 'missing evidence'),
			makeFile('/good.md', 'remaining evidence')
		])
		context.state.missingIDs.add(context.files[0]!.id)
		const connection = await connectedClient([context.grant])
		try {
			const partial = payload(
				await connection.client.callTool({
					name: 'knowledge_recall',
					arguments: { query: 'evidence' }
				})
			)
			expect(partial.results.map(({ path }) => path)).toEqual(['/good.md'])
			expect(partial.coverage.skipped_documents).toBeGreaterThanOrEqual(1)
			context.state.readError = new Error('EACCES: /private/host-only/workspace/secret.md')
			for (const [name, arguments_] of [
				['knowledge_recall', { query: 'evidence' }],
				['knowledge_get_excerpt', { path: '/good.md' }]
			] as const) {
				const result = await connection.client.callTool({ name, arguments: arguments_ })
				expect(result.isError).toBe(true)
				expect(JSON.stringify(result)).not.toContain('/private/host-only')
				expect(JSON.stringify(result)).not.toContain('remaining evidence')
			}
		} finally {
			await connection.close()
		}
	})
})
