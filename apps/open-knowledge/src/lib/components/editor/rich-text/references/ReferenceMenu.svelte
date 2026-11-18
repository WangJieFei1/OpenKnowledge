<script lang="ts" module>
	import { referenceMenuTranslation as t } from './ReferenceMenu.translation'
</script>

<script lang="ts">
	import type { WorkspaceReference } from './references'
	import { File, Folder } from 'lucide-svelte'
	import { tick } from 'svelte'

	type Props = {
		id: string
		references: WorkspaceReference[]
		selected: number
		left: number
		top: number
		onselect: (reference: WorkspaceReference) => void
	}

	let { id, references, selected, left, top, onselect }: Props = $props()
	let popup: HTMLDivElement

	$effect(() => {
		const shouldScroll = references[selected] !== undefined
		void tick().then(() => {
			if (shouldScroll) {
				popup?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
			}
		})
	})
</script>

<div
	{id}
	bind:this={popup}
	class="reference-popup"
	style:left={`${left}px`}
	style:top={`${top}px`}
	role="listbox"
	aria-label={t.menuLabel}
>
	<div class="popup-label" role="presentation">{t.heading}</div>
	{#each references as reference, index (reference.path)}
		<button
			id={`${id}-option-${index}`}
			type="button"
			tabindex="-1"
			class:active={index === selected}
			role="option"
			aria-selected={index === selected}
			aria-label={(reference.kind === 'directory' ? t.folderOption : t.fileOption)(
				reference.label,
				reference.path
			)}
			onmousedown={(event) => {
				event.preventDefault()
			}}
			onclick={() => onselect(reference)}
		>
			{#if reference.kind === 'directory'}
				<Folder size={15} aria-hidden="true" />
			{:else}
				<File size={15} aria-hidden="true" />
			{/if}
			<span><strong>{reference.label}</strong><small>{reference.path}</small></span>
		</button>
	{:else}
		<div class="popup-empty" role="option" aria-selected="false" aria-disabled="true">
			{t.empty}
		</div>
	{/each}
</div>

<style>
	.reference-popup {
		position: fixed;
		z-index: 61;
		display: grid;
		width: 300px;
		max-height: min(340px, calc(100vh - 24px));
		overflow: auto;
		border: 1px solid var(--gray-7);
		border-radius: 7px;
		background: var(--gray-1);
		box-shadow: var(--ui-shadow-popup);
		padding: 4px;
	}

	.popup-label {
		padding: 6px 8px 5px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
		font-weight: 700;
		text-transform: uppercase;
	}

	button {
		display: grid;
		min-height: 40px;
		align-items: center;
		grid-template-columns: 22px minmax(0, 1fr);
		gap: 7px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		padding: 4px 8px;
		color: var(--gray-9);
		text-align: left;
		cursor: pointer;
	}

	button.active,
	button:hover {
		background: var(--gray-4);
		color: var(--accent-10);
	}

	button span {
		display: grid;
		min-width: 0;
		gap: 2px;
	}

	strong,
	small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-text);
		font-weight: 620;
	}

	small,
	.popup-empty {
		color: var(--gray-9);
	}

	small {
		font-size: var(--font-size-ui-caption);
	}

	.popup-empty {
		padding: 14px 10px;
		font-size: var(--font-size-ui-text);
		text-align: center;
	}
</style>
