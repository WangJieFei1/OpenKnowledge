<script lang="ts" module>
	import { editorToolbarTranslation as t } from './EditorToolbar.translation'
</script>

<script lang="ts">
	import ToolbarIconButton from '#lib/components/ui/ToolbarIconButton.svelte'
	import { Select, Toolbar } from 'bits-ui'
	import {
		Bold,
		Braces,
		Check,
		ChevronDown,
		CornerDownLeft,
		ImagePlus,
		Italic,
		Link,
		List,
		ListOrdered,
		Minus,
		Quote,
		Redo2,
		Strikethrough,
		Table2,
		Undo2
	} from 'lucide-svelte'
	import { redo, undo } from 'prosemirror-history'
	import type { Command, EditorState } from 'prosemirror-state'
	import {
		canInsertInlineNode,
		currentBlockType,
		insertHardBreak,
		insertHorizontalRule,
		insertTable,
		isMarkActive,
		isNodeActive,
		markCommand,
		setTextBlock,
		toggleBlockquote,
		toggleList
	} from '../prosemirror/commands'
	import { editorMark, editorNode, editorSchema } from '../prosemirror/schema'

	type Props = {
		state: EditorState | null
		disabled?: boolean
		run: (command: Command) => boolean
		editLink: () => void
		editImage: () => void
	}

	let { state: editorState, disabled = false, run, editLink, editImage }: Props = $props()

	const blockType = $derived(currentBlockType(editorState))
	const linkDisabled = $derived(disabled || !editorState || editorState.selection.empty)
	const strong = editorMark('strong')
	const emphasis = editorMark('em')
	const strike = editorMark('strike')
	const code = editorMark('code')
	const bulletList = editorNode('bullet_list')
	const orderedList = editorNode('ordered_list')
	const blockquote = editorNode('blockquote')
	const image = editorNode('image')
	const hardBreak = editorNode('hard_break')
	const imageDisabled = $derived(disabled || !canInsertInlineNode(editorState, image))
	const hardBreakDisabled = $derived(disabled || !canInsertInlineNode(editorState, hardBreak))
	const blockOptions = $derived([
		{ value: 'paragraph', label: t.text },
		{ value: 'heading-1', label: t.heading1 },
		{ value: 'heading-2', label: t.heading2 },
		{ value: 'heading-3', label: t.heading3 },
		{ value: 'heading-4', label: t.heading4 },
		{ value: 'heading-5', label: t.heading5 },
		{ value: 'heading-6', label: t.heading6 },
		{ value: 'code_block', label: t.codeBlock }
	])
	const selectedBlockLabel = $derived(
		blockOptions.find((option) => option.value === blockType)?.label ?? t.text
	)
	let selectedBlock = $derived(blockType)

	function changeBlock(value: string): void {
		if (value === blockType) {
			return
		}
		if (!run(setTextBlock(editorSchema, value))) {
			selectedBlock = blockType
		}
	}
</script>

