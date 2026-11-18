import { Buffer } from 'node:buffer'
import { lstatSync } from 'node:fs'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import type { RgArg } from 'ripgrep'
import * as v from 'valibot'
import {
	isKnowledgeBundlePath,
	maximumKnowledgeSearchPreviewCharacters,
	type KnowledgeBundlePath,
	type KnowledgeSearchMatch,
	type KnowledgeSearchResult
} from '../../src/lib/knowledge/api'
import { object } from '../validation'
import { getCompressedBytes } from '../../node_modules/ripgrep/lib/_rg.wasm.mjs'
import { createWasi } from '../../node_modules/ripgrep/lib/_wasi.mjs'
import type { RipgrepSearchOptions } from './ripgrep-search'

const maximumSearchFiles = 10_000
const maximumStderrBytes = 8 * 1_024
const ignoredDirectoryNames = new Set(['.git', '.open-knowledge', 'node_modules'])
const RipgrepMatchEventSchema = object({
	type: v.literal('match'),
	data: object({
		path: object({ text: v.string() }),
		lines: object({ text: v.string() }),
		line_number: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
		submatches: v.pipe(
			v.array(
				object({
					start: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
					match: object({ text: v.string() })
				})
			),
			v.minLength(1)
		)
	})
})
let wasmModule: Promise<WebAssembly.Module> | undefined

class RipgrepSearchError extends Error {
	override readonly name = 'RipgrepSearchError'
}

export async function searchWorkspaceWithRipgrep(
	rootPath: string,
	options: RipgrepSearchOptions
): Promise<KnowledgeSearchResult> {
	const files = new RipgrepFilePaths(rootPath, options.searchPath, options.maximumFileBytes)
	const discoveryStderr = new BoundedTextWriter(maximumStderrBytes)
	const discovery = await runRipgrep(ripgrepFileArguments(options), {
		stdout: files,
		stderr: discoveryStderr,
		preopens: { '.': rootPath }
	})
	files.finish()
	if (discovery.code !== 0 && discovery.code !== 1) {
		const message = discoveryStderr.text().trim()
		if (isEmptySearchMessage(message)) {
			return { matches: [], truncated: false }
		}
		throw new RipgrepSearchError(message || 'Ripgrep could not inspect the workspace.')
	}
	if (files.values.length === 0) {
		return { matches: [], truncated: files.truncated }
	}

	const matches = new RipgrepJSONMatches(options.limit)
	const stderr = new BoundedTextWriter(maximumStderrBytes)
	const result = await runRipgrep(ripgrepSearchArguments(options, files.values), {
		stdout: matches,
		stderr,
		preopens: { '.': rootPath }
	})
	matches.finish()

	if (result.code !== 0 && result.code !== 1) {
		const message = stderr.text().trim()
		if (isEmptySearchMessage(message)) {
			return { matches: [], truncated: false }
		}
		throw new RipgrepSearchError(message || 'Ripgrep could not search the workspace.')
	}
	return { matches: matches.values, truncated: files.truncated || matches.truncated }
}

function isEmptySearchMessage(message: string): boolean {
	return (
		message.startsWith('rg: No files were searched') ||
		message.endsWith('No such file or directory (os error 44)')
	)
}

async function runRipgrep(
	args: readonly RgArg[],
	options: {
		stdout: { write(chunk: Uint8Array | Buffer): void }
		stderr: { write(chunk: Uint8Array | Buffer): void }
		preopens: Record<string, string>
	}
): Promise<{ code: number }> {
	const wasi = createWasi({
		args: ['rg', ...args],
		...options,
		env: {},
		returnOnExit: true
	})
	const wasm = await trustedWasmModule()
	const instance = await WebAssembly.instantiate(wasm, wasi.imports)
	return { code: await wasi.start(instance) }
}

function trustedWasmModule(): Promise<WebAssembly.Module> {
	return (wasmModule ??= WebAssembly.compile(brotliDecompressSync(getCompressedBytes())))
}

