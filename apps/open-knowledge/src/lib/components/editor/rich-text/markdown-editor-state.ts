export function shouldReplaceControlledMarkdown(
	previousMarkdown: string,
	nextMarkdown: string,
	lastRendered: string,
	editingDisabled = false
): boolean {
	return (
		(nextMarkdown !== previousMarkdown && nextMarkdown !== lastRendered) ||
		(editingDisabled && nextMarkdown !== lastRendered)
	)
}

export function clampSelectedIndex(selectedIndex: number, itemCount: number): number {
	return itemCount > 0 ? Math.min(Math.max(0, selectedIndex), itemCount - 1) : 0
}

export function retainDismissedTrigger(
	dismissedFrom: number | null,
	triggerFrom: number | null
): number | null {
	return dismissedFrom !== null && dismissedFrom === triggerFrom ? dismissedFrom : null
}
