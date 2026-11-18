<script lang="ts" module>
	import { markdownEditorTranslation as t } from './MarkdownEditor.translation'
</script>

<script lang="ts">
	import { desktopAPI } from '#lib/knowledge/client.js'
	import type { KnowledgeBundlePath } from '#lib/knowledge/api.js'
	import type { ApplicationSettings } from '#lib/settings/api.js'
	import type { WindowEditActionInput } from '#lib/window/api.js'
	import { ContextMenu } from 'bits-ui'
	import { onMount, untrack } from 'svelte'
	import EditorContextMenu from './context-menu/EditorContextMenu.svelte'
	import EditorToolbar from './toolbar/EditorToolbar.svelte'
	import ImagePopover from './images/ImagePopover.svelte'
	import LinkPopover from './links/LinkPopover.svelte'
	import {
		MarkdownEditorController,
		type MarkdownEditorControllerSnapshot
	} from './markdown-editor-controller.svelte'
	import ReferenceMenu from './references/ReferenceMenu.svelte'
	import type { WorkspaceReference } from './references/references'
	import SelectionToolbar from './toolbar/SelectionToolbar.svelte'
	import SlashCommandMenu from './slash-commands/SlashCommandMenu.svelte'
	import { localizedSlashCommandSearch } from './slash-commands/slash-commands.translation'

	type Props = {
		markdown: string
		disabled?: boolean
		readonly?: boolean
		editorControls: ApplicationSettings['editorControls']
		editorFontFamily: ApplicationSettings['editorFontFamily']
		editorFontSize: number
		documentPath: KnowledgeBundlePath
		documentPaths: KnowledgeBundlePath[]
		resolveAbsolutePathsFromProjectRoot: boolean
		references: WorkspaceReference[]
		onopenreference: (path: KnowledgeBundlePath) => void
		onopensystempath: (path: string) => void
		onchange: (markdown: string) => void
	}

	let {
		markdown,
		disabled = false,
		readonly = false,
		editorControls,
		editorFontFamily,
		editorFontSize,
		documentPath,
		documentPaths,
		resolveAbsolutePathsFromProjectRoot,
		references,
		onopenreference,
		onopensystempath,
		onchange
	}: Props = $props()

	const api = desktopAPI()
	let host: HTMLDivElement
	let contextMenuOpen = $state(false)
	const showToolbar = $derived(
		!readonly && (editorControls === 'toolbar' || editorControls === 'both')
	)
	const controller = new MarkdownEditorController(controllerSnapshot())

	$effect(() => {
		const snapshot = controllerSnapshot()
		untrack(() => controller.synchronize(snapshot))
	})

	onMount(() => {
		controller.mount(host)
		return () => controller.dispose()
	})

	function controllerSnapshot(): MarkdownEditorControllerSnapshot {
		return {
			markdown,
			disabled,
			readonly,
			editorControls,
			documentPath,
			documentPaths,
			resolveAbsolutePathsFromProjectRoot,
			references,
			documentEditorLabel: t.documentEditor,
			slashCommandSearch: localizedSlashCommandSearch(),
			onopenreference,
			onopensystempath,
			onchange,
			performEditAction: api ? performEditAction : null
		}
	}

	function performEditAction(input: WindowEditActionInput): void {
		void api?.window.performEditAction(input)
	}
</script>

<div
	class={[
		'markdown-editor',
		`font-${editorFontFamily}`,
		{ disabled, 'without-toolbar': !showToolbar }
	]}
	style:--editor-font-size={`${editorFontSize}px`}
