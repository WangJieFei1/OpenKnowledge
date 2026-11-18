<script lang="ts">
	import type { MCPManagementWorkspace } from '#lib/mcp/api.js'
	import { FolderKanban } from 'lucide-svelte'
	import { mcpSettingsTranslation as t } from '../MCPSettings.translation'

	type Props = {
		workspaces: readonly MCPManagementWorkspace[]
		loading: boolean
		disabled: boolean
		onaccesschange: (workspaceID: string, value: string) => void | Promise<void>
	}

	let { workspaces, loading, disabled, onaccesschange }: Props = $props()

	function workspaceStatusLabel(workspace: MCPManagementWorkspace): string {
		if (workspace.access === 'off') {
			return t.workspaceStatusNotIncluded
		}
		if (!workspace.globalEnabled) {
			return t.workspaceStatusPaused
		}
		if (workspace.state === 'listening') {
			return t.workspaceStatusListening
		}
		if (workspace.state === 'error') {
			return t.workspaceStatusUnavailable
		}
		return t.workspaceStatusStarting
	}
</script>

<section class="settings-group" aria-labelledby="workspace-access-heading">
	<div class="section-heading">
		<FolderKanban size={17} />
		<div>
			<h2 id="workspace-access-heading">{t.workspaceAccess}</h2>
			<p>
				{workspaces.length > 1
					? t.workspaceAccessManyDescription
					: t.workspaceAccessSingleDescription}
			</p>
		</div>
	</div>

	{#if loading}
		<div class="empty-row">{t.loadingWorkspaces}</div>
	{:else if workspaces.length === 0}
		<div class="empty-row">{t.noWorkspaces}</div>
	{:else}
		<div class="workspace-list" class:single={workspaces.length === 1}>
			{#each workspaces as workspace (workspace.workspaceID)}
				<div class="workspace-row">
					<div class="workspace-identity">
						<div class="workspace-icon"><FolderKanban size={15} /></div>
						<div>
							<strong>{workspace.label}</strong>
							<span>{workspaceStatusLabel(workspace)}</span>
						</div>
					</div>
					<label class="workspace-access">
						<span class="sr-only">{t.workspaceAccessAria(workspace.label)}</span>
						<select
							value={workspace.access}
							{disabled}
							onchange={(event) => onaccesschange(workspace.workspaceID, event.currentTarget.value)}
						>
							<option value="off">{t.accessOff}</option>
							<option value="read">{t.accessRead}</option>
							<option value="write">{t.accessWrite}</option>
						</select>
					</label>
				</div>
			{/each}
		</div>
	{/if}
</section>

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

	.workspace-list {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding-top: 12px;
	}

	.workspace-list.single {
		grid-template-columns: 1fr;
	}

	.workspace-row {
		display: grid;
		min-height: 64px;
		align-items: center;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 14px;
		border: 1px solid var(--gray-6);
		border-radius: 7px;
		background: var(--gray-1);
		padding: 10px 12px;
	}

	.workspace-identity {
		display: grid;
		min-width: 0;
		align-items: center;
		grid-template-columns: 30px minmax(0, 1fr);
		gap: 9px;
	}

	.workspace-icon {
		display: grid;
		width: 30px;
		height: 30px;
		place-items: center;
		border: 1px solid var(--accent-6);
		border-radius: 6px;
		background: var(--accent-3);
		color: var(--accent-11);
	}

	.workspace-identity > div:last-child {
		display: grid;
		min-width: 0;
		gap: 3px;
	}

	strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
		font-weight: 620;
	}

	.workspace-identity span {
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		line-height: 1.5;
	}

	.workspace-access select {
		min-width: 108px;
		border: 1px solid var(--gray-7);
		border-radius: 5px;
		background: var(--gray-1);
		padding: 6px 24px 6px 8px;
		color: var(--gray-12);
		font: inherit;
		font-size: var(--font-size-ui-caption);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
	}

	.empty-row {
		padding: 22px 0;
		color: var(--gray-10);
		font-size: var(--font-size-ui-text);
		text-align: center;
	}

	@media (max-width: 700px) {
		.workspace-list {
			grid-template-columns: 1fr;
		}
	}
</style>
