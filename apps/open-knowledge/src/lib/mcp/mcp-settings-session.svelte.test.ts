import { plugin } from 'bun'
import { describe, expect, test } from 'bun:test'
import { compileModule } from 'svelte/compiler'
import ts from 'typescript'
import type {
	MCPAPI,
	MCPConnectionDetails,
	MCPManagementSnapshot,
	MCPManagementWorkspace,
	MCPWorkspaceInput,
	MCPWorkspaceStatus,
	UpdateMCPWorkspaceInput
} from './api'
import type { MCPSettingsErrorKey } from './mcp-settings-session.svelte'

plugin({
	name: 'svelte-runes-test-loader',
	setup(build) {
		build.onLoad({ filter: /mcp-settings-session\.svelte\.ts$/ }, async ({ path }) => {
			const source = await Bun.file(path).text()
			const javascript = ts.transpileModule(source, {
				compilerOptions: {
					target: ts.ScriptTarget.ESNext,
					module: ts.ModuleKind.ESNext,
					verbatimModuleSyntax: true
				}
			}).outputText
			return {
				contents: compileModule(javascript, { filename: path, generate: 'client' }).js.code,
				loader: 'js'
			}
		})
	}
})

const { MCPSettingsSession } = await import('./mcp-settings-session.svelte')

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const CREDENTIAL_ONE = '22222222-2222-4222-8222-222222222222'
const CREDENTIAL_TWO = '33333333-3333-4333-8333-333333333333'

class TestMCPAPI implements MCPAPI {
	listener: ((status: MCPWorkspaceStatus) => void) | undefined
	unsubscribed = 0

	openSettings = async (): Promise<void> => {}
	getManagementSnapshot = async (): Promise<MCPManagementSnapshot> => snapshot()
	get = async (input: MCPWorkspaceInput): Promise<MCPWorkspaceStatus> =>
		status({ workspaceID: input.workspaceID })
	update = async (input: UpdateMCPWorkspaceInput): Promise<MCPWorkspaceStatus> =>
		status({ workspaceID: input.workspaceID, access: input.access })
	setEnabled = async (): Promise<void> => {}
	setMemoryEnabled = async (): Promise<void> => {}
	revealConnection = async (input: MCPWorkspaceInput): Promise<MCPConnectionDetails> =>
		connection({ workspaceID: input.workspaceID })
	regenerateCredential = async (input: MCPWorkspaceInput): Promise<MCPConnectionDetails> =>
		connection({ workspaceID: input.workspaceID, credentialRevision: CREDENTIAL_TWO })
	onChange = (listener: (status: MCPWorkspaceStatus) => void): (() => void) => {
		this.listener = listener
		return () => {
			this.unsubscribed += 1
		}
	}

	emit(nextStatus: MCPWorkspaceStatus): void {
		this.listener?.(nextStatus)
	}
}

