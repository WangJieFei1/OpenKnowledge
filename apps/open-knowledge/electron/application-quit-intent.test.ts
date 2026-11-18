import { describe, expect, test } from 'bun:test'
import { ApplicationQuitIntent } from './application-quit-intent'

function fixture() {
	const scheduled: (() => void)[] = []
	let resumes = 0
	const intent = new ApplicationQuitIntent(
		() => {
			resumes++
		},
		(callback) => scheduled.push(callback)
	)
	return { intent, scheduled, resumed: () => resumes }
}

describe('application quit after saving blocked windows', () => {
	test('resumes an explicit quit after a blocked window saves and closes', () => {
		const { intent, scheduled, resumed } = fixture()
		intent.requestQuit()
		intent.waitForSavedWindow(1)
		expect(resumed()).toBe(0)
		intent.windowClosed(1)
		expect(resumed()).toBe(0)
		expect(scheduled).toHaveLength(1)
		scheduled.shift()!()
		expect(resumed()).toBe(1)
	})

	test('a failed save leaves its window open and prevents another window from resuming quit', () => {
		const { intent, scheduled, resumed } = fixture()
		intent.requestQuit()
		intent.waitForSavedWindow(1)
		intent.waitForSavedWindow(2)
		intent.windowClosed(1)
		intent.windowClosed(3)
		expect(scheduled).toHaveLength(0)
		expect(resumed()).toBe(0)
		// A later successful save may close the remaining blocked window.
		intent.windowClosed(2)
		scheduled.shift()!()
		expect(resumed()).toBe(1)
	})

	test('ordinary native window closure does not turn into an application quit', () => {
		const { intent, scheduled } = fixture()
		intent.waitForSavedWindow(1)
		intent.windowClosed(1)
		expect(scheduled).toHaveLength(0)
	})

	test('ignores unrelated closes and deduplicates repeated close notifications', () => {
		const { intent, scheduled, resumed } = fixture()
		intent.requestQuit()
		intent.windowClosed(4)
		expect(scheduled).toHaveLength(0)
		intent.waitForSavedWindow(1)
		intent.windowClosed(1)
		intent.windowClosed(1)
		expect(scheduled).toHaveLength(1)
		scheduled.shift()!()
		expect(resumed()).toBe(1)
	})

	test('does not retry while another window becomes blocked before the scheduled continuation', () => {
		const { intent, scheduled, resumed } = fixture()
		intent.requestQuit()
		intent.waitForSavedWindow(1)
		intent.windowClosed(1)
		intent.waitForSavedWindow(2)
		scheduled.shift()!()
		expect(resumed()).toBe(0)
		intent.windowClosed(2)
		scheduled.shift()!()
		expect(resumed()).toBe(1)
	})
})
