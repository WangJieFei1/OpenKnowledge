<script lang="ts">
	import { appEdition } from '#lib/app-edition.js'
	import Button from '#lib/components/ui/Button.svelte'
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte'
	import type { MCPConnectionDetails, MCPManagementWorkspace } from '#lib/mcp/api.js'
	import {
		serializeMCPCodexConnectionConfiguration,
		serializeMCPHTTPConnectionConfiguration,
		serializeMCPStdioConnectionConfiguration
	} from '#lib/mcp/mcp-connection-configuration.js'
	import type { MCPSettingsCopyFeedback } from '#lib/mcp/mcp-settings-session.svelte.js'
	import { Tabs } from 'bits-ui'
	import { Copy, Eye, EyeOff, Globe2, KeyRound, RefreshCw, Terminal } from 'lucide-svelte'
	import { cubicOut } from 'svelte/easing'
	import { prefersReducedMotion } from 'svelte/motion'
	import { fade } from 'svelte/transition'
	import { mcpSettingsTranslation as t } from '../MCPSettings.translation'

	type Props = {
		globalEnabled: boolean
		workspaceCount: number
		status: MCPManagementWorkspace | null
		connection: MCPConnectionDetails | null
		busy: boolean
		copyFeedback: MCPSettingsCopyFeedback
		onreveal: () => void | Promise<void>
		onhide: () => void
		onregenerate: () => Promise<boolean>
		oncopy: (kind: 'command' | 'http', value: string) => void | Promise<void>
	}

	let {
		globalEnabled,
		workspaceCount,
		status,
		connection,
		busy,
		copyFeedback,
		onreveal,
		onhide,
		onregenerate,
		oncopy
	}: Props = $props()

	let confirmRegeneration = $state(false)
	let transport = $state(appEdition.id === 'codex' ? 'codex' : 'stdio')
	let copiedCommandTransport = $state<'codex' | 'stdio'>('stdio')

	const copyMessage = $derived.by(() => {
		if (copyFeedback === 'command') {
			return t.copied(
				copiedCommandTransport === 'codex' ? t.codexConfiguration : t.commandConfiguration
			)
		}
		if (copyFeedback === 'http') {
			return t.copied(t.httpConfiguration)
		}
		return copyFeedback === 'unavailable' ? t.clipboardUnavailable : ''
	})
	const httpConfiguration = $derived.by(() => {
		return connection ? serializeMCPHTTPConnectionConfiguration(connection) : ''
	})
	const stdioConfiguration = $derived.by(() => {
		return connection ? serializeMCPStdioConnectionConfiguration(connection) : ''
	})
	const codexConfiguration = $derived.by(() => {
		return connection && appEdition.id === 'codex'
			? serializeMCPCodexConnectionConfiguration(connection)
			: ''
	})

	async function copyCommand(kind: 'codex' | 'stdio'): Promise<void> {
		copiedCommandTransport = kind
		await oncopy('command', kind === 'codex' ? codexConfiguration : stdioConfiguration)
	}
</script>

