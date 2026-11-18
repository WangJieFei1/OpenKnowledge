import * as v from 'valibot'

const NonArrayObjectSchema = v.custom<Record<string, unknown>>(
	(value) => typeof value === 'object' && value !== null && !Array.isArray(value),
	'Expected an object.'
)

export const PlainRecordSchema = v.custom<Record<string, unknown>>(isPlainRecord)

export const UnknownRecordSchema = v.pipe(PlainRecordSchema, v.record(v.string(), v.unknown()))

export const UUIDSchema = v.pipe(
	v.string(),
	v.regex(
		/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/
	)
)

const ErrorMessageSchema = v.union([
	v.string(),
	v.pipe(
		v.object({ message: v.string() }),
		v.transform(({ message }) => message)
	)
])
const NodeErrorSchema = v.object({ code: v.string() })

export function object<const TEntries extends v.ObjectEntries>(entries: TEntries) {
	return v.pipe(NonArrayObjectSchema, v.object(entries))
}

export function strictObject<const TEntries extends v.ObjectEntries>(entries: TEntries) {
	return v.pipe(NonArrayObjectSchema, v.strictObject(entries))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null) {
		return false
	}
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

export function errorMessage(error: unknown): string | undefined {
	const result = v.safeParse(ErrorMessageSchema, error)
	return result.success ? result.output : undefined
}

export function nodeErrorCode(error: unknown): string | undefined {
	const result = v.safeParse(NodeErrorSchema, error)
	return result.success ? result.output.code : undefined
}
