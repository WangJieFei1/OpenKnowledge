<script lang="ts">
	import { Switch, type WithoutChildrenOrChild } from 'bits-ui'

	type Props = WithoutChildrenOrChild<Switch.RootProps> & {
		label: string
	}

	let { label, checked = $bindable(false), ref = $bindable(null), ...restProps }: Props = $props()
</script>

<Switch.Root bind:checked bind:ref class="ui-switch" aria-label={label} {...restProps}>
	<Switch.Thumb class="ui-switch-thumb" />
</Switch.Root>
