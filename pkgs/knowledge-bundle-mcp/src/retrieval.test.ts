import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
	searchDocuments,
	readExcerpt,
	type MarkdownDocument,
	type SearchResult,
	type ExcerptResult,
	type RetrievalErrorCode
} from './retrieval'

function expectFailure(run: () => unknown, expected: { code: RetrievalErrorCode }): void {
	let caught: unknown
	try {
		run()
	} catch (error) {
		caught = error
	}
	expect(caught).toMatchObject(expected)
}

const now = new Date('2026-09-13T12:00:00Z')
function doc(markdown: string, extra: Partial<MarkdownDocument> = {}): MarkdownDocument {
	return {
		workspace_ref: 'local',
		id: 'id-a',
		path: '/notes.md',
		revision: 'v1',
		modified_at: '2026-09-13T00:00:00Z',
		content_hash: createHash('sha256').update(markdown).digest('hex'),
		markdown,
		...extra
	}
}
function verifyBudget(result: SearchResult | ExcerptResult, limit: number): void {
	const actual = Buffer.byteLength(JSON.stringify(result), 'utf8')
	expect(result.serialized_bytes).toBe(actual)
	expect(actual <= limit).toBeTruthy()
	expect(result.source_content_is_untrusted).toBe(true)
}

test('Chinese word and bigram retrieval returns verbatim source with its identity', () => {
	const document = doc(
		'# 工作记忆\n\n提高记忆精确度时，应保留原文引用和来源版本。\n\n节省费用需要减少无关上下文。\n'
	)
	const result = searchDocuments([document], '记忆精确度', { now })
	expect(result.results.length).toBeTruthy()
	const first = result.results[0]!
	expect(first.path).toBe(document.path)
	expect(first.content_hash).toBe(document.content_hash)
	expect(first.revision).toBe(document.revision)
	expect(first.modified_at).toBe(document.modified_at)
	expect(first.text).toBe('提高记忆精确度时，应保留原文引用和来源版本。\n')
	expect(first.start_line).toBe(3)
	expect(first.end_line).toBe(3)
	expect(!first.text.includes('节省费用')).toBeTruthy()
	verifyBudget(result, 12000)
})

test('English retrieval ranks the paragraph that contains the phrase', () => {
	const documents = [
		doc('Bananas have yellow skin.\n', { id: 'bananas', path: '/fruit.md' }),
		doc(
			'# Engineering\n\nIncremental cache invalidation follows the document content hash.\n\nThe customer prefers green tea.\n',
			{ id: 'cache', path: '/engineering.md' }
		)
	]
	const result = searchDocuments(documents, 'cache invalidation', { now })
	expect(result.results[0]!.id).toBe('cache')
	expect(result.results[0]!.text).toBe(
		'Incremental cache invalidation follows the document content hash.\n'
	)
	expect(result.results[0]!.start_line).toBe(3)
	verifyBudget(result, 12000)
})

test('paragraph boundaries and headings never combine unrelated source text', () => {
	const document = doc(
		'# Shipping\n\nThe warehouse ships on Monday.\n\n# Pricing\n\nThe price changes on Tuesday.\n'
	)
	const result = searchDocuments([document], 'warehouse', { now })
	expect(result.results.length).toBe(1)
	expect(result.results[0]!.heading).toBe('Shipping')
	expect(result.results[0]!.text).toBe('The warehouse ships on Monday.\n')
	expect(!result.results[0]!.text.includes('Tuesday')).toBeTruthy()
})

test('no lexical hit returns no assertion, including a title-only context mismatch', () => {
	const result = searchDocuments([doc('Apples are red.\n')], 'quantum entanglement', { now })
	expect(result.results).toEqual([])
	expect(result.total_matches).toBe(0)
	expect(result.truncated).toBe(false)
	verifyBudget(result, 12000)
})

test('explicit inactive and time-invalid memories are excluded unless requested', () => {
	const make = (id: string, fields: string) =>
		doc(`---\n${fields}\n---\n\nProject launch is Monday.\n`, { id, path: `/${id}.md` })
	const documents = [
		make('active', 'status: active\nexpires_at: 2026-12-31'),
		make('expired', 'expires_at: 2026-01-01'),
		make('archived', 'status: archived'),
		make('superseded', 'status: superseded'),
		make('future', 'valid_from: 2027-01-01'),
		make('draft', 'status: draft'),
		make('review', 'status: needs_review')
	]
	const result = searchDocuments(documents, 'launch', { now })
	expect(result.results.map((item) => item.id)).toEqual(['active'])
	expect(result.excluded_documents).toBe(6)
	const included = searchDocuments(documents, 'launch', {
		now,
		includeInactive: true,
		maxResults: 20
	})
	expect(included.results.length).toBe(7)
	expect(included.results.find((item) => item.id === 'expired')!.inactive_reasons).toEqual([
		'expired'
	])
})

