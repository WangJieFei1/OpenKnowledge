import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { normalizedSystemPath } from './system-path'

describe('system path validation', () => {
	test('accepts and normalizes operating-system absolute paths', () => {
		expect(normalizedSystemPath('/home/user/notes/../guide.md', path.posix)).toBe(
			'/home/user/guide.md'
		)
		expect(normalizedSystemPath('C:/Users/name/guide.md', path.win32)).toBe(
			'C:\\Users\\name\\guide.md'
		)
		expect(normalizedSystemPath('\\\\server\\share\\guide.md', path.win32)).toBe(
			'\\\\server\\share\\guide.md'
		)
	})

	test('rejects relative and Windows device paths after normalization', () => {
		expect(() => normalizedSystemPath('../guide.md', path.posix)).toThrow('Only absolute')
		for (const candidate of [
			'\\\\?\\C:\\payload.exe',
			'\\\\?\\/C:/payload.exe',
			'\\\\.\\/C:/payload.exe'
		]) {
			expect(() => normalizedSystemPath(candidate, path.win32)).toThrow('device paths')
		}
	})
})
