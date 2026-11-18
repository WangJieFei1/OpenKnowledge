<script lang="ts">
	import ToggleSwitch from '#lib/components/ui/ToggleSwitch.svelte'
	import { History } from 'lucide-svelte'
	import { mcpSettingsTranslation as t } from '../MCPSettings.translation'

	type Props = {
		enabled: boolean
		loading: boolean
		disabled: boolean
		onenabledchange: (enabled: boolean) => void | Promise<void>
	}

	let { enabled, loading, disabled, onenabledchange }: Props = $props()
</script>

<section class="settings-group" aria-labelledby="session-memory-heading">
	<div class="section-heading">
		<History size={17} />
		<div>
			<h2 id="session-memory-heading">{t.memoryTitle}</h2>
			<p>{t.memoryDescription}</p>
		</div>
		<label class="memory-toggle">
			<span>{enabled ? t.memoryEnabled : t.memoryDisabled}</span>
			<ToggleSwitch
				label={t.memoryToggleAria}
				checked={enabled}
				disabled={disabled || loading}
				onCheckedChange={onenabledchange}
			/>
		</label>
	</div>
</section>

<style>
	.settings-group {
		margin-bottom: 38px;
	}

	.section-heading {
		display: grid;
		align-items: start;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 10px;
		border-bottom: 1px solid var(--gray-6);
		padding-bottom: 13px;
		color: var(--gray-11);
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		color: var(--gray-12);
		font-size: var(--font-size-ui-section-title);
		font-weight: 680;
	}

	p {
		margin-top: 3px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		line-height: 1.45;
	}

	.memory-toggle {
		display: flex;
		align-items: center;
		gap: 7px;
		padding-top: 2px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		white-space: nowrap;
	}

	@media (max-width: 620px) {
		.section-heading {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.memory-toggle {
			grid-column: 2;
		}
	}
</style>
