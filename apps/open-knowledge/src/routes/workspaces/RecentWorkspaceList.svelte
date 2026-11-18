<script lang="ts">
	import type { Workspace } from '#lib/knowledge/api.js'
	import { Clock3, FolderOpen, Globe2, LoaderCircle } from 'lucide-svelte'
	import { pageTranslation as t, relativeTime } from './page.translation'
	import { workspaceLocation } from './workspace-display'

	type Props = {
		recentWorkspaces: Workspace[]
		loading: boolean
		busy: boolean
		selectingID: string | null
		onselect: (workspace: Workspace) => void
	}

	let { recentWorkspaces, loading, busy, selectingID, onselect }: Props = $props()
</script>

<div class="recent-heading"><Clock3 size={14} /> {t.recent}</div>
<div class="workspace-list" aria-busy={loading}>
	{#if loading}
		<div class="selector-state">
			<LoaderCircle class="spin" size={20} />
			{t.loadingWorkspaces}
		</div>
	{:else if recentWorkspaces.length === 0}
		<div class="selector-state">
			<FolderOpen size={22} />
			{t.noRecentWorkspaces}
		</div>
	{:else}
		{#each recentWorkspaces as workspace (workspace.id)}
			<button type="button" disabled={busy} onclick={() => onselect(workspace)}>
				<span class={['workspace-icon', { remote: workspace.kind === 'remote' }]}>
					{#if workspace.kind === 'remote'}
						<Globe2 size={17} />
					{:else}
						<FolderOpen size={17} />
					{/if}
				</span>
				<span class="workspace-copy">
					<strong>{workspace.name}</strong>
					<small>{workspaceLocation(workspace)}</small>
				</span>
				{#if selectingID === workspace.id}
					<LoaderCircle class="spin" size={16} />
				{:else}
					<time>{relativeTime(workspace.lastOpenedAt)}</time>
				{/if}
			</button>
		{/each}
	{/if}
</div>

<style>
	.recent-heading {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 30px 0 8px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
		font-weight: 650;
		text-transform: uppercase;
	}

	.workspace-list {
		overflow: hidden;
		border: 1px solid var(--gray-6);
		border-radius: 7px;
		background: var(--gray-1);
	}

	.workspace-list > button {
		display: grid;
		width: 100%;
		height: 58px;
		align-items: center;
		grid-template-columns: 34px minmax(0, 1fr) 28px;
		gap: 10px;
		border: 0;
		border-bottom: 1px solid var(--gray-5);
		background: transparent;
		padding: 0 13px;
		text-align: left;
		cursor: pointer;
	}

	.workspace-list > button:last-child {
		border-bottom: 0;
	}

	.workspace-list > button:hover:not(:disabled) {
		background: var(--gray-3);
	}

	.workspace-icon {
		display: grid;
		width: 31px;
		height: 31px;
		place-items: center;
		border-radius: 6px;
		background: var(--amber-3);
		color: var(--amber-10);
	}

	.workspace-icon.remote {
		background: var(--accent-3);
		color: var(--accent-10);
	}

	.workspace-copy {
		display: grid;
		min-width: 0;
		gap: 2px;
	}

	.workspace-copy strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
		font-weight: 620;
	}

	.workspace-copy small {
		overflow: hidden;
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	time {
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
		text-align: right;
	}

	.selector-state {
		display: flex;
		height: 150px;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 8px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-text);
	}
</style>
