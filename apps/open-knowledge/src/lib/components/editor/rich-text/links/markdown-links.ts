import { isMarkdownDocumentPath } from '@open-knowledge/knowledge-bundle'
import { isKnowledgeBundlePath, type KnowledgeBundlePath } from '#lib/knowledge/api.js'
import { isAnydocPath } from '#lib/knowledge/anydoc.js'

export type MarkdownLinkTarget =
	{ kind: 'workspace'; path: KnowledgeBundlePath } | { kind: 'system'; path: string }

const urlScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/
const windowsAbsolutePath = /^[A-Za-z]:[\\/]/

export function resolveMarkdownLinkTarget(
	href: string,
	currentDocumentPath: KnowledgeBundlePath,
	resolveAbsolutePathsFromProjectRoot: boolean
): MarkdownLinkTarget | null {
	const hrefPath = linkPath(href)
	if (!hrefPath) {
		return null
	}

	let decodedPath: string
	try {
		decodedPath = decodeURIComponent(hrefPath)
	} catch {
		return null
	}

	if (isAbsoluteFilesystemPath(decodedPath)) {
		if (!resolveAbsolutePathsFromProjectRoot) {
			return { kind: 'system', path: decodedPath }
		}
		const workspacePath = normalizeWorkspacePath([], stripFilesystemRoot(decodedPath))
		return workspacePath ? { kind: 'workspace', path: workspacePath } : null
	}
	if (decodedPath.startsWith('//') || urlScheme.test(decodedPath) || decodedPath.includes('\\')) {
		return null
	}

	const currentSegments = currentDocumentPath.slice(1).split('/')
	currentSegments.pop()
	const workspacePath = normalizeWorkspacePath(currentSegments, decodedPath)
	return workspacePath ? { kind: 'workspace', path: workspacePath } : null
}

function linkPath(href: string): string {
	const query = href.indexOf('?')
	const fragment = href.indexOf('#')
	const end = Math.min(query < 0 ? href.length : query, fragment < 0 ? href.length : fragment)
	return href.slice(0, end)
}

function isAbsoluteFilesystemPath(candidate: string): boolean {
	return (
		(candidate.startsWith('/') && !candidate.startsWith('//')) ||
		candidate.startsWith('\\') ||
		windowsAbsolutePath.test(candidate)
	)
}

function stripFilesystemRoot(candidate: string): string {
	if (windowsAbsolutePath.test(candidate)) {
		return candidate.slice(3)
	}
	if (candidate.startsWith('\\\\')) {
		return candidate.replaceAll('\\', '/').split('/').filter(Boolean).slice(2).join('/')
	}
	return candidate.replace(/^[\\/]+/, '')
}

function normalizeWorkspacePath(
	baseSegments: string[],
	candidate: string
): KnowledgeBundlePath | null {
	const segments = [...baseSegments]
	for (const segment of candidate.replaceAll('\\', '/').split('/')) {
		if (!segment || segment === '.') {
			continue
		}
		if (segment === '..') {
			if (segments.length === 0) {
				return null
			}
			segments.pop()
			continue
		}
		segments.push(segment)
	}
	const workspacePath = `/${segments.join('/')}`
	return isKnowledgeBundlePath(workspacePath) &&
		(isMarkdownDocumentPath(workspacePath) || isAnydocPath(workspacePath))
		? workspacePath
		: null
}
