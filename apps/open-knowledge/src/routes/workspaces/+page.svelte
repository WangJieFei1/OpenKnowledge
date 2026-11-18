<script lang="ts">
	import WindowTitleBar from '#lib/components/app/WindowTitleBar.svelte'
	import Button from '#lib/components/ui/Button.svelte'
	import { i18nState } from '#lib/i18n/index.js'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import { CircleAlert, Globe2, Plus } from 'lucide-svelte'
	import { onMount } from 'svelte'
	import RouteHead from '../RouteHead.svelte'
	import RecentWorkspaceList from './RecentWorkspaceList.svelte'
	import RemoteBundleDialog from './RemoteBundleDialog.svelte'
	import { pageTranslation as t } from './page.translation'
	import { WorkspaceSelectorController } from './workspace-selector-controller.svelte'

	const controller = new WorkspaceSelectorController(desktopAPI())
	let remoteDialogOpen = $state(false)

	onMount(() => {
		void controller.start()
		return () => controller.dispose()
	})
</script>

{#key i18nState.current}
	<RouteHead title={t.pageTitle} />

	<div class="selector-window">
		<WindowTitleBar
			title={t.windowTitle}
			showSettings={controller.available}
			onsettings={() => void controller.openSettings()}
		/>
		<main>
			<header>
				<div>
					<h1>{t.heading}</h1>
					<p>{t.description}</p>
				</div>
				<div class="header-actions">
					<Button
						size="large"
						disabled={controller.busy || !controller.available}
						onclick={() => (remoteDialogOpen = true)}
					>
						<Globe2 size={16} />
						{t.connectRemote}
					</Button>
					<Button
						variant="primary"
						size="large"
						disabled={controller.busy || !controller.available}
						onclick={() => void controller.browse()}
					>
						<Plus size={16} />
						{t.openFolder}
					</Button>
				</div>
			</header>

			<RecentWorkspaceList
				recentWorkspaces={controller.recentWorkspaces}
				loading={controller.loading}
				busy={controller.busy}
				selectingID={controller.selectingID}
				onselect={(workspace) => void controller.select(workspace)}
			/>
			{#if controller.messageID}
				<div class="message" role="alert">
					<CircleAlert size={17} />
					<div>
						<p>{t[controller.messageID]}</p>
						{#if controller.messageDetail}
							<small><strong>{t.systemDetail}:</strong> {controller.messageDetail}</small>
						{/if}
					</div>
				</div>
			{/if}
		</main>
	</div>

	{#if remoteDialogOpen}
		<RemoteBundleDialog
			oncancel={() => (remoteDialogOpen = false)}
			onconnect={(input) => controller.connectRemote(input)}
		/>
	{/if}
{/key}

<style>
	.selector-window {
		display: grid;
		height: 100%;
		grid-template-rows: var(--window-titlebar-height) minmax(0, 1fr);
		background: var(--gray-2);
	}

	main {
		overflow: auto;
		padding: 28px 30px 36px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		color: var(--gray-12);
		font-size: var(--font-size-ui-page-title);
		font-weight: 700;
	}

	header p {
		margin-top: 3px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-text);
	}

	.header-actions {
		display: flex;
		flex: 0 0 auto;
		gap: 8px;
	}

	.message {
		display: grid;
		align-items: start;
		grid-template-columns: 18px minmax(0, 1fr);
		gap: 8px;
		margin-top: 12px;
		border: 1px solid var(--red-6);
		border-radius: 6px;
		background: var(--red-3);
		padding: 10px 11px;
		color: var(--red-11);
		font-size: var(--font-size-ui-text);
	}

	.message > :global(svg) {
		margin-top: 1px;
	}

	.message p {
		line-height: 1.4;
	}

	.message small {
		display: block;
		margin-top: 4px;
		color: var(--red-12);
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-caption);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	@media (max-width: 600px) {
		main {
			padding-inline: 18px;
		}

		header {
			align-items: flex-start;
			flex-direction: column;
		}

		.header-actions {
			width: 100%;
		}

		.header-actions :global(.ui-button) {
			flex: 1;
		}
	}
</style>
