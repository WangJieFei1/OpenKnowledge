import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { semanticModel } from './model'

const maximumVectors = 2048
const maximumCacheBytes = 32 * 1024 * 1024
const cacheFileName = 'vectors.json'
const pendingFileName = 'vectors.pending'
const fingerprint = `${semanticModel.id}:${semanticModel.revision}:mean-normalized:${semanticModel.windowTokens}:${semanticModel.windowStride}`
type Vectors = number[][]

function validVectors(value: unknown): value is Vectors {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= 256 &&
		value.every(
			(vector: unknown) =>
				Array.isArray(vector) &&
				vector.length === semanticModel.dimensions &&
				vector.every(
					(element: unknown) =>
						typeof element === 'number' && Number.isFinite(element) && Math.abs(element) <= 1
				) &&
				Math.abs(vector.reduce((sum: number, element: number) => sum + element * element, 0) - 1) <
					0.01
		)
	)
}

/** A disposable, bounded acceleration cache. It stores no text, paths, or queries. */
export class SemanticVectorCache {
	private readonly entries = new Map<string, Vectors>()
	private vectorCount = 0
	private dirty = false
	constructor(private readonly directory: string) {}

	async load(): Promise<void> {
		try {
			const directory = await lstat(this.directory)
			if (!directory.isDirectory() || directory.isSymbolicLink()) {
				return
			}
			// A killed inference process can leave only this fixed, non-sensitive staging file.
			// LocalSemanticSearch waits for the old process to exit before opening a replacement.
			await rm(path.join(this.directory, pendingFileName), { force: true })
			const file = path.join(this.directory, cacheFileName)
			const stat = await lstat(file)
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumCacheBytes) {
				return
			}
			const data: unknown = JSON.parse(await readFile(file, 'utf8'))
			if (
				!data ||
				typeof data !== 'object' ||
				!('fingerprint' in data) ||
				data.fingerprint !== fingerprint ||
				!('entries' in data) ||
				!Array.isArray(data.entries) ||
				data.entries.length > maximumVectors
			) {
				return
			}
			for (const entry of data.entries) {
				if (
					!Array.isArray(entry) ||
					entry.length !== 2 ||
					typeof entry[0] !== 'string' ||
					!/^[a-f0-9]{64}$/.test(entry[0]) ||
					!validVectors(entry[1])
				) {
					continue
				}
				this.set(entry[0], entry[1])
			}
			this.dirty = false
		} catch {
			/* Missing or corrupt caches rebuild from current authorized sources. */
		}
	}

	key(text: string): string {
		return createHash('sha256').update(fingerprint).update('\0').update(text).digest('hex')
	}

	get(key: string): Vectors | undefined {
		const value = this.entries.get(key)
		if (value) {
			this.entries.delete(key)
			this.entries.set(key, value)
		}
		return value
	}

	set(key: string, vectors: Vectors): void {
		if (!validVectors(vectors)) {
			throw new Error('Invalid semantic embedding.')
		}
		this.vectorCount -= this.entries.get(key)?.length ?? 0
		this.entries.delete(key)
		this.entries.set(key, vectors)
		this.vectorCount += vectors.length
		while (this.vectorCount > maximumVectors) {
			const oldest = this.entries.entries().next().value!
			this.vectorCount -= oldest[1].length
			this.entries.delete(oldest[0])
		}
		this.dirty = true
	}

	async save(): Promise<void> {
		if (!this.dirty) {
			return
		}
		const temporary = path.join(this.directory, pendingFileName)
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 })
			const stat = await lstat(this.directory)
			if (!stat.isDirectory() || stat.isSymbolicLink()) {
				return
			}
			await chmod(this.directory, 0o700)
			const json = JSON.stringify({ fingerprint, entries: [...this.entries] })
			if (Buffer.byteLength(json) > maximumCacheBytes) {
				return
			}
			await writeFile(temporary, json, { flag: 'wx', mode: 0o600 })
			await rename(temporary, path.join(this.directory, cacheFileName))
			this.dirty = false
		} catch {
			/* A read-only or full cache disk must not break retrieval. */
		} finally {
			await rm(temporary, { force: true }).catch(() => {})
		}
	}
}
