<script lang="ts">
	import { Dialog } from 'bits-ui'
	import { untrack } from 'svelte'
	import Button from './Button.svelte'
	import { promptDialogTranslation as t } from './PromptDialog.translation'

	type Props = {
		title: string
		description?: string
		confirmLabel: string
		initialValue?: string
		oncancel: () => void
		onconfirm: (value: string) => Promise<boolean>
	}

	let { title, description, confirmLabel, initialValue = '', oncancel, onconfirm }: Props = $props()

	let open = $state(true)
	let value = $state(untrack(() => initialValue))
	let submitting = $state(false)
	let input = $state.raw<HTMLInputElement>()

	function changeOpen(nextOpen: boolean): void {
		open = nextOpen
		if (!nextOpen && !submitting) {
			oncancel()
		}
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault()
		if (!value.trim()) {
			return
		}
		submitting = true
		try {
			if (await onconfirm(value.trim())) {
				oncancel()
			}
		} finally {
			submitting = false
		}
	}
</script>

<Dialog.Root {open} onOpenChange={changeOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="ui-dialog-overlay" />
		<Dialog.Content
			class="ui-dialog-content"
			escapeKeydownBehavior={submitting ? 'ignore' : 'close'}
			interactOutsideBehavior={submitting ? 'ignore' : 'close'}
			onOpenAutoFocus={(event) => {
				event.preventDefault()
				input?.select()
			}}
		>
			<form onsubmit={submit}>
				<Dialog.Title class="ui-dialog-title" level={2}>{title}</Dialog.Title>
				<Dialog.Description
					class={['ui-dialog-description', { 'ui-visually-hidden': !description }]}
				>
					{description ?? t.defaultDescription}
				</Dialog.Description>
				<input
					bind:this={input}
					bind:value
					class="ui-dialog-input"
					disabled={submitting}
					aria-label={title}
					autocomplete="off"
				/>
				<div class="ui-dialog-actions">
					<Dialog.Close
						class="ui-button"
						data-variant="secondary"
						type="button"
						disabled={submitting}
					>
						{t.cancel}
					</Dialog.Close>
					<Button type="submit" variant="primary" disabled={submitting || !value.trim()}>
						{confirmLabel}
					</Button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
