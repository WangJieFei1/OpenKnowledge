import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { formatFromPath, initSync, toMarkdownBytes } from '@firecrawl/anydoc-wasm'

const MAXIMUM_RENDERED_MARKDOWN_BYTES = 16 * 1_024 * 1_024
const wasmURL = new URL(
	'../../node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm?no-inline',
	import.meta.url
)
wasmURL.search = ''
let initialized: Promise<void> | undefined

export async function renderAnydocDocument(
	path: string,
	bytes: Uint8Array,
	maximumMarkdownBytes = MAXIMUM_RENDERED_MARKDOWN_BYTES
): Promise<string> {
	await (initialized ??= readFile(wasmURL).then((wasm) => {
		initSync({ module: wasm })
	}))
	const format = formatFromPath(path)
	if (!format) {
		throw new Error('The requested file is not supported by Anydoc.')
	}
	const markdown = toMarkdownBytes(bytes, format)
	if (
		markdown.length > maximumMarkdownBytes ||
		Buffer.byteLength(markdown, 'utf8') > maximumMarkdownBytes
	) {
		throw new RangeError(
			`Rendered documents are limited to ${maximumMarkdownBytes} bytes of Markdown.`
		)
	}
	return markdown
}
