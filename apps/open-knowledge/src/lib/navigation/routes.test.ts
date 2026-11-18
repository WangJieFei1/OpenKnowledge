import { describe, expect, test } from 'bun:test'
import { documentRoute, workspaceRoute } from './routes'

describe('application routes', () => {
	test('encodes workspace IDs', () => {
		expect(workspaceRoute('workspace/id')).toBe('/workspaces/workspace%2Fid')
	})

	test('encodes every document path segment independently', () => {
		expect(documentRoute('workspace', '/topics/design notes.md')).toBe(
			'/workspaces/workspace/documents/topics/design%20notes.md'
		)
		expect(documentRoute('workspace', '/topics/design notes.md', { editorWindow: true })).toBe(
			'/workspaces/workspace/documents/topics/design%20notes.md?window=editor'
		)
	})
})
