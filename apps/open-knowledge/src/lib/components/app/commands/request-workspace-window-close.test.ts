import { describe, expect, test } from 'bun:test'
import { requestWorkspaceWindowClose } from './request-workspace-window-close'

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe('requestWorkspaceWindowClose', () => {
	test('waits for a successful workspace flush before closing', async () => {
		const events: string[] = []
		const flushed = deferred<boolean>()
		const request = requestWorkspaceWindowClose(
			{
				flushAll() {
					events.push('flush')
					return flushed.promise
				}
			},
			{
				async close() {
					events.push('close')
				}
			}
		)

		expect(events).toEqual(['flush'])
		flushed.resolve(true)
		await request
		expect(events).toEqual(['flush', 'close'])
	})

	test('does not close when any workspace draft fails to flush', async () => {
		let closeCalls = 0
		await requestWorkspaceWindowClose(
			{ flushAll: async () => false },
			{
				async close() {
					closeCalls += 1
				}
			}
		)

		expect(closeCalls).toBe(0)
	})
})
