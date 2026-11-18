import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { app, BrowserWindow, dialog, Menu } from 'electron'
import type { MCPConnectionDetails, MCPManagementSnapshot } from '../src/lib/mcp/api'
import type { WorkspaceSelectorBrowseResult } from '../src/lib/workspace/selector-api'

// Build with: bun build scripts/edition-electron-smoke.ts --external=electron --target=node
//   --outfile=.cache/edition-electron-smoke.mjs
// Run with stock Electron: electron .cache/edition-electron-smoke.mjs /absolute/path/app.asar
// Only appData, app.getAppPath and the native folder picker are redirected. The real ASAR main,
// preload, renderer, IPC authorization and gateway execute unchanged against one synthetic folder.
// Never invoke any session-memory tool: listing its availability must not read Codex histories.
assert.equal(process.type, 'browser', 'Run this smoke test with stock Electron.')
assert.equal(process.platform, 'darwin', 'This smoke uses the native macOS application menu.')
assert.ok(process.argv[2], 'Supply the packaged app.asar path.')
assert.ok(!process.env.OPEN_KNOWLEDGE_WORKSPACE, 'Unset OPEN_KNOWLEDGE_WORKSPACE for this test.')
assert.ok(!process.env.VITE_DEV_SERVER_URL, 'Unset VITE_DEV_SERVER_URL for this test.')
const resourceRoot = path.resolve(process.argv[2])
const manifest = JSON.parse(
	readFileSync(path.join(resourceRoot, 'dist-electron', 'edition.json'), 'utf8')
) as { edition: 'general' | 'codex'; name: string; codexMemory: boolean }
assert.ok(manifest.edition === 'general' || manifest.edition === 'codex')
assert.equal(manifest.codexMemory, manifest.edition === 'codex')
assert.equal(
	manifest.name,
	manifest.edition === 'codex' ? 'Open Knowledge Codex' : 'Open Knowledge General'
)

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'open-knowledge-edition-smoke-'))
const fixtureRoot = path.join(temporaryRoot, 'synthetic-workspace')
const fixtureMarkdown = '# Edition smoke fixture\n\nSynthetic revenue for FY2025 is 123 USD.\n'
mkdirSync(fixtureRoot)
writeFileSync(path.join(fixtureRoot, 'fixture.md'), fixtureMarkdown)
app.setPath('appData', temporaryRoot)
app.getAppPath = () => resourceRoot
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtureRoot] })
// Runtime environment must not turn General into Codex, or disable Codex's compiled capability.
process.env.OPEN_KNOWLEDGE_EDITION = manifest.edition === 'codex' ? 'general' : 'codex'
app.disableHardwareAcceleration()

let activeClient: Client | undefined
let exitCode = 1
let shutdownRequested = false
let cleanupStarted = false
const secrets = new Set<string>()
const hardExit = setTimeout(() => {
	console.error('Edition smoke exceeded its 60-second cleanup deadline.')
	app.exit(1)
}, 60_000)
const deadline = setTimeout(() => void finish(new Error('Edition smoke timed out.')), 55_000)

function safeError(error: unknown): string {
	let message = error instanceof Error ? error.message : 'Unknown smoke failure'
	for (const secret of secrets) {
		message = message.replaceAll(secret, '[redacted]')
	}
	return message
}

async function cleanup(): Promise<void> {
	if (cleanupStarted) {
		return
	}
	cleanupStarted = true
	clearTimeout(deadline)
	try {
		await rm(temporaryRoot, { recursive: true, force: true })
	} catch {
		console.error('Could not remove the generated smoke-test temporary directory.')
		exitCode = 1
	} finally {
		clearTimeout(hardExit)
		app.exit(exitCode)
	}
}

async function finish(error?: unknown): Promise<void> {
	if (shutdownRequested) {
		return
	}
	shutdownRequested = true
	exitCode = error === undefined ? 0 : 1
	if (error !== undefined) {
		console.error(`Edition smoke failed: ${safeError(error)}`)
	}
	await activeClient?.close().catch(() => undefined)
	activeClient = undefined
	app.quit()
}

function evaluate<T>(window: BrowserWindow, source: string): Promise<T> {
	return window.webContents.executeJavaScript(source, true) as Promise<T>
}

async function waitFor<T>(
	description: string,
	probe: () => T | Promise<T>
): Promise<NonNullable<T>> {
	const until = Date.now() + 12_000
	while (Date.now() < until && !shutdownRequested) {
		const result = await probe()
		if (result) {
			return result as NonNullable<T>
		}
		await new Promise((resolve) => setTimeout(resolve, 80))
	}
	throw new Error(`Timed out waiting for ${description}.`)
}

async function windowAt(route: string): Promise<BrowserWindow> {
	return waitFor(`rendered ${route} window`, async () => {
		const window = BrowserWindow.getAllWindows().find((candidate) => {
			const url = candidate.webContents.getURL()
			return url && new URL(url).pathname === route
		})
		if (!window || window.webContents.isLoadingMainFrame()) {
			return undefined
		}
		return (await evaluate<boolean>(window, 'Boolean(window.openKnowledge && document.body)'))
			? window
			: undefined
	})
}

