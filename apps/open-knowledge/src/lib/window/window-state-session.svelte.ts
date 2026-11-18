import type { WindowAPI } from './api'

export type WindowStateAPI = Pick<
	WindowAPI,
	'getState' | 'onMaximizedChange' | 'minimize' | 'toggleMaximize' | 'close'
>

export class WindowStateSession {
	maximized = $state(false)

	private maximizedGeneration = 0
	private started = false
	private disposed = false
	private unsubscribe: (() => void) | undefined

	constructor(private readonly api: WindowStateAPI | null) {}

	start = (): void => {
		if (this.started || this.disposed) {
			return
		}
		this.started = true
		if (!this.api) {
			return
		}

		const generation = this.maximizedGeneration
		this.unsubscribe = this.api.onMaximizedChange(this.applyMaximized)
		void this.api
			.getState()
			.then((state) => {
				if (!this.disposed && generation === this.maximizedGeneration) {
					this.maximized = state.maximized
				}
			})
			.catch(() => undefined)
	}

	dispose = (): void => {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.unsubscribe?.()
		this.unsubscribe = undefined
	}

	minimize = (): void => {
		if (!this.disposed) {
			void this.api?.minimize()
		}
	}

	toggleMaximize = (): void => {
		if (!this.disposed) {
			void this.api?.toggleMaximize()
		}
	}

	close = (): void => {
		if (!this.disposed) {
			void this.api?.close()
		}
	}

	private applyMaximized = (maximized: boolean): void => {
		if (this.disposed) {
			return
		}
		this.maximizedGeneration += 1
		this.maximized = maximized
	}
}
