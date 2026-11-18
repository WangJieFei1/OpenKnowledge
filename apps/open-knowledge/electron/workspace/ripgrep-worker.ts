import { MessagePort, parentPort } from 'node:worker_threads'
import * as v from 'valibot'
import { isKnowledgeBundlePath, type KnowledgeBundlePath } from '../../src/lib/knowledge/api'
import { errorMessage, object } from '../validation'
import { searchWorkspaceWithRipgrep } from './ripgrep-runtime'

const maximumGlobCharacters = 256
const maximumGlobs = 16
const invalidQueryMessage = 'A non-empty search query without NUL is required.'
const invalidGlobMessage = 'Search globs must be non-empty, bounded strings without NUL.'
const RipgrepSearchOptionsSchema = object({
	query: v.pipe(
		v.string(invalidQueryMessage),
		v.check((value) => Boolean(value.trim()) && !value.includes('\0'), invalidQueryMessage)
	),
	limit: positiveIntegerSchema('The search result limit must be a positive integer.'),
	maximumFileBytes: positiveIntegerSchema(
		'The maximum search file size must be a positive integer.'
	),
	searchPath: v.custom<KnowledgeBundlePath>(
		isKnowledgeBundlePath,
		'The search path must be a canonical absolute bundle path.'
	),
	excludeGlobs: v.pipe(
		v.array(
			v.pipe(
				v.string(invalidGlobMessage),
				v.nonEmpty(invalidGlobMessage),
				v.maxLength(maximumGlobCharacters, invalidGlobMessage),
				v.check((value) => !value.includes('\0') && !value.startsWith('!'), invalidGlobMessage)
			)
		),
		v.maxLength(maximumGlobs, `At most ${maximumGlobs} search globs are supported.`)
	),
	caseMode: v.picklist(['smart', 'sensitive', 'insensitive']),
	fixedStrings: v.boolean(),
	wholeWord: v.boolean()
})
const SearchRequestSchema = object({
	rootPath: v.string(),
	options: RipgrepSearchOptionsSchema,
	reply: v.instance(MessagePort)
})

let searchTail = Promise.resolve()

parentPort?.on('message', (value: unknown) => {
	const { rootPath, options, reply } = v.parse(SearchRequestSchema, value)
	const search = searchTail.then(() => searchWorkspaceWithRipgrep(rootPath, options))
	searchTail = search.then(
		() => undefined,
		() => undefined
	)
	void search
		.then((result) => reply.postMessage({ ok: true, result }))
		.catch((error: unknown) =>
			reply.postMessage({
				ok: false,
				message: errorMessage(error) ?? String(error)
			})
		)
		.finally(() => reply.close())
})

function positiveIntegerSchema(message: string) {
	return v.pipe(v.number(message), v.safeInteger(message), v.minValue(1, message))
}