async function snapshot(window: BrowserWindow): Promise<MCPManagementSnapshot> {
	return evaluate(window, 'window.openKnowledge.mcp.getManagementSnapshot()')
}

async function connect(window: BrowserWindow, workspaceID: string): Promise<Client> {
	const details = await evaluate<MCPConnectionDetails>(
		window,
		`window.openKnowledge.mcp.revealConnection({workspaceID:${JSON.stringify(workspaceID)}})`
	)
	secrets.add(details.http.bearerToken)
	assert.equal(new URL(details.http.url).hostname, '127.0.0.1')
	assert.ok(JSON.stringify(details.stdio).includes(path.join(temporaryRoot, manifest.name)))
	const transport = new StreamableHTTPClientTransport(new URL(details.http.url), {
		requestInit: { headers: { Authorization: `Bearer ${details.http.bearerToken}` } }
	})
	const client = new Client({ name: 'open-knowledge-edition-smoke', version: '1.0.0' })
	activeClient = client
	await client.connect(transport)
	return client
}

const memoryTools = [
	'knowledge_list_memory_sessions',
	'knowledge_search_memory',
	'knowledge_get_memory_context'
]

async function assertMemoryCatalog(client: Client, expected: boolean): Promise<void> {
	const names = new Set((await client.listTools()).tools.map(({ name }) => name))
	for (const name of memoryTools) {
		assert.equal(names.has(name), expected, name)
	}
	assert.ok(names.has('knowledge_recall'))
	assert.ok(names.has('knowledge_get_document'))
	assert.equal(names.has('knowledge_create_document'), false, 'Read grant must not expose writes.')
	const instructions = client.getInstructions()
	assert.ok(instructions, 'Server instructions must exist.')
	assert.ok(instructions.includes('knowledge_recall'), 'Server retrieval guidance must exist.')
	assertMemoryGuidance(instructions, expected, 'Server instructions')
	// Fetching a prompt only formats instructions. It must never invoke memory/history tools.
	const listed = await client.callTool({ name: 'knowledge_list_workspaces', arguments: {} })
	const workspaces = (listed.structuredContent as { workspaces: { workspace_ref: string }[] })
		.workspaces
	assert.equal(workspaces.length, 1)
	const research = await client.getPrompt({
		name: 'research_brief',
		arguments: {
			question: 'Review the synthetic FY2025 revenue fixture.',
			workspace_ref: workspaces[0]!.workspace_ref
		}
	})
	const guidance = research.messages
		.map(({ content }) => (content.type === 'text' ? content.text : ''))
		.join('\n')
	assert.ok(guidance.includes('knowledge_recall'), 'Scoped research guidance must exist.')
	assertMemoryGuidance(guidance, expected, 'Scoped research prompt')
}

function assertMemoryGuidance(text: string, expected: boolean, label: string): void {
	assert.equal(/Codex/i.test(text), expected, `${label}: Codex guidance`)
	assert.equal(
		/knowledge_(?:list_memory_sessions|search_memory|get_memory_context)/.test(text),
		expected,
		`${label}: session-memory tool guidance`
	)
	if (expected) {
		assert.ok(text.includes('knowledge_search_memory'), `${label}: memory search guidance`)
		assert.ok(text.includes('knowledge_get_memory_context'), `${label}: memory context guidance`)
	}
}

