import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CodexSessionMemory } from './codex-session-memory'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-codex-memory-'))
	temporaryDirectories.push(root)
	return root
}

function record(type: string, payload: unknown, timestamp = '2026-02-03T04:05:06.000Z'): string {
	return JSON.stringify({ timestamp, type, payload })
}

function metadata(id: string, cwd: string, timestamp = '2026-02-03T04:05:06.000Z'): string {
	return record('session_meta', { id, cwd, timestamp }, timestamp)
}

function message(role: string, text: string): string {
	return record('response_item', {
		type: 'message',
		role,
		content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }]
	})
}

async function rollout(root: string, relative: string, lines: string[]): Promise<string> {
	const file = path.join(root, relative)
	await mkdir(path.dirname(file), { recursive: true })
	await writeFile(file, `${lines.join('\n')}\n`)
	return file
}

describe('CodexSessionMemory', () => {
	test('isolates canonical workspace paths, rejects symlinks, and performs exact id reads', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'project')
		const child = path.join(workspace, 'packages', 'app')
		const sibling = path.join(root, 'project-secret')
		const outside = path.join(root, 'outside')
		await Promise.all([
			mkdir(child, { recursive: true }),
			mkdir(sibling),
			mkdir(outside),
			mkdir(sessions)
		])
		await rollout(sessions, '2026/02/rollout-root.jsonl', [
			metadata('allowed-root', workspace),
			message('user', 'Root request.')
		])
		await rollout(sessions, '2026/02/rollout-child.jsonl', [
			metadata('allowed-child', child),
			message('assistant', 'Child answer.')
		])
		await rollout(sessions, '2026/02/rollout-sibling.jsonl', [
			metadata('rejected-sibling', sibling),
			message('user', 'Should not cross the path boundary.')
		])
		const escape = path.join(workspace, 'escape')
		await symlink(outside, escape)
		await rollout(sessions, '2026/02/rollout-cwd-symlink.jsonl', [
			metadata('rejected-cwd-symlink', escape),
			message('user', 'Should not cross through a cwd symlink.')
		])
		const externalRollout = await rollout(root, 'rollout-external.jsonl', [
			metadata('rejected-rollout-symlink', workspace),
			message('user', 'Should not follow a rollout symlink.')
		])
		await symlink(externalRollout, path.join(sessions, 'rollout-linked.jsonl'))

		const memory = new CodexSessionMemory(sessions)
		const snapshot = await memory.snapshot(workspace, new AbortController().signal)
		expect(snapshot.sessions.map(({ id }) => id).sort()).toEqual(['allowed-child', 'allowed-root'])
		expect(
			await memory.readSession(workspace, 'allowed-root', new AbortController().signal)
		).not.toBeNull()
		expect(await memory.readSession(workspace, 'allowed', new AbortController().signal)).toBeNull()
		expect(JSON.stringify(snapshot)).not.toContain('rollout-root.jsonl')
		expect(JSON.stringify(snapshot)).not.toContain('rollout-linked.jsonl')
		expect(JSON.stringify(snapshot)).not.toContain(sessions)
		expect(snapshot.warnings).toContain('symbolic-link-rollout-omitted')
	})

	test('filters by bounded session metadata before charging dialogue bytes', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		const unrelatedWorkspace = path.join(root, 'unrelated')
		await Promise.all([mkdir(sessions), mkdir(workspace), mkdir(unrelatedWorkspace)])
		await rollout(sessions, 'rollout-z-unrelated.jsonl', [
			metadata('unrelated', unrelatedWorkspace),
			message('user', 'Private unrelated dialogue. '.repeat(1000))
		])
		await rollout(sessions, 'rollout-a-authorized.jsonl', [
			metadata('authorized', workspace),
			message('assistant', 'Authorized evidence remains available.')
		])

		const snapshot = await new CodexSessionMemory(sessions, { maximumBytes: 512 }).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(snapshot.sessions).toHaveLength(1)
		expect(snapshot.sessions[0]).toMatchObject({
			id: 'authorized',
			turns: [{ role: 'assistant', text: 'Authorized evidence remains available.' }]
		})
		expect(JSON.stringify(snapshot)).not.toContain('Private unrelated dialogue')
		expect(snapshot.warnings).not.toContain('byte-limit-reached')
	})

	test('omits a rollout when session metadata is outside the bounded header', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		await Promise.all([mkdir(sessions), mkdir(workspace)])
		await rollout(sessions, 'rollout-late-metadata.jsonl', [
			'{}'.repeat(140_000),
			metadata('too-late', workspace),
			message('user', 'Must not be parsed after an unbounded prelude.')
		])

		const snapshot = await new CodexSessionMemory(sessions).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(snapshot.sessions).toEqual([])
		expect(snapshot.warnings).toEqual(
			expect.arrayContaining([
				'invalid-session-metadata-omitted',
				'session-metadata-header-limit-reached'
			])
		)
		expect(snapshot.complete).toBeFalse()
	})

	test('recovers compacted history, filters roles and injected context, and reports gaps', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		await Promise.all([mkdir(sessions), mkdir(workspace)])
		const fixture = await readFile(
			path.join(import.meta.dir, 'fixtures', 'compacted-rollout.jsonl'),
			'utf8'
		)
		await writeFile(
			path.join(sessions, 'rollout-fixture.jsonl'),
			fixture.replace('"__WORKSPACE__"', JSON.stringify(workspace))
		)

		const snapshot = await new CodexSessionMemory(sessions).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(snapshot.sessions).toHaveLength(1)
		const session = snapshot.sessions[0]!
		expect(session.id).toBe('fixture-session')
		expect(session.turns.map(({ role, text }) => ({ role, text }))).toEqual([
			{ role: 'user', text: 'Keep this direct request.' },
			{ role: 'user', text: 'Recovered request.' },
			{ role: 'assistant', text: 'Recovered answer.' },
			{ role: 'user', text: 'Actual user fact.' },
			{ role: 'user', text: 'Before block.\n\nAfter block.' },
			{ role: 'assistant', text: 'Direct answer.' },
			{ role: 'assistant', text: 'Visible addressed answer.' }
		])
		expect(session.turns.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5, 6])
		expect(JSON.stringify(session)).not.toContain('developer bootstrap')
		expect(JSON.stringify(session)).not.toContain('machine secrets')
		expect(JSON.stringify(session)).not.toContain('Injected bootstrap rules')
		expect(JSON.stringify(session)).not.toContain('private permission policy')
		expect(JSON.stringify(session)).not.toContain('tool output')
		expect(JSON.stringify(session)).not.toContain('reasoning')
		expect(JSON.stringify(session)).not.toContain('assistant analysis')
		expect(JSON.stringify(session)).not.toContain('tool-addressed')
		expect(session.warnings).toEqual(
			expect.arrayContaining([
				'malformed-jsonl-line-omitted',
				'compaction-boundary-may-omit-assistant-turn',
				'compacted-history-recovered',
				'encrypted-agent-message-omitted',
				'non-final-agent-message-omitted'
			])
		)
		expect(snapshot.complete).toBeFalse()
	})

	test('deduplicates compacted turns by occurrence count instead of collapsing repeats', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		await Promise.all([mkdir(sessions), mkdir(workspace)])
		const repeated = {
			type: 'message',
			role: 'user',
			content: [{ type: 'input_text', text: 'Again.' }]
		}
		await rollout(sessions, 'rollout-repeat.jsonl', [
			metadata('repeats', workspace),
			message('user', 'Again.'),
			record('compacted', { replacement_history: [repeated, repeated] })
		])

		const snapshot = await new CodexSessionMemory(sessions).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(snapshot.sessions[0]!.turns.map(({ text }) => text)).toEqual(['Again.', 'Again.'])
	})

	test('uses compacted history ordering while matching existing occurrences', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		await Promise.all([mkdir(sessions), mkdir(workspace)])
		const historical = (text: string) => ({
			type: 'message',
			role: 'user',
			content: [{ type: 'input_text', text }]
		})
		await rollout(sessions, 'rollout-order.jsonl', [
			metadata('ordered', workspace),
			message('user', 'First.'),
			message('user', 'Third.'),
			record('compacted', {
				replacement_history: [historical('First.'), historical('Second.'), historical('Third.')]
			})
		])

		const snapshot = await new CodexSessionMemory(sessions).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(snapshot.sessions[0]!.turns.map(({ text }) => text)).toEqual([
			'First.',
			'Second.',
			'Third.'
		])
	})

	test('rejects unsafe ids and drops invalid optional timestamps', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		await Promise.all([mkdir(sessions), mkdir(workspace)])
		await rollout(sessions, 'rollout-invalid-id.jsonl', [
			metadata('../not-an-id', workspace),
			message('user', 'Unsafe id content.')
		])
		await rollout(sessions, 'rollout-valid-id.jsonl', [
			metadata('safe_ID-2', workspace, 'not-an-iso-timestamp'),
			record(
				'response_item',
				{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Safe.' }] },
				'also-not-iso'
			)
		])

		const snapshot = await new CodexSessionMemory(sessions).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(snapshot.sessions).toHaveLength(1)
		expect(snapshot.sessions[0]).toEqual({
			id: 'safe_ID-2',
			turns: [{ index: 0, role: 'assistant', text: 'Safe.' }],
			warnings: []
		})
	})

	test('enforces file, byte, turn, and recursion budgets without exposing source paths', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		await Promise.all([mkdir(sessions), mkdir(workspace)])
		await rollout(sessions, 'z/deep/rollout-many.jsonl', [
			metadata('many-turns', workspace),
			message('user', 'One.'),
			message('assistant', 'Two.'),
			message('user', 'Three.')
		])
		await rollout(sessions, 'a/rollout-second.jsonl', [
			metadata('second-file', workspace),
			message('user', 'Another.')
		])

		const limited = await new CodexSessionMemory(sessions, {
			maximumFiles: 1,
			maximumTurns: 2
		}).snapshot(workspace, new AbortController().signal)
		expect(limited.sessions).toHaveLength(1)
		expect(limited.sessions[0]!.turns).toHaveLength(2)
		expect(limited.warnings).toEqual(
			expect.arrayContaining(['file-limit-reached', 'turn-limit-reached'])
		)

		const byteLimited = await new CodexSessionMemory(sessions, { maximumBytes: 32 }).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(byteLimited.sessions).toEqual([])
		expect(byteLimited.warnings).toContain('byte-limit-reached')

		const depthLimited = await new CodexSessionMemory(sessions, { maximumDepth: 1 }).snapshot(
			workspace,
			new AbortController().signal
		)
		expect(depthLimited.warnings).toContain('directory-depth-limit-reached')
		expect(JSON.stringify({ limited, byteLimited, depthLimited })).not.toContain(sessions)
	})

	test('honors cancellation', async () => {
		const root = await temporaryRoot()
		const sessions = path.join(root, 'sessions')
		const workspace = path.join(root, 'workspace')
		await Promise.all([mkdir(sessions), mkdir(workspace)])
		const controller = new AbortController()
		controller.abort(new DOMException('Cancelled', 'AbortError'))
		await expect(
			new CodexSessionMemory(sessions).snapshot(workspace, controller.signal)
		).rejects.toThrow()
	})
})
