import { MessageChannel, Worker } from 'node:worker_threads'
import * as v from 'valibot'
import { object } from '../validation'

const CONVERSION_TIMEOUT_MS = 120_000
const ConversionResultSchema = v.union([
	object({ ok: v.literal(true), markdown: v.string() }),
	object({ ok: v.literal(false), message: v.string() })
])
let worker: Worker | undefined

export function renderAnydocDocument(
	path: string,
	bytes: Uint8Array,
	signal?: AbortSignal,
	maximumMarkdownBytes?: number
): Promise<string> {
	signal?.throwIfAborted()
	const documentBytes = transferableBuffer(bytes)
	const channel = new MessageChannel()
	const converter = conversionWorker()

	return new Promise((resolve, reject) => {
		let settled = false
		function cleanup() {
			clearTimeout(timeout)
			channel.port1.close()
			converter.off('error', failed)
			converter.off('exit', exited)
			signal?.removeEventListener('abort', aborted)
		}
		function failed(error: unknown) {
			if (settled) {
				return
			}
			settled = true
			cleanup()
			reject(error)
		}
		function exited(code: number) {
			failed(new Error(`The document converter exited before replying (code ${code}).`))
		}
		function aborted() {
			if (worker === converter) {
				worker = undefined
			}
			void converter.terminate()
			failed(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
		}
		const timeout = setTimeout(() => {
			if (worker === converter) {
				worker = undefined
			}
			void converter.terminate()
			failed(new Error('The document conversion timed out.'))
		}, CONVERSION_TIMEOUT_MS)
		timeout.unref()
		channel.port1.once('messageerror', failed)
		channel.port1.once('message', (value: unknown) => {
			const parsed = v.safeParse(ConversionResultSchema, value)
			if (!parsed.success) {
				failed(new Error('The document converter returned an invalid response.'))
				return
			}
			const result = parsed.output
			if (result.ok) {
				if (settled) {
					return
				}
				settled = true
				cleanup()
				resolve(result.markdown)
			} else {
				failed(new Error(result.message))
			}
		})
		converter.once('error', failed)
		converter.once('exit', exited)
		signal?.addEventListener('abort', aborted, { once: true })
		channel.port1.start()
		try {
			converter.postMessage(
				{ path, bytes: documentBytes, maximumMarkdownBytes, reply: channel.port2 },
				[documentBytes, channel.port2]
			)
			if (signal?.aborted) {
				aborted()
			}
		} catch (error) {
			channel.port2.close()
			failed(error)
		}
	})
}

function conversionWorker(): Worker {
	if (worker) {
		return worker
	}
	const workerURL = new URL(import.meta.url)
	workerURL.pathname = `${workerURL.pathname.slice(0, workerURL.pathname.lastIndexOf('/') + 1)}anydoc-worker.mjs`
	const created = new Worker(workerURL)
	created.unref()
	created.on('error', (error) => {
		if (worker === created) {
			worker = undefined
		}
		console.error('The document converter worker failed.', error)
	})
	created.once('exit', () => {
		if (worker === created) {
			worker = undefined
		}
	})
	worker = created
	return created
}

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
	if (
		bytes.buffer instanceof ArrayBuffer &&
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength
	) {
		return bytes.buffer
	}
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	return copy.buffer
}
