<script lang="ts">
	import type { KnowledgeBundleEntry } from '#lib/knowledge/api.js'
	import { DropdownMenu } from 'bits-ui'
	import {
		ChevronDown,
		ChevronRight,
		FileLock2,
		FileQuestion,
		FileText,
		Folder,
		FolderOpen,
		MoreHorizontal
	} from 'lucide-svelte'
	import FileActionsMenu from './FileActionsMenu.svelte'
	import { fileTreeRowTranslation as t } from './FileTreeRow.translation'

	type Props = {
		entry: KnowledgeBundleEntry
		editable: boolean
		local: boolean
		depth: number
		selected?: boolean
		collapsed?: boolean
		onopen: () => void
		onmenu: () => void
		onopennew: (entry: KnowledgeBundleEntry) => void
		onconvert: (entry: KnowledgeBundleEntry) => void
		oncreate: (parent: KnowledgeBundleEntry | null, kind: 'directory' | 'file') => void
		onrename: (entry: KnowledgeBundleEntry) => void
		ondelete: (entry: KnowledgeBundleEntry) => void
	}

	let {
		entry,
		editable,
		local,
		depth,
		selected = false,
		collapsed = false,
		onopen,
		onmenu,
		onopennew,
		onconvert,
		oncreate,
		onrename,
		ondelete
	}: Props = $props()

	let dropdownOpen = $state(false)
	let menuButton = $state.raw<HTMLButtonElement | null>(null)
	const hasActions = $derived(editable || entry.kind === 'file')
	const accessLabel = $derived.by(() => {
		if (entry.kind !== 'file') {
			return ''
		}
		if (entry.documentAccess === 'readonly') {
			return t.readonly
		}
		if (entry.documentAccess === 'not_supported') {
			return t.notSupported
		}
		return entry.documentAccess === 'writable' ? t.writable : ''
	})

	function contextmenu(event: MouseEvent): void {
		if (!hasActions) {
			event.preventDefault()
			event.stopPropagation()
			return
		}
		onmenu()
	}

	function keydown(event: KeyboardEvent): void {
		if (hasActions && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
			event.preventDefault()
			menuButton?.focus()
			dropdownOpen = true
		}
	}
</script>

<div
	class={['tree-row', { selected, folder: entry.kind === 'directory' }]}
	style:padding-left={`${8 + depth * 15}px`}
>
	<button
		class="entry-button"
		type="button"
		aria-label={accessLabel ? t.fileLabel(entry.name, accessLabel) : entry.name}
		title={accessLabel || undefined}
		onclick={onopen}
		onkeydown={keydown}
		oncontextmenu={contextmenu}
	>
		<span class="disclosure">
			{#if entry.kind === 'directory'}
				{#if collapsed}<ChevronRight size={13} />{:else}<ChevronDown size={13} />{/if}
			{/if}
		</span>
		<span class="entry-icon">
			{#if entry.kind === 'directory'}
				{#if collapsed}<Folder size={15} />{:else}<FolderOpen size={15} />{/if}
			{:else}
				{#if entry.documentAccess === 'readonly'}
					<FileLock2 size={15} />
				{:else if entry.documentAccess === 'not_supported'}
					<FileQuestion size={15} />
				{:else}
					<FileText size={15} />
				{/if}
			{/if}
		</span>
		<span class="entry-name">{entry.name.replace(/\.md$/i, '')}</span>
	</button>
	{#if hasActions}
		<DropdownMenu.Root bind:open={dropdownOpen}>
			<DropdownMenu.Trigger
				bind:ref={menuButton}
				class="more"
				aria-label={t.actionsFor(entry.name)}
			>
				<MoreHorizontal size={15} />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					class="ui-menu-content file-actions-menu"
					data-motion="anchored"
					aria-label={t.actionsFor(entry.name)}
					align="end"
					collisionPadding={8}
					sideOffset={4}
					loop
					onCloseAutoFocus={(event) => {
						event.preventDefault()
						menuButton?.focus()
					}}
				>
					<FileActionsMenu
						variant="dropdown"
						{entry}
						{editable}
						{local}
						{onopennew}
						{onconvert}
						{oncreate}
						{onrename}
						{ondelete}
					/>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	{/if}
</div>

<style>
	.tree-row {
		display: grid;
		height: 29px;
		margin-block-end: 2px;
		align-items: center;
		grid-template-columns: minmax(0, 1fr) 26px;
		border-radius: 5px;
		color: var(--gray-11);
		user-select: none;
	}

	.tree-row:hover,
	.tree-row.selected {
		background: var(--gray-4);
		color: var(--gray-12);
	}

	.tree-row.selected {
		background: var(--accent-4);
		color: var(--accent-12);
	}

	.entry-button {
		display: grid;
		height: 29px;
		min-width: 0;
		align-items: center;
		grid-template-columns: 14px 18px minmax(0, 1fr);
		border: 0;
		background: transparent;
		padding: 0;
		color: inherit;
		text-align: left;
		cursor: default;
	}

	.disclosure,
	.entry-icon {
		display: grid;
		place-items: center;
	}

	.disclosure {
		color: var(--gray-8);
	}

	.entry-icon {
		color: var(--gray-9);
	}

	.folder .entry-icon {
		color: var(--amber-10);
	}

	.entry-name {
		overflow: hidden;
		font-size: var(--font-size-ui-text);
		font-weight: 480;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.more) {
		display: grid;
		width: 24px;
		height: 24px;
		place-items: center;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--gray-9);
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
	}

	.tree-row:hover :global(.more),
	.tree-row:focus-within :global(.more),
	:global(.more:focus-visible),
	:global(.more[data-state='open']) {
		opacity: 1;
		pointer-events: auto;
	}

	:global(.more:hover) {
		background: var(--gray-6);
		color: var(--gray-12);
	}
</style>
