import { describe, expect, test } from 'bun:test'
import { parseNumberInput } from './property-input'

describe('property input parsing', () => {
	test('accepts safe whole numbers only', () => {
		expect(parseNumberInput('-42')).toEqual({ ok: true, value: -42 })
		expect(parseNumberInput('')).toEqual({ ok: false, message: 'numberRequired' })
		expect(parseNumberInput('1.5')).toEqual({ ok: false, message: 'safeIntegerRequired' })
		expect(parseNumberInput('01')).toEqual({ ok: false, message: 'safeIntegerRequired' })
		expect(parseNumberInput('9007199254740992')).toEqual({
			ok: false,
			message: 'safeIntegerRequired'
		})
	})
})
