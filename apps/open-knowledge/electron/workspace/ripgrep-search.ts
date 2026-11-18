import { MessageChannel, Worker } from 'node:worker_threads'
import * as v from 'valibot'
import {
	KnowledgeSearchResultSchema,
	type KnowledgeBundlePath,
	type KnowledgeSearchResult
} from '../../src/lib/knowledge/api'
import { object } from '../validation'

const SEARCH_TIMEOUT_MS = 30_000
const SearchResultSchema = v.union([
	object({ ok: v.literal(true), result: KnowledgeSearchResultSchema }),
	object({ ok: v.literal(false), message: v.string() })
])

export type RipgrepCaseMode = 'smart' | 'sensitive' | 'insensitive'

export type RipgrepSearchOptions = {
	query: string
	caseMode: RipgrepCaseMode
	fixedStrings: boolean
	wholeWord: boolean
	searchPath: KnowledgeBundlePath
	excludeGlobs: readonly string[]
	limit: number
	maximumFileBytes: number
}

export function searchWorkspaceWithRipgrep(
	rootPath: string,
	options: RipgrepSearchOptions,
	signal?: AbortSignal
): Promise<KnowledgeSearchResult> {
	signal?.throwIfAborted()
	const channel = new MessageChannel()
	const searcher = searchWorker()

	return new Promise((resolve, reject) => {
		let settled = false
		function cleanup(): void {
			clearTimeout(timeout)
			channel.port1.close()
			searcher.off('error', failed)
			searcher.off('exit', exited)
			signal?.removeEventListener('abort', aborted)
			void searcher.terminate()
		}
		function failed(error: unknown): void {
			if (settled) {
				return
			}
			settled = true
			cleanup()
			reject(error)
		}
		function exited(code: number): void {
			failed(new Error(`The ripgrep search worker exited before replying (code ${code}).`))
		}
		function aborted(): void {
			failed(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
		}
		const timeout = setTimeout(() => {
			failed(new Error('The ripgrep search timed out.'))
		}, SEARCH_TIMEOUT_MS)
		timeout.unref()
		channel.port1.once('messageerror', failed)
		channel.port1.once('message', (value: unknown) => {
			const parsed = v.safeParse(SearchResultSchema, value)
			if (!parsed.success) {
				failed(new Error('The ripgrep search worker returned an invalid response.'))
				return
			}
			const result = parsed.output
			if (!result.ok) {
				failed(new Error(result.message))
				return
			}
			if (settled) {
				return
			}
			settled = true
			cleanup()
			resolve(result.result)
		})
		searcher.once('error', failed)
		searcher.once('exit', exited)
		signal?.addEventListener('abort', aborted, { once: true })
		channel.port1.start()
		try {
			searcher.postMessage({ rootPath, options, reply: channel.port2 }, [channel.port2])
			if (signal?.aborted) {
				aborted()
			}
		} catch (error) {
			channel.port2.close()
			failed(error)
		}
	})
}

function searchWorker(): Worker {
	const workerURL = new URL(import.meta.url)
	workerURL.pathname = `${workerURL.pathname.slice(0, workerURL.pathname.lastIndexOf('/') + 1)}ripgrep-worker.mjs`
	const created = new Worker(workerURL)
	created.unref()
	created.on('error', (error) => {
		console.error('The ripgrep search worker failed.', error)
	})
	return created
}
