<script lang="ts">
	import { Toolbar, Tooltip } from 'bits-ui'
	import type { Snippet } from 'svelte'

	type TooltipSide = 'top' | 'right' | 'bottom' | 'left'
	type Props = Omit<
		Toolbar.ButtonProps,
		'children' | 'child' | 'class' | 'aria-label' | 'aria-pressed'
	> & {
		label: string
		pressed?: boolean
		side?: TooltipSide
		children: Snippet
	}

	let { label, pressed, side = 'top', disabled = false, children, ...restProps }: Props = $props()
</script>

<Tooltip.Root>
	<Toolbar.Button {disabled} {...restProps}>
		{#snippet child({ props })}
			<Tooltip.Trigger
				{...props}
				class="ui-icon-button"
				data-size="medium"
				data-variant="default"
				aria-label={label}
				aria-pressed={pressed}
			>
				{@render children()}
			</Tooltip.Trigger>
		{/snippet}
	</Toolbar.Button>
	<Tooltip.Portal>
		<Tooltip.Content class="ui-tooltip" {side} sideOffset={6}>{label}</Tooltip.Content>
	</Tooltip.Portal>
</Tooltip.Root>
