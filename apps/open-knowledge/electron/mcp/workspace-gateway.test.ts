import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type {
	EditableKnowledgeBundle,
	KnowledgeBundleFile
} from '@open-knowledge/knowledge-bundle-api'
import type {
	KnowledgeBundleMCPDocumentReaderInput,
	KnowledgeBundleMCPDocument,
	KnowledgeBundleMCPSearchInput
} from '@open-knowledge/knowledge-bundle-mcp'
import { maximumDocumentBytes } from '@open-knowledge/knowledge-bundle-mcp'
import { applyExactTextPatch, ExactTextPatchError } from '@open-knowledge/knowledge-bundle-patch'
import type {
	KnowledgeSearchResult,
	WorkspaceChange,
	WorkspaceFileEntry,
	WorkspaceSnapshot
} from '../../src/lib/knowledge/api'
import { mcpConnectionFileEnvironment, readMCPConnectionFile } from './connection-file'
import { MCPConfigStore } from './mcp-config-store'
import { WorkspaceMCPGateway } from './workspace-gateway'
import { LocalSemanticSearch } from '../semantic/local-search'
import { CodexSessionMemory } from '../memory/codex-session-memory'

const alphaID = 'root-derived-internal-alpha-id'
const betaID = 'root-derived-internal-beta-id'
const relativePath = '/guide.md' as const
const temporaryDirectories: string[] = []
const gateways: WorkspaceMCPGateway[] = []

