import { randomUUID } from 'node:crypto'
import {
	chmod,
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	rm,
	type FileHandle
} from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { nodeErrorCode } from '../validation'

const workspaceIDPattern = /^[a-f0-9]{64}$/
const authorizationFileSuffix = '.authorization'
const authorizationRequiredFileSuffix = '.authorization-required'
const authorizationTemporaryFilePattern = /^[a-f0-9]{64}\.authorization\.[a-f0-9-]+\.tmp$/
const StoredRemoteAuthorizationSchema = v.pipe(
	v.nullish(v.string(), ''),
	v.trim(),
	v.maxLength(8_192, 'The remote Authorization value is invalid.'),
	v.check((value) => !/[\r\n]/.test(value), 'The remote Authorization value is invalid.'),
	v.transform((value) => value || null)
)

export type RemoteAuthorizationCodec = {
	isSecure(): boolean
	encrypt(value: string): Buffer
	decrypt(value: Buffer): string
}

export class RemoteAuthorizationStore {
	private operationTail = Promise.resolve()

	constructor(
		private readonly directoryPath: string,
		private readonly codec: RemoteAuthorizationCodec
	) {}

	get(workspaceID: string): Promise<string | null> {
		return this.runExclusive(() => this.getStored(workspaceID))
	}

	set(workspaceID: string, authorization: string | null): Promise<void> {
		return this.runExclusive(() => this.setStored(workspaceID, authorization))
	}

	prune(retainedWorkspaceIDs: ReadonlySet<string>): Promise<void> {
		return this.runExclusive(() => this.pruneStored(retainedWorkspaceIDs))
	}

	reserve(workspaceID: string, authorization: string | null): Promise<void> {
		return this.runExclusive(() => this.reserveStored(workspaceID, authorization))
	}

	assertCanPersist(authorization: string | null): void {
		if (authorization && !this.codec.isSecure()) {
			throw secureStorageUnavailableError()
		}
	}

	private async getStored(workspaceID: string): Promise<string | null> {
		const filePath = this.filePath(workspaceID)
		try {
			const encrypted = await readFile(filePath)
			await this.assertSecureStorage(workspaceID)
			return v.parse(StoredRemoteAuthorizationSchema, this.codec.decrypt(encrypted))
		} catch (error) {
			if (nodeErrorCode(error) === 'ENOENT') {
				await this.rejectMissingRequiredCredential(workspaceID)
				return null
			}
			throw error
		}
	}

	private async setStored(workspaceID: string, authorization: string | null): Promise<void> {
		const filePath = this.filePath(workspaceID)
		if (!authorization) {
			await Promise.all([
				rm(filePath, { force: true }),
				rm(this.requiredFilePath(workspaceID), { force: true })
			])
			return
		}
		await this.assertSecureStorage(workspaceID)
		await this.ensureAuthorizationRequiredMarker(workspaceID)

		await this.ensureDirectory()
		const temporaryPath = `${filePath}.${randomUUID()}.tmp`
		let handle: FileHandle | undefined
		let temporaryExists = false
		try {
			handle = await open(temporaryPath, 'wx', 0o600)
			temporaryExists = true
			await handle.writeFile(this.codec.encrypt(authorization))
			await handle.sync()
			await handle.close()
			handle = undefined
			await rename(temporaryPath, filePath)
			temporaryExists = false
			await syncDirectory(this.directoryPath).catch(() => undefined)
		} finally {
			if (handle) {
				await handle.close().catch(() => undefined)
			}
			if (temporaryExists) {
				await rm(temporaryPath, { force: true })
			}
		}
	}

