import * as v from 'valibot'
import {
	MCPAccessSchema,
	mcpMessageIDFromError,
	type MCPAPI,
	type MCPConnectionDetails,
	type MCPManagementSnapshot,
	type MCPManagementWorkspace,
	type MCPMessageID,
	type MCPWorkspaceStatus
} from './api'

export type MCPSettingsErrorKey =
	| MCPMessageID
	| 'errorLoad'
	| 'errorUpdateAccess'
	| 'errorUpdateGlobal'
	| 'errorUpdateMemory'
	| 'errorReveal'
	| 'errorRegenerate'

export type MCPSettingsCopyFeedback = 'command' | 'http' | 'unavailable' | null

type ClipboardWriter = (value: string) => Promise<void>

function writeToClipboard(value: string): Promise<void> {
	return navigator.clipboard.writeText(value)
}

export class MCPSettingsSession {
	snapshot = $state<MCPManagementSnapshot | null>(null)
	connection = $state<MCPConnectionDetails | null>(null)
	loading = $state(true)
	busyWorkspaceID = $state<string | null>(null)
	globalBusy = $state(false)
	memoryBusy = $state(false)
	connectionBusy = $state(false)
	copyFeedback = $state<MCPSettingsCopyFeedback>(null)
	errorKey = $state<MCPSettingsErrorKey | null>(null)

	private unsubscribe: (() => void) | undefined
	private snapshotRequest = 0
	private statusGeneration = 0
	private started = false
	private disposed = false
	private refreshErrorKey: MCPSettingsErrorKey | null = null
	private readonly getAPI: () => MCPAPI

	constructor(
		api: MCPAPI | (() => MCPAPI),
		private readonly writeClipboard: ClipboardWriter = writeToClipboard
	) {
		this.getAPI = typeof api === 'function' ? api : () => api
	}

	private get api(): MCPAPI {
		return this.getAPI()
	}

	get enabled(): boolean | null {
		return this.snapshot?.enabled ?? null
	}

	get memoryEnabled(): boolean {
		return this.snapshot?.memoryEnabled ?? false
	}

	get workspaces(): MCPManagementWorkspace[] {
		return this.snapshot?.workspaces ?? []
	}

	get grantedWorkspaces(): MCPManagementWorkspace[] {
		return this.workspaces.filter((workspace) => workspace.access !== 'off')
	}

	get sharedStatus(): MCPManagementWorkspace | null {
		return this.grantedWorkspaces[0] ?? null
	}

	get gatewayError(): MCPManagementWorkspace | null {
		return this.workspaces.find((workspace) => workspace.state === 'error') ?? null
	}

	get workspaceCount(): number {
		return this.grantedWorkspaces.length
	}

	get statusState(): MCPWorkspaceStatus['state'] {
		return (
			this.gatewayError?.state ??
			(!this.snapshot?.enabled ? 'disabled' : (this.sharedStatus?.state ?? 'disabled'))
		)
	}

	get busy(): boolean {
		return (
			this.busyWorkspaceID !== null || this.connectionBusy || this.globalBusy || this.memoryBusy
		)
	}

	start(): void {
		if (this.started || this.disposed) {
			return
		}
		this.started = true
		this.unsubscribe = this.api.onChange(this.applyStatus)
		void this.refresh()
	}

	dispose(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.snapshotRequest += 1
		this.statusGeneration += 1
		this.unsubscribe?.()
		this.unsubscribe = undefined
		this.busyWorkspaceID = null
		this.globalBusy = false
		this.memoryBusy = false
		this.connectionBusy = false
		this.hideConnection()
	}

	async refresh(): Promise<void> {
		if (this.disposed) {
			return
		}
		const request = this.snapshotRequest + 1
		try {
			await this.loadSnapshot()
			if (!this.disposed && request === this.snapshotRequest) {
				if (this.errorKey === this.refreshErrorKey) {
					this.errorKey = null
				}
				this.refreshErrorKey = null
			}
		} catch (error) {
			if (!this.disposed && request === this.snapshotRequest) {
				this.refreshErrorKey = mcpMessageIDFromError(error) ?? 'errorLoad'
				this.errorKey = this.refreshErrorKey
			}
		} finally {
			if (!this.disposed && request === this.snapshotRequest) {
				this.loading = false
			}
		}
	}

	changeAccess = async (workspaceID: string, value: string): Promise<void> => {
		if (this.disposed) {
			return
		}
		if (!v.is(MCPAccessSchema, value)) {
			return
		}
		this.busyWorkspaceID = workspaceID
		this.clearError()
		this.hideConnection()
		try {
			await this.api.update({ workspaceID, access: value })
			if (!this.disposed) {
				await this.loadSnapshot()
			}
		} catch (error) {
			if (!this.disposed) {
				this.setOperationError(mcpMessageIDFromError(error) ?? 'errorUpdateAccess')
			}
		} finally {
			if (!this.disposed) {
				this.busyWorkspaceID = null
			}
		}
	}

