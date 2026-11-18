const anydocExtensions = new Set([
	'.csv',
	'.doc',
	'.docm',
	'.docx',
	'.epub',
	'.odp',
	'.ods',
	'.odt',
	'.pdf',
	'.pot',
	'.pps',
	'.ppsm',
	'.ppsx',
	'.ppt',
	'.pptm',
	'.pptx',
	'.rtf',
	'.xls',
	'.xlsb',
	'.xlsm',
	'.xlsx'
])

export function isAnydocPath(path: string): boolean {
	return anydocExtension(path) !== null
}

export function hasSameAnydocExtension(left: string, right: string): boolean {
	const extension = anydocExtension(left)
	return extension !== null && extension === anydocExtension(right)
}

export function markdownPathForAnydoc(path: string): string | null {
	const extension = anydocExtension(path)
	return extension === null ? null : `${path.slice(0, -extension.length)}.md`
}

function anydocExtension(path: string): string | null {
	const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
	const dot = path.lastIndexOf('.')
	const extension = path.slice(dot).toLowerCase()
	return dot > slash + 1 && anydocExtensions.has(extension) ? extension : null
}
