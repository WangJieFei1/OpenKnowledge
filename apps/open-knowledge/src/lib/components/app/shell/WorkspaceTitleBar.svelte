<script lang="ts">
	import { PropertiesPanel } from '#lib/components/editor/index.js'
	import { deriveDocumentChromeState } from '#lib/workspace/document-chrome.js'
	import { useWorkspaceSession } from '#lib/workspace/session-context.js'
	import WindowTitleBar from '../WindowTitleBar.svelte'
	import type { ApplicationCommand } from '../application-command'

	type Props = {
		commands: ApplicationCommand[]
		editorWindow: boolean
		oncommand: (id: string) => void
		onpalette: () => void
		onsettings: () => void
		onclose: () => void
	}

	let { commands, editorWindow, oncommand, onpalette, onsettings, onclose }: Props = $props()
	const session = useWorkspaceSession()

	const sidebarShown = $derived(!editorWindow && session.settings.sidebarVisible)
	const documentChrome = $derived.by(() => {
		const document = session.document
		return deriveDocumentChromeState({
			markdown: session.draft,
			document: document ? { name: document.name, path: document.path } : null,
			documentEditable: session.documentEditable,
			documentRendered: session.documentRendered,
			documentUnsupported: session.documentUnsupported,
			usesOpenKnowledgeFormat: Boolean(document && session.usesOpenKnowledgeFormat(document.path)),
			strictOpenKnowledgeFormat: session.settings.strictOpenKnowledgeFormat
		})
	})
</script>

<WindowTitleBar
	title={editorWindow
		? (documentChrome.documentTitle ?? session.workspace?.name ?? 'Open Knowledge')
		: (session.workspace?.name ?? 'Open Knowledge')}
	documentTitle={editorWindow ? undefined : documentChrome.documentTitle}
	documentAccess={session.documentAccess}
	{commands}
	showSidebarControl={!editorWindow}
	sidebarVisible={sidebarShown}
	showSettings
	showDocumentControls={session.documentEditable || session.saveState === 'conflict'}
	convertToMarkdownDisabled={!session.editable}
	showEditorModeControls={session.settings.showEditorModeControls &&
		Boolean(session.document && !session.documentRendered && !session.documentUnsupported)}
	saveState={session.saveState}
	editorMode={session.editorMode}
	ontoggleSidebar={() => oncommand('view.sidebar')}
	onworkspace={editorWindow ? undefined : () => oncommand('workspace.switch')}
	{onpalette}
	{onsettings}
	onsave={() => void session.save()}
	onreload={() => void session.reloadDocument()}
	onconvert={session.local && session.documentRendered
		? () => void session.convertDocumentToMarkdown()
		: undefined}
	onmode={(mode) => session.setEditorMode(mode)}
	{onclose}
>
	{#snippet properties()}
		{#if documentChrome.propertiesAvailable && documentChrome.parsed.ok}
			<PropertiesPanel
				bind:open={session.frontmatterEditorOpen}
				parsed={documentChrome.parsed.value}
				showRecommendations={documentChrome.showRecommendations}
				onchange={(markdown) => session.updateDraft(markdown)}
				onsource={() => session.setEditorMode('source')}
			/>
		{/if}
	{/snippet}
</WindowTitleBar>