function ripgrepFileArguments(options: RipgrepSearchOptions): RgArg[] {
	return [
		'--files',
		'--null',
		'--hidden',
		'--no-follow',
		'--no-require-git',
		'--sort=path',
		'--threads=1',
		'--type-add=openknowledge:*.[mM][dD]',
		'--type=openknowledge',
		...options.excludeGlobs.map((glob) => `--glob=!${glob}`),
		'--glob=!.git',
		'--glob=!.git/**',
		'--glob=!.open-knowledge',
		'--glob=!.open-knowledge/**',
		'--glob=!node_modules',
		'--glob=!node_modules/**',
		'--',
		'.'
	]
}

function ripgrepSearchArguments(
	options: RipgrepSearchOptions,
	files: readonly KnowledgeBundlePath[]
): RgArg[] {
	const caseArgument =
		options.caseMode === 'sensitive'
			? '--case-sensitive'
			: options.caseMode === 'insensitive'
				? '--ignore-case'
				: '--smart-case'
	return [
		'--json',
		'--color=never',
		'--no-follow',
		'--sort=path',
		'--threads=1',
		`--max-count=${options.limit + 1}`,
		`--max-columns=${maximumKnowledgeSearchPreviewCharacters}`,
		'--max-columns-preview',
		`--max-filesize=${options.maximumFileBytes}`,
		caseArgument,
		...(options.fixedStrings ? (['--fixed-strings'] as const) : []),
		...(options.wholeWord ? (['--word-regexp'] as const) : []),
		`--regexp=${options.query}`,
		'--',
		...files.map((file) => `.${file}`)
	]
}

class RipgrepFilePaths {
	readonly values: KnowledgeBundlePath[] = []
	truncated = false
	private readonly decoder = new TextDecoder()
	private readonly rootDevice: bigint
	private pending = ''

	constructor(
		private readonly rootPath: string,
		private readonly searchPath: KnowledgeBundlePath,
		private readonly maximumFileBytes: number
	) {
		const root = lstatSync(rootPath, { bigint: true })
		if (!root.isDirectory() || root.isSymbolicLink()) {
			throw new RipgrepSearchError('The workspace root is unavailable.')
		}
		this.rootDevice = root.dev
	}

	write(chunk: Uint8Array | Buffer): void {
		this.pending += this.decoder.decode(chunk, { stream: true })
		this.consumeCompletePaths()
	}

	finish(): void {
		this.pending += this.decoder.decode()
		this.consumeCompletePaths()
	}

	private consumeCompletePaths(): void {
		let separator = this.pending.indexOf('\0')
		while (separator >= 0) {
			const candidate = this.pending.slice(0, separator)
			this.pending = this.pending.slice(separator + 1)
			this.consumePath(candidate)
			separator = this.pending.indexOf('\0')
		}
	}

	private consumePath(candidate: string): void {
		const candidatePath = bundlePath(candidate)
		if (!candidatePath || !isPathWithin(candidatePath, this.searchPath)) {
			return
		}
		try {
			const stats = lstatSync(path.join(this.rootPath, ...candidatePath.slice(1).split('/')), {
				bigint: true
			})
			if (
				!stats.isFile() ||
				stats.isSymbolicLink() ||
				stats.nlink !== 1n ||
				stats.dev !== this.rootDevice ||
				stats.size > BigInt(this.maximumFileBytes)
			) {
				return
			}
		} catch {
			return
		}
		if (this.values.length >= maximumSearchFiles) {
			this.truncated = true
			return
		}
		this.values.push(candidatePath)
	}
}

function isPathWithin(candidate: KnowledgeBundlePath, scope: KnowledgeBundlePath): boolean {
	return scope === '/' || candidate === scope || candidate.startsWith(`${scope}/`)
}