afterEach(async () => {
	await Promise.allSettled(gateways.splice(0).map((gateway) => gateway.close()))
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

class FakeGatewaySource {
	readonly roots = new Map<string, string>()
	workspaceRoot(workspaceID: string): string | null {
		return this.roots.get(workspaceID) ?? null
	}
	private readonly listeners = new Set<(change: WorkspaceChange) => void>()
	private readonly snapshots = new Map<string, WorkspaceSnapshot>()
	private readonly documents = new Map<string, KnowledgeBundleFile>()
	constructor(workspaceIDs: string[]) {
		for (const [index, workspaceID] of workspaceIDs.entries()) {
			const label = index === 0 ? 'Product Notes' : 'Research Notes'
			const markdown =
				index === 0
					? '# Product Guide\n\nKnowledge from the alpha workspace.'
					: '# Research Guide\n\nKnowledge from the beta workspace.'
			const document: KnowledgeBundleFile = {
				kind: 'file',
				id: `document-id-${index}`,
				name: 'guide.md',
				path: relativePath,
				parentPath: '/',
				revision: `revision-${index}`,
				modifiedAt: '2026-07-27T12:00:00.000Z',
				byteLength: Buffer.byteLength(markdown),
				contentHash: index === 0 ? 'a'.repeat(64) : 'b'.repeat(64),
				mediaType: 'text/markdown',
				content: markdown
			}
			this.documents.set(`${workspaceID}:${document.path}`, document)
			this.snapshots.set(workspaceID, {
				workspace: {
					kind: 'local',
					id: workspaceID,
					name: label,
					rootPath: `/private/root-${index}`,
					lastOpenedAt: '2026-07-27T12:00:00.000Z'
				},
				access: 'editable',
				format: 'markdown',
				openKnowledgeRoots: [],
				entries: [fileEntry(document)]
			})
		}
	}

	mcpWorkspaceLabel(workspaceID: string): string | null {
		return this.snapshots.get(workspaceID)?.workspace.name ?? null
	}

	mcpWorkspaceIDs(): string[] {
		return [...this.snapshots.keys()]
	}

	removeWorkspace(workspaceID: string): void {
		this.snapshots.delete(workspaceID)
	}

	async mcpReadDocument(
		workspaceID: string,
		input: KnowledgeBundleMCPDocumentReaderInput,
		signal: AbortSignal
	): Promise<KnowledgeBundleMCPDocument | null> {
		signal.throwIfAborted()
		const prefix = `${workspaceID}:`
		const source =
			input.id === undefined
				? this.documents.get(`${workspaceID}:${input.path}`)
				: [...this.documents]
						.filter(([key]) => key.startsWith(prefix))
						.find(([, file]) => file.id === input.id)?.[1]
		if (source) {
			const entry = fileEntry(source)
			return {
				status: 'readable',
				file: { ...entry, documentAccess: 'writable' },
				markdown: source.content,
				representation: 'source_markdown'
			}
		}
		return null
	}

	async mcpSearch(
		_workspaceID: string,
		_input: KnowledgeBundleMCPSearchInput,
		signal: AbortSignal
	): Promise<KnowledgeSearchResult> {
		signal.throwIfAborted()
		return { matches: [], truncated: false }
	}

	mcpBundle(workspaceID: string): EditableKnowledgeBundle<{ title: string }> {
		return {
			getInfo: async () => ({
				access: 'editable',
				metadata: { title: this.mcpWorkspaceLabel(workspaceID) ?? 'Unknown' }
			}),
			list: async (input) => {
				const snapshot = this.snapshots.get(workspaceID)
				if (!snapshot) {
					throw new Error(`Unknown internal workspace ${workspaceID}.`)
				}
				const rootID = `root-id-${[...this.snapshots.keys()].indexOf(workspaceID)}`
				if (input.path !== '/' || (input.id !== undefined && input.id !== rootID)) {
					return null
				}
				const entries = input.depth === 0 ? [] : snapshot.entries
				const limited = input.limit === undefined ? entries : entries.slice(0, input.limit)
				return {
					directory: {
						kind: 'directory',
						id: rootID,
						path: '/',
						name: '',
						parentPath: null,
						revision: 'root-revision',
						modifiedAt: '2026-07-27T12:00:00.000Z'
					},
					entries: limited,
					truncated: limited.length < entries.length
				}
			},
			readFile: async ({ id, path }) => {
				const current = this.documents.get(`${workspaceID}:${path}`)
				if (id === undefined || current?.id === id) {
					return current ?? null
				}
				return (
					[...this.documents]
						.filter(([key]) => key.startsWith(`${workspaceID}:`))
						.find(([, file]) => file.id === id)?.[1] ?? null
				)
			},
			createDirectory: async () => unsupported(),
			createFile: async ({ path: documentPath, content, mediaType }) => {
				const key = `${workspaceID}:${documentPath}`
				if (this.documents.has(key)) {
					return {
						ok: false,
						error: { code: 'already_exists', message: 'The document already exists.' }
					}
				}
				const document: KnowledgeBundleFile = {
					kind: 'file',
					id: `created-${randomUUID()}`,
					name: path.posix.basename(documentPath),
					path: documentPath,
					parentPath: path.posix.dirname(documentPath) as KnowledgeBundleFile['parentPath'],
					revision: 'created-revision',
					modifiedAt: '2026-07-27T12:00:00.000Z',
					byteLength: Buffer.byteLength(content),
					contentHash: createHash('sha256').update(content).digest('hex'),
					...(mediaType === undefined ? {} : { mediaType }),
					content
				}
				this.documents.set(key, document)
				return { ok: true, value: { file: fileEntry(document) } }
			},
			writeFile: async ({ id, path, expectedRevision, expectedContentHash, content }) => {
				const key = `${workspaceID}:${path}`
				const current = this.documents.get(key)
				if (!current || (id !== undefined && current.id !== id)) {
					return { ok: false, error: { code: 'not_found', message: 'Missing file.' } }
				}
				if (expectedRevision !== undefined && current.revision !== expectedRevision) {
					return { ok: false, error: { code: 'revision_conflict', message: 'Stale revision.' } }
				}
				if (expectedContentHash !== undefined && current.contentHash !== expectedContentHash) {
					return { ok: false, error: { code: 'content_conflict', message: 'Stale content.' } }
				}
				const updated = {
					...current,
					content,
					byteLength: Buffer.byteLength(content),
					revision: 'updated-revision',
					contentHash: 'c'.repeat(64)
				}
				this.documents.set(key, updated)
				return { ok: true, value: { status: 'updated', file: fileEntry(updated) } }
			},
			patchFile: async ({
				id,
				path,
				expectedRevision,
				expectedContentHash,
				maximumBytes,
				edits
			}) => {
				const key = `${workspaceID}:${path}`
				const current = this.documents.get(key)
				if (!current || (id !== undefined && current.id !== id)) {
					return { ok: false, error: { code: 'not_found', message: 'Missing file.' } }
				}
				if (expectedRevision !== undefined && current.revision !== expectedRevision) {
					return { ok: false, error: { code: 'revision_conflict', message: 'Stale revision.' } }
				}
				if (expectedContentHash !== undefined && current.contentHash !== expectedContentHash) {
					return { ok: false, error: { code: 'content_conflict', message: 'Stale content.' } }
				}
				let content: string
				try {
					content = applyExactTextPatch(current.content, edits)
				} catch (error) {
					if (!(error instanceof ExactTextPatchError)) {
						throw error
					}
					const code =
						error.reason === 'not_found'
							? 'patch_not_found'
							: error.reason === 'ambiguous'
								? 'patch_ambiguous'
								: 'invalid_patch'
					return {
						ok: false,
						error: {
							code,
							message: error.message,
							...(error.editNumber === null ? {} : { editNumber: error.editNumber })
						}
					}
				}
				if (maximumBytes !== undefined && Buffer.byteLength(content) > maximumBytes) {
					return {
						ok: false,
						error: { code: 'too_large', message: 'Patched content is too large.' }
					}
				}
				if (content === current.content) {
					return { ok: true, value: { status: 'unchanged', file: fileEntry(current) } }
				}
				const updated = {
					...current,
					id: 'updated-document-id',
					content,
					byteLength: Buffer.byteLength(content),
					revision: current.revision,
					contentHash: 'c'.repeat(64)
				}
				this.documents.set(key, updated)
				return { ok: true, value: { status: 'patched', file: fileEntry(updated) } }
			},
			moveEntry: async () => unsupported(),
			deleteEntry: async () => unsupported()
		}
	}

	subscribe(listener: (change: WorkspaceChange) => void): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
}

function fileEntry(file: KnowledgeBundleFile): WorkspaceFileEntry {
	const entry = { ...file }
	delete (entry as { content?: string }).content
	return { ...entry, documentAccess: 'writable' }
}

function unsupported() {
	return Promise.resolve({
		ok: false as const,
		error: { code: 'unsupported' as const, message: 'Unsupported by the test bundle.' }
	})
}

async function createGateway(
	source: FakeGatewaySource,
	userDataPath?: string,
	codexSessionsRoot?: string
): Promise<{
	gateway: WorkspaceMCPGateway
	configStore: MCPConfigStore
	userDataPath: string
	stdioConfiguration: { command: string; args: string[]; env: Record<string, string> }
}> {
	const directory = userDataPath ?? (await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-mcp-')))
	if (!userDataPath) {
		temporaryDirectories.push(directory)
	}
	const configStore = new MCPConfigStore(path.join(directory, 'mcp', 'config.json'))
	const stdioConfiguration = {
		command: path.join(
			directory,
			'mcp',
			'bin',
			process.platform === 'win32' ? 'open-knowledge-mcp.cmd' : 'open-knowledge-mcp'
		),
		args: [],
		env: {}
	}
	const gateway = new WorkspaceMCPGateway(
		source,
		configStore,
		directory,
		stdioConfiguration,
		codexSessionsRoot
	)
	gateways.push(gateway)
	await gateway.initialize()
	return { gateway, configStore, userDataPath: directory, stdioConfiguration }
}

async function connect(details: {
	http: { url: string; bearerToken: string }
}): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
	const transport = new StreamableHTTPClientTransport(new URL(details.http.url), {
		requestInit: { headers: { Authorization: `Bearer ${details.http.bearerToken}` } }
	})
	const client = new Client({ name: 'open-knowledge-gateway-test', version: '1.0.0' })
	await client.connect(transport)
	return { client, transport }
}

function initializeBody(): string {
	return JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-11-25',
			capabilities: {},
			clientInfo: { name: 'security-test', version: '1.0.0' }
		}
	})
}

