import { describe, expect, test } from 'bun:test'
import { forbiddenPackagedSwitches, hardenPackagedCommandLine } from './packaged-command-line'

describe('packaged command line hardening', () => {
	test('removes debugging, insecure-content and sandbox-bypass switches from packages', () => {
		const removed: string[] = []
		hardenPackagedCommandLine(true, { removeSwitch: (name) => removed.push(name) })
		expect(removed).toEqual([...forbiddenPackagedSwitches])
		expect(removed).toContain('remote-debugging-port')
		expect(removed).toContain('disable-web-security')
		expect(removed).toContain('no-sandbox')
	})

	test('preserves development debugging switches', () => {
		const removed: string[] = []
		hardenPackagedCommandLine(false, { removeSwitch: (name) => removed.push(name) })
		expect(removed).toEqual([])
	})
})
