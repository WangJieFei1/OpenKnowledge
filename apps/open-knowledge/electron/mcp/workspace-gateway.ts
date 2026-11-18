import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	rm,
	type FileHandle
} from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import * as v from 'valibot'
import { getRequestListener, type HttpBindings } from '@hono/node-server'
import {
	isInitializeRequest,
	WebStandardStreamableHTTPServerTransport
} from '@modelcontextprotocol/server'
import type {
	EditableKnowledgeBundle,
	ReadonlyKnowledgeBundle
} from '@open-knowledge/knowledge-bundle-api'
import {
	createKnowledgeBundleMCPServer,
	maximumDocumentBytes,
	type KnowledgeBundleMCPDocumentReader,
	type KnowledgeBundleMCPGrant,
	type KnowledgeBundleMCPSearcher
} from '@open-knowledge/knowledge-bundle-mcp'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { KnowledgeSearchResult, WorkspaceChange } from '../../src/lib/knowledge/api'
import type {
	MCPAccess,
	MCPConnectionDetails,
	MCPMessageID,
	MCPWorkspaceInput,
	MCPWorkspaceStatus,
	UpdateMCPWorkspaceInput
} from '../../src/lib/mcp/api'
import { LocalSemanticSearch } from '../semantic/local-search'
import { createSessionMemory, type SessionMemoryProvider } from '../memory/session-memory-provider'
import { errorMessage, nodeErrorCode } from '../validation'
import { MCPConnectionTokenSchema, type MCPConnectionFile } from './connection-file'
import { MCPConfigStore, type MCPConfig } from './mcp-config-store'

const loopbackAddress = '127.0.0.1'
// JSON escaping can expand one valid UTF-8 Markdown byte to six request bytes.
const maximumRequestBytes = maximumDocumentBytes * 6 + 64 * 1024
const maximumSessions = 64
const sessionIdleMilliseconds = 30 * 60 * 1000
const cleanupIntervalMilliseconds = 60 * 1000
const privateDirectoryMode = 0o700
const privateFileMode = 0o600
const MCPSessionIDSchema = v.pipe(
	v.string(),
	v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
)
const ContentLengthSchema = v.pipe(
	v.string(),
	v.regex(/^\d+$/),
	v.transform(Number),
	v.maxValue(maximumRequestBytes)
)

interface MCPGatewaySource {
	workspaceRoot?(workspaceID: string): string | null
	mcpBundle(workspaceID: string): EditableKnowledgeBundle
	mcpReadDocument(
		workspaceID: string,
		...args: Parameters<KnowledgeBundleMCPDocumentReader>
	): ReturnType<KnowledgeBundleMCPDocumentReader>
	mcpSearch(
		workspaceID: string,
		input: Parameters<KnowledgeBundleMCPSearcher>[0],
		signal: AbortSignal
	): Promise<KnowledgeSearchResult>
	mcpWorkspaceLabel(workspaceID: string): string | null
	mcpWorkspaceIDs(): string[]
	subscribe(listener: (change: WorkspaceChange) => void): () => void
}

type GatewayGrant = KnowledgeBundleMCPGrant & { readonly workspaceID: string }

type GatewayGrantMap = ReadonlyMap<string, GatewayGrant>

type ActiveProfile = {
	profileID: string
	token: string
	digest: Buffer
	credentialRevision: string
	connectionFilePath: string
	grants: GatewayGrantMap
}

type SessionRecord = {
	profileID: string
	credentialDigest: Buffer
	grants: GatewayGrantMap
	server: ReturnType<typeof createKnowledgeBundleMCPServer>
	transport: WebStandardStreamableHTTPServerTransport
	sessionID: string | null
	activeRequests: number
	lastActivity: number
}

type StatusListener = (status: MCPWorkspaceStatus) => void
type MCPHonoEnvironment = { Bindings: HttpBindings }
type MCPHonoContext = Context<MCPHonoEnvironment>

export class WorkspaceMCPGateway {
	private readonly semantic: LocalSemanticSearch
	private readonly memorySemantic: LocalSemanticSearch
	private readonly sessionMemoryProvider: SessionMemoryProvider | undefined
	private readonly instanceID = randomUUID()
	private readonly mcpRoot: string
	private readonly secretDirectory: string
	private readonly connectionFilePath: string
	private readonly sessions = new Map<string, SessionRecord>()
	private readonly sessionRecords = new Set<SessionRecord>()
	private readonly listeners = new Set<StatusListener>()
	private activeProfile: ActiveProfile | undefined
	private errorMessage: MCPMessageID | null = null
	private httpServer: Server | undefined
	private port: number | undefined
	private cleanupTimer: ReturnType<typeof setInterval> | undefined
	private unsubscribeWorkspace: (() => void) | undefined
	private operationTail = Promise.resolve()
	private acceptingRequests = false
	private available = false
	private disposed = false

