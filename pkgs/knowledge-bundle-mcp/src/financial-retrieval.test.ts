import { expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { KnowledgeBundleMCPSemanticRanker } from './grant'
import {
	searchDocuments,
	searchDocumentsLocally,
	type MarkdownDocument,
	type SearchOptions
} from './retrieval'

type FinancialFields = NonNullable<SearchOptions['filters']>

const signal = new AbortController().signal
const target: FinancialFields = {
	entity: 'ACME',
	period: 'FY24',
	metric: 'revenue',
	basis: 'GAAP',
	definition_version: 'v2'
}

function financialDocument(
	id: string,
	fields: readonly string[],
	text = `${id}: Revenue was 125 million.`
): MarkdownDocument {
	const markdown = `---\n${fields.join('\n')}\n---\n\n${text}\n`
	return {
		workspace_ref: 'authorized',
		id,
		path: `/financial/${id}.md`,
		revision: 'current',
		content_hash: createHash('sha256').update(markdown).digest('hex'),
		markdown
	}
}

function fields(overrides: Partial<FinancialFields> = {}, status = 'active'): string[] {
	const value = { ...target, ...overrides }
	return [
		`status: ${status}`,
		`entity: ${value.entity}`,
		`period: ${value.period}`,
		`metric: ${value.metric}`,
		`basis: ${value.basis}`,
		`definition_version: ${value.definition_version}`
	]
}

const fixture = [
	financialDocument('target', fields(), 'TARGET: ACME FY24 GAAP revenue was 125 million.'),
	financialDocument('other-entity', fields({ entity: 'BETA' })),
	financialDocument('other-period', fields({ period: 'FY23' })),
	financialDocument('other-basis', fields({ basis: 'adjusted' })),
	financialDocument('other-version', fields({ definition_version: 'v1' })),
	financialDocument('other-metric', fields({ metric: 'EBITDA' })),
	financialDocument('superseded', fields({}, 'superseded')),
	financialDocument(
		'missing-basis',
		fields().filter((line) => !line.startsWith('basis:'))
	),
	financialDocument('ambiguous-period', [...fields(), 'period: FY23'])
]

test('financial filters remove near-match interference before local semantic ranking', async () => {
	let rankedPassages: readonly string[] = []
	const ranker = mock<KnowledgeBundleMCPSemanticRanker>(async (_query, passages) => {
		rankedPassages = passages
		return {
			scores: passages.map(() => 0.99),
			model: 'deterministic-filter-gate',
			cacheHits: 0
		}
	})
	const result = await searchDocumentsLocally(
		fixture,
		'What was reported revenue?',
		{ filters: target, maxResults: 5 },
		'semantic',
		ranker,
		signal
	)

	expect(ranker).toHaveBeenCalledTimes(1)
	expect(rankedPassages).toEqual(['TARGET: ACME FY24 GAAP revenue was 125 million.\n'])
	expect(result.results.map(({ id }) => id)).toEqual(['target'])
	expect(result.excluded_documents).toBe(fixture.length - 1)

	const top5 = result.results.slice(0, 5).map(({ id }) => id)
	const relevant = new Set(['target'])
	const hits = top5.filter((id) => relevant.has(id)).length
	const summary = {
		recallAt5: hits / relevant.size,
		falseRetrievalRateAt5: top5.filter((id) => !relevant.has(id)).length / Math.max(1, top5.length)
	}
	// This measures the deterministic metadata gate, not real embedding-model quality.
	expect(summary).toEqual({ recallAt5: 1, falseRetrievalRateAt5: 0 })
})

test('an unanswerable financial slice abstains without invoking the ranker', async () => {
	const ranker = mock<KnowledgeBundleMCPSemanticRanker>(async (_query, passages) => ({
		scores: passages.map(() => 0.99),
		model: 'must-not-run',
		cacheHits: 0
	}))
	const result = await searchDocumentsLocally(
		fixture,
		'What was reported revenue?',
		{ filters: { ...target, period: 'FY25' }, maxResults: 5 },
		'semantic',
		ranker,
		signal
	)

	const summary = {
		unanswerableAbstention: Number(result.results.length === 0 && ranker.mock.calls.length === 0)
	}
	expect(summary).toEqual({ unanswerableAbstention: 1 })
	expect(result.excluded_documents).toBe(fixture.length)
})

test('table rows preserve header meaning and filter different periods before embedding', async () => {
	const markdown = [
		'| entity | period | metric | basis | definition_version | value | unit | as_of | status |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		'| ACME | FY23 | revenue | GAAP | v2 | 98 | USD million | 2024-03-01 | active |',
		'| ACME | FY24 | revenue | GAAP | v2 | 120 | USD million | 2025-03-01 | superseded |',
		'| ACME | FY24 | revenue | GAAP | v2 | 125 | USD million | 2025-05-01 | active |'
	].join('\n')
	const document = {
		...financialDocument('table', []),
		markdown,
		content_hash: createHash('sha256').update(markdown).digest('hex')
	}
	const ranker: KnowledgeBundleMCPSemanticRanker = async (_query, passages) => {
		expect(passages).toHaveLength(1)
		expect(JSON.parse(passages[0]!)).toMatchObject({
			period: 'FY24',
			value: '125',
			metric: 'revenue'
		})
		return { scores: [0.99], model: 'table-gate', cacheHits: 0 }
	}
	const result = await searchDocumentsLocally(
		[document],
		'sales',
		{ filters: target },
		'semantic',
		ranker,
		signal
	)
	expect(result.results).toHaveLength(1)
	expect(result.results[0]).toMatchObject({
		start_line: 5,
		end_line: 5,
		text: markdown.split('\n')[4],
		content_hash: document.content_hash,
		structured_record: {
			kind: 'table_row',
			header_line: 1,
			fields: { period: 'FY24', value: '125' }
		}
	})
	expect(JSON.stringify(result)).not.toContain('FY23')
	expect(result.serialized_bytes).toBe(Buffer.byteLength(JSON.stringify(result)))
	let exactRankerCalled = false
	const exact = await searchDocumentsLocally(
		[document],
		'这条记录',
		{ filters: target, canonicalOnly: true },
		'hybrid',
		async () => {
			exactRankerCalled = true
			throw new Error('Exact lookup must bypass similarity')
		},
		signal
	)
	expect(exactRankerCalled).toBe(false)
	expect(exact.retrieval?.used_mode).toBe('metadata')
	expect(exact.results[0]?.memory_metadata?.value).toBe('125')
	expect(exact.results[0]?.match_basis).toBe('metadata')
})

test('canonical values abstain on competing active numbers, deduplicate identical values and keep units distinct', () => {
	const record = (id: string, value: string, unit = 'USD million', extra: string[] = []) =>
		financialDocument(
			id,
			[...fields(), `value: ${value}`, `unit: ${unit}`, 'as_of: 2025-05-01', ...extra],
			`Revenue was ${value}.`
		)
	const options = { filters: target, canonicalOnly: true }
	const conflict = searchDocuments(
		[record('first', '120'), record('later', '125')],
		'Revenue',
		options
	)
	expect(conflict.results).toEqual([])
	expect(conflict.canonical?.conflicting_records).toBe(2)
	const same = searchDocuments([record('a', '125'), record('b', '125')], 'Revenue', options)
	expect(same.results).toHaveLength(1)
	expect(same.canonical?.duplicate_records_suppressed).toBe(1)
	const differentUnits = searchDocuments(
		[record('a', '125', 'M'), record('b', '125', 'm')],
		'Revenue',
		options
	)
	expect(differentUnits.results).toHaveLength(2)
	const unknown = searchDocuments([financialDocument('missing', fields())], 'Revenue', options)
	expect(unknown.results).toEqual([])
	expect(unknown.canonical?.incomplete_records).toBe(1)
	expect(() =>
		searchDocuments([record('a', '125')], 'Revenue', { ...options, includeInactive: true })
	).toThrow()
})

test('structured records are omitted atomically when a narrow budget cannot fit the row', () => {
	const markdown = `| metric | notes |\n| --- | --- |\n| revenue | ${'Detail '.repeat(400)} |\n`
	const document = { ...financialDocument('wide-row', []), markdown }
	const result = searchDocuments([document], 'revenue', { maxBytes: 1024 })
	expect(result.results).toEqual([])
	expect(result.truncated).toBe(true)
	expect(result.serialized_bytes).toBeLessThanOrEqual(1024)
})

test('SQL definitions remain a single fenced chunk instead of losing schema context', () => {
	const markdown = [
		'```sql',
		'CREATE TABLE revenue (',
		...Array.from({ length: 40 }, (_, i) => `  column_${i} DECIMAL,`),
		');',
		'```'
	].join('\n')
	const document = { ...financialDocument('schema', []), markdown }
	const result = searchDocuments([document], 'revenue', { maxBytes: 12000 })
	expect(result.results[0]?.text).toBe(markdown)
	expect(result.results[0]?.start_line).toBe(1)
	expect(result.results[0]?.end_line).toBe(44)
})
