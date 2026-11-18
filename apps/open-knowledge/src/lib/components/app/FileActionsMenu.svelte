<script lang="ts">
	import type { KnowledgeBundleEntry } from '#lib/knowledge/api.js'
	import { isAnydocPath } from '#lib/knowledge/anydoc.js'
	import { ContextMenu, DropdownMenu } from 'bits-ui'
	import { AppWindow, FileOutput, FilePlus2, FolderPlus, Pencil, Trash2 } from 'lucide-svelte'
	import { fileActionsMenuTranslation as t } from './FileActionsMenu.translation'

	type Props = {
		variant: 'context' | 'dropdown'
		entry: KnowledgeBundleEntry | null
		editable: boolean
		local: boolean
		onopennew: (entry: KnowledgeBundleEntry) => void
		onconvert: (entry: KnowledgeBundleEntry) => void
		oncreate: (parent: KnowledgeBundleEntry | null, kind: 'directory' | 'file') => void
		onrename: (entry: KnowledgeBundleEntry) => void
		ondelete: (entry: KnowledgeBundleEntry) => void
	}

	let {
		variant,
		entry,
		editable,
		local,
		onopennew,
		onconvert,
		oncreate,
		onrename,
		ondelete
	}: Props = $props()
	const convertible = $derived(local && entry?.kind === 'file' && isAnydocPath(entry.path))
</script>

{#if variant === 'context'}
	{#if editable && (!entry || entry.kind === 'directory')}
		<ContextMenu.Item
			class="ui-menu-item"
			textValue={t.newDocument}
			onSelect={() => oncreate(entry, 'file')}
		>
			<FilePlus2 size={14} /> <span class="ui-menu-label">{t.newDocument}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item"
			textValue={t.newFolder}
			onSelect={() => oncreate(entry, 'directory')}
		>
			<FolderPlus size={14} /> <span class="ui-menu-label">{t.newFolder}</span>
		</ContextMenu.Item>
		{#if entry}<ContextMenu.Separator class="ui-menu-separator" />{/if}
	{/if}
	{#if entry?.kind === 'file'}
		<ContextMenu.Item
			class="ui-menu-item"
			textValue={t.openDedicated}
			onSelect={() => onopennew(entry)}
		>
			<AppWindow size={14} /> <span class="ui-menu-label">{t.openDedicated}</span>
		</ContextMenu.Item>
		{#if convertible}
			<ContextMenu.Item
				class="ui-menu-item"
				textValue={t.convertToMarkdown}
				disabled={!editable}
				onSelect={() => onconvert(entry)}
			>
				<FileOutput size={14} /> <span class="ui-menu-label">{t.convertToMarkdown}</span>
			</ContextMenu.Item>
		{/if}
		{#if editable}<ContextMenu.Separator class="ui-menu-separator" />{/if}
	{/if}
	{#if editable && entry}
		<ContextMenu.Item class="ui-menu-item" textValue={t.rename} onSelect={() => onrename(entry)}>
			<Pencil size={14} /> <span class="ui-menu-label">{t.rename}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item"
			data-variant="danger"
			textValue={t.delete}
			onSelect={() => ondelete(entry)}
		>
			<Trash2 size={14} /> <span class="ui-menu-label">{t.delete}</span>
		</ContextMenu.Item>
	{/if}
{:else}
	{#if editable && (!entry || entry.kind === 'directory')}
		<DropdownMenu.Item
			class="ui-menu-item"
			textValue={t.newDocument}
			onSelect={() => oncreate(entry, 'file')}
		>
			<FilePlus2 size={14} /> <span class="ui-menu-label">{t.newDocument}</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item
			class="ui-menu-item"
			textValue={t.newFolder}
			onSelect={() => oncreate(entry, 'directory')}
		>
			<FolderPlus size={14} /> <span class="ui-menu-label">{t.newFolder}</span>
		</DropdownMenu.Item>
		{#if entry}<DropdownMenu.Separator class="ui-menu-separator" />{/if}
	{/if}
	{#if entry?.kind === 'file'}
		<DropdownMenu.Item
			class="ui-menu-item"
			textValue={t.openDedicated}
			onSelect={() => onopennew(entry)}
		>
			<AppWindow size={14} /> <span class="ui-menu-label">{t.openDedicated}</span>
		</DropdownMenu.Item>
		{#if convertible}
			<DropdownMenu.Item
				class="ui-menu-item"
				textValue={t.convertToMarkdown}
				disabled={!editable}
				onSelect={() => onconvert(entry)}
			>
				<FileOutput size={14} /> <span class="ui-menu-label">{t.convertToMarkdown}</span>
			</DropdownMenu.Item>
		{/if}
		{#if editable}<DropdownMenu.Separator class="ui-menu-separator" />{/if}
	{/if}
	{#if editable && entry}
		<DropdownMenu.Item class="ui-menu-item" textValue={t.rename} onSelect={() => onrename(entry)}>
			<Pencil size={14} /> <span class="ui-menu-label">{t.rename}</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item
			class="ui-menu-item"
			data-variant="danger"
			textValue={t.delete}
			onSelect={() => ondelete(entry)}
		>
			<Trash2 size={14} /> <span class="ui-menu-label">{t.delete}</span>
		</DropdownMenu.Item>
	{/if}
{/if}
