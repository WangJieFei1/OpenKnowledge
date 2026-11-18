import { EventEmitter } from 'node:events'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** Native inference must not share a process with Electron's main thread. Terminating an
 * ONNX worker while a native callback is pending can otherwise abort the whole application. */
export class InferenceProcess extends EventEmitter {
	private readonly send: (message: object) => void
	private readonly kill: () => void
	private readonly finished: Promise<number>
	private stopping = false

	constructor(entry: URL, assetsDirectory: string, cacheDirectory: string) {
		super()
		let finish!: (code: number) => void
		this.finished = new Promise<number>((resolve) => {
			finish = resolve
		})
		let exited = false
		const onExit = (code: number | null) => {
			if (exited) {
				return
			}
			exited = true
			finish(code ?? 1)
			this.emit('exit', code ?? 1)
		}
		const args = [assetsDirectory, cacheDirectory]
		if (process.versions.electron && process.type === 'browser') {
			// Electron's packaged RunAsNode fuse is disabled. Use its supported Node utility
			// process API instead of child_process.fork(process.execPath).
			const { utilityProcess } = createRequire(import.meta.url)(
				'electron'
			) as typeof import('electron')
			const child = utilityProcess.fork(fileURLToPath(entry), args, {
				stdio: 'ignore',
				serviceName: 'Open Knowledge local embeddings'
			})
			child.on('message', (message: unknown) => this.emit('message', message))
			child.on('error', () => this.emit('error', new Error('Local inference process failed.')))
			child.once('exit', onExit)
			this.send = (message) => child.postMessage(message)
			this.kill = () => {
				if (exited) {
					return
				}
				if (child.pid === undefined) {
					child.once('spawn', () => child.kill())
				} else {
					child.kill()
				}
			}
		} else {
			const child = fork(fileURLToPath(entry), args, {
				execArgv: [],
				stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
				serialization: 'advanced'
			})
			child.on('message', (message: unknown) => this.emit('message', message))
			child.on('error', () => {
				this.emit('error', new Error('Local inference process failed.'))
				if (child.pid === undefined) {
					onExit(1)
				}
			})
			child.once('exit', onExit)
			this.send = (message) => {
				child.send(message, (error) => {
					if (error && !exited) {
						this.emit('error', new Error('Local inference process failed.'))
					}
				})
			}
			this.kill = () => {
				if (!exited) {
					child.kill()
				}
			}
		}
	}

	postMessage(message: object): void {
		this.send(message)
	}

	terminate(): Promise<number> {
		if (!this.stopping) {
			this.stopping = true
			this.kill()
		}
		return this.finished
	}
}
