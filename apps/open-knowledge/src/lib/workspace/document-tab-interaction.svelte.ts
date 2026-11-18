import {
	hasTabTransfer,
	readTabTransferToken,
	writeTabTransferToken
} from '../window/tab-transfer-data'
import type { WorkspaceDocumentTab, WorkspaceSession } from './workspace-session.svelte'

const TEAR_OFF_CLAIM_DELAY = 140

type PreparedTransfer = {
	tabID: string
	token: string
	ready: Promise<boolean>
}

export type DocumentTabInteractionOptions = {
	createToken?: () => string
	delay?: (milliseconds: number) => Promise<void>
}

export class DocumentTabInteraction {
	draggingTabID = $state<string | null>(null)
	openingDedicatedTabID = $state<string | null>(null)

	private dragCancelled = false
	private localDropCompleted = false
	private dragOriginIndex = -1
	private preparingTransfer: PreparedTransfer | null = null
	private disposed = false
	private readonly createToken: () => string
	private readonly delay: (milliseconds: number) => Promise<void>

	constructor(
		private readonly session: WorkspaceSession,
		options: DocumentTabInteractionOptions = {}
	) {
		this.createToken = options.createToken ?? (() => crypto.randomUUID())
		this.delay =
			options.delay ??
			((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
	}

	dispose(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		const draggedTabID = this.draggingTabID
		const transfer = this.preparingTransfer
		if (draggedTabID) {
			this.restoreDraggedTab(draggedTabID)
		}
		this.draggingTabID = null
		this.openingDedicatedTabID = null
		this.session.draggingTabID = null
		this.preparingTransfer = null
		this.dragCancelled = false
		this.localDropCompleted = false
		this.dragOriginIndex = -1
		this.cancelPreparedTransfer(transfer)
	}

	doubleClick(event: MouseEvent, tab: WorkspaceDocumentTab): void {
		const target = event.target instanceof Element ? event.target : null
		if (!target?.closest('[data-close]')) {
			void this.openDedicated(tab)
		}
	}

	dragStart(event: DragEvent, tab: WorkspaceDocumentTab): void {
		if (this.disposed) {
			return
		}
		const target = event.target instanceof Element ? event.target : null
		if (tab.loading || target?.closest('[data-close]')) {
			event.preventDefault()
			return
		}
		this.dragCancelled = false
		this.localDropCompleted = false
		this.draggingTabID = tab.id
		this.session.draggingTabID = tab.id
		this.dragOriginIndex = this.session.tabs.findIndex((candidate) => candidate.id === tab.id)
		this.session.selectTab(tab.id)
		if (event.dataTransfer) {
			const token = this.createToken()
			event.dataTransfer.clearData()
			event.dataTransfer.effectAllowed = 'copyMove'
			writeTabTransferToken(event.dataTransfer, token)
			this.preparingTransfer = {
				tabID: tab.id,
				token,
				ready: this.session.prepareTabTransfer(tab.id, token)
			}
		}
	}

	dragEnd(event: DragEvent, tab: WorkspaceDocumentTab): void {
		if (this.disposed) {
			return
		}
		const draggedTabID = this.draggingTabID
		const transfer = this.preparingTransfer
		const droppedLocally = this.localDropCompleted
		this.draggingTabID = null
		this.session.draggingTabID = null
		this.preparingTransfer = null
		this.localDropCompleted = false
		if (this.dragCancelled || draggedTabID !== tab.id) {
			if (this.dragCancelled && draggedTabID) {
				this.restoreDraggedTab(draggedTabID)
			}
			this.cancelPreparedTransfer(transfer)
			this.dragCancelled = false
			this.dragOriginIndex = -1
			return
		}

		const trigger = event.currentTarget
		const tabList = trigger instanceof Element ? trigger.closest('[role="tablist"]') : null
		if (!tabList) {
			this.cancelPreparedTransfer(transfer)
			this.dragOriginIndex = -1
			return
		}
		const bounds = tabList.getBoundingClientRect()
		const releasePadding = 8
		const releasedOutside =
			event.clientX < bounds.left - releasePadding ||
			event.clientX > bounds.right + releasePadding ||
			event.clientY < bounds.top - releasePadding ||
			event.clientY > bounds.bottom + releasePadding
		if (droppedLocally || (!releasedOutside && event.dataTransfer?.dropEffect === 'none')) {
			this.cancelPreparedTransfer(transfer)
		} else if (event.dataTransfer?.dropEffect === 'none') {
			void this.tearOffAfterDropDecision(tab.id, transfer)
		}
		this.dragOriginIndex = -1
	}

	dragOver(event: DragEvent, target: WorkspaceDocumentTab): void {
		if (this.disposed) {
			return
		}
		const sourceID = this.draggingTabID
		if (!sourceID && hasTabTransfer(event.dataTransfer)) {
			event.preventDefault()
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move'
			}
			return
		}
		if (!sourceID || sourceID === target.id) {
			return
		}
		event.preventDefault()
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move'
		}
		const sourceIndex = this.session.tabs.findIndex((tab) => tab.id === sourceID)
		const targetIndex = this.session.tabs.findIndex((tab) => tab.id === target.id)
		if (sourceIndex < 0 || targetIndex < 0) {
			return
		}
		const targetElement = event.currentTarget
		if (!(targetElement instanceof Element)) {
			return
		}
		const bounds = targetElement.getBoundingClientRect()
		const midpoint = bounds.left + bounds.width / 2
		if (
			(sourceIndex < targetIndex && event.clientX <= midpoint) ||
			(sourceIndex > targetIndex && event.clientX >= midpoint)
		) {
			return
		}
		this.session.moveTab(sourceID, sourceIndex < targetIndex ? 1 : -1)
	}

