import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
	RemoteAuthorizationStore,
	type RemoteAuthorizationCodec
} from './remote-authorization-store'

const temporaryDirectories: string[] = []
const workspaceID = 'a'.repeat(64)
const otherWorkspaceID = 'b'.repeat(64)
const codec: RemoteAuthorizationCodec = {
	isSecure() {
		return true
	},
	encrypt(value) {
		return Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5))
	},
	decrypt(value) {
		return Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString('utf8')
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

async function createStore(): Promise<{ store: RemoteAuthorizationStore; directory: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-remote-authorization-'))
	temporaryDirectories.push(root)
	const directory = path.join(root, 'remote-credentials')
	return { store: new RemoteAuthorizationStore(directory, codec), directory }
}

describe('RemoteAuthorizationStore', () => {
	test('encrypts persisted Authorization values in owner-only storage', async () => {
		const { store, directory } = await createStore()
		const authorization = 'Bearer secret-token'
		await store.set(workspaceID, authorization)

		const filePath = path.join(directory, `${workspaceID}.authorization`)
		expect((await readFile(filePath)).includes(Buffer.from(authorization))).toBe(false)
		expect(await store.get(workspaceID)).toBe(authorization)
		if (process.platform !== 'win32') {
			expect((await stat(directory)).mode & 0o777).toBe(0o700)
			expect((await stat(filePath)).mode & 0o777).toBe(0o600)
		}
	})

	test('removes cleared and unretained credentials', async () => {
		const { store } = await createStore()
		await store.set(workspaceID, 'Bearer one')
		await store.set(otherWorkspaceID, 'Bearer two')
		await store.prune(new Set([workspaceID]))
		expect(await store.get(workspaceID)).toBe('Bearer one')
		expect(await store.get(otherWorkspaceID)).toBeNull()

		await store.set(workspaceID, null)
		expect(await store.get(workspaceID)).toBeNull()
	})

	test('reserves a fail-closed marker before a credential is committed', async () => {
		const { store } = await createStore()
		await store.reserve(workspaceID, 'Bearer pending-token')
		await expect(store.get(workspaceID)).rejects.toThrow('secure credential is unavailable')

		await store.set(workspaceID, 'Bearer pending-token')
		expect(await store.get(workspaceID)).toBe('Bearer pending-token')
	})

	test('rejects unsafe workspace IDs', async () => {
		const { store } = await createStore()
		await expect(store.set('../workspace', 'Bearer token')).rejects.toThrow()
	})

	test('refuses to persist credentials without secure encryption', async () => {
		const { store: secureStore, directory } = await createStore()
		await secureStore.set(workspaceID, 'Bearer existing-token')
		const store = new RemoteAuthorizationStore(directory, {
			...codec,
			isSecure: () => false
		})

		expect(() => store.assertCanPersist('Bearer secret-token')).toThrow(
			'Secure credential storage is unavailable'
		)
		await expect(store.get(workspaceID)).rejects.toThrow('Secure credential storage is unavailable')
		await expect(secureStore.get(workspaceID)).rejects.toThrow('secure credential is unavailable')
		await secureStore.set(workspaceID, 'Bearer restored-token')
		expect(await secureStore.get(workspaceID)).toBe('Bearer restored-token')

		await expect(store.set(workspaceID, 'Bearer secret-token')).rejects.toThrow(
			'Secure credential storage is unavailable'
		)
		await expect(secureStore.get(workspaceID)).rejects.toThrow('secure credential is unavailable')
		await store.set(workspaceID, null)
		expect(await secureStore.get(workspaceID)).toBeNull()
	})

	test('purges insecure and temporary credential data while retaining a reauthorization marker', async () => {
		const { store: secureStore, directory } = await createStore()
		await secureStore.set(workspaceID, 'Bearer retained-token')
		await secureStore.set(otherWorkspaceID, 'Bearer discarded-token')
		const temporaryName = `${workspaceID}.authorization.deadbeef.tmp`
		await writeFile(path.join(directory, temporaryName), 'temporary secret')
		const insecureStore = new RemoteAuthorizationStore(directory, {
			...codec,
			isSecure: () => false
		})

		await insecureStore.prune(new Set([workspaceID]))
		await expect(insecureStore.get(workspaceID)).rejects.toThrow('secure credential is unavailable')
		expect(await insecureStore.get(otherWorkspaceID)).toBeNull()
		expect(await readdir(directory)).not.toContain(temporaryName)
	})
})
