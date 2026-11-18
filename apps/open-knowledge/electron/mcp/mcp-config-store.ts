import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { nodeErrorCode, PlainRecordSchema, strictObject, UUIDSchema } from '../validation'

const privateDirectoryMode = 0o700
const privateFileMode = 0o600
const WorkspaceIDSchema = v.pipe(v.string(), v.minLength(1))
const GrantAccessSchema = v.picklist(['read', 'write'])
const CredentialDigestSchema = v.nullable(v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)))

export const MCPConfigSchema = strictObject({
	enabled: v.boolean(),
	codexSessionMemoryEnabled: v.optional(v.boolean(), false),
	cacheCleanupPending: v.optional(v.boolean(), false),
	profileID: UUIDSchema,
	credentialDigest: CredentialDigestSchema,
	grants: v.pipe(PlainRecordSchema, v.record(WorkspaceIDSchema, GrantAccessSchema))
})

export type MCPGrantAccess = v.InferOutput<typeof GrantAccessSchema>
export type MCPConfig = v.InferOutput<typeof MCPConfigSchema>
type MCPConfigListener = (config: MCPConfig) => void

export class MCPConfigStore {
	private value = createDefaultConfig()
	private readonly listeners = new Set<MCPConfigListener>()
	private operationTail = Promise.resolve()

	constructor(private readonly filePath: string) {}

	load(): Promise<MCPConfig> {
		return this.enqueue(async () => {
			try {
				const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
				this.value = v.parse(MCPConfigSchema, value)
			} catch (error) {
				if (nodeErrorCode(error) !== 'ENOENT') {
					throw error
				}
			}
			return this.snapshot()
		})
	}

	snapshot(): MCPConfig {
		return { ...this.value, grants: { ...this.value.grants } }
	}

	async setEnabled(enabled: boolean): Promise<MCPConfig> {
		return this.transact((current) =>
			current.enabled === enabled
				? current
				: { ...current, enabled, cacheCleanupPending: current.cacheCleanupPending || !enabled }
		)
	}

	async setCodexSessionMemoryEnabled(codexSessionMemoryEnabled: boolean): Promise<MCPConfig> {
		return this.transact((current) =>
			current.codexSessionMemoryEnabled === codexSessionMemoryEnabled
				? current
				: {
						...current,
						codexSessionMemoryEnabled,
						cacheCleanupPending: current.cacheCleanupPending || !codexSessionMemoryEnabled
					}
		)
	}

	async acknowledgeCacheCleanup(): Promise<MCPConfig> {
		return this.transact((current) =>
			current.cacheCleanupPending ? { ...current, cacheCleanupPending: false } : current
		)
	}

	async setGrant(workspaceID: string, access: MCPGrantAccess | null): Promise<MCPConfig> {
		return this.transact((current) => {
			const existing = Object.hasOwn(current.grants, workspaceID)
				? current.grants[workspaceID]
				: undefined
			if (existing === access || (existing === undefined && access === null)) {
				return current
			}
			if (access === null) {
				const grants = { ...current.grants }
				delete grants[workspaceID]
				return { ...current, grants, cacheCleanupPending: true }
			}
			return {
				...current,
				grants: { ...current.grants, [workspaceID]: access },
				cacheCleanupPending:
					current.cacheCleanupPending || (existing === 'write' && access === 'read')
			}
		})
	}

	async pruneGrants(workspaceIDs: ReadonlySet<string>): Promise<MCPConfig> {
		return this.transact((current) => {
			const grants = Object.fromEntries(
				Object.entries(current.grants).filter(([workspaceID]) => workspaceIDs.has(workspaceID))
			)
			return Object.keys(grants).length === Object.keys(current.grants).length
				? current
				: { ...current, grants, cacheCleanupPending: true }
		})
	}

	async setCredentialDigest(credentialDigest: string | null): Promise<MCPConfig> {
		return this.transact((current) =>
			current.credentialDigest === credentialDigest ? current : { ...current, credentialDigest }
		)
	}

	subscribe(listener: MCPConfigListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private transact(update: (current: MCPConfig) => MCPConfig): Promise<MCPConfig> {
		return this.enqueue(async () => {
			const current = this.value
			const candidate = update(current)
			if (candidate === current) {
				return this.snapshot()
			}
			await writePrivateJSON(this.filePath, candidate)
			this.value = candidate
			for (const listener of this.listeners) {
				listener(this.snapshot())
			}
			return this.snapshot()
		})
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationTail.then(operation)
		this.operationTail = result.then(
			() => undefined,
			() => undefined
		)
		return result
	}
}

function createDefaultConfig(): MCPConfig {
	return {
		enabled: true,
		codexSessionMemoryEnabled: false,
		cacheCleanupPending: false,
		profileID: randomUUID(),
		credentialDigest: null,
		grants: {}
	}
}

async function writePrivateJSON(filePath: string, value: MCPConfig): Promise<void> {
	const directory = path.dirname(filePath)
	await mkdir(directory, { recursive: true, mode: privateDirectoryMode })
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`
	let temporaryExists = false
	let failed = false
	let failure: unknown

	try {
		const handle = await open(temporaryPath, 'wx', privateFileMode)
		temporaryExists = true
		try {
			if (process.platform !== 'win32') {
				await handle.chmod(privateFileMode)
			}
			await handle.writeFile(JSON.stringify(value), 'utf8')
			await handle.sync()
		} finally {
			await handle.close()
		}
		await rename(temporaryPath, filePath)
		temporaryExists = false
		await syncDirectory(directory)
	} catch (error) {
		failed = true
		failure = error
	}

	if (temporaryExists) {
		try {
			await rm(temporaryPath, { force: true })
		} catch (error) {
			if (!failed) {
				failed = true
				failure = error
			}
		}
	}
	if (failed) {
		throw failure
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
