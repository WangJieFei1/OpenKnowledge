<script lang="ts">
	import WindowTitleBar from '#lib/components/app/WindowTitleBar.svelte'
	import SettingsView from '#lib/components/settings/SettingsView.svelte'
	import { i18nState } from '#lib/i18n/index.js'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import { LoaderCircle } from 'lucide-svelte'
	import RouteHead from '../RouteHead.svelte'
	import { pageTranslation as t } from './page.translation'

	const api = desktopAPI()
</script>

{#key i18nState.current}
	<RouteHead title={t.pageTitle} />

	<div class="settings-window">
		<WindowTitleBar title={t.windowTitle} />
		<main>
			{#if api}
				<SettingsView api={api.settings} />
			{:else}
				<div class="runtime-unavailable">
					<LoaderCircle class="spin" size={20} />
					{t.desktopRuntimeUnavailable}
				</div>
			{/if}
		</main>
	</div>
{/key}

<style>
	.settings-window {
		display: grid;
		width: 100%;
		height: 100%;
		grid-template-rows: var(--window-titlebar-height) minmax(0, 1fr);
		background: var(--gray-1);
	}

	main {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.runtime-unavailable {
		display: flex;
		height: 100%;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 24px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-body);
		text-align: center;
	}

	@media (max-width: 700px) {
		.runtime-unavailable {
			padding: 20px;
		}
	}
</style>