function connectionPath(userDataPath: string): string {
	return path.join(userDataPath, 'mcp', 'connection.json')
}

async function rejectedTokenStatus(url: string, token: string): Promise<number> {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: initializeBody()
	})
	return response.status
}

describe('workspace MCP gateway', () => {
	test('an unavailable memory provider cannot be enabled by a request or mutated configuration', async () => {
		const source = new FakeGatewaySource([alphaID])
		source.roots.set(alphaID, '/synthetic-project')
		const { gateway, configStore } = await createGateway(source)
		expect(gateway.memoryEnabled()).toBe(false)
		await expect(gateway.setMemoryEnabled(true)).rejects.toThrow('error.mcp.memory')
		expect(configStore.snapshot().codexSessionMemoryEnabled).toBe(false)
		// Even a caller that changes the store directly cannot manufacture an edition capability.
		await configStore.setCodexSessionMemoryEnabled(true)
		expect(gateway.memoryEnabled()).toBe(false)
		expect(gateway.status({ workspaceID: alphaID }).memoryEnabled).toBe(false)
		await expect(gateway.setMemoryEnabled(true)).rejects.toThrow('error.mcp.memory')
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		expect(gateway.status({ workspaceID: alphaID }).memoryEnabled).toBe(false)
		const { client } = await connect(await gateway.revealConnection({ workspaceID: alphaID }))
		try {
			const tools = (await client.listTools()).tools.map((tool) => tool.name)
			expect(tools).not.toContain('knowledge_list_memory_sessions')
			expect(tools).not.toContain('knowledge_search_memory')
			expect(tools).not.toContain('knowledge_get_memory_context')
			expect(tools).toContain('knowledge_search')
			await expect(
				client.callTool({
					name: 'knowledge_search_memory',
					arguments: { query: 'synthetic', mode: 'keyword' }
				})
			).rejects.toThrow('Tool knowledge_search_memory not found')
		} finally {
			await client.close()
		}
		await gateway.setMemoryEnabled(false)
		expect(configStore.snapshot().codexSessionMemoryEnabled).toBe(false)
	})

	test('startup revokes stale enabled memory and removes its cache when the provider is unavailable', async () => {
		const source = new FakeGatewaySource([alphaID])
		const original = await createGateway(source, undefined, '/synthetic-sessions')
		await original.gateway.update({ workspaceID: alphaID, access: 'read' })
		await original.gateway.setMemoryEnabled(true)
		await original.gateway.close()
		const cache = path.join(original.userDataPath, 'codex-memory-semantic-cache')
		await mkdir(cache, { recursive: true })
		await writeFile(path.join(cache, 'vectors.json'), '{}')
		const { gateway, configStore } = await createGateway(source, original.userDataPath)
		expect(gateway.memoryEnabled()).toBe(false)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			memoryEnabled: false,
			state: 'listening'
		})
		expect(configStore.snapshot()).toMatchObject({
			codexSessionMemoryEnabled: false,
			cacheCleanupPending: false
		})
		expect(
			JSON.parse(await readFile(path.join(original.userDataPath, 'mcp', 'config.json'), 'utf8'))
				.codexSessionMemoryEnabled
		).toBe(false)
		await expect(stat(cache)).rejects.toThrow()
		const { client } = await connect(await gateway.revealConnection({ workspaceID: alphaID }))
		try {
			expect(
				(await client.listTools()).tools.some((tool) => tool.name === 'knowledge_search_memory')
			).toBe(false)
		} finally {
			await client.close()
		}
	})

	test('a failed unsupported-memory startup cleanup stays revoked and retries before listening', async () => {
		const source = new FakeGatewaySource([alphaID])
		const original = await createGateway(source, undefined, '/synthetic-sessions')
		await original.gateway.update({ workspaceID: alphaID, access: 'read' })
		await original.gateway.setMemoryEnabled(true)
		await original.gateway.close()
		const clear = spyOn(LocalSemanticSearch.prototype, 'clear').mockRejectedValueOnce(
			new Error('cache unavailable')
		)
		try {
			const { gateway, configStore } = await createGateway(source, original.userDataPath)
			expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
				memoryEnabled: false,
				state: 'error',
				httpURL: null
			})
			expect(configStore.snapshot()).toMatchObject({
				codexSessionMemoryEnabled: false,
				cacheCleanupPending: true
			})
			await gateway.close()
		} finally {
			clear.mockRestore()
		}
		const { gateway, configStore } = await createGateway(source, original.userDataPath)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			memoryEnabled: false,
			state: 'listening'
		})
		expect(configStore.snapshot().cacheCleanupPending).toBe(false)
	})

	for (const failurePoint of [1, 2]) {
		test(`rejects memory when root authorization fails at snapshot check ${failurePoint}`, async () => {
			const source = new FakeGatewaySource([alphaID])
			source.roots.set(alphaID, '/synthetic-project')
			const bundle = source.mcpBundle(alphaID)
			const sourceBundle = spyOn(source, 'mcpBundle').mockReturnValue(bundle)
			const snapshot = spyOn(CodexSessionMemory.prototype, 'snapshot').mockResolvedValue({
				complete: true,
				warnings: [],
				sessions: [
					{
						id: 'synthetic-session',
						warnings: [],
						turns: [{ index: 0, role: 'user', text: 'synthetic-history-never-returned' }]
					}
				]
			})
			const { gateway } = await createGateway(source, undefined, '/synthetic-sessions')
			await gateway.update({ workspaceID: alphaID, access: 'read' })
			await gateway.setMemoryEnabled(true)
			const { client } = await connect(await gateway.revealConnection({ workspaceID: alphaID }))
			const originalGetInfo = bundle.getInfo.bind(bundle)
			let checks = 0
			const getInfo = spyOn(bundle, 'getInfo').mockImplementation(async () => {
				checks++
				if (checks === failurePoint) {
					throw new Error('error.mutation.workspace.root-changed')
				}
				return originalGetInfo()
			})
			try {
				const result = await client.callTool({
					name: 'knowledge_search_memory',
					arguments: { query: 'synthetic', mode: 'keyword' }
				})
				expect(result.isError).toBe(true)
				expect(JSON.stringify(result)).not.toContain('synthetic-history-never-returned')
				expect(getInfo).toHaveBeenCalledTimes(failurePoint)
				expect(snapshot).toHaveBeenCalledTimes(failurePoint - 1)
			} finally {
				getInfo.mockRestore()
				sourceBundle.mockRestore()
				snapshot.mockRestore()
				await client.close()
			}
		})
	}
	test('disabling memory aborts an in-flight snapshot and rejects the previous client', async () => {
		const source = new FakeGatewaySource([alphaID])
		source.roots.set(alphaID, '/synthetic-project')
		let startedResolve!: () => void
		const started = new Promise<void>((resolve) => {
			startedResolve = resolve
		})
		let capturedSignal: AbortSignal | undefined
		const snapshot = spyOn(CodexSessionMemory.prototype, 'snapshot').mockImplementation(
			async (_root, signal) => {
				capturedSignal = signal
				startedResolve()
				return await new Promise<never>((_, reject) => {
					if (signal.aborted) {
						reject(signal.reason)
						return
					}
					signal.addEventListener('abort', () => reject(signal.reason), { once: true })
				})
			}
		)
		const { gateway } = await createGateway(source, undefined, '/synthetic-sessions')
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		await gateway.setMemoryEnabled(true)
		const { client } = await connect(await gateway.revealConnection({ workspaceID: alphaID }))
		try {
			const pending = client
				.callTool({ name: 'knowledge_list_memory_sessions', arguments: {} })
				.then(
					() => 'fulfilled',
					() => 'rejected'
				)
			await started
			await gateway.setMemoryEnabled(false)
			expect(capturedSignal?.aborted).toBe(true)
			await expect(client.ping()).rejects.toThrow()
			expect(snapshot).toHaveBeenCalledTimes(1)
			// A Streamable HTTP client may retain a closed POST until its request timeout.
			// The old session is already rejected and server-side work has been aborted.
			await client.close()
			expect(await pending).toBe('rejected')
		} finally {
			snapshot.mockRestore()
			await client.close()
		}
	})
	test('persists revocation even when cache cleanup fails and cannot reactivate it on restart', async () => {
		const source = new FakeGatewaySource([alphaID, betaID])
		const { gateway, userDataPath } = await createGateway(source, undefined, '/synthetic-sessions')
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		await gateway.update({ workspaceID: betaID, access: 'read' })
		await gateway.setMemoryEnabled(true)
		const cache = path.join(userDataPath, 'codex-memory-semantic-cache')
		await mkdir(cache, { recursive: true })
		await writeFile(path.join(cache, 'vectors.json'), '{}')
		const clear = spyOn(LocalSemanticSearch.prototype, 'clear').mockRejectedValueOnce(
			new Error('cache unavailable')
		)
		try {
			await expect(gateway.update({ workspaceID: alphaID, access: 'off' })).rejects.toThrow()
			expect(
				JSON.parse(await readFile(path.join(userDataPath, 'mcp', 'config.json'), 'utf8')).grants
			).toEqual({ [betaID]: 'read' })
		} finally {
			clear.mockRestore()
		}
		await gateway.close()
		const restarted = await createGateway(source, userDataPath)
		expect(restarted.gateway.status({ workspaceID: alphaID }).access).toBe('off')
		expect(restarted.gateway.status({ workspaceID: alphaID }).state).toBe('disabled')
		expect(restarted.gateway.status({ workspaceID: betaID }).state).toBe('listening')
		await expect(stat(cache)).rejects.toThrow()
		expect(
			JSON.parse(await readFile(path.join(userDataPath, 'mcp', 'config.json'), 'utf8'))
				.cacheCleanupPending
		).toBe(false)
	})
	test('session memory is opt-in, project-scoped, revoked live, and its derived cache is cleared', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'ok-memory-gateway-'))
		temporaryDirectories.push(directory)
		const sessionsRoot = path.join(directory, 'sessions')
		const project = path.join(directory, 'project')
		const otherProject = path.join(directory, 'other-project')
		await Promise.all([sessionsRoot, project, otherProject].map((item) => mkdir(item)))
		for (const [id, cwd, text] of [
			['allowed', project, 'Use an out-of-sample holdout.'],
			['private', otherProject, 'Unrelated private project.']
		]) {
			await writeFile(
				path.join(sessionsRoot, `rollout-${id}.jsonl`),
				[
					{ type: 'session_meta', payload: { id, cwd } },
					{
						type: 'response_item',
						payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
					}
				]
					.map((item) => JSON.stringify(item))
					.join('\n')
			)
		}
		const source = new FakeGatewaySource([alphaID])
		source.roots.set(alphaID, project)
		const { gateway, userDataPath } = await createGateway(
			source,
			path.join(directory, 'data'),
			sessionsRoot
		)
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		const details = await gateway.revealConnection({ workspaceID: alphaID })
		const disabled = await connect(details)
		expect(
			(await disabled.client.listTools()).tools.some(
				(tool) => tool.name === 'knowledge_search_memory'
			)
		).toBe(false)
		await gateway.setMemoryEnabled(true)
		expect(gateway.memoryEnabled()).toBe(true)
		await disabled.client.close()
		const enabled = await connect(details)
		try {
			const result = await enabled.client.callTool({
				name: 'knowledge_search_memory',
				arguments: { query: 'holdout', mode: 'keyword' }
			})
			expect(result.isError).not.toBe(true)
			expect(JSON.stringify(result)).toContain('out-of-sample holdout')
			expect(JSON.stringify(result)).not.toContain('Unrelated private')
			expect(JSON.stringify(result)).not.toContain(project)
			const cache = path.join(userDataPath, 'codex-memory-semantic-cache')
			await mkdir(cache, { recursive: true })
			await writeFile(path.join(cache, 'vectors.json'), '{}')
			await gateway.setMemoryEnabled(false)
			await expect(stat(cache)).rejects.toThrow()
			expect(gateway.memoryEnabled()).toBe(false)
		} finally {
			await enabled.client.close()
		}
		const revoked = await connect(details)
		try {
			expect(
				(await revoked.client.listTools()).tools.some(
					(tool) => tool.name === 'knowledge_search_memory'
				)
			).toBe(false)
		} finally {
			await revoked.client.close()
		}
	})
	test('is default-off and exposes one owner-only shared endpoint and connection file', async () => {
		const source = new FakeGatewaySource([alphaID])
		const { gateway, stdioConfiguration, userDataPath } = await createGateway(source)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			globalEnabled: true,
			access: 'off',
			workspaceCount: 0,
			state: 'disabled',
			httpURL: null
		})

		const status = await gateway.update({ workspaceID: alphaID, access: 'read' })
		expect(status).toMatchObject({
			globalEnabled: true,
			access: 'read',
			workspaceCount: 1,
			state: 'listening'
		})
		const details = await gateway.revealConnection({ workspaceID: alphaID })
		if (!status.httpURL || !status.profileID) {
			throw new Error('Expected an active shared profile.')
		}
		expect(details.workspaceCount).toBe(1)
		expect(details.http.url).toBe(status.httpURL)
		expect(details.stdio).toEqual(stdioConfiguration)

		const filePath = connectionPath(userDataPath)
		const connectionFile = await readMCPConnectionFile(filePath)
		expect(connectionFile).toMatchObject({
			profileID: status.profileID,
			token: details.http.bearerToken
		})
		if (process.platform !== 'win32') {
			expect((await stat(filePath)).mode & 0o777).toBe(0o600)
		}

		const { client, transport } = await connect(details)
		try {
			const result = await client.callTool({ name: 'knowledge_bundle_info', arguments: {} })
			expect(result.structuredContent).toMatchObject({
				workspace_ref: expect.stringMatching(/^ws_[A-Za-z0-9_-]{43}$/),
				label: 'Product Notes',
				access: 'readonly',
				metadata: { title: 'Product Notes' }
			})
			const output = JSON.stringify(result)
			expect(output).not.toContain(alphaID)
			expect(output).not.toContain('/private/root-0')
		} finally {
			await transport.terminateSession()
			await client.close()
		}
	})

	test('preserves the credential and endpoint but revokes sessions when access changes', async () => {
		const source = new FakeGatewaySource([alphaID])
		const { gateway } = await createGateway(source)
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		const readOnly = await gateway.revealConnection({ workspaceID: alphaID })
		const session = await connect(readOnly)
		const readOnlyTools = (await session.client.listTools()).tools.map(({ name }) => name)
		expect(readOnlyTools).not.toContain('knowledge_create_directory')
		expect(readOnlyTools).not.toContain('knowledge_create_document')
		expect(readOnlyTools).not.toContain('knowledge_patch_document')
		expect(readOnlyTools).not.toContain('knowledge_update_document')

		const status = await gateway.update({ workspaceID: alphaID, access: 'write' })
		expect(status).toMatchObject({ globalEnabled: true, access: 'write' })
		const editable = await gateway.revealConnection({ workspaceID: alphaID })
		expect(editable.http).toEqual(readOnly.http)
		expect(editable.credentialRevision).toBe(readOnly.credentialRevision)
		await expect(session.client.ping()).rejects.toThrow()
		await session.client.close()

		const editableSession = await connect(editable)
		try {
			const tools = (await editableSession.client.listTools()).tools.map(({ name }) => name)
			expect(tools).toContain('knowledge_create_directory')
			expect(tools).toContain('knowledge_create_document')
			expect(tools).toContain('knowledge_patch_document')
			expect(tools).toContain('knowledge_update_document')
			const boundaryMarkdown = '\u0001'.repeat(maximumDocumentBytes)
			const created = await editableSession.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/request-boundary.md', markdown: boundaryMarkdown }
			})
			expect(created.isError).not.toBe(true)
			expect(created.structuredContent).toMatchObject({
				path: '/request-boundary.md',
				byte_length: maximumDocumentBytes
			})
		} finally {
			await editableSession.transport.terminateSession()
			await editableSession.client.close()
		}
	})

	test('preserves one credential and endpoint on add and remove while isolating workspaces', async () => {
		const source = new FakeGatewaySource([alphaID, betaID])
		const { gateway, userDataPath } = await createGateway(source)
		const statusChanges: Array<{
			workspaceID: string
			workspaceCount: number
			globalEnabled: boolean
			access: 'off' | 'read' | 'write'
		}> = []
		gateway.subscribe(({ workspaceID, workspaceCount, globalEnabled, access }) => {
			statusChanges.push({ workspaceID, workspaceCount, globalEnabled, access })
		})
		const alphaStatus = await gateway.update({ workspaceID: alphaID, access: 'read' })
		expect(statusChanges).toContainEqual({
			workspaceID: betaID,
			workspaceCount: 1,
			globalEnabled: true,
			access: 'off'
		})
		const initial = await gateway.revealConnection({ workspaceID: alphaID })
		const initialPath = connectionPath(userDataPath)
		const oldSession = await connect(initial)

		const betaStatus = await gateway.update({ workspaceID: betaID, access: 'read' })
		expect(betaStatus).toMatchObject({
			globalEnabled: true,
			access: 'read',
			workspaceCount: 2,
			profileID: alphaStatus.profileID,
			httpURL: alphaStatus.httpURL
		})
		const shared = await gateway.revealConnection({ workspaceID: betaID })
		expect(shared.http).toEqual(initial.http)
		expect(shared.credentialRevision).toBe(initial.credentialRevision)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			access: 'read',
			workspaceCount: 2
		})
		await expect(oldSession.client.ping()).rejects.toThrow()
		await oldSession.client.close()

		const twoWorkspaceSession = await connect(shared)
		const listed = await twoWorkspaceSession.client.callTool({
			name: 'knowledge_list_workspaces',
			arguments: {}
		})
		const listedWorkspaces = (
			listed.structuredContent as {
				workspaces: Array<{ workspace_ref: string; label: string }>
			}
		).workspaces
		expect(listedWorkspaces.map(({ label }) => label)).toEqual(['Product Notes', 'Research Notes'])
		const alphaRef = listedWorkspaces[0]?.workspace_ref
		const betaRef = listedWorkspaces[1]?.workspace_ref
		if (!alphaRef || !betaRef) {
			throw new Error('Expected two opaque workspace references.')
		}
		const [alpha, beta] = await Promise.all([
			twoWorkspaceSession.client.callTool({
				name: 'knowledge_get_document',
				arguments: { workspace_ref: alphaRef, path: relativePath }
			}),
			twoWorkspaceSession.client.callTool({
				name: 'knowledge_get_document',
				arguments: { workspace_ref: betaRef, path: relativePath }
			})
		])
		expect(alpha.structuredContent).toMatchObject({
			workspace_ref: alphaRef,
			document_access: 'readonly',
			representation: 'source_markdown',
			markdown_byte_length: 52
		})
		expect(beta.structuredContent).toMatchObject({
			workspace_ref: betaRef,
			document_access: 'readonly',
			representation: 'source_markdown',
			markdown_byte_length: 52
		})
		expect(alpha.content).toEqual([
			{ type: 'text', text: '# Product Guide\n\nKnowledge from the alpha workspace.' }
		])
		expect(beta.content).toEqual([
			{ type: 'text', text: '# Research Guide\n\nKnowledge from the beta workspace.' }
		])
		expect((alpha.structuredContent as Record<string, unknown>).markdown).toBeUndefined()
		expect((beta.structuredContent as Record<string, unknown>).markdown).toBeUndefined()
		const protocolOutput = JSON.stringify([listed, alpha, beta])
		expect(protocolOutput).not.toContain(alphaID)
		expect(protocolOutput).not.toContain(betaID)
		expect(protocolOutput).not.toContain('/private/root-')

		const removed = await gateway.update({ workspaceID: alphaID, access: 'off' })
		expect(removed).toMatchObject({
			globalEnabled: true,
			access: 'off',
			workspaceCount: 1,
			state: 'disabled'
		})
		const betaOnly = await gateway.revealConnection({ workspaceID: betaID })
		expect(betaOnly.http).toEqual(shared.http)
		expect(betaOnly.credentialRevision).toBe(shared.credentialRevision)
		expect((await readMCPConnectionFile(initialPath)).token).toBe(initial.http.bearerToken)
		await expect(twoWorkspaceSession.client.ping()).rejects.toThrow()
		await twoWorkspaceSession.client.close()

		const betaSession = await connect(betaOnly)
		try {
			const afterRemoval = await betaSession.client.callTool({
				name: 'knowledge_list_workspaces',
				arguments: {}
			})
			expect(afterRemoval.structuredContent).toEqual({
				workspaces: [{ workspace_ref: betaRef, label: 'Research Notes', access: 'readonly' }]
			})
		} finally {
			await betaSession.transport.terminateSession()
			await betaSession.client.close()
		}
	})

	test('preserves a credential across restart and removal of the final grant', async () => {
		const source = new FakeGatewaySource([alphaID])
		const first = await createGateway(source)
		const initialStatus = await first.gateway.update({ workspaceID: alphaID, access: 'read' })
		const initial = await first.gateway.revealConnection({ workspaceID: alphaID })
		const filePath = connectionPath(first.userDataPath)
		const secretPath = path.join(
			first.userDataPath,
			'mcp',
			'secrets',
			`${initialStatus.profileID}.token`
		)

		await first.gateway.close()
		const second = await createGateway(source, first.userDataPath)
		const restarted = await second.gateway.revealConnection({ workspaceID: alphaID })
		expect(restarted.http.bearerToken).toBe(initial.http.bearerToken)

		const session = await connect(restarted)
		const removed = await second.gateway.update({ workspaceID: alphaID, access: 'off' })
		expect(removed).toMatchObject({
			globalEnabled: true,
			access: 'off',
			workspaceCount: 0,
			profileID: initialStatus.profileID,
			state: 'disabled',
			httpURL: null
		})
		await expect(session.client.ping()).rejects.toThrow()
		await session.client.close()
		await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
		expect((await readFile(secretPath, 'utf8')).trim()).toBe(initial.http.bearerToken)
		await expect(second.gateway.revealConnection({ workspaceID: alphaID })).rejects.toThrow(
			'error.mcp.connection.not-listening'
		)

		await second.gateway.close()
		const third = await createGateway(source, first.userDataPath)
		expect(third.gateway.status({ workspaceID: alphaID })).toMatchObject({
			globalEnabled: true,
			access: 'off',
			workspaceCount: 0,
			state: 'disabled'
		})
		const reenabledStatus = await third.gateway.update({ workspaceID: alphaID, access: 'read' })
		const reenabled = await third.gateway.revealConnection({ workspaceID: alphaID })
		expect(reenabledStatus.profileID).toBe(initialStatus.profileID)
		expect(reenabled.http.bearerToken).toBe(initial.http.bearerToken)
	})

	test('globally pauses and resumes existing grants without replacing the credential', async () => {
		const source = new FakeGatewaySource([alphaID])
		const { gateway, userDataPath } = await createGateway(source)
		const activeStatus = await gateway.update({ workspaceID: alphaID, access: 'write' })
		const active = await gateway.revealConnection({ workspaceID: alphaID })
		const filePath = connectionPath(userDataPath)
		const secretPath = path.join(userDataPath, 'mcp', 'secrets', `${activeStatus.profileID}.token`)
		const session = await connect(active)

		await gateway.setEnabled(false)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			globalEnabled: false,
			access: 'write',
			workspaceCount: 1,
			profileID: activeStatus.profileID,
			state: 'disabled',
			httpURL: null
		})
		await expect(session.client.ping()).rejects.toThrow()
		await session.client.close()
		await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
		expect((await readFile(secretPath, 'utf8')).trim()).toBe(active.http.bearerToken)
		await gateway.setEnabled(true)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			globalEnabled: true,
			access: 'write',
			workspaceCount: 1,
			profileID: activeStatus.profileID,
			state: 'listening'
		})
		const resumed = await gateway.revealConnection({ workspaceID: alphaID })
		expect(resumed.http.bearerToken).toBe(active.http.bearerToken)
		expect((await readMCPConnectionFile(filePath)).token).toBe(active.http.bearerToken)
	})

	test('regenerates the global credential and revokes every active session', async () => {
		const source = new FakeGatewaySource([alphaID, betaID])
		const { gateway, userDataPath } = await createGateway(source)
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		await gateway.update({ workspaceID: betaID, access: 'read' })
		const before = await gateway.revealConnection({ workspaceID: alphaID })
		const connection = await connect(before)

		const regenerated = await gateway.regenerateCredential({ workspaceID: betaID })
		expect(regenerated.workspaceCount).toBe(2)
		expect(regenerated.http.url).toBe(before.http.url)
		expect(regenerated.http.bearerToken).not.toBe(before.http.bearerToken)
		expect(regenerated.credentialRevision).not.toBe(before.credentialRevision)
		expect((await readMCPConnectionFile(connectionPath(userDataPath))).token).toBe(
			regenerated.http.bearerToken
		)
		await expect(connection.client.ping()).rejects.toThrow()
		await connection.client.close()
		expect(await rejectedTokenStatus(regenerated.http.url, before.http.bearerToken)).toBe(401)
	})

	test('prunes stale grants before activating the shared profile', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-mcp-'))
		temporaryDirectories.push(directory)
		const configPath = path.join(directory, 'mcp', 'config.json')
		const config = new MCPConfigStore(configPath)
		await config.load()
		await config.setGrant('missing-workspace', 'write')

		const source = new FakeGatewaySource([alphaID])
		const { gateway } = await createGateway(source, directory)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			access: 'off',
			workspaceCount: 0,
			state: 'disabled'
		})
		expect(JSON.parse(await readFile(configPath, 'utf8')).grants).toEqual({})
	})

	test('rolls back a grant if its workspace is evicted while the grant is saved', async () => {
		const source = new FakeGatewaySource([alphaID, betaID])
		const { gateway, userDataPath } = await createGateway(source)
		await gateway.update({ workspaceID: betaID, access: 'read' })
		const before = await gateway.revealConnection({ workspaceID: betaID })

		const configPath = path.join(userDataPath, 'mcp', 'config.json')
		const originalSetGrant = MCPConfigStore.prototype.setGrant
		const setGrant = spyOn(MCPConfigStore.prototype, 'setGrant').mockImplementation(async function (
			this: MCPConfigStore,
			workspaceID,
			access
		) {
			const saved = await originalSetGrant.call(this, workspaceID, access)
			if (workspaceID === alphaID && access === 'write') {
				// Evict after the real save, before the gateway resumes its post-save check.
				expect(JSON.parse(await readFile(configPath, 'utf8')).grants).toEqual({
					[betaID]: 'read',
					[alphaID]: 'write'
				})
				source.removeWorkspace(alphaID)
			}
			return saved
		})
		try {
			await expect(gateway.update({ workspaceID: alphaID, access: 'write' })).rejects.toThrow(
				'error.mcp.workspace.not-recent'
			)
			expect(setGrant).toHaveBeenCalledWith(alphaID, null)
		} finally {
			setGrant.mockRestore()
		}

		const config = JSON.parse(await readFile(configPath, 'utf8'))
		expect(config.grants).toEqual({ [betaID]: 'read' })
		const after = await gateway.revealConnection({ workspaceID: betaID })
		expect(after.http).toEqual(before.http)
	})

	test('does not rotate a configured credential when its secret material is unavailable', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-mcp-'))
		temporaryDirectories.push(directory)
		const configPath = path.join(directory, 'mcp', 'config.json')
		const config = new MCPConfigStore(configPath)
		await config.load()
		await config.setGrant(alphaID, 'read')
		await config.setCredentialDigest('a'.repeat(64))

		const source = new FakeGatewaySource([alphaID])
		const { gateway } = await createGateway(source, directory)
		expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
			access: 'read',
			state: 'error',
			message: 'error.mcp.start'
		})
		await expect(gateway.update({ workspaceID: alphaID, access: 'read' })).rejects.toThrow(
			'error.mcp.start'
		)
		expect(JSON.parse(await readFile(configPath, 'utf8')).credentialDigest).toBe('a'.repeat(64))
		await expect(
			stat(path.join(directory, 'mcp', 'secrets', `${config.snapshot().profileID}.token`))
		).rejects.toMatchObject({ code: 'ENOENT' })
	})

	test('fails MCP closed without preventing startup when its private config is malformed', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-mcp-'))
		temporaryDirectories.push(directory)
		const configPath = path.join(directory, 'mcp', 'config.json')
		await mkdir(path.dirname(configPath), { recursive: true })
		await writeFile(configPath, '{')
		const log = spyOn(console, 'error').mockImplementation(() => undefined)
		try {
			const source = new FakeGatewaySource([alphaID])
			const { gateway } = await createGateway(source, directory)
			expect(gateway.status({ workspaceID: alphaID })).toMatchObject({
				state: 'error',
				message: 'error.mcp.unavailable'
			})
			await expect(gateway.update({ workspaceID: alphaID, access: 'read' })).rejects.toThrow(
				'error.mcp.unavailable'
			)
			expect(await readFile(configPath, 'utf8')).toBe('{')
		} finally {
			log.mockRestore()
		}
	})

	test('rejects missing credentials, browser origins, wrong hosts, malformed JSON, and oversized bodies', async () => {
		const source = new FakeGatewaySource([alphaID])
		const { gateway } = await createGateway(source)
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		const details = await gateway.revealConnection({ workspaceID: alphaID })

		const missingCredential = await fetch(details.http.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: initializeBody()
		})
		expect(missingCredential.status).toBe(401)
		expect(missingCredential.headers.get('cache-control')).toBe('no-store')
		expect(missingCredential.headers.get('x-content-type-options')).toBe('nosniff')

		const browserOrigin = await fetch(details.http.url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Type': 'application/json',
				Origin: 'https://attacker.example'
			},
			body: initializeBody()
		})
		expect(browserOrigin.status).toBe(403)

		const wrongHost = await fetch(details.http.url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Type': 'application/json',
				Host: 'localhost'
			},
			body: initializeBody()
		})
		expect(wrongHost.status).toBe(403)

		const trailingSlash = await fetch(`${details.http.url}/`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Type': 'application/json'
			},
			body: initializeBody()
		})
		expect(trailingSlash.status).toBe(404)

		const incompleteAccept = await fetch(details.http.url, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Type': 'application/json'
			},
			body: initializeBody()
		})
		expect(incompleteAccept.status).toBe(406)

		const compressed = await fetch(details.http.url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Encoding': 'gzip',
				'Content-Type': 'application/json'
			},
			body: initializeBody()
		})
		expect(compressed.status).toBe(415)

		const unknownSession = await fetch(details.http.url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Type': 'application/json',
				'Mcp-Session-Id': randomUUID()
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })
		})
		expect(unknownSession.status).toBe(404)

		const malformed = await fetch(details.http.url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Type': 'application/json'
			},
			body: '{'
		})
		expect(malformed.status).toBe(400)

		const oversized = await fetch(details.http.url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${details.http.bearerToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ value: 'x'.repeat(7 * 1024 * 1024) })
		})
		expect(oversized.status).toBe(413)
	})

	test('proxies one shared command-launched stdio connection through the HTTP gateway', async () => {
		const source = new FakeGatewaySource([alphaID, betaID])
		const { gateway, userDataPath } = await createGateway(source)
		await gateway.update({ workspaceID: alphaID, access: 'read' })
		await gateway.update({ workspaceID: betaID, access: 'read' })
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [path.join(import.meta.dir, 'stdio-bridge.ts')],
			env: {
				...getDefaultEnvironment(),
				[mcpConnectionFileEnvironment]: connectionPath(userDataPath)
			},
			stderr: 'pipe'
		})
		const client = new Client({ name: 'stdio-proxy-test', version: '1.0.0' })
		try {
			await client.connect(transport)
			const result = await client.callTool({
				name: 'knowledge_list_workspaces',
				arguments: {}
			})
			expect(result.structuredContent).toMatchObject({
				workspaces: [{ label: 'Product Notes' }, { label: 'Research Notes' }]
			})
		} finally {
			await client.close()
		}
	})
})
