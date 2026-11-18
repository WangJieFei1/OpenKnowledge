import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
	defaultCodexMemoryLimits,
	type CodexMemoryLimits,
	type CodexMemoryRole,
	type CodexMemorySession,
	type CodexMemorySnapshot,
	type CodexMemoryTurn
} from './types'

export { defaultCodexMemoryLimits }
export type {
	CodexMemoryLimits,
	CodexMemoryRole,
	CodexMemorySession,
	CodexMemorySnapshot,
	CodexMemoryTurn
}

type JsonObject = Record<string, unknown>
type PendingTurn = Omit<CodexMemoryTurn, 'index'>
type SessionMetadata = { id: string; cwd: string; timestamp?: string }

type ParsedRollout = {
	metadata: SessionMetadata | null
	turns: PendingTurn[]
	warnings: Set<string>
}

type Discovery = {
	files: string[]
	warnings: Set<string>
}

type OpenRollout = {
	handle: FileHandle
	size: number
}

type MetadataInspection = {
	metadata: SessionMetadata | null
	warnings: Set<string>
}

const rolloutName = /^rollout-.*\.jsonl$/
const maximumMetadataHeaderBytes = 256 * 1024
const injectedBlockNames = [
	'app-context',
	'apps_instructions',
	'bootstrap',
	'codex_bootstrap',
	'codex_context',
	'collaboration_mode',
	'developer',
	'developer_instructions',
	'environment_context',
	'multi_agent_mode',
	'permissions instructions',
	'permissions_instructions',
	'plugins_instructions',
	'recommended_plugins',
	'skills_instructions',
	'system-reminder',
	'user_instructions'
] as const

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegularExpression(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanMemoryText(value: string): string {
	let text = value.replace(/\r\n?/g, '\n')
	text = text.replace(
		/(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?AGENTS\.md instructions[^\n]*\n[ \t]*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>[ \t]*(?=\n|$)/gi,
		'\n'
	)
	for (const name of injectedBlockNames) {
		const escaped = escapeRegularExpression(name)
		text = text.replace(
			new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}\\s*>`, 'gi'),
			''
		)
		text = text.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?\\s*\\/>`, 'gi'), '')
	}
	return text
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/g, ''))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

function textFromContent(content: unknown): string {
	if (!Array.isArray(content)) {
		return ''
	}
	return content
		.flatMap((item) => {
			if (
				!isObject(item) ||
				(item.type !== 'input_text' && item.type !== 'output_text') ||
				typeof item.text !== 'string'
			) {
				return []
			}
			const text = cleanMemoryText(item.text)
			return text ? [text] : []
		})
		.join('\n')
}

function isDialogueDestination(value: JsonObject): boolean {
	for (const field of ['recipient', 'to'] as const) {
		if (!(field in value)) {
			continue
		}
		const destination = value[field]
		if (
			typeof destination !== 'string' ||
			(destination.toLowerCase() !== 'all' && destination.toLowerCase() !== 'user')
		) {
			return false
		}
	}
	return true
}

function isVisibleAssistantMessage(value: JsonObject): boolean {
	if (!isDialogueDestination(value)) {
		return false
	}
	for (const field of ['channel', 'phase'] as const) {
		const classification = value[field]
		if (
			typeof classification === 'string' &&
			(classification.toLowerCase() === 'analysis' || classification.toLowerCase() === 'reasoning')
		) {
			return false
		}
	}
	return true
}

function messageTurn(value: unknown, timestamp?: string): PendingTurn | null {
	if (
		!isObject(value) ||
		value.type !== 'message' ||
		(value.role !== 'user' && value.role !== 'assistant') ||
		!isDialogueDestination(value) ||
		(value.role === 'assistant' && !isVisibleAssistantMessage(value))
	) {
		return null
	}
	const text = textFromContent(value.content)
	if (!text) {
		return null
	}
	return timestamp ? { role: value.role, text, timestamp } : { role: value.role, text }
}

