<script lang="ts">
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import type { KnowledgeBundleFileAccess } from '#lib/knowledge/api.js'
	import type { SaveState } from '#lib/workspace/document-draft.svelte.js'
	import {
		Check,
		CircleAlert,
		FileOutput,
		LoaderCircle,
		LockKeyhole,
		RotateCcw,
		Save
	} from 'lucide-svelte'
	import type { Snippet } from 'svelte'
	import { windowTitleBarTranslation as t } from '../WindowTitleBar.translation'

	type Props = {
		documentAccess: KnowledgeBundleFileAccess | null
		showDocumentControls: boolean
		convertToMarkdownDisabled: boolean
		saveState: SaveState
		properties?: Snippet
		onconvert?: () => void
		onreload?: () => void
		onsave?: () => void
	}

	let {
		documentAccess,
		showDocumentControls,
		convertToMarkdownDisabled,
		saveState,
		properties,
		onconvert,
		onreload,
		onsave
	}: Props = $props()
</script>

{#if onconvert}
	<IconButton
		label={t.convertToMarkdown}
		size="small"
		disabled={convertToMarkdownDisabled}
		onclick={onconvert}
	>
		<FileOutput size={14} />
	</IconButton>
{/if}
{#if documentAccess === 'readonly'}
	<div class="document-access" title={t.readonlyDocument} role="status">
		<LockKeyhole size={12} />
		<span class="ui-visually-hidden">{t.readonlyDocument}</span>
	</div>
{/if}
{#if showDocumentControls}
	<div class={['save-state', saveState]} title={t[saveState]} role="status" aria-live="polite">
		<span class="ui-visually-hidden">{t[saveState]}</span>
		{#if saveState === 'saved'}
			<Check size={13} />
		{:else if saveState === 'saving'}
			<LoaderCircle class="spin" size={13} />
		{:else if saveState === 'conflict' || saveState === 'error'}
			<CircleAlert size={13} />
		{:else}
			<span class="dirty-dot"></span>
		{/if}
	</div>
	{#if saveState === 'conflict'}
		<IconButton label={t.reloadFromDisk} size="small" onclick={onreload}>
			<RotateCcw size={14} />
		</IconButton>
	{:else}
		<IconButton
			label={t.saveDocument}
			size="small"
			disabled={saveState === 'saved' || saveState === 'saving'}
			onclick={onsave}
		>
			<Save size={14} />
		</IconButton>
	{/if}
	{#if properties}{@render properties()}{/if}
{/if}

<style>
	.save-state {
		display: flex;
		width: 18px;
		align-items: center;
		justify-content: center;
		color: var(--green-11);
	}

	.document-access {
		display: grid;
		width: 18px;
		height: 18px;
		place-items: center;
		color: var(--gray-10);
	}

	.save-state.dirty {
		color: var(--amber-10);
	}

	.save-state.error,
	.save-state.conflict {
		color: var(--red-11);
	}

	.dirty-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}

	:global(.spin) {
		animation: spin 800ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
