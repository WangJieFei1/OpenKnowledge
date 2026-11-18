import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { semanticModel } from '../electron/semantic/model'

const root = fileURLToPath(new URL('../', import.meta.url))
const cache = path.join(root, '.cache', 'semantic-assets')
const require = createRequire(import.meta.url)

/** Explicit build-time download with pinned revisions and SHA-256 verification. */
export async function prepareSemanticAssets(): Promise<void> {
	await mkdir(cache, { recursive: true })
	for (const file of semanticModel.files) {
		const target = path.join(cache, file.name)
		const existing = await readFile(target).catch(() => undefined)
		if (existing && createHash('sha256').update(existing).digest('hex') === file.sha256) {
			continue
		}
		console.info(`Preparing bundled local search model: ${file.name}`)
		const url = `https://huggingface.co/${semanticModel.repository}/resolve/${semanticModel.revision}/${file.remote}`
		const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
		if (!response.ok) {
			throw new Error(`Semantic model download failed: HTTP ${response.status}`)
		}
		const bytes = Buffer.from(await response.arrayBuffer())
		if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
			throw new Error(`Semantic model SHA-256 mismatch: ${file.name}`)
		}
		await writeFile(`${target}.tmp`, bytes)
		await rename(`${target}.tmp`, target)
	}
}

/** Keep native ORT external to the JS bundle, with only the host architecture. */
export async function stageSemanticAssets(): Promise<void> {
	const destination = path.join(root, 'dist-electron')
	await mkdir(destination, { recursive: true })
	await cp(cache, path.join(destination, 'semantic-assets'), {
		recursive: true,
		filter: (source) => !source.endsWith('.tmp')
	})
	await cp(
		path.resolve(path.dirname(require.resolve('@huggingface/tokenizers')), '../LICENSE'),
		path.join(destination, 'semantic-assets', 'tokenizers-LICENSE.txt')
	)
	await cp(
		path.join(root, 'resources', 'semantic-model-NOTICE.txt'),
		path.join(destination, 'semantic-assets', 'NOTICE.txt')
	)
	for (const name of ['onnxruntime-node', 'onnxruntime-common']) {
		const nodeEntry = require.resolve('onnxruntime-node')
		const source =
			name === 'onnxruntime-node'
				? path.resolve(path.dirname(nodeEntry), '..')
				: path.resolve(
						path.dirname(createRequire(nodeEntry).resolve('onnxruntime-common')),
						'../..'
					)
		const target = path.join(destination, 'node_modules', name)
		await rm(target, { force: true, recursive: true })
		await mkdir(target, { recursive: true })
		for (const file of ['package.json', 'README.md', 'dist']) {
			await cp(path.join(source, file), path.join(target, file), {
				recursive: true,
				filter: (entry) => !entry.endsWith('.map') && !entry.endsWith('.ts')
			})
		}
		await cp(path.join(root, 'resources', 'onnxruntime-LICENSE.txt'), path.join(target, 'LICENSE'))
		if (name === 'onnxruntime-node') {
			const native = path.join('bin', 'napi-v6', process.platform, process.arch)
			await cp(path.join(source, native), path.join(target, native), {
				recursive: true,
				dereference: true
			})
		}
	}
}

if (import.meta.main) {
	await prepareSemanticAssets()
}
