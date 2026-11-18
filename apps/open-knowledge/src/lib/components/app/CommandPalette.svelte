<script lang="ts">
	import { Command, Dialog } from 'bits-ui'
	import { Check, Moon, Search, Sun } from 'lucide-svelte'
	import { tick } from 'svelte'
	import {
		applicationCommandGroups,
		displayShortcut,
		type ApplicationCommand,
		type ApplicationCommandGroup
	} from './application-command'
	import { applicationCommandIcon } from './application-command-icon'
	import { applicationCommandGroupLabels } from './application-command.translation'
	import { commandPaletteTranslation as t } from './CommandPalette.translation'

	type Props = {
		open?: boolean
		commands: ApplicationCommand[]
	}

	let { open = $bindable(false), commands }: Props = $props()

	let query = $state('')
	let input = $state.raw<HTMLInputElement | null>(null)
	const darkThemeCommand = $derived(commands.find((command) => command.id === 'view.dark-theme'))

	function groupedCommands(group: ApplicationCommandGroup): ApplicationCommand[] {
		return commands.filter((command) => command.group === group)
	}

	function changeOpen(nextOpen: boolean): void {
		open = nextOpen
		if (!nextOpen) {
			query = ''
		}
	}

	async function run(command: ApplicationCommand): Promise<void> {
		if (command.disabled) {
			return
		}
		open = false
		query = ''
		await tick()
		await command.run()
	}

	function toggleTheme(): void {
		if (darkThemeCommand && !darkThemeCommand.disabled) {
			void darkThemeCommand.run()
		}
	}
</script>

<Dialog.Root {open} onOpenChange={changeOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="ui-dialog-overlay command-overlay" />
		<Dialog.Content
			class="ui-dialog-content command-dialog"
			onOpenAutoFocus={(event) => {
				event.preventDefault()
				input?.focus()
			}}
		>
			<Dialog.Title class="ui-visually-hidden">{t.commandPalette}</Dialog.Title>
			<Dialog.Description class="ui-visually-hidden">
				{t.description}
			</Dialog.Description>
			<Command.Root class="command-root" label={t.applicationCommands} loop>
				<div class="command-search">
					<Search size={16} />
					<Command.Input bind:ref={input} bind:value={query} placeholder={t.placeholder} />
					{#if darkThemeCommand}
						<button
							class="theme-toggle"
							type="button"
							aria-label={darkThemeCommand.checked ? t.useLightTheme : t.useDarkTheme}
							aria-pressed={darkThemeCommand.checked ?? false}
							title={darkThemeCommand.checked ? t.useLightTheme : t.useDarkTheme}
							onclick={toggleTheme}
						>
							{#if darkThemeCommand.checked}<Sun size={15} />{:else}<Moon size={15} />{/if}
						</button>
					{/if}
					<span>{t.escape}</span>
				</div>
				<Command.List class="command-list">
					<Command.Empty class="command-empty">{t.noMatches}</Command.Empty>
					{#each applicationCommandGroups as group (group)}
						{#if groupedCommands(group).length > 0}
							<Command.Group value={group}>
								<Command.GroupHeading class="command-heading"
									>{applicationCommandGroupLabels[group]}</Command.GroupHeading
								>
								<Command.GroupItems>
									{#each groupedCommands(group) as command (command.id)}
										{@const Icon = applicationCommandIcon(command)}
										<Command.Item
											class="command-item"
											value={`${command.label} ${command.id}`}
											keywords={command.keywords}
											disabled={command.disabled}
											onSelect={() => void run(command)}
										>
											<span class="command-icon" class:checked={command.checked}>
												{#if command.checked}<Check size={15} />{:else}<Icon size={15} />{/if}
											</span>
											<span>{command.label}</span>
											{#if command.shortcut}
												<kbd>{displayShortcut(command.shortcut)}</kbd>
											{/if}
										</Command.Item>
									{/each}
								</Command.GroupItems>
							</Command.Group>
						{/if}
					{/each}
				</Command.List>
			</Command.Root>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.command-overlay) {
		background: var(--black-a6);
		transition: none;
	}

	:global(.command-dialog) {
		top: 18%;
		width: min(calc(100vw - 40px), 620px);
		transform: translate(-50%, 0);
		border-radius: 9px;
		padding: 0;
		overflow: hidden;
		box-shadow: var(--ui-shadow-dialog);
		transition: none;
	}

	:global(.command-overlay[data-starting-style]),
	:global(.command-overlay[data-ending-style]) {
		opacity: 1;
	}

	:global(.command-dialog[data-starting-style]),
	:global(.command-dialog[data-ending-style]) {
		transform: translate(-50%, 0);
		opacity: 1;
	}

	:global(.command-root) {
		display: grid;
		max-height: min(62vh, 520px);
		grid-template-rows: 58px minmax(0, 1fr);
	}

	.command-search {
		display: grid;
		align-items: center;
		grid-template-columns: 20px minmax(0, 1fr) auto auto;
		gap: 7px;
		margin: 8px;
		border: 1px solid var(--gray-7);
		border-radius: 6px;
		background: var(--gray-1);
		padding: 0 10px;
		color: var(--gray-9);
	}

	.command-search:has(:global(input:focus)) {
		border-color: var(--accent-8);
		box-shadow: 0 0 0 2px var(--accent-4);
		color: var(--accent-11);
	}

	.command-search :global(input) {
		height: 40px;
		border: 0;
		background: transparent;
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
		outline: none;
	}

	.command-search :global(input:focus-visible) {
		box-shadow: none;
		outline: none;
		outline-offset: 0;
	}

	.command-search > span {
		border: 1px solid var(--gray-7);
		border-radius: 4px;
		padding: 2px 5px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
	}

	.theme-toggle {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border: 0;
		border-radius: 5px;
		background: transparent;
		padding: 0;
		color: var(--gray-10);
		cursor: pointer;
	}

	.theme-toggle:hover {
		background: var(--gray-4);
		color: var(--gray-12);
	}

	:global(.command-list) {
		overflow-y: auto;
		padding: 5px;
		outline: none;
	}

	:global(.command-heading) {
		display: block;
		padding: 7px 8px 4px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	:global(.command-item) {
		display: flex;
		height: 36px;
		align-items: center;
		gap: 8px;
		border-radius: 5px;
		padding: 0 9px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-body);
		cursor: default;
		outline: none;
	}

	:global(.command-item[data-selected]) {
		background: var(--accent-4);
		color: var(--accent-12);
	}

	:global(.command-item[data-disabled]) {
		opacity: 0.42;
	}

	.command-icon {
		display: grid;
		width: 15px;
		flex: 0 0 15px;
		place-items: center;
	}

	.command-icon.checked {
		color: var(--accent-11);
	}

	:global(.command-item kbd) {
		margin-left: auto;
		color: var(--gray-9);
		font-family: var(--font-ui);
		font-size: var(--font-size-ui-caption);
	}

	:global(.command-empty) {
		padding: 28px;
		color: var(--gray-10);
		font-size: var(--font-size-ui-text);
		text-align: center;
	}
</style>
