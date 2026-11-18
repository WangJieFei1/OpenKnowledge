import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Tokenizer } from '@huggingface/tokenizers'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { semanticModel } from './model'
import { SemanticVectorCache } from './vector-cache'

function normalize(vector: number[]): number[] {
	const norm = Math.hypot(...vector)
	if (!Number.isFinite(norm) || norm === 0) {
		throw new Error('Invalid semantic vector.')
	}
	return vector.map((value) => value / norm)
}

export class LocalSemanticEngine {
	private readonly queries = new Map<string, number[]>()
	private constructor(
		private readonly tokenizer: Tokenizer,
		private readonly session: InferenceSession,
		private readonly cache: SemanticVectorCache
	) {}

	static async open(assetsDirectory: string, cacheDirectory: string): Promise<LocalSemanticEngine> {
		const assets = await Promise.all(
			semanticModel.files.map(async (file) => {
				const bytes = await readFile(path.join(assetsDirectory, file.name))
				if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
					throw new Error('Local semantic model integrity check failed.')
				}
				return bytes
			})
		)
		const tokenizer = new Tokenizer(
			JSON.parse(assets[1]!.toString()),
			JSON.parse(assets[2]!.toString())
		)
		const session = await InferenceSession.create(assets[0]!, {
			executionProviders: ['cpu'],
			intraOpNumThreads: 2,
			interOpNumThreads: 1,
			graphOptimizationLevel: 'all',
			logSeverityLevel: 3
		})
		const cache = new SemanticVectorCache(cacheDirectory)
		await cache.load()
		return new LocalSemanticEngine(tokenizer, session, cache)
	}

	private async embed(text: string): Promise<number[][]> {
		// MiniLM is trained without task prefixes and with a 128-token window.
		// Overlapping windows retain long paragraphs without silently truncating them.
		const body = this.tokenizer.encode(text, { add_special_tokens: false }).ids
		const windows: number[][] = []
		for (let start = 0; start < Math.max(1, body.length); start += semanticModel.windowStride) {
			const ids = [0, ...body.slice(start, start + semanticModel.windowTokens), 2]
			const shape = [1, ids.length]
			const output = await this.session.run({
				input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), shape),
				token_type_ids: new Tensor('int64', new BigInt64Array(ids.length), shape),
				attention_mask: new Tensor('int64', new BigInt64Array(ids.length).fill(1n), shape)
			})
			const tensor = output.last_hidden_state
			if (!tensor || tensor.dims.length !== 3 || tensor.dims[2] !== semanticModel.dimensions) {
				throw new Error('Unexpected local embedding output.')
			}
			const values = tensor.data
			const pooled = Array<number>(semanticModel.dimensions).fill(0)
			for (let token = 0; token < ids.length; token++) {
				for (let index = 0; index < pooled.length; index++) {
					pooled[index] =
						pooled[index]! + Number(values[token * pooled.length + index]!) / ids.length
				}
			}
			windows.push(normalize(pooled))
			for (const tensor of Object.values(output)) {
				tensor.dispose()
			}
			if (start + semanticModel.windowTokens >= body.length) {
				break
			}
		}
		return windows
	}

	async rank(query: string, passages: readonly string[]) {
		const queryKey = createHash('sha256').update(query).digest('hex')
		let queryVector = this.queries.get(queryKey)
		const queryCacheHit = queryVector !== undefined
		if (!queryVector) {
			const windows = await this.embed(query)
			queryVector = normalize(
				windows[0]!.map((_, index) => windows.reduce((sum, vector) => sum + vector[index]!, 0))
			)
		}
		this.queries.delete(queryKey)
		this.queries.set(queryKey, queryVector)
		while (this.queries.size > 64) {
			this.queries.delete(this.queries.keys().next().value!)
		}
		let cacheHits = 0
		const scores: number[] = []
		for (const passage of passages) {
			const key = this.cache.key(passage)
			let vectors = this.cache.get(key)
			if (vectors) {
				cacheHits++
			} else {
				vectors = await this.embed(passage)
				this.cache.set(key, vectors)
				// Checkpoint progress so cancellation/timeouts can reuse finished passages.
				if ((scores.length + 1) % 32 === 0) {
					await this.cache.save()
				}
			}
			scores.push(
				Math.max(
					-1,
					Math.min(
						1,
						Math.max(
							...vectors.map((vector) =>
								vector.reduce((sum, value, index) => sum + value * queryVector[index]!, 0)
							)
						)
					)
				)
			)
		}
		await this.cache.save()
		return {
			scores,
			model: semanticModel.id,
			cacheHits,
			queryCacheHit,
			minimumScore: semanticModel.minimumScore,
			maximumScoreDrop: semanticModel.maximumScoreDrop
		}
	}

	async close(): Promise<void> {
		await this.session.release()
	}
}
