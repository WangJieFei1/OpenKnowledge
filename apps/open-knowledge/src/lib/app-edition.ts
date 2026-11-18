export type AppEditionID = 'general' | 'codex'

export interface AppEdition {
	id: AppEditionID
	name: string
	bundleID: string
	executableName: string
	packageName: string
	windowsAppID: string
	codexMemory: boolean
}

/** Used only by build tooling. Reject typos instead of silently shipping the wrong edition. */
export function resolveAppEdition(value: string | undefined): Readonly<AppEdition> {
	if (value === undefined || value === 'general') {
		return Object.freeze({
			id: 'general',
			name: 'Open Knowledge General',
			bundleID: 'com.openknowledge.app.general',
			executableName: 'open-knowledge-general',
			packageName: 'open-knowledge-general',
			windowsAppID: 'com.squirrel.OpenKnowledgeGeneral.open-knowledge-general',
			codexMemory: false
		})
	}
	if (value === 'codex') {
		return Object.freeze({
			id: 'codex',
			name: 'Open Knowledge Codex',
			bundleID: 'com.openknowledge.app.codex',
			executableName: 'open-knowledge-codex',
			packageName: 'open-knowledge-codex',
			windowsAppID: 'com.squirrel.OpenKnowledgeCodex.open-knowledge-codex',
			codexMemory: true
		})
	}
	throw new Error('OPEN_KNOWLEDGE_EDITION must be general or codex.')
}

// Vite replaces this in the renderer, main and preload. Packaged applications do not read an
// environment variable to choose their capabilities. Unbundled unit tests default to General.
declare const __OPEN_KNOWLEDGE_EDITION__: AppEditionID
export const appEdition = resolveAppEdition(
	typeof __OPEN_KNOWLEDGE_EDITION__ === 'undefined' ? 'general' : __OPEN_KNOWLEDGE_EDITION__
)
