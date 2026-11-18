<script lang="ts">
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import type { KnowledgeBundleFileAccess } from '#lib/knowledge/api.js'
	import type { SaveState } from '#lib/workspace/document-draft.svelte.js'
	import type { EditorMode } from '#lib/workspace/workspace-session.svelte.js'
	import { BookOpenText, FolderKanban, PanelLeft, Search, Settings } from 'lucide-svelte'
	import type { Snippet } from 'svelte'
	import ApplicationMenu from './ApplicationMenu.svelte'
	import { windowTitleBarTranslation as t } from './WindowTitleBar.translation'
	import type { ApplicationCommand } from './application-command'
	import { DocumentTitleActions, EditorModeTabs, WindowControls } from './title-bar'

	type Props = {
		title: string
		documentTitle?: string
		documentAccess?: KnowledgeBundleFileAccess | null
		commands?: ApplicationCommand[]
		showSidebarControl?: boolean
		sidebarVisible?: boolean
		showSettings?: boolean
		showDocumentControls?: boolean
		showEditorModeControls?: boolean
		convertToMarkdownDisabled?: boolean
		saveState?: SaveState
		editorMode?: EditorMode
		properties?: Snippet
		ontoggleSidebar?: () => void
		onworkspace?: () => void
		onpalette?: () => void
		onsettings?: () => void
		onsave?: () => void
		onreload?: () => void
		onconvert?: () => void
		onmode?: (mode: EditorMode) => void
		onclose?: () => void
	}

	let {
		title,
		documentTitle,
		documentAccess = null,
		commands = [],
		showSidebarControl = false,
		sidebarVisible = true,
		showSettings = false,
		showDocumentControls = false,
		showEditorModeControls = false,
		convertToMarkdownDisabled = false,
		saveState = 'saved',
		editorMode = 'rich',
		properties,
		ontoggleSidebar,
		onworkspace,
		onpalette,
		onsettings,
		onsave,
		onreload,
		onconvert,
		onmode,
		onclose
	}: Props = $props()

	const api = desktopAPI()
	const nativeMenuBar = api?.nativeMenuBar ?? false
</script>

<header
	class={['window-titlebar', { 'plain-titlebar': !onworkspace, 'native-titlebar': nativeMenuBar }]}
>
	<div class="titlebar-leading no-drag">
		{#if !nativeMenuBar}<div class="app-mark"><BookOpenText size={14} /></div>{/if}
		{#if commands.length > 0 && !nativeMenuBar}<ApplicationMenu {commands} />{/if}
		{#if showSidebarControl}
			<IconButton
				label={sidebarVisible ? t.hideSidebar : t.showSidebar}
				pressed={sidebarVisible}
				size="small"
				onclick={ontoggleSidebar}
			>
				<PanelLeft size={15} />
			</IconButton>
		{/if}
	</div>

	{#if onworkspace}
		<button
			class="title-context no-drag"
			type="button"
			onclick={onworkspace}
			title={t.switchWorkspace}
		>
			<FolderKanban size={13} />
			<span class="workspace-title">{title}</span>
			{#if documentTitle}
				<span class="title-separator">/</span><strong>{documentTitle}</strong>
			{/if}
		</button>
	{:else}
		<strong class="plain-title">{title}</strong>
	{/if}

	<div class="titlebar-actions no-drag">
		<DocumentTitleActions
			{documentAccess}
			{showDocumentControls}
			{convertToMarkdownDisabled}
			{saveState}
			{properties}
			{onconvert}
			{onreload}
			{onsave}
		/>
		{#if showEditorModeControls}
			<EditorModeTabs value={editorMode} onchange={onmode} />
		{/if}
		{#if onpalette}
			<IconButton label={t.commandPalette} size="small" onclick={onpalette}>
				<Search size={14} />
			</IconButton>
		{/if}
		{#if showSettings && !nativeMenuBar}
			<IconButton label={t.applicationSettings} size="small" onclick={onsettings}>
				<Settings size={14} />
			</IconButton>
		{/if}
		{#if !nativeMenuBar}<WindowControls {onclose} />{/if}
	</div>
</header>

<style>
	.window-titlebar {
		position: relative;
		display: grid;
		height: var(--window-titlebar-height);
		align-items: center;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		border-bottom: 1px solid var(--gray-6);
		background: var(--gray-2);
		color: var(--gray-12);
		-webkit-app-region: drag;
		user-select: none;
	}

	.window-titlebar.plain-titlebar {
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	}

	.window-titlebar.native-titlebar {
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 12px;
		padding-right: 12px;
	}

	.native-titlebar .titlebar-leading {
		/* Keep native traffic lights and their click targets clear of web controls. */
		padding-left: 84px;
	}

	.native-titlebar .title-context {
		max-width: min(100%, 420px);
	}

	.native-titlebar.plain-titlebar {
		grid-template-columns: minmax(84px, 1fr) auto minmax(84px, 1fr);
	}

	.titlebar-leading,
	.titlebar-actions,
	.title-context {
		display: flex;
		align-items: center;
	}

	.titlebar-leading,
	.titlebar-actions {
		height: 100%;
	}

	.titlebar-leading {
		min-width: 0;
		gap: 3px;
		padding-left: 6px;
	}

	.titlebar-actions {
		min-width: 0;
		justify-self: end;
		justify-content: flex-end;
		gap: 3px;
	}

	.app-mark {
		display: grid;
		width: 22px;
		height: 22px;
		place-items: center;
		border-radius: 5px;
		background: var(--accent-9);
		color: var(--color-solid-foreground);
	}

	.title-context {
		max-width: min(25vw, 420px);
		min-width: 0;
		justify-self: center;
		gap: 5px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		padding: 4px 7px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		cursor: default;
	}

	.title-context:hover {
		background: var(--gray-4);
		color: var(--gray-12);
	}

	.title-context span,
	.title-context strong,
	.plain-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title-context strong {
		max-width: min(26vw, 300px);
		color: var(--gray-12);
		font-weight: 620;
	}

	.workspace-title {
		max-width: 160px;
	}

	.title-separator {
		color: var(--gray-11);
	}

	.plain-title {
		min-width: 0;
		max-width: 100%;
		justify-self: center;
		font-size: var(--font-size-ui-text);
		font-weight: 620;
		text-align: center;
		pointer-events: none;
	}

	.no-drag {
		-webkit-app-region: no-drag;
	}

	@media (max-width: 900px) {
		.window-titlebar {
			grid-template-columns: auto minmax(0, 1fr) auto;
		}

		.title-context {
			width: 100%;
			max-width: none;
			justify-content: center;
			justify-self: stretch;
			padding-right: 4px;
			padding-left: 4px;
		}

		.workspace-title,
		.title-separator {
			display: none;
		}

		.title-context strong {
			max-width: 100%;
		}
	}
</style>
