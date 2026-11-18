import * as v from 'valibot'

const NonArrayObjectSchema = v.custom<Record<string, unknown>>(
	(value) => typeof value === 'object' && value !== null && !Array.isArray(value),
	'Expected an object.'
)

export const UUIDSchema = v.pipe(
	v.string(),
	v.regex(
		/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/
	)
)

export const NonBlankStringSchema = v.pipe(
	v.string(),
	v.check((value) => Boolean(value.trim()))
)

export function object<const TEntries extends v.ObjectEntries>(entries: TEntries) {
	return v.pipe(NonArrayObjectSchema, v.object(entries))
}

export function strictObject<const TEntries extends v.ObjectEntries>(entries: TEntries) {
	return v.pipe(NonArrayObjectSchema, v.strictObject(entries))
}

const ErrorMessageSchema = v.union([
	v.string(),
	v.pipe(
		object({ message: v.string() }),
		v.transform(({ message }) => message)
	)
])

export function errorMessage(error: unknown): string {
	const result = v.safeParse(ErrorMessageSchema, error)
	return result.success ? result.output : ''
}
