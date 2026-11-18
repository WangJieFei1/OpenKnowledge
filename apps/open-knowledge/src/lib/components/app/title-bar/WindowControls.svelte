<script lang="ts">
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import { WindowStateSession } from '#lib/window/window-state-session.svelte.js'
	import { Copy, Minus, Square, X } from 'lucide-svelte'
	import { onDestroy, onMount } from 'svelte'
	import { windowTitleBarTranslation as t } from '../WindowTitleBar.translation'

	type Props = {
		onclose?: () => void
	}

	let { onclose }: Props = $props()

	const windowState = new WindowStateSession(desktopAPI()?.window ?? null)

	onMount(windowState.start)
	onDestroy(windowState.dispose)
</script>

<span class="window-controls">
	<IconButton label={t.minimize} size="window" onclick={windowState.minimize}>
		<Minus size={15} />
	</IconButton>
	<IconButton
		label={windowState.maximized ? t.restoreWindow : t.maximizeWindow}
		size="window"
		onclick={windowState.toggleMaximize}
	>
		{#if windowState.maximized}<Copy size={13} />{:else}<Square size={13} />{/if}
	</IconButton>
	<IconButton
		label={t.close}
		size="window"
		variant="window-close"
		onclick={onclose ?? windowState.close}
	>
		<X size={16} />
	</IconButton>
</span>

<style>
	.window-controls {
		display: flex;
		height: 100%;
		align-items: center;
	}
</style>
