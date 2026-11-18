<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte'
	import type { WorkspaceSelectorConnectInput } from '#lib/workspace/selector-api.js'
	import { Dialog } from 'bits-ui'
	import {
		CircleAlert,
		Eye,
		EyeOff,
		Globe2,
		KeyRound,
		Link2,
		LoaderCircle,
		ShieldCheck
	} from 'lucide-svelte'
	import { pageTranslation as t } from './page.translation'

	type Props = {
		oncancel: () => void
		onconnect: (input: WorkspaceSelectorConnectInput) => Promise<boolean>
	}

	let { oncancel, onconnect }: Props = $props()

	let open = $state(true)
	let uri = $state('')
	let authorization = $state('')
	let showAuthorization = $state(false)
	let connecting = $state(false)
	let connectionFailed = $state(false)
	let uriInput = $state.raw<HTMLInputElement>()

	function changeOpen(nextOpen: boolean): void {
		open = nextOpen
		if (!nextOpen && !connecting) {
			oncancel()
		}
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault()
		if (connecting || !uri.trim()) {
			return
		}

		connecting = true
		connectionFailed = false
		try {
			const credential = authorization.trim()
			const connected = await onconnect({
				uri: uri.trim(),
				...(credential ? { authorization: credential } : {})
			})
			if (connected) {
				oncancel()
			} else {
				connectionFailed = true
			}
		} catch {
			connectionFailed = true
		} finally {
			connecting = false
		}
	}
</script>