type Deferred<T> = {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

async function settle(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

function workspace(overrides: Partial<MCPManagementWorkspace> = {}): MCPManagementWorkspace {
	return {
		workspaceID: 'workspace-one',
		label: 'Workspace One',
		globalEnabled: true,
		memoryEnabled: false,
		access: 'read',
		workspaceCount: 1,
		profileID: PROFILE_ID,
		credentialRevision: CREDENTIAL_ONE,
		state: 'listening',
		httpURL: 'http://127.0.0.1:4123/mcp',
		message: null,
		...overrides
	}
}

function status(overrides: Partial<MCPManagementWorkspace> = {}): MCPWorkspaceStatus {
	const { label, ...nextStatus } = workspace(overrides)
	void label
	return nextStatus
}

function snapshot(
	workspaces: MCPManagementWorkspace[] = [workspace()],
	enabled = true
): MCPManagementSnapshot {
	return { enabled, memoryEnabled: false, workspaces }
}

function connection(overrides: Partial<MCPConnectionDetails> = {}): MCPConnectionDetails {
	return {
		workspaceID: 'workspace-one',
		workspaceCount: 1,
		credentialRevision: CREDENTIAL_ONE,
		http: {
			url: 'http://127.0.0.1:4123/mcp',
			bearerToken: 'token-with-at-least-thirty-two-characters'
		},
		stdio: {
			command: 'open-knowledge-mcp',
			args: [],
			env: {}
		},
		...overrides
	}
}

describe('MCPSettingsSession', () => {
	test('loads shared status and clears credentials when disposed', async () => {
		const api = new TestMCPAPI()
		const loaded = deferred<MCPManagementSnapshot>()
		api.getManagementSnapshot = () => loaded.promise
		const session = new MCPSettingsSession(api)

		session.start()
		loaded.resolve(snapshot())
		await settle()

		expect(session.enabled).toBe(true)
		expect(session.workspaceCount).toBe(1)
		expect(session.sharedStatus?.workspaceID).toBe('workspace-one')
		expect(session.statusState).toBe('listening')
		expect(session.loading).toBe(false)

		await session.reveal()
		expect(session.connection).toEqual(connection())

		session.dispose()
		expect(api.unsubscribed).toBe(1)
		expect(session.connection).toBeNull()
	})

	test('lets a newer snapshot request supersede an older request', async () => {
		const api = new TestMCPAPI()
		const requests: Deferred<MCPManagementSnapshot>[] = []
		api.getManagementSnapshot = () => {
			const request = deferred<MCPManagementSnapshot>()
			requests.push(request)
			return request.promise
		}
		const session = new MCPSettingsSession(api)

		const firstRefresh = session.refresh()
		const secondRefresh = session.refresh()

		requests[0]?.resolve(snapshot([workspace({ label: 'Stale' })], false))
		await firstRefresh
		expect(session.snapshot).toBeNull()
		expect(session.loading).toBe(true)

		const latest = snapshot([workspace({ label: 'Latest' })])
		requests[1]?.resolve(latest)
		await secondRefresh
		expect(session.snapshot).toEqual(latest)
		expect(session.loading).toBe(false)
	})

	test('ignores errors from a superseded refresh', async () => {
		const api = new TestMCPAPI()
		const requests: Deferred<MCPManagementSnapshot>[] = []
		api.getManagementSnapshot = () => {
			const request = deferred<MCPManagementSnapshot>()
			requests.push(request)
			return request.promise
		}
		const session = new MCPSettingsSession(api)

		const staleRefresh = session.refresh()
		const latestRefresh = session.refresh()
		requests[0]?.reject(new Error('stale failure'))
		await staleRefresh
		expect(session.errorKey).toBeNull()
		expect(session.loading).toBe(true)

		requests[1]?.resolve(snapshot())
		await latestRefresh
		expect(session.errorKey).toBeNull()
		expect(session.loading).toBe(false)
	})

	test('clears a load error after a later successful refresh', async () => {
		const api = new TestMCPAPI()
		let unavailable = true
		api.getManagementSnapshot = async () => {
			if (unavailable) {
				throw new Error('load failed')
			}
			return snapshot()
		}
		const session = new MCPSettingsSession(api)

		await session.refresh()
		expect(session.errorKey).toBe('errorLoad')
		unavailable = false
		await session.refresh()

		expect(session.errorKey).toBeNull()
		expect(session.snapshot).toEqual(snapshot())
	})

	test('clears a mapped MCP load error after recovery', async () => {
		const api = new TestMCPAPI()
		let unavailable = true
		api.getManagementSnapshot = async () => {
			if (unavailable) {
				throw new Error('wrapped error.mcp.unavailable')
			}
			return snapshot()
		}
		const session = new MCPSettingsSession(api)

		await session.refresh()
		expect(session.errorKey).toBe('error.mcp.unavailable')
		unavailable = false
		await session.refresh()

		expect(session.errorKey).toBeNull()
	})

	test('invalidates pending snapshots and credentials when disposed', async () => {
		const api = new TestMCPAPI()
		const loading = deferred<MCPManagementSnapshot>()
		const revealing = deferred<MCPConnectionDetails>()
		api.getManagementSnapshot = () => loading.promise
		api.revealConnection = () => revealing.promise
		const session = new MCPSettingsSession(api)

		session.start()
		session.snapshot = snapshot()
		const reveal = session.reveal()
		session.dispose()
		loading.resolve(snapshot([workspace({ label: 'Late snapshot' })]))
		revealing.resolve(connection())
		await reveal
		await settle()

		expect(session.snapshot?.workspaces[0]?.label).toBe('Workspace One')
		expect(session.connection).toBeNull()
		expect(session.busy).toBe(false)
		expect(api.unsubscribed).toBe(1)
	})

	test('refetches when a pushed status overtakes an in-flight snapshot', async () => {
		const api = new TestMCPAPI()
		const requests: Deferred<MCPManagementSnapshot>[] = []
		api.getManagementSnapshot = () => {
			const request = deferred<MCPManagementSnapshot>()
			requests.push(request)
			return request.promise
		}
		const session = new MCPSettingsSession(api)
		session.start()

		api.emit(status({ state: 'starting' }))
		requests[0]?.resolve(snapshot([workspace({ label: 'Stale' })], false))
		await settle()
		expect(requests).toHaveLength(2)
		expect(session.snapshot).toBeNull()

		const reconciled = snapshot([workspace({ label: 'Reconciled' })])
		requests[1]?.resolve(reconciled)
		await settle()
		expect(session.snapshot).toEqual(reconciled)
		session.dispose()
	})

	test('applies pushed status by identity and invalidates changed credentials', async () => {
		const api = new TestMCPAPI()
		const session = new MCPSettingsSession(api, async () => {})
		session.start()
		await settle()
		await session.reveal()
		await session.copy('http', 'configuration')

		api.emit(status({ state: 'starting' }))
		expect(session.connection).toEqual(connection())
		expect(session.copyFeedback).toBe('http')
		expect(session.sharedStatus).toEqual(workspace({ state: 'starting' }))

		api.emit(status({ credentialRevision: CREDENTIAL_TWO }))
		expect(session.connection).toBeNull()
		expect(session.copyFeedback).toBeNull()
		expect(session.sharedStatus?.label).toBe('Workspace One')
		session.dispose()
	})

	test('invalidates a revealed credential when a snapshot no longer grants its revision', async () => {
		const api = new TestMCPAPI()
		let nextSnapshot = snapshot()
		api.getManagementSnapshot = async () => nextSnapshot
		const session = new MCPSettingsSession(api)
		await session.refresh()
		await session.reveal()
		await session.copy('command', 'configuration')

		nextSnapshot = snapshot([
			workspace({ access: 'off', credentialRevision: CREDENTIAL_ONE, state: 'disabled' })
		])
		await session.refresh()

		expect(session.connection).toBeNull()
		expect(session.copyFeedback).toBeNull()
	})

	test('ignores a reveal overtaken by any pushed status generation', async () => {
		const api = new TestMCPAPI()
		const reveal = deferred<MCPConnectionDetails>()
		api.revealConnection = () => reveal.promise
		const session = new MCPSettingsSession(api)
		session.start()
		await settle()

		const revealing = session.reveal()
		expect(session.busy).toBe(true)
		api.emit(status())
		reveal.resolve(connection())
		await revealing

		expect(session.connection).toBeNull()
		expect(session.busy).toBe(false)
		session.dispose()
	})

	test('keeps regeneration callback success independent from credential retention', async () => {
		const api = new TestMCPAPI()
		let nextSnapshot = snapshot()
		api.getManagementSnapshot = async () => nextSnapshot
		const session = new MCPSettingsSession(api)
		await session.refresh()

		nextSnapshot = snapshot([workspace({ credentialRevision: CREDENTIAL_ONE })])
		expect(await session.regenerate()).toBe(true)
		expect(session.connection).toBeNull()
		expect(session.busy).toBe(false)

		api.regenerateCredential = async () => {
			throw new Error('wrapped error.mcp.regenerate')
		}
		expect(await session.regenerate()).toBe(false)
		expect(session.errorKey).toBe('error.mcp.regenerate')

		nextSnapshot = snapshot([])
		await session.refresh()
		expect(await session.regenerate()).toBe(false)
	})

	test('validates access updates and preserves command busy and error semantics', async () => {
		const api = new TestMCPAPI()
		let updateCalls = 0
		const update = deferred<MCPWorkspaceStatus>()
		api.update = (input) => {
			updateCalls += 1
			expect(input).toEqual({ workspaceID: 'workspace-one', access: 'write' })
			return update.promise
		}
		const session = new MCPSettingsSession(api)
		await session.refresh()
		session.errorKey = 'errorLoad'

		await session.changeAccess('workspace-one', 'invalid')
		expect(updateCalls).toBe(0)
		expect(session.errorKey).toBe('errorLoad')

		const changing = session.changeAccess('workspace-one', 'write')
		expect(session.busyWorkspaceID).toBe('workspace-one')
		expect(session.busy).toBe(true)
		expect(session.errorKey).toBeNull()
		update.resolve(status({ access: 'write' }))
		await changing
		expect(updateCalls).toBe(1)
		expect(session.busyWorkspaceID).toBeNull()
		expect(session.busy).toBe(false)

		api.setEnabled = async () => {
			throw new Error('wrapped error.mcp.unavailable')
		}
		await session.changeGlobalEnabled(false)
		expect(session.globalBusy).toBe(false)
		expect(session.errorKey as MCPSettingsErrorKey | null).toBe('error.mcp.unavailable')
		session.dismissError()
		expect(session.errorKey).toBeNull()
	})

	test('reports clipboard success and failure as copy feedback', async () => {
		let unavailable = false
		const session = new MCPSettingsSession(new TestMCPAPI(), async () => {
			if (unavailable) {
				throw new Error('Clipboard unavailable')
			}
		})

		await session.copy('command', 'stdio')
		expect(session.copyFeedback).toBe('command')
		unavailable = true
		await session.copy('http', 'http')
		expect(session.copyFeedback).toBe('unavailable')
	})
})
