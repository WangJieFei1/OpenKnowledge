import { lstatSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { AppEdition } from '../src/lib/app-edition'

interface ApplicationIdentity {
	setName(name: string): void
	getPath(name: 'appData'): string
	setPath(name: 'userData' | 'sessionData', value: string): void
}

/** Run before the instance lock or any session, settings store, or MCP bridge is created. */
export function configureEditionIdentity(
	application: ApplicationIdentity,
	edition: Readonly<AppEdition>
): string {
	const userDataPath = path.join(application.getPath('appData'), edition.name)
	mkdirSync(userDataPath, { recursive: true, mode: 0o700 })
	const info = lstatSync(userDataPath)
	if (!info.isDirectory() || info.isSymbolicLink()) {
		throw new Error('Edition application data must be a real directory, not a symbolic link.')
	}
	application.setName(edition.name)
	application.setPath('userData', userDataPath)
	application.setPath('sessionData', userDataPath)
	return userDataPath
}