	private async pruneStored(retainedWorkspaceIDs: ReadonlySet<string>): Promise<void> {
		let entries: string[]
		try {
			entries = await readdir(this.directoryPath)
		} catch (error) {
			if (nodeErrorCode(error) === 'ENOENT') {
				return
			}
			throw error
		}
		await Promise.all(
			entries.map(async (entry) => {
				if (authorizationTemporaryFilePattern.test(entry)) {
					await rm(path.join(this.directoryPath, entry), { force: true })
					return
				}
				const authorizationWorkspaceID = workspaceIDFromFile(entry, authorizationFileSuffix)
				if (authorizationWorkspaceID) {
					if (!retainedWorkspaceIDs.has(authorizationWorkspaceID)) {
						await rm(path.join(this.directoryPath, entry), { force: true })
					} else if (!this.codec.isSecure()) {
						await this.requireReauthorization(authorizationWorkspaceID)
					}
					return
				}
				const requiredWorkspaceID = workspaceIDFromFile(entry, authorizationRequiredFileSuffix)
				if (requiredWorkspaceID && !retainedWorkspaceIDs.has(requiredWorkspaceID)) {
					await rm(path.join(this.directoryPath, entry), { force: true })
				}
			})
		)
	}

	private async reserveStored(workspaceID: string, authorization: string | null): Promise<void> {
		if (!authorization) {
			return
		}
		this.assertCanPersist(authorization)
		await this.ensureAuthorizationRequiredMarker(workspaceID)
	}

	private filePath(workspaceID: string): string {
		if (!workspaceIDPattern.test(workspaceID)) {
			throw new TypeError('Remote workspace credentials require a canonical workspace ID.')
		}
		return path.join(this.directoryPath, `${workspaceID}${authorizationFileSuffix}`)
	}

	private requiredFilePath(workspaceID: string): string {
		return path.join(this.directoryPath, `${workspaceID}${authorizationRequiredFileSuffix}`)
	}

	private runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
		const result = this.operationTail.then(operation)
		this.operationTail = result.then(
			() => undefined,
			() => undefined
		)
		return result
	}

	private async ensureDirectory(): Promise<void> {
		await mkdir(this.directoryPath, { recursive: true, mode: 0o700 })
		if (process.platform !== 'win32') {
			await chmod(this.directoryPath, 0o700)
		}
	}

	private async rejectMissingRequiredCredential(workspaceID: string): Promise<void> {
		try {
			await readFile(this.requiredFilePath(workspaceID))
		} catch (error) {
			if (nodeErrorCode(error) === 'ENOENT') {
				return
			}
			throw error
		}
		throw requiredCredentialMissingError()
	}

	private async requireReauthorization(workspaceID: string): Promise<void> {
		await this.ensureAuthorizationRequiredMarker(workspaceID)
		await rm(this.filePath(workspaceID), { force: true })
		await syncDirectory(this.directoryPath).catch(() => undefined)
	}

	private async ensureAuthorizationRequiredMarker(workspaceID: string): Promise<void> {
		this.filePath(workspaceID)
		await this.ensureDirectory()
		const requiredPath = this.requiredFilePath(workspaceID)
		let markerExists = false
		try {
			await readFile(requiredPath)
			markerExists = true
		} catch (error) {
			if (nodeErrorCode(error) !== 'ENOENT') {
				throw error
			}
		}
		if (!markerExists) {
			const handle = await open(requiredPath, 'wx', 0o600)
			try {
				await handle.sync()
			} finally {
				await handle.close()
			}
		}
		await syncDirectory(this.directoryPath)
	}

	private async assertSecureStorage(workspaceID: string): Promise<void> {
		if (!this.codec.isSecure()) {
			await this.requireReauthorization(workspaceID)
			throw secureStorageUnavailableError()
		}
	}
}

async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') {
		return
	}
	const handle = await open(directory, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

function workspaceIDFromFile(entry: string, suffix: string): string | null {
	if (!entry.endsWith(suffix)) {
		return null
	}
	const workspaceID = entry.slice(0, -suffix.length)
	return workspaceIDPattern.test(workspaceID) ? workspaceID : null
}

function secureStorageUnavailableError(): Error {
	return new Error(
		'Secure credential storage is unavailable. Configure a system keyring and reconnect this remote workspace.'
	)
}

function requiredCredentialMissingError(): Error {
	return new Error(
		'Remote Authorization is required, but its secure credential is unavailable. Reconnect this workspace.'
	)
}
