import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ApplicationStore } from './application-store'

const temporaryDirectories: string[] = []
const workspace = {
	id: 'workspace-one',
	name: 'Product Notes',
	kind: 'local' as const,
	rootPath: '/knowledge/product-notes',
	lastOpenedAt: '2026-07-27T12:00:00.000Z'
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

async function createStore(retained: ReadonlySet<string> = new Set()): Promise<{
	store: ApplicationStore
	filePath: string
}> {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-store-'))
	temporaryDirectories.push(directory)
	const filePath = path.join(directory, 'workspaces.json')
	const store = new ApplicationStore(filePath, () => retained)
	await store.load()
	return { store, filePath }
}

describe('ApplicationStore', () => {
	test('persists only recent-workspace state in an owner-only file', async () => {
		const { store, filePath } = await createStore()
		await store.rememberWorkspace(workspace, true)

		const serialized = await readFile(filePath, 'utf8')
		expect(JSON.parse(serialized)).toEqual({
			version: 1,
			recentWorkspaces: [workspace],
			activeWorkspaceID: workspace.id
		})
		if (process.platform !== 'win32') {
			expect((await stat(filePath)).mode & 0o777).toBe(0o600)
		}

		const reloaded = new ApplicationStore(filePath)
		await reloaded.load()
		expect(reloaded.activeWorkspace()).toEqual(workspace)
	})

	test('retains granted workspaces beyond the ordinary recent-workspace limit', async () => {
		const { store } = await createStore(new Set([workspace.id]))
		await store.rememberWorkspace(workspace, true)
		for (let index = 0; index < 13; index += 1) {
			await store.rememberWorkspace(
				{
					id: `workspace-${index}`,
					name: `Workspace ${index}`,
					kind: 'local',
					rootPath: `/knowledge/workspace-${index}`,
					lastOpenedAt: '2026-07-27T12:00:00.000Z'
				},
				false
			)
		}

		expect(store.workspace(workspace.id)).toEqual(workspace)
		expect(store.recentWorkspaces()).toHaveLength(13)
	})

	test('persists the authorized filesystem identity outside the renderer workspace model', async () => {
		const { store, filePath } = await createStore()
		await store.rememberWorkspace(workspace, true, '42:1001')
		expect(store.workspaceRootIdentity(workspace.id)).toBe('42:1001')

		const serialized = JSON.parse(await readFile(filePath, 'utf8'))
		expect(serialized.workspaceRootIdentities).toEqual({ [workspace.id]: '42:1001' })
		expect(serialized.recentWorkspaces).toEqual([workspace])

		const reloaded = new ApplicationStore(filePath)
		await reloaded.load()
		expect(reloaded.workspaceRootIdentity(workspace.id)).toBe('42:1001')
	})

	test('does not infer missing workspace kinds in versioned config', async () => {
		const { filePath } = await createStore()
		const workspaceWithoutKind = {
			id: workspace.id,
			name: workspace.name,
			rootPath: workspace.rootPath,
			lastOpenedAt: workspace.lastOpenedAt
		}
		await Bun.write(
			filePath,
			JSON.stringify({
				version: 1,
				recentWorkspaces: [workspaceWithoutKind],
				activeWorkspaceID: workspace.id
			})
		)

		const reloaded = new ApplicationStore(filePath)
		await reloaded.load()
		expect(reloaded.recentWorkspaces()).toEqual([])
		expect(reloaded.activeWorkspace()).toBeNull()
	})
})