<section class="settings-group" aria-labelledby="connection-heading">
	<div class="section-heading">
		<KeyRound size={17} />
		<div>
			<h2 id="connection-heading">{t.connection}</h2>
			<p>{t.connectionDescription}</p>
		</div>
	</div>

	{#if workspaceCount === 0}
		<div class="connection-empty">
			<KeyRound size={18} />
			<div>
				<strong>{t.noWorkspaceAccess}</strong>
				<span>{t.noWorkspaceAccessDescription}</span>
			</div>
		</div>
	{:else}
		<div class="connection-row">
			<div class="connection-summary">
				<div>
					<strong>{t.connectionDetails}</strong>
					<span>{t.connectionAccessDescription(t.workspaceCount(workspaceCount))}</span>
				</div>
				<div class="connection-buttons">
					{#if connection}
						<Button size="small" onclick={onhide} disabled={busy}>
							<EyeOff size={14} />
							{t.hideCredential}
						</Button>
					{:else}
						<Button
							size="small"
							onclick={onreveal}
							disabled={busy || status?.state !== 'listening'}
						>
							<Eye size={14} />
							{t.revealConnection}
						</Button>
					{/if}
					<Button
						size="small"
						variant="ghost"
						onclick={() => (confirmRegeneration = true)}
						disabled={busy || !globalEnabled}
					>
						<RefreshCw size={13} />
						{t.regenerateCredential}
					</Button>
				</div>
			</div>

			{#if status?.message}
				<p class="connection-error">{t[status.message]}</p>
			{/if}

			{#if connection}
				<div
					class="credential-details"
					transition:fade={{
						duration: prefersReducedMotion.current ? 0 : 160,
						easing: cubicOut
					}}
				>
					<div class="credential-warning">{t.credentialWarning}</div>

					<Tabs.Root
						class="transport-tabs"
						value={transport}
						onValueChange={(value) => (transport = value)}
						activationMode="manual"
					>
						<Tabs.List class="transport-tab-list" aria-label={t.transportAria}>
							{#if appEdition.id === 'codex'}
								<Tabs.Trigger class="transport-tab" value="codex">
									<Terminal size={14} />
									{t.codexSetup}
								</Tabs.Trigger>
							{/if}
							<Tabs.Trigger class="transport-tab" value="stdio">
								<Terminal size={14} />
								{t.commandStdio}
							</Tabs.Trigger>
							<Tabs.Trigger class="transport-tab" value="http">
								<Globe2 size={14} />
								{t.streamableHTTP}
							</Tabs.Trigger>
						</Tabs.List>

						{#if appEdition.id === 'codex'}
							<Tabs.Content class="transport-panel" value="codex">
								<div class="transport-heading">
									<div>
										<strong>{t.codexConfiguration}</strong>
										<span>{t.codexConfigurationDescription}</span>
									</div>
									<Button size="small" variant="ghost" onclick={() => copyCommand('codex')}>
										<Copy size={13} />
										{t.copy}
									</Button>
								</div>
								<pre>{codexConfiguration}</pre>
								<p class="transport-note">{t.codexNote}</p>
								<p class="transport-note">
									<a
										href="https://learn.chatgpt.com/docs/extend/mcp"
										target="_blank"
										rel="noreferrer"
									>
										{t.codexDocumentation}
									</a>
								</p>
							</Tabs.Content>
						{/if}

						<Tabs.Content class="transport-panel" value="stdio">
							<div class="transport-heading">
								<div>
									<strong>{t.commandConfiguration}</strong>
									<span>{t.commandConfigurationDescription}</span>
								</div>
								<Button size="small" variant="ghost" onclick={() => copyCommand('stdio')}>
									<Copy size={13} />
									{t.copy}
								</Button>
							</div>
							<pre>{stdioConfiguration}</pre>
							<p class="transport-note">{t.stdioNote}</p>
						</Tabs.Content>

						<Tabs.Content class="transport-panel" value="http">
							<div class="transport-heading">
								<div>
									<strong>{t.httpConfiguration}</strong>
									<span>{t.httpConfigurationDescription}</span>
								</div>
								<Button
									size="small"
									variant="ghost"
									onclick={() => oncopy('http', httpConfiguration)}
								>
									<Copy size={13} />
									{t.copy}
								</Button>
							</div>
							<pre>{httpConfiguration}</pre>
							<p class="transport-note">{t.httpNote}</p>
						</Tabs.Content>
					</Tabs.Root>

					<div class="credential-actions">
						<span role="status" aria-live="polite">{copyMessage}</span>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</section>

{#if confirmRegeneration}
	<ConfirmDialog
		title={t.regenerateTitle}
		description={t.regenerateDescription}
		confirmLabel={t.regenerateConfirm}
		oncancel={() => (confirmRegeneration = false)}
		onconfirm={onregenerate}
	/>
{/if}

<style>
	.settings-group {
		margin-bottom: 38px;
	}

	.section-heading {
		display: flex;
		align-items: flex-start;
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

	.section-heading p {
		margin-top: 3px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		line-height: 1.45;
	}

	.connection-empty {
		display: flex;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid var(--gray-5);
		padding: 18px 2px;
		color: var(--gray-10);
		font-size: var(--font-size-ui-text);
	}

	.connection-row {
		border-bottom: 1px solid var(--gray-5);
		padding: 16px 0 18px;
	}

	.connection-summary,
	.connection-buttons,
	.transport-heading,
	.credential-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
	}

	.connection-buttons {
		gap: 6px;
	}

	.connection-summary > div,
	.transport-heading > div,
	.connection-empty > div {
		display: grid;
		min-width: 0;
		gap: 3px;
	}

	strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
		font-weight: 620;
	}

	.connection-summary span,
	.transport-heading span,
	.connection-empty span,
	.transport-note,
	.credential-actions > span {
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		line-height: 1.5;
	}

	.connection-error {
		margin-top: 10px;
		color: var(--red-11);
		font-size: var(--font-size-ui-caption);
	}

	.credential-warning {
		margin-top: 14px;
		border-left: 2px solid var(--amber-8);
		background: var(--amber-2);
		padding: 8px 10px;
		color: var(--amber-11);
		font-size: var(--font-size-ui-text);
		line-height: 1.5;
	}

	:global(.transport-tabs) {
		display: block;
		margin-top: 16px;
	}

	:global(.transport-tab-list) {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		border-bottom: 1px solid var(--gray-6);
	}

	:global(.transport-tab) {
		display: inline-flex;
		height: 32px;
		align-items: center;
		gap: 6px;
		border: 0;
		border-bottom: 2px solid transparent;
		background: transparent;
		padding: 0 10px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		font-weight: 600;
		cursor: pointer;
	}

	:global(.transport-tab:hover),
	:global(.transport-tab[data-state='active']) {
		color: var(--gray-12);
	}

	:global(.transport-tab[data-state='active']) {
		border-bottom-color: var(--accent-9);
	}

	:global(.transport-panel) {
		padding-top: 14px;
	}

	.transport-heading {
		margin-bottom: 7px;
	}

	pre {
		max-height: 220px;
		overflow: auto;
		margin: 0;
		border: 1px solid var(--gray-6);
		border-radius: 5px;
		background: var(--gray-2);
		padding: 10px 11px;
		color: var(--gray-12);
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-caption);
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-all;
		user-select: text;
	}

	.transport-note {
		margin-top: 8px;
	}

	.credential-actions {
		min-height: 34px;
		margin-top: 8px;
	}

	.credential-actions > span {
		min-height: 15px;
	}

	@media (max-width: 700px) {
		.connection-summary,
		.transport-heading {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
