import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type RuntimeModule = typeof import('../electron/semantic/local-search')

function runtimeURL(argument: string | undefined): URL {
	if (!argument) {
		return new URL('../dist-electron/semantic-runtime.mjs', import.meta.url)
	}
	try {
		const url = new URL(argument)
		if (url.protocol === 'file:') {
			return url
		}
	} catch {
		/* Treat non-URL input as a filesystem path. */
	}
	return pathToFileURL(path.resolve(argument))
}

function maximumIndex(values: readonly number[]): number {
	assert.ok(values.length > 0)
	return values.reduce((best, value, index) => (value > values[best]! ? index : best), 0)
}

async function assertMissing(target: string): Promise<void> {
	await assert.rejects(stat(target), (error: unknown) => {
		return error instanceof Error && 'code' in error && error.code === 'ENOENT'
	})
}

const selectedRuntimeURL = runtimeURL(process.argv[2])
const selectedRuntimePath = fileURLToPath(selectedRuntimeURL)
const expectAsar = process.env.OPEN_KNOWLEDGE_SEMANTIC_EXPECT_ASAR === '1'
if (expectAsar) {
	assert.match(selectedRuntimePath, /[\\/]app\.asar[\\/]/)
	assert.ok(
		process.versions.electron,
		'Packaged ASAR smoke must run with the stock Electron binary.'
	)
}

const imported = (await import(selectedRuntimeURL.href)) as RuntimeModule
assert.equal(typeof imported.LocalSemanticSearch, 'function')

// Resolve from the tested runtime rather than this external smoke bundle. In an ASAR run, this
// proves that the JS package is inside app.asar and the native binding exists in app.asar.unpacked.
const runtimeRequire = createRequire(selectedRuntimeURL)
const onnxEntry = runtimeRequire.resolve('onnxruntime-node')
const nativeBinding = path.resolve(
	path.dirname(onnxEntry),
	'..',
	'bin',
	'napi-v6',
	process.platform,
	process.arch,
	'onnxruntime_binding.node'
)
const physicalNativeBinding = expectAsar
	? nativeBinding.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
	: nativeBinding
assert.equal((await stat(physicalNativeBinding)).isFile(), true)
if (expectAsar) {
	assert.match(onnxEntry, /[\\/]app\.asar[\\/]/)
	assert.notEqual(physicalNativeBinding, nativeBinding)
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'open-knowledge-semantic-runtime-'))
const cacheDirectory = path.join(temporaryRoot, 'vectors')
const search = new imported.LocalSemanticSearch(cacheDirectory)
const passages = [
	'The guest can collect the apartment keys from a lockbox after 3 pm.',
	'Bananas are a yellow tropical fruit.',
	'The building includes one free underground parking space.',
	'公寓步行五分钟可到火车站，乘车直达市中心。'
] as const
const query = '客人几点可以办理入住？'
const signal = new AbortController().signal
const manyPassages = Array.from(
	{ length: 256 },
	(_, index) =>
		`Synthetic passage ${index}: ${'bounded local semantic cancellation test. '.repeat(30)}`
)

try {
	console.log('semantic-runtime: cold and queued inference')
	// Two simultaneous calls queue through the production wrapper and share its live process.
	const [cold, queued] = await Promise.all([
		search.rank(query, passages, signal),
		search.rank(query, passages, signal)
	])
	for (const result of [cold, queued]) {
		assert.equal(result.scores.length, passages.length)
		assert.equal(maximumIndex(result.scores), 0)
		assert.match(result.model, /MiniLM/i)
	}
	assert.equal(cold.cacheHits, 0)
	assert.equal(cold.queryCacheHit, false)
	assert.equal(queued.cacheHits, passages.length)
	assert.equal(queued.queryCacheHit, true)

	const cacheFile = path.join(cacheDirectory, 'vectors.json')
	const cached = await readFile(cacheFile, 'utf8')
	for (const passage of passages) {
		assert.equal(cached.includes(passage), false)
	}

	// Abort during warm-model native inference, not only before the request starts. This catches
	// native worker-thread termination crashes that immediate microtask cancellation can miss.
	console.log('semantic-runtime: abort and recover')
	const abortController = new AbortController()
	const abortReason = new Error('semantic-runtime-smoke-abort')
	const aborted = search.rank(
		'Which note discusses transport?',
		manyPassages,
		abortController.signal
	)
	const abortTimer = setTimeout(() => abortController.abort(abortReason), 50)
	await assert.rejects(aborted, (error: unknown) => error === abortReason)
	clearTimeout(abortTimer)

	// A terminated process must be recreated and retain only the completed disk cache.
	const recovered = await search.rank(query, passages, signal)
	assert.equal(maximumIndex(recovered.scores), 0)
	assert.equal(recovered.cacheHits, passages.length)
	assert.equal(recovered.queryCacheHit, false)

	// Clear while inference is active. clear() must stop the writer, await its queue, then remove all
	// derived data without a late process recreating the cache directory.
	console.log('semantic-runtime: clear active inference')
	const inFlight = search.rank('Find the clear test passage.', manyPassages, signal)
	await new Promise<void>((resolve) => setTimeout(resolve, 50))
	const inFlightRejected = assert.rejects(inFlight, /Local semantic inference failed/)
	const cleared = search.clear()
	await Promise.all([inFlightRejected, cleared])
	await assertMissing(cacheDirectory)
	await new Promise<void>((resolve) => setImmediate(resolve))
	await assertMissing(cacheDirectory)

	// clear() is a revocation boundary, not a permanent shutdown.
	console.log('semantic-runtime: restart after clear')
	const afterClear = await search.rank(query, passages, signal)
	assert.equal(maximumIndex(afterClear.scores), 0)
	assert.equal(afterClear.cacheHits, 0)
	assert.equal(afterClear.queryCacheHit, false)
	assert.equal((await stat(path.join(cacheDirectory, 'vectors.json'))).isFile(), true)

	// Close is permanent and rejects later requests synchronously at the wrapper boundary.
	console.log('semantic-runtime: close')
	await search.clear()
	search.close()
	await assert.rejects(search.rank(query, passages, signal), /Local semantic worker unavailable/)

	console.log(
		JSON.stringify(
			{
				offline_model_loaded: true,
				runtime: expectAsar ? 'packaged-asar' : 'dist-electron',
				electron_run_as_node: Boolean(process.versions.electron) && process.type !== 'browser',
				isolation: process.type === 'browser' ? 'electron-utility-process' : 'node-child-process',
				platform: process.platform,
				architecture: process.arch,
				model: cold.model,
				native_binding_resolved: true,
				native_binding_unpacked: expectAsar,
				queue_and_repeat_checked: true,
				abort_and_recovery_checked: true,
				clear_and_restart_checked: true,
				close_checked: true
			},
			null,
			2
		)
	)
} finally {
	search.close()
	await search.clear()
	await rm(temporaryRoot, { recursive: true, force: true })
}