async function run(): Promise<void> {
	assert.equal(app.name, manifest.name)
	assert.equal(app.getPath('userData'), path.join(temporaryRoot, manifest.name))
	assert.equal(app.getPath('sessionData'), path.join(temporaryRoot, manifest.name))
	const selector = await windowAt('/workspaces')
	const browse = await evaluate<WorkspaceSelectorBrowseResult>(
		selector,
		'window.openKnowledge.workspaceSelector.browse()'
	)
	assert.equal(browse.status, 'selected', 'The synthetic workspace must register via preload IPC.')
	if (browse.status !== 'selected') {
		throw new Error('Synthetic workspace registration failed.')
	}
	assert.equal(browse.workspace.kind, 'local')
	const workspaceID = browse.workspace.id
	// Use the actual native menu handler: loading /mcp in a selector window would fail IPC roles.
	const menu = Menu.getApplicationMenu()
	const mcpMenu = menu?.items.find(({ label }) => label === 'MCP')
	const settingsItem = mcpMenu?.submenu?.items.at(-1)
	assert.ok(settingsItem, 'The actual native MCP settings menu must be present.')
	settingsItem.click(undefined, selector, { triggeredByAccelerator: false })
	const mcpWindow = await windowAt('/mcp')
	await waitFor('edition heading', () =>
		evaluate<boolean>(mcpWindow, 'Boolean(document.querySelector("#edition-heading"))')
	)
	const initial = await snapshot(mcpWindow)
	assert.equal(initial.memoryEnabled, false)
	assert.equal(initial.workspaces.length, 1)
	assert.equal(initial.workspaces[0]?.workspaceID, workspaceID)
	assert.equal(initial.workspaces[0]?.access, 'off')
	const memoryUI = await evaluate<{ present: boolean; checked: string | null }>(
		mcpWindow,
		`({present: Boolean(document.querySelector('#session-memory-heading')),
		checked: document.querySelector('[aria-labelledby="session-memory-heading"] [role="switch"]')?.getAttribute('aria-checked') ?? null})`
	)
	assert.equal(memoryUI.present, manifest.codexMemory)
	assert.equal(memoryUI.checked, manifest.codexMemory ? 'false' : null)
	if (process.env.OPEN_KNOWLEDGE_SMOKE_SCREENSHOT === '1') {
		// Capture only the default hidden-credential view, before revealing any connection.
		assert.equal(
			await evaluate(mcpWindow, 'Boolean(document.querySelector(".credential-details"))'),
			false
		)
		await writeFile(
			new URL(`./edition-${manifest.edition}.png`, import.meta.url),
			(await mcpWindow.webContents.capturePage()).toPNG()
		)
	}
	await evaluate(
		mcpWindow,
		`window.openKnowledge.mcp.update({workspaceID:${JSON.stringify(workspaceID)},access:'read'})`
	)
	await evaluate(mcpWindow, 'window.openKnowledge.mcp.setEnabled({enabled:true})')
	await waitFor(
		'listening gateway',
		async () => (await snapshot(mcpWindow)).workspaces[0]?.state === 'listening'
	)
	const client = await connect(mcpWindow, workspaceID)
	await assertMemoryCatalog(client, false)
	const prompts = new Set((await client.listPrompts()).prompts.map(({ name }) => name))
	for (const name of ['research_brief', 'quant_research_review', 'consulting_handoff']) {
		assert.ok(prompts.has(name), name)
	}
	const listed = await client.callTool({ name: 'knowledge_list_workspaces', arguments: {} })
	const workspaces = (listed.structuredContent as { workspaces: { workspace_ref: string }[] })
		.workspaces
	assert.equal(workspaces.length, 1)
	const read = await client.callTool({
		name: 'knowledge_get_document',
		arguments: { workspace_ref: workspaces[0]!.workspace_ref, path: '/fixture.md' }
	})
	assert.ok(!read.isError)
	assert.deepEqual(read.content, [{ type: 'text', text: fixtureMarkdown }])
	// Reveal through the UI only to inspect tabs, then immediately hide before any screenshots.
	await evaluate(mcpWindow, 'document.querySelector(".connection-buttons button").click()')
	const tabs = await waitFor('connection tabs', async () => {
		const labels = await evaluate<string[]>(
			mcpWindow,
			'Array.from(document.querySelectorAll("[role=tab]")).map(tab => tab.textContent.trim())'
		)
		return labels.length ? labels : undefined
	})
	assert.equal(tabs.length, manifest.codexMemory ? 3 : 2)
	assert.equal(
		tabs.some((label) => label.includes('Codex')),
		manifest.codexMemory
	)
	await evaluate(mcpWindow, 'document.querySelector(".connection-buttons button").click()')
	await client.close()
	activeClient = undefined
	if (manifest.codexMemory) {
		await evaluate(mcpWindow, 'window.openKnowledge.mcp.setMemoryEnabled({enabled:true})')
		assert.equal((await snapshot(mcpWindow)).memoryEnabled, true)
		const withMemory = await connect(mcpWindow, workspaceID)
		await assertMemoryCatalog(withMemory, true)
		// Catalog-only: never call a memory tool or request a history snapshot.
		await withMemory.close()
		activeClient = undefined
		await evaluate(mcpWindow, 'window.openKnowledge.mcp.setMemoryEnabled({enabled:false})')
	} else {
		const rejected = await evaluate<boolean>(
			mcpWindow,
			'window.openKnowledge.mcp.setMemoryEnabled({enabled:true}).then(() => false, () => true)'
		)
		assert.equal(rejected, true, 'General must reject memory enablement through real IPC.')
	}
	assert.equal((await snapshot(mcpWindow)).memoryEnabled, false)
	const afterRevoke = await connect(mcpWindow, workspaceID)
	await assertMemoryCatalog(afterRevoke, false)
	await afterRevoke.close()
	activeClient = undefined
	await evaluate(mcpWindow, 'window.openKnowledge.mcp.setEnabled({enabled:false})')
	console.log(
		`Edition ${manifest.edition}: ASAR identity, UI, preload IPC, document retrieval and memory capability gates PASS; no Codex history accessed.`
	)
}

try {
	// Await only loading the main module, never app readiness during Electron's ESM entry load.
	await import(pathToFileURL(path.join(resourceRoot, 'dist-electron', 'main.mjs')).href)
	app.on('will-quit', (event) => {
		// Let the application's first will-quit handler finish gateway/workspace shutdown first.
		if (event.defaultPrevented) {
			return
		}
		event.preventDefault()
		if (!shutdownRequested) {
			console.error('The packaged application quit before smoke completion.')
		}
		void cleanup()
	})
	void app
		.whenReady()
		.then(run)
		.then(() => finish(), finish)
} catch (error) {
	console.error(`Edition main import failed: ${safeError(error)}`)
	await cleanup()
}
