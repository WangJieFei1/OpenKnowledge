import { toStandardJsonSchema } from '@valibot/to-json-schema'
import type { GenericSchema } from 'valibot'

const runtimeOnlyActions = ['check', 'max_bytes', 'trim']

/** Adds MCP JSON Schema conversion while retaining Valibot runtime checks. */
export function mcpSchema<TSchema extends GenericSchema>(schema: TSchema) {
	const standardSchema = toStandardJsonSchema(schema)
	const { jsonSchema } = standardSchema['~standard']
	const wrapped: typeof standardSchema = {
		'~standard': {
			...standardSchema['~standard'],
			jsonSchema: {
				input: (options) =>
					jsonSchema.input({
						...options,
						libraryOptions: { ...options.libraryOptions, ignoreActions: runtimeOnlyActions }
					}),
				output: (options) =>
					jsonSchema.output({
						...options,
						libraryOptions: { ...options.libraryOptions, ignoreActions: runtimeOnlyActions }
					})
			}
		}
	}
	return wrapped
}