	dragOverList(event: DragEvent): void {
		if (this.disposed || (!this.draggingTabID && !hasTabTransfer(event.dataTransfer))) {
			return
		}
		event.preventDefault()
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move'
		}
	}

	dropOnTab(event: DragEvent, target: WorkspaceDocumentTab): void {
		if (this.disposed) {
			return
		}
		event.preventDefault()
		event.stopPropagation()
		if (this.draggingTabID) {
			this.localDropCompleted = true
			return
		}
		const token = readTabTransferToken(event.dataTransfer)
		if (!token) {
			return
		}
		const targetIndex = this.session.tabs.findIndex((tab) => tab.id === target.id)
		const targetElement = event.currentTarget
		const after =
			targetElement instanceof Element &&
			event.clientX > targetElement.getBoundingClientRect().left + targetElement.clientWidth / 2
		void this.session.receiveTabTransfer(token, Math.max(0, targetIndex + (after ? 1 : 0)))
	}

	dropOnList(event: DragEvent): void {
		if (this.disposed) {
			return
		}
		event.preventDefault()
		if (this.draggingTabID) {
			this.localDropCompleted = true
			return
		}
		const token = readTabTransferToken(event.dataTransfer)
		if (token) {
			void this.session.receiveTabTransfer(token)
		}
	}

	cancelDrag(event: KeyboardEvent): void {
		if (!this.disposed && event.key === 'Escape' && this.draggingTabID) {
			this.dragCancelled = true
		}
	}

	async openDedicated(tab: WorkspaceDocumentTab): Promise<void> {
		if (this.disposed || this.openingDedicatedTabID) {
			return
		}
		this.openingDedicatedTabID = tab.id
		try {
			await this.session.openDocumentInNewWindow(tab.path, 'editor')
		} finally {
			this.openingDedicatedTabID = null
		}
	}

	private restoreDraggedTab(tabID: string): void {
		let index = this.session.tabs.findIndex((tab) => tab.id === tabID)
		while (index >= 0 && this.dragOriginIndex >= 0 && index !== this.dragOriginIndex) {
			const direction = index < this.dragOriginIndex ? 1 : -1
			this.session.moveTab(tabID, direction)
			index += direction
		}
	}

	private cancelPreparedTransfer(transfer: PreparedTransfer | null): void {
		if (transfer) {
			void transfer.ready.then((ready) => {
				if (ready) {
					return this.session.cancelTabTransfer(transfer.token)
				}
			})
		}
	}

	private async tearOffAfterDropDecision(
		tabID: string,
		transfer: PreparedTransfer | null
	): Promise<void> {
		if (!transfer || transfer.tabID !== tabID || !(await transfer.ready)) {
			return
		}
		if (this.disposed) {
			await this.session.cancelTabTransfer(transfer.token)
			return
		}
		await this.delay(TEAR_OFF_CLAIM_DELAY)
		if (this.disposed) {
			await this.session.cancelTabTransfer(transfer.token)
			return
		}
		await this.session.tearOffTab(tabID, transfer.token)
	}
}
