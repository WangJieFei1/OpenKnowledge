<script lang="ts">
	import { Tooltip } from 'bits-ui'
	import type { Snippet } from 'svelte'

	type IconButtonSize = 'small' | 'medium' | 'window'
	type IconButtonVariant = 'default' | 'danger' | 'window-close'
	type TooltipSide = 'top' | 'right' | 'bottom' | 'left'
	type Props = Omit<
		Tooltip.TriggerProps,
		'children' | 'child' | 'class' | 'aria-label' | 'aria-current' | 'aria-pressed' | 'title'
	> & {
		label: string
		tooltip?: string | false
		pressed?: boolean
		current?: boolean
		size?: IconButtonSize
		variant?: IconButtonVariant
		side?: TooltipSide
		class?: string
		children: Snippet
	}

	let {
		label,
		tooltip = label,
		pressed,
		current = false,
		size = 'medium',
		variant = 'default',
		side = 'top',
		class: className,
		type = 'button',
		disabled = false,
		children,
		...restProps
	}: Props = $props()
</script>

<Tooltip.Root disabled={tooltip === false}>
	<Tooltip.Trigger
		{type}
		{disabled}
		class={['ui-icon-button', className]}
		data-size={size}
		data-variant={variant}
		data-current={current ? '' : undefined}
		aria-label={label}
		aria-current={current ? 'page' : undefined}
		aria-pressed={pressed}
		{...restProps}
	>
		{@render children()}
	</Tooltip.Trigger>
	{#if tooltip !== false}
		<Tooltip.Portal>
			<Tooltip.Content class="ui-tooltip" {side} sideOffset={6}>{tooltip}</Tooltip.Content>
		</Tooltip.Portal>
	{/if}
</Tooltip.Root>
