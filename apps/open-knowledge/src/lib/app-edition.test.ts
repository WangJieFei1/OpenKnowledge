import { describe, expect, test } from 'bun:test'
import { appEdition, resolveAppEdition } from './app-edition'

describe('application editions', () => {
	test('defaults to the client-neutral edition', () => {
		expect(resolveAppEdition(undefined)).toEqual(resolveAppEdition('general'))
		expect(appEdition.id).toBe('general')
		expect(appEdition.codexMemory).toBe(false)
	})
	test('isolates install and runtime identities', () => {
		const general = resolveAppEdition('general')
		const codex = resolveAppEdition('codex')
		for (const key of [
			'name',
			'bundleID',
			'executableName',
			'packageName',
			'windowsAppID'
		] as const) {
			expect(general[key]).not.toBe(codex[key])
		}
		expect(codex.codexMemory).toBe(true)
		expect(Object.isFrozen(general)).toBe(true)
		expect(Object.isFrozen(codex)).toBe(true)
	})
	test('does not treat missing or misspelled build choices as Codex', () => {
		for (const value of ['', 'Codex', 'codex ', 'general,codex', 'unknown']) {
			expect(() => resolveAppEdition(value)).toThrow('must be general or codex')
		}
	})
})