<Toolbar.Root class="toolbar" aria-label={t.formatting}>
	<div class="block-control">
		<Select.Root
			type="single"
			bind:value={selectedBlock}
			items={blockOptions}
			onValueChange={changeBlock}
			{disabled}
			loop
		>
			<Select.Trigger class="block-trigger" aria-label={`${t.textStyle}: ${selectedBlockLabel}`}>
				<Select.Value />
				<ChevronDown class="block-trigger-icon" size={14} aria-hidden="true" />
			</Select.Trigger>
			<Select.Portal>
				<Select.Content
					class="block-select-content"
					data-motion="anchored"
					align="start"
					sideOffset={4}
					collisionPadding={8}
				>
					<Select.Viewport class="block-select-viewport">
						{#each blockOptions as option (option.value)}
							<Select.Item class="block-select-item" value={option.value} label={option.label}>
								<span>{option.label}</span>
								<Check class="block-select-check" size={14} aria-hidden="true" />
							</Select.Item>
						{/each}
					</Select.Viewport>
				</Select.Content>
			</Select.Portal>
		</Select.Root>
	</div>
	<span class="separator"></span>
	<ToolbarIconButton label={t.undo} disabled={disabled || !editorState} onclick={() => run(undo)}
		><Undo2 size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton label={t.redo} disabled={disabled || !editorState} onclick={() => run(redo)}
		><Redo2 size={16} /></ToolbarIconButton
	>
	<span class="separator"></span>
	<ToolbarIconButton
		label={t.bold}
		pressed={isMarkActive(editorState, strong)}
		{disabled}
		onclick={() => run(markCommand(strong))}><Bold size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton
		label={t.italic}
		pressed={isMarkActive(editorState, emphasis)}
		{disabled}
		onclick={() => run(markCommand(emphasis))}><Italic size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton
		label={t.strikethrough}
		pressed={isMarkActive(editorState, strike)}
		{disabled}
		onclick={() => run(markCommand(strike))}><Strikethrough size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton
		label={t.inlineCode}
		pressed={isMarkActive(editorState, code)}
		{disabled}
		onclick={() => run(markCommand(code))}><Braces size={16} /></ToolbarIconButton
	>
	<span class="separator"></span>
	<ToolbarIconButton
		label={t.bulletedList}
		pressed={isNodeActive(editorState, bulletList)}
		{disabled}
		onclick={() => run(toggleList(editorSchema, bulletList))}><List size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton
		label={t.numberedList}
		pressed={isNodeActive(editorState, orderedList)}
		{disabled}
		onclick={() => run(toggleList(editorSchema, orderedList))}
		><ListOrdered size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton
		label={t.blockquote}
		pressed={isNodeActive(editorState, blockquote)}
		{disabled}
		onclick={() => run(toggleBlockquote(editorSchema))}><Quote size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton label={t.link} disabled={linkDisabled} onclick={editLink}
		><Link size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton label={t.insertImage} disabled={imageDisabled} onclick={editImage}
		><ImagePlus size={16} /></ToolbarIconButton
	>
	<span class="separator"></span>
	<ToolbarIconButton
		label={t.horizontalRule}
		{disabled}
		onclick={() => run(insertHorizontalRule(editorSchema))}><Minus size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton
		label={t.hardBreak}
		disabled={hardBreakDisabled}
		onclick={() => run(insertHardBreak(editorSchema))}
		><CornerDownLeft size={16} /></ToolbarIconButton
	>
	<ToolbarIconButton label={t.insertTable} {disabled} onclick={() => run(insertTable(editorSchema))}
		><Table2 size={16} /></ToolbarIconButton
	>
</Toolbar.Root>

<style>
	:global(.toolbar) {
		display: flex;
		min-height: 42px;
		align-items: center;
		gap: 2px;
		overflow-x: auto;
		border-bottom: 1px solid var(--gray-6);
		background: color-mix(in srgb, var(--gray-1) 92%, transparent);
		padding: 5px 8px;
		scrollbar-width: none;
	}

	:global(.toolbar::-webkit-scrollbar) {
		display: none;
	}

	.block-control {
		flex: 0 0 auto;
	}

	:global(.block-trigger) {
		display: inline-flex;
		width: 124px;
		height: 30px;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		padding: 0 7px 0 9px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-text);
		font-weight: 550;
		cursor: pointer;
		outline: none;
	}

	:global(.block-trigger:hover:not(:disabled)),
	:global(.block-trigger[data-state='open']) {
		background-color: var(--gray-4);
	}

	:global(.block-trigger:focus-visible) {
		outline: 2px solid var(--accent-8);
		outline-offset: 1px;
	}

	:global(.block-trigger:disabled) {
		cursor: default;
		opacity: 0.45;
	}

	:global(.block-trigger-icon) {
		flex: 0 0 auto;
		color: var(--gray-9);
		transition: transform 120ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	:global(.block-trigger[data-state='open'] .block-trigger-icon) {
		transform: rotate(180deg);
	}

	:global(.block-select-content) {
		z-index: 90;
		width: max(var(--bits-select-anchor-width), 156px);
		max-height: min(300px, var(--bits-select-content-available-height));
		overflow: hidden;
		border: 1px solid var(--gray-7);
		border-radius: 7px;
		background: var(--gray-1);
		box-shadow: var(--ui-shadow-popup);
		padding: 4px;
	}

	:global(.block-select-viewport) {
		max-height: min(292px, var(--bits-select-content-available-height));
		overflow-y: auto;
	}

	:global(.block-select-item) {
		display: flex;
		height: 30px;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-radius: 4px;
		padding: 0 8px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-text);
		line-height: 1;
		cursor: default;
		outline: none;
		user-select: none;
	}

	:global(.block-select-item[data-highlighted]) {
		background: var(--gray-4);
	}

	:global(.block-select-item[data-selected]) {
		color: var(--accent-11);
		font-weight: 600;
	}

	:global(.block-select-check) {
		flex: 0 0 auto;
		opacity: 0;
	}

	:global(.block-select-item[data-selected] .block-select-check) {
		opacity: 1;
	}

	.separator {
		width: 1px;
		height: 18px;
		flex: 0 0 1px;
		margin: 0 4px;
		background: var(--gray-6);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.block-trigger-icon) {
			transition-duration: 0.01ms;
		}
	}
</style>
