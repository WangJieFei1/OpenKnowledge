<script lang="ts">
	import { sidebarResizerTranslation as t } from './SidebarResizer.translation'

	type Props = {
		width: number
		onresize: (width: number) => void
		oncommit: (width: number) => void
	}

	let { width, onresize, oncommit }: Props = $props()

	let startX = 0
	let startWidth = 0

	function pointerdown(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) {
			return
		}
		startX = event.clientX
		startWidth = width
		event.currentTarget.setPointerCapture(event.pointerId)
	}

	function pointermove(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) {
			return
		}
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
			return
		}
		onresize(clampWidth(startWidth + event.clientX - startX))
	}

	function pointerup(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) {
			return
		}
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId)
		}
		oncommit(width)
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
			return
		}
		event.preventDefault()
		const direction = event.key === 'ArrowLeft' ? -1 : 1
		const nextWidth = clampWidth(width + direction * (event.shiftKey ? 32 : 8))
		onresize(nextWidth)
		oncommit(nextWidth)
	}

	function clampWidth(value: number): number {
		return Math.min(480, Math.max(220, Math.round(value)))
	}
</script>

<button
	type="button"
	class="sidebar-resizer"
	aria-label={t.resizeSidebar(width)}
	title={t.resizeInstructions}
	onpointerdown={pointerdown}
	onpointermove={pointermove}
	onpointerup={pointerup}
	onkeydown={keydown}
></button>

<style>
	.sidebar-resizer {
		position: relative;
		z-index: 4;
		width: 7px;
		margin-left: -3px;
		cursor: col-resize;
		border: 0;
		background: transparent;
		padding: 0;
		touch-action: none;
	}

	.sidebar-resizer::after {
		position: absolute;
		inset: 0 3px;
		background: transparent;
		content: '';
	}

	.sidebar-resizer:hover::after,
	.sidebar-resizer:focus-visible::after {
		background: var(--accent-8);
	}
</style>
