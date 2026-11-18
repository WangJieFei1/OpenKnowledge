<script lang="ts">
	import { Button } from 'bits-ui'
	import type { Snippet } from 'svelte'
	import type { HTMLButtonAttributes } from 'svelte/elements'

	type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
	type ButtonSize = 'small' | 'medium' | 'large'
	type Props = Omit<HTMLButtonAttributes, 'children' | 'class'> & {
		ref?: HTMLElement | null
		variant?: ButtonVariant
		size?: ButtonSize
		class?: string
		children: Snippet
	}

	let {
		ref = $bindable(null),
		variant = 'secondary',
		size = 'medium',
		class: className,
		type = 'button',
		children,
		...restProps
	}: Props = $props()
</script>

<Button.Root
	bind:ref
	{type}
	class={['ui-button', className]}
	data-variant={variant}
	data-size={size}
	{...restProps}
>
	{@render children()}
</Button.Root>
