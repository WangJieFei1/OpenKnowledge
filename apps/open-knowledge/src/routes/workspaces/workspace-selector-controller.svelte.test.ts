import { describe, expect, test } from 'bun:test'
import type { OpenKnowledgeAPI } from '#lib/desktop/api.js'
import type { Workspace, WorkspaceInput } from '#lib/knowledge/api.js'
import type {
	WorkspaceSelectorBrowseResult,
	WorkspaceSelectorConnectInput,
	WorkspaceSelectorSnapshot
} from '#lib/workspace/selector-api.js'
import { WorkspaceSelectorController } from './workspace-selector-controller.svelte'

const localWorkspace = {
	id: 'local-notes',
	kind: 'local',
	name: 'Notes',
	rootPath: '/home/user/Notes',
	lastOpenedAt: '2026-08-16T00:00:00.000Z'
} satisfies Workspace

const remoteWorkspace = {
	id: 'remote-notes',
	kind: 'remote',
	name: 'Remote notes',
	uri: 'okb://knowledge.example/bundles/main',
	lastOpenedAt: '2026-08-16T00:00:00.000Z'
} satisfies Workspace

type FakeAPIHandlers = {
	getSnapshot?: () => Promise<WorkspaceSelectorSnapshot>
	browse?: () => Promise<WorkspaceSelectorBrowseResult>
	connect?: (input: WorkspaceSelectorConnectInput) => Promise<Workspace>
	select?: (input: WorkspaceInput) => Promise<void>
	openSettings?: () => Promise<void>
}

