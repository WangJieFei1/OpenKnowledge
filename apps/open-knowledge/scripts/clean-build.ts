import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const applicationRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

await Promise.all(
	// Output artifacts are edition-scoped. Building Codex must not delete the General release.
	['build', 'dist-electron'].map((directory) =>
		rm(path.join(applicationRoot, directory), { recursive: true, force: true })
	)
)
