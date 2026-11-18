import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app } from 'electron'

// Exercise the real browser/main utilityProcess branch without loading the product application,
// real workspaces, settings, or Codex history. No BrowserWindow or network connection is created.
assert.equal(process.type, 'browser')
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'open-knowledge-electron-smoke-'))
app.setPath('userData', temporaryRoot)
app.setPath('sessionData', temporaryRoot)
app.disableHardwareAcceleration()
// Do not top-level-await readiness: Electron waits for its ESM main entry to finish loading.
void app.whenReady().then(async () => {
	let exitCode = 0
	try {
		await import('./semantic-runtime-smoke')
	} catch (error) {
		console.error(error)
		exitCode = 1
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true })
		app.exit(exitCode)
	}
})
