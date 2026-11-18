import * as v from 'valibot'

export const NonArrayObjectSchema = v.custom<Record<string, unknown>>(
	(value) => typeof value === 'object' && value !== null && !Array.isArray(value),
	'Expected an object.'
)

export function object<const TEntries extends v.ObjectEntries>(entries: TEntries) {
	return v.pipe(NonArrayObjectSchema, v.object(entries))
}
