export type FileTreeViewEntry = {
	path: string
	parentPath: string | null
}

export function pathDepth(path: string): number {
	return Math.max(0, path.slice(1).split('/').length - 1)
}

export function filterEntries<Entry extends FileTreeViewEntry>(
	entries: readonly Entry[],
	query: string,
	collapsed: ReadonlySet<string>
): Entry[] {
	const normalizedQuery = query.trim().toLowerCase()
	if (normalizedQuery) {
		const included = new Set<string>()
		for (const entry of entries) {
			if (!entry.path.toLowerCase().includes(normalizedQuery)) {
				continue
			}
			included.add(entry.path)
			forEachAncestor(entry.parentPath, (path) => included.add(path))
		}
		return entries.filter((entry) => included.has(entry.path))
	}
	return entries.filter((entry) => !hasCollapsedAncestor(entry, collapsed))
}

function hasCollapsedAncestor(entry: FileTreeViewEntry, collapsed: ReadonlySet<string>): boolean {
	let found = false
	forEachAncestor(entry.parentPath, (path) => {
		found ||= collapsed.has(path)
	})
	return found
}

function forEachAncestor(parentPath: string | null, visit: (path: string) => void): void {
	let parent = parentPath
	while (parent && parent !== '/') {
		visit(parent)
		const separator = parent.lastIndexOf('/')
		parent = separator <= 0 ? '/' : parent.slice(0, separator)
	}
}
