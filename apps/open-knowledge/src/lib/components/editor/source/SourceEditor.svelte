<script lang="ts" module>
	import { sourceEditorTranslation as t } from './SourceEditor.translation'
</script>

<script lang="ts">
	import { desktopAPI } from '#lib/knowledge/client.js'
	import type { WindowEditActionInput } from '#lib/window/api.js'
	import { ContextMenu } from 'bits-ui'
	import EditingMenuItems from '../editing-menu/EditingMenuItems.svelte'
	import { indentSource, outdentSource, type SourceEdit } from './source-edits'

	type Props = {
		markdown: string
		disabled?: boolean
		readonly?: boolean
		onchange: (markdown: string) => void
	}

	let { markdown, disabled = false, readonly = false, onchange }: Props = $props()
	const api = desktopAPI()
	let textarea = $state.raw<HTMLTextAreaElement | null>(null)
	let canCutCopy = $state(false)
	let restoreFocusOnClose = true

	function input(event: Event): void {
		if (event.currentTarget instanceof HTMLTextAreaElement) {
			onchange(event.currentTarget.value)
		}
	}

	function updateSelection(): void {
		canCutCopy = Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd)
	}

	function keydown(event: KeyboardEvent): void {
		if (
			event.key !== 'Tab' ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			!textarea ||
			disabled ||
			readonly
		) {
			return
		}
		event.preventDefault()
		const edit = event.shiftKey
			? outdentSource(textarea.value, textarea.selectionStart, textarea.selectionEnd)
			: indentSource(textarea.value, textarea.selectionStart, textarea.selectionEnd)
		if (edit) {
			replaceSource(edit)
		}
		updateSelection()
	}

	function replaceSource(edit: SourceEdit): void {
		if (!textarea) {
			return
		}
		textarea.focus()
		textarea.setSelectionRange(edit.start, edit.end)
		// This keeps indentation in the textarea's native undo history.
		if (!document.execCommand('insertText', false, edit.replacement)) {
			textarea.setRangeText(edit.replacement, edit.start, edit.end)
			onchange(textarea.value)
		}
		textarea.setSelectionRange(edit.nextSelectionStart, edit.nextSelectionEnd)
	}

	function edit(action: WindowEditActionInput['action']): void {
		requestAnimationFrame(() => {
			textarea?.focus()
			void api?.window.performEditAction({ action })
		})
	}
</script>

<div class="source-editor">
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				<textarea
					{...props}
					tabindex="0"
					bind:this={textarea}
					value={markdown}
					oninput={input}
					onkeydown={keydown}
					onkeyup={updateSelection}
					onpointerup={updateSelection}
					onselect={updateSelection}
					{disabled}
					{readonly}
					spellcheck="false"
					aria-label={t.markdownSource}></textarea>
			{/snippet}
		</ContextMenu.Trigger>
		<ContextMenu.Portal>
			<ContextMenu.Content
				class="ui-menu-content source-context-menu"
				aria-label={t.sourceActions}
				collisionPadding={8}
				loop
				preventScroll={false}
				onInteractOutside={() => {
					restoreFocusOnClose = false
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault()
					if (restoreFocusOnClose) {
						textarea?.focus()
					}
					restoreFocusOnClose = true
				}}
			>
				<EditingMenuItems disabled={disabled || readonly} {canCutCopy} onaction={edit} />
			</ContextMenu.Content>
		</ContextMenu.Portal>
	</ContextMenu.Root>
</div>

<style>
	.source-editor {
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: var(--gray-2);
		padding: 16px;
	}

	textarea {
		display: block;
		width: min(100%, 940px);
		height: 100%;
		min-height: 0;
		margin: 0 auto;
		overflow: auto;
		resize: none;
		border: 1px solid var(--gray-6);
		border-radius: 6px;
		background: var(--gray-1);
		box-shadow: 0 1px 3px var(--black-a3);
		padding: 20px 24px 120px;
		color: var(--gray-12);
		font-family: var(--font-mono);
		font-size: var(--font-size-editor-source);
		line-height: 1.7;
		tab-size: 2;
	}

	textarea:focus {
		border-color: var(--accent-7);
		outline: none;
		box-shadow: 0 0 0 2px var(--accent-4);
	}

	:global(.source-context-menu) {
		width: 190px;
	}
</style>
