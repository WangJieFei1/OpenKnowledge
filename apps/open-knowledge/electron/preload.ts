import { contextBridge } from 'electron'
import type { OpenKnowledgeAPI } from '../src/lib/desktop/api'
import { createKnowledgeAPI } from './preload/knowledge-api'
import { createMCPAPI } from './preload/mcp-api'
import { createSettingsAPI } from './preload/settings-api'
import { createWorkspaceSelectorAPI } from './preload/selector-api'
import { createWindowAPI } from './preload/window-api'

const openKnowledgeAPI: OpenKnowledgeAPI = {
	nativeMenuBar: process.platform === 'darwin',
	knowledge: createKnowledgeAPI(),
	mcp: createMCPAPI(),
	settings: createSettingsAPI(),
	workspaceSelector: createWorkspaceSelectorAPI(),
	window: createWindowAPI()
}

contextBridge.exposeInMainWorld('openKnowledge', openKnowledgeAPI)
