<script lang="ts">
	import type { SettingsScope } from '#lib/settings/api.js'
	import { settingsViewTranslation as t } from '../SettingsView.translation'

	type Props = {
		scope: SettingsScope
		hasProject: boolean
		overrideCount: number
		onscopechange: (scope: SettingsScope) => void
		onreset: () => void | Promise<void>
	}

	let { scope, hasProject, overrideCount, onscopechange, onreset }: Props = $props()
</script>

<header>
	<div>
		<h1>{t.title}</h1>
		<p>{scope === 'project' ? t.projectSubtitle : t.globalSubtitle}</p>
	</div>
	<div class="settings-actions">
		<div class="scope-switch" role="group" aria-label={t.settingsScope}>
			<button
				class:active={scope === 'global'}
				type="button"
				onclick={() => onscopechange('global')}
			>
				{t.globalScope}
			</button>
			{#if hasProject}
				<button
					class:active={scope === 'project'}
					type="button"
					onclick={() => onscopechange('project')}>{t.projectScope}</button
				>
			{/if}
		</div>
		<button class="reset-scope" type="button" disabled={overrideCount === 0} onclick={onreset}>
			{t.resetOverrides(overrideCount)}
		</button>
	</div>
</header>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 11px;
		border-bottom: 1px solid var(--gray-6);
		padding: 0 20px;
	}

	.settings-actions,
	.scope-switch {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.scope-switch {
		border: 1px solid var(--gray-6);
		border-radius: 6px;
		background: var(--gray-2);
		padding: 2px;
	}

	.scope-switch button,
	.reset-scope {
		border: 0;
		border-radius: 4px;
		background: transparent;
		padding: 6px 9px;
		color: var(--gray-11);
		font: inherit;
		font-size: var(--font-size-ui-caption);
		cursor: pointer;
	}

	.scope-switch button.active {
		background: var(--gray-1);
		color: var(--gray-12);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--gray-12) 10%, transparent);
	}

	.reset-scope:hover:not(:disabled) {
		background: var(--gray-3);
		color: var(--gray-12);
	}

	.reset-scope:disabled {
		opacity: 0.45;
		cursor: default;
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		font-size: var(--font-size-ui-title);
		font-weight: 680;
	}

	header p {
		margin-top: 2px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
	}

	@media (max-width: 560px) {
		header {
			align-items: stretch;
			flex-direction: column;
			padding-block: 12px;
		}

		.settings-actions {
			justify-content: space-between;
		}
	}
</style>