	constructor(
		private readonly source: MCPGatewaySource,
		private readonly config: MCPConfigStore,
		userDataPath: string,
		private readonly stdio: MCPConnectionDetails['stdio'],
		codexSessionsRoot?: string
	) {
		this.semantic = new LocalSemanticSearch(path.join(userDataPath, 'semantic-cache'))
		this.memorySemantic = new LocalSemanticSearch(
			path.join(userDataPath, 'codex-memory-semantic-cache')
		)
		this.sessionMemoryProvider = createSessionMemory(codexSessionsRoot)
		this.mcpRoot = path.join(userDataPath, 'mcp')
		this.secretDirectory = path.join(this.mcpRoot, 'secrets')
		this.connectionFilePath = path.join(this.mcpRoot, 'connection.json')
	}

	async initialize(): Promise<void> {
		await this.exclusive(async () => {
			let config: MCPConfig
			let grantsPruned: boolean
			try {
				config = await this.config.load()
				if (!this.sessionMemoryProvider && config.codexSessionMemoryEnabled) {
					// A copied or stale Codex configuration cannot grant this edition a capability.
					// Persist revocation before cleanup; a failure must leave the gateway closed.
					config = await this.config.setCodexSessionMemoryEnabled(false)
				}
				const previousGrantCount = grantCount(config)
				config = await this.config.pruneGrants(new Set(this.source.mcpWorkspaceIDs()))
				grantsPruned = grantCount(config) !== previousGrantCount
				this.available = true
			} catch (error) {
				this.available = false
				this.errorMessage = 'error.mcp.unavailable'
				console.error('MCP configuration could not be loaded.', error)
				return
			}
			this.unsubscribeWorkspace = this.source.subscribe((change) => {
				this.notifyWorkspaceChanged(change)
			})
			try {
				await ensurePrivateDirectory(this.mcpRoot)
				await ensurePrivateDirectory(this.secretDirectory)
				// Startup also retries cleanup after interrupted or failed revocations.
				if (
					config.cacheCleanupPending ||
					grantsPruned ||
					!config.enabled ||
					grantCount(config) === 0
				) {
					await this.clearDerivedCaches()
					config = this.config.snapshot()
				} else if (!config.codexSessionMemoryEnabled) {
					await this.memorySemantic.clear()
				}
				await rm(this.connectionFilePath, { recursive: true, force: true })
				await removeObsoleteSecretMaterial(this.secretDirectory, config.profileID)
				if (config.enabled && grantCount(config) > 0) {
					await this.activate(config)
				}
				this.errorMessage = null
			} catch {
				this.errorMessage = config.enabled && grantCount(config) > 0 ? 'error.mcp.start' : null
				await this.stopHTTPServer().catch(() => undefined)
			}
			this.cleanupTimer = setInterval(() => {
				void this.cleanupIdleSessions()
			}, cleanupIntervalMilliseconds)
			this.cleanupTimer.unref()
		})
	}

	status(input: MCPWorkspaceInput): MCPWorkspaceStatus {
		return this.workspaceStatus(input.workspaceID)
	}

	enabled(): boolean {
		return this.config.snapshot().enabled
	}

	memoryEnabled(): boolean {
		return Boolean(this.sessionMemoryProvider && this.config.snapshot().codexSessionMemoryEnabled)
	}

	async update(input: UpdateMCPWorkspaceInput): Promise<MCPWorkspaceStatus> {
		return this.exclusive(async () => {
			this.assertAvailable()
			if (!this.source.mcpWorkspaceIDs().includes(input.workspaceID)) {
				throw mcpError('error.mcp.workspace.not-recent')
			}
			const current = this.config.snapshot()
			if (accessFor(current, input.workspaceID) === input.access) {
				if (current.enabled && input.access !== 'off' && !this.activeProfile) {
					try {
						await this.activate(current)
						this.errorMessage = null
						this.emit()
					} catch {
						this.errorMessage = 'error.mcp.start'
						await this.stopHTTPServer().catch(() => undefined)
						this.emit()
						throw mcpError('error.mcp.start')
					}
				}
				return this.workspaceStatus(input.workspaceID)
			}

			try {
				this.acceptingRequests = false
				await this.closeAllSessions()
				let next = await this.config.setGrant(
					input.workspaceID,
					input.access === 'off' ? null : input.access
				)
				// Persist revocation before fallible derived-cache cleanup, including across restarts.
				await this.clearDerivedCaches()
				if (!this.source.mcpWorkspaceIDs().includes(input.workspaceID)) {
					next = await this.config.setGrant(input.workspaceID, null)
					await this.applyConfig(next)
					this.errorMessage = null
					this.emit()
					throw mcpError('error.mcp.workspace.not-recent')
				}
				await this.applyConfig(next)
				this.errorMessage = null
				const status = this.workspaceStatus(input.workspaceID)
				this.emit()
				return status
			} catch (error) {
				if (errorMessage(error) === 'error.mcp.workspace.not-recent') {
					throw error
				}
				const config = this.config.snapshot()
				this.errorMessage = config.enabled && grantCount(config) > 0 ? 'error.mcp.update' : null
				await this.stopHTTPServer().catch(() => undefined)
				this.emit()
				throw mcpError('error.mcp.update')
			}
		})
	}

