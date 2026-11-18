import type { Workspace } from '#lib/knowledge/api.js'
import { errorMessage } from '#lib/validation.js'
import { SvelteURL } from 'svelte/reactivity'

export function workspaceLocation(workspace: Workspace): string {
	if (workspace.kind === 'local') {
		return workspace.rootPath
	}
	try {
		const uri = new SvelteURL(workspace.uri)
		const insecure = uri.searchParams.get('insecure') === 'true'
		uri.username = ''
		uri.password = ''
		uri.search = ''
		if (insecure) {
			uri.searchParams.set('insecure', 'true')
		}
		return uri.href
	} catch {
		return 'okb://...'
	}
}

export function errorDetail(error: unknown): string | null {
	const detail = errorMessage(error).replace(/\s+/g, ' ').trim()
	return detail ? detail.slice(0, 512) : null
}