function envelopeBody(text: string): { type: string; text: string } | null {
	const type = /(?:^|\n)[ \t]*Message Type:[ \t]*([A-Z_]+)[ \t]*(?=\n|$)/i.exec(text)
	if (!type) {
		return null
	}
	const afterType = text.slice(type.index + type[0].length)
	const payload = /(?:^|\n)[ \t]*Payload:[ \t]*(?:\n|$)/i.exec(afterType)
	if (!payload) {
		return null
	}
	const body = cleanMemoryText(afterType.slice(payload.index + payload[0].length))
	if (!body) {
		return null
	}
	return {
		type: type[1]!.toUpperCase(),
		text: body
	}
}

function agentMessageTurn(
	value: unknown,
	timestamp: string | undefined,
	warnings: Set<string>
): PendingTurn | null {
	if (!isObject(value) || value.type !== 'agent_message' || !Array.isArray(value.content)) {
		return null
	}
	let encrypted = false
	const plaintext: string[] = []
	for (const item of value.content) {
		if (!isObject(item)) {
			continue
		}
		if (item.type === 'encrypted_content' && typeof item.encrypted_content === 'string') {
			encrypted = true
		}
		if (
			(item.type === 'input_text' || item.type === 'output_text') &&
			typeof item.text === 'string' &&
			item.text.trim()
		) {
			plaintext.push(item.text)
		}
	}
	if (plaintext.length === 0) {
		if (encrypted) {
			warnings.add('encrypted-agent-message-omitted')
		}
		return null
	}
	const envelope = envelopeBody(plaintext.join('\n'))
	if (!envelope) {
		warnings.add('unrecognized-agent-message-omitted')
		return null
	}
	if (envelope.type !== 'FINAL_ANSWER') {
		warnings.add('non-final-agent-message-omitted')
		return null
	}
	const turn: PendingTurn = { role: 'assistant', text: envelope.text }
	return timestamp ? { ...turn, timestamp } : turn
}

function isoTimestamp(value: unknown): string | undefined {
	if (
		typeof value !== 'string' ||
		value.length > 40 ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
		!Number.isFinite(Date.parse(value))
	) {
		return undefined
	}
	return value
}

function timestampFromRecord(record: JsonObject): string | undefined {
	return isoTimestamp(record.timestamp)
}

function turnKey(turn: PendingTurn): string {
	return `${turn.role}\0${turn.text}`
}

/**
 * Replacement history describes turns before the compaction boundary. Restore only
 * occurrences not already present in the rollout, so repeated identical user turns
 * remain repeated rather than being collapsed to one.
 */
function recoverCompactedTurns(
	current: PendingTurn[],
	replacement: PendingTurn[]
): { turns: PendingTurn[]; recovered: number } {
	if (replacement.length === 0) {
		return { turns: current, recovered: 0 }
	}
	const existing = new Map<string, number[]>()
	for (const [index, turn] of current.entries()) {
		const key = turnKey(turn)
		const indexes = existing.get(key) ?? []
		indexes.push(index)
		existing.set(key, indexes)
	}
	const cursors = new Map<string, number>()
	const used = new Set<number>()
	const turns: PendingTurn[] = []
	let recovered = 0
	for (const turn of replacement) {
		const key = turnKey(turn)
		const cursor = cursors.get(key) ?? 0
		const matchedIndex = existing.get(key)?.[cursor]
		cursors.set(key, cursor + 1)
		if (matchedIndex === undefined) {
			turns.push(turn)
			recovered++
		} else {
			turns.push(current[matchedIndex]!)
			used.add(matchedIndex)
		}
	}
	for (const [index, turn] of current.entries()) {
		if (!used.has(index)) {
			turns.push(turn)
		}
	}
	return { turns, recovered }
}

function replacementTurns(
	value: unknown,
	warnings: Set<string>,
	maximumTurns: number
): PendingTurn[] {
	if (!Array.isArray(value)) {
		return []
	}
	const turns: PendingTurn[] = []
	for (const item of value) {
		if (turns.length >= maximumTurns) {
			warnings.add('turn-limit-reached')
			break
		}
		const message = messageTurn(item)
		if (message) {
			turns.push(message)
			continue
		}
		const agent = agentMessageTurn(item, undefined, warnings)
		if (agent) {
			turns.push(agent)
		}
	}
	return turns
}