class RipgrepJSONMatches {
	readonly values: KnowledgeSearchMatch[] = []
	truncated = false
	private readonly decoder = new TextDecoder()
	private pending = ''
	private parseError: Error | undefined

	constructor(private readonly limit: number) {}

	write(chunk: Uint8Array | Buffer): void {
		if (this.truncated) {
			return
		}
		this.pending += this.decoder.decode(chunk, { stream: true })
		this.consumeCompleteLines()
	}

	finish(): void {
		if (!this.truncated) {
			this.pending += this.decoder.decode()
			if (this.pending) {
				this.consumeLine(this.pending)
			}
		}
		if (this.parseError) {
			throw this.parseError
		}
	}

	private consumeCompleteLines(): void {
		let separator = this.pending.indexOf('\n')
		while (separator >= 0) {
			const line = this.pending.slice(0, separator)
			this.pending = this.pending.slice(separator + 1)
			this.consumeLine(line)
			if (this.truncated) {
				this.pending = ''
				return
			}
			separator = this.pending.indexOf('\n')
		}
	}

	private consumeLine(line: string): void {
		if (!line) {
			return
		}
		let event: unknown
		try {
			event = JSON.parse(line)
		} catch {
			this.parseError = new RipgrepSearchError('Ripgrep returned malformed search output.')
			return
		}
		const match = ripgrepMatch(event)
		if (!match) {
			return
		}
		if (this.values.length >= this.limit) {
			this.truncated = true
			return
		}
		this.values.push(match)
	}
}

class BoundedTextWriter {
	private readonly chunks: Buffer[] = []
	private byteLength = 0

	constructor(private readonly maximumBytes: number) {}

	write(chunk: Uint8Array | Buffer): void {
		if (this.byteLength >= this.maximumBytes) {
			return
		}
		const buffer = Buffer.from(chunk)
		const accepted = buffer.subarray(0, this.maximumBytes - this.byteLength)
		this.chunks.push(Buffer.from(accepted))
		this.byteLength += accepted.byteLength
	}

	text(): string {
		return Buffer.concat(this.chunks).toString('utf8')
	}
}

function ripgrepMatch(event: unknown): KnowledgeSearchMatch | null {
	const result = v.safeParse(RipgrepMatchEventSchema, event)
	if (!result.success) {
		return null
	}
	const { data } = result.output
	const first = data.submatches[0]!
	const path = bundlePath(data.path.text)
	if (!path) {
		return null
	}
	const line = removeLineEnding(data.lines.text)
	return {
		path,
		lineNumber: data.line_number,
		columnNumber: first.start + 1,
		preview: truncate(line, maximumKnowledgeSearchPreviewCharacters),
		match: truncate(first.match.text, maximumKnowledgeSearchPreviewCharacters)
	}
}

function bundlePath(candidate: string): KnowledgeBundlePath | null {
	let relativePath = candidate
	while (relativePath.startsWith('./')) {
		relativePath = relativePath.slice(2)
	}
	if (
		!relativePath ||
		relativePath.startsWith('/') ||
		relativePath.includes('\\') ||
		relativePath
			.split('/')
			.some(
				(segment) =>
					ignoredDirectoryNames.has(segment) ||
					(segment.includes('.open-knowledge-') && segment.endsWith('.tmp'))
			)
	) {
		return null
	}
	const absolutePath = `/${relativePath}`
	return isKnowledgeBundlePath(absolutePath) ? absolutePath : null
}

function removeLineEnding(value: string): string {
	return value.endsWith('\r\n')
		? value.slice(0, -2)
		: value.endsWith('\n')
			? value.slice(0, -1)
			: value
}

function truncate(value: string, maximumCharacters: number): string {
	if (value.length <= maximumCharacters) {
		return value
	}
	let end = maximumCharacters - 3
	if (/^[\uDC00-\uDFFF]$/.test(value[end] ?? '')) {
		end -= 1
	}
	return `${value.slice(0, end)}...`
}
