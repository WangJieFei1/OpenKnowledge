import type {
	KnowledgeBundleMCPDocumentRepresentation,
	KnowledgeBundleMCPSemanticRanker
} from './grant'
import { markdownTableRows } from './schema-chunks'

export type FinancialFilters = Partial<
	Record<'entity' | 'period' | 'metric' | 'basis' | 'definition_version', string>
>

/** A host-authorized Markdown representation with source-file provenance. */
export type MarkdownDocument = {
	readonly workspace_ref: string
	readonly id: string
	readonly path: string
	readonly revision: string
	/** The source-file hash, including for converted documents; never a hash of a snippet. */
	readonly content_hash: string
	readonly modified_at?: string
	readonly markdown: string
	readonly representation?: KnowledgeBundleMCPDocumentRepresentation
	readonly document_access?: 'writable' | 'readonly'
}

export type SearchOptions = {
	readonly maxResults?: number
	readonly maxBytes?: number
	readonly now?: Date | string | number
	readonly includeInactive?: boolean
	/** Dialogue is plain evidence, not a memory document with lifecycle frontmatter. */
	readonly parseMemoryMetadata?: boolean
	/** Explicit constraints; absent or ambiguous fields do not match. Applied before embeddings. */
	readonly filters?: FinancialFilters
	/** Return only complete, unambiguous metric values; never select a conflicting latest value. */
	readonly canonicalOnly?: boolean
}

export type ExcerptOptions = {
	readonly startLine?: number
	readonly endLine?: number
	readonly maxBytes?: number
	/** Compare against the source-file hash, not the converted representation or excerpt. */
	readonly expectedHash?: string
}

export type MemoryField =
	| 'status'
	| 'expires_at'
	| 'valid_from'
	| 'supersedes'
	| 'source'
	| 'memory_key'
	| 'entity'
	| 'period'
	| 'metric'
	| 'basis'
	| 'definition_version'
	| 'value'
	| 'unit'
	| 'as_of'
export type MemoryMetadata = Partial<Record<MemoryField, string>>
export type MemoryConflict = {
	memory_key: string
	paths: string[]
	total_paths?: number
	paths_truncated?: boolean
	resolution: 'unresolved'
}

export type RetrievalMatch = {
	workspace_ref: string
	path: string
	id: string
	/** 1-based lines in the returned Markdown representation, not pages or source-binary lines. */
	start_line: number
	end_line: number
	revision: string
	/** Unchanged hash of the source file. */
	content_hash: string
	modified_at?: string
	representation: KnowledgeBundleMCPDocumentRepresentation
	document_access: 'writable' | 'readonly'
	/** Exact, contiguous text from the supplied Markdown representation. */
	text: string
	/** Derived, string-valued table projection. text remains the exact original data row. */
	structured_record?: { kind: 'table_row'; header_line: number; fields: Record<string, string> }
	match_basis?: 'keyword' | 'semantic' | 'both' | 'metadata'
	/** Similarity is a ranking signal, not a probability that the source is correct. */
	semantic_similarity?: number
	heading?: string
	memory_metadata?: MemoryMetadata
	metadata_warnings?: string[]
	inactive_reasons?: string[]
	conflict?: MemoryConflict
	partial_text?: boolean
	partial_line?: boolean
	/** Optional half-open UTF-16 offsets into the full supplied Markdown representation. */
	start_offset_utf16?: number
	end_offset_utf16?: number
}

type BudgetedOutput = {
	source_content_is_untrusted: true
	/** UTF-8 bytes of the returned JSON object; not a model token count. */
	budget_bytes: number
	serialized_bytes: number
}

export type SearchResult = BudgetedOutput & {
	results: RetrievalMatch[]
	total_matches: number
	truncated: boolean
	excluded_documents: number
	budget_notice?: string
	quality_notice?: string
	canonical?: {
		scope: 'scanned_candidates'
		conflicting_records: number
		incomplete_records: number
		duplicate_records_suppressed: number
	}
	retrieval?: {
		requested_mode: RetrievalMode
		used_mode: RetrievalMode | 'metadata'
		model?: string
		indexed_passages?: number
		total_passages?: number
		cache_hits?: number
		embedded_passages?: number
		complete: boolean
		notice?: string
	}
}

export type ExcerptResult = RetrievalMatch &
	BudgetedOutput & {
		total_lines: number
		truncated: boolean
		next_start_line?: number
		full_document_tool?: 'knowledge_get_document'
	}

export type RetrievalErrorCode =
	'INVALID_ARGUMENT' | 'STALE_DOCUMENT' | 'LINE_OUT_OF_RANGE' | 'BUDGET_TOO_SMALL'
export class RetrievalError extends Error {
	constructor(
		message: string,
		readonly code: RetrievalErrorCode
	) {
		super(message)
		this.name = 'RetrievalError'
	}
}

type SourceLine = { text: string; start: number; end: number }
type DocumentMetadata = {
	fields: MemoryMetadata
	warnings: string[]
	inactiveReasons: string[]
	bodyStart: number
}
type DocumentChunk = RetrievalMatch & { offset: number }
type Candidate = {
	result: DocumentChunk
	counts: Map<string, number>
	length: number
	context: Set<string>
}