function metadataFromPayload(value: unknown): SessionMetadata | null {
	if (
		!isObject(value) ||
		typeof value.id !== 'string' ||
		!/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
		typeof value.cwd !== 'string' ||
		value.cwd.length === 0 ||
		value.cwd.length > 32_768 ||
		!path.isAbsolute(value.cwd)
	) {
		return null
	}
	const timestamp = isoTimestamp(value.timestamp)
	return timestamp ? { id: value.id, cwd: value.cwd, timestamp } : { id: value.id, cwd: value.cwd }
}

function consumeRecord(record: unknown, rollout: ParsedRollout, maximumTurns: number): void {
	if (!isObject(record) || typeof record.type !== 'string') {
		return
	}
	if (record.type === 'session_meta') {
		const metadata = metadataFromPayload(record.payload)
		if (!metadata) {
			rollout.warnings.add('invalid-session-metadata-omitted')
			return
		}
		if (rollout.metadata && rollout.metadata.id !== metadata.id) {
			rollout.warnings.add('conflicting-session-metadata-omitted')
			return
		}
		rollout.metadata ??= metadata
		return
	}
	if (record.type === 'response_item' && isObject(record.payload)) {
		const timestamp = timestampFromRecord(record)
		const message = messageTurn(record.payload, timestamp)
		if (message) {
			if (rollout.turns.length < maximumTurns) {
				rollout.turns.push(message)
			} else {
				rollout.warnings.add('turn-limit-reached')
			}
			return
		}
		const agent = agentMessageTurn(record.payload, timestamp, rollout.warnings)
		if (agent) {
			if (rollout.turns.length < maximumTurns) {
				rollout.turns.push(agent)
			} else {
				rollout.warnings.add('turn-limit-reached')
			}
		}
		return
	}
	if (record.type === 'compacted' && isObject(record.payload)) {
		rollout.warnings.add('compaction-boundary-may-omit-assistant-turn')
		const recovered = replacementTurns(
			record.payload.replacement_history,
			rollout.warnings,
			maximumTurns
		)
		const merged = recoverCompactedTurns(rollout.turns, recovered)
		rollout.turns = merged.turns
		if (rollout.turns.length > maximumTurns) {
			rollout.turns = rollout.turns.slice(0, maximumTurns)
			rollout.warnings.add('turn-limit-reached')
		}
		if (merged.recovered > 0) {
			rollout.warnings.add('compacted-history-recovered')
		}
	}
}

function consumeLine(line: string, rollout: ParsedRollout, maximumTurns: number): void {
	const trimmed = line.replace(/^\uFEFF/, '').trim()
	if (!trimmed) {
		return
	}
	try {
		consumeRecord(JSON.parse(trimmed) as unknown, rollout, maximumTurns)
	} catch {
		rollout.warnings.add('malformed-jsonl-line-omitted')
	}
}

function resolvedLimits(overrides: Partial<CodexMemoryLimits>): CodexMemoryLimits {
	const limits = { ...defaultCodexMemoryLimits, ...overrides }
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new RangeError(`Invalid Codex memory limit: ${name}.`)
		}
	}
	return limits
}

