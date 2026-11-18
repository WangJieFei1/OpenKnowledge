<script lang="ts" module>
	import { linkPopoverTranslation as t } from './LinkPopover.translation'
</script>

<script lang="ts">
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import { Check, X } from 'lucide-svelte'
	import { onMount } from 'svelte'

	type Props = {
		left: number
		top: number
		onapply: (href: string) => void
		onclose: () => void
	}

	let { left, top, onapply, onclose }: Props = $props()

	let href = $state('https://')
	let input: HTMLInputElement

	onMount(() => {
		input.select()
	})

	function submit(event: SubmitEvent): void {
		event.preventDefault()
		if (href.trim()) {
			onapply(href.trim())
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
	class="link-popover"
	style:left={`${left}px`}
	style:top={`${top}px`}
	onsubmit={submit}
	onpointerdown={(event) => {
		event.stopPropagation()
	}}
>
	<input bind:this={input} bind:value={href} aria-label={t.linkURL} spellcheck="false" />
	<IconButton label={t.applyLink} size="small" type="submit"><Check size={15} /></IconButton>
	<IconButton label={t.cancel} size="small" onclick={onclose}><X size={15} /></IconButton>
</form>

<style>
	.link-popover {
		position: fixed;
		z-index: 62;
		display: grid;
		width: 330px;
		height: 40px;
		align-items: center;
		grid-template-columns: minmax(0, 1fr) 30px 30px;
		gap: 3px;
		border: 1px solid var(--gray-7);
		border-radius: 7px;
		background: var(--gray-1);
		box-shadow: var(--ui-shadow-popup);
		padding: 4px;
	}

	input {
		height: 30px;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0 7px;
		color: var(--gray-12);
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-text);
		outline: none;
	}

	input:focus {
		box-shadow: inset 0 0 0 1px var(--accent-7);
	}
</style>
