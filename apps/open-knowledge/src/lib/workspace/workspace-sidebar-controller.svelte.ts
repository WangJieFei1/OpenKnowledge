import type {
	KnowledgeBundleEntry,
	KnowledgeBundlePath,
	KnowledgeSearchResult
} from '#lib/knowledge/api.js'

const SEARCH_DEBOUNCE_MILLISECONDS = 180

export type WorkspaceSidebarSessionPort = {
	readonly workspace: { readonly id: string } | null
	readonly local: boolean
	readonly entries: readonly KnowledgeBundleEntry[]
	readonly tabs: readonly {
		readonly path: KnowledgeBundlePath
		readonly document: { readonly id: string } | null
	}[]
	search(query: string): Promise<KnowledgeSearchResult | null>
	openDocument(path: KnowledgeBundlePath, id?: string): Promise<boolean>
}

export type WorkspaceSidebarNavigationPort = {
	navigateDocument(
		workspaceID: string,
		path: KnowledgeBundlePath,
		options: { replaceState: boolean }
	): Promise<void>
}

export type WorkspaceSidebarSchedulerPort = {
	schedule(callback: () => void, milliseconds: number): () => void
}

const defaultScheduler: WorkspaceSidebarSchedulerPort = {
	schedule(callback, milliseconds) {
		const timer = setTimeout(callback, milliseconds)
		return () => clearTimeout(timer)
	}
}

export class WorkspaceSidebarController {
	query = $state('')
	searchMatches = $state<KnowledgeSearchResult | null>(null)
	searchLoading = $state(false)
	searchFailed = $state(false)

	private readonly getSession: () => WorkspaceSidebarSessionPort
	private searchRequest = 0
	private openRequest = 0
	private cancelScheduledSearch: (() => void) | undefined
	private disposed = false

	constructor(
		session: WorkspaceSidebarSessionPort | (() => WorkspaceSidebarSessionPort),
		private readonly navigation: WorkspaceSidebarNavigationPort,
		private readonly scheduler: WorkspaceSidebarSchedulerPort = defaultScheduler
	) {
		this.getSession = typeof session === 'function' ? session : () => session
	}

	synchronizeSearch(): void {
		if (this.disposed) {
			return
		}
		this.cancelScheduledSearch?.()
		this.cancelScheduledSearch = undefined

		const searchQuery = this.query.trim()
		const session = this.getSession()
		const local = session.local
		const workspaceID = session.workspace?.id
		const request = ++this.searchRequest
		this.searchMatches = null
		this.searchFailed = false
		const shouldSearch = Boolean(searchQuery && local && workspaceID && session.entries)
		this.searchLoading = shouldSearch
		if (!shouldSearch) {
			return
		}

		this.cancelScheduledSearch = this.scheduler.schedule(() => {
			this.cancelScheduledSearch = undefined
			void session.search(searchQuery).then((result) => {
				if (this.disposed || request !== this.searchRequest) {
					return
				}
				this.searchMatches = result
				this.searchFailed = result === null
				this.searchLoading = false
			})
		}, SEARCH_DEBOUNCE_MILLISECONDS)
	}

	async openEntry(entry: KnowledgeBundleEntry): Promise<void> {
		if (this.disposed) {
			return
		}
		const session = this.getSession()
		const workspaceID = session.workspace?.id
		if (!workspaceID || entry.kind !== 'file') {
			return
		}

		const request = ++this.openRequest
		const opened = await session.openDocument(entry.path, entry.id)
		if (!opened || this.disposed || request !== this.openRequest) {
			return
		}
		const openedPath = session.tabs.find((tab) => tab.document?.id === entry.id)?.path
		await this.navigation.navigateDocument(workspaceID, openedPath ?? entry.path, {
			replaceState: openedPath !== undefined && openedPath !== entry.path
		})
	}

	clearQuery(): void {
		if (!this.disposed) {
			this.query = ''
		}
	}

	dispose(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.searchRequest += 1
		this.openRequest += 1
		this.cancelScheduledSearch?.()
		this.cancelScheduledSearch = undefined
	}
}
