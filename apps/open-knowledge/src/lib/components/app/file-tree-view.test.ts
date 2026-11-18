import { describe, expect, test } from 'bun:test'
import { filterEntries, type FileTreeViewEntry } from './file-tree-view'

function paths(entries: FileTreeViewEntry[]): string[] {
	return entries.map((entry) => entry.path)
}

describe('file tree view', () => {
	test('includes every matching ancestor while preserving source order', () => {
		const entries = [
			{ path: '/notes/target.md', parentPath: '/notes' },
			{ path: '/unrelated.md', parentPath: '/' },
			{ path: '/notes', parentPath: '/' },
			{ path: '/notes/archive', parentPath: '/notes' },
			{ path: '/notes/archive/target-plan.md', parentPath: '/notes/archive' }
		]

		expect(paths(filterEntries(entries, ' TARGET ', new Set()))).toEqual([
			'/notes/target.md',
			'/notes',
			'/notes/archive',
			'/notes/archive/target-plan.md'
		])
	})

	test('hides descendants of collapsed directories but leaves the directories visible', () => {
		const entries = [
			{ path: '/notes', parentPath: '/' },
			{ path: '/notes/current.md', parentPath: '/notes' },
			{ path: '/notes/archive', parentPath: '/notes' },
			{ path: '/notes/archive/old.md', parentPath: '/notes/archive' },
			{ path: '/root.md', parentPath: '/' }
		]

		expect(paths(filterEntries(entries, '', new Set(['/notes'])))).toEqual(['/notes', '/root.md'])
		expect(paths(filterEntries(entries, '  ', new Set(['/notes/archive'])))).toEqual([
			'/notes',
			'/notes/current.md',
			'/notes/archive',
			'/root.md'
		])
	})

	test('ignores collapse state while querying and reveals matching ancestors', () => {
		const entries = [
			{ path: '/notes', parentPath: '/' },
			{ path: '/notes/current.md', parentPath: '/notes' },
			{ path: '/notes/archive', parentPath: '/notes' },
			{ path: '/notes/archive/old.md', parentPath: '/notes/archive' },
			{ path: '/root.md', parentPath: '/' }
		]

		expect(paths(filterEntries(entries, 'OLD.MD', new Set(['/notes', '/notes/archive'])))).toEqual([
			'/notes',
			'/notes/archive',
			'/notes/archive/old.md'
		])
	})
})
