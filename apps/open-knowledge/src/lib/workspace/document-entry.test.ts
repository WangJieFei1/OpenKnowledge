import { expect, test } from 'bun:test'
import type { WorkspaceEntry } from '../knowledge/api'
import { currentDocumentEntry } from './document-entry'

const base = {
	parentPath: '/',
	modifiedAt: '2026-08-06T00:00:00.000Z',
	kind: 'file' as const,
	byteLength: 0,
	contentHash: '0'.repeat(64),
	mediaType: 'text/markdown',
	documentAccess: 'writable'
} as const

test('follows a document ID when its old path is reused', () => {
	const entries: WorkspaceEntry[] = [
		{
			...base,
			id: 'replacement',
			path: '/welcome.md',
			name: 'welcome.md',
			revision: 'replacement-revision'
		},
		{
			...base,
			id: 'original',
			path: '/moved-welcome.md',
			name: 'moved-welcome.md',
			revision: 'moved-revision'
		}
	]

	expect(currentDocumentEntry(entries, 'original')).toMatchObject({
		id: 'original',
		path: '/moved-welcome.md'
	})
	expect(currentDocumentEntry(entries, 'removed')).toBeUndefined()
})