>
	{#if showToolbar}
		<EditorToolbar
			state={controller.editorState}
			disabled={controller.editingDisabled}
			run={controller.run}
			editLink={controller.editLink}
			editImage={controller.editImage}
		/>
	{/if}
	<ContextMenu.Root bind:open={contextMenuOpen}>
		<ContextMenu.Trigger class="editor-scroll">
			{#snippet child({ props })}
				<div {...props}>
					<div class="prosemirror-host" bind:this={host}></div>
				</div>
			{/snippet}
		</ContextMenu.Trigger>
		<EditorContextMenu
			state={controller.editorState}
			disabled={controller.editingDisabled}
			run={controller.run}
			editLink={controller.editLink}
			onedit={controller.edit}
			onrestorefocus={controller.restoreEditorFocus}
		/>
	</ContextMenu.Root>
	{#if controller.selectionReference && !contextMenuOpen}
		<SelectionToolbar
			state={controller.editorState}
			disabled={controller.editingDisabled}
			reference={controller.selectionReference}
			run={controller.run}
			editLink={controller.editLink}
		/>
	{/if}
	{#if controller.referenceMatch}
		<ReferenceMenu
			id={controller.referenceMenuID}
			references={controller.referenceResults}
			selected={controller.selectedIndex}
			left={controller.popupLeft}
			top={controller.popupTop}
			onselect={controller.selectReference}
		/>
	{:else if controller.slashMatch}
		<SlashCommandMenu
			id={controller.slashMenuID}
			commands={controller.slashCommands}
			selected={controller.selectedIndex}
			left={controller.popupLeft}
			top={controller.popupTop}
			onselect={controller.selectSlashCommand}
		/>
	{/if}
	{#if controller.linkEditor}
		<LinkPopover
			left={controller.linkEditor.left}
			top={controller.linkEditor.top}
			onapply={controller.applyLink}
			onclose={controller.closeLinkEditor}
		/>
	{/if}
	{#if controller.imageEditor}
		<ImagePopover
			left={controller.imageEditor.left}
			top={controller.imageEditor.top}
			initialAlt={controller.imageEditor.initialAlt}
			onapply={controller.applyImage}
			onclose={controller.closeImageEditor}
		/>
	{/if}
</div>

<style>
	.markdown-editor {
		display: grid;
		height: 100%;
		min-height: 0;
		grid-template-rows: auto minmax(0, 1fr);
		overflow: hidden;
	}

	.markdown-editor.without-toolbar {
		grid-template-rows: 1fr;
	}

	.markdown-editor.disabled {
		opacity: 0.7;
	}

	.markdown-editor :global(.editor-scroll) {
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}

	.prosemirror-host {
		width: min(100% - 48px, 820px);
		min-height: 100%;
		margin: 0 auto;
		padding: 42px 0 160px;
	}

	:global(.ProseMirror) {
		min-height: 480px;
		outline: none;
		color: var(--gray-12);
		font-family: var(--font-book);
		font-size: var(--editor-font-size);
		line-height: 1.72;
		caret-color: var(--accent-10);
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.font-sans :global(.ProseMirror) {
		font-family: var(--font-ui);
	}

	.font-mono :global(.ProseMirror) {
		font-family: var(--font-mono);
	}

	:global(.ProseMirror > *:first-child) {
		margin-top: 0;
	}

	:global(.ProseMirror h1),
	:global(.ProseMirror h2),
	:global(.ProseMirror h3),
	:global(.ProseMirror h4),
	:global(.ProseMirror h5),
	:global(.ProseMirror h6) {
		margin: 1.65em 0 0.55em;
		color: var(--gray-12);
		font-family: var(--font-ui);
		font-weight: 700;
		line-height: 1.22;
		letter-spacing: 0;
	}

	:global(.ProseMirror h1) {
		font-size: var(--font-size-content-heading-1);
	}

	:global(.ProseMirror h2) {
		font-size: var(--font-size-content-heading-2);
	}

	:global(.ProseMirror h3) {
		font-size: var(--font-size-content-heading-3);
	}

	:global(.ProseMirror h4) {
		font-size: var(--font-size-content-heading-4);
	}

	:global(.ProseMirror h5) {
		font-size: var(--font-size-content-heading-5);
	}

	:global(.ProseMirror h6) {
		font-size: var(--font-size-content-heading-6);
		color: var(--gray-11);
	}

	:global(.ProseMirror p) {
		margin: 0.75em 0;
	}

	:global(.ProseMirror ul),
	:global(.ProseMirror ol) {
		padding-left: 1.65rem;
	}

	:global(.ProseMirror blockquote) {
		margin: 1rem 0;
		border-left: 3px solid var(--amber-8);
		padding-left: 1rem;
		color: var(--gray-11);
	}

	:global(.ProseMirror code) {
		border-radius: 4px;
		background: var(--gray-4);
		padding: 0.14em 0.32em;
		font-family: var(--font-mono);
		font-size: max(var(--font-size-editor-inline-code-min), var(--font-size-content-inline-code));
	}

	:global(.ProseMirror pre) {
		overflow: auto;
		border: 1px solid var(--gray-6);
		border-radius: 6px;
		background: var(--gray-3);
		padding: 16px;
	}

	:global(.ProseMirror pre code) {
		background: transparent;
		padding: 0;
	}

	:global(.ProseMirror a) {
		color: var(--accent-11);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	:global(.ProseMirror img) {
		max-width: 100%;
	}

	:global(.ProseMirror hr) {
		margin: 1.75rem 0;
		border: 0;
		border-top: 1px solid var(--gray-7);
	}

	:global(.ProseMirror table) {
		width: 100%;
		margin: 1.25rem 0;
		border-collapse: collapse;
	}

	:global(.ProseMirror th),
	:global(.ProseMirror td) {
		min-width: 80px;
		border: 1px solid var(--gray-7);
		padding: 8px 10px;
		vertical-align: top;
	}

	:global(.ProseMirror th) {
		background: var(--gray-3);
		font-family: var(--font-ui);
		font-weight: 650;
	}

	:global(.ProseMirror .selectedCell::after) {
		background: color-mix(in srgb, var(--accent-7) 24%, transparent);
	}
</style>
