export class InvalidBundlePathError extends Error {
	override readonly name = 'InvalidBundlePathError'
}

export function isCanonicalBundlePath(bundlePath: string): boolean {
	if (bundlePath === '') {
		return true
	}
	if (bundlePath.includes('\\') || bundlePath.startsWith('/') || bundlePath.includes('\0')) {
		return false
	}
	return bundlePath
		.split('/')
		.every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}

export function parseBundlePath(bundlePath: string): string[] {
	if (!isCanonicalBundlePath(bundlePath)) {
		throw new InvalidBundlePathError('Use a canonical bundle-relative path.')
	}
	return bundlePath ? bundlePath.split('/') : []
}

export function joinBundlePath(parentPath: string, name: string): string {
	return parentPath ? `${parentPath}/${name}` : name
}

export function parentBundlePath(bundlePath: string): string {
	return parseBundlePath(bundlePath).slice(0, -1).join('/')
}

export function isMarkdownDocumentPath(bundlePath: string): boolean {
	return bundlePath.toLowerCase().endsWith('.md')
}

export function isReservedKnowledgeDocument(bundlePath: string): boolean {
	const name = bundlePath.slice(bundlePath.lastIndexOf('/') + 1)
	return name === 'index.md' || name === 'log.md'
}