	changeGlobalEnabled = async (enabled: boolean): Promise<void> => {
		if (this.disposed) {
			return
		}
		this.globalBusy = true
		this.clearError()
		this.hideConnection()
		try {
			await this.api.setEnabled({ enabled })
			if (!this.disposed) {
				await this.loadSnapshot()
			}
		} catch (error) {
			if (!this.disposed) {
				this.setOperationError(mcpMessageIDFromError(error) ?? 'errorUpdateGlobal')
			}
		} finally {
			if (!this.disposed) {
				this.globalBusy = false
			}
		}
	}

	changeMemoryEnabled = async (enabled: boolean): Promise<void> => {
		if (this.disposed) {
			return
		}
		this.memoryBusy = true
		this.clearError()
		this.hideConnection()
		try {
			await this.api.setMemoryEnabled({ enabled })
			if (!this.disposed) {
				await this.loadSnapshot()
			}
		} catch (error) {
			if (!this.disposed) {
				this.setOperationError(mcpMessageIDFromError(error) ?? 'errorUpdateMemory')
			}
		} finally {
			if (!this.disposed) {
				this.memoryBusy = false
			}
		}
	}

	reveal = async (): Promise<void> => {
		if (this.disposed) {
			return
		}
		const workspace = this.grantedWorkspaces[0]
		if (!workspace) {
			return
		}
		this.connectionBusy = true
		this.copyFeedback = null
		this.clearError()
		const generation = this.statusGeneration
		try {
			const revealed = await this.api.revealConnection({ workspaceID: workspace.workspaceID })
			if (
				!this.disposed &&
				generation === this.statusGeneration &&
				revealed.credentialRevision === this.sharedStatus?.credentialRevision
			) {
				this.connection = revealed
			}
		} catch (error) {
			if (!this.disposed) {
				this.setOperationError(mcpMessageIDFromError(error) ?? 'errorReveal')
			}
		} finally {
			if (!this.disposed) {
				this.connectionBusy = false
			}
		}
	}

	regenerate = async (): Promise<boolean> => {
		if (this.disposed) {
			return false
		}
		const workspace = this.grantedWorkspaces[0]
		if (!workspace) {
			return false
		}
		this.connectionBusy = true
		this.copyFeedback = null
		this.clearError()
		try {
			const regenerated = await this.api.regenerateCredential({
				workspaceID: workspace.workspaceID
			})
			if (this.disposed) {
				return false
			}
			const nextSnapshot = await this.loadSnapshot()
			if (this.disposed) {
				return false
			}
			this.connection = nextSnapshot?.workspaces.some(
				(candidate) =>
					candidate.access !== 'off' &&
					candidate.credentialRevision === regenerated.credentialRevision
			)
				? regenerated
				: null
			return true
		} catch (error) {
			if (!this.disposed) {
				this.setOperationError(mcpMessageIDFromError(error) ?? 'errorRegenerate')
			}
			return false
		} finally {
			if (!this.disposed) {
				this.connectionBusy = false
			}
		}
	}

	hideConnection = (): void => {
		this.connection = null
		this.copyFeedback = null
	}

	copy = async (kind: 'command' | 'http', value: string): Promise<void> => {
		if (this.disposed) {
			return
		}
		try {
			await this.writeClipboard(value)
			if (!this.disposed) {
				this.copyFeedback = kind
			}
		} catch {
			if (!this.disposed) {
				this.copyFeedback = 'unavailable'
			}
		}
	}

	dismissError = (): void => {
		if (!this.disposed) {
			this.clearError()
		}
	}

	private clearError(): void {
		this.errorKey = null
		this.refreshErrorKey = null
	}

	private setOperationError(errorKey: MCPSettingsErrorKey): void {
		this.refreshErrorKey = null
		this.errorKey = errorKey
	}

	private async loadSnapshot(): Promise<MCPManagementSnapshot | null> {
		if (this.disposed) {
			return null
		}
		const request = ++this.snapshotRequest
		while (!this.disposed && request === this.snapshotRequest) {
			const generation = this.statusGeneration
			const nextSnapshot = await this.api.getManagementSnapshot()
			if (this.disposed || request !== this.snapshotRequest) {
				return null
			}
			if (generation !== this.statusGeneration) {
				continue
			}
			if (
				this.connection &&
				!nextSnapshot.workspaces.some(
					(workspace) =>
						workspace.access !== 'off' &&
						workspace.credentialRevision === this.connection?.credentialRevision
				)
			) {
				this.hideConnection()
			}
			this.snapshot = nextSnapshot
			return nextSnapshot
		}
		return null
	}

	private applyStatus = (status: MCPWorkspaceStatus): void => {
		if (this.disposed) {
			return
		}
		this.statusGeneration += 1
		if (!this.snapshot) {
			return
		}
		const previous = this.snapshot.workspaces.find(
			(workspace) => workspace.workspaceID === status.workspaceID
		)
		if (!previous) {
			void this.refresh()
			return
		}
		if (
			previous.access !== status.access ||
			previous.globalEnabled !== status.globalEnabled ||
			previous.memoryEnabled !== status.memoryEnabled ||
			previous.credentialRevision !== status.credentialRevision
		) {
			this.hideConnection()
		}
		this.snapshot = {
			enabled: status.globalEnabled,
			memoryEnabled: status.memoryEnabled,
			workspaces: this.snapshot.workspaces.map((workspace) =>
				workspace.workspaceID === status.workspaceID
					? { ...status, label: workspace.label }
					: workspace
			)
		}
	}
}
