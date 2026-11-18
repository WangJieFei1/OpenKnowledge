<script lang="ts">
	import { hasTabTransfer, readTabTransferToken } from '#lib/window/tab-transfer-data.js'
	import { useWorkspaceSession } from '#lib/workspace/session-context.js'
	import type { Snippet } from 'svelte'
	import { appShellTranslation as t } from '../AppShell.translation'
	import DocumentTabs from '../DocumentTabs.svelte'
	import SidebarResizer from '../SidebarResizer.svelte'
	import WorkspaceSidebar from '../WorkspaceSidebar.svelte'

	type Props = {
		editorWindow: boolean
		children: Snippet
	}

	let { editorWindow, children }: Props = $props()
	const session = useWorkspaceSession()
	let liveSidebarWidth = $derived(session.settings.sidebarWidth)
	const sidebarShown = $derived(!editorWindow && session.settings.sidebarVisible)

	function tabTransferDragOver(event: DragEvent): void {
		if (editorWindow || session.draggingTabID || !hasTabTransfer(event.dataTransfer)) {
			return
		}
		event.preventDefault()
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move'
		}
	}

	function tabTransferDrop(event: DragEvent): void {
		if (editorWindow || session.draggingTabID) {
			return
		}
		const token = readTabTransferToken(event.dataTransfer)
		if (!token) {
			return
		}
		event.preventDefault()
		void session.receiveTabTransfer(token)
	}
</script>

<div
	class={['workspace-shell', { 'sidebar-hidden': !sidebarShown }]}
	style:grid-template-columns={sidebarShown
		? `${liveSidebarWidth}px 0 minmax(0, 1fr)`
		: 'minmax(0, 1fr)'}
>
	{#if sidebarShown}
		<WorkspaceSidebar {session} />
		<SidebarResizer
			width={liveSidebarWidth}
			onresize={(width) => {
				liveSidebarWidth = width
			}}
			oncommit={(width) => void session.updateSettings({ sidebarWidth: width })}
		/>
	{/if}
	<div class={['workspace-main', { 'single-document': editorWindow }]}>
		{#if !editorWindow}<DocumentTabs {session} />{/if}
		<div
			class="route-surface"
			role="region"
			aria-label={t.workspaceContent}
			ondragover={tabTransferDragOver}
			ondrop={tabTransferDrop}
		>
			{@render children()}
		</div>
	</div>
</div>

<style>
	.workspace-shell {
		display: grid;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.workspace-main {
		display: grid;
		min-width: 0;
		min-height: 0;
		grid-template-rows: auto minmax(0, 1fr);
		overflow: hidden;
	}

	.workspace-main.single-document {
		grid-template-rows: minmax(0, 1fr);
	}

	.route-surface {
		grid-row: 2;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.single-document .route-surface {
		grid-row: 1;
	}
</style>
