import * as v from 'valibot'
import { LocalSemanticEngine } from './engine'

const data = v.parse(v.tuple([v.string(), v.string()]), process.argv.slice(2))
const requestSchema = v.object({
	query: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)),
	passages: v.pipe(v.array(v.pipe(v.string(), v.maxLength(16000))), v.maxLength(512))
})
let engine: Promise<LocalSemanticEngine> | undefined
let queue = Promise.resolve()
const reply = (message: object) => {
	if (process.parentPort) {
		process.parentPort.postMessage(message)
	} else {
		process.send?.(message)
	}
}
const receive = (message: unknown) => {
	const parsed = v.safeParse(requestSchema, message)
	if (!parsed.success) {
		return
	}
	const { query, passages } = parsed.output
	queue = queue.then(async () => {
		try {
			engine ??= LocalSemanticEngine.open(data[0], data[1])
			reply({ ok: true, result: await (await engine).rank(query, passages) })
		} catch {
			reply({ ok: false })
		}
	})
}
if (process.parentPort) {
	process.parentPort.on('message', (event) => receive(event.data))
} else {
	process.on('message', receive)
	process.on('disconnect', () => process.exit(0))
}
