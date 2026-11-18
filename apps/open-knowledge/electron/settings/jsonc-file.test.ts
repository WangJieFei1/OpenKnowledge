import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { nodeErrorCode } from '../validation'
import { JSONCFile } from './jsonc-file'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

async function temporaryPath(...segments: string[]): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-jsonc-'))
	temporaryDirectories.push(directory)
	return path.join(directory, ...segments)
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await stat(filePath)
		return true
	} catch (error) {
		if (nodeErrorCode(error) === 'ENOENT') {
			return false
		}
		throw error
	}
}

describe('JSONCFile', () => {
	test('loads comments and trailing commas', async () => {
		const filePath = await temporaryPath('settings.jsonc')
		await writeFile(
			filePath,
			`{
	// User preference.
	"theme": "light",
	"feature": {
		"enabled": true,
	},
}
`
		)

		await expect(new JSONCFile(filePath).load()).resolves.toEqual({
			theme: 'light',
			feature: { enabled: true }
		})
	})

	test('sets and deletes top-level keys without replacing comments or unknown keys', async () => {
		const filePath = await temporaryPath('settings.jsonc')
		await writeFile(
			filePath,
			`{
	// This comment and unknown setting belong to the user.
	"futureSetting": true,
	"theme": "light",
}
`
		)
		const file = new JSONCFile(filePath)

		await file.set('theme', 'dark')
		await file.set('fontSize', 14)
		await file.delete('theme')

		const content = await readFile(filePath, 'utf8')
		expect(content).toContain('// This comment and unknown setting belong to the user.')
		await expect(file.load()).resolves.toEqual({
			futureSetting: true,
			fontSize: 14
		})
	})

	test('does not create a missing parent directory until an explicit write', async () => {
		const filePath = await temporaryPath('nested', 'settings.jsonc')
		const directory = path.dirname(filePath)
		const file = new JSONCFile(filePath)

		await expect(file.load()).resolves.toEqual({})
		expect(await exists(directory)).toBe(false)

		await file.set('enabled', true)
		expect(await exists(directory)).toBe(true)
		await expect(file.load()).resolves.toEqual({ enabled: true })
	})

	test('refuses to load or overwrite malformed JSONC', async () => {
		const filePath = await temporaryPath('settings.jsonc')
		const malformed = `{
	// Preserve this diagnostic context.
	"theme":,
}
`
		await writeFile(filePath, malformed)
		const file = new JSONCFile(filePath)

		await expect(file.load()).rejects.toBeInstanceOf(SyntaxError)
		await expect(file.set('theme', 'dark')).rejects.toBeInstanceOf(SyntaxError)
		expect(await readFile(filePath, 'utf8')).toBe(malformed)
	})

	test('refuses a JSONC array where an object is required', async () => {
		const filePath = await temporaryPath('settings.jsonc')
		await writeFile(filePath, '[{"theme":"light"}]')

		await expect(new JSONCFile(filePath).load()).rejects.toThrow(
			`Expected ${filePath} to contain a JSONC object.`
		)
	})

	test('refuses ambiguous duplicate top-level settings', async () => {
		const filePath = await temporaryPath('settings.jsonc')
		const duplicate = '{ "theme": "light", "theme": "dark" }\n'
		await writeFile(filePath, duplicate)
		const file = new JSONCFile(filePath)

		await expect(file.load()).rejects.toThrow('duplicate property "theme"')
		await expect(file.set('theme', 'blue')).rejects.toThrow('duplicate property "theme"')
		expect(await readFile(filePath, 'utf8')).toBe(duplicate)
	})

	test('validates and normalizes before replacing the file', async () => {
		const filePath = await temporaryPath('settings.jsonc')
		await writeFile(filePath, '{ "retries": 2 }')
		const file = new JSONCFile<{ retries: number }>(filePath, {
			normalize(value) {
				if (typeof value.retries !== 'number') {
					throw new TypeError('retries must be a number')
				}
				return { retries: Math.max(0, Math.trunc(value.retries)) }
			}
		})

		await expect(file.set('retries', 'invalid')).rejects.toThrow('retries must be a number')
		expect(await readFile(filePath, 'utf8')).toBe('{ "retries": 2 }')
	})

	test('atomically replaces files with owner-only permissions', async () => {
		const filePath = await temporaryPath('settings.jsonc')
		await writeFile(filePath, '{ "enabled": false }')
		if (process.platform !== 'win32') {
			await chmod(filePath, 0o666)
		}

		await new JSONCFile(filePath).set('enabled', true)

		if (process.platform !== 'win32') {
			expect((await stat(filePath)).mode & 0o777).toBe(0o600)
		}
		expect((await readdir(path.dirname(filePath))).some((name) => name.endsWith('.tmp'))).toBe(
			false
		)
	})
})
