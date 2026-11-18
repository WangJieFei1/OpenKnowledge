import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveAppEdition } from '../src/lib/app-edition'
import { configureEditionIdentity } from './app-identity'

const directories: string[] = []
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true })
	}
})

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'ok-edition-identity-'))
	directories.push(root)
	const paths = new Map<string, string>()
	return {
		root,
		paths,
		application: {
			setName(name: string) {
				paths.set('name', name)
			},
			getPath() {
				return root
			},
			setPath(name: string, value: string) {
				// Like Electron, fail if the override target does not yet exist.
				expect(existsSync(value)).toBe(true)
				paths.set(name, value)
			}
		}
	}
}

describe('edition runtime identity', () => {
	test('creates independent private directories on first launch, before overriding paths', () => {
		const { root, paths, application } = fixture()
		for (const id of ['general', 'codex'] as const) {
			const edition = resolveAppEdition(id)
			const result = configureEditionIdentity(application, edition)
			expect(result).toBe(path.join(root, edition.name))
			expect(paths.get('name')).toBe(edition.name)
			expect(paths.get('userData')).toBe(result)
			expect(paths.get('sessionData')).toBe(result)
		}
	})
	test('preserves existing edition data without importing legacy grants', () => {
		const { root, application } = fixture()
		const legacy = path.join(root, 'Open Knowledge')
		mkdirSync(legacy)
		writeFileSync(path.join(legacy, 'legacy-grants.json'), '{"memoryEnabled":true}')
		const general = resolveAppEdition('general')
		const target = configureEditionIdentity(application, general)
		writeFileSync(path.join(target, 'keep.txt'), 'existing')
		configureEditionIdentity(application, general)
		expect(existsSync(path.join(target, 'keep.txt'))).toBe(true)
		expect(existsSync(path.join(target, 'legacy-grants.json'))).toBe(false)
	})
	test('rejects redirecting one edition profile to another via a symlink', () => {
		const { root, paths, application } = fixture()
		const codex = configureEditionIdentity(application, resolveAppEdition('codex'))
		paths.clear()
		symlinkSync(codex, path.join(root, resolveAppEdition('general').name), 'dir')
		expect(() => configureEditionIdentity(application, resolveAppEdition('general'))).toThrow(
			'real directory'
		)
		expect(paths.size).toBe(0)
	})
})
