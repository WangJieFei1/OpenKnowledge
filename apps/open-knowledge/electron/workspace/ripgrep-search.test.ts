import { afterEach, describe, expect, test } from 'bun:test'
import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { searchWorkspaceWithRipgrep } from './ripgrep-runtime'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

describe('WASM ripgrep workspace search', () => {
	test('returns bounded line matches without searching internal project data', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-search-'))
		temporaryDirectories.push(root)
		await mkdir(path.join(root, '.open-knowledge', 'index', 'search'), { recursive: true })
		await mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true })
		await writeFile(path.join(root, 'notes.md'), 'Another Alpha note.\n')
		await writeFile(path.join(root, 'guide.md'), '# Guide\n\nCafé Alpha notes.\n')
		await writeFile(path.join(root, 'unsupported.txt'), 'Alpha unsupported source.\n')
		await writeFile(path.join(root, '.gitignore'), 'ignored.md\n')
		await writeFile(path.join(root, 'ignored.md'), 'Alpha ignored source.\n')
		await writeFile(
			path.join(root, '.open-knowledge', 'index', 'search', 'private.md'),
			'Alpha internal data.\n'
		)
		await link(
			path.join(root, '.open-knowledge', 'index', 'search', 'private.md'),
			path.join(root, 'hardlink.md')
		)
		await writeFile(
			path.join(root, 'node_modules', 'ignored', 'dependency.md'),
			'Alpha dependency.\n'
		)

		const result = await searchWorkspaceWithRipgrep(root, {
			query: 'Alpha',
			caseMode: 'smart',
			fixedStrings: true,
			wholeWord: false,
			searchPath: '/',
			excludeGlobs: [],
			limit: 10,
			maximumFileBytes: 1024 * 1024
		})

		expect(result).toEqual({
			matches: [
				{
					path: '/guide.md',
					lineNumber: 3,
					columnNumber: 7,
					preview: 'Café Alpha notes.',
					match: 'Alpha'
				},
				{
					path: '/notes.md',
					lineNumber: 1,
					columnNumber: 9,
					preview: 'Another Alpha note.',
					match: 'Alpha'
				}
			],
			truncated: false
		})
		expect(
			await Promise.all(
				(['/missing', '/ignored.md', '/unsupported.txt'] as const).map((searchPath) =>
					searchWorkspaceWithRipgrep(root, {
						query: 'Alpha',
						caseMode: 'smart',
						fixedStrings: true,
						wholeWord: false,
						searchPath,
						excludeGlobs: [],
						limit: 10,
						maximumFileBytes: 1024 * 1024
					})
				)
			)
		).toEqual([
			{ matches: [], truncated: false },
			{ matches: [], truncated: false },
			{ matches: [], truncated: false }
		])
	})
})