/** Local, extractive retrieval. No network calls, model calls, or file access. */
const DEFAULT_BYTES = 12000
const MAX_BYTES = 64000
const MIN_BYTES = 1024
const encoder = new TextEncoder()
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const STOP_WORDS = new Set(
	'a an and are as at be by for from in is it of on or that the this to was were will with 的 了 是 在 和 与 及 或 我 你 他 她 它 这 那 个 有'.split(
		' '
	)
)
const METADATA_KEYS = new Set<MemoryField>([
	'status',
	'expires_at',
	'valid_from',
	'supersedes',
	'source',
	'memory_key',
	'entity',
	'period',
	'metric',
	'basis',
	'definition_version',
	'value',
	'unit',
	'as_of'
])
const FILTER_KEYS = ['entity', 'period', 'metric', 'basis', 'definition_version'] as const
const COLUMN_KEYS: Readonly<Record<string, MemoryField>> = {
	entity: 'entity',
	实体: 'entity',
	period: 'period',
	期间: 'period',
	metric: 'metric',
	指标: 'metric',
	basis: 'basis',
	口径: 'basis',
	definition_version: 'definition_version',
	口径版本: 'definition_version',
	value: 'value',
	值: 'value',
	unit: 'unit',
	单位: 'unit',
	as_of: 'as_of',
	截至日期: 'as_of',
	status: 'status',
	状态: 'status'
}

function bytes(value: unknown): number {
	return encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length
}
function normalize(text: string): string {
	return text.normalize('NFKC').toLocaleLowerCase('en-US')
}
function normalizedSource(text: string): {
	normalized: string
	sourceOffsets: number[]
	graphemeOffsets: number[]
} {
	const sourceOffsets: number[] = []
	const graphemeOffsets: number[] = []
	const pieces: string[] = []
	for (const part of graphemeSegmenter.segment(text)) {
		graphemeOffsets.push(part.index)
		const normalized = normalize(part.segment)
		pieces.push(normalized)
		for (let index = 0; index < normalized.length; index++) sourceOffsets.push(part.index)
	}
	graphemeOffsets.push(text.length)
	const normalized = normalize(text)
	return {
		// Whole-string case conversion preserves contextual forms such as final sigma.
		// Fall back to the mapped pieces if normalization changes across a boundary.
		normalized: normalized.length === sourceOffsets.length ? normalized : pieces.join(''),
		sourceOffsets,
		graphemeOffsets
	}
}
function fail(message: string, code: RetrievalErrorCode = 'INVALID_ARGUMENT'): never {
	throw new RetrievalError(message, code)
}
function integer(
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
	name: string
): number {
	const actual = value ?? fallback
	if (!Number.isInteger(actual) || actual < min || actual > max)
		fail(`${name} must be an integer between ${min} and ${max}.`)
	return actual
}
function getBudget(options: { readonly maxBytes?: number }): number {
	return integer(options.maxBytes, DEFAULT_BYTES, MIN_BYTES, MAX_BYTES, 'maxBytes')
}
function stamp<T extends { serialized_bytes: number }>(result: T): T {
	result.serialized_bytes = 0
	for (let attempt = 0; attempt < 8; attempt++) {
		const length = bytes(result)
		if (length === result.serialized_bytes) return result
		result.serialized_bytes = length
	}
	return result
}
function rawLines(text: string): SourceLine[] {
	const result: SourceLine[] = []
	let start = 0
	while (start < text.length) {
		const newline = text.indexOf('\n', start)
		const end = newline === -1 ? text.length : newline + 1
		result.push({ text: text.slice(start, end), start, end })
		start = end
	}
	return result.length ? result : [{ text: '', start: 0, end: 0 }]
}
function plainLine(line: SourceLine): string {
	return line.text.replace(/\r?\n$/, '')
}
function validateDocument(document: MarkdownDocument): void {
	if (!document || typeof document !== 'object' || typeof document.markdown !== 'string')
		fail('A document must contain Markdown text.')
	for (const key of ['path', 'id', 'workspace_ref', 'content_hash', 'revision'] as const) {
		if (typeof document[key] !== 'string' || document[key].length === 0)
			fail(`A document must contain a nonempty ${key}.`)
	}
	if (
		document.representation !== undefined &&
		!['source_markdown', 'converted_markdown'].includes(document.representation)
	)
		fail('Document representation is invalid.')
	if (
		document.document_access !== undefined &&
		!['writable', 'readonly'].includes(document.document_access)
	)
		fail('Document access is invalid.')
	if (document.representation === 'converted_markdown' && document.document_access === 'writable')
		fail('Converted Markdown documents must be readonly.')
}

