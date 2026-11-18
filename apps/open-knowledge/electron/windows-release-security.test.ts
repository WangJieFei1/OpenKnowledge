import { expect, test } from 'bun:test'
import { resolveWindowsReleaseSigning } from './windows-release-security'

const release = { OPEN_KNOWLEDGE_WINDOWS_RELEASE: '1' }
const thumbprint = 'a'.repeat(40)

test('Windows release signing is explicit and uses SHA-256', () => {
	expect(resolveWindowsReleaseSigning('win32', {})).toBeUndefined()
	expect(resolveWindowsReleaseSigning('win32', {
		...release,
		OPEN_KNOWLEDGE_WINDOWS_CERT_THUMBPRINT: thumbprint
	})).toEqual({ signWithParams: ['/sha1', thumbprint], hashes: ['sha256'] })
})

test('signed Windows builds require Windows and a certificate thumbprint', () => {
	expect(() => resolveWindowsReleaseSigning('darwin', release)).toThrow(/on Windows/)
	expect(() => resolveWindowsReleaseSigning('win32', release)).toThrow(/thumbprint/)
	expect(() => resolveWindowsReleaseSigning('win32', {
		...release,
		OPEN_KNOWLEDGE_WINDOWS_CERT_THUMBPRINT: 'not a thumbprint'
	})).toThrow(/thumbprint/)
})
