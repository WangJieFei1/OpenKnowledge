import { describe, expect, test } from 'bun:test'
import type {
	KnowledgeBundleEntry,
	KnowledgeBundleFile,
	KnowledgeBundlePath
} from '@open-knowledge/knowledge-bundle-api'
import { detectOpenKnowledgeRoots } from './workspace-format'

const versionedIndex = '---\nokf_version: "0.2"\n---\n# Index\n'

describe('workspace Open Knowledge roots', () => {
	test('detects versioned root and nested indexes only', async () => {
		const documents = new Map([
			['/index.md', document('/index.md', '# Generic index\n')],
			['/knowledge/index.md', document('/knowledge/index.md', versionedIndex)],
			['/knowledge/special/index.md', document('/knowledge/special/index.md', versionedIndex)]
		])
		const entries: KnowledgeBundleEntry[] = [...documents.values()]
		expect(
			await detectOpenKnowledgeRoots(entries, async (path) => documents.get(path) ?? null)
		).toEqual(['/knowledge', '/knowledge/special'])
	})
})

function document(path: KnowledgeBundlePath, content: string): KnowledgeBundleFile {
	const separator = path.lastIndexOf('/')
	return {
		kind: 'file',
		id: path,
		name: path.slice(separator + 1),
		path,
		parentPath: separator <= 0 ? '/' : (path.slice(0, separator) as KnowledgeBundlePath),
		revision: 'revision',
		modifiedAt: '2026-08-02T00:00:00.000Z',
		byteLength: Buffer.byteLength(content),
		contentHash: 'a'.repeat(64),
		mediaType: 'text/markdown',
		content
	}
}
