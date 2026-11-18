<script lang="ts">
	import { AlertDialog } from 'bits-ui'
	import { confirmDialogTranslation as t } from './ConfirmDialog.translation'

	type Props = {
		title: string
		description: string
		confirmLabel: string
		oncancel: () => void
		onconfirm: () => Promise<boolean>
	}

	let { title, description, confirmLabel, oncancel, onconfirm }: Props = $props()

	let open = $state(true)
	let submitting = $state(false)
	let cancelButton = $state.raw<HTMLButtonElement | null>(null)

	function changeOpen(nextOpen: boolean): void {
		open = nextOpen
		if (!nextOpen && !submitting) {
			oncancel()
		}
	}

	async function confirm(event: MouseEvent): Promise<void> {
		event.preventDefault()
		submitting = true
		try {
			if (await onconfirm()) {
				oncancel()
			}
		} finally {
			submitting = false
		}
	}
</script>

<AlertDialog.Root {open} onOpenChange={changeOpen}>
	<AlertDialog.Portal>
		<AlertDialog.Overlay class="ui-dialog-overlay" />
		<AlertDialog.Content
			class="ui-dialog-content"
			escapeKeydownBehavior={submitting ? 'ignore' : 'close'}
			onOpenAutoFocus={(event) => {
				event.preventDefault()
				cancelButton?.focus()
			}}
		>
			<AlertDialog.Title class="ui-dialog-title" level={2}>{title}</AlertDialog.Title>
			<AlertDialog.Description class="ui-dialog-description">
				{description}
			</AlertDialog.Description>
			<div class="ui-dialog-actions">
				<AlertDialog.Cancel
					bind:ref={cancelButton}
					class="ui-button"
					data-variant="secondary"
					type="button"
					disabled={submitting}
				>
					{t.cancel}
				</AlertDialog.Cancel>
				<AlertDialog.Action
					class="ui-button"
					data-variant="danger"
					type="button"
					disabled={submitting}
					onclick={confirm}
				>
					{confirmLabel}
				</AlertDialog.Action>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>
