export function workspaceSelectorRoute(): string {
	return '/workspaces'
}

export function workspaceRoute(workspaceID: string): string {
	return `/workspaces/${encodeURIComponent(workspaceID)}`
}

export function documentRoute(
	workspaceID: string,
	documentPath: KnowledgeBundlePath,
	options: { editorWindow?: boolean } = {}
): string {
	const encodedPath = documentPath.slice(1).split('/').map(encodeURIComponent).join('/')
	const route = `${workspaceRoute(workspaceID)}/documents/${encodedPath}`
	return options.editorWindow ? `${route}?window=editor` : route
}

export function applicationSettingsRoute(): '/settings' {
	return '/settings'
}

export function mcpRoute(): '/mcp' {
	return '/mcp'
}
import type { KnowledgeBundlePath } from '#lib/knowledge/api.js'
