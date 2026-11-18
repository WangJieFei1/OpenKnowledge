<script lang="ts" module>
	import { slashCommandTranslation as t } from './slash-commands.translation'
</script>

<script lang="ts">
	import type { SlashCommandID } from './slash-commands'
	import {
		Braces,
		CornerDownLeft,
		Heading1,
		Heading2,
		Heading3,
		Heading4,
		Heading5,
		Heading6,
		ImagePlus,
		List,
		ListOrdered,
		Minus,
		Pilcrow,
		Quote,
		Table2
	} from 'lucide-svelte'

	type Props = {
		id: string
		commands: SlashCommandID[]
		selected: number
		left: number
		top: number
		onselect: (command: SlashCommandID) => void
	}

	let { id, commands, selected, left, top, onselect }: Props = $props()
</script>

<div
	{id}
	class="editor-popup"
	style:left={`${left}px`}
	style:top={`${top}px`}
	role="listbox"
	aria-label={t.menuLabel}
>
	<div class="popup-label">{t.heading}</div>
	{#each commands as command, index (command)}
		<button
			id={`${id}-option-${index}`}
			type="button"
			tabindex="-1"
			class:active={index === selected}
			role="option"
			aria-selected={index === selected}
			onmousedown={(event) => {
				event.preventDefault()
			}}
			onclick={() => onselect(command)}
		>
			<span class="popup-icon">
				{#if command === 'text'}<Pilcrow size={16} />
				{:else if command === 'heading-1'}<Heading1 size={16} />
				{:else if command === 'heading-2'}<Heading2 size={16} />
				{:else if command === 'heading-3'}<Heading3 size={16} />
				{:else if command === 'heading-4'}<Heading4 size={16} />
				{:else if command === 'heading-5'}<Heading5 size={16} />
				{:else if command === 'heading-6'}<Heading6 size={16} />
				{:else if command === 'bullet-list'}<List size={16} />
				{:else if command === 'ordered-list'}<ListOrdered size={16} />
				{:else if command === 'blockquote'}<Quote size={16} />
				{:else if command === 'code-block'}<Braces size={16} />
				{:else if command === 'horizontal-rule'}<Minus size={16} />
				{:else if command === 'table'}<Table2 size={16} />
				{:else if command === 'image'}<ImagePlus size={16} />
				{:else}<CornerDownLeft size={16} />
				{/if}
			</span>
			<span><strong>{t.label(command)}</strong><small>{t.description(command)}</small></span>
		</button>
	{:else}
		<div class="popup-empty">{t.empty}</div>
	{/each}
</div>

<style>
	.editor-popup {
		position: fixed;
		z-index: 60;
		display: grid;
		width: 248px;
		max-height: min(360px, calc(100vh - 24px));
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
		min-height: 43px;
		align-items: center;
		grid-template-columns: 30px minmax(0, 1fr);
		gap: 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		padding: 4px 7px;
		text-align: left;
		cursor: pointer;
	}

	button.active,
	button:hover {
		background: var(--gray-4);
	}

	.popup-icon {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border: 1px solid var(--gray-6);
		border-radius: 5px;
		background: var(--gray-2);
		color: var(--gray-11);
	}

	button > span:last-child {
		display: grid;
		min-width: 0;
		gap: 2px;
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
