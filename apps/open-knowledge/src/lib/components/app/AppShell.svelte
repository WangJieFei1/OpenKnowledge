<script lang="ts" module>
	import { workspaceMessages } from '#lib/workspace/workspace-message.translation.js'
	import { appShellTranslation as t } from './AppShell.translation'
</script>

<script lang="ts">
	import { page } from '$app/state'
	import PromptDialog from '#lib/components/ui/PromptDialog.svelte'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import type { WindowEditActionInput } from '#lib/window/api.js'
	import type { WorkspaceSession } from '#lib/workspace/workspace-session.svelte.js'
	import { onMount, type Snippet } from 'svelte'
	import { MediaQuery } from 'svelte/reactivity'
	import CommandPalette from './CommandPalette.svelte'
	import MessageBanner from './MessageBanner.svelte'
	import { createWorkspaceCommands } from './commands'
	import { requestWorkspaceWindowClose } from './commands/request-workspace-window-close'
	import { resolveWorkspaceShortcut } from './commands/workspace-shortcuts'
	import { WorkspaceLayout, WorkspaceTitleBar } from './shell'

	type Props = {
		session: WorkspaceSession
		editorWindow?: boolean
		children: Snippet
	}

	let { session, editorWindow = false, children }: Props = $props()
	const api = desktopAPI()
	let paletteOpen = $state(false)
	let createKind = $state<'file' | 'directory' | null>(null)
	let settingsOpenFailed = $state(false)
	const systemPrefersDark = new MediaQuery('(prefers-color-scheme: dark)')

	const workspaceID = $derived(session.workspace?.id ?? page.params.workspaceID ?? '')
	const sidebarShown = $derived(!editorWindow && session.settings.sidebarVisible)
	const darkTheme = $derived(
		session.settings.colorMode === 'dark' ||
			(session.settings.colorMode === 'system' && systemPrefersDark.current)
	)
	const defaultParent = $derived(session.document?.parentPath ?? '/')
	const commands = $derived.by(() =>
		createWorkspaceCommands({
			session,
			editorWindow,
			workspaceID,
			sidebarShown,
			darkTheme,
			actions: {
				create(kind) {
					createKind = kind
				},
				closeWindow,
				edit,
				openExternal,
				openPalette() {
					paletteOpen = true
				},
				openSettings
			}
		})
	)
	const message = $derived(
		settingsOpenFailed
			? t.settingsOpenFailed
			: session.message
				? workspaceMessages[session.message]
				: ''
	)

	async function openSettings(): Promise<void> {
		settingsOpenFailed = false
		if (!api) {
			settingsOpenFailed = true
			return
		}
		try {
			await api.window.openApplicationSettings()
		} catch {
			settingsOpenFailed = true
		}
	}

	async function closeWindow(): Promise<void> {
		await requestWorkspaceWindowClose(session, api?.window)
	}

	async function edit(action: WindowEditActionInput['action']): Promise<void> {
		await api?.window.performEditAction({ action })
	}

	function openExternal(url: string): void {
		window.open(url, '_blank', 'noopener,noreferrer')
	}

	function runCommand(id: string): void {
		const command = commands.find((candidate) => candidate.id === id)
		if (command && !command.disabled) {
			void command.run()
		}
	}

	onMount(() => api?.window.onApplicationCommand(runCommand))

	function keydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
			return
		}
		const commandID = resolveWorkspaceShortcut(
			event,
			editorWindow,
			api?.nativeMenuBar ? 'macos' : 'other'
		)
		if (!commandID) {
			return
		}
		event.preventDefault()
		runCommand(commandID)
	}

	function beforeUnload(event: BeforeUnloadEvent): void {
		if (!session.hasUnsavedChanges) {
			return
		}
		event.preventDefault()
		event.returnValue = ''
	}
</script>

<svelte:window
	onkeydown={keydown}
	onfocus={() => void session.refreshRemoteWorkspace()}
	onbeforeunload={beforeUnload}
/>

<div class="app-shell">
	<WorkspaceTitleBar
		{editorWindow}
		{commands}
		oncommand={runCommand}
		onpalette={() => {
			paletteOpen = true
		}}
		onsettings={() => void openSettings()}
		onclose={() => void closeWindow()}
	/>
	<WorkspaceLayout {editorWindow}>{@render children()}</WorkspaceLayout>
</div>

<CommandPalette bind:open={paletteOpen} {commands} />

{#if createKind}
	<PromptDialog
		title={createKind === 'file' ? t.newDocumentTitle : t.newFolderTitle}
		description={defaultParent ? t.inside(defaultParent) : t.workspaceRoot}
		confirmLabel={t.create}
		initialValue={createKind === 'file' ? t.untitledDocument : t.untitledFolder}
		oncancel={() => {
			createKind = null
		}}
		onconfirm={(value) =>
			session.createEntry(createKind ?? 'file', defaultParent, value).then(Boolean)}
	/>
{/if}

{#if settingsOpenFailed || session.message}
	<MessageBanner
		{message}
		ondismiss={() => {
			if (settingsOpenFailed) {
				settingsOpenFailed = false
			} else {
				session.dismissMessage()
			}
		}}
	/>
{/if}

<style>
	.app-shell {
		display: grid;
		width: 100%;
		height: 100%;
		grid-template-rows: var(--window-titlebar-height) minmax(0, 1fr);
		overflow: hidden;
	}
</style>
