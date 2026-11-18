import type { OpenKnowledgeAPI } from '#lib/desktop/api.js'

export function desktopAPI(): OpenKnowledgeAPI | null {
	return window.openKnowledge ?? null
}
