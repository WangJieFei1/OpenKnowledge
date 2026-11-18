<script lang="ts">
	import { page } from '$app/state'
	import { EditorSurface } from '#lib/components/editor/index.js'
	import { isKnowledgeBundlePath, type KnowledgeBundlePath } from '#lib/knowledge/api.js'
	import { useWorkspaceSession } from '#lib/workspace/session-context.js'

	const session = useWorkspaceSession()
	let openedPath: KnowledgeBundlePath | null = null

	$effect(() => {
		const workspace = session.workspace
		const documentPath = `/${page.params.documentPath ?? ''}`
		if (
			workspace &&
			isKnowledgeBundlePath(documentPath) &&
			documentPath !== '/' &&
			documentPath !== openedPath
		) {
			openedPath = documentPath
			void session.openDocument(documentPath)
		}
	})
</script>

<EditorSurface {session} />
