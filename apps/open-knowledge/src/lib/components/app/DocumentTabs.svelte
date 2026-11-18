<script lang="ts">
	import type {
		WorkspaceSession,
		WorkspaceDocumentTab
	} from '#lib/workspace/workspace-session.svelte.js'
	import { DocumentTabInteraction } from '#lib/workspace/document-tab-interaction.svelte.js'
	import { ContextMenu, Tabs } from 'bits-ui'
	import {
		AppWindow,
		CircleAlert,
		CopyX,
		FileText,
		LoaderCircle,
		PanelRightClose,
		X
	} from 'lucide-svelte'
	import { onDestroy, untrack } from 'svelte'
	import { documentTabsTranslation as t } from './DocumentTabs.translation'

	type Props = {
		session: WorkspaceSession
	}

	let { session }: Props = $props()
	const interaction = new DocumentTabInteraction(untrack(() => session))

	onDestroy(() => {
		interaction.dispose()
	})

	function label(tab: WorkspaceDocumentTab): string {
		return (tab.document?.name ?? tab.requestedPath.split('/').at(-1) ?? t.document).replace(
			/\.md$/i,
			''
		)
	}

	function close(event: MouseEvent, tab: WorkspaceDocumentTab): void {
		event.preventDefault()
		event.stopPropagation()
		void session.closeTab(tab.id)
	}

	function auxiliaryClick(event: MouseEvent, tab: WorkspaceDocumentTab): void {
		if (event.button === 1) {
			close(event, tab)
		}
	}
</script>

<svelte:window onkeydown={(event) => interaction.cancelDrag(event)} />

{#if session.tabs.length > 0}
	<Tabs.Root
		class="document-tabs"
		value={session.activeTabID ?? ''}
		onValueChange={(tabID) => session.selectTab(tabID)}
		activationMode="manual"
	>
		<Tabs.List
			class="tab-list"
			aria-label={t.openDocuments}
			ondragover={(event) => interaction.dragOverList(event)}
			ondrop={(event) => interaction.dropOnList(event)}
		>
			{#each session.tabs as tab (tab.id)}
				<ContextMenu.Root>
					<ContextMenu.Trigger>
						{#snippet child({ props })}
							<Tabs.Trigger
								{...props}
								class="document-tab"
								value={tab.id}
								title={tab.path}
								draggable={!tab.loading && interaction.openingDedicatedTabID !== tab.id}
								data-dragging={interaction.draggingTabID === tab.id ? '' : undefined}
								onauxclick={(event) => auxiliaryClick(event, tab)}
								ondblclick={(event) => interaction.doubleClick(event, tab)}
								ondragstart={(event) => interaction.dragStart(event, tab)}
								ondragover={(event) => interaction.dragOver(event, tab)}
								ondrop={(event) => interaction.dropOnTab(event, tab)}
								ondragend={(event) => interaction.dragEnd(event, tab)}
							>
								{#if tab.loading || interaction.openingDedicatedTabID === tab.id}
									<LoaderCircle class="spin" size={13} />
								{:else}
									<FileText size={13} />
								{/if}
								<span class="tab-label">{label(tab)}</span>
								{#if tab.saveState === 'conflict' || tab.saveState === 'error'}
									<CircleAlert class="tab-error" size={12} />
								{:else if tab.saveState !== 'saved'}
									<span class="dirty-dot" aria-label={t.unsaved}></span>
								{/if}
								<span
									class="tab-close"
									data-close
									draggable="false"
									aria-hidden="true"
									onclick={(event) => close(event, tab)}
								>
									<X size={12} />
								</span>
							</Tabs.Trigger>
						{/snippet}
					</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content
							class="ui-menu-content tab-context-menu"
							aria-label={t.actionsFor(label(tab))}
							collisionPadding={8}
							loop
						>
							<ContextMenu.Item
								class="ui-menu-item"
								disabled={tab.loading || interaction.openingDedicatedTabID !== null}
								textValue={t.openDedicated}
								onSelect={() => void interaction.openDedicated(tab)}
							>
								<AppWindow size={14} />
								{t.openDedicated}
							</ContextMenu.Item>
							<ContextMenu.Separator class="ui-menu-separator" />
							<ContextMenu.Item
								class="ui-menu-item"
								disabled={interaction.openingDedicatedTabID === tab.id}
								textValue={t.close}
								onSelect={() => void session.closeTab(tab.id)}
							>
								<X size={14} />
								{t.close}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="ui-menu-item"
								disabled={session.tabs.length < 2 || interaction.openingDedicatedTabID !== null}
								textValue={t.closeOtherTabs}
								onSelect={() => void session.closeOtherTabs(tab.id)}
							>
								<CopyX size={14} />
								{t.closeOtherTabs}
							</ContextMenu.Item>
							<ContextMenu.Item
								class="ui-menu-item"
								disabled={session.tabs.at(-1)?.id === tab.id ||
									interaction.openingDedicatedTabID !== null}
								textValue={t.closeTabsRight}
								onSelect={() => void session.closeTabsToRight(tab.id)}
							>
								<PanelRightClose size={14} />
								{t.closeTabsRight}
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			{/each}
		</Tabs.List>
	</Tabs.Root>
{/if}

<style>
	:global(.document-tabs) {
		display: block;
		min-width: 0;
		border-bottom: 1px solid var(--gray-6);
		background: var(--gray-2);
	}

	:global(.tab-list) {
		display: flex;
		height: 32px;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	:global(.tab-list::-webkit-scrollbar) {
		display: none;
	}

	:global(.document-tab) {
		display: flex;
		width: 176px;
		height: 32px;
		min-width: 96px;
		max-width: 210px;
		flex: 0 1 176px;
		align-items: center;
		gap: 6px;
		border: 0;
		border-right: 1px solid var(--gray-6);
		border-radius: 0;
		background: var(--gray-3);
		padding: 0 7px 0 9px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		text-align: left;
		cursor: grab;
		user-select: none;
	}

	:global(.document-tab[data-dragging]) {
		opacity: 0.55;
		cursor: grabbing;
	}

	:global(.document-tab[data-state='active']) {
		position: relative;
		background: var(--gray-1);
		color: var(--gray-12);
	}

	:global(.document-tab[data-state='active']::before) {
		position: absolute;
		top: 0;
		right: 0;
		left: 0;
		height: 2px;
		background: var(--accent-9);
		content: '';
	}

	.tab-label {
		overflow: hidden;
		flex: 1;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dirty-dot {
		width: 7px;
		height: 7px;
		flex: 0 0 7px;
		border-radius: 50%;
		background: var(--amber-9);
	}

	:global(.tab-error) {
		flex: 0 0 auto;
		color: var(--red-11);
	}

	.tab-close {
		display: grid;
		width: 18px;
		height: 18px;
		flex: 0 0 18px;
		place-items: center;
		border-radius: 4px;
		opacity: 0;
	}

	:global(.document-tab:hover) .tab-close,
	:global(.document-tab[data-state='active']) .tab-close {
		opacity: 1;
	}

	.tab-close:hover {
		background: var(--gray-5);
	}

	:global(.tab-context-menu) {
		width: 214px;
	}

	:global(.spin) {
		animation: spin 800ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
