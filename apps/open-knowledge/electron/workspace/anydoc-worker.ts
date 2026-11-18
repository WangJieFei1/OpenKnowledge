import { MessagePort, parentPort } from 'node:worker_threads'
import * as v from 'valibot'
import { errorMessage, object } from '../validation'
import { renderAnydocDocument } from './anydoc-runtime'

const maximumMarkdownBytesMessage = 'The maximum Markdown byte count must be a positive integer.'
const ConversionRequestSchema = object({
	path: v.string(),
	bytes: v.instance(ArrayBuffer),
	maximumMarkdownBytes: v.optional(
		v.pipe(
			v.number(maximumMarkdownBytesMessage),
			v.safeInteger(maximumMarkdownBytesMessage),
			v.minValue(1, maximumMarkdownBytesMessage)
		)
	),
	reply: v.instance(MessagePort)
})

parentPort?.on('message', (value: unknown) => {
	const request = v.parse(ConversionRequestSchema, value)
	void convert(request)
})

async function convert({
	path,
	bytes,
	maximumMarkdownBytes,
	reply
}: v.InferOutput<typeof ConversionRequestSchema>): Promise<void> {
	try {
		reply.postMessage({
			ok: true,
			markdown: await renderAnydocDocument(path, new Uint8Array(bytes), maximumMarkdownBytes)
		})
	} catch (error) {
		reply.postMessage({
			ok: false,
			message: errorMessage(error) ?? String(error)
		})
	} finally {
		reply.close()
	}
}
