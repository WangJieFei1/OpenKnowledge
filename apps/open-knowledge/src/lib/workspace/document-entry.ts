import type { WorkspaceEntry, WorkspaceFileEntry } from '../knowledge/api'

export function currentDocumentEntry(
	entries: readonly WorkspaceEntry[],
	id: WorkspaceEntry['id']
): WorkspaceFileEntry | undefined {
	const entry = entries.find((candidate) => candidate.id === id)
	return entry?.kind === 'file' ? entry : undefined
}
