import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import os from 'node:os'
import { CodexSessionMemory } from './codex-session-memory'
import { createSessionMemory } from './session-memory-provider'
import { createSessionMemory as createGeneralSessionMemory } from './no-session-memory-provider'

describe('edition session memory providers', () => {
	test('the Codex provider requires an explicit sessions root', () => {
		expect(createSessionMemory()).toBeUndefined()
		expect(createSessionMemory(path.join(os.tmpdir(), 'synthetic-codex-sessions'))).toBeInstanceOf(
			CodexSessionMemory
		)
	})

	test('the General provider has no memory capability even when given a sessions root', () => {
		expect(createGeneralSessionMemory()).toBeUndefined()
		expect(
			createGeneralSessionMemory(path.join(os.tmpdir(), 'synthetic-codex-sessions'))
		).toBeUndefined()
	})
})