	async setEnabled(enabled: boolean): Promise<void> {
		await this.exclusive(async () => {
			this.assertAvailable()
			const current = this.config.snapshot()
			if (current.enabled === enabled) {
				try {
					if (enabled && grantCount(current) > 0 && !this.activeProfile) {
						await this.activate(current)
					}
					this.errorMessage = null
					this.emit()
				} catch {
					this.errorMessage = 'error.mcp.start'
					this.emit()
					throw mcpError('error.mcp.start')
				}
				return
			}
			try {
				if (!enabled) {
					this.acceptingRequests = false
					await this.closeAllSessions()
				}
				const next = await this.config.setEnabled(enabled)
				if (!enabled) {
					await this.deactivate()
					await this.clearDerivedCaches()
				}
				if (enabled && grantCount(next) > 0) {
					await this.activate(next)
				}
				this.errorMessage = null
				this.emit()
			} catch {
				this.errorMessage = enabled ? 'error.mcp.start' : 'error.mcp.update'
				await this.stopHTTPServer().catch(() => undefined)
				this.emit()
				throw mcpError(enabled ? 'error.mcp.start' : 'error.mcp.update')
			}
		})
	}

	async setMemoryEnabled(enabled: boolean): Promise<void> {
		await this.exclusive(async () => {
			this.assertAvailable()
			if (enabled && !this.sessionMemoryProvider) {
				throw mcpError('error.mcp.memory')
			}
			const current = this.config.snapshot()
			if (current.codexSessionMemoryEnabled === enabled) {
				return
			}
			try {
				this.acceptingRequests = false
				await this.closeAllSessions()
				const next = await this.config.setCodexSessionMemoryEnabled(enabled)
				if (!enabled) {
					await this.clearDerivedCaches()
				}
				await this.applyConfig(next)
				this.errorMessage = null
				this.emit()
			} catch {
				// Fail closed: a failed cache cleanup must never re-enable revoked history.
				await this.deactivate().catch(() => undefined)
				this.errorMessage = 'error.mcp.memory'
				this.emit()
				throw mcpError('error.mcp.memory')
			}
		})
	}

	async revealConnection(input: MCPWorkspaceInput): Promise<MCPConnectionDetails> {
		return this.exclusive(async () => this.connectionDetails(input.workspaceID))
	}

	async regenerateCredential(input: MCPWorkspaceInput): Promise<MCPConnectionDetails> {
		return this.exclusive(async () => {
			this.assertAvailable()
			const current = this.config.snapshot()
			if (!current.enabled || accessFor(current, input.workspaceID) === 'off') {
				throw mcpError('error.mcp.credential.requires-included')
			}
			try {
				await this.revokeActiveCredential(current.profileID)
				await this.config.setCredentialDigest(null)
				await this.activate(this.config.snapshot())
				this.errorMessage = null
				this.emit()
				return this.connectionDetails(input.workspaceID)
			} catch {
				await this.removeProfileMaterial(current.profileID).catch(() => undefined)
				await this.config.setCredentialDigest(null).catch(() => undefined)
				await this.stopHTTPServer().catch(() => undefined)
				this.errorMessage = 'error.mcp.regenerate'
				this.emit()
				throw mcpError('error.mcp.regenerate')
			}
		})
	}

