import type { KnowledgeAPI } from '../knowledge/api'
import type { MCPAPI } from '../mcp/api'
import type { SettingsAPI } from '../settings/api'
import type { WindowAPI } from '../window/api'
import type { WorkspaceSelectorAPI } from '../workspace/selector-api'

export interface OpenKnowledgeAPI {
	nativeMenuBar: boolean
	knowledge: KnowledgeAPI
	mcp: MCPAPI
	settings: SettingsAPI
	workspaceSelector: WorkspaceSelectorAPI
	window: WindowAPI
}