test('frontmatter is a narrow scalar parser and invalid dates are disclosed', () => {
	const document = doc(
		'---\nstatus: active\nexpires_at: 2026-02-30\nsource: "meeting notes"\nmemory_key: \'launch\'\nunrelated: !execute something\n---\n\nThe launch is Monday.\n'
	)
	const result = searchDocuments([document], 'launch', { now })
	expect(result.results[0]!.memory_metadata!.source).toBe('meeting notes')
	expect(result.results[0]!.memory_metadata!.memory_key).toBe('launch')
	expect(result.results[0]!.metadata_warnings).toEqual(['invalid_expires_at'])
	expect(result.results[0]!.start_line).toBe(9)
	expect(!result.results[0]!.text.includes('!execute')).toBeTruthy()
})

test('duplicate scalar values are never silently chosen', () => {
	const document = doc('---\nstatus: expired\nstatus: active\n---\nProject launch is Monday.\n')
	const result = searchDocuments([document], 'launch', { now })
	expect(result.results[0]!.metadata_warnings).toEqual(['duplicate_status'])
	expect(result.results[0]!.memory_metadata).toBe(undefined)
})

test('quoted known keys share duplicate detection with plain keys in either order', () => {
	const keys = ['status', 'expires_at', 'valid_from', 'supersedes', 'source', 'memory_key'] as const
	for (const key of keys) {
		const forms = [key, `'${key}'`, `"${key}"`]
		for (const first of forms) {
			for (const second of forms) {
				if (first === second) continue
				for (const values of [
					['active', 'expired'],
					['expired', 'active']
				]) {
					const document = doc(
						`---\n${first}: ${values[0]}\n${second}: ${values[1]}\n---\nLaunch is Monday.\n`
					)
					const result = searchDocuments([document], 'Launch', { now })
					expect(result.excluded_documents).toBe(0)
					expect(result.results).toHaveLength(1)
					expect(result.results[0]!.metadata_warnings).toEqual([`duplicate_${key}`])
					expect(result.results[0]!.memory_metadata?.[key]).toBeUndefined()
				}
			}
		}
	}
	const escapedKey = doc('---\nstatus: active\n"sta\\u0074us": expired\n---\nLaunch is Monday.\n')
	const escaped = searchDocuments([escapedKey], 'Launch', { now })
	expect(escaped.results[0]!.metadata_warnings).toEqual(['duplicate_status'])
	expect(escaped.results[0]!.memory_metadata).toBeUndefined()
})

test('quoted lifecycle keys are recognized when unambiguous', () => {
	for (const key of ["'status'", '"status"']) {
		const document = doc(`---\n${key}: expired\n---\nLaunch is Monday.\n`)
		expect(searchDocuments([document], 'Launch', { now }).excluded_documents).toBe(1)
	}
})

test('comment-bearing scalars and multiline values are disclosed without asserting values', () => {
	for (const value of ['active # note', '"active" # note', "'active' # note", '# note']) {
		const document = doc(`---\nstatus: ${value}\n---\nLaunch is Monday.\n`)
		const result = searchDocuments([document], 'Launch', { now })
		expect(result.results[0]!.metadata_warnings).toEqual(['unsupported_status'])
		expect(result.results[0]!.memory_metadata?.status).toBeUndefined()
	}
	const multiline = doc('---\nstatus: active\n  continued scalar\n---\nLaunch is Monday.\n')
	const result = searchDocuments([multiline], 'Launch', { now })
	expect(result.results[0]!.metadata_warnings).toEqual(['unsupported_status'])
	expect(result.results[0]!.memory_metadata?.status).toBeUndefined()
	const quotedHash = doc(
		'---\nsource: "meeting #1"\n# ordinary comment\nstatus: active\n---\nLaunch is Monday.\n'
	)
	expect(searchDocuments([quotedHash], 'Launch', { now }).results[0]!.memory_metadata?.source).toBe(
		'meeting #1'
	)
})

test('unclosed or complex frontmatter never asserts a lifecycle value', () => {
	const unclosed = doc('---\nstatus: expired\n\nLaunch is Monday.\n')
	const openResult = searchDocuments([unclosed], 'Launch', { now })
	expect(openResult.excluded_documents).toBe(0)
	expect(openResult.results[0]!.metadata_warnings).toEqual(['unclosed_frontmatter'])
	expect(openResult.results[0]!.memory_metadata).toBeUndefined()
	for (const complexKey of ['? status\n: active', '"\\x73tatus": active', '<<: *defaults']) {
		const document = doc(`---\nstatus: expired\n${complexKey}\n---\nLaunch is Monday.\n`)
		const result = searchDocuments([document], 'Launch', { now })
		expect(result.excluded_documents).toBe(0)
		expect(result.results[0]!.metadata_warnings).toEqual(['unsupported_frontmatter_syntax'])
		expect(result.results[0]!.memory_metadata).toBeUndefined()
	}
})