	subscribe(listener: StatusListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	async close(): Promise<void> {
		await this.exclusive(async () => {
			if (this.disposed) {
				return
			}
			this.disposed = true
			this.semantic.close()
			this.memorySemantic.close()
			this.available = false
			this.acceptingRequests = false
			clearInterval(this.cleanupTimer)
			this.unsubscribeWorkspace?.()
			this.unsubscribeWorkspace = undefined
			this.activeProfile = undefined
			await this.stopHTTPServer()
			await rm(this.connectionFilePath, { recursive: true, force: true })
		})
	}

	private async activate(config: MCPConfig): Promise<void> {
		if (config.cacheCleanupPending) {
			await this.clearDerivedCaches()
		}
		if (!config.enabled || grantCount(config) === 0 || this.activeProfile) {
			return
		}
		try {
			const profile = await this.loadOrCreateProfile(config)
			await this.startHTTPServer()
			await this.writeConnectionFile(profile)
			this.activeProfile = profile
			this.acceptingRequests = true
		} catch (error) {
			this.acceptingRequests = false
			this.activeProfile = undefined
			await this.stopHTTPServer().catch(() => undefined)
			await rm(this.connectionFilePath, { recursive: true, force: true }).catch(() => undefined)
			throw error
		}
	}

	private async clearDerivedCaches(): Promise<void> {
		await this.semantic.clear()
		await this.memorySemantic.clear()
		await this.config.acknowledgeCacheCleanup()
	}

	private async applyConfig(config: MCPConfig): Promise<void> {
		if (!config.enabled || grantCount(config) === 0) {
			await this.deactivate()
		} else if (this.activeProfile) {
			this.activeProfile = {
				...this.activeProfile,
				grants: this.workspaceGrants(config)
			}
			this.acceptingRequests = true
		} else {
			await this.activate(config)
		}
	}

	private async revokeActiveCredential(profileID: string | undefined): Promise<void> {
		this.acceptingRequests = false
		const active = this.activeProfile
		this.activeProfile = undefined
		const profileIDs = new Set([profileID, active?.profileID].filter(Boolean) as string[])
		for (const id of profileIDs) {
			await this.closeProfileSessions(id)
			await this.removeProfileMaterial(id)
		}
	}

	private async removeProfileMaterial(profileID: string): Promise<void> {
		await Promise.allSettled([
			rm(this.connectionFilePath, { recursive: true, force: true }),
			rm(this.secretFilePath(profileID), { recursive: true, force: true })
		])
		await Promise.allSettled([
			syncDirectoryIfPresent(this.mcpRoot),
			syncDirectoryIfPresent(this.secretDirectory)
		])
	}

	private async loadOrCreateProfile(config: MCPConfig): Promise<ActiveProfile> {
		if (config.credentialDigest) {
			const token = await readPrivateToken(this.secretFilePath(config.profileID))
			if (!token || !equalDigest(digestToken(token), Buffer.from(config.credentialDigest, 'hex'))) {
				throw new Error('The stored MCP credential material is unavailable.')
			}
			return this.activeProfileFor(config, token)
		}
		return this.createCredential(config)
	}

	private async createCredential(config: MCPConfig): Promise<ActiveProfile> {
		const token = randomBytes(32).toString('base64url')
		const digest = digestToken(token)
		const secretFilePath = this.secretFilePath(config.profileID)
		await rm(secretFilePath, { recursive: true, force: true })
		await writePrivateFile(secretFilePath, `${token}\n`)
		const next = await this.config.setCredentialDigest(digest.toString('hex'))
		return this.activeProfileFor(next, token)
	}

	private activeProfileFor(config: MCPConfig, token: string): ActiveProfile {
		return {
			profileID: config.profileID,
			token,
			digest: digestToken(token),
			credentialRevision: randomUUID(),
			connectionFilePath: this.connectionFilePath,
			grants: this.workspaceGrants(config)
		}
	}

	private workspaceGrants(config: MCPConfig): GatewayGrantMap {
		const grants = new Map<string, GatewayGrant>()
		for (const [workspaceID, access] of Object.entries(config.grants)) {
			const label = this.source.mcpWorkspaceLabel(workspaceID)
			if (!label) {
				throw new Error('An included MCP workspace is unavailable.')
			}
			const workspaceRef = workspaceReference(config.profileID, workspaceID)
			const bundle = this.source.mcpBundle(workspaceID)
			const root = this.source.workspaceRoot?.(workspaceID)
			const memory = this.sessionMemoryProvider
			const sessionMemory =
				config.codexSessionMemoryEnabled && root && memory
					? {
							snapshot: async (signal: AbortSignal) => {
								// Reuse the bundle's stored filesystem-identity authorization before and
								// after scanning; replacing a directory must require reauthorization.
								signal.throwIfAborted()
								await bundle.getInfo()
								const snapshot = await memory.snapshot(root, signal)
								await bundle.getInfo()
								signal.throwIfAborted()
								return snapshot
							},
							semanticRank: this.memorySemantic.rank
						}
					: undefined
			const readDocument: KnowledgeBundleMCPDocumentReader = (input, signal) =>
				this.source.mcpReadDocument(workspaceID, input, signal)
			const search: KnowledgeBundleMCPSearcher = async (input, signal) => {
				const result = await this.source.mcpSearch(workspaceID, input, signal)
				return {
					...result,
					matches: result.matches.map((match) => ({
						...match,
						representation: 'source_markdown',
						documentAccess: access === 'write' ? 'writable' : 'readonly'
					}))
				}
			}
			grants.set(
				workspaceRef,
				access === 'write'
					? Object.freeze({
							workspaceID,
							reference: workspaceRef,
							label,
							access: 'editable',
							bundle,
							readDocument,
							search,
							semanticRank: this.semantic.rank,
							sessionMemory
						})
					: Object.freeze({
							workspaceID,
							reference: workspaceRef,
							label,
							access: 'readonly',
							bundle: readOnlyBundle(bundle),
							readDocument,
							search,
							semanticRank: this.semantic.rank,
							sessionMemory
						})
			)
		}
		return grants
	}

	private async startHTTPServer(): Promise<void> {
		if (this.httpServer) {
			return
		}
		this.acceptingRequests = false
		const application = this.createHTTPApplication()
		const listener = getRequestListener(application.fetch, {
			hostname: loopbackAddress,
			overrideGlobalObjects: false,
			errorHandler: () => jsonRPCResponse(500, -32603, 'Internal MCP server error.')
		})
		const server = createServer({ maxHeaderSize: 16 * 1024 }, listener)
		server.headersTimeout = 10_000
		server.requestTimeout = 15_000
		server.keepAliveTimeout = 5_000
		server.maxHeadersCount = 40
		server.maxRequestsPerSocket = 100
		await listen(server)
		const address = server.address()
		if (!address || typeof address === 'string') {
			server.close()
			throw new Error('The MCP server did not receive a loopback port.')
		}
		this.httpServer = server
		this.port = (address as AddressInfo).port
	}

	private createHTTPApplication(): Hono<MCPHonoEnvironment> {
		const application = new Hono<MCPHonoEnvironment>()
		application.use('*', async (context, next) => {
			supportBunRequestDrain(context.env.incoming)
			context.header('X-Open-Knowledge-Instance-ID', this.instanceID)
			context.header('Cache-Control', 'no-store')
			context.header('X-Content-Type-Options', 'nosniff')
			await next()
		})
		application.all('/mcp/:profileID', (context) => this.handleRequest(context))
		application.notFound((context) => jsonRPCError(context, 404, -32001, 'MCP endpoint not found.'))
		application.onError((error, context) => {
			if (error instanceof HTTPException) {
				return error.getResponse()
			}
			return jsonRPCError(context, 500, -32603, 'Internal MCP server error.')
		})
		return application
	}

	private async stopHTTPServer(): Promise<void> {
		const server = this.httpServer
		this.acceptingRequests = false
		this.activeProfile = undefined
		if (!server) {
			await this.closeAllSessions()
			return
		}
		this.httpServer = undefined
		this.port = undefined
		const closed = new Promise<void>((resolve) => {
			server.close(() => resolve())
		})
		await this.closeAllSessions()
		server.closeIdleConnections()
		let forceTimer: ReturnType<typeof setTimeout> | undefined
		await Promise.race([
			closed,
			new Promise<void>((resolve) => {
				forceTimer = setTimeout(() => {
					server.closeAllConnections()
					resolve()
				}, 2000)
			})
		])
		clearTimeout(forceTimer)
	}

	private async deactivate(): Promise<void> {
		await this.stopHTTPServer()
		await rm(this.connectionFilePath, { recursive: true, force: true })
		await syncDirectoryIfPresent(this.mcpRoot)
	}

	private async handleRequest(context: MCPHonoContext): Promise<Response> {
		if (!this.acceptingRequests || !this.port) {
			return jsonRPCError(context, 503, -32000, 'The MCP server is unavailable.')
		}
		const request = context.env.incoming
		if (!isLoopbackRequest(request)) {
			return jsonRPCError(context, 403, -32000, 'Forbidden.')
		}
		if (singleHeader(request, 'host') !== `${loopbackAddress}:${this.port}`) {
			return jsonRPCError(context, 403, -32000, 'Forbidden.')
		}
		if (headerValues(request, 'origin').length > 0) {
			return jsonRPCError(context, 403, -32000, 'Browser-origin requests are not accepted.')
		}

		const profile = this.profileForRequest(context)
		if (!profile) {
			return jsonRPCError(context, 404, -32001, 'MCP endpoint not found.')
		}
		if (!this.authenticate(request, profile)) {
			context.header('WWW-Authenticate', 'Bearer realm="Open Knowledge MCP"')
			return jsonRPCError(context, 401, -32001, 'Authentication required.')
		}
		if (!['GET', 'POST', 'DELETE'].includes(request.method ?? '')) {
			context.header('Allow', 'GET, POST, DELETE')
			return jsonRPCError(context, 405, -32600, 'Method not allowed.')
		}

		let body: unknown
		if (request.method === 'POST') {
			const parsed = await parseJSONBody(request)
			if (!parsed.ok) {
				return jsonRPCError(context, parsed.status, parsed.code, parsed.message)
			}
			body = parsed.value
		}
		if (!this.acceptingRequests || this.activeProfile !== profile) {
			return jsonRPCError(context, 503, -32000, 'The MCP server is unavailable.')
		}

		const sessionID = optionalSingleHeader(request, 'mcp-session-id')
		if (sessionID === null) {
			return jsonRPCError(context, 400, -32600, 'The MCP session header is invalid.')
		}
		if (sessionID) {
			if (!v.is(MCPSessionIDSchema, sessionID)) {
				return jsonRPCError(context, 400, -32600, 'The MCP session header is invalid.')
			}
			const session = this.sessions.get(sessionID)
			if (
				!session ||
				session.profileID !== profile.profileID ||
				!equalDigest(session.credentialDigest, profile.digest)
			) {
				return jsonRPCError(context, 404, -32001, 'MCP session not found.')
			}
			return this.handleSessionRequest(session, context, body)
		}
		if (request.method !== 'POST' || !isInitializeRequest(body)) {
			return jsonRPCError(context, 400, -32000, 'Initialize a new MCP session first.')
		}
		if (this.sessionRecords.size >= maximumSessions) {
			return jsonRPCError(context, 429, -32000, 'The MCP session limit has been reached.')
		}
		return this.createSession(profile, context, body)
	}

	private profileForRequest(context: MCPHonoContext): ActiveProfile | null {
		let url: URL
		try {
			url = new URL(context.req.url)
		} catch {
			return null
		}
		if (url.search || url.hash) {
			return null
		}
		const profile = this.activeProfile
		if (
			!profile ||
			profile.profileID !== context.req.param('profileID') ||
			url.pathname !== `/mcp/${profile.profileID}`
		) {
			return null
		}
		return profile
	}

	private authenticate(request: IncomingMessage, profile: ActiveProfile): boolean {
		const authorization = singleHeader(request, 'authorization')
		if (!authorization?.startsWith('Bearer ')) {
			return false
		}
		const token = authorization.slice('Bearer '.length)
		return v.is(MCPConnectionTokenSchema, token) && equalDigest(digestToken(token), profile.digest)
	}

	private async createSession(
		profile: ActiveProfile,
		context: MCPHonoContext,
		body: unknown
	): Promise<Response> {
		const grants = new Map<string, GatewayGrant>(
			[...profile.grants].map(([workspaceRef, grant]) => [
				workspaceRef,
				Object.freeze({ ...grant })
			])
		)
		const server = createKnowledgeBundleMCPServer([...grants.values()])
		const holder: { record?: SessionRecord } = {}
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (sessionID) => {
				const record = holder.record
				if (!record) {
					throw new Error('The MCP session initialized before its server was ready.')
				}
				record.sessionID = sessionID
				this.sessions.set(sessionID, record)
			},
			onsessionclosed: () => {
				if (holder.record) {
					this.removeSession(holder.record)
				}
			}
		})
		const record: SessionRecord = {
			profileID: profile.profileID,
			credentialDigest: Buffer.from(profile.digest),
			grants,
			server,
			transport,
			sessionID: null,
			activeRequests: 1,
			lastActivity: Date.now()
		}
		holder.record = record
		this.sessionRecords.add(record)
		server.server.onclose = () => {
			this.removeSession(record)
		}
		try {
			await server.connect(transport)
			const response = await transport.handleRequest(context.req.raw, { parsedBody: body })
			return context.newResponse(response.body, response)
		} finally {
			record.activeRequests -= 1
			record.lastActivity = Date.now()
			if (!record.sessionID) {
				await server.close().catch(() => undefined)
				this.removeSession(record)
			}
		}
	}

	private async handleSessionRequest(
		record: SessionRecord,
		context: MCPHonoContext,
		body: unknown
	): Promise<Response> {
		record.activeRequests += 1
		record.lastActivity = Date.now()
		try {
			const response = await record.transport.handleRequest(context.req.raw, { parsedBody: body })
			return context.newResponse(response.body, response)
		} finally {
			record.activeRequests -= 1
			record.lastActivity = Date.now()
		}
	}

	private removeSession(record: SessionRecord): void {
		if (record.sessionID && this.sessions.get(record.sessionID) === record) {
			this.sessions.delete(record.sessionID)
		}
		this.sessionRecords.delete(record)
	}

	private async closeProfileSessions(profileID: string): Promise<void> {
		const records = [...this.sessionRecords].filter((record) => record.profileID === profileID)
		await Promise.allSettled(records.map(({ server }) => server.close()))
		for (const record of records) {
			this.removeSession(record)
		}
	}

	private async closeAllSessions(): Promise<void> {
		const records = [...this.sessionRecords]
		await Promise.allSettled(records.map(({ server }) => server.close()))
		for (const record of records) {
			this.removeSession(record)
		}
		this.sessions.clear()
	}

	private async cleanupIdleSessions(): Promise<void> {
		const cutoff = Date.now() - sessionIdleMilliseconds
		const idle = [...this.sessionRecords].filter(
			(record) => record.activeRequests === 0 && record.lastActivity < cutoff
		)
		await Promise.allSettled(idle.map(({ server }) => server.close()))
	}

	private notifyWorkspaceChanged(change: WorkspaceChange): void {
		for (const record of this.sessionRecords) {
			if (
				[...record.grants.values()].some(({ workspaceID }) => workspaceID === change.workspaceID)
			) {
				record.server.sendResourceListChanged()
			}
		}
	}

	private connectionDetails(workspaceID: string): MCPConnectionDetails {
		this.assertAvailable()
		const config = this.config.snapshot()
		const profile = this.activeProfile
		const httpURL = profile ? this.profileURL(profile.profileID) : null
		const included = [...(profile?.grants.values() ?? [])].some(
			(grant) => grant.workspaceID === workspaceID
		)
		if (
			!config.enabled ||
			accessFor(config, workspaceID) === 'off' ||
			!included ||
			!profile ||
			!httpURL ||
			!this.acceptingRequests
		) {
			throw mcpError('error.mcp.connection.not-listening')
		}
		return {
			workspaceID,
			workspaceCount: profile.grants.size,
			credentialRevision: profile.credentialRevision,
			http: { url: httpURL, bearerToken: profile.token },
			stdio: {
				command: this.stdio.command,
				args: [...this.stdio.args],
				env: { ...this.stdio.env }
			}
		}
	}

	private workspaceStatus(workspaceID: string): MCPWorkspaceStatus {
		const config = this.config.snapshot()
		const access = accessFor(config, workspaceID)
		const workspaceCount = grantCount(config)
		if (!this.available) {
			return {
				workspaceID,
				globalEnabled: config.enabled,
				memoryEnabled: this.memoryEnabled(),
				access,
				workspaceCount,
				profileID: config.profileID,
				credentialRevision: null,
				state: 'error',
				httpURL: null,
				message: 'error.mcp.unavailable'
			}
		}
		if (!config.enabled || access === 'off') {
			return {
				workspaceID,
				globalEnabled: config.enabled,
				memoryEnabled: this.memoryEnabled(),
				access,
				workspaceCount,
				profileID: config.profileID,
				credentialRevision: null,
				state: 'disabled',
				httpURL: null,
				message: null
			}
		}
		const profile = this.activeProfile
		const included = [...(profile?.grants.values() ?? [])].some(
			(grant) => grant.workspaceID === workspaceID
		)
		const httpURL = profile && included ? this.profileURL(profile.profileID) : null
		return {
			workspaceID,
			globalEnabled: true,
			memoryEnabled: this.memoryEnabled(),
			access,
			workspaceCount,
			profileID: config.profileID,
			credentialRevision: profile?.credentialRevision ?? null,
			state: this.errorMessage
				? 'error'
				: httpURL && this.acceptingRequests
					? 'listening'
					: 'starting',
			httpURL,
			message: this.errorMessage
		}
	}

	private async writeConnectionFile(profile: ActiveProfile): Promise<void> {
		if (!this.port) {
			throw new Error('The MCP server port is unavailable.')
		}
		const connection: MCPConnectionFile = {
			version: 1,
			pid: process.pid,
			instanceID: this.instanceID,
			profileID: profile.profileID,
			port: this.port,
			token: profile.token
		}
		await writePrivateFile(profile.connectionFilePath, `${JSON.stringify(connection, null, 2)}\n`)
	}

	private profileURL(profileID: string): string | null {
		return this.port ? `http://${loopbackAddress}:${this.port}/mcp/${profileID}` : null
	}

	private secretFilePath(profileID: string): string {
		return path.join(this.secretDirectory, `${profileID}.token`)
	}

	private emit(): void {
		for (const workspaceID of new Set([
			...this.source.mcpWorkspaceIDs(),
			...Object.keys(this.config.snapshot().grants)
		])) {
			const status = this.workspaceStatus(workspaceID)
			for (const listener of this.listeners) {
				listener(status)
			}
		}
	}

	private assertAvailable(): void {
		if (this.disposed || !this.available) {
			throw mcpError('error.mcp.unavailable')
		}
	}

	private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.operationTail
		let release = () => {}
		this.operationTail = new Promise<void>((resolve) => {
			release = resolve
		})
		await previous
		try {
			return await operation()
		} finally {
			release()
		}
	}
}

