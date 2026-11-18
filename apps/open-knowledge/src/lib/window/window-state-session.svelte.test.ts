import { plugin } from 'bun'
import { describe, expect, test } from 'bun:test'
import { compileModule } from 'svelte/compiler'
import ts from 'typescript'
import type { WindowState } from './api'
import type { WindowStateAPI } from './window-state-session.svelte'

plugin({
	name: 'window-state-session-runes-test-loader',
	setup(build) {
		build.onLoad({ filter: /window-state-session\.svelte\.ts$/ }, async ({ path }) => {
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

const { WindowStateSession } = await import('./window-state-session.svelte')

type Deferred<T> = {
	promise: Promise<T>
	resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function state(maximized: boolean): WindowState {
	return { role: 'workspace', presentation: 'workspace', maximized }
}

async function settle(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

class FakeWindowStateAPI implements WindowStateAPI {
	readonly events: string[] = []
	readonly initialState = deferred<WindowState>()
	listener: ((maximized: boolean) => void) | undefined
	unsubscribeCalls = 0

	getState = (): Promise<WindowState> => {
		this.events.push('get-state')
		return this.initialState.promise
	}

	onMaximizedChange = (listener: (maximized: boolean) => void): (() => void) => {
		this.events.push('subscribe')
		this.listener = listener
		return () => {
			this.unsubscribeCalls += 1
		}
	}

	minimize = async (): Promise<void> => {}

	toggleMaximize = async (): Promise<void> => {}

	close = async (): Promise<void> => {}

	emit(maximized: boolean): void {
		this.listener?.(maximized)
	}
}

describe('WindowStateSession', () => {
	test('subscribes before loading initial state and starts only once', async () => {
		const api = new FakeWindowStateAPI()
		const session = new WindowStateSession(api)

		session.start()
		session.start()
		expect(api.events).toEqual(['subscribe', 'get-state'])
		api.initialState.resolve(state(true))
		await settle()

		expect(session.maximized).toBe(true)
		session.dispose()
		expect(api.unsubscribeCalls).toBe(1)
	})

	test('does not let a stale initial state overwrite a newer maximize event', async () => {
		const api = new FakeWindowStateAPI()
		const session = new WindowStateSession(api)

		session.start()
		api.emit(true)
		api.initialState.resolve(state(false))
		await settle()

		expect(session.maximized).toBe(true)
		session.dispose()
	})

	test('ignores pending state and event callbacks after disposal', async () => {
		const api = new FakeWindowStateAPI()
		const session = new WindowStateSession(api)

		session.start()
		api.emit(true)
		session.dispose()
		session.dispose()
		api.emit(false)
		api.initialState.resolve(state(false))
		await settle()

		expect(session.maximized).toBe(true)
		expect(api.unsubscribeCalls).toBe(1)
	})
})