test('same active memory key flags competing paths without choosing latest truth', () => {
	const documents = [
		doc('---\nmemory_key: launch-date\nstatus: active\n---\nLaunch date is Monday.\n', {
			id: 'old',
			path: '/old.md',
			modified_at: '2026-01-01T00:00:00Z'
		}),
		doc('---\nmemory_key: launch-date\nstatus: active\n---\nLaunch date is Friday.\n', {
			id: 'new',
			path: '/new.md',
			modified_at: '2026-09-01T00:00:00Z'
		})
	]
	const result = searchDocuments(documents, 'Launch date', { now })
	expect(result.results.length).toBe(2)
	for (const item of result.results) {
		expect(item.conflict!.paths).toEqual(['/new.md', '/old.md'])
		expect(item.conflict!.resolution).toBe('unresolved')
	}
})

test('memory conflicts never cross authorized workspace boundaries', () => {
	const documents = [
		doc('---\nmemory_key: preference\n---\nPreferred beverage is tea.\n', { workspace_ref: 'one' }),
		doc('---\nmemory_key: preference\n---\nPreferred beverage is coffee.\n', {
			workspace_ref: 'two'
		})
	]
	const result = searchDocuments(documents, 'Preferred beverage', { now })
	expect(result.results.every((item) => !item.conflict)).toBeTruthy()
})

test('search respects serialized UTF-8 byte budget and top-k', () => {
	const documents = Array.from({ length: 20 }, (_, index) =>
		doc(`独立记录${index}：检索应保留精确来源。${'🙂中文内容'.repeat(5)}\n`, {
			id: `id-${index}`,
			path: `/记忆${index}.md`
		})
	)
	for (const maxBytes of [1024, 2048, 12000, 64000]) {
		const result = searchDocuments(documents, '精确来源', { now, maxBytes, maxResults: 3 })
		expect(result.results.length <= 3).toBeTruthy()
		expect(result.truncated).toBe(true)
		verifyBudget(result, maxBytes)
	}
})

test('a long single-line paragraph returns a budgeted exact window around the query', () => {
	const document = doc(`${'早期记录'.repeat(1000)}唯一目标词${'其他记录'.repeat(1000)}\n`)
	const result = searchDocuments([document], '唯一目标词', { now, maxBytes: 1024 })
	expect(result.results.length).toBe(1)
	const first = result.results[0]!
	expect(first.partial_text).toBe(true)
	expect(first.partial_line).toBe(true)
	expect(first.text.includes('唯一目标词')).toBeTruthy()
	expect(first.text).toBe(document.markdown.slice(first.start_offset_utf16, first.end_offset_utf16))
	expect(first.start_line).toBe(1)
	expect(first.end_line).toBe(1)
	verifyBudget(result, 1024)
})

test('bounded matches map NFKC text back to fullwidth, ligature and combining source graphemes', () => {
	for (const [original, query] of [
		['ＡＬＰＨＡ', 'alpha'],
		['ﬁnance', 'finance'],
		['Cafe\u0301', 'café']
	]) {
		const markdown = `${'🙂 unrelated words '.repeat(1000)}${original}${' following words '.repeat(1000)}\n`
		const document = doc(markdown)
		const result = searchDocuments([document], query!, { now, maxBytes: 2048 })
		expect(result.total_matches).toBe(1)
		expect(result.results).toHaveLength(1)
		const first = result.results[0]!
		expect(first.partial_text).toBe(true)
		expect(first.text).toContain(original!)
		expect(first.text).toBe(markdown.slice(first.start_offset_utf16, first.end_offset_utf16))
		expect(first.start_line).toBe(1)
		expect(first.end_line).toBe(1)
		verifyBudget(result, 2048)
	}
})

test('changed documents produce current text, hash and revision on each call', () => {
	const old = doc('Launch date is Monday.\n')
	const current = doc('Launch date is Friday.\n', { revision: 'v2' })
	const a = searchDocuments([old], 'Launch date', { now }).results[0]!
	const b = searchDocuments([current], 'Launch date', { now }).results[0]!
	expect(a.content_hash).not.toBe(b.content_hash)
	expect(b.revision).toBe('v2')
	expect(b.text).toBe(current.markdown)
	expectFailure(() => readExcerpt(current, { expectedHash: old.content_hash }), {
		code: 'STALE_DOCUMENT'
	})
})

test('excerpt preserves original CRLF bytes and contiguous line numbers', () => {
	const document = doc('# Title\r\n\r\nExact original text.\r\nNext line.\r\n')
	const result = readExcerpt(document, {
		startLine: 3,
		endLine: 4,
		expectedHash: document.content_hash
	})
	expect(result.text).toBe('Exact original text.\r\nNext line.\r\n')
	expect(result.start_line).toBe(3)
	expect(result.end_line).toBe(4)
	expect(result.total_lines).toBe(4)
	expect(result.truncated).toBe(false)
	verifyBudget(result, 12000)
})