function mcpError(messageID: MCPMessageID): Error {
	return new Error(messageID)
}

async function parseJSONBody(
	request: IncomingMessage
): Promise<
	| { ok: true; value: unknown }
	| { ok: false; status: 400 | 413 | 415; code: number; message: string }
> {
	const contentType = singleHeader(request, 'content-type')
	if (!contentType || !isJSONContentType(contentType)) {
		return {
			ok: false,
			status: 415,
			code: -32600,
			message: 'Content-Type must be application/json.'
		}
	}
	const encoding = optionalSingleHeader(request, 'content-encoding')
	if (encoding === null || (encoding && encoding.toLowerCase() !== 'identity')) {
		return {
			ok: false,
			status: 415,
			code: -32600,
			message: 'Compressed MCP requests are not accepted.'
		}
	}
	const length = optionalSingleHeader(request, 'content-length')
	if (length === null || (length && !v.is(ContentLengthSchema, length))) {
		request.resume()
		return {
			ok: false,
			status: 413,
			code: -32600,
			message: 'The MCP request is too large.'
		}
	}

	const chunks: Buffer[] = []
	let size = 0
	for await (const value of request) {
		const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
		size += chunk.byteLength
		if (size > maximumRequestBytes) {
			request.resume()
			return {
				ok: false,
				status: 413,
				code: -32600,
				message: 'The MCP request is too large.'
			}
		}
		chunks.push(chunk)
	}
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
		const value: unknown = JSON.parse(text)
		return { ok: true, value }
	} catch {
		return {
			ok: false,
			status: 400,
			code: -32700,
			message: 'The MCP request contains invalid JSON.'
		}
	}
}

