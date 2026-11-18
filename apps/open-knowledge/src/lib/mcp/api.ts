import * as v from 'valibot'
import { errorMessage, object, UUIDSchema } from '../validation'

const URLSchema = v.pipe(v.string(), v.trim(), v.url())
const StringMapSchema = v.pipe(
	v.custom<Record<string, unknown>>((value) => {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			return false
		}
		const prototype = Object.getPrototypeOf(value)
		return prototype === Object.prototype || prototype === null
	}),
	v.record(v.string(), v.string())
)

export const mcpMessageIDs = [
	'error.mcp.start',
	'error.mcp.update',
	'error.mcp.memory',
	'error.mcp.regenerate',
	'error.mcp.workspace.not-recent',
	'error.mcp.credential.requires-included',
	'error.mcp.connection.not-listening',
	'error.mcp.unavailable'
] as const

export const MCPMessageIDSchema = v.picklist(mcpMessageIDs)

const MCPWorkspaceInputEntries = {
	workspaceID: v.pipe(v.string(), v.nonEmpty())
}
export const MCPWorkspaceInputSchema = object(MCPWorkspaceInputEntries)

export const MCPAccessSchema = v.picklist(['off', 'read', 'write'])
export const UpdateMCPWorkspaceInputSchema = object({
	...MCPWorkspaceInputEntries,
	access: MCPAccessSchema
})
export const UpdateMCPEnabledInputSchema = object({ enabled: v.boolean() })
export const UpdateMCPMemoryEnabledInputSchema = object({ enabled: v.boolean() })

const MCPWorkspaceStatusEntries = {
	workspaceID: v.pipe(v.string(), v.nonEmpty()),
	globalEnabled: v.boolean(),
	memoryEnabled: v.boolean(),
	access: MCPAccessSchema,
	workspaceCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
	profileID: UUIDSchema,
	credentialRevision: v.nullable(UUIDSchema),
	state: v.picklist(['disabled', 'starting', 'listening', 'error']),
	httpURL: v.nullable(URLSchema),
	message: v.nullable(MCPMessageIDSchema)
}
export const MCPWorkspaceStatusSchema = object(MCPWorkspaceStatusEntries)

export const MCPManagementWorkspaceSchema = object({
	...MCPWorkspaceStatusEntries,
	label: v.pipe(v.string(), v.nonEmpty())
})

export const MCPManagementSnapshotSchema = object({
	enabled: v.boolean(),
	memoryEnabled: v.boolean(),
	workspaces: v.array(MCPManagementWorkspaceSchema)
})

export const MCPConnectionDetailsSchema = object({
	workspaceID: v.pipe(v.string(), v.nonEmpty()),
	workspaceCount: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
	credentialRevision: UUIDSchema,
	http: object({
		url: URLSchema,
		bearerToken: v.pipe(v.string(), v.minLength(32))
	}),
	stdio: object({
		command: v.pipe(v.string(), v.nonEmpty()),
		args: v.array(v.string()),
		env: StringMapSchema
	})
})

export type MCPWorkspaceInput = v.InferOutput<typeof MCPWorkspaceInputSchema>
export type MCPAccess = v.InferOutput<typeof MCPAccessSchema>
export type UpdateMCPWorkspaceInput = v.InferOutput<typeof UpdateMCPWorkspaceInputSchema>
export type UpdateMCPEnabledInput = v.InferOutput<typeof UpdateMCPEnabledInputSchema>
export type UpdateMCPMemoryEnabledInput = v.InferOutput<typeof UpdateMCPMemoryEnabledInputSchema>
export type MCPMessageID = v.InferOutput<typeof MCPMessageIDSchema>
export type MCPWorkspaceStatus = v.InferOutput<typeof MCPWorkspaceStatusSchema>
export type MCPManagementWorkspace = v.InferOutput<typeof MCPManagementWorkspaceSchema>
export type MCPManagementSnapshot = v.InferOutput<typeof MCPManagementSnapshotSchema>
export type MCPConnectionDetails = v.InferOutput<typeof MCPConnectionDetailsSchema>

export function mcpMessageIDFromError(error: unknown): MCPMessageID | null {
	const candidates = errorMessage(error).match(/error\.mcp\.[a-z0-9]+(?:[.-][a-z0-9]+)*/g) ?? []
	for (const candidate of candidates) {
		if (v.is(MCPMessageIDSchema, candidate)) {
			return candidate
		}
	}
	return null
}

export interface MCPAPI {
	openSettings(): Promise<void>
	getManagementSnapshot(): Promise<MCPManagementSnapshot>
	get(input: MCPWorkspaceInput): Promise<MCPWorkspaceStatus>
	update(input: UpdateMCPWorkspaceInput): Promise<MCPWorkspaceStatus>
	setEnabled(input: UpdateMCPEnabledInput): Promise<void>
	setMemoryEnabled(input: UpdateMCPMemoryEnabledInput): Promise<void>
	revealConnection(input: MCPWorkspaceInput): Promise<MCPConnectionDetails>
	regenerateCredential(input: MCPWorkspaceInput): Promise<MCPConnectionDetails>
	onChange(listener: (status: MCPWorkspaceStatus) => void): () => void
}