test('excerpt stops at complete lines and states where to continue', () => {
	const document = doc(
		Array.from({ length: 20 }, (_, index) => `${index}: ${'记忆'.repeat(25)}\n`).join('')
	)
	const result = readExcerpt(document, { startLine: 1, endLine: 20, maxBytes: 1024 })
	expect(result.truncated).toBe(true)
	expect(!result.partial_line).toBeTruthy()
	expect(result.next_start_line).toBe(result.end_line + 1)
	expect(result.text).toBe(
		document.markdown
			.split(/(?<=\n)/)
			.slice(0, result.end_line)
			.join('')
	)
	verifyBudget(result, 1024)
})

test('oversized single line is an exact Unicode prefix with an explicit partial marker', () => {
	const document = doc('🙂记忆精确'.repeat(1000))
	const result = readExcerpt(document, { maxBytes: 1024 })
	expect(result.truncated).toBe(true)
	expect(result.partial_line).toBe(true)
	expect(result.start_line).toBe(1)
	expect(result.end_line).toBe(1)
	expect(result.text.length > 0).toBeTruthy()
	expect(document.markdown.startsWith(result.text)).toBeTruthy()
	expect(!/[\uD800-\uDBFF]$/.test(result.text)).toBeTruthy()
	verifyBudget(result, 1024)
})

test('invalid options and stale hashes fail clearly', () => {
	expectFailure(() => searchDocuments([doc('hello')], 'hello', { maxBytes: 100 }), {
		code: 'INVALID_ARGUMENT'
	})
	expectFailure(() => searchDocuments([doc('hello')], '', {}), { code: 'INVALID_ARGUMENT' })
	expectFailure(() => readExcerpt(doc('hello'), { expectedHash: 'wrong' }), {
		code: 'STALE_DOCUMENT'
	})
	expectFailure(() => readExcerpt(doc('hello'), { startLine: 2, endLine: 2 }), {
		code: 'LINE_OUT_OF_RANGE'
	})
})

test('default and native representations preserve effective document access', () => {
	const fallback = readExcerpt(doc('Original source text.\n'))
	expect(fallback.representation).toBe('source_markdown')
	expect(fallback.document_access).toBe('readonly')
	const writable = doc('Original source text.\n', {
		representation: 'source_markdown',
		document_access: 'writable'
	})
	expect(readExcerpt(writable).document_access).toBe('writable')
	const search = searchDocuments([writable], 'source text')
	expect(search.results[0]!.representation).toBe('source_markdown')
	expect(search.results[0]!.document_access).toBe('writable')
})

test('converted excerpts preserve representation text and use source-file hash preconditions', () => {
	const markdown =
		'# Converted table\r\n\r\n| Date | Value |\r\n| --- | --- |\r\n| Monday | 42 |\r\n'
	const sourceHash = createHash('sha256').update('binary source file bytes').digest('hex')
	const document = doc(markdown, {
		path: '/table.pdf',
		content_hash: sourceHash,
		representation: 'converted_markdown',
		document_access: 'readonly'
	})
	const result = readExcerpt(document, { startLine: 3, endLine: 5, expectedHash: sourceHash })
	expect(result.representation).toBe('converted_markdown')
	expect(result.document_access).toBe('readonly')
	expect(result.content_hash).toBe(sourceHash)
	expect(result.text).toBe('| Date | Value |\r\n| --- | --- |\r\n| Monday | 42 |\r\n')
	expect(result.start_line).toBe(3)
	expect(result.end_line).toBe(5)
	verifyBudget(result, 12000)
	expectFailure(
		() =>
			readExcerpt(document, { expectedHash: createHash('sha256').update(markdown).digest('hex') }),
		{ code: 'STALE_DOCUMENT' }
	)
	const search = searchDocuments([document], 'Monday')
	expect(search.results[0]!.content_hash).toBe(sourceHash)
	expect(search.results[0]!.representation).toBe('converted_markdown')
	expect(search.results[0]!.document_access).toBe('readonly')
})

test('converted documents never inherit a writable claim', () => {
	const invalid = doc('Converted source.\n', {
		representation: 'converted_markdown',
		document_access: 'writable'
	})
	expectFailure(() => readExcerpt(invalid), { code: 'INVALID_ARGUMENT' })
	expectFailure(() => searchDocuments([invalid], 'source'), { code: 'INVALID_ARGUMENT' })
	const defaultAccess = doc('Converted source.\n', { representation: 'converted_markdown' })
	expect(readExcerpt(defaultAccess).document_access).toBe('readonly')
})