async function discoverRollouts(
	root: string,
	limits: CodexMemoryLimits,
	signal: AbortSignal
): Promise<Discovery> {
	const discovery: Discovery = { files: [], warnings: new Set<string>() }
	let canonicalRoot: string
	try {
		const rootStat = await lstat(root)
		signal.throwIfAborted()
		if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
			discovery.warnings.add('sessions-root-is-not-a-real-directory')
			return discovery
		}
		canonicalRoot = await realpath(root)
	} catch {
		signal.throwIfAborted()
		discovery.warnings.add('sessions-root-unavailable')
		return discovery
	}

	let directories = 0
	let stopped = false
	async function walk(directory: string, depth: number): Promise<void> {
		if (stopped) {
			return
		}
		signal.throwIfAborted()
		if (depth > limits.maximumDepth) {
			discovery.warnings.add('directory-depth-limit-reached')
			return
		}
		if (directories >= limits.maximumDirectories) {
			discovery.warnings.add('directory-count-limit-reached')
			stopped = true
			return
		}
		directories++
		let entries
		try {
			const [canonical, directoryStat] = await Promise.all([realpath(directory), lstat(directory)])
			if (
				directoryStat.isSymbolicLink() ||
				!directoryStat.isDirectory() ||
				!isWithinWorkspace(canonical, canonicalRoot)
			) {
				discovery.warnings.add('symbolic-link-directory-omitted')
				return
			}
			entries = await readdir(canonical, { withFileTypes: true })
			directory = canonical
			signal.throwIfAborted()
		} catch {
			signal.throwIfAborted()
			discovery.warnings.add('unreadable-directory-omitted')
			return
		}
		entries.sort((left, right) => right.name.localeCompare(left.name))
		for (const entry of entries) {
			if (stopped) {
				return
			}
			signal.throwIfAborted()
			const entryPath = path.join(directory, entry.name)
			if (entry.isSymbolicLink()) {
				if (rolloutName.test(entry.name)) {
					discovery.warnings.add('symbolic-link-rollout-omitted')
				}
				continue
			}
			if (entry.isDirectory()) {
				await walk(entryPath, depth + 1)
				continue
			}
			if (!entry.isFile() || !rolloutName.test(entry.name)) {
				continue
			}
			if (discovery.files.length >= limits.maximumFiles) {
				discovery.warnings.add('file-limit-reached')
				stopped = true
				return
			}
			discovery.files.push(entryPath)
		}
	}
	await walk(root, 0)
	return discovery
}

async function openRollout(file: string, signal: AbortSignal): Promise<OpenRollout | null> {
	let handle: FileHandle | undefined
	try {
		const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
		handle = await open(file, constants.O_RDONLY | noFollow)
		signal.throwIfAborted()
		const fileStat = await handle.stat()
		if (!fileStat.isFile()) {
			await handle.close()
			return null
		}
		return { handle, size: fileStat.size }
	} catch {
		await handle?.close().catch(() => {})
		signal.throwIfAborted()
		return null
	}
}

async function inspectRolloutMetadata(
	opened: OpenRollout,
	maximumLineBytes: number,
	signal: AbortSignal
): Promise<MetadataInspection> {
	const warnings = new Set<string>()
	const permitted = Math.min(opened.size, maximumMetadataHeaderBytes)
	const decoder = new StringDecoder('utf8')
	const buffer = Buffer.allocUnsafe(Math.min(16 * 1024, Math.max(1, permitted)))
	let bytes = 0
	let pending = ''
	let discardingLongLine = false
	let found = false
	let metadata: SessionMetadata | null = null

	function consumeMetadataLine(line: string): void {
		const trimmed = line.replace(/^\uFEFF/, '').trim()
		if (!trimmed) {
			return
		}
		let record: unknown
		try {
			record = JSON.parse(trimmed) as unknown
		} catch {
			warnings.add('malformed-jsonl-line-omitted')
			return
		}
		if (!isObject(record) || record.type !== 'session_meta') {
			return
		}
		found = true
		metadata = metadataFromPayload(record.payload)
		if (!metadata) {
			warnings.add('invalid-session-metadata-omitted')
		}
	}

	function consumeChunk(chunk: string): void {
		pending += chunk
		while (!found) {
			const newline = pending.indexOf('\n')
			if (newline < 0) {
				break
			}
			const line = pending.slice(0, newline)
			pending = pending.slice(newline + 1)
			if (discardingLongLine) {
				discardingLongLine = false
				continue
			}
			if (Buffer.byteLength(line) > maximumLineBytes) {
				warnings.add('oversized-jsonl-line-omitted')
				continue
			}
			consumeMetadataLine(line)
		}
		if (!found && !discardingLongLine && Buffer.byteLength(pending) > maximumLineBytes) {
			pending = ''
			discardingLongLine = true
			warnings.add('oversized-jsonl-line-omitted')
		}
	}

	while (!found && bytes < permitted) {
		signal.throwIfAborted()
		const length = Math.min(buffer.length, permitted - bytes)
		const result = await opened.handle.read(buffer, 0, length, bytes)
		if (result.bytesRead === 0) {
			break
		}
		bytes += result.bytesRead
		consumeChunk(decoder.write(buffer.subarray(0, result.bytesRead)))
	}
	if (!found && bytes >= opened.size) {
		consumeChunk(decoder.end())
		if (!discardingLongLine && pending.trim()) {
			if (Buffer.byteLength(pending) > maximumLineBytes) {
				warnings.add('oversized-jsonl-line-omitted')
			} else {
				consumeMetadataLine(pending)
			}
		}
	}
	if (!found) {
		warnings.add('invalid-session-metadata-omitted')
		warnings.add(
			opened.size > permitted ? 'session-metadata-header-limit-reached' : 'session-metadata-missing'
		)
	}
	return { metadata, warnings }
}

