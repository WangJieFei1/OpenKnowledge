import { plugin } from 'bun'
import { beforeEach, describe, expect, test } from 'bun:test'
import { compileModule } from 'svelte/compiler'
import ts from 'typescript'
import {
	defaultApplicationSettings,
	type ApplicationSettings,
	type ResetSettingsInput,
	type SettingsAPI,
	type SettingsSnapshot,
	type UpdateApplicationSettingsInput,
	type UpdateSettingsInput
} from './api'

plugin({
	name: 'settings-management-session-runes-test-loader',
	setup(build) {
		build.onLoad({ filter: /settings-management-session\.svelte\.ts$/ }, async ({ path }) => {
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

const { SettingsManagementSession } = await import('./settings-management-session.svelte')

type Deferred<T> = {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason?: unknown) => void
}

type SnapshotOptions = {
	workspaceID?: string | null
	localWorkspace?: boolean
	global?: UpdateApplicationSettingsInput
	project?: UpdateApplicationSettingsInput
	resolved?: ApplicationSettings
}

function deferred<T>(): Deferred<T> {
	let resolve: Deferred<T>['resolve'] = () => undefined
	let reject: Deferred<T>['reject'] = () => undefined
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function settingsSnapshot(options: SnapshotOptions = {}): SettingsSnapshot {
	const global = options.global ?? {}
	const project = options.project ?? {}
	return {
		workspaceID: options.workspaceID === undefined ? 'workspace-one' : options.workspaceID,
		localWorkspace: options.localWorkspace ?? true,
		global,
		project,
		resolved: options.resolved ?? { ...defaultApplicationSettings, ...global, ...project }
	}
}

class FakeSettingsAPI implements SettingsAPI {
	readonly events: string[] = []
	readonly updates: UpdateSettingsInput[] = []
	readonly resets: ResetSettingsInput[] = []
	readonly listeners = new Set<(settings: ApplicationSettings) => void>()
	readonly inspections: Array<Promise<SettingsSnapshot>> = []
	inspectFailure: Error | null = null
	updateFailure: Error | null = null
	resetFailure: Error | null = null

	constructor(public snapshot = settingsSnapshot()) {}

	get(): Promise<ApplicationSettings> {
		return Promise.resolve(this.snapshot.resolved)
	}

	inspect(): Promise<SettingsSnapshot> {
		this.events.push('inspect')
		const inspection = this.inspections.shift()
		if (inspection) {
			return inspection
		}
		if (this.inspectFailure) {
			return Promise.reject(this.inspectFailure)
		}
		return Promise.resolve(this.snapshot)
	}

	async update(input: UpdateSettingsInput): Promise<ApplicationSettings> {
		this.updates.push(input)
		if (this.updateFailure) {
			throw this.updateFailure
		}
		const global =
			input.scope === 'global' ? { ...this.snapshot.global, ...input.patch } : this.snapshot.global
		const project =
			input.scope === 'project'
				? { ...this.snapshot.project, ...input.patch }
				: this.snapshot.project
		this.snapshot = settingsSnapshot({
			workspaceID: this.snapshot.workspaceID,
			localWorkspace: this.snapshot.localWorkspace,
			global,
			project
		})
		return this.snapshot.resolved
	}

	async reset(input: ResetSettingsInput): Promise<ApplicationSettings> {
		this.resets.push(input)
		if (this.resetFailure) {
			throw this.resetFailure
		}
		const global = { ...this.snapshot.global }
		const project = { ...this.snapshot.project }
		const target = input.scope === 'project' ? project : global
		for (const key of input.keys) {
			delete target[key]
		}
		this.snapshot = settingsSnapshot({
			workspaceID: this.snapshot.workspaceID,
			localWorkspace: this.snapshot.localWorkspace,
			global,
			project
		})
		return this.snapshot.resolved
	}

	onChange(listener: (settings: ApplicationSettings) => void): () => void {
		this.events.push('subscribe')
		this.listeners.add(listener)
		return () => {
			this.events.push('unsubscribe')
			this.listeners.delete(listener)
		}
	}

	emitChange(): void {
		for (const listener of this.listeners) {
			listener(this.snapshot.resolved)
		}
	}
}

beforeEach(() => {
	const session = new SettingsManagementSession(new FakeSettingsAPI())
	session.selectScope('global')
	session.dispose()
})

describe('SettingsManagementSession', () => {
	test('subscribes before the initial load and refreshes from API changes', async () => {
		const api = new FakeSettingsAPI(
			settingsSnapshot({ global: { editorFontSize: 18, sidebarVisible: false } })
		)
		const session = new SettingsManagementSession(api)

		await session.start()

		expect(api.events.slice(0, 2)).toEqual(['subscribe', 'inspect'])
		expect(session.loading).toBe(false)
		expect(session.settings).toMatchObject({ editorFontSize: 18, sidebarVisible: false })
		expect(session.overrideCount).toBe(2)

		const changed = deferred<SettingsSnapshot>()
		api.inspections.push(changed.promise)
		api.emitChange()
		changed.resolve(settingsSnapshot({ global: { editorFontSize: 21 } }))
		await Promise.resolve()

		expect(session.settings.editorFontSize).toBe(21)
		expect(session.overrideCount).toBe(1)
		session.dispose()
		expect(api.listeners.size).toBe(0)
	})

	test('ignores stale inspections and all inspection results after disposal', async () => {
		const api = new FakeSettingsAPI()
		const stale = deferred<SettingsSnapshot>()
		const latest = deferred<SettingsSnapshot>()
		api.inspections.push(stale.promise, latest.promise)
		const session = new SettingsManagementSession(api)

		const initialLoad = session.start()
		const refresh = session.refresh()
		latest.resolve(settingsSnapshot({ global: { editorFontSize: 22 } }))
		await refresh
		stale.resolve(settingsSnapshot({ global: { editorFontSize: 14 } }))
		await initialLoad

		expect(session.settings.editorFontSize).toBe(22)

		const disposedAPI = new FakeSettingsAPI()
		const pending = deferred<SettingsSnapshot>()
		disposedAPI.inspections.push(pending.promise)
		const disposedSession = new SettingsManagementSession(disposedAPI)
		const disposedLoad = disposedSession.start()
		disposedSession.dispose()
		pending.resolve(settingsSnapshot({ global: { editorFontSize: 24 } }))
		await disposedLoad

		expect(disposedSession.snapshot.workspaceID).toBeNull()
		expect(disposedAPI.listeners.size).toBe(0)
		session.dispose()
	})

	test('retains project scope across remounts and falls back without a project', async () => {
		const projectAPI = new FakeSettingsAPI(
			settingsSnapshot({
				global: { editorFontSize: 18 },
				project: { editorFontSize: 20, strictOpenKnowledgeFormat: true }
			})
		)
		const firstSession = new SettingsManagementSession(projectAPI)
		await firstSession.start()
		firstSession.selectScope('project')
		expect(firstSession.settings.editorFontSize).toBe(20)
		expect(firstSession.overrideCount).toBe(2)
		firstSession.dispose()

		const noProjectAPI = new FakeSettingsAPI(
			settingsSnapshot({
				workspaceID: null,
				localWorkspace: false,
				global: { editorFontSize: 19 }
			})
		)
		const remountedSession = new SettingsManagementSession(noProjectAPI)
		expect(remountedSession.scope).toBe('project')
		await remountedSession.start()

		expect(remountedSession.scope).toBe('global')
		expect(remountedSession.settings.editorFontSize).toBe(19)
		remountedSession.dispose()
		expect(new SettingsManagementSession(noProjectAPI).scope).toBe('global')
	})

	test('temporarily falls back when a superseding startup refresh fails', async () => {
		const retainedSession = new SettingsManagementSession(new FakeSettingsAPI())
		await retainedSession.start()
		retainedSession.selectScope('project')
		retainedSession.dispose()

		const api = new FakeSettingsAPI()
		const stale = deferred<SettingsSnapshot>()
		const latest = deferred<SettingsSnapshot>()
		api.inspections.push(stale.promise, latest.promise)
		const session = new SettingsManagementSession(api)
		const initialLoad = session.start()
		const refresh = session.refresh()

		latest.reject(new Error('latest load failed'))
		await refresh
		expect(session.loading).toBe(false)
		expect(session.scope).toBe('global')

		stale.reject(new Error('stale load failed'))
		await initialLoad
		await session.refresh()
		expect(session.scope).toBe('project')
		session.dispose()
	})

	test('updates and resets the selected scope, then reloads its snapshot', async () => {
		const api = new FakeSettingsAPI(
			settingsSnapshot({
				global: { editorFontSize: 18 },
				project: { sidebarVisible: false, strictOpenKnowledgeFormat: true }
			})
		)
		const session = new SettingsManagementSession(api)
		await session.start()
		session.selectScope('project')

		await session.update({ editorFontSize: 20 })

		expect(api.updates).toEqual([
			{
				workspaceID: 'workspace-one',
				scope: 'project',
				patch: { editorFontSize: 20 }
			}
		])
		expect(session.settings.editorFontSize).toBe(20)
		expect(session.overrideCount).toBe(3)

		await session.resetScope()

		expect(api.resets).toHaveLength(1)
		expect(api.resets[0]).toMatchObject({ workspaceID: 'workspace-one', scope: 'project' })
		expect(new Set(api.resets[0]?.keys)).toEqual(
			new Set(['sidebarVisible', 'strictOpenKnowledgeFormat', 'editorFontSize'])
		)
		expect(session.overrideCount).toBe(0)
		expect(session.settings.editorFontSize).toBe(18)
		session.dispose()
	})

	test('reports and dismisses load and mutation errors', async () => {
		const retainedSession = new SettingsManagementSession(new FakeSettingsAPI())
		await retainedSession.start()
		retainedSession.selectScope('project')
		retainedSession.dispose()

		const loadAPI = new FakeSettingsAPI()
		loadAPI.inspectFailure = new Error('load failed')
		const loadSession = new SettingsManagementSession(loadAPI)
		expect(loadSession.scope).toBe('project')
		await loadSession.start()
		expect(loadSession.errorKey).toBe('settingsLoadFailed')
		expect(loadSession.loading).toBe(false)
		expect(loadSession.scope).toBe('global')
		const retainedPreference = new SettingsManagementSession(loadAPI)
		expect(retainedPreference.scope).toBe('project')
		retainedPreference.dispose()
		loadSession.dismissError()
		expect(loadSession.errorKey).toBeNull()
		loadAPI.inspectFailure = null
		await loadSession.refresh()
		expect(loadSession.scope).toBe('project')
		loadSession.dispose()

		const updateAPI = new FakeSettingsAPI()
		const updateSession = new SettingsManagementSession(updateAPI)
		await updateSession.start()
		updateAPI.updateFailure = new Error('save failed')
		await updateSession.update({ editorFontSize: 17 })
		expect(updateSession.errorKey).toBe('settingsSaveFailed')
		updateSession.dismissError()
		expect(updateSession.errorKey).toBeNull()
		updateSession.dispose()
	})
})