// Deliberately supports only scalar, top-level fields. Never execute or infer YAML.
function scalar(text: string): string | undefined {
	const value = text.trim()
	if (!value || value.length > 500) return undefined
	if (value.startsWith('"')) {
		try {
			const decoded: unknown = JSON.parse(value)
			return typeof decoded === 'string' ? decoded : undefined
		} catch {
			return undefined
		}
	}
	if (value.startsWith("'"))
		return /^'(?:[^']|'')*'$/.test(value) ? value.slice(1, -1).replaceAll("''", "'") : undefined
	if (/^[\[\]{}&*!>|%@`#]/.test(value) || /\s#/.test(value) || /:(?:\s|$)/.test(value))
		return undefined
	return value
}
function dateValue(value: string): number | undefined {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
	)
		return undefined
	const date = new Date(value)
	if (!Number.isFinite(date.getTime())) return undefined
	// Date-only values use the beginning of that date in UTC; reject normalized dates.
	if (value.length === 10 && date.toISOString().slice(0, 10) !== value) return undefined
	const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number]
	if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())
		return undefined
	return date.getTime()
}
function metadata(lines: readonly SourceLine[], now: number): DocumentMetadata {
	const fields: MemoryMetadata = {}
	const warnings: string[] = []
	let bodyStart = 0
	if (plainLine(lines[0]!) === '---') {
		const end = lines.findIndex((line, index) => index > 0 && plainLine(line) === '---')
		if (end === -1) warnings.push('unclosed_frontmatter')
		else if (end > 100) warnings.push('frontmatter_limit_exceeded')
		else if (end > 0) {
			bodyStart = end + 1
			const seen = new Set<MemoryField>()
			let previousKnownKey: MemoryField | undefined
			let unsupportedSyntax = false
			for (const line of lines.slice(1, end)) {
				const text = plainLine(line)
				if (!text.trim() || /^\s*#/.test(text)) continue
				if (/^[ \t]/.test(text)) {
					// A continuation or nested value is outside the supported single-line subset.
					if (previousKnownKey) {
						delete fields[previousKnownKey]
						warnings.push(`unsupported_${previousKnownKey}`)
					}
					continue
				}
				previousKnownKey = undefined
				const match = /^([A-Za-z_][\w-]*|'(?:[^']|'')*'|"(?:[^"\\]|\\.)*")[ \t]*:(.*)$/.exec(text)
				const decodedKey = match && scalar(match[1]!)
				// Unknown simple keys are harmless. Complex or malformed keys could alias a
				// known key, so no lifecycle assertion is safe for that frontmatter block.
				if (!match || decodedKey === undefined || (match[2] && !/^[ \t]/.test(match[2]))) {
					unsupportedSyntax = true
					continue
				}
				if (!METADATA_KEYS.has(decodedKey as MemoryField)) continue
				const key = decodedKey as MemoryField
				const value = match[2]!
				previousKnownKey = key
				if (seen.has(key)) {
					delete fields[key]
					warnings.push(`duplicate_${key}`)
					continue
				}
				seen.add(key)
				const decoded = scalar(value)
				if (decoded === undefined) warnings.push(`unsupported_${key}`)
				else fields[key] = decoded
			}
			if (unsupportedSyntax) {
				for (const key of METADATA_KEYS) delete fields[key]
				warnings.push('unsupported_frontmatter_syntax')
			}
		}
	}
	const inactiveReasons: string[] = []
	if (fields.status) {
		if (['archived', 'superseded', 'expired', 'draft', 'needs_review'].includes(fields.status))
			inactiveReasons.push(fields.status)
		else if (fields.status !== 'active') warnings.push('unrecognized_status')
	}
	for (const key of ['expires_at', 'valid_from'] as const) {
		if (fields[key] === undefined) continue
		const time = dateValue(fields[key])
		if (time === undefined) warnings.push(`invalid_${key}`)
		else if (key === 'expires_at' && time <= now) inactiveReasons.push('expired')
		else if (key === 'valid_from' && time > now) inactiveReasons.push('not_yet_valid')
	}
	if (fields.as_of && dateValue(fields.as_of) === undefined) warnings.push('invalid_as_of')
	return {
		fields,
		warnings: [...new Set(warnings)],
		inactiveReasons: [...new Set(inactiveReasons)],
		bodyStart
	}
}
function terms(text: string): string[] {
	const normalized = normalize(text)
	const values = []
	for (const part of segmenter.segment(normalized)) {
		if (part.isWordLike && !STOP_WORDS.has(part.segment)) values.push(part.segment)
	}
	for (const run of normalized.match(/\p{Script=Han}{2,}/gu) ?? []) {
		const characters = [...run]
		for (let index = 0; index < characters.length - 1; index++)
			values.push(characters[index]! + characters[index + 1]!)
	}
	return values
}
function frequencies(values: readonly string[]): Map<string, number> {
	const result = new Map<string, number>()
	for (const value of values) result.set(value, (result.get(value) ?? 0) + 1)
	return result
}
function sourceResult(
	document: MarkdownDocument,
	startLine: number,
	endLine: number,
	text: string
): RetrievalMatch {
	return {
		workspace_ref: document.workspace_ref,
		path: document.path,
		id: document.id,
		start_line: startLine,
		end_line: endLine,
		revision: document.revision,
		content_hash: document.content_hash,
		representation: document.representation ?? 'source_markdown',
		document_access: document.document_access ?? 'readonly',
		...(typeof document.modified_at === 'string' ? { modified_at: document.modified_at } : {}),
		text
	}
}
function addMemoryFields<T extends RetrievalMatch>(
	result: T,
	documentMetadata: DocumentMetadata,
	conflict: MemoryConflict | undefined
): T {
	if (Object.keys(documentMetadata.fields).length)
		result.memory_metadata = { ...documentMetadata.fields }
	if (documentMetadata.warnings.length) result.metadata_warnings = [...documentMetadata.warnings]
	if (documentMetadata.inactiveReasons.length)
		result.inactive_reasons = [...documentMetadata.inactiveReasons]
	if (conflict) result.conflict = conflict
	return result
}
function chunks(
	document: MarkdownDocument,
	lines: readonly SourceLine[],
	documentMetadata: DocumentMetadata,
	structured = true
): DocumentChunk[] {
	const result: DocumentChunk[] = []
	let start = -1
	const headingStack: string[] = []
	let activeHeading = ''
	const tableRows = structured ? markdownTableRows(lines, documentMetadata.bodyStart) : []
	const rowsByIndex = new Map(tableRows.map((row) => [row.startIndex, row]))
	const tableHeaders = new Set(
		tableRows.flatMap((row) => [row.headerStartIndex, row.headerStartIndex + 1])
	)
	function append(from: number, to: number, atomic = false): void {
		// Preserve complete contiguous lines and blank lines; never combine separate paragraphs.
		let cursor = from
		while (cursor <= to) {
			let end = cursor
			let length = bytes(lines[end]!.text)
			while (
				end < to &&
				(atomic || (end - cursor < 31 && length + bytes(lines[end + 1]!.text) <= 3200))
			)
				length += bytes(lines[++end]!.text)
			const text = lines
				.slice(cursor, end + 1)
				.map((line) => line.text)
				.join('')
			if (text.trim())
				result.push({
					...sourceResult(document, cursor + 1, end + 1, text),
					...(activeHeading ? { heading: activeHeading } : {}),
					offset: lines[cursor]!.start
				})
			cursor = end + 1
		}
	}
	function flush(end: number): void {
		if (start !== -1) append(start, end)
		start = -1
	}
	let fenced = false
	let fenceChar: string | undefined
	let fenceLength = 0
	for (let index = documentMetadata.bodyStart; index < lines.length; index++) {
		const row = rowsByIndex.get(index)
		if (row || tableHeaders.has(index)) {
			flush(index - 1)
			if (row)
				result.push({
					...sourceResult(
						document,
						row.startIndex + 1,
						row.endIndex + 1,
						lines[row.startIndex]!.text
					),
					...(activeHeading ? { heading: activeHeading } : {}),
					structured_record: {
						kind: 'table_row',
						header_line: row.headerStartIndex + 1,
						fields: row.record
					},
					offset: lines[row.startIndex]!.start
				})
			continue
		}
		const line = plainLine(lines[index]!)
		const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
		if (fence) {
			if (!fenced && (fence[1]![0] !== '`' || !fence[2]!.includes('`'))) {
				flush(index - 1)
				start = index
				fenced = true
				fenceChar = fence[1]![0]
				fenceLength = fence[1]!.length
				continue
			} else if (
				fenced &&
				fence[1]![0] === fenceChar &&
				fence[1]!.length >= fenceLength &&
				!fence[2]!.trim()
			) {
				fenced = false
				append(start, index, true)
				start = -1
				continue
			}
		}
		const heading = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
		if (heading) {
			flush(index - 1)
			headingStack.length = heading[1]!.length - 1
			headingStack[heading[1]!.length - 1] = heading[2]!
			activeHeading = headingStack.filter(Boolean).join(' > ')
			append(index, index)
		} else if (!line.trim() && !fenced) flush(index - 1)
		else if (start === -1) start = index
	}
	flush(lines.length - 1)
	return result
}
function positiveNow(value: SearchOptions['now']): number {
	const parsed = value === undefined ? new Date() : value instanceof Date ? value : new Date(value)
	if (!Number.isFinite(parsed.getTime())) fail('now must be a valid date.')
	return parsed.getTime()
}

function partialResult(candidate: DocumentChunk, start: number, end: number): RetrievalMatch {
	const { offset, ...result } = candidate
	const prefix = result.text.slice(0, start)
	const excerpt = result.text.slice(start, end)
	result.start_line += (prefix.match(/\n/g) ?? []).length
	// A trailing newline belongs to the source line preceding it.
	result.end_line = result.start_line + (excerpt.replace(/\n$/, '').match(/\n/g) ?? []).length
	result.text = excerpt
	result.partial_text = true
	result.partial_line =
		(start > 0 && candidate.text[start - 1] !== '\n') ||
		(end < candidate.text.length && candidate.text[end - 1] !== '\n')
	result.start_offset_utf16 = offset + start
	result.end_offset_utf16 = offset + end
	return result
}

function boundedCandidate(
	output: SearchResult,
	candidate: DocumentChunk,
	query: string,
	queryTerms: readonly string[],
	budget: number
): boolean {
	const { offset, ...result } = candidate
	output.results.push(result)
	if (stamp(output).serialized_bytes <= budget) return true
	output.results.pop()
	// A structured row must remain atomic: never show a full JSON record beside a cut cell.
	if (candidate.structured_record) return false

	// Oversized single-line paragraphs remain searchable. Keep an exact contiguous
	// window around the normalized match, and disclose the original UTF-16 offsets.
	// NFKC can expand ligatures or compose combining marks, so normalized indices
	// must be mapped back through grapheme boundaries before slicing source text.
	const mapped = normalizedSource(candidate.text)
	const anchors = [query.trim(), ...queryTerms]
		.map((term) => mapped.normalized.indexOf(normalize(term)))
		.filter((index) => index >= 0)
	if (!anchors.length) return false
	const anchor = mapped.sourceOffsets[anchors[0]!]!
	const offsets = mapped.graphemeOffsets
	const pointCount = offsets.length - 1
	let anchorPoint = offsets.findIndex((offset) => offset >= anchor)
	if (anchorPoint === -1) anchorPoint = 0
	let best: RetrievalMatch | undefined
	let low = 1,
		high = Math.min(pointCount, 4000)
	output.truncated = true
	while (low <= high) {
		const length = Math.floor((low + high) / 2)
		const startPoint = Math.max(
			0,
			Math.min(pointCount - length, anchorPoint - Math.floor(length / 4))
		)
		const trial = partialResult(candidate, offsets[startPoint]!, offsets[startPoint + length]!)
		output.results.push(trial)
		const fits = stamp(output).serialized_bytes <= budget
		output.results.pop()
		if (fits) {
			best = trial
			low = length + 1
		} else high = length - 1
	}
	// Do not return a tiny fragment lacking any matched term as if it answered the query.
	if (!best) return false
	const normalizedExcerpt = normalize(best.text)
	if (
		!normalizedExcerpt.includes(normalize(query.trim())) &&
		!queryTerms.some((term) => normalizedExcerpt.includes(term))
	)
		return false
	output.results.push(best)
	return true
}

function candidateText(result: DocumentChunk): string {
	return result.structured_record ? JSON.stringify(result.structured_record.fields) : result.text
}

function rowMetadata(chunk: DocumentChunk, base: DocumentMetadata): DocumentMetadata {
	if (!chunk.structured_record) return base
	const fields = { ...base.fields }
	const seen = new Set<MemoryField>()
	const warnings = [...base.warnings]
	for (const [column, value] of Object.entries(chunk.structured_record.fields)) {
		const normalizedColumn = normalize(column.trim())
		if (!Object.hasOwn(COLUMN_KEYS, normalizedColumn)) continue
		const key = COLUMN_KEYS[normalizedColumn]!
		if (seen.has(key)) {
			delete fields[key]
			warnings.push(`duplicate_${key}`)
		} else if (!value.trim() || value.length > 500) {
			delete fields[key]
			warnings.push(`unsupported_${key}`)
		} else fields[key] = value.trim()
		seen.add(key)
	}
	// Row status may further restrict a document, never reactivate an inactive source document.
	const inactiveReasons = [...base.inactiveReasons]
	if (
		fields.status &&
		['archived', 'superseded', 'expired', 'draft', 'needs_review'].includes(fields.status)
	)
		inactiveReasons.push(fields.status)
	if (fields.as_of && dateValue(fields.as_of) === undefined) warnings.push('invalid_as_of')
	return {
		...base,
		fields,
		warnings: [...new Set(warnings)],
		inactiveReasons: [...new Set(inactiveReasons)]
	}
}

function matchesFilters(fields: MemoryMetadata, filters: FinancialFilters | undefined): boolean {
	return (
		!filters ||
		Object.entries(filters).every(([key, value]) => {
			const field = fields[key as keyof FinancialFilters]
			return field !== undefined && normalize(field.trim()) === normalize(value.trim())
		})
	)
}

function isExactMetricLookup(options: SearchOptions): boolean {
	return (
		options.canonicalOnly === true && FILTER_KEYS.every((key) => Boolean(options.filters?.[key]))
	)
}

function prepareCandidates(documents: readonly MarkdownDocument[], options: SearchOptions) {
	const now = positiveNow(options.now)
	const prepared = documents.map((document) => {
		validateDocument(document)
		const lines = rawLines(document.markdown)
		const meta: DocumentMetadata =
			options.parseMemoryMetadata === false
				? { fields: {}, warnings: [], inactiveReasons: [], bodyStart: 0 }
				: metadata(lines, now)
		return { document, lines, meta }
	})
	// A memory_key never grants authority or selects a winning assertion.
	const byMemory = new Map<string, Map<string, string>>()
	for (const item of prepared) {
		const key = item.meta.fields.memory_key
		if (!key || item.meta.inactiveReasons.length) continue
		const mapKey = `${item.document.workspace_ref}\u0000${key}`
		if (!byMemory.has(mapKey)) byMemory.set(mapKey, new Map())
		byMemory.get(mapKey)!.set(item.document.id, item.document.path)
	}
	const candidates: Candidate[] = []
	let excluded = 0
	for (const item of prepared) {
		if (item.meta.inactiveReasons.length && !options.includeInactive) {
			excluded++
			continue
		}
		const key = item.meta.fields.memory_key
		const related = key && byMemory.get(`${item.document.workspace_ref}\u0000${key}`)
		const conflict: MemoryConflict | undefined =
			related && related.size > 1
				? {
						memory_key: key,
						paths: [...related.values()].sort().slice(0, 8),
						...(related.size > 8 ? { total_paths: related.size, paths_truncated: true } : {}),
						resolution: 'unresolved'
					}
				: undefined
		let accepted = false
		for (const chunk of chunks(
			item.document,
			item.lines,
			item.meta,
			options.parseMemoryMetadata !== false
		)) {
			const meta = rowMetadata(chunk, item.meta)
			if (
				!matchesFilters(meta.fields, options.filters) ||
				(meta.inactiveReasons.length && !options.includeInactive)
			)
				continue
			const values = terms(candidateText(chunk))
			candidates.push({
				result: addMemoryFields(chunk, meta, conflict),
				counts: frequencies(values),
				length: values.length,
				context: new Set(terms(`${chunk.path} ${chunk.heading ?? ''}`))
			})
			accepted = true
		}
		if (!accepted) excluded++
	}
	if (!options.canonicalOnly) return { candidates, excluded }
	const canonical = {
		scope: 'scanned_candidates' as const,
		conflicting_records: 0,
		incomplete_records: 0,
		duplicate_records_suppressed: 0
	}
	const grouped = new Map<string, Candidate[]>()
	for (const candidate of candidates) {
		const fields = candidate.result.memory_metadata ?? {}
		if (
			[...FILTER_KEYS, 'value', 'unit', 'as_of'].some((key) => !fields[key as MemoryField]) ||
			dateValue(fields.as_of!) === undefined ||
			candidate.result.metadata_warnings?.length ||
			candidate.result.conflict
		) {
			canonical.incomplete_records++
			continue
		}
		const key = JSON.stringify([
			candidate.result.workspace_ref,
			...FILTER_KEYS.map((key) => normalize(fields[key]!)),
			fields.unit!.trim()
		])
		const group = grouped.get(key) ?? []
		group.push(candidate)
		grouped.set(key, group)
	}
	const unique: Candidate[] = []
	for (const group of grouped.values()) {
		const values = new Set(group.map(({ result }) => result.memory_metadata!.value!.trim()))
		if (values.size !== 1) {
			canonical.conflicting_records += group.length
			continue
		}
		group.sort(
			(a, b) =>
				a.result.path.localeCompare(b.result.path) || a.result.start_line - b.result.start_line
		)
		unique.push(group[0]!)
		canonical.duplicate_records_suppressed += group.length - 1
	}
	return { candidates: unique, excluded, canonical }
}

/**
 * Search exact source paragraphs with local BM25 and Chinese word/bigram indexing.
 * Output budget is UTF-8 bytes of this returned JSON object, NOT model tokens.
 */
function validateSearchInputs(
	documents: readonly MarkdownDocument[],
	query: string,
	options: SearchOptions
): void {
	if (!Array.isArray(documents)) fail('documents must be an array.')
	if (typeof query !== 'string' || !query.trim() || query.length > 1000)
		fail('query must contain 1 to 1000 characters.')
	getBudget(options)
	integer(options.maxResults, 5, 1, 20, 'maxResults')
	positiveNow(options.now)
	if (options.filters !== undefined) {
		if (
			!options.filters ||
			typeof options.filters !== 'object' ||
			Array.isArray(options.filters) ||
			Object.entries(options.filters).some(
				([key, value]) =>
					!FILTER_KEYS.includes(key as keyof FinancialFilters) ||
					typeof value !== 'string' ||
					!value.trim() ||
					value.length > 200 ||
					value.includes('\0')
			)
		)
			fail(
				'filters must contain only nonempty entity, period, metric, basis or definition_version strings.'
			)
	}
	if (options.canonicalOnly !== undefined && typeof options.canonicalOnly !== 'boolean')
		fail('canonicalOnly must be a boolean.')
	if (options.canonicalOnly && options.includeInactive)
		fail('Canonical metric retrieval cannot include inactive records.')
	if (options.includeInactive !== undefined && typeof options.includeInactive !== 'boolean')
		fail('includeInactive must be boolean.')
}

export function searchDocuments(
	documents: readonly MarkdownDocument[],
	query: string,
	options: SearchOptions = {}
): SearchResult {
	validateSearchInputs(documents, query, options)
	return rankCandidates(prepareCandidates(documents, options), query, options)
}

function rankCandidates(
	prepared: ReturnType<typeof prepareCandidates>,
	query: string,
	options: SearchOptions,
	semantic?: {
		scores: ReadonlyMap<string, number>
		mode: RetrievalMode
		minimumScore?: number
		maximumScoreDrop?: number
		detail: NonNullable<SearchResult['retrieval']>
	}
): SearchResult {
	const budget = getBudget(options)
	const maxResults = integer(options.maxResults, 5, 1, 20, 'maxResults')
	const { candidates, excluded } = prepared
	const queryTerms = [...new Set(terms(query))]
	const documentFrequency = new Map(
		queryTerms.map((term) => [
			term,
			candidates.filter((candidate) => candidate.counts.has(term)).length
		])
	)
	const averageLength =
		candidates.reduce((sum, candidate) => sum + candidate.length, 0) / (candidates.length || 1) || 1
	const normalizedQuery = normalize(query.trim())
	const ranked: { score: number; result: DocumentChunk }[] = []
	for (const candidate of candidates) {
		let score = 0
		let matched = 0
		for (const term of queryTerms) {
			const frequency = candidate.counts.get(term) ?? 0
			if (frequency) {
				matched++
				const idf = Math.log(
					1 +
						(candidates.length - (documentFrequency.get(term) ?? 0) + 0.5) /
							((documentFrequency.get(term) ?? 0) + 0.5)
				)
				score +=
					(idf * (frequency * 2.2)) /
					(frequency + 1.2 * (0.25 + (0.75 * candidate.length) / averageLength))
			}
			if (candidate.context.has(term)) score += 0.15
		}
		if (normalize(candidateText(candidate.result)).includes(normalizedQuery)) {
			score += 2
			matched++
		}
		if (!matched && !isExactMetricLookup(options)) continue
		ranked.push({
			score,
			result: isExactMetricLookup(options)
				? { ...candidate.result, match_basis: 'metadata' }
				: candidate.result
		})
	}
	ranked.sort(
		(a, b) =>
			b.score - a.score ||
			a.result.workspace_ref.localeCompare(b.result.workspace_ref) ||
			a.result.path.localeCompare(b.result.path) ||
			a.result.start_line - b.result.start_line
	)
	if (semantic && semantic.mode !== 'keyword') {
		const lexical = new Map(ranked.map((item, index) => [candidateKey(item.result), index]))
		const semanticRanking = candidates
			.map(({ result }) => ({
				result,
				score: semantic.scores.get(candidateKey(result)) ?? -1
			}))
			.filter(({ score }) => score >= (semantic.minimumScore ?? 0.72))
			.sort((a, b) => b.score - a.score)
			.slice(0, 20)
		const best = semanticRanking[0]?.score ?? 1
		const semanticRanks = new Map(
			semanticRanking
				.filter(({ score }) => score >= best - (semantic.maximumScoreDrop ?? 0.08))
				.map((item, index) => [candidateKey(item.result), index])
		)
		ranked.length = 0
		for (const { result, counts } of candidates) {
			const key = candidateKey(result)
			const wordRank = semantic.mode === 'semantic' ? undefined : lexical.get(key)
			const meaningRank = semanticRanks.get(key)
			if (wordRank === undefined && meaningRank === undefined) continue
			// Preserve cosine margins. Rank-only fusion lets a weak same-language word
			// match outweigh a much stronger translated semantic match.
			const lexicalCoverage =
				queryTerms.filter((term) => counts.has(term)).length / (queryTerms.length || 1)
			const score =
				Math.max(0, semantic.scores.get(key) ?? 0) +
				(wordRank === undefined
					? 0
					: 0.2 * lexicalCoverage +
						(normalize(candidateText(result)).includes(normalizedQuery) ? 0.5 : 0))
			ranked.push({
				score,
				result: {
					...result,
					match_basis:
						wordRank === undefined ? 'semantic' : meaningRank === undefined ? 'keyword' : 'both',
					...(meaningRank === undefined
						? {}
						: {
								semantic_similarity: Math.round(semantic.scores.get(key)! * 10000) / 10000
							})
				}
			})
		}
		ranked.sort(
			(a, b) =>
				b.score - a.score ||
				a.result.path.localeCompare(b.result.path) ||
				a.result.offset - b.result.offset
		)
	}
	const output: SearchResult = {
		...(prepared.canonical ? { canonical: prepared.canonical } : {}),
		...(semantic ? { retrieval: semantic.detail } : {}),
		serialized_bytes: 0,
		results: [],
		total_matches: ranked.length,
		truncated: ranked.length > maxResults,
		excluded_documents: excluded,
		source_content_is_untrusted: true,
		budget_bytes: budget
	}
	for (const candidate of ranked) {
		if (output.results.length >= maxResults) break
		if (!boundedCandidate(output, candidate.result, query, queryTerms, budget))
			output.truncated = true
	}
	if (!output.results.length && ranked.length)
		output.budget_notice =
			'Matching paragraphs exceed the output budget; use knowledge_get_excerpt for a smaller line range.'
	return stamp(output)
}

export type RetrievalMode = 'hybrid' | 'keyword' | 'semantic'

function candidateKey(result: DocumentChunk): string {
	return JSON.stringify([result.workspace_ref, result.id, result.content_hash, result.offset])
}

/** The optional host runs embeddings locally. Cached vectors never supply source text. */
export async function searchDocumentsLocally(
	documents: readonly MarkdownDocument[],
	query: string,
	options: SearchOptions,
	mode: RetrievalMode,
	ranker: KnowledgeBundleMCPSemanticRanker | undefined,
	signal: AbortSignal
): Promise<SearchResult> {
	signal.throwIfAborted()
	// Validate all inputs before invoking a host, including budget and memory metadata.
	validateSearchInputs(documents, query, options)
	const prepared = prepareCandidates(documents, options)
	// A fully identified scalar record is an exact lookup, not a similarity question. A weak
	// cross-language cosine must never hide a unique, consistent entity/period/metric/basis/version.
	if (isExactMetricLookup(options))
		return rankCandidates(prepared, query, options, {
			scores: new Map(),
			mode: 'keyword',
			detail: {
				requested_mode: mode,
				used_mode: 'metadata',
				complete: true,
				notice: 'Exact canonical metadata lookup; embedding similarity was not used.'
			}
		})
	if (mode === 'keyword') return rankCandidates(prepared, query, options)
	const fallback = (notice: string): SearchResult => {
		return rankCandidates(prepared, query, options, {
			scores: new Map(),
			mode: 'keyword',
			detail: {
				requested_mode: mode,
				used_mode: 'keyword',
				complete: false,
				notice
			}
		})
	}
	if (!prepared.candidates.length)
		return rankCandidates(prepared, query, options, {
			scores: new Map(),
			mode,
			detail: {
				requested_mode: mode,
				used_mode: mode,
				indexed_passages: 0,
				total_passages: 0,
				complete: true
			}
		})
	if (!ranker) return fallback('Local semantic model is unavailable; keyword results only.')
	const { candidates } = prepared
	// Bound local inference separately from the document scan. Disclose partial coverage.
	const selected = candidates
		.filter(({ result }) => bytes(candidateText(result)) <= 16000)
		.slice(0, 512)
	if (!selected.length) return fallback('No passages fit the local semantic index limits.')
	try {
		const ranked = await ranker(
			query,
			selected.map(({ result }) => candidateText(result)),
			signal
		)
		signal.throwIfAborted()
		if (
			ranked.scores.length !== selected.length ||
			ranked.scores.some((score) => !Number.isFinite(score) || score < -1 || score > 1) ||
			!Number.isSafeInteger(ranked.cacheHits) ||
			ranked.cacheHits < 0 ||
			ranked.cacheHits > selected.length ||
			[ranked.minimumScore, ranked.maximumScoreDrop].some(
				(value) => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)
			)
		)
			throw new Error('Invalid local semantic scores.')
		const scores = new Map(
			selected.map(({ result }, index) => [candidateKey(result), ranked.scores[index]!])
		)
		return rankCandidates(prepared, query, options, {
			scores,
			mode,
			minimumScore: ranked.minimumScore,
			maximumScoreDrop: ranked.maximumScoreDrop,
			detail: {
				requested_mode: mode,
				used_mode: mode,
				model: ranked.model.slice(0, 100),
				indexed_passages: selected.length,
				total_passages: candidates.length,
				cache_hits: ranked.cacheHits,
				embedded_passages: selected.length - ranked.cacheHits,
				complete: selected.length === candidates.length,
				...(selected.length === candidates.length
					? {}
					: {
							notice:
								'Semantic index limited to 512 passages of at most 16000 UTF-8 bytes each. Narrow path for remaining content.'
						})
			}
		})
	} catch {
		signal.throwIfAborted()
		return fallback(
			'Local semantic inference failed or timed out; keyword results only. Retry or use mode=keyword.'
		)
	}
}

/** Returns a contiguous, original source line range. Never serve a stale hash. */
export function readExcerpt(
	document: MarkdownDocument,
	options: ExcerptOptions = {}
): ExcerptResult {
	validateDocument(document)
	const budget = getBudget(options)
	if (options.expectedHash !== undefined && options.expectedHash !== document.content_hash)
		fail(
			'Document content changed. Search again or read its current revision before citing it.',
			'STALE_DOCUMENT'
		)
	const lines = rawLines(document.markdown)
	const startLine = integer(options.startLine, 1, 1, Number.MAX_SAFE_INTEGER, 'startLine')
	if (startLine > lines.length)
		fail(`startLine exceeds document length (${lines.length} lines).`, 'LINE_OUT_OF_RANGE')
	const endLine = integer(
		options.endLine,
		Math.min(startLine + 39, lines.length),
		startLine,
		Number.MAX_SAFE_INTEGER,
		'endLine'
	)
	const desiredEnd = Math.min(endLine, lines.length)
	const output: ExcerptResult = {
		serialized_bytes: 0,
		...sourceResult(document, startLine, startLine, ''),
		total_lines: lines.length,
		truncated: false,
		source_content_is_untrusted: true,
		budget_bytes: budget
	}
	if (stamp(output).serialized_bytes > budget)
		fail('Source metadata exceeds the output budget; increase maxBytes.', 'BUDGET_TOO_SMALL')
	let included = 0
	for (let index = startLine - 1; index < desiredEnd; index++) {
		const previous = output.text
		output.text += lines[index]!.text
		output.end_line = index + 1
		if (stamp(output).serialized_bytes > budget) {
			output.text = previous
			output.end_line = included ? startLine + included - 1 : startLine
			output.truncated = true
			break
		}
		included++
	}
	if (included === 0 && lines[startLine - 1]!.text.length) {
		output.truncated = true
		output.partial_line = true
		const codepoints = [...lines[startLine - 1]!.text]
		let low = 0,
			high = codepoints.length
		while (low < high) {
			const middle = Math.ceil((low + high) / 2)
			output.text = codepoints.slice(0, middle).join('')
			if (stamp(output).serialized_bytes <= budget) low = middle
			else high = middle - 1
		}
		output.text = codepoints.slice(0, low).join('')
	}
	if (output.truncated && !output.partial_line) output.next_start_line = output.end_line + 1
	if (output.partial_line) output.full_document_tool = 'knowledge_get_document'
	// Reserving pagination metadata can require one fewer complete line.
	while (stamp(output).serialized_bytes > budget && output.text.length) {
		if (!output.partial_line && included > 1) {
			included--
			output.end_line = startLine + included - 1
			output.text = lines
				.slice(startLine - 1, output.end_line)
				.map((line) => line.text)
				.join('')
			output.next_start_line = output.end_line + 1
		} else {
			output.partial_line = true
			output.text = [...output.text].slice(0, -1).join('')
			delete output.next_start_line
			output.full_document_tool = 'knowledge_get_document'
		}
	}
	if (stamp(output).serialized_bytes > budget)
		fail('Source metadata exceeds the output budget; increase maxBytes.', 'BUDGET_TOO_SMALL')
	return stamp(output)
}
