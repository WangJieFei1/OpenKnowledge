<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation'
	import { page } from '$app/state'
	import AppShell from '#lib/components/app/AppShell.svelte'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import type { KnowledgeBundlePath } from '#lib/knowledge/api.js'
	import { documentRoute, workspaceRoute } from '#lib/navigation/routes.js'
	import { provideWorkspaceSession } from '#lib/workspace/session-context.js'
	import { WorkspaceSession } from '#lib/workspace/workspace-session.svelte.js'
	import { LoaderCircle } from 'lucide-svelte'
	import { onDestroy, onMount } from 'svelte'
	import RouteHead from '../../RouteHead.svelte'
	import { layoutTranslation as t } from './layout.translation'

	let { children } = $props()
	const api = desktopAPI()
	const workspaceID = page.params.workspaceID ?? ''
	const editorWindow = page.url.searchParams.get('window') === 'editor'

	const session =
		api && workspaceID
			? new WorkspaceSession(api, workspaceID, routeDocument, { singleDocument: editorWindow })
			: null

	const routeTitle = $derived(session?.workspace?.name)
	let replayingNavigation = false

	if (session) {
		provideWorkspaceSession(session)
	}

	onMount(() => {
		if (session) {
			void session.initialize()
		}
	})

	onDestroy(() => {
		session?.dispose()
	})

	beforeNavigate((navigation) => {
		if (navigation.shallow) {
			return
		}

		if (!session || replayingNavigation || !session.hasUnsavedChanges) {
			return
		}
		const target = navigation.to?.url
		if (!target) {
			return
		}
		const currentWorkspaceRoute = workspaceRoute(workspaceID)
		if (
			target.pathname === currentWorkspaceRoute ||
			target.pathname.startsWith(`${currentWorkspaceRoute}/`)
		) {
			return
		}
		navigation.cancel()
		void session.flushBeforeNavigation().then(async (saved) => {
			if (!saved) {
				return
			}
			replayingNavigation = true
			try {
				await goto(`${target.pathname}${target.search}${target.hash}`)
			} finally {
				replayingNavigation = false
			}
		})
	})

	async function routeDocument(path: KnowledgeBundlePath | null, replace: boolean): Promise<void> {
		const route = path
			? documentRoute(workspaceID, path, { editorWindow })
			: `${workspaceRoute(workspaceID)}${editorWindow ? '?window=editor' : ''}`
		await goto(route, { replace })
	}
</script>

<RouteHead title={t.pageTitle(routeTitle ?? t.appName)} />

{#if session}
	<AppShell {session} {editorWindow}>{@render children()}</AppShell>
{:else}
	<div class="route-loading">
		<LoaderCircle class="spin" size={22} />
		{t.desktopRuntimeUnavailable}
	</div>
{/if}

<style>
	.route-loading {
		display: flex;
		height: 100%;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-body);
	}
</style>