function isJSONContentType(value: string): boolean {
	const [mediaType, ...parameters] = value.split(';').map((part) => part.trim().toLowerCase())
	return (
		mediaType === 'application/json' &&
		parameters.every((parameter) => parameter === '' || parameter === 'charset=utf-8')
	)
}

function isLoopbackRequest(request: IncomingMessage): boolean {
	return request.socket.remoteAddress === loopbackAddress
}

function supportBunRequestDrain(request: IncomingMessage): void {
	const socket = request.socket as typeof request.socket & { destroySoon?: () => void }
	if (process.versions.bun && typeof socket.destroySoon !== 'function') {
		// Hono drains rejected request bodies with a Node socket method missing from Bun's shim.
		socket.destroySoon = () => socket.destroy()
	}
}

function headerValues(request: IncomingMessage, name: string): string[] {
	const values: string[] = []
	for (let index = 0; index < request.rawHeaders.length; index += 2) {
		if (request.rawHeaders[index]?.toLowerCase() === name) {
			const value = request.rawHeaders[index + 1]
			if (value !== undefined) {
				values.push(value)
			}
		}
	}
	return values
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
	const values = headerValues(request, name)
	return values.length === 1 ? values[0] : undefined
}

function optionalSingleHeader(request: IncomingMessage, name: string): string | null | undefined {
	const values = headerValues(request, name)
	if (values.length > 1) {
		return null
	}
	return values[0]
}

