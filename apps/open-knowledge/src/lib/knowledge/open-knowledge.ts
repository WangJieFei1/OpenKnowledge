import type { KnowledgeBundlePath } from '@open-knowledge/knowledge-bundle-api'
import { stringify } from 'yaml'

export function openKnowledgeRootForPath(
	path: KnowledgeBundlePath,
	roots: readonly KnowledgeBundlePath[]
): KnowledgeBundlePath | null {
	let match: KnowledgeBundlePath | null = null
	for (const root of roots) {
		if (root !== '/' && path !== root && !path.startsWith(`${root}/`)) {
			continue
		}
		if (match === null || root.length > match.length) {
			match = root
		}
	}
	return match
}

export function isPathInOpenKnowledgeRoots(
	path: KnowledgeBundlePath,
	roots: readonly KnowledgeBundlePath[]
): boolean {
	return openKnowledgeRootForPath(path, roots) !== null
}

export function childKnowledgeBundlePath(
	parentPath: KnowledgeBundlePath,
	name: string
): KnowledgeBundlePath {
	return `${parentPath === '/' ? '' : parentPath}/${name}`
}

export function normalizeMarkdownFileName(name: string): string {
	const normalized = name.trim()
	return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`
}

export function isReservedKnowledgeFile(path: KnowledgeBundlePath): boolean {
	const name = path.slice(path.lastIndexOf('/') + 1)
	return name === 'index.md' || name === 'log.md'
}

export function newMarkdownDocumentContent(name: string, openKnowledgeFormat: boolean): string {
	if (!openKnowledgeFormat) {
		return ''
	}
	const title = name
		.replace(/\.md$/i, '')
		.replace(/[-_]+/g, ' ')
		.replace(/^./, (character) => character.toUpperCase())
	if (isReservedKnowledgeFile(`/${name}`)) {
		return `# ${title}\n\n`
	}
	const frontmatter = stringify({ type: 'note', title, status: 'draft' }, { lineWidth: 0 })
	return `---\n${frontmatter}---\n\n# ${title}\n\n`
}
