import path from 'node:path'

type PathAPI = Pick<typeof path, 'isAbsolute' | 'normalize'>

export function normalizedSystemPath(candidate: string, pathAPI: PathAPI = path): string {
	const normalized = pathAPI.normalize(candidate)
	if (!pathAPI.isAbsolute(normalized)) {
		throw new Error('Only absolute system paths can be opened.')
	}
	if (/^[\\/]{2}[?.][\\/]/.test(normalized)) {
		throw new Error('Windows device paths cannot be opened.')
	}
	return normalized
}
