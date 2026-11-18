<script lang="ts" module>
	import { selectionToolbarTranslation as t } from './SelectionToolbar.translation'
</script>

<script lang="ts">
	import ToolbarIconButton from '#lib/components/ui/ToolbarIconButton.svelte'
	import {
		autoUpdate,
		computePosition,
		flip,
		hide,
		inline,
		offset,
		shift,
		type Boundary,
		type VirtualElement
	} from '@floating-ui/dom'
	import { Toolbar } from 'bits-ui'
	import { Bold, Braces, Italic, Link, Strikethrough } from 'lucide-svelte'
	import type { Command, EditorState } from 'prosemirror-state'
	import { isMarkActive, markCommand } from '../prosemirror/commands'
	import { editorMark } from '../prosemirror/schema'

	type Props = {
		state: EditorState | null
		disabled?: boolean
		reference: VirtualElement
		run: (command: Command) => void
		editLink: () => void
	}

	let { state: editorState, disabled = false, reference, run, editLink }: Props = $props()

	let floating = $state.raw<HTMLDivElement | null>(null)
	let x = $state(0)
	let y = $state(0)
	let side = $state<'above' | 'below'>('above')
	let visible = $state(false)
	const strong = editorMark('strong')
	const emphasis = editorMark('em')
	const strike = editorMark('strike')
	const code = editorMark('code')

	$effect(() => {
		const referenceElement = reference
		const floatingElement = floating
		if (!floatingElement) {
			return
		}

		let active = true
		const boundary: Boundary =
			referenceElement.contextElement?.closest('.editor-scroll') ?? 'clippingAncestors'
		const update = (): void => {
			void computePosition(referenceElement, floatingElement, {
				strategy: 'fixed',
				placement: 'top',
				middleware: [
					inline(),
					offset(8),
					flip({ boundary, padding: 8 }),
					shift({ boundary, padding: 8 }),
					hide({ boundary, padding: 8 })
				]
			}).then((position) => {
				if (!active) {
					return
				}
				x = position.x
				y = position.y
				side = position.placement.startsWith('top') ? 'above' : 'below'
				visible = !position.middlewareData.hide?.referenceHidden
			})
		}

		visible = false
		const cleanup = autoUpdate(referenceElement, floatingElement, update)
		return () => {
			active = false
			cleanup()
		}
	})
</script>

<div
	bind:this={floating}
	class={['selection-float', side, { hidden: !visible }]}
	style:transform={`translate(${x}px, ${y}px)`}
>
	<Toolbar.Root
		class="selection-toolbar"
		aria-label={t.formatting}
		loop
		onmousedown={(event) => event.preventDefault()}
	>
		<ToolbarIconButton
			label={t.bold}
			pressed={isMarkActive(editorState, strong)}
			{disabled}
			onclick={() => run(markCommand(strong))}><Bold size={15} /></ToolbarIconButton
		>
		<ToolbarIconButton
			label={t.italic}
			pressed={isMarkActive(editorState, emphasis)}
			{disabled}
			onclick={() => run(markCommand(emphasis))}><Italic size={15} /></ToolbarIconButton
		>
		<ToolbarIconButton
			label={t.strikethrough}
			pressed={isMarkActive(editorState, strike)}
			{disabled}
			onclick={() => run(markCommand(strike))}><Strikethrough size={15} /></ToolbarIconButton
		>
		<ToolbarIconButton
			label={t.inlineCode}
			pressed={isMarkActive(editorState, code)}
			{disabled}
			onclick={() => run(markCommand(code))}><Braces size={15} /></ToolbarIconButton
		>
		<span class="selection-separator"></span>
		<ToolbarIconButton label={t.link} {disabled} onclick={editLink}
			><Link size={15} /></ToolbarIconButton
		>
	</Toolbar.Root>
</div>

<style>
	.selection-float {
		position: fixed;
		z-index: 70;
		top: 0;
		left: 0;
		width: max-content;
		border: 1px solid var(--gray-7);
		border-radius: 7px;
		background: var(--gray-1);
		box-shadow: var(--ui-shadow-popup);
		padding: 3px;
	}

	.selection-float.hidden {
		visibility: hidden;
		pointer-events: none;
	}

	:global(.selection-toolbar) {
		display: flex;
		align-items: center;
		gap: 1px;
		outline: none;
	}

	:global(.selection-toolbar .ui-icon-button) {
		width: 28px;
		height: 28px;
		flex-basis: 28px;
	}

	.selection-separator {
		width: 1px;
		height: 18px;
		margin: 0 2px;
		background: var(--gray-6);
	}
</style>