async function parseOpenedRollout(
	opened: OpenRollout,
	maximumBytes: number,
	maximumLineBytes: number,
	maximumTurns: number,
	signal: AbortSignal
): Promise<{ rollout: ParsedRollout; bytes: number; truncated: boolean } | null> {
	const rollout: ParsedRollout = { metadata: null, turns: [], warnings: new Set<string>() }
	try {
		const permitted = Math.min(opened.size, maximumBytes)
		const decoder = new StringDecoder('utf8')
		const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, permitted)))
		let bytes = 0
		let pending = ''
		let discardingLongLine = false

		function consumeChunk(chunk: string): void {
			pending += chunk
			for (;;) {
				const newline = pending.indexOf('\n')
				if (newline < 0) {
					break
				}
				const line = pending.slice(0, newline)
				pending = pending.slice(newline + 1)
				if (discardingLongLine) {
					discardingLongLine = false
					continue
				}
				if (Buffer.byteLength(line) > maximumLineBytes) {
					rollout.warnings.add('oversized-jsonl-line-omitted')
					continue
				}
				consumeLine(line, rollout, maximumTurns)
			}
			if (!discardingLongLine && Buffer.byteLength(pending) > maximumLineBytes) {
				pending = ''
				discardingLongLine = true
				rollout.warnings.add('oversized-jsonl-line-omitted')
			}
		}

		while (bytes < permitted) {
			signal.throwIfAborted()
			const length = Math.min(buffer.length, permitted - bytes)
			const result = await opened.handle.read(buffer, 0, length, bytes)
			if (result.bytesRead === 0) {
				break
			}
			bytes += result.bytesRead
			consumeChunk(decoder.write(buffer.subarray(0, result.bytesRead)))
		}
		const truncated = bytes < opened.size
		if (truncated) {
			rollout.warnings.add('byte-limit-reached')
		} else {
			consumeChunk(decoder.end())
			if (!discardingLongLine && pending.trim()) {
				if (Buffer.byteLength(pending) > maximumLineBytes) {
					rollout.warnings.add('oversized-jsonl-line-omitted')
				} else {
					consumeLine(pending, rollout, maximumTurns)
				}
			}
		}
		return { rollout, bytes, truncated }
	} catch {
		signal.throwIfAborted()
		return null
	}
}

async function canonicalDirectory(value: string, signal: AbortSignal): Promise<string | null> {
	try {
		const canonical = await realpath(value)
		signal.throwIfAborted()
		const directoryStat = await stat(canonical)
		signal.throwIfAborted()
		return directoryStat.isDirectory() ? canonical : null
	} catch {
		signal.throwIfAborted()
		return null
	}
}

function isWithinWorkspace(cwd: string, workspace: string): boolean {
	const relative = path.relative(workspace, cwd)
	return (
		relative === '' ||
		(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	)
}

function compareSessions(left: CodexMemorySession, right: CodexMemorySession): number {
	const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN
	const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN
	if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
		return rightTime - leftTime
	}
	if (left.timestamp !== right.timestamp) {
		return (right.timestamp ?? '').localeCompare(left.timestamp ?? '')
	}
	return left.id.localeCompare(right.id)
}

function addWarnings(target: Set<string>, source: Iterable<string>): void {
	for (const warning of source) {
		target.add(warning)
	}
}

export class CodexSessionMemory {
	readonly #sessionsRoot: string
	readonly #limits: CodexMemoryLimits

	constructor(sessionsRoot: string, limits: Partial<CodexMemoryLimits> = {}) {
		if (!sessionsRoot || !path.isAbsolute(sessionsRoot)) {
			throw new TypeError('Codex sessions root must be an absolute path.')
		}
		this.#sessionsRoot = path.resolve(sessionsRoot)
		this.#limits = resolvedLimits(limits)
	}

