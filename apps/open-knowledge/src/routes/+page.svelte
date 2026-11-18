<script lang="ts">
	import { goto } from '$app/navigation'
	import { i18nState } from '#lib/i18n/index.js'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import { workspaceSelectorRoute } from '#lib/navigation/routes.js'
	import { BookOpenText, LoaderCircle } from 'lucide-svelte'
	import { onMount } from 'svelte'
	import { pageTranslation as t } from './page.translation'
	import RouteHead from './RouteHead.svelte'

	const api = desktopAPI()
	let runtimeMissing = $state(false)

	onMount(() => {
		if (!api) {
			runtimeMissing = true
			return
		}
		void api.window.getState().then((state) => {
			if (state.role === 'selector') {
				void goto(workspaceSelectorRoute(), { replace: true })
			}
		})
	})
</script>

{#key i18nState.current}
	<RouteHead title={t.pageTitle} />

	<div class="boot-state">
		{#if runtimeMissing}
			<BookOpenText size={24} />
			<strong>{t.desktopRuntimeRequired}</strong>
			<span>{t.runtimeInstruction}</span>
		{:else}
			<LoaderCircle class="spin" size={22} />
			<span>{t.starting}</span>
		{/if}
	</div>
{/key}

<style>
	.boot-state {
		display: flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 9px;
		background: var(--gray-2);
		color: var(--gray-9);
		font-size: var(--font-size-ui-body);
	}

	.boot-state strong {
		color: var(--gray-11);
		font-size: var(--font-size-ui-section-title);
	}
</style>
