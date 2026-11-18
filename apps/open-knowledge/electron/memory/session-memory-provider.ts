import { CodexSessionMemory } from './codex-session-memory'
import type { CodexMemorySnapshot } from './types'

export interface SessionMemoryProvider {
	snapshot(workspaceRoot: string, signal: AbortSignal): Promise<CodexMemorySnapshot>
}

// The General build replaces this module with no-session-memory-provider at build time.
// Keep the Codex reader behind this single import edge so it is absent from that bundle.
export function createSessionMemory(root?: string): SessionMemoryProvider | undefined {
	return root ? new CodexSessionMemory(root) : undefined
}
