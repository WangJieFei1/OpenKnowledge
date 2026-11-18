<script lang="ts">
	import ToggleSwitch from '#lib/components/ui/ToggleSwitch.svelte'
	import type { MCPWorkspaceStatus } from '#lib/mcp/api.js'
	import { Waypoints } from 'lucide-svelte'
	import { mcpSettingsTranslation as t } from '../MCPSettings.translation'

	type Props = {
		enabled: boolean | null
		loading: boolean
		busy: boolean
		statusLabel: string
		statusState: MCPWorkspaceStatus['state']
		onenabledchange: (enabled: boolean) => void | Promise<void>
	}

	let { enabled, loading, busy, statusLabel, statusState, onenabledchange }: Props = $props()
</script>

<section class="overview" aria-labelledby="mcp-heading">
	<div class="overview-mark"><Waypoints size={21} /></div>
	<div class="overview-copy">
		<span class="eyebrow">{t.eyebrow}</span>
		<h1 id="mcp-heading">{t.overviewTitle}</h1>
		<p>{t.overviewDescription}</p>
	</div>
	<div class="overview-actions">
		<div class="status-pill" data-state={statusState}>
			<span class="status-dot"></span>{statusLabel}
		</div>
		<label class="global-toggle">
			<span>{enabled ? t.globalEnabled : t.globalPaused}</span>
			<ToggleSwitch
				label={t.globalEnabledAria}
				checked={enabled ?? true}
				disabled={busy || loading}
				onCheckedChange={onenabledchange}
			/>
		</label>
	</div>
</section>
<section class="semantic-info">
	<h2>{t.semanticTitle}</h2>
	<p>{t.semanticDescription}</p>
</section>

<style>
	.semantic-info {
		margin: -18px 0 28px;
		padding: 0 4px;
	}
	.semantic-info h2 {
		margin: 0 0 6px;
		font-size: var(--font-size-ui-text);
		color: var(--gray-12);
	}
	.semantic-info p {
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		line-height: 1.55;
	}
	.overview {
		display: grid;
		align-items: center;
		grid-template-columns: 44px minmax(0, 1fr) auto;
		gap: 14px;
		margin-bottom: 38px;
		border: 1px solid var(--gray-6);
		border-radius: 9px;
		background: linear-gradient(120deg, var(--accent-3), transparent 45%), var(--gray-2);
		padding: 18px;
	}

	.overview-mark {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		border: 1px solid var(--accent-6);
		border-radius: 9px;
		background: var(--accent-3);
		color: var(--accent-11);
	}

	.overview-copy {
		min-width: 0;
	}

	.eyebrow {
		color: var(--accent-11);
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-caption);
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		margin-top: 3px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-title);
		font-weight: 680;
		letter-spacing: -0.01em;
	}

	.overview-copy p {
		margin-top: 3px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		line-height: 1.45;
	}

	.status-pill {
		display: inline-flex;
		height: 26px;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--gray-6);
		border-radius: 13px;
		background: var(--gray-1);
		padding: 0 10px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		font-weight: 600;
		white-space: nowrap;
	}

	.overview-actions,
	.global-toggle {
		display: flex;
		align-items: center;
	}

	.overview-actions {
		justify-content: flex-end;
		gap: 10px;
	}

	.global-toggle {
		gap: 6px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--gray-8);
	}

	.status-pill[data-state='listening'] {
		border-color: var(--green-6);
		color: var(--green-11);
	}

	.status-pill[data-state='listening'] .status-dot {
		background: var(--green-9);
	}

	.status-pill[data-state='starting'] {
		border-color: var(--amber-6);
		color: var(--amber-11);
	}

	.status-pill[data-state='starting'] .status-dot {
		background: var(--amber-9);
	}

	.status-pill[data-state='error'] {
		border-color: var(--red-6);
		color: var(--red-11);
	}

	.status-pill[data-state='error'] .status-dot {
		background: var(--red-9);
	}

	@media (max-width: 700px) {
		.overview {
			align-items: start;
			grid-template-columns: 44px minmax(0, 1fr);
		}

		.overview-actions {
			grid-column: 2;
			justify-self: start;
		}
	}
</style>