	async snapshot(workspaceRoot: string, signal: AbortSignal): Promise<CodexMemorySnapshot> {
		signal.throwIfAborted()
		const snapshotWarnings = new Set<string>()
		const workspace = await canonicalDirectory(workspaceRoot, signal)
		if (!workspace) {
			return { sessions: [], complete: false, warnings: ['workspace-root-unavailable'] }
		}
		const discovery = await discoverRollouts(this.#sessionsRoot, this.#limits, signal)
		addWarnings(snapshotWarnings, discovery.warnings)
		const sessions = new Map<string, CodexMemorySession>()
		let bytesRead = 0
		let turnsRead = 0

		for (const file of discovery.files) {
			signal.throwIfAborted()
			const opened = await openRollout(file, signal)
			if (!opened) {
				snapshotWarnings.add('unreadable-rollout-omitted')
				continue
			}
			try {
				const inspected = await inspectRolloutMetadata(
					opened,
					this.#limits.maximumLineBytes,
					signal
				)
				const inspectedMetadata = inspected.metadata
				if (!inspectedMetadata) {
					addWarnings(snapshotWarnings, inspected.warnings)
					continue
				}
				const cwd = await canonicalDirectory(inspectedMetadata.cwd, signal)
				if (!cwd || !isWithinWorkspace(cwd, workspace)) {
					continue
				}

				const remainingBytes = this.#limits.maximumBytes - bytesRead
				if (remainingBytes <= 0) {
					snapshotWarnings.add('byte-limit-reached')
					break
				}
				const parsed = await parseOpenedRollout(
					opened,
					remainingBytes,
					this.#limits.maximumLineBytes,
					this.#limits.maximumTurns,
					signal
				)
				if (!parsed) {
					snapshotWarnings.add('unreadable-rollout-omitted')
					continue
				}
				bytesRead += parsed.bytes
				if (parsed.truncated) {
					snapshotWarnings.add('byte-limit-reached')
				}
				const { metadata } = parsed.rollout
				if (
					!metadata ||
					metadata.id !== inspectedMetadata.id ||
					metadata.cwd !== inspectedMetadata.cwd
				) {
					addWarnings(snapshotWarnings, inspected.warnings)
					addWarnings(snapshotWarnings, parsed.rollout.warnings)
					snapshotWarnings.add('invalid-session-metadata-omitted')
					continue
				}

				const warnings = new Set([...inspected.warnings, ...parsed.rollout.warnings])
				const remainingTurns = Math.max(0, this.#limits.maximumTurns - turnsRead)
				let pendingTurns = parsed.rollout.turns
				if (pendingTurns.length > remainingTurns) {
					pendingTurns = pendingTurns.slice(0, remainingTurns)
					warnings.add('turn-limit-reached')
					snapshotWarnings.add('turn-limit-reached')
				}
				turnsRead += pendingTurns.length
				const turns = pendingTurns.map((turn, index): CodexMemoryTurn => ({ index, ...turn }))
				const session: CodexMemorySession = metadata.timestamp
					? { id: metadata.id, timestamp: metadata.timestamp, turns, warnings: [...warnings] }
					: { id: metadata.id, turns, warnings: [...warnings] }
				const previous = sessions.get(session.id)
				if (previous) {
					snapshotWarnings.add('duplicate-session-id-omitted')
					if (compareSessions(session, previous) < 0) {
						sessions.set(session.id, session)
					}
				} else {
					sessions.set(session.id, session)
				}
			} finally {
				await opened.handle.close().catch(() => {})
			}
		}

		const values = [...sessions.values()].sort(compareSessions)
		for (const session of values) {
			addWarnings(snapshotWarnings, session.warnings)
		}
		return {
			sessions: values,
			complete: snapshotWarnings.size === 0,
			warnings: [...snapshotWarnings]
		}
	}

	/** Return one session by exact metadata id; ids are never interpreted as paths or prefixes. */
	async readSession(
		workspaceRoot: string,
		sessionId: string,
		signal: AbortSignal
	): Promise<CodexMemorySession | null> {
		const snapshot = await this.snapshot(workspaceRoot, signal)
		return snapshot.sessions.find((session) => session.id === sessionId) ?? null
	}
}
