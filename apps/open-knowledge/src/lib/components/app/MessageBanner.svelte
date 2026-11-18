<script lang="ts">
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import { AlertTriangle, X } from 'lucide-svelte'
	import { cubicOut } from 'svelte/easing'
	import { prefersReducedMotion } from 'svelte/motion'
	import { fly } from 'svelte/transition'
	import { messageBannerTranslation as t } from './MessageBanner.translation'

	type Props = {
		message: string
		ondismiss: () => void
	}

	let { message, ondismiss }: Props = $props()
</script>

<div
	class="message"
	role="alert"
	transition:fly={{
		y: prefersReducedMotion.current ? 0 : 8,
		duration: prefersReducedMotion.current ? 0 : 160,
		easing: cubicOut
	}}
>
	<AlertTriangle size={15} />
	<span>{message}</span>
	<IconButton label={t.dismissMessage} size="small" variant="danger" onclick={ondismiss}>
		<X size={14} />
	</IconButton>
</div>

<style>
	.message {
		position: fixed;
		z-index: 110;
		right: 18px;
		bottom: 18px;
		display: grid;
		width: min(420px, calc(100vw - 36px));
		min-height: 42px;
		align-items: center;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 9px;
		border: 1px solid var(--red-7);
		border-radius: 7px;
		background: var(--red-3);
		box-shadow: var(--ui-shadow-popup);
		padding: 8px 8px 8px 12px;
		color: var(--red-11);
		font-size: var(--font-size-ui-text);
		line-height: 1.4;
		pointer-events: auto;
	}
</style>
