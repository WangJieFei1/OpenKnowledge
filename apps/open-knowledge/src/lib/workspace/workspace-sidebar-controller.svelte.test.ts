import { plugin } from 'bun'
import { describe, expect, test } from 'bun:test'
import { compileModule } from 'svelte/compiler'
import ts from 'typescript'
import type {
	KnowledgeBundleEntry,
	KnowledgeBundlePath,
	KnowledgeSearchResult
} from '#lib/knowledge/api.js'
import type {
	WorkspaceSidebarNavigationPort,
	WorkspaceSidebarSchedulerPort,
	WorkspaceSidebarSessionPort
} from './workspace-sidebar-controller.svelte'

plugin({
	name: 'workspace-sidebar-controller-runes-test-loader',
	setup(build) {
		build.onLoad({ filter: /workspace-sidebar-controller\.svelte\.ts$/ }, async ({ path }) => {
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

const { WorkspaceSidebarController } = await import('./workspace-sidebar-controller.svelte')

type Deferred<T> = {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason?: unknown) => void
}

type ScheduledTask = {
	callback: () => void
	milliseconds: number
	cancelled: boolean
	ran: boolean
}

const rootPath = '/' as KnowledgeBundlePath

function deferred<T>(): Deferred<T> {
	let resolve: Deferred<T>['resolve'] = () => undefined
	let reject: Deferred<T>['reject'] = () => undefined
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function file(id: string, path: KnowledgeBundlePath): KnowledgeBundleEntry {
	return {
		kind: 'file',
		id,
		path,
		name: path.slice(path.lastIndexOf('/') + 1),
		parentPath: rootPath,
		revision: 'revision',
		modifiedAt: '2026-08-16T00:00:00.000Z',
		byteLength: 0,
		contentHash: '0'.repeat(64)
	}
}

function directory(id: string, path: KnowledgeBundlePath): KnowledgeBundleEntry {
	return {
		kind: 'directory',
		id,
		path,
		name: path.slice(path.lastIndexOf('/') + 1),
		parentPath: rootPath,
		revision: 'revision',
		modifiedAt: '2026-08-16T00:00:00.000Z'
	}
}

function result(preview: string): KnowledgeSearchResult {
	return {
		matches: [
			{
				path: '/notes.md' as KnowledgeBundlePath,
				lineNumber: 1,
				columnNumber: 1,
				preview,
				match: preview
			}
		],
		truncated: false
	}
}

class FakeSession implements WorkspaceSidebarSessionPort {
	workspace: WorkspaceSidebarSessionPort['workspace'] = { id: 'workspace-one' }
	local = true
	entries: WorkspaceSidebarSessionPort['entries'] = []
	tabs: WorkspaceSidebarSessionPort['tabs'] = []
	readonly searchCalls: string[] = []
	readonly openCalls: Array<[KnowledgeBundlePath, string | undefined]> = []
	searchHandler: (query: string) => Promise<KnowledgeSearchResult | null> = async () =>
		result('default')
	openHandler: (path: KnowledgeBundlePath, id?: string) => Promise<boolean> = async () => true

	search(query: string): Promise<KnowledgeSearchResult | null> {
		this.searchCalls.push(query)
		return this.searchHandler(query)
	}

	openDocument(path: KnowledgeBundlePath, id?: string): Promise<boolean> {
		this.openCalls.push([path, id])
		return this.openHandler(path, id)
	}
}

class FakeNavigation implements WorkspaceSidebarNavigationPort {
	readonly calls: Array<{
		workspaceID: string
		path: KnowledgeBundlePath
		replaceState: boolean
	}> = []
	handler: () => Promise<void> = async () => undefined

	navigateDocument(
		workspaceID: string,
		path: KnowledgeBundlePath,
		{ replaceState }: { replaceState: boolean }
	): Promise<void> {
		this.calls.push({ workspaceID, path, replaceState })
		return this.handler()
	}
}

class FakeScheduler implements WorkspaceSidebarSchedulerPort {
	readonly tasks: ScheduledTask[] = []

	schedule(callback: () => void, milliseconds: number): () => void {
		const task = { callback, milliseconds, cancelled: false, ran: false }
		this.tasks.push(task)
		return () => {
			task.cancelled = true
		}
	}

	run(index: number): void {
		const task = this.tasks[index]
		if (task && !task.cancelled && !task.ran) {
			task.ran = true
			task.callback()
		}
	}
}

async function settle(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

describe('WorkspaceSidebarController search', () => {
	test('debounces trimmed local searches for 180ms and repeats them when entries change', async () => {
		const session = new FakeSession()
		const navigation = new FakeNavigation()
		const scheduler = new FakeScheduler()
		const controller = new WorkspaceSidebarController(session, navigation, scheduler)
		controller.query = '  design notes  '

		controller.synchronizeSearch()

		expect(controller.searchMatches).toBeNull()
		expect(controller.searchLoading).toBe(true)
		expect(controller.searchFailed).toBe(false)
		expect(session.searchCalls).toEqual([])
		expect(scheduler.tasks.map((task) => task.milliseconds)).toEqual([180])

		scheduler.run(0)
		await settle()
		expect(session.searchCalls).toEqual(['design notes'])
		expect(controller.searchMatches).toEqual(result('default'))
		expect(controller.searchLoading).toBe(false)

		session.entries = [file('new-entry', '/new.md' as KnowledgeBundlePath)]
		controller.synchronizeSearch()
		expect(controller.searchMatches).toBeNull()
		expect(controller.searchLoading).toBe(true)
		scheduler.run(1)
		await settle()

		expect(session.searchCalls).toEqual(['design notes', 'design notes'])
		controller.dispose()
	})

	test('searches only local workspaces with a non-empty query and clears pending search state', () => {
		const session = new FakeSession()
		const scheduler = new FakeScheduler()
		const controller = new WorkspaceSidebarController(session, new FakeNavigation(), scheduler)
		controller.query = 'notes'
		session.local = false
		controller.synchronizeSearch()
		expect(scheduler.tasks).toEqual([])
		expect(controller.searchLoading).toBe(false)

		session.local = true
		session.workspace = null
		controller.synchronizeSearch()
		expect(scheduler.tasks).toEqual([])

		session.workspace = { id: 'workspace-one' }
		controller.synchronizeSearch()
		expect(scheduler.tasks).toHaveLength(1)
		expect(controller.searchLoading).toBe(true)

		controller.clearQuery()
		controller.synchronizeSearch()
		expect(controller.query).toBe('')
		expect(controller.searchMatches).toBeNull()
		expect(controller.searchLoading).toBe(false)
		expect(controller.searchFailed).toBe(false)
		expect(scheduler.tasks[0]?.cancelled).toBe(true)
		controller.dispose()
	})

	test('suppresses stale results and exposes failure only for the latest search', async () => {
		const session = new FakeSession()
		const scheduler = new FakeScheduler()
		const first = deferred<KnowledgeSearchResult | null>()
		const second = deferred<KnowledgeSearchResult | null>()
		const failed = deferred<KnowledgeSearchResult | null>()
		session.searchHandler = (query) =>
			query === 'first' ? first.promise : query === 'second' ? second.promise : failed.promise
		const controller = new WorkspaceSidebarController(session, new FakeNavigation(), scheduler)

		controller.query = 'first'
		controller.synchronizeSearch()
		scheduler.run(0)
		controller.query = 'second'
		controller.synchronizeSearch()
		scheduler.run(1)

		second.resolve(result('latest'))
		await settle()
		expect(controller.searchMatches).toEqual(result('latest'))
		expect(controller.searchFailed).toBe(false)

		first.resolve(null)
		await settle()
		expect(controller.searchMatches).toEqual(result('latest'))
		expect(controller.searchFailed).toBe(false)

		controller.query = 'failed'
		controller.synchronizeSearch()
		scheduler.run(2)
		failed.resolve(null)
		await settle()
		expect(controller.searchMatches).toBeNull()
		expect(controller.searchLoading).toBe(false)
		expect(controller.searchFailed).toBe(true)
		controller.dispose()
	})
})

describe('WorkspaceSidebarController document opening', () => {
	test('navigates to a canonical opened path and replaces a stale entry path', async () => {
		const session = new FakeSession()
		const navigation = new FakeNavigation()
		const controller = new WorkspaceSidebarController(session, navigation)
		const entry = file('document-one', '/old.md' as KnowledgeBundlePath)
		session.openHandler = async () => {
			session.tabs = [
				{
					path: '/renamed.md' as KnowledgeBundlePath,
					document: { id: entry.id }
				}
			]
			return true
		}

		await controller.openEntry(entry)

		expect(session.openCalls).toEqual([[entry.path, entry.id]])
		expect(navigation.calls).toEqual([
			{
				workspaceID: 'workspace-one',
				path: '/renamed.md',
				replaceState: true
			}
		])
		controller.dispose()
	})

	test('uses the requested path without replacement when no canonical path is available', async () => {
		const session = new FakeSession()
		const navigation = new FakeNavigation()
		const controller = new WorkspaceSidebarController(session, navigation)
		const entry = file('document-one', '/notes.md' as KnowledgeBundlePath)

		await controller.openEntry(entry)

		expect(navigation.calls).toEqual([
			{
				workspaceID: 'workspace-one',
				path: entry.path,
				replaceState: false
			}
		])
		controller.dispose()
	})

	test('lets only the latest file-open request navigate', async () => {
		const session = new FakeSession()
		const navigation = new FakeNavigation()
		const first = deferred<boolean>()
		const second = deferred<boolean>()
		const firstEntry = file('first', '/first.md' as KnowledgeBundlePath)
		const secondEntry = file('second', '/second.md' as KnowledgeBundlePath)
		session.openHandler = (path) => (path === firstEntry.path ? first.promise : second.promise)
		const controller = new WorkspaceSidebarController(session, navigation)

		const firstOpen = controller.openEntry(firstEntry)
		const secondOpen = controller.openEntry(secondEntry)
		first.resolve(true)
		await settle()
		expect(navigation.calls).toEqual([])

		second.resolve(true)
		await Promise.all([firstOpen, secondOpen])
		expect(navigation.calls).toEqual([
			{
				workspaceID: 'workspace-one',
				path: secondEntry.path,
				replaceState: false
			}
		])
		controller.dispose()
	})

	test('does not navigate invalid or failed opens', async () => {
		const session = new FakeSession()
		const navigation = new FakeNavigation()
		const controller = new WorkspaceSidebarController(session, navigation)

		await controller.openEntry(directory('folder', '/folder' as KnowledgeBundlePath))
		session.openHandler = async () => false
		await controller.openEntry(file('document', '/notes.md' as KnowledgeBundlePath))
		session.workspace = null
		await controller.openEntry(file('other', '/other.md' as KnowledgeBundlePath))

		expect(session.openCalls).toEqual([['/notes.md', 'document']])
		expect(navigation.calls).toEqual([])
		controller.dispose()
	})

	test('preserves navigation rejection and invalidates pending work on dispose', async () => {
		const session = new FakeSession()
		const navigation = new FakeNavigation()
		const scheduler = new FakeScheduler()
		const controller = new WorkspaceSidebarController(session, navigation, scheduler)
		navigation.handler = async () => {
			throw new Error('navigation rejected')
		}

		await expect(
			controller.openEntry(file('rejected', '/rejected.md' as KnowledgeBundlePath))
		).rejects.toThrow('navigation rejected')

		const opening = deferred<boolean>()
		session.openHandler = () => opening.promise
		const pendingOpen = controller.openEntry(file('pending', '/pending.md' as KnowledgeBundlePath))
		controller.query = 'pending'
		controller.synchronizeSearch()
		controller.dispose()
		controller.dispose()
		opening.resolve(true)
		await pendingOpen

		expect(navigation.calls).toHaveLength(1)
		expect(scheduler.tasks[0]?.cancelled).toBe(true)
	})
})
