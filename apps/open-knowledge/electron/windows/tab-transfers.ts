import type { KnowledgeBundlePath } from '../../src/lib/knowledge/api'

export type TabTransferWindowPresentation = 'workspace' | 'editor'
export type TabTransferState = 'pending' | 'accepted' | 'committed' | 'rejected'

export type TabTransferRegistration = {
	token: string
	sourceWebContentsID: number
	workspaceID: string
	documentPath: KnowledgeBundlePath
	sourceTabID: string
}

export type TabTransferDestination = {
	webContentsID: number
	workspaceID: string
	presentation: TabTransferWindowPresentation
}

export type AcceptedTabTransfer = {
	token: string
	documentPath: KnowledgeBundlePath
}

export type CommittedTabTransfer = {
	sourceWebContentsID: number
	sourceTabID: string
}

type TransferRecord = TabTransferRegistration & {
	state: TabTransferState
	destinationWebContentsID: number | null
	expiresAt: number
	expiryTimer: ReturnType<typeof setTimeout>
}

type AcceptanceWaiter = {
	destination: TabTransferDestination
	resolve: (transfer: AcceptedTabTransfer) => void
	reject: (error: Error) => void
	timer: ReturnType<typeof setTimeout>
}

type TabTransfersOptions = {
	ttlMs?: number
	acceptanceWaitMs?: number
	now?: () => number
}

export class TabTransfers {
	private readonly transfers = new Map<string, TransferRecord>()
	private readonly waiters = new Map<string, Set<AcceptanceWaiter>>()
	private readonly ttlMs: number
	private readonly acceptanceWaitMs: number
	private readonly now: () => number

	constructor(options: TabTransfersOptions = {}) {
		this.ttlMs = options.ttlMs ?? 30_000
		this.acceptanceWaitMs = options.acceptanceWaitMs ?? 3_000
		this.now = options.now ?? Date.now
	}

	register(input: TabTransferRegistration): void {
		this.cleanExpired()
		if (this.transfers.has(input.token)) {
			throw new Error('The tab transfer token is already registered.')
		}

		const record: TransferRecord = {
			...input,
			state: 'pending',
			destinationWebContentsID: null,
			expiresAt: this.now() + this.ttlMs,
			expiryTimer: this.expiryTimer(input.token, this.ttlMs)
		}
		this.transfers.set(input.token, record)
		this.settleWaiters(record)
	}

	async accept(token: string, destination: TabTransferDestination): Promise<AcceptedTabTransfer> {
		this.cleanExpired()
		const record = this.transfers.get(token)
		if (record) {
			return this.acceptRegistered(record, destination)
		}

		return new Promise<AcceptedTabTransfer>((resolve, reject) => {
			const waiter: AcceptanceWaiter = {
				destination,
				resolve,
				reject,
				timer: setTimeout(() => {
					this.removeWaiter(token, waiter)
					reject(new Error('The tab transfer was not registered in time.'))
				}, this.acceptanceWaitMs)
			}
			waiter.timer.unref?.()
			const tokenWaiters = this.waiters.get(token) ?? new Set<AcceptanceWaiter>()
			tokenWaiters.add(waiter)
			this.waiters.set(token, tokenWaiters)
		})
	}

	commit(token: string, destinationWebContentsID: number): CommittedTabTransfer {
		this.cleanExpired()
		const record = this.transfers.get(token)
		if (!record) {
			throw new Error('The tab transfer is no longer available.')
		}
		if (
			record.state !== 'accepted' ||
			record.destinationWebContentsID !== destinationWebContentsID
		) {
			throw new Error('Only the accepting destination can commit this tab transfer once.')
		}
		record.state = 'committed'
		return {
			sourceWebContentsID: record.sourceWebContentsID,
			sourceTabID: record.sourceTabID
		}
	}

	cancel(token: string, sourceWebContentsID: number): boolean {
		this.cleanExpired()
		const record = this.transfers.get(token)
		if (!record) {
			return false
		}
		this.assertSource(record, sourceWebContentsID)
		if (record.state !== 'pending') {
			throw new Error('A claimed tab transfer cannot be cancelled by its source.')
		}
		this.removeRecord(record)
		return true
	}

	status(token: string, sourceWebContentsID: number): TabTransferState | null {
		this.cleanExpired()
		const record = this.transfers.get(token)
		if (!record) {
			return null
		}
		this.assertSource(record, sourceWebContentsID)
		return record.state
	}

