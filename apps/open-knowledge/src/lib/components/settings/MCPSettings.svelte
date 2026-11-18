<script lang="ts">
	import { appEdition } from '#lib/app-edition.js'
	import MessageBanner from '#lib/components/app/MessageBanner.svelte'
	import {
		MCPConnectionSection,
		MCPOverview,
		MCPSessionMemorySection,
		MCPWorkspaceAccessSection
	} from '#lib/components/settings/mcp/index.js'
	import type { MCPAPI } from '#lib/mcp/api.js'
	import { MCPSettingsSession } from '#lib/mcp/mcp-settings-session.svelte.js'
	import { onMount } from 'svelte'
	import { mcpSettingsTranslation as t } from './MCPSettings.translation'

	type Props = {
		api: MCPAPI
	}
	let { api }: Props = $props()
	const session = new MCPSettingsSession(() => api)
	const statusLabel = $derived.by(() => {
		if (session.gatewayError) {
			return t.statusUnavailable
		}
		if (!session.enabled || !session.sharedStatus) {
			return t.statusOff
		}
		if (session.sharedStatus.state === 'listening') {
			return t.statusListening
		}
		if (session.sharedStatus.state === 'error') {
			return t.statusUnavailable
		}
		return t.statusStarting
	})

	onMount(() => {
		session.start()
		window.addEventListener('focus', refreshOnFocus)
		return () => {
			session.dispose()
			window.removeEventListener('focus', refreshOnFocus)
		}
	})

	function refreshOnFocus(): void {
		void session.refresh()
	}
</script>

<div class="mcp-settings">
	<section class="edition-summary" aria-labelledby="edition-heading">
		<h2 id="edition-heading">
			{appEdition.id === 'codex' ? t.codexEditionTitle : t.generalEditionTitle}
		</h2>
		<p>{appEdition.id === 'codex' ? t.codexEditionDescription : t.generalEditionDescription}</p>
	</section>
	<MCPOverview
		enabled={session.enabled}
		loading={session.loading}
		busy={session.busy}
		{statusLabel}
		statusState={session.statusState}
		onenabledchange={session.changeGlobalEnabled}
	/>
	<MCPWorkspaceAccessSection
		workspaces={session.workspaces}
		loading={session.loading}
		disabled={session.busy}
		onaccesschange={session.changeAccess}
	/>
	{#if appEdition.codexMemory}
		<MCPSessionMemorySection
			enabled={session.memoryEnabled}
			loading={session.loading}
			disabled={session.busy || session.workspaceCount === 0}
			onenabledchange={session.changeMemoryEnabled}
		/>
	{/if}
	<section class="workflows" aria-labelledby="workflows-heading">
		<h2 id="workflows-heading">{t.workflowsTitle}</h2>
		<p>{t.workflowsDescription}</p>
		<div class="workflow-grid">
			<article>
				<h3>{t.researchTitle}</h3>
				<p>{t.researchDescription}</p>
				<code>research_brief</code>
			</article>
			<article>
				<h3>{t.quantTitle}</h3>
				<p>{t.quantDescription}</p>
				<code>quant_research_review</code>
			</article>
			<article>
				<h3>{t.handoffTitle}</h3>
				<p>{t.handoffDescription}</p>
				<code>consulting_handoff</code>
			</article>
		</div>
	</section>
	<MCPConnectionSection
		globalEnabled={session.enabled ?? false}
		workspaceCount={session.workspaceCount}
		status={session.sharedStatus}
		connection={session.connection}
		busy={session.busy}
		copyFeedback={session.copyFeedback}
		onreveal={session.reveal}
		onhide={session.hideConnection}
		onregenerate={session.regenerate}
		oncopy={session.copy}
	/>
</div>

{#if session.errorKey}
	<MessageBanner message={t[session.errorKey]} ondismiss={session.dismissError} />
{/if}

<style>
	.edition-summary {
		margin-bottom: 24px;
		padding: 14px 16px;
		border: 1px solid var(--accent-6);
		border-radius: 8px;
		background: var(--accent-2);
	}
	.edition-summary h2 {
		margin: 0 0 6px;
		font-size: var(--font-size-ui-text);
		color: var(--accent-11);
	}
	.edition-summary p {
		margin: 0;
		font-size: var(--font-size-ui-text);
		line-height: 1.5;
		color: var(--gray-11);
	}
	.workflows {
		margin-bottom: 38px;
	}
	.workflows h2 {
		font-size: var(--font-size-ui-section-title);
		color: var(--gray-12);
		margin: 0 0 6px;
	}
	.workflows p {
		font-size: var(--font-size-ui-text);
		color: var(--gray-11);
		line-height: 1.5;
		margin: 0;
	}
	.workflow-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		margin-top: 14px;
	}
	.workflow-grid article {
		border: 1px solid var(--gray-6);
		border-radius: 8px;
		padding: 14px;
		background: var(--gray-2);
	}
	.workflow-grid h3 {
		margin: 0 0 8px;
		font-size: var(--font-size-ui-text);
		color: var(--gray-12);
	}
	.workflow-grid code {
		display: block;
		margin-top: 14px;
		font-size: var(--font-size-ui-caption);
		color: var(--accent-11);
		overflow-wrap: anywhere;
	}
	@media (max-width: 650px) {
		.workflow-grid {
			grid-template-columns: 1fr;
		}
	}
	.mcp-settings {
		width: min(100%, 780px);
		margin: 0 auto;
		padding-bottom: 56px;
	}
</style>
