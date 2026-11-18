import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { InferenceProcess } from '../electron/semantic/inference-process'
import type { KnowledgeBundleMCPSemanticRanker } from '@open-knowledge/knowledge-bundle-mcp'
import {
	searchDocumentsLocally,
	type MarkdownDocument
} from '../../../pkgs/knowledge-bundle-mcp/src/retrieval'

// Build this script into .cache, then run with Node. Test the actual built worker and native runtime.
const root = fileURLToPath(new URL('../', import.meta.url))
const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'ok-semantic-smoke-'))
let worker: InferenceProcess | undefined
const previousNodeOptions = process.env.NODE_OPTIONS
process.env.NODE_OPTIONS = `${previousNodeOptions ?? ''} --import=${JSON.stringify(new URL('./semantic-network-guard.mjs', import.meta.url).href)}`
function startWorker() {
	return new InferenceProcess(
		new URL('../dist-electron/semantic-worker.mjs', import.meta.url),
		path.join(root, 'dist-electron', 'semantic-assets'),
		cacheDirectory
	)
}
const rank: KnowledgeBundleMCPSemanticRanker = async (query, passages) => {
	worker ??= startWorker()
	const active = worker
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout)
			active.off('error', failed)
			active.off('exit', failed)
			active.off('message', received)
		}
		const failed = () => {
			cleanup()
			reject(new Error('Semantic smoke process failed or timed out'))
		}
		const timeout = setTimeout(failed, 45_000)
		const received = (message: {
			ok: boolean
			result: Awaited<ReturnType<KnowledgeBundleMCPSemanticRanker>>
		}) => {
			cleanup()
			if (!message.ok) {
				reject(new Error('Local semantic worker failed'))
			} else {
				resolve(message.result)
			}
		}
		active.once('error', failed)
		active.once('exit', failed)
		active.once('message', received)
		active.postMessage({ query, passages })
	})
}
function source(id: string, markdown: string): MarkdownDocument {
	return {
		id,
		path: `/${id}.md`,
		workspace_ref: 'smoke',
		revision: 'current',
		markdown,
		content_hash: createHash('sha256').update(markdown).digest('hex')
	}
}
const sources = [
	source('entry', 'The guest can collect the apartment keys from a lockbox after 3 pm.'),
	source('refund', 'Cancellations made at least seven days before arrival receive a full refund.'),
	source('fruit', 'Bananas are a yellow tropical fruit.'),
	source('price', 'Melbourne listings have a median nightly price of 181 Australian dollars.'),
	source('train', '公寓步行五分钟可到火车站，乘车直达市中心。'),
	source('pets', '本房源允许携带宠物，但需要提前告知房东。'),
	source('parking', '大楼地下车库提供一个免费的停车位。'),
	source('deposit', 'A security deposit of $200 is refunded after checkout if there is no damage.'),
	source('work', 'Restart your laptop before installing operating system updates.')
]
const queries = [
	['客人几点可以办理入住？', 'entry'],
	['提前取消能退钱吗？', 'refund'],
	['墨尔本住宿一晚上多少钱？', 'price'],
	['Is public transport close to the apartment?', 'train'],
	['Can I bring my dog?', 'pets'],
	['Where can I leave my car without paying?', 'parking'],
	['什么水果是黄色的？', 'fruit'],
	['退房之后能拿回押金吗？', 'deposit'],
	['升级系统前应该做什么？', 'work']
] as const
try {
	const signal = new AbortController().signal
	const records = []
	for (const [query, expected] of queries) {
		const before = performance.now()
		const result = await searchDocumentsLocally(
			sources,
			query,
			{ maxResults: 2, maxBytes: 2048 },
			'hybrid',
			rank,
			signal
		)
		assert.equal(result.retrieval?.used_mode, 'hybrid')
		assert.equal(result.results[0]?.id, expected)
		assert.equal(result.serialized_bytes, Buffer.byteLength(JSON.stringify(result)))
		assert.ok(result.serialized_bytes <= 2048)
		records.push({
			query,
			first: expected,
			milliseconds: Math.round(performance.now() - before),
			cache_hits: result.retrieval.cache_hits
		})
	}
	await worker?.terminate()
	worker = undefined
	const warm = await rank(
		queries[0][0],
		sources.map(({ markdown }) => markdown),
		signal
	)
	assert.equal(warm.cacheHits, sources.length, 'disk cache survives worker restart')
	const repeat = await rank(
		queries[0][0],
		sources.map(({ markdown }) => markdown),
		signal
	)
	assert.equal(repeat.queryCacheHit, true, 'repeated queries reuse in-memory vectors')
	const changed = sources.map((item) =>
		item.id === 'entry'
			? source('entry', 'The guest can collect the apartment keys from a lockbox after 5 pm.')
			: item
	)
	const updated = await searchDocumentsLocally(changed, queries[0][0], {}, 'hybrid', rank, signal)
	assert.equal(updated.retrieval?.embedded_passages, 1, 'only changed passage is embedded')
	assert.equal(updated.results[0]?.content_hash, changed[0]!.content_hash)
	assert.match(updated.results[0]!.text, /5 pm/)
	const removed = await searchDocumentsLocally(
		changed.slice(1),
		queries[0][0],
		{},
		'hybrid',
		rank,
		signal
	)
	assert.ok(
		removed.results.every(({ id }) => id !== 'entry'),
		'removed source cannot return from cache'
	)
	const financial = [
		['correct', 'ACME', 'FY24', 'GAAP', 'v2', 'active', '125'],
		['wrong-period', 'ACME', 'FY23', 'GAAP', 'v2', 'active', '98'],
		['wrong-basis', 'ACME', 'FY24', 'adjusted', 'v2', 'active', '130'],
		['wrong-entity', 'BETA', 'FY24', 'GAAP', 'v2', 'active', '140'],
		['wrong-version', 'ACME', 'FY24', 'GAAP', 'v1', 'active', '122'],
		['restated-old', 'ACME', 'FY24', 'GAAP', 'v2', 'superseded', '120']
	].map(([id, entity, period, basis, version, status, value]) =>
		source(
			id!,
			`---\nentity: ${entity}\nperiod: ${period}\nmetric: revenue\nbasis: ${basis}\ndefinition_version: ${version}\nstatus: ${status}\nvalue: ${value}\nunit: USD million\nas_of: 2025-05-01\n---\n${entity} ${period} ${basis} revenue was ${value} million US dollars.`
		)
	)
	const financialQueries = [
		'What revenue was reported?',
		'公司披露的营业收入是多少？',
		'Find the sales figure.'
	]
	const financialFilters = {
		entity: 'ACME',
		period: 'FY24',
		metric: 'revenue',
		basis: 'GAAP',
		definition_version: 'v2'
	}
	let financialHits = 0,
		exactFinancialHits = 0,
		financialFalseHits = 0,
		financialReturned = 0
	for (const query of financialQueries) {
		const result = await searchDocumentsLocally(
			financial,
			query,
			{ filters: financialFilters, maxResults: 5 },
			'hybrid',
			rank,
			signal
		)
		assert.equal(result.retrieval?.used_mode, 'hybrid')
		financialHits += Number(result.results.some(({ id }) => id === 'correct'))
		financialFalseHits += result.results.filter(({ id }) => id !== 'correct').length
		financialReturned += result.results.length
		const exact = await searchDocumentsLocally(
			financial,
			query,
			{ filters: financialFilters, canonicalOnly: true, maxResults: 5 },
			'hybrid',
			rank,
			signal
		)
		assert.equal(exact.retrieval?.used_mode, 'metadata')
		assert.deepEqual(
			exact.results.map(({ id }) => id),
			['correct']
		)
		exactFinancialHits += Number(exact.results.some(({ id }) => id === 'correct'))
	}
	assert.equal(exactFinancialHits, financialQueries.length)
	assert.equal(financialFalseHits, 0)
	const absent = await searchDocumentsLocally(
		financial,
		financialQueries[0]!,
		{ filters: { ...financialFilters, period: 'FY25' } },
		'hybrid',
		rank,
		signal
	)
	assert.equal(absent.results.length, 0)
	console.log(
		JSON.stringify(
			{
				offline: true,
				queries: records,
				restart_cache_hits: warm.cacheHits,
				changed_passages_embedded: updated.retrieval?.embedded_passages,
				deletion_checked: true,
				financial_guardrail_smoke: {
					cases: financialQueries.length,
					semantic_recall_at_5: financialHits / financialQueries.length,
					exact_metadata_recall_at_5: exactFinancialHits / financialQueries.length,
					false_retrieval_rate_at_5: financialFalseHits / Math.max(1, financialReturned),
					unanswerable_abstained: true,
					scope:
						'Small synthetic integration set with the actual embedding model; not a held-out corporate benchmark.'
				}
			},
			null,
			2
		)
	)
} finally {
	await worker?.terminate()
	if (previousNodeOptions === undefined) {
		delete process.env.NODE_OPTIONS
	} else {
		process.env.NODE_OPTIONS = previousNodeOptions
	}
	await rm(cacheDirectory, { recursive: true, force: true })
}
