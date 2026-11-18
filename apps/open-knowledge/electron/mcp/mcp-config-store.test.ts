import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MCPConfigStore, type MCPConfig } from './mcp-config-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

async function createStore(): Promise<{
	directory: string
	filePath: string
	store: MCPConfigStore
	initial: MCPConfig
}> {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-mcp-config-'))
	temporaryDirectories.push(directory)
	const filePath = path.join(directory, 'config.json')
	const store = new MCPConfigStore(filePath)
	const initial = await store.load()
	return { directory, filePath, store, initial }
}

describe('MCPConfigStore', () => {
	test('session memory is opt-in and survives reload only after explicit enable', async () => {
		const { filePath, store, initial } = await createStore()
		expect(initial.codexSessionMemoryEnabled).toBe(false)
		await store.setCodexSessionMemoryEnabled(true)
		const reloaded = new MCPConfigStore(filePath)
		expect((await reloaded.load()).codexSessionMemoryEnabled).toBe(true)
		await reloaded.setCodexSessionMemoryEnabled(false)
		expect(JSON.parse(await readFile(filePath, 'utf8')).codexSessionMemoryEnabled).toBe(false)
	})
	test('creates defaults in memory and atomically writes owner-only JSON on first change', async () => {
		const { filePath, store, initial } = await createStore()
		await expect(stat(filePath)).rejects.toThrow()
		expect(initial).toMatchObject({ enabled: true, credentialDigest: null, grants: {} })

		let notification: MCPConfig | undefined
		let contentAtNotification: string | undefined
		store.subscribe((config) => {
			notification = config
			contentAtNotification = readFileSync(filePath, 'utf8')
		})
		const committed = await store.setGrant('workspace-one', 'read')
		const serialized = await readFile(filePath, 'utf8')

		expect(committed.profileID).toBe(initial.profileID)
		expect(JSON.parse(serialized)).toEqual(committed)
		expect(contentAtNotification).toBe(serialized)
		expect(notification).toEqual(committed)
		if (process.platform !== 'win32') {
			expect((await stat(filePath)).mode & 0o777).toBe(0o600)
		}

		committed.enabled = false
		committed.grants['workspace-two'] = 'write'
		expect(store.snapshot()).toEqual({
			...initial,
			grants: { 'workspace-one': 'read' }
		})
	})

	test('adds, changes, and removes grants without discarding an empty profile', async () => {
		const { filePath, store, initial } = await createStore()
		await store.setGrant('workspace-one', 'read')
		await store.setGrant('workspace-one', 'write')
		await store.setGrant('workspace-two', 'read')
		await store.setGrant('workspace-one', null)
		expect(store.snapshot().grants).toEqual({ 'workspace-two': 'read' })

		const empty = await store.setGrant('workspace-two', null)
		expect(empty.grants).toEqual({})
		expect(empty.profileID).toBe(initial.profileID)
		expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(empty)
	})

	test('prunes grants for workspaces no longer registered', async () => {
		const { store } = await createStore()
		await store.setGrant('workspace-one', 'write')
		await store.setGrant('workspace-two', 'read')

		const pruned = await store.pruneGrants(new Set(['workspace-two']))
		expect(pruned.grants).toEqual({ 'workspace-two': 'read' })
	})

	test('serializes enabled, grant, and digest changes and reloads them', async () => {
		const { filePath, store } = await createStore()
		const digest = 'a'.repeat(64)
		await Promise.all([
			store.setEnabled(false),
			store.setGrant('workspace-one', 'write'),
			store.setCredentialDigest(digest)
		])

		const reloaded = new MCPConfigStore(filePath)
		expect(await reloaded.load()).toEqual(store.snapshot())
		expect(reloaded.snapshot()).toMatchObject({
			enabled: false,
			credentialDigest: digest,
			grants: { 'workspace-one': 'write' }
		})
	})

	test('does not write or notify for no-op mutations', async () => {
		const { filePath, store } = await createStore()
		await store.setGrant('workspace-one', 'read')
		const beforeContent = await readFile(filePath, 'utf8')
		const beforeStats = await stat(filePath)
		let notifications = 0
		store.subscribe(() => {
			notifications += 1
		})

		await store.setEnabled(true)
		await store.setGrant('workspace-one', 'read')
		await store.setGrant('missing-workspace', null)
		await store.setCredentialDigest(null)

		const afterStats = await stat(filePath)
		expect(await readFile(filePath, 'utf8')).toBe(beforeContent)
		expect(afterStats.ino).toBe(beforeStats.ino)
		expect(notifications).toBe(0)
	})

	test('keeps memory unchanged and cleans its temp file when a write fails', async () => {
		const { directory, filePath, store, initial } = await createStore()
		await mkdir(filePath)
		let notifications = 0
		store.subscribe(() => {
			notifications += 1
		})

		await expect(store.setEnabled(false)).rejects.toThrow()
		expect(store.snapshot()).toEqual(initial)
		expect(notifications).toBe(0)
		expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])

		await rm(filePath, { recursive: true })
		await expect(store.setEnabled(false)).resolves.toMatchObject({ enabled: false })
	})

	test('rejects stored values outside the exact schema', async () => {
		const { filePath } = await createStore()
		await writeFile(
			filePath,
			JSON.stringify({
				enabled: true,
				profileID: '11111111-1111-4111-8111-111111111111',
				credentialDigest: null,
				grants: {},
				legacy: true
			})
		)

		const store = new MCPConfigStore(filePath)
		await expect(store.load()).rejects.toThrow()
	})
})
