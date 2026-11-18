<script lang="ts">
	import type { KnowledgeBundleEntry } from '#lib/knowledge/api.js'
	import { ContextMenu } from 'bits-ui'
	import { SvelteSet } from 'svelte/reactivity'
	import FileActionsMenu from './FileActionsMenu.svelte'
	import { fileTreeTranslation as t } from './FileTree.translation'
	import FileTreeRow from './FileTreeRow.svelte'
	import { filterEntries, pathDepth } from './file-tree-view'

	type Props = {
		entries: KnowledgeBundleEntry[]
		editable: boolean
		local: boolean
		query: string
		selectedPath?: string
		onopen: (entry: KnowledgeBundleEntry) => void
		onopennew: (entry: KnowledgeBundleEntry) => void
		onconvert: (entry: KnowledgeBundleEntry) => void
		oncreate: (parent: KnowledgeBundleEntry | null, kind: 'directory' | 'file') => void
		onrename: (entry: KnowledgeBundleEntry) => void
		ondelete: (entry: KnowledgeBundleEntry) => void
	}

	let {
		entries,
		editable,
		local,
		query,
		selectedPath,
		onopen,
		onopennew,
		onconvert,
		oncreate,
		onrename,
		ondelete
	}: Props = $props()

	const collapsed = new SvelteSet<string>()
	const visibleEntries = $derived.by(() => filterEntries(entries, query, collapsed))
	let menuEntry = $state.raw<KnowledgeBundleEntry | null>(null)

	function open(entry: KnowledgeBundleEntry): void {
		if (entry.kind === 'file') {
			onopen(entry)
			return
		}
		if (collapsed.has(entry.path)) {
			collapsed.delete(entry.path)
		} else {
			collapsed.add(entry.path)
		}
	}

	function backgroundContextMenu(event: MouseEvent): void {
		if (event.target === event.currentTarget) {
			menuEntry = null
		}
	}
</script>

<ContextMenu.Root
	onOpenChange={(open) => {
		if (!open) {
			menuEntry = null
		}
	}}
>
	<ContextMenu.Trigger
		class="file-tree"
		aria-label={t.workspaceFiles}
		oncontextmenu={backgroundContextMenu}
	>
		{#snippet child({ props })}
			<nav {...props}>
				{#each visibleEntries as entry (entry.path)}
					<FileTreeRow
						{entry}
						{editable}
						{local}
						depth={pathDepth(entry.path)}
						selected={selectedPath === entry.path}
						collapsed={collapsed.has(entry.path)}
						onopen={() => open(entry)}
						onmenu={() => {
							menuEntry = entry
						}}
						{onopennew}
						{onconvert}
						{oncreate}
						{onrename}
						{ondelete}
					/>
				{:else}
					<div class="tree-empty">
						{query ? t.noMatchingFiles : t.workspaceEmpty}
					</div>
				{/each}
			</nav>
		{/snippet}
	</ContextMenu.Trigger>
	<ContextMenu.Portal>
		<ContextMenu.Content
			class="ui-menu-content file-actions-menu"
			data-motion="anchored"
			aria-label={menuEntry ? t.actionsFor(menuEntry.name) : t.workspaceActions}
			collisionPadding={8}
			loop
		>
			<FileActionsMenu
				variant="context"
				entry={menuEntry}
				{editable}
				{local}
				{onopennew}
				{onconvert}
				{oncreate}
				{onrename}
				{ondelete}
			/>
		</ContextMenu.Content>
	</ContextMenu.Portal>
</ContextMenu.Root>

<style>
	:global(.file-tree) {
		display: block;
		min-height: 100%;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 0 5px 12px;
	}

	.tree-empty {
		padding: 18px 10px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		text-align: center;
	}
</style>
