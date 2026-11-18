import { createApp } from './app'

const app = createApp()

export const server = Bun.serve({
	hostname: '127.0.0.1',
	port: 8787,
	fetch: app.fetch
})

console.log('Knowledge bundle listening at http://127.0.0.1:8787/bundle')
