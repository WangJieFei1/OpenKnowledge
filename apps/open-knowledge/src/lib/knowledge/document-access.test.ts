import { describe, expect, test } from 'bun:test'
import type {
	KnowledgeBundleFileAccess,
	KnowledgeBundleFileEntry,
	KnowledgeBundlePath
} from '@open-knowledge/knowledge-bundle-api'
import { documentAccessForFile } from './document-access'

describe('workspace document access', () => {
	test('classifies every local file for presentation', () => {
		expect(documentAccessForFile(file('/notes.md'), 'local', 'editable')).toBe('writable')
		expect(documentAccessForFile(file('/notes.md'), 'local', 'readonly')).toBe('readonly')
		expect(documentAccessForFile(file('/report.pdf'), 'local', 'editable')).toBe('readonly')
		expect(documentAccessForFile(file('/archive.zip'), 'local', 'editable')).toBe('not_supported')
	})

	test('uses remote declarations without elevating bundle access', () => {
		expect(documentAccessForFile(file('/report.bin', 'writable'), 'remote', 'editable')).toBe(
			'writable'
		)
		expect(documentAccessForFile(file('/report.bin', 'writable'), 'remote', 'readonly')).toBe(
			'readonly'
		)
		expect(documentAccessForFile(file('/report.bin', 'readonly'), 'remote', 'editable')).toBe(
			'readonly'
		)
		expect(documentAccessForFile(file('/report.bin', 'not_supported'), 'remote', 'editable')).toBe(
			'not_supported'
		)
	})

	test('keeps legacy remote Markdown behavior', () => {
		expect(documentAccessForFile(file('/notes.md'), 'remote', 'editable')).toBe('writable')
		expect(documentAccessForFile(file('/notes.md'), 'remote', 'readonly')).toBe('readonly')
		expect(documentAccessForFile(file('/archive.zip'), 'remote', 'editable')).toBe('not_supported')
	})
})

function file(
	path: KnowledgeBundlePath,
	documentAccess?: KnowledgeBundleFileAccess
): KnowledgeBundleFileEntry {
	const separator = path.lastIndexOf('/')
	return {
		kind: 'file',
		id: path,
		path,
		name: path.slice(separator + 1),
		parentPath: separator <= 0 ? '/' : (path.slice(0, separator) as KnowledgeBundlePath),
		revision: 'revision',
		modifiedAt: '2026-08-11T00:00:00.000Z',
		byteLength: 0,
		contentHash: '0'.repeat(64),
		...(documentAccess ? { documentAccess } : {})
	}
}
