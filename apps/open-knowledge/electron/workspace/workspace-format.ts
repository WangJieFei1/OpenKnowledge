import { isOpenKnowledgeWorkspaceIndex } from '@open-knowledge/knowledge-bundle/frontmatter'
import type {
	KnowledgeBundleEntry,
	KnowledgeBundleFile,
	KnowledgeBundlePath
} from '@open-knowledge/knowledge-bundle-api'

type ReadFile = (path: KnowledgeBundlePath) => Promise<KnowledgeBundleFile | null>

export async function detectOpenKnowledgeRoots(
	entries: readonly KnowledgeBundleEntry[],
	readFile: ReadFile
): Promise<KnowledgeBundlePath[]> {
	const roots: KnowledgeBundlePath[] = []
	for (const entry of entries) {
		if (entry.kind !== 'file' || entry.name !== 'index.md') {
			continue
		}
		const file = await readFile(entry.path)
		if (file && isOpenKnowledgeWorkspaceIndex(file.content) && file.parentPath) {
			roots.push(file.parentPath)
		}
	}
	return roots.sort((left, right) => left.localeCompare(right))
}
