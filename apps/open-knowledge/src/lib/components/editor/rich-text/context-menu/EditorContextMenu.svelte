<script lang="ts" module>
	import { editorContextMenuTranslation as t } from './EditorContextMenu.translation'
</script>

<script lang="ts">
	import type { WindowEditActionInput } from '#lib/window/api.js'
	import { ContextMenu } from 'bits-ui'
	import { Bold, Braces, Italic, Link, List, ListOrdered, Strikethrough } from 'lucide-svelte'
	import { redo, undo } from 'prosemirror-history'
	import type { Command, EditorState } from 'prosemirror-state'
	import { isMarkActive, isNodeActive, markCommand, toggleList } from '../prosemirror/commands'
	import EditingMenuItems from '../../editing-menu/EditingMenuItems.svelte'
	import { editorMark, editorNode, editorSchema } from '../prosemirror/schema'

	type Props = {
		state: EditorState | null
		disabled?: boolean
		run: (command: Command) => void
		editLink: () => void
		onedit: (action: WindowEditActionInput['action']) => void
		onrestorefocus: () => void
	}

	let { state, disabled = false, run, editLink, onedit, onrestorefocus }: Props = $props()

	const strong = editorMark('strong')
	const emphasis = editorMark('em')
	const strike = editorMark('strike')
	const code = editorMark('code')
	const bulletList = editorNode('bullet_list')
	const orderedList = editorNode('ordered_list')
	const canUndo = $derived(Boolean(state && undo(state)))
	const canRedo = $derived(Boolean(state && redo(state)))
	const hasSelection = $derived(Boolean(state && !state.selection.empty))
	let restoreFocusOnClose = true

	function edit(action: WindowEditActionInput['action']): void {
		if (action === 'undo') {
			run(undo)
			return
		}
		if (action === 'redo') {
			run(redo)
			return
		}
		onedit(action)
	}
</script>

<ContextMenu.Portal>
	<ContextMenu.Content
		class="ui-menu-content editor-context-menu"
		aria-label={t.editorActions}
		collisionPadding={8}
		loop
		preventScroll={false}
		onInteractOutside={() => {
			restoreFocusOnClose = false
		}}
		onCloseAutoFocus={(event) => {
			event.preventDefault()
			if (restoreFocusOnClose) {
				onrestorefocus()
			}
			restoreFocusOnClose = true
		}}
	>
		<EditingMenuItems {disabled} {canUndo} {canRedo} canCutCopy={hasSelection} onaction={edit} />
		<ContextMenu.Separator class="ui-menu-separator" />
		<ContextMenu.Item
			class="ui-menu-item editor-format-item"
			data-active={isMarkActive(state, strong) ? '' : undefined}
			{disabled}
			textValue={t.bold}
			onSelect={() => run(markCommand(strong))}
		>
			<Bold size={14} /><span>{t.bold}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item editor-format-item"
			data-active={isMarkActive(state, emphasis) ? '' : undefined}
			{disabled}
			textValue={t.italic}
			onSelect={() => run(markCommand(emphasis))}
		>
			<Italic size={14} /><span>{t.italic}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item editor-format-item"
			data-active={isMarkActive(state, strike) ? '' : undefined}
			{disabled}
			textValue={t.strikethrough}
			onSelect={() => run(markCommand(strike))}
		>
			<Strikethrough size={14} /><span>{t.strikethrough}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item editor-format-item"
			data-active={isMarkActive(state, code) ? '' : undefined}
			{disabled}
			textValue={t.inlineCode}
			onSelect={() => run(markCommand(code))}
		>
			<Braces size={14} /><span>{t.inlineCode}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item editor-format-item"
			data-active={isNodeActive(state, bulletList) ? '' : undefined}
			{disabled}
			textValue={t.bulletedList}
			onSelect={() => run(toggleList(editorSchema, bulletList))}
		>
			<List size={14} /><span>{t.bulletedList}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item editor-format-item"
			data-active={isNodeActive(state, orderedList) ? '' : undefined}
			{disabled}
			textValue={t.numberedList}
			onSelect={() => run(toggleList(editorSchema, orderedList))}
		>
			<ListOrdered size={14} /><span>{t.numberedList}</span>
		</ContextMenu.Item>
		<ContextMenu.Item
			class="ui-menu-item editor-format-item"
			disabled={disabled || !hasSelection}
			textValue={t.link}
			onSelect={editLink}
		>
			<Link size={14} /><span>{t.link}</span>
		</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Portal>

<style>
	:global(.editor-context-menu) {
		width: 220px;
	}

	:global(.editor-context-menu .ui-menu-item > svg) {
		flex: 0 0 auto;
		color: currentColor;
	}

	:global(.editor-context-menu .editor-format-item[data-active]) {
		background: var(--accent-3);
		color: var(--accent-12);
	}

	:global(.editor-context-menu .editor-format-item[data-active] > svg) {
		color: var(--accent-11);
	}
</style>
