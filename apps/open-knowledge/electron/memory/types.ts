export type CodexMemoryRole = 'user' | 'assistant'

export interface CodexMemoryTurn {
	index: number
	role: CodexMemoryRole
	text: string
	timestamp?: string
}

export interface CodexMemorySession {
	id: string
	timestamp?: string
	turns: CodexMemoryTurn[]
	warnings: string[]
}

export interface CodexMemorySnapshot {
	sessions: CodexMemorySession[]
	complete: boolean
	warnings: string[]
}

export interface CodexMemoryLimits {
	maximumDepth: number
	maximumDirectories: number
	maximumFiles: number
	maximumBytes: number
	maximumLineBytes: number
	maximumTurns: number
}

export const defaultCodexMemoryLimits: Readonly<CodexMemoryLimits> = Object.freeze({
	maximumDepth: 8,
	maximumDirectories: 2_048,
	maximumFiles: 256,
	maximumBytes: 32 * 1024 * 1024,
	maximumLineBytes: 4 * 1024 * 1024,
	maximumTurns: 4_096
})
