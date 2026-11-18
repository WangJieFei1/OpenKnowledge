<script lang="ts" module>
	import { imagePopoverTranslation as t } from './ImagePopover.translation'
</script>

<script lang="ts">
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import { Check, X } from 'lucide-svelte'
	import { onMount } from 'svelte'

	type Props = {
		left: number
		top: number
		initialAlt?: string
		onapply: (src: string, alt: string, title: string | null) => void
		onclose: () => void
	}

	let { left, top, initialAlt = '', onapply, onclose }: Props = $props()

	let src = $state('https://')
	let alt = $state('')
	let title = $state('')
	let input: HTMLInputElement

	onMount(() => {
		alt = initialAlt
		input.select()
	})

	function submit(event: SubmitEvent): void {
		event.preventDefault()
		if (src.trim()) {
			onapply(src.trim(), alt.trim(), title.trim() || null)
		}
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault()
			onclose()
		}
	}
</script>

<svelte:window onpointerdown={onclose} onkeydown={keydown} />
<form
	class="image-popover"
	style:left={`${left}px`}
	style:top={`${top}px`}
	onsubmit={submit}
	onpointerdown={(event) => {
		event.stopPropagation()
	}}
>
	<input
		bind:this={input}
		bind:value={src}
		aria-label={t.imageURL}
		placeholder={t.imageURL}
		spellcheck="false"
	/>
	<input bind:value={alt} aria-label={t.alternativeText} placeholder={t.alternativeText} />
	<input bind:value={title} aria-label={t.optionalTitle} placeholder={t.optionalTitle} />
	<div class="actions">
		<IconButton label={t.insertImage} size="small" type="submit"><Check size={15} /></IconButton>
		<IconButton label={t.cancel} size="small" onclick={onclose}><X size={15} /></IconButton>
	</div>
</form>

<style>
	.image-popover {
		position: fixed;
		z-index: 62;
		display: grid;
		width: min(360px, calc(100vw - 16px));
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px;
		border: 1px solid var(--gray-7);
		border-radius: 7px;
		background: var(--gray-1);
		box-shadow: var(--ui-shadow-popup);
		padding: 5px;
	}

	input {
		height: 32px;
		min-width: 0;
		grid-column: 1;
		border: 0;
		border-radius: 4px;
		background: transparent;
		padding: 0 8px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-text);
		outline: none;
	}

	input:first-child {
		font-family: var(--font-mono);
	}

	input:focus {
		background: var(--gray-3);
		box-shadow: inset 0 0 0 1px var(--accent-7);
	}

	.actions {
		display: flex;
		grid-column: 2;
		grid-row: 1 / 4;
		align-items: center;
		gap: 3px;
		padding: 0 1px;
	}
</style>
