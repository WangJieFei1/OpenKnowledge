import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'
import type { KnowledgeBundleMCPSemanticRanker } from '@open-knowledge/knowledge-bundle-mcp'
import { InferenceProcess } from './inference-process'

const responseSchema = v.object({
	ok: v.literal(true),
	result: v.object({
		scores: v.array(v.pipe(v.number(), v.finite(), v.minValue(-1), v.maxValue(1))),
		model: v.pipe(v.string(), v.maxLength(100)),
		cacheHits: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
		minimumScore: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
		maximumScoreDrop: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
		queryCacheHit: v.boolean()
	})
})

/** One isolated CPU process per gateway, with bounded queuing and cancellation. */
export class LocalSemanticSearch {
	private worker: InferenceProcess | undefined
	private readonly terminatingWorkers = new Set<Promise<number>>()
	private idle: ReturnType<typeof setTimeout> | undefined
	private tail = Promise.resolve()
	private pending = 0
	private closed = false
	private clearing = false
	private generation = 0
	constructor(private readonly cacheDirectory: string) {}

	rank: KnowledgeBundleMCPSemanticRanker = async (query, passages, signal) => {
		if (this.closed || this.clearing || this.pending >= 4) {
			throw new Error('Local semantic worker unavailable.')
		}
		this.pending++
		const generation = this.generation
		const previous = this.tail
		let release!: () => void
		this.tail = new Promise<void>((resolve) => {
			release = resolve
		})
		try {
			await previous
			// Do not let a cancelled process overlap the next writer to this cache.
			await Promise.all(this.terminatingWorkers)
			signal.throwIfAborted()
			if (this.closed || generation !== this.generation) {
				throw new Error('Local semantic worker closed.')
			}
			clearTimeout(this.idle)
			// Resolve the packaged entry without Vite treating it as a browser worker.
			const workerURL = new URL(import.meta.url)
			workerURL.pathname = workerURL.pathname.replace(/[^/]+$/, 'semantic-worker.mjs')
			const assetsURL = new URL(workerURL)
			assetsURL.pathname = assetsURL.pathname.replace(/[^/]+$/, 'semantic-assets/')
			if (!this.worker) {
				const created = new InferenceProcess(
					workerURL,
					fileURLToPath(assetsURL),
					this.cacheDirectory
				)
				// Keep idle worker errors from becoming unhandled process errors.
				created.on('error', () => {})
				created.once('exit', () => {
					if (this.worker === created) {
						this.worker = undefined
					}
				})
				this.worker = created
			}
			const worker = this.worker
			return await new Promise<Awaited<ReturnType<KnowledgeBundleMCPSemanticRanker>>>(
				(resolve, reject) => {
					const cleanup = () => {
						clearTimeout(timeout)
						signal.removeEventListener('abort', abort)
						worker.off('error', failed)
						worker.off('exit', exited)
						worker.off('message', received)
					}
					const failed = () => {
						cleanup()
						this.stopWorker()
						reject(new Error('Local semantic inference failed.'))
					}
					const abort = () => {
						cleanup()
						this.stopWorker()
						reject(signal.reason)
					}
					const exited = () => failed()
					const timeout = setTimeout(failed, 45_000)
					worker.once('error', failed)
					worker.once('exit', exited)
					signal.addEventListener('abort', abort, { once: true })
					const received = (message: unknown) => {
						const parsed = v.safeParse(responseSchema, message)
						if (!parsed.success || parsed.output.result.scores.length !== passages.length) {
							failed()
							return
						}
						cleanup()
						resolve(parsed.output.result)
					}
					worker.once('message', received)
					try {
						worker.postMessage({ query, passages })
					} catch {
						failed()
					}
				}
			)
		} finally {
			this.pending--
			release()
			if (!this.closed && !this.clearing) {
				this.idle = setTimeout(() => void this.stopWorker(), 120_000)
				this.idle.unref()
			}
		}
	}

	private async stopWorker(): Promise<void> {
		clearTimeout(this.idle)
		const worker = this.worker
		this.worker = undefined
		if (!worker) {
			return
		}
		const terminated = worker.terminate()
		this.terminatingWorkers.add(terminated)
		try {
			await terminated
		} finally {
			this.terminatingWorkers.delete(terminated)
		}
	}

	/** Stop in-flight writers before removing derived data after authorization changes. */
	async clear(): Promise<void> {
		this.clearing = true
		this.generation++
		try {
			await this.stopWorker()
			// A previously aborted worker may still be exiting after releasing the request queue.
			await Promise.all(this.terminatingWorkers)
			await this.tail
			await rm(this.cacheDirectory, { recursive: true, force: true })
		} finally {
			this.clearing = false
		}
	}

	close(): void {
		this.closed = true
		void this.stopWorker()
	}
}
