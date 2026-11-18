import type { SessionMemoryProvider } from './session-memory-provider'

export type { SessionMemoryProvider }

// No filesystem discovery or runtime import of the Codex reader in the General edition.
export function createSessionMemory(root?: string): SessionMemoryProvider | undefined {
	void root
	return undefined
}
