import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SemanticVectorCache } from './vector-cache'

const directories: string[] = []
async function directory() {
	const value = await mkdtemp(path.join(tmpdir(), 'ok-semantic-'))
	directories.push(value)
	return value
}
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))
	)
})
const vector = [1, ...Array<number>(383).fill(0)]

test('cache reuses unchanged content across restarts without persisting source text', async () => {
	const root = await directory()
	const first = new SemanticVectorCache(root)
	const original = 'Private lockbox code and personal contact details.'
	const key = first.key(original)
	first.set(key, [vector])
	await first.save()
	const second = new SemanticVectorCache(root)
	await second.load()
	expect(second.get(key)).toEqual([vector])
	expect(second.get(second.key(original + ' Changed.'))).toBeUndefined()
	expect(await readFile(path.join(root, 'vectors.json'), 'utf8')).not.toContain(original)
	if (process.platform !== 'win32') {
		expect((await stat(root)).mode & 0o777).toBe(0o700)
		expect((await stat(path.join(root, 'vectors.json'))).mode & 0o777).toBe(0o600)
	}
})

test('restart removes an interrupted pending write and keeps the cache usable', async () => {
	const root = await directory()
	const pending = path.join(root, 'vectors.pending')
	await writeFile(pending, '{"interrupted":')

	const first = new SemanticVectorCache(root)
	await first.load()
	await expect(stat(pending)).rejects.toMatchObject({ code: 'ENOENT' })
	const firstKey = first.key('first source')
	first.set(firstKey, [vector])
	await first.save()

	// Simulate a process killed after staging its next checkpoint but before rename.
	await writeFile(pending, '{"interrupted":')
	const restarted = new SemanticVectorCache(root)
	await restarted.load()
	expect(restarted.get(firstKey)).toEqual([vector])
	await expect(stat(pending)).rejects.toMatchObject({ code: 'ENOENT' })
	const secondKey = restarted.key('second source')
	restarted.set(secondKey, [vector])
	await restarted.save()

	const verified = new SemanticVectorCache(root)
	await verified.load()
	expect(verified.get(firstKey)).toEqual([vector])
	expect(verified.get(secondKey)).toEqual([vector])
})

test('corrupt or incompatible caches are discarded', async () => {
	const root = await directory()
	for (const content of ['not json', JSON.stringify({ fingerprint: 'old-model', entries: [] })]) {
		await writeFile(path.join(root, 'vectors.json'), content)
		const cache = new SemanticVectorCache(root)
		await cache.load()
		expect(cache.get(cache.key('source'))).toBeUndefined()
		cache.set(cache.key('source'), [vector])
		await cache.save()
	}
})

test('least recently used vectors are evicted and invalid vectors are rejected', async () => {
	const cache = new SemanticVectorCache(await directory())
	for (let i = 0; i < 2048; i++) {
		cache.set(cache.key(String(i)), [vector])
	}
	cache.get(cache.key('0'))
	cache.set(cache.key('new'), [vector])
	expect(cache.get(cache.key('1'))).toBeUndefined()
	expect(cache.get(cache.key('0'))).toEqual([vector])
	expect(() => cache.set(cache.key('bad'), [[Number.NaN]])).toThrow('Invalid semantic embedding')
})
