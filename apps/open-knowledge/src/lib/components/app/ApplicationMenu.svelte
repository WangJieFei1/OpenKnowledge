<script lang="ts">
	import { Menubar } from 'bits-ui'
	import { Check } from 'lucide-svelte'
	import {
		applicationCommandGroups,
		displayShortcut,
		type ApplicationCommand,
		type ApplicationCommandGroup
	} from './application-command'
	import { applicationCommandIcon } from './application-command-icon'
	import { applicationCommandGroupLabels } from './application-command.translation'

	type Props = {
		commands: ApplicationCommand[]
	}

	let { commands }: Props = $props()
	const groups: ApplicationCommandGroup[] = applicationCommandGroups.filter(
		(group) => group !== 'Open'
	)

	function menuCommands(group: ApplicationCommandGroup): ApplicationCommand[] {
		return commands.filter((command) => command.group === group && !command.paletteOnly)
	}
</script>

<Menubar.Root class="application-menu" loop>
	{#each groups as group (group)}
		<Menubar.Menu value={group.toLowerCase()}>
			<Menubar.Trigger class="application-menu-trigger"
				>{applicationCommandGroupLabels[group]}</Menubar.Trigger
			>
			<Menubar.Portal>
				<Menubar.Content
					class="ui-menu-content application-menu-content"
					align="start"
					sideOffset={2}
				>
					{#each menuCommands(group) as command (command.id)}
						{@const Icon = applicationCommandIcon(command)}
						{#if command.separatorBefore}<Menubar.Separator class="ui-menu-separator" />{/if}
						<Menubar.Item
							class="ui-menu-item application-menu-item"
							disabled={command.disabled}
							textValue={command.label}
							onSelect={() => void command.run()}
						>
							<span class="check-slot" class:checked={command.checked}>
								{#if command.checked}<Check size={14} />{:else}<Icon size={14} />{/if}
							</span>
							<span class="menu-label">{command.label}</span>
							{#if command.shortcut}<span class="menu-shortcut"
									>{displayShortcut(command.shortcut)}</span
								>{/if}
						</Menubar.Item>
					{/each}
				</Menubar.Content>
			</Menubar.Portal>
		</Menubar.Menu>
	{/each}
</Menubar.Root>

<style>
	:global(.application-menu) {
		display: flex;
		height: 100%;
		align-items: center;
		gap: 1px;
		outline: none;
	}

	:global(.application-menu-trigger) {
		height: 24px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		padding: 0 6px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		font-weight: 520;
		cursor: default;
		outline: none;
	}

	:global(.application-menu-trigger:hover),
	:global(.application-menu-trigger[data-state='open']) {
		background: var(--gray-5);
		color: var(--gray-12);
	}

	:global(.application-menu-content) {
		width: min(360px, calc(100vw - 16px));
	}

	:global(.application-menu-item) {
		display: grid;
		min-height: 32px;
		height: auto;
		grid-template-columns: 18px minmax(0, 1fr) auto;
		padding: 5px 8px 5px 6px;
	}

	.check-slot {
		display: grid;
		width: 16px;
		place-items: center;
		color: var(--gray-10);
	}

	.check-slot.checked {
		color: var(--accent-11);
	}

	.menu-label {
		overflow: hidden;
		font-weight: 500;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.menu-shortcut {
		margin-left: auto;
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
		white-space: nowrap;
	}
</style>
