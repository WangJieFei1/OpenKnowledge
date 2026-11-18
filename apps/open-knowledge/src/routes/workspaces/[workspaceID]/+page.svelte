<script lang="ts">
	import { EditorSurface } from '#lib/components/editor/index.js'
	import { useWorkspaceSession } from '#lib/workspace/session-context.js'
	import { onMount } from 'svelte'

	const session = useWorkspaceSession()

	onMount(() => {
		session.activateNoDocument()
	})
</script>

<EditorSurface {session} />
