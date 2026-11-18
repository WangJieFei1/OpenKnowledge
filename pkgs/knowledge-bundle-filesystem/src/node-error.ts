import * as v from 'valibot'

const NodeErrorSchema = v.object({ code: v.string() })

export function nodeErrorCode(error: unknown): string | undefined {
	const result = v.safeParse(NodeErrorSchema, error)
	return result.success ? result.output.code : undefined
}