<Dialog.Root {open} onOpenChange={changeOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="ui-dialog-overlay" />
		<Dialog.Content
			class="ui-dialog-content remote-dialog"
			escapeKeydownBehavior={connecting ? 'ignore' : 'close'}
			interactOutsideBehavior={connecting ? 'ignore' : 'close'}
			onOpenAutoFocus={(event) => {
				event.preventDefault()
				uriInput?.focus()
			}}
		>
			<form onsubmit={submit}>
				<div class="dialog-heading">
					<span class="remote-mark"><Globe2 size={21} /></span>
					<div>
						<span class="eyebrow">{t.remoteEndpoint}</span>
						<Dialog.Title class="dialog-title" level={2}>{t.remoteHeading}</Dialog.Title>
						<Dialog.Description class="dialog-description">
							{t.remoteDescription}
						</Dialog.Description>
					</div>
				</div>

				<div class="dialog-body">
					<div class="remote-field">
						<label for="remote-bundle-uri"><Link2 size={14} /> {t.remoteURI}</label>
						<div class="input-shell">
							<span class="input-icon"><Globe2 size={15} /></span>
							<input
								bind:this={uriInput}
								bind:value={uri}
								id="remote-bundle-uri"
								disabled={connecting}
								placeholder={t.remotePlaceholder}
								aria-describedby="remote-bundle-uri-hint"
								required
								maxlength="8192"
								spellcheck="false"
								autocapitalize="none"
							/>
						</div>
						<p id="remote-bundle-uri-hint">{t.remoteURIHint}</p>
					</div>

					<div class="remote-field">
						<label for="remote-bundle-authorization">
							<KeyRound size={14} />
							{t.remoteAuthorization}
						</label>
						<div class="input-shell credential-shell">
							<span class="input-icon"><KeyRound size={15} /></span>
							<input
								id="remote-bundle-authorization"
								type={showAuthorization ? 'text' : 'password'}
								bind:value={authorization}
								disabled={connecting}
								placeholder={t.remoteAuthorizationPlaceholder}
								aria-describedby="remote-bundle-authorization-hint"
								maxlength="8192"
								autocomplete="off"
								spellcheck="false"
								autocapitalize="none"
							/>
							<button
								class="credential-toggle"
								type="button"
								disabled={connecting}
								aria-label={showAuthorization ? t.hideAuthorization : t.showAuthorization}
								title={showAuthorization ? t.hideAuthorization : t.showAuthorization}
								onclick={() => (showAuthorization = !showAuthorization)}
							>
								{#if showAuthorization}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
							</button>
						</div>
						<p id="remote-bundle-authorization-hint">{t.remoteAuthorizationHint}</p>
					</div>

					<div class="security-note">
						<ShieldCheck size={17} />
						<span>{t.remoteSecurity}</span>
					</div>

					{#if connectionFailed}
						<div class="connection-error" role="alert">
							<CircleAlert size={16} />
							<span>{t.remoteConnectionFailed}</span>
						</div>
					{/if}

					<div class="dialog-actions">
						<Dialog.Close
							class="ui-button"
							data-variant="secondary"
							type="button"
							disabled={connecting}
						>
							{t.cancel}
						</Dialog.Close>
						<Button type="submit" variant="primary" disabled={connecting || !uri.trim()}>
							{#if connecting}
								<LoaderCircle class="spin" size={15} />
							{:else}
								<Link2 size={15} />
							{/if}
							{connecting ? t.connecting : t.connect}
						</Button>
					</div>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.remote-dialog) {
		width: min(calc(100vw - 32px), 520px);
		max-height: calc(100vh - 16px);
		overflow-x: hidden;
		overflow-y: auto;
		padding: 0;
	}

	.dialog-heading {
		display: grid;
		align-items: start;
		grid-template-columns: 42px minmax(0, 1fr);
		gap: 13px;
		border-bottom: 1px solid var(--gray-6);
		background: linear-gradient(125deg, var(--accent-3), transparent 62%), var(--gray-1);
		padding: 16px 20px 14px;
	}

	.remote-mark {
		display: grid;
		width: 42px;
		height: 42px;
		place-items: center;
		border: 1px solid var(--accent-6);
		border-radius: 9px;
		background: var(--accent-3);
		color: var(--accent-11);
	}

	.eyebrow {
		color: var(--accent-11);
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-caption);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	:global(.dialog-title) {
		margin: 2px 0 0;
		color: var(--gray-12);
		font-size: 17px;
		font-weight: 680;
		letter-spacing: -0.01em;
	}

	:global(.dialog-description) {
		margin: 4px 0 0;
		color: var(--gray-10);
		font-size: var(--font-size-ui-text);
		line-height: 1.45;
	}

	.dialog-body {
		padding: 16px 20px 17px;
	}

	.remote-field + .remote-field {
		margin-top: 14px;
	}

	.remote-field label {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 6px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-text);
		font-weight: 650;
	}

	.remote-field label :global(svg) {
		color: var(--gray-10);
	}

	.input-shell {
		display: grid;
		height: 38px;
		align-items: center;
		grid-template-columns: 34px minmax(0, 1fr);
		border: 1px solid var(--gray-7);
		border-radius: 6px;
		background: var(--gray-2);
		color: var(--gray-9);
	}

	.input-shell:has(input:focus) {
		border-color: var(--accent-8);
		box-shadow: 0 0 0 2px var(--accent-4);
		color: var(--accent-11);
	}

	.credential-shell {
		grid-template-columns: 34px minmax(0, 1fr) 34px;
	}

	.input-icon {
		display: grid;
		place-items: center;
	}

	.input-shell input {
		width: 100%;
		height: 100%;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0 8px 0 0;
		color: var(--gray-12);
		font: 500 var(--font-size-ui-text) var(--font-mono);
		outline: none;
	}

	.input-shell input::placeholder {
		color: var(--gray-8);
	}

	.input-shell input:focus-visible {
		box-shadow: none;
		outline: none;
		outline-offset: 0;
	}

	.credential-toggle {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--gray-10);
		cursor: pointer;
	}

	.credential-toggle:hover:not(:disabled) {
		background: var(--gray-4);
		color: var(--gray-12);
	}

	.credential-toggle:disabled,
	.input-shell:has(input:disabled) {
		cursor: default;
		opacity: 0.55;
	}

	.remote-field p {
		margin: 5px 1px 0;
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		line-height: 1.4;
	}

	.security-note,
	.connection-error {
		display: grid;
		align-items: start;
		grid-template-columns: 18px minmax(0, 1fr);
		gap: 7px;
		border-radius: 6px;
		padding: 8px 10px;
		font-size: var(--font-size-ui-text);
		line-height: 1.4;
	}

	.security-note {
		margin-top: 15px;
		border: 1px solid var(--gray-6);
		background: var(--gray-2);
		color: var(--gray-11);
	}

	.security-note :global(svg) {
		color: var(--accent-10);
	}

	.connection-error {
		margin-top: 10px;
		border: 1px solid var(--red-6);
		background: var(--red-3);
		color: var(--red-11);
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 16px;
	}

	@media (max-width: 420px) {
		.dialog-heading {
			grid-template-columns: 36px minmax(0, 1fr);
			gap: 10px;
			padding-inline: 16px;
		}

		.remote-mark {
			width: 36px;
			height: 36px;
		}

		.dialog-body {
			padding-inline: 16px;
		}
	}
</style>
