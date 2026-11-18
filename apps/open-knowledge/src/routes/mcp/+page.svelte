<script lang="ts">
	import WindowTitleBar from '#lib/components/app/WindowTitleBar.svelte'
	import MCPSettings from '#lib/components/settings/MCPSettings.svelte'
	import { i18nState } from '#lib/i18n/index.js'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import { LoaderCircle } from 'lucide-svelte'
	import RouteHead from '../RouteHead.svelte'
	import { pageTranslation as t } from './page.translation'

	const api = desktopAPI()
	let settingsOpenFailed = $state(false)

	async function openSettings(): Promise<void> {
		if (!api) {
			return
		}
		settingsOpenFailed = false
		try {
			await api.window.openApplicationSettings()
		} catch {
			settingsOpenFailed = true
		}
	}
</script>

{#key i18nState.current}
	<RouteHead title={t.pageTitle} />

	<div class="mcp-window">
		<WindowTitleBar
			title={t.windowTitle}
			showSettings={Boolean(api)}
			onsettings={() => void openSettings()}
		/>
		<main>
			{#if settingsOpenFailed}
				<p class="settings-error" role="alert">{t.settingsOpenFailed}</p>
			{/if}
			{#if api}
				<MCPSettings api={api.mcp} />
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
	.mcp-window {
		display: grid;
		width: 100%;
		height: 100%;
		grid-template-rows: var(--window-titlebar-height) minmax(0, 1fr);
		background: var(--gray-1);
	}

	main {
		overflow: auto;
		padding: 34px clamp(24px, 6vw, 72px) 72px;
	}

	.settings-error {
		margin: 0 0 18px;
		border: 1px solid var(--red-7);
		border-radius: 6px;
		background: var(--red-3);
		padding: 9px 11px;
		color: var(--red-11);
		font-size: var(--font-size-ui-text);
	}

	.runtime-unavailable {
		display: flex;
		height: 100%;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-body);
	}

	@media (max-width: 700px) {
		main {
			padding: 24px 20px 56px;
		}
	}
</style>
