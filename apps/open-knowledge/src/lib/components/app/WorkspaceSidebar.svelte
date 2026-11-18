<script lang="ts">
	import { goto } from '$app/navigation'
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte'
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import PromptDialog from '#lib/components/ui/PromptDialog.svelte'
	import type { KnowledgeBundleEntry, KnowledgeBundlePath } from '#lib/knowledge/api.js'
	import { documentRoute } from '#lib/navigation/routes.js'
	import type { WorkspaceSession } from '#lib/workspace/workspace-session.svelte.js'
	import { WorkspaceSidebarController } from '#lib/workspace/workspace-sidebar-controller.svelte.js'
	import { FilePlus2, FolderPlus, Search, X } from 'lucide-svelte'
	import { onDestroy } from 'svelte'
	import FileTree from './FileTree.svelte'
	import WorkspaceSearchResults from './WorkspaceSearchResults.svelte'
	import { workspaceSidebarTranslation as t } from './WorkspaceSidebar.translation'

	type Props = {
		session: WorkspaceSession
	}

	type DialogState =
		| { action: 'create'; kind: 'directory' | 'file'; parentPath: KnowledgeBundlePath }
		| { action: 'rename'; entry: KnowledgeBundleEntry }
		| { action: 'delete'; entry: KnowledgeBundleEntry }
		| null

	let { session }: Props = $props()
	let dialog = $state<DialogState>(null)
	const controller = new WorkspaceSidebarController(() => session, {
		navigateDocument(workspaceID, path, { replaceState }) {
			return goto(documentRoute(workspaceID, path), { replace: replaceState })
		}
	})

	const defaultParent = $derived(session.document?.parentPath ?? '/')

	$effect(() => {
		controller.synchronizeSearch()
	})
	onDestroy(() => controller.dispose())

	async function submitDialog(value: string): Promise<boolean> {
		if (!dialog) {
			return false
		}
		if (dialog.action === 'create') {
			return Boolean(await session.createEntry(dialog.kind, dialog.parentPath, value))
		}
		if (dialog.action === 'rename') {
			return Boolean(await session.renameEntry(dialog.entry, value))
		}
		return session.deleteEntry(dialog.entry)
	}
</script>

<aside class="sidebar">
	<div class="search-row">
		<Search size={14} />
		<input
			bind:value={controller.query}
			aria-label={t.searchFiles}
			placeholder={t.filterFiles}
			maxlength="1000"
		/>
		{#if controller.query}
			<IconButton label={t.clearSearch} size="small" onclick={() => controller.clearQuery()}>
				<X size={13} />
			</IconButton>
		{/if}
	</div>
	<div class="tree-heading">
		<span>{t.files}</span>
		{#if session.editable}
			<div>
				<IconButton
					label={t.newDocument}
					onclick={() => {
						dialog = { action: 'create', kind: 'file', parentPath: defaultParent }
					}}
				>
					<FilePlus2 size={15} />
				</IconButton>
				<IconButton
					label={t.newFolder}
					onclick={() => {
						dialog = { action: 'create', kind: 'directory', parentPath: defaultParent }
					}}
				>
					<FolderPlus size={15} />
				</IconButton>
			</div>
		{/if}
	</div>
	{#if controller.query.trim() && session.local}
		<WorkspaceSearchResults
			entries={session.entries}
			query={controller.query}
			matches={controller.searchMatches?.matches ?? []}
			loading={controller.searchLoading}
			failed={controller.searchFailed}
			truncated={controller.searchMatches?.truncated ?? false}
			onopen={(entry) => void controller.openEntry(entry)}
		/>
	{:else}
		<FileTree
			entries={session.entries}
			editable={session.editable}
			local={session.local}
			query={controller.query}
			selectedPath={session.document?.path}
			onopen={(entry) => void controller.openEntry(entry)}
			onopennew={(entry) => void session.openDocumentInNewWindow(entry.path)}
			onconvert={(entry) => void session.convertDocumentToMarkdown(entry)}
			oncreate={(entry, kind) => {
				dialog = { action: 'create', kind, parentPath: entry?.path ?? '/' }
			}}
			onrename={(entry) => {
				dialog = { action: 'rename', entry }
			}}
			ondelete={(entry) => {
				dialog = { action: 'delete', entry }
			}}
		/>
	{/if}
</aside>

{#if dialog?.action === 'create'}
	<PromptDialog
		title={dialog.kind === 'file' ? t.newDocument : t.newFolder}
		description={dialog.parentPath === '/' ? t.workspaceRoot : t.inside(dialog.parentPath.slice(1))}
		confirmLabel={t.create}
		initialValue={dialog.kind === 'file' ? t.untitledDocument : t.untitledFolder}
		oncancel={() => {
			dialog = null
		}}
		onconfirm={submitDialog}
	/>
{:else if dialog?.action === 'rename'}
	<PromptDialog
		title={t.renameTitle(dialog.entry.kind)}
		description={t.renameDescription(dialog.entry.name)}
		confirmLabel={t.rename}
		initialValue={dialog.entry.name}
		oncancel={() => {
			dialog = null
		}}
		onconfirm={submitDialog}
	/>
{:else if dialog?.action === 'delete'}
	<ConfirmDialog
		title={t.deleteTitle(dialog.entry.name)}
		description={dialog.entry.kind === 'directory' ? t.deleteEmptyFolder : t.deleteFile}
		confirmLabel={t.delete}
		oncancel={() => {
			dialog = null
		}}
		onconfirm={() => submitDialog('')}
	/>
{/if}

<style>
	.sidebar {
		display: grid;
		min-width: 0;
		min-height: 0;
		grid-template-rows: 42px 36px minmax(0, 1fr);
		border-right: 1px solid var(--gray-6);
		background: var(--gray-2);
	}

	.search-row,
	.tree-heading {
		display: flex;
		align-items: center;
	}

	.tree-heading > div {
		display: flex;
		flex: 0 0 auto;
	}

	.tree-heading > span {
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		font-weight: 650;
		text-transform: uppercase;
	}

	.search-row {
		position: relative;
		margin: 5px 9px;
		border: 1px solid var(--gray-6);
		border-radius: 5px;
		background: var(--gray-1);
		padding-left: 8px;
		color: var(--gray-9);
	}

	.search-row input {
		width: 100%;
		height: 30px;
		border: 0;
		background: transparent;
		padding: 0 6px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-text);
		outline: none;
	}

	.search-row:has(input:focus) {
		border-color: var(--accent-8);
		outline: 2px solid var(--accent-4);
	}

	.tree-heading {
		justify-content: space-between;
		padding: 0 7px 0 12px;
	}
</style>
