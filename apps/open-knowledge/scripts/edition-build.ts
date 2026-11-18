import type { AppEdition } from '../src/lib/app-edition'

export function editionManifest(edition: Readonly<AppEdition>, version: string) {
	return {
		schema: 1,
		edition: edition.id,
		name: edition.name,
		bundleID: edition.bundleID,
		executableName: edition.executableName,
		codexMemory: edition.codexMemory,
		version
	}
}

/** Prevent packaging stale Codex code under a General label (or mixing renderer and main). */
export function assertEditionManifest(
	value: unknown,
	edition: Readonly<AppEdition>,
	version: string
): void {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Missing edition build manifest. Rebuild the requested edition first.')
	}
	const expected = editionManifest(edition, version)
	for (const [key, entry] of Object.entries(expected)) {
		if ((value as Record<string, unknown>)[key] !== entry) {
			throw new Error(`Edition build mismatch (${key}). Rebuild ${edition.name} ${version} first.`)
		}
	}
}