function createFakeAPI(handlers: FakeAPIHandlers = {}) {
	const calls = {
		getSnapshot: 0,
		browse: 0,
		connect: [] as WorkspaceSelectorConnectInput[],
		select: [] as WorkspaceInput[],
		openSettings: 0
	}
	const api = {
		workspaceSelector: {
			async getSnapshot() {
				calls.getSnapshot += 1
				return handlers.getSnapshot?.() ?? { recentWorkspaces: [] }
			},
			async browse() {
				calls.browse += 1
				return handlers.browse?.() ?? { status: 'cancelled' as const }
			},
			async connect(input: WorkspaceSelectorConnectInput) {
				calls.connect.push(input)
				return handlers.connect?.(input) ?? remoteWorkspace
			},
			async select(input: WorkspaceInput) {
				calls.select.push(input)
				await handlers.select?.(input)
			},
			async open() {}
		},
		window: {
			async openApplicationSettings() {
				calls.openSettings += 1
				await handlers.openSettings?.()
			}
		}
	} as OpenKnowledgeAPI
	return { api, calls }
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

describe('WorkspaceSelectorController', () => {
	test('loads the initial snapshot and starts only once', async () => {
		const { api, calls } = createFakeAPI({
			getSnapshot: async () => ({ recentWorkspaces: [localWorkspace, remoteWorkspace] })
		})
		const controller = new WorkspaceSelectorController(api)

		await controller.start()
		await controller.start()

		expect(controller.loading).toBe(false)
		expect(controller.recentWorkspaces).toEqual([localWorkspace, remoteWorkspace])
		expect(controller.messageID).toBeNull()
		expect(calls.getSnapshot).toBe(1)
	})

	test('reports snapshot and runtime availability failures', async () => {
		const { api } = createFakeAPI({
			getSnapshot: async () => {
				throw new Error('snapshot failed')
			}
		})
		const controller = new WorkspaceSelectorController(api)
		await controller.start()

		expect(controller.loading).toBe(false)
		expect(controller.messageID).toBe('recentWorkspacesFailed')
		expect(controller.messageDetail).toBeNull()

		const unavailable = new WorkspaceSelectorController(null)
		await unavailable.start()
		expect(unavailable.loading).toBe(false)
		expect(unavailable.messageID).toBe('runtimeUnavailable')
		expect(await unavailable.connectRemote({ uri: 'okb://knowledge.example/main' })).toBe(false)
	})

	test('maps browse failures and normalizes unexpected error details', async () => {
		const failed = createFakeAPI({
			browse: async () => ({
				status: 'failed',
				error: { code: 'folder-permission-denied', detail: 'System detail' }
			})
		})
		const failedController = new WorkspaceSelectorController(failed.api)
		await failedController.browse()
		expect(failedController.messageID).toBe('folderPermissionDenied')
		expect(failedController.messageDetail).toBe('System detail')

		const { api } = createFakeAPI({
			browse: async () => {
				throw new Error('  picker\nfailed  ')
			}
		})
		const controller = new WorkspaceSelectorController(api)
		await controller.browse()
		expect(controller.messageID).toBe('folderOpenUnexpected')
		expect(controller.messageDetail).toBe('picker failed')
	})

	test('allows repeated browse requests and forwards a selected workspace', async () => {
		const firstBrowse = deferred<WorkspaceSelectorBrowseResult>()
		const secondBrowse = deferred<WorkspaceSelectorBrowseResult>()
		let request = 0
		const { api, calls } = createFakeAPI({
			browse: () => (request++ === 0 ? firstBrowse.promise : secondBrowse.promise)
		})
		const controller = new WorkspaceSelectorController(api)

		const first = controller.browse()
		const second = controller.browse()
		expect(calls.browse).toBe(2)
		expect(controller.busy).toBe(false)

		secondBrowse.resolve({ status: 'cancelled' })
		firstBrowse.resolve({ status: 'selected', workspace: localWorkspace })
		await Promise.all([first, second])

		expect(calls.select).toEqual([{ workspaceID: localWorkspace.id }])
		expect(controller.selectingID).toBe(localWorkspace.id)
		expect(controller.busy).toBe(true)

		await controller.select(remoteWorkspace)
		expect(calls.select).toHaveLength(1)
	})

	test('resets failed selections but keeps successful selections terminal', async () => {
		let attempts = 0
		const { api, calls } = createFakeAPI({
			select: async () => {
				if (attempts++ === 0) {
					throw new Error('  workspace\nopen failed  ')
				}
			}
		})
		const controller = new WorkspaceSelectorController(api)

		await controller.select(localWorkspace)
		expect(controller.selectingID).toBeNull()
		expect(controller.busy).toBe(false)
		expect(controller.messageID).toBe('workspaceOpenFailed')
		expect(controller.messageDetail).toBe('workspace open failed')

		await controller.select(localWorkspace)
		expect(controller.selectingID).toBe(localWorkspace.id)
		expect(controller.busy).toBe(true)
		expect(controller.messageID).toBeNull()
		expect(calls.select).toHaveLength(2)
	})

	test('forwards remote connections and preserves their boolean result behavior', async () => {
		const input = {
			uri: 'okb://knowledge.example/bundles/main',
			authorization: 'Bearer credential'
		}
		const { api, calls } = createFakeAPI({
			select: async () => {
				throw new Error('selection failed')
			}
		})
		const controller = new WorkspaceSelectorController(api)

		expect(await controller.connectRemote(input)).toBe(true)
		expect(calls.select).toEqual([{ workspaceID: remoteWorkspace.id }])
		expect(controller.messageID).toBe('workspaceOpenFailed')

		const failed = createFakeAPI({
			connect: async () => {
				throw new Error('connection failed')
			}
		})
		const failedController = new WorkspaceSelectorController(failed.api)
		expect(await failedController.connectRemote(input)).toBe(false)
		expect(failedController.messageID).toBeNull()
	})

	test('reports settings failures and clears that notice before retrying', async () => {
		const retry = deferred<void>()
		let attempt = 0
		const { api, calls } = createFakeAPI({
			openSettings: () => {
				if (attempt++ === 0) {
					return Promise.reject(new Error('  settings\nfailed  '))
				}
				return retry.promise
			}
		})
		const controller = new WorkspaceSelectorController(api)

		await controller.openSettings()
		expect(controller.messageID).toBe('settingsOpenFailed')
		expect(controller.messageDetail).toBe('settings failed')

		const pendingRetry = controller.openSettings()
		expect(controller.messageID).toBeNull()
		expect(controller.messageDetail).toBeNull()
		retry.resolve()
		await pendingRetry
		expect(calls.openSettings).toBe(2)
	})

	test('ignores snapshot and browse completions after disposal', async () => {
		const snapshot = deferred<WorkspaceSelectorSnapshot>()
		const browse = deferred<WorkspaceSelectorBrowseResult>()
		const { api, calls } = createFakeAPI({
			getSnapshot: () => snapshot.promise,
			browse: () => browse.promise
		})
		const controller = new WorkspaceSelectorController(api)

		const starting = controller.start()
		const browsing = controller.browse()
		controller.dispose()
		snapshot.resolve({ recentWorkspaces: [localWorkspace] })
		browse.resolve({ status: 'selected', workspace: remoteWorkspace })
		await Promise.all([starting, browsing])

		expect(controller.loading).toBe(true)
		expect(controller.recentWorkspaces).toEqual([])
		expect(controller.selectingID).toBeNull()
		expect(controller.messageID).toBeNull()
		expect(calls.select).toEqual([])
		expect(await controller.connectRemote({ uri: remoteWorkspace.uri })).toBe(false)
		expect(calls.connect).toEqual([])
	})

	test('does not replace terminal selection state with a late failure after disposal', async () => {
		const selection = deferred<void>()
		const { api } = createFakeAPI({ select: () => selection.promise })
		const controller = new WorkspaceSelectorController(api)

		const selecting = controller.select(localWorkspace)
		expect(controller.selectingID).toBe(localWorkspace.id)
		controller.dispose()
		selection.reject(new Error('late failure'))
		await selecting

		expect(controller.selectingID).toBe(localWorkspace.id)
		expect(controller.messageID).toBeNull()
	})
})
