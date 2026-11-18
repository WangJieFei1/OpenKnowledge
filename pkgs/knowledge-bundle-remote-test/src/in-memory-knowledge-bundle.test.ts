import { expect, test } from 'bun:test'
import { InMemoryKnowledgeBundle } from './in-memory-knowledge-bundle'

test('rejects malformed RPC inputs with domain errors', async () => {
	const bundle = new InMemoryKnowledgeBundle()

	await expect(
		bundle.list({ path: '/', depth: Number.MAX_SAFE_INTEGER + 1 } as never)
	).rejects.toThrow('Listing depth must be a non-negative integer.')
	await expect(bundle.list([] as never)).rejects.toThrow(
		'A locator object with a canonical path is required.'
	)
	await expect(bundle.readFile({ id: 42, path: '/welcome.md' } as never)).rejects.toThrow(
		'A locator object with a canonical path is required.'
	)
	expect(await bundle.createFile({ path: '/invalid.md', content: 42 } as never)).toMatchObject({
		ok: false,
		error: { code: 'unsupported', message: 'File content must be a string.' }
	})
	expect(
		await bundle.createFile({
			path: '/invalid.md',
			content: '# Invalid',
			mediaType: 'text/markdown\n'
		} as never)
	).toMatchObject({
		ok: false,
		error: { code: 'unsupported', message: 'The media type is not valid.' }
	})
	expect(
		await bundle.patchFile({
			path: '/welcome.md',
			edits: [{ oldText: 42, newText: '# Invalid' }]
		} as never)
	).toMatchObject({
		ok: false,
		error: { code: 'invalid_patch', editNumber: 1 }
	})
})