	removeWebContents(webContentsID: number): void {
		for (const record of [...this.transfers.values()]) {
			if (
				record.sourceWebContentsID === webContentsID ||
				record.destinationWebContentsID === webContentsID
			) {
				this.removeRecord(record)
			}
		}
		for (const [token, tokenWaiters] of this.waiters) {
			for (const waiter of [...tokenWaiters]) {
				if (waiter.destination.webContentsID === webContentsID) {
					this.rejectWaiter(token, waiter, 'The destination window was closed.')
				}
			}
		}
	}

	cleanExpired(): void {
		const now = this.now()
		for (const record of [...this.transfers.values()]) {
			if (record.expiresAt <= now) {
				this.removeRecord(record)
			}
		}
	}

	dispose(): void {
		for (const record of [...this.transfers.values()]) {
			this.removeRecord(record)
		}
		for (const [token, tokenWaiters] of this.waiters) {
			for (const waiter of [...tokenWaiters]) {
				this.rejectWaiter(token, waiter, 'Tab transfers are shutting down.')
			}
		}
	}

	private acceptRegistered(
		record: TransferRecord,
		destination: TabTransferDestination
	): AcceptedTabTransfer {
		if (record.state !== 'pending') {
			throw new Error('The tab transfer has already been claimed.')
		}
		if (record.sourceWebContentsID === destination.webContentsID) {
			this.rejectTransfer(record, destination.webContentsID)
			throw new Error('A tab transfer must target a different window.')
		}
		if (record.workspaceID !== destination.workspaceID) {
			this.rejectTransfer(record, destination.webContentsID)
			throw new Error('Tabs can only be moved between windows of the same workspace.')
		}
		if (destination.presentation !== 'workspace') {
			this.rejectTransfer(record, destination.webContentsID)
			throw new Error('Dedicated document windows do not accept tab transfers.')
		}

		record.state = 'accepted'
		record.destinationWebContentsID = destination.webContentsID
		this.refreshExpiry(record)
		return { token: record.token, documentPath: record.documentPath }
	}

	private rejectTransfer(record: TransferRecord, destinationWebContentsID: number): void {
		record.state = 'rejected'
		record.destinationWebContentsID = destinationWebContentsID
		this.refreshExpiry(record)
	}

	private settleWaiters(record: TransferRecord): void {
		const tokenWaiters = this.waiters.get(record.token)
		if (!tokenWaiters) {
			return
		}
		this.waiters.delete(record.token)
		for (const waiter of tokenWaiters) {
			clearTimeout(waiter.timer)
			try {
				waiter.resolve(this.acceptRegistered(record, waiter.destination))
			} catch (error) {
				waiter.reject(asError(error))
			}
		}
	}

	private assertSource(record: TransferRecord, sourceWebContentsID: number): void {
		if (record.sourceWebContentsID !== sourceWebContentsID) {
			throw new Error('Only the source window owns this tab transfer.')
		}
	}

	private refreshExpiry(record: TransferRecord): void {
		clearTimeout(record.expiryTimer)
		record.expiresAt = this.now() + this.ttlMs
		record.expiryTimer = this.expiryTimer(record.token, this.ttlMs)
	}

	private expiryTimer(token: string, delay: number): ReturnType<typeof setTimeout> {
		const timer = setTimeout(() => {
			const record = this.transfers.get(token)
			if (record) {
				this.removeRecord(record)
			}
		}, delay)
		timer.unref?.()
		return timer
	}

	private removeRecord(record: TransferRecord): void {
		if (this.transfers.get(record.token) !== record) {
			return
		}
		clearTimeout(record.expiryTimer)
		this.transfers.delete(record.token)
	}

	private removeWaiter(token: string, waiter: AcceptanceWaiter): void {
		const tokenWaiters = this.waiters.get(token)
		if (!tokenWaiters) {
			return
		}
		tokenWaiters.delete(waiter)
		if (tokenWaiters.size === 0) {
			this.waiters.delete(token)
		}
	}

	private rejectWaiter(token: string, waiter: AcceptanceWaiter, message: string): void {
		clearTimeout(waiter.timer)
		this.removeWaiter(token, waiter)
		waiter.reject(new Error(message))
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error('The tab transfer failed.')
}
