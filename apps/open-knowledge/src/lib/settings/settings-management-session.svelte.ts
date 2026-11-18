import {
	defaultApplicationSettings,
	type ApplicationSettingKey,
	type ApplicationSettings,
	type SettingsAPI,
	type SettingsScope,
	type SettingsSnapshot,
	type UpdateApplicationSettingsInput
} from './api'

export type SettingsManagementErrorKey = 'settingsLoadFailed' | 'settingsSaveFailed'

let retainedScope: SettingsScope = 'global'

export class SettingsManagementSession {
	snapshot = $state<SettingsSnapshot>({
		workspaceID: null,
		localWorkspace: false,
		global: {},
		project: {},
		resolved: defaultApplicationSettings
	})
	scope = $state<SettingsScope>(retainedScope)
	loading = $state(true)
	errorKey = $state<SettingsManagementErrorKey | null>(null)

	private request = 0
	private started = false
	private disposed = false
	private temporaryProjectFallback = false
	private unsubscribe: (() => void) | undefined

	constructor(private readonly api: SettingsAPI) {}

	get settings(): ApplicationSettings {
		return this.scope === 'project'
			? this.snapshot.resolved
			: { ...defaultApplicationSettings, ...this.snapshot.global }
	}

	get overrideCount(): number {
		return Object.keys(this.scope === 'project' ? this.snapshot.project : this.snapshot.global)
			.length
	}

	async start(): Promise<void> {
		if (this.started || this.disposed) {
			return
		}
		this.started = true
		this.unsubscribe = this.api.onChange(() => {
			void this.refresh()
		})
		await this.load(true)
	}

	refresh(): Promise<void> {
		return this.load(false)
	}

	dispose(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.request += 1
		this.unsubscribe?.()
		this.unsubscribe = undefined
	}

	selectScope(nextScope: SettingsScope): void {
		if (this.disposed) {
			return
		}
		this.scope = nextScope
		retainedScope = nextScope
		this.temporaryProjectFallback = false
	}

	async update(input: UpdateApplicationSettingsInput): Promise<void> {
		if (this.disposed) {
			return
		}
		this.errorKey = null
		const workspaceID = this.snapshot.workspaceID
		const scope = this.scope
		try {
			await this.api.update({ workspaceID, scope, patch: input })
			if (!this.disposed) {
				await this.refresh()
			}
		} catch {
			if (!this.disposed) {
				this.errorKey = 'settingsSaveFailed'
			}
		}
	}

	async resetScope(): Promise<void> {
		if (this.disposed) {
			return
		}
		const scope = this.scope
		const keys = Object.keys(
			scope === 'project' ? this.snapshot.project : this.snapshot.global
		) as ApplicationSettingKey[]
		if (keys.length === 0) {
			return
		}
		this.errorKey = null
		const workspaceID = this.snapshot.workspaceID
		try {
			await this.api.reset({ workspaceID, scope, keys })
			if (!this.disposed) {
				await this.refresh()
			}
		} catch {
			if (!this.disposed) {
				this.errorKey = 'settingsSaveFailed'
			}
		}
	}

	dismissError(): void {
		if (!this.disposed) {
			this.errorKey = null
		}
	}

	private async load(reportError: boolean): Promise<void> {
		if (this.disposed) {
			return
		}
		const currentRequest = ++this.request
		try {
			const nextSnapshot = await this.api.inspect()
			if (this.disposed || currentRequest !== this.request) {
				return
			}
			this.snapshot = nextSnapshot
			if (!nextSnapshot.workspaceID) {
				if (this.scope === 'project' || this.temporaryProjectFallback) {
					this.scope = 'global'
					retainedScope = 'global'
					this.temporaryProjectFallback = false
				}
			} else if (this.temporaryProjectFallback) {
				this.scope = retainedScope
				this.temporaryProjectFallback = false
			}
			this.errorKey = null
		} catch {
			if (!this.disposed && currentRequest === this.request) {
				if (!this.snapshot.workspaceID && this.scope === 'project') {
					this.scope = 'global'
					this.temporaryProjectFallback = true
				}
				if (reportError) {
					this.errorKey = 'settingsLoadFailed'
				}
			}
		} finally {
			if (!this.disposed && currentRequest === this.request) {
				this.loading = false
			}
		}
	}
}
