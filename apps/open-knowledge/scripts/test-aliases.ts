import { plugin } from 'bun'
import { fileURLToPath } from 'node:url'

// Bun 1.3 resolves package import-map .js paths literally; tests execute TypeScript sources.
// Keep this adaptation test-only. Production resolution remains owned by Vite/SvelteKit.
plugin({
	name: 'typescript-source-aliases',
	setup(build) {
		build.onResolve({ filter: /^#lib\/.+\.js$/ }, ({ path }) => ({
			path: fileURLToPath(new URL(`../src/lib/${path.slice(5, -3)}.ts`, import.meta.url))
		}))
	}
})
