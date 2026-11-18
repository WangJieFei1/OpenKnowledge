import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import { TabTransferInputSchema } from './api'

describe('window API schemas', () => {
	test('rejects UUID versions outside the transfer-token contract', () => {
		expect(
			v.safeParse(TabTransferInputSchema, {
				token: '11111111-1111-0111-8111-111111111111'
			}).success
		).toBe(false)
	})
})
