import { newRpcResponse } from '@hono/capnweb'
import { Hono } from 'hono'
import { InMemoryKnowledgeBundle } from './in-memory-knowledge-bundle'

export function createApp(bundle = new InMemoryKnowledgeBundle()): Hono {
	const app = new Hono()
	app.all('/bundle', (context) => newRpcResponse(context, bundle))
	return app
}
