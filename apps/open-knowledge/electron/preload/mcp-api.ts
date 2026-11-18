import {
	MCPConnectionDetailsSchema,
	MCPManagementSnapshotSchema,
	MCPWorkspaceStatusSchema,
	type MCPAPI,
	type MCPWorkspaceInput,
	type MCPWorkspaceStatus,
	type UpdateMCPEnabledInput,
	type UpdateMCPMemoryEnabledInput,
	type UpdateMCPWorkspaceInput
} from '../../src/lib/mcp/api'
import { channels } from '../channels'
import { invoke, NullSchema, subscribe } from './transport'

export function createMCPAPI(): MCPAPI {
	return {
		async openSettings() {
			await invoke(channels.mcpOpenSettings, undefined, NullSchema)
		},
		getManagementSnapshot() {
			return invoke(channels.mcpManagementSnapshot, undefined, MCPManagementSnapshotSchema)
		},
		get(input: MCPWorkspaceInput) {
			return invoke(channels.mcpGet, input, MCPWorkspaceStatusSchema)
		},
		update(input: UpdateMCPWorkspaceInput) {
			return invoke(channels.mcpUpdate, input, MCPWorkspaceStatusSchema)
		},
		async setEnabled(input: UpdateMCPEnabledInput) {
			await invoke(channels.mcpSetEnabled, input, NullSchema)
		},
		async setMemoryEnabled(input: UpdateMCPMemoryEnabledInput) {
			await invoke(channels.mcpSetMemoryEnabled, input, NullSchema)
		},
		revealConnection(input: MCPWorkspaceInput) {
			return invoke(channels.mcpRevealConnection, input, MCPConnectionDetailsSchema)
		},
		regenerateCredential(input: MCPWorkspaceInput) {
			return invoke(channels.mcpRegenerateCredential, input, MCPConnectionDetailsSchema)
		},
		onChange(listener: (status: MCPWorkspaceStatus) => void) {
			return subscribe(channels.mcpChange, MCPWorkspaceStatusSchema, listener)
		}
	}
}