function jsonRPCError(
	context: MCPHonoContext,
	status: 400 | 401 | 403 | 404 | 405 | 413 | 415 | 429 | 500 | 503,
	code: number,
	message: string
): Response {
	return context.json({ jsonrpc: '2.0', error: { code, message }, id: null }, status)
}

function jsonRPCResponse(status: 500, code: number, message: string): Response {
	return Response.json(
		{ jsonrpc: '2.0', error: { code, message }, id: null },
		{
			status,
			headers: {
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			}
		}
	)
}

async function listen(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		function failed(error: Error): void {
			server.off('listening', listening)
			reject(error)
		}
		function listening(): void {
			server.off('error', failed)
			resolve()
		}
		server.once('error', failed)
		server.once('listening', listening)
		server.listen({ host: loopbackAddress, port: 0, exclusive: true })
	})
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true, mode: privateDirectoryMode })
	if (process.platform !== 'win32') {
		await chmod(directory, privateDirectoryMode)
	}
}

async function removeObsoleteSecretMaterial(
	directory: string,
	profileID: string | null
): Promise<void> {
	const retainedName = profileID ? `${profileID}.token` : null
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name !== retainedName) {
			await rm(path.join(directory, entry.name), { recursive: true, force: true })
		}
	}
	await syncDirectory(directory)
}

