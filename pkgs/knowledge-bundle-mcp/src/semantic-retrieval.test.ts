import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { KnowledgeBundleMCPSemanticRanker } from './grant'
import { searchDocumentsLocally, type MarkdownDocument, type SearchResult } from './retrieval'

function doc(id: string, markdown: string): MarkdownDocument {
	return {
		id,
		path: `/${id}.md`,
		workspace_ref: 'authorized',
		revision: 'current',
		markdown,
		content_hash: createHash('sha256').update(markdown).digest('hex')
	}
}
const signal = new AbortController().signal
function budget(result: SearchResult, maximum: number) {
	expect(Buffer.byteLength(JSON.stringify(result))).toBe(result.serialized_bytes)
	expect(result.serialized_bytes).toBeLessThanOrEqual(maximum)
}
const ranker: KnowledgeBundleMCPSemanticRanker = async (_query, passages) => ({
	scores: passages.map((text) => (text.includes('lockbox') ? 0.9 : 0.3)),
	model: 'local-test',
	cacheHits: 0
})

test('a weak keyword overlap cannot overwhelm a stronger cross-language embedding', async () => {
	const result = await searchDocumentsLocally(
		[
			doc('entry', 'Collect the apartment keys from a lockbox.'),
			doc('train', '公寓步行五分钟可到火车站，乘车直达市中心。')
		],
		'Is public transport close to the apartment?',
		{},
		'hybrid',
		async () => ({
			scores: [0.38, 0.535],
			model: 'local-test',
			cacheHits: 0,
			minimumScore: 0.35,
			maximumScoreDrop: 0.2
		}),
		signal
	)
	expect(result.results[0]?.id).toBe('train')
})

test('semantic recall finds source text without a lexical match, with exact provenance', async () => {
	const source = doc('checkin', 'Collect the keys from the lockbox after 3 pm.\n')
	const result = await searchDocumentsLocally(
		[source, doc('fruit', 'Bananas are yellow.')],
		'如何办理入住',
		{},
		'hybrid',
		ranker,
		signal
	)
	expect(result.results).toHaveLength(1)
	expect(result.results[0]).toMatchObject({
		text: source.markdown,
		content_hash: source.content_hash,
		path: source.path,
		start_line: 1,
		match_basis: 'semantic'
	})
	expect(result.retrieval).toMatchObject({
		used_mode: 'hybrid',
		complete: true,
		indexed_passages: 2
	})
	budget(result, 12000)
})

test('keyword mode bypasses embeddings; hybrid retains literal IDs and semantic mode does not', async () => {
	const sources = [doc('id', 'Reservation ZX-8912.'), doc('checkin', 'Keys are in the lockbox.')]
	let called = false
	const host: KnowledgeBundleMCPSemanticRanker = async (...args) => {
		called = true
		return ranker(...args)
	}
	const words = await searchDocumentsLocally(sources, 'ZX-8912', {}, 'keyword', host, signal)
	expect(called).toBe(false)
	expect(words.results[0]?.id).toBe('id')
	const hybrid = await searchDocumentsLocally(sources, 'ZX-8912', {}, 'hybrid', host, signal)
	expect(hybrid.results.map(({ id }) => id)).toContain('id')
	const semantic = await searchDocumentsLocally(sources, 'ZX-8912', {}, 'semantic', host, signal)
	expect(semantic.results.map(({ id }) => id)).not.toContain('id')
})

test('inactive memories never enter the model; conflicts and source changes remain visible', async () => {
	const sources = [
		doc('old', '---\nstatus: archived\n---\nOld lockbox code 1234.'),
		doc('a', '---\nmemory_key: entry\n---\nThe lockbox code is 5678.'),
		doc('b', '---\nmemory_key: entry\n---\nThe lockbox code is 9012.')
	]
	const host: KnowledgeBundleMCPSemanticRanker = async (query, passages, signal) => {
		expect(passages.join('')).not.toContain('1234')
		return ranker(query, passages, signal)
	}
	const result = await searchDocumentsLocally(sources, '钥匙密码', {}, 'hybrid', host, signal)
	expect(result.excluded_documents).toBe(1)
	expect(result.results[0]?.conflict?.resolution).toBe('unresolved')
	const changed = doc('a', 'The lockbox code is 7777.')
	const updated = await searchDocumentsLocally([changed], '钥匙密码', {}, 'hybrid', host, signal)
	expect(updated.results[0]?.text).toBe(changed.markdown)
	expect(updated.results[0]?.content_hash).toBe(changed.content_hash)
	expect(updated.results[0]?.conflict).toBeUndefined()
	const deleted = await searchDocumentsLocally([], '钥匙密码', {}, 'hybrid', host, signal)
	expect(deleted.results).toEqual([])
})

test('invalid scores and model failures visibly fall back within even the smallest budget', async () => {
	const sources = [doc('a', 'local evidence '.repeat(300))]
	for (const host of [
		undefined,
		async () => {
			throw new Error('private /path must not leak')
		},
		async () => ({ scores: [Number.NaN], model: 'invalid', cacheHits: 0 })
	]) {
		const result = await searchDocumentsLocally(
			sources,
			'evidence',
			{ maxBytes: 1024 },
			'hybrid',
			host,
			signal
		)
		expect(result.retrieval).toMatchObject({ used_mode: 'keyword', complete: false })
		expect(JSON.stringify(result)).not.toContain('private /path')
		budget(result, 1024)
	}
})

test('semantic-only oversized text is not replaced with an arbitrary unrelated prefix', async () => {
	const result = await searchDocumentsLocally(
		[doc('a', 'x'.repeat(4000) + ' lockbox at the end')],
		'钥匙在哪里',
		{ maxBytes: 1024 },
		'semantic',
		ranker,
		signal
	)
	expect(result.results).toEqual([])
	expect(result.budget_notice).toBeDefined()
	budget(result, 1024)
})

test('semantic coverage is bounded and explicitly partial beyond 512 eligible passages', async () => {
	let count = 0
	const host: KnowledgeBundleMCPSemanticRanker = async (query, passages, signal) => {
		count = passages.length
		return ranker(query, passages, signal)
	}
	const sources = [
		doc('long', 'x'.repeat(16001)),
		...Array.from({ length: 515 }, (_, i) => doc(`d${i}`, `lockbox ${i}`))
	]
	const result = await searchDocumentsLocally(
		sources,
		'取钥匙',
		{ maxBytes: 2048 },
		'hybrid',
		host,
		signal
	)
	expect(count).toBe(512)
	expect(result.retrieval).toMatchObject({
		complete: false,
		indexed_passages: 512,
		total_passages: 516
	})
	budget(result, 2048)
})

test('cancellation propagates instead of reporting successful fallback', async () => {
	const controller = new AbortController()
	const host: KnowledgeBundleMCPSemanticRanker = async () => {
		controller.abort(new Error('cancelled'))
		throw new Error('failed')
	}
	await expect(
		searchDocumentsLocally([doc('a', 'lockbox')], '钥匙', {}, 'hybrid', host, controller.signal)
	).rejects.toThrow('cancelled')
})
