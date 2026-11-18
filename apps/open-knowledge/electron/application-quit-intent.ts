/** Retain an explicit app quit while dirty windows finish the existing save-and-close flow. */
export class ApplicationQuitIntent {
	private requested = false
	private readonly savingWindows = new Set<number>()
	private retryScheduled = false

	constructor(
		private readonly resumeQuit: () => void,
		private readonly schedule: (callback: () => void) => void = (callback) => {
			setImmediate(callback)
		}
	) {}

	requestQuit(): void {
		this.requested = true
	}

	waitForSavedWindow(windowID: number): void {
		if (this.requested) {
			this.savingWindows.add(windowID)
		}
	}

	windowClosed(windowID: number): void {
		if (!this.savingWindows.delete(windowID) || this.savingWindows.size || this.retryScheduled) {
			return
		}
		this.retryScheduled = true
		this.schedule(() => {
			this.retryScheduled = false
			if (this.requested && this.savingWindows.size === 0) {
				// Re-enter app.quit so remaining windows retain their own unload/save checks.
				this.resumeQuit()
			}
		})
	}
}
