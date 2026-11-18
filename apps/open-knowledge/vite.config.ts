import tailwindcss from '@tailwindcss/vite'
import adapter from '@sveltejs/adapter-static'
import { sveltekit } from '@sveltejs/kit/vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import { stageSemanticAssets } from './scripts/semantic-assets'
import { editionManifest } from './scripts/edition-build'
import { resolveAppEdition } from './src/lib/app-edition'

const edition = resolveAppEdition(process.env.OPEN_KNOWLEDGE_EDITION)
const editionDefine = { __OPEN_KNOWLEDGE_EDITION__: JSON.stringify(edition.id) }
const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
	.version as string
const manifest = JSON.stringify(editionManifest(edition, packageVersion), null, 2)

const systemElectronPackage = fileURLToPath(
	new URL('./electron/system-electron.ts', import.meta.url)
)
const isSvelteKitSync =
	process.argv[1]?.endsWith('svelte-kit.js') === true && process.argv[2] === 'sync'

export default defineConfig({
	define: editionDefine,
	plugins: [
		{
			name: 'edition-renderer-manifest',
			generateBundle() {
				this.emitFile({ type: 'asset', fileName: 'edition.json', source: manifest })
			}
		},
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: '200.html' }),
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:', 'https:', 'http:'],
					'font-src': ['self', 'data:'],
					'connect-src': [
						'self',
						'ws://127.0.0.1:*',
						'ws://localhost:*',
						'http://127.0.0.1:*',
						'http://localhost:*'
					]
				}
			}
		}),
		!isSvelteKitSync &&
			electron({
				main: {
					entry: 'electron/main.ts',
					vite: {
						base: './',
						define: editionDefine,
						resolve: {
							alias: edition.codexMemory
								? []
								: [
										{
											find: '../memory/session-memory-provider',
											replacement: fileURLToPath(
												new URL('./electron/memory/no-session-memory-provider.ts', import.meta.url)
											)
										}
									]
						},
						plugins: [
							{
								name: 'edition-capability-boundary',
								generateBundle(_options, bundle) {
									if (!edition.codexMemory) {
										for (const output of Object.values(bundle)) {
											if (
												output.type === 'chunk' &&
												output.moduleIds.some((id) =>
													id.replaceAll('\\', '/').endsWith('/memory/codex-session-memory.ts')
												)
											) {
												this.error('General builds must not include the Codex session reader.')
											}
										}
									}
								}
							},
							{
								name: 'local-semantic-assets',
								async closeBundle() {
									await stageSemanticAssets()
									await writeFile(
										new URL('./dist-electron/edition.json', import.meta.url),
										manifest
									)
								}
							}
						],
						build: {
							rolldownOptions: { external: ['onnxruntime-node'] },
							lib: {
								entry: {
									main: 'electron/main.ts',
									'anydoc-worker': 'electron/workspace/anydoc-worker.ts',
									'ripgrep-worker': 'electron/workspace/ripgrep-worker.ts',
									'semantic-worker': 'electron/semantic/semantic-worker.ts',
									'semantic-runtime': 'electron/semantic/local-search.ts'
								},
								formats: ['es'],
								fileName: (_format, entryName) => `${entryName}.mjs`
							}
						}
					},
					onstart: async ({ startup }) => {
						const electronPackage = process.env.OPEN_KNOWLEDGE_USE_SYSTEM_ELECTRON
							? systemElectronPackage
							: undefined
						await startup(
							['.', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9223'],
							undefined,
							electronPackage
						)
					}
				},
				preload: {
					input: 'electron/preload.ts',
					vite: {
						define: editionDefine,
						build: {
							rolldownOptions: {
								output: {
									format: 'cjs',
									codeSplitting: false,
									entryFileNames: 'preload.cjs',
									chunkFileNames: '[name].cjs'
								}
							}
						}
					}
				}
			})
	]
})
