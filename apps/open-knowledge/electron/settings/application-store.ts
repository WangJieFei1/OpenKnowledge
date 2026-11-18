import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { WorkspaceSchema, type Workspace } from '../../src/lib/knowledge/api'
import { nodeErrorCode, object, PlainRecordSchema } from '../validation'

const StoredValueSchema = object({
	version: v.literal(1),
	recentWorkspaces: v.array(WorkspaceSchema),
	activeWorkspaceID: v.nullable(v.string()),
	workspaceRootIdentities: v.optional(v.pipe(PlainRecordSchema, v.record(v.string(), v.string())))
})

type StoredValue = v.InferOutput<typeof StoredValueSchema>

export class ApplicationStore {
	private value: StoredValue = { version: 1, recentWorkspaces: [], activeWorkspaceID: null }
	private writeTail = Promise.resolve()

	constructor(
		private readonly filePath: string,
		private readonly retainedWorkspaceIDs: () => ReadonlySet<string> = () => new Set()
	) {}

	async load(): Promise<void> {
		try {
			const json: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
			const parsed = v.safeParse(StoredValueSchema, json)
			if (parsed.success) {
				this.value = parsed.output
			}
		} catch (error) {
			if (nodeErrorCode(error) !== 'ENOENT') {
				throw error
			}
		}
	}

	recentWorkspaces(): Workspace[] {
		return [...this.value.recentWorkspaces]
	}

	activeWorkspace(): Workspace | null {
		return this.value.recentWorkspaces.find(({ id }) => id === this.value.activeWorkspaceID) ?? null
	}

	workspace(id: string): Workspace | null {
		return this.value.recentWorkspaces.find((workspace) => workspace.id === id) ?? null
	}

	workspaceRootIdentity(id: string): string | null {
		return this.value.workspaceRootIdentities?.[id] ?? null
	}

	async rememberWorkspace(
		workspace: Workspace,
		activate: boolean,
		rootIdentity?: string
	): Promise<void> {
		const candidates = [
			workspace,
			...this.value.recentWorkspaces.filter(({ id }) => id !== workspace.id)
		]
		const retained = this.retainedWorkspaceIDs()
		let ordinaryWorkspaces = 0
		const recentWorkspaces = candidates.filter(({ id }) => {
			if (retained.has(id)) {
				return true
			}
			ordinaryWorkspaces += 1
			return ordinaryWorkspaces <= 12
		})
		const retainedIDs = new Set(recentWorkspaces.map(({ id }) => id))
		const workspaceRootIdentities = Object.fromEntries(
			Object.entries(this.value.workspaceRootIdentities ?? {}).filter(([id]) => retainedIDs.has(id))
		)
		if (rootIdentity) {
			workspaceRootIdentities[workspace.id] = rootIdentity
		} else if (workspace.kind === 'remote') {
			delete workspaceRootIdentities[workspace.id]
		}
		this.value = {
			version: 1,
			activeWorkspaceID: activate ? workspace.id : this.value.activeWorkspaceID,
			recentWorkspaces,
			...(Object.keys(workspaceRootIdentities).length > 0 ? { workspaceRootIdentities } : {})
		}
		await this.save()
	}

	private async save(): Promise<void> {
		const write = this.writeTail.then(() => this.writeFile())
		this.writeTail = write.catch(() => undefined)
		await write
	}

	private async writeFile(): Promise<void> {
		const directory = path.dirname(this.filePath)
		await mkdir(directory, { recursive: true })
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
		let handle: FileHandle | undefined
		let temporaryExists = false
		try {
			handle = await open(temporaryPath, 'wx', 0o600)
			temporaryExists = true
			await handle.writeFile(JSON.stringify(this.value), 'utf8')
			await handle.sync()
			await handle.close()
			handle = undefined
			await rename(temporaryPath, this.filePath)
			temporaryExists = false
			await syncDirectory(directory)
		} finally {
			if (handle) {
				await handle.close().catch(() => undefined)
			}
			if (temporaryExists) {
				await rm(temporaryPath, { force: true })
			}
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
