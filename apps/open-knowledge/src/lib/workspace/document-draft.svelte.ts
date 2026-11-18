import type { KnowledgeAPI, WorkspaceFile } from '#lib/knowledge/api.js'
import { mutationMessageID, type WorkspaceMessageID } from './workspace-message.translation'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

export class DocumentDraft {
	document = $state<WorkspaceFile | null>(null)
	content = $state('')
	saveState = $state<SaveState>('saved')

	private editGeneration = 0
	private saveRequested = false
	private saveLoop: Promise<void> | undefined
	private saveTimer: ReturnType<typeof setTimeout> | undefined
	private disposed = false
	private saveMessage: WorkspaceMessageID | '' = ''

	constructor(
		private readonly api: KnowledgeAPI,
		private readonly workspaceID: () => string | null,
		private readonly canEdit: () => boolean,
		private readonly reportMessage: (
			message: WorkspaceMessageID | '',
			expected?: WorkspaceMessageID
		) => void
	) {}

	get hasUnsavedChanges(): boolean {
		return this.saveState !== 'saved'
	}

	open(document: WorkspaceFile): void {
		if (this.disposed) {
			return
		}
		clearTimeout(this.saveTimer)
		this.document = document
		this.content = document.content
		this.saveMessage = ''
		this.editGeneration += 1
		this.saveState = 'saved'
	}

	setDocumentAccess(documentAccess: WorkspaceFile['documentAccess']): void {
		if (this.document) {
			this.document = { ...this.document, documentAccess }
			if (documentAccess !== 'writable' && this.hasUnsavedChanges) {
				clearTimeout(this.saveTimer)
				this.saveRequested = false
				this.saveState = 'conflict'
			}
		}
	}

	clear(): void {
		clearTimeout(this.saveTimer)
		this.document = null
		this.content = ''
		this.saveMessage = ''
		this.saveState = 'saved'
	}

	dispose(): void {
		clearTimeout(this.saveTimer)
		this.disposed = true
		this.editGeneration += 1
		this.saveRequested = false
	}

	update(content: string): void {
		if (
			this.disposed ||
			!this.canEdit() ||
			this.document?.documentAccess !== 'writable' ||
			content === this.content
		) {
			return
		}
		this.content = content
		this.editGeneration += 1
		this.saveState = 'dirty'
		this.clearSaveMessage()
		clearTimeout(this.saveTimer)
		if (this.saveLoop) {
			this.saveRequested = true
		}
		this.saveTimer = setTimeout(() => void this.save(), 800)
	}

	async save(): Promise<void> {
		clearTimeout(this.saveTimer)
		if (
			this.disposed ||
			!this.canEdit() ||
			this.document?.documentAccess !== 'writable' ||
			this.saveState === 'conflict'
		) {
			return
		}
		this.saveRequested = true
		this.saveLoop ??= this.runSaveLoop()
		await this.saveLoop
	}

	async flush(): Promise<boolean> {
		if (!this.document || !this.hasUnsavedChanges) {
			return true
		}
		await this.save()
		return !this.hasUnsavedChanges
	}

	private async runSaveLoop(): Promise<void> {
		try {
			while (this.saveRequested && this.saveState !== 'conflict') {
				this.saveRequested = false
				await this.performSave()
			}
		} finally {
			this.saveLoop = undefined
		}
	}

	private async performSave(): Promise<void> {
		if (this.disposed) {
			return
		}
		const workspaceID = this.workspaceID()
		const document = this.document
		if (!workspaceID || document?.documentAccess !== 'writable') {
			return
		}
		const candidate = this.content
		if (candidate === document.content) {
			this.saveState = 'saved'
			return
		}

		const capturedGeneration = this.editGeneration
		this.saveState = 'saving'
		try {
			const result = await this.api.writeFile({
				workspaceID,
				id: document.id,
				path: document.path,
				expectedRevision: document.revision,
				expectedContentHash: document.contentHash,
				content: candidate,
				...(document.mediaType ? { mediaType: document.mediaType } : {})
			})
			if (this.disposed || this.document?.id !== document.id) {
				return
			}
			if (this.document.documentAccess !== 'writable') {
				this.saveState = 'conflict'
				return
			}
			if (!result.ok) {
				this.saveState =
					result.error.code === 'revision_conflict' || result.error.code === 'content_conflict'
						? 'conflict'
						: 'error'
				this.saveMessage = mutationMessageID(result.error, 'save')
				this.reportMessage(this.saveMessage)
				return
			}
			const saved: WorkspaceFile = {
				...result.value.file,
				documentAccess: this.document?.documentAccess ?? document.documentAccess,
				content: candidate
			}
			this.document = saved
			this.clearSaveMessage()
			if (capturedGeneration === this.editGeneration) {
				this.content = saved.content
				this.saveState = 'saved'
			} else {
				this.saveState = 'dirty'
				this.saveRequested = true
			}
		} catch {
			if (this.disposed || this.document?.id !== document.id) {
				return
			}
			if (this.document.documentAccess !== 'writable') {
				if (this.hasUnsavedChanges) {
					this.saveState = 'conflict'
				}
				return
			}
			this.saveState = 'error'
			this.saveMessage = 'error.document.save'
			this.reportMessage(this.saveMessage)
		}
	}

	private clearSaveMessage(): void {
		if (this.saveMessage) {
			this.reportMessage('', this.saveMessage)
			this.saveMessage = ''
		}
	}
}
