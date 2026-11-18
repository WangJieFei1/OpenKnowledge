import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import {
	WorkspaceSelectorBrowseResultSchema,
	WorkspaceSelectorConnectInputSchema
} from './selector-api'

describe('workspace selector browse result', () => {
	test('bounds system error details', () => {
		expect(
			v.safeParse(WorkspaceSelectorBrowseResultSchema, {
				status: 'failed',
				error: { code: 'unexpected', detail: 'x'.repeat(513) }
			}).success
		).toBe(false)
	})

	test('normalizes and confines remote Authorization input', () => {
		expect(
			v.parse(WorkspaceSelectorConnectInputSchema, {
				uri: '  okb://example.test/notes  ',
				authorization: '  Bearer token  '
			})
		).toEqual({ uri: 'okb://example.test/notes', authorization: 'Bearer token' })
		expect(
			v.safeParse(WorkspaceSelectorConnectInputSchema, {
				uri: 'okb://example.test/notes',
				authorization: 'Bearer token\r\nX-Test: value'
			}).success
		).toBe(false)
	})
})