async function writePrivateFile(filePath: string, content: string): Promise<void> {
	await ensurePrivateDirectory(path.dirname(filePath))
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`
	let handle: FileHandle | undefined
	let temporaryExists = false
	try {
		handle = await open(temporaryPath, 'wx', privateFileMode)
		temporaryExists = true
		await handle.writeFile(content, 'utf8')
		await handle.sync()
		await handle.close()
		handle = undefined
		await rename(temporaryPath, filePath)
		temporaryExists = false
		if (process.platform !== 'win32') {
			await chmod(filePath, privateFileMode)
		}
		await syncDirectory(path.dirname(filePath))
	} finally {
		if (handle) {
			await handle.close().catch(() => undefined)
		}
		if (temporaryExists) {
			await rm(temporaryPath, { force: true })
		}
	}
}

async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') {
		return
	}
	const handle = await open(directory, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

async function syncDirectoryIfPresent(directory: string): Promise<void> {
	try {
		await syncDirectory(directory)
	} catch (error) {
		if (nodeErrorCode(error) !== 'ENOENT') {
			throw error
		}
	}
}

async function readPrivateToken(filePath: string): Promise<string | null> {
	try {
		const stats = await lstat(filePath)
		if (!stats.isFile() || stats.isSymbolicLink()) {
			return null
		}
		if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
			return null
		}
		const token = (await readFile(filePath, 'utf8')).trim()
		return v.is(MCPConnectionTokenSchema, token) ? token : null
	} catch (error) {
		if (nodeErrorCode(error) === 'ENOENT') {
			return null
		}
		throw error
	}
}

function readOnlyBundle(bundle: EditableKnowledgeBundle): ReadonlyKnowledgeBundle {
	const readonlyBundle: ReadonlyKnowledgeBundle = {
		getInfo: async () => {
			const info = await bundle.getInfo()
			return { access: 'readonly', metadata: info.metadata }
		},
		list: (input) => bundle.list(input),
		readFile: (input) => bundle.readFile(input)
	}
	return Object.freeze(readonlyBundle)
}

function accessFor(config: MCPConfig, workspaceID: string): MCPAccess {
	return config.grants[workspaceID] ?? 'off'
}

function grantCount(config: MCPConfig): number {
	return Object.keys(config.grants).length
}

function workspaceReference(profileID: string, workspaceID: string): string {
	return `ws_${createHmac('sha256', profileID).update(workspaceID).digest('base64url')}`
}

function digestToken(token: string): Buffer {
	return createHash('sha256').update(token).digest()
}

function equalDigest(left: Buffer, right: Buffer): boolean {
	return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}
