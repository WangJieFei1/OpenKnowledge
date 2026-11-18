import type { OpenKnowledgeAPI } from '#lib/desktop/api.js'
import type { Workspace } from '#lib/knowledge/api.js'
import type {
	WorkspaceSelectorBrowseErrorCode,
	WorkspaceSelectorConnectInput
} from '#lib/workspace/selector-api.js'
import { createSubscriber } from 'svelte/reactivity'
import type { WorkspaceSelectorMessageID } from './page.translation'
import { errorDetail } from './workspace-display'

const folderBrowseMessageIDs: Record<WorkspaceSelectorBrowseErrorCode, WorkspaceSelectorMessageID> =
	{
		'picker-unavailable': 'folderPickerUnavailable',
		'folder-not-found': 'folderNotFound',
		'folder-permission-denied': 'folderPermissionDenied',
		'folder-not-directory': 'folderNotDirectory',
		'folder-root-not-supported': 'folderRootNotSupported',
		'folder-unavailable': 'folderUnavailable',
		'storage-full': 'workspaceStorageFull',
		'storage-unavailable': 'workspaceStorageUnavailable',
		unexpected: 'folderOpenUnexpected'
	}

export class WorkspaceSelectorController {
	#recentWorkspaces: Workspace[] = []
	#loading = true
	#selectingID: string | null = null
	#messageID: WorkspaceSelectorMessageID | null = null
	#messageDetail: string | null = null
	#update: (() => void) | undefined
	#subscribe = createSubscriber((update) => {
		this.#update = update
		return () => {
			this.#update = undefined
		}
	})
	private started = false
	private disposed = false

	constructor(private readonly api: OpenKnowledgeAPI | null) {}

	get recentWorkspaces(): Workspace[] {
		this.#subscribe()
		return this.#recentWorkspaces
	}

	get loading(): boolean {
		this.#subscribe()
		return this.#loading
	}

	get selectingID(): string | null {
		this.#subscribe()
		return this.#selectingID
	}

	get messageID(): WorkspaceSelectorMessageID | null {
		this.#subscribe()
		return this.#messageID
	}

	get messageDetail(): string | null {
		this.#subscribe()
		return this.#messageDetail
	}

	get available(): boolean {
		return this.api !== null
	}

	get busy(): boolean {
		this.#subscribe()
		return Boolean(this.#selectingID)
	}

	async start(): Promise<void> {
		if (this.started || this.disposed) {
			return
		}
		this.started = true
		if (!this.api) {
			this.#loading = false
			this.showMessage('runtimeUnavailable')
			return
		}

		try {
			const snapshot = await this.api.workspaceSelector.getSnapshot()
			if (!this.disposed) {
				this.#recentWorkspaces = snapshot.recentWorkspaces
				this.#update?.()
			}
		} catch {
			this.showMessage('recentWorkspacesFailed')
		} finally {
			if (!this.disposed) {
				this.#loading = false
				this.#update?.()
			}
		}
	}

	dispose(): void {
		this.disposed = true
	}

	async browse(): Promise<void> {
		if (!this.api || this.#selectingID || this.disposed) {
			return
		}
		this.clearMessage()
		try {
			const result = await this.api.workspaceSelector.browse()
			if (this.disposed) {
				return
			}
			if (result.status === 'selected') {
				await this.select(result.workspace)
			} else if (result.status === 'failed') {
				this.showMessage(folderBrowseMessageIDs[result.error.code], result.error.detail)
			}
		} catch (error) {
			this.showMessage('folderOpenUnexpected', errorDetail(error))
		}
	}

	async connectRemote(input: WorkspaceSelectorConnectInput): Promise<boolean> {
		if (!this.api || this.#selectingID || this.disposed) {
			return false
		}
		this.clearMessage()
		try {
			const workspace = await this.api.workspaceSelector.connect(input)
			if (this.disposed) {
				return false
			}
			await this.select(workspace)
			return true
		} catch {
			return false
		}
	}

	async select(workspace: Workspace): Promise<void> {
		if (!this.api || this.#selectingID || this.disposed) {
			return
		}
		this.#selectingID = workspace.id
		this.clearMessage()
		try {
			await this.api.workspaceSelector.select({ workspaceID: workspace.id })
		} catch (error) {
			if (this.disposed) {
				return
			}
			this.#selectingID = null
			this.showMessage('workspaceOpenFailed', errorDetail(error))
		}
	}

	async openSettings(): Promise<void> {
		if (!this.api || this.disposed) {
			return
		}
		if (this.#messageID === 'settingsOpenFailed') {
			this.clearMessage()
		}
		try {
			await this.api.window.openApplicationSettings()
		} catch (error) {
			this.showMessage('settingsOpenFailed', errorDetail(error))
		}
	}

	clearMessage(): void {
		if (this.disposed) {
			return
		}
		this.#messageID = null
		this.#messageDetail = null
		this.#update?.()
	}

	private showMessage(id: WorkspaceSelectorMessageID, detail?: string | null): void {
		if (this.disposed) {
			return
		}
		this.#messageID = id
		this.#messageDetail = detail ?? null
		this.#update?.()
	}
}
