<script lang="ts" module>
	import { editorSurfaceTranslation as t } from './EditorSurface.translation'

	function withParserDetail(summary: string, detail?: string): string {
		return detail ? `${summary}\n${t.yamlParserDetail(detail)}` : summary
	}
</script>

<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte'
	import { AlertTriangle, FilePenLine, FileQuestion, LoaderCircle } from 'lucide-svelte'
	import type { WorkspaceSession } from '#lib/workspace/workspace-session.svelte.js'
	import MarkdownEditor from '../rich-text/MarkdownEditor.svelte'
	import SourceEditor from '../source/SourceEditor.svelte'
	import { projectEditorDocument, replaceEditorDocumentBody } from './editor-document'

	type Props = {
		session: WorkspaceSession
	}

	let { session }: Props = $props()

	const tabID = $derived(session.activeTabID)
	const editorDocument = $derived.by(() => {
		const document = session.document
		return projectEditorDocument({
			markdown: session.draft,
			workspaceName: session.workspace?.name ?? '/',
			document: document ? { name: document.name, path: document.path } : null,
			entries: session.entries,
			documentRendered: session.documentRendered,
			documentUnsupported: session.documentUnsupported,
			strictOpenKnowledgeFormat: session.settings.strictOpenKnowledgeFormat
		})
	})
	const parsed = $derived(editorDocument.parsed)
	const richMarkdown = $derived(editorDocument.richMarkdown)
	const conformanceIssue = $derived(editorDocument.conformanceIssue)
	const canRepairFrontmatter = $derived(editorDocument.canRepairFrontmatter)
	const references = $derived(editorDocument.references)
	const documentPaths = $derived(editorDocument.documentPaths)
	const title = $derived(editorDocument.documentTitle ?? t.document)

	function changeBody(body: string): void {
		session.updateDraft(replaceEditorDocumentBody(parsed, body), tabID)
	}
</script>

<svelte:head
	><title
		>{t.pageTitle(session.document ? title : (session.workspace?.name ?? 'Open Knowledge'))}</title
	></svelte:head
>

<main class="editor-surface">
	{#if session.documentLoading}
		<div class="editor-empty">
			<LoaderCircle class="spin" size={24} /><span>{t.openingDocument}</span>
		</div>
	{:else if !session.document}
		<div class="editor-empty">
			<div class="empty-icon"><FilePenLine size={28} /></div>
			<strong>{t.noDocument}</strong>
			<span>{t.chooseDocument}</span>
		</div>
	{:else if session.documentUnsupported}
		<div class="editor-empty unsupported-document">
			<div class="empty-icon"><FileQuestion size={28} /></div>
			<strong>{t.previewUnavailable}</strong>
			<span>{t.unsupportedFileType}</span>
		</div>
	{:else}
		{#key tabID}
			<div class="document-body">
				{#if conformanceIssue}
					<div class="conformance-error" role="alert">
						<div><AlertTriangle size={16} /><span>{t[conformanceIssue]}</span></div>
						{#if session.documentEditable && canRepairFrontmatter}
							<Button size="small" onclick={() => session.openFrontmatterEditor()}>
								{t.editFrontmatter}
							</Button>
						{/if}
					</div>
				{/if}
				{#if !session.documentRendered && session.editorMode === 'source'}
					{#if !parsed.ok}
						<div class="parse-error" role="alert">
							{withParserDetail(t[parsed.message], parsed.detail)}
						</div>
					{/if}
					<SourceEditor
						markdown={session.draft}
						disabled={session.saveState === 'conflict'}
						readonly={!session.documentEditable}
						onchange={(value) => session.updateDraft(value, tabID)}
					/>
				{:else}
					<MarkdownEditor
						markdown={richMarkdown}
						disabled={session.documentEditable && session.saveState === 'conflict'}
						readonly={session.documentReadonly}
						editorControls={session.settings.editorControls}
						editorFontFamily={session.settings.editorFontFamily}
						editorFontSize={session.settings.editorFontSize}
						documentPath={session.document.path}
						{documentPaths}
						resolveAbsolutePathsFromProjectRoot={session.settings
							.resolveAbsolutePathsFromProjectRoot}
						{references}
						onopenreference={(path) => void session.openReference(path)}
						onopensystempath={(path) => void session.openSystemPath(path)}
						onchange={changeBody}
					/>
				{/if}
			</div>
		{/key}
	{/if}
</main>

<style>
	.editor-surface {
		display: grid;
		height: 100%;
		min-width: 0;
		min-height: 0;
		grid-template-rows: minmax(0, 1fr);
		overflow: hidden;
		background: var(--gray-1);
	}

	.document-body {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}

	.document-body > :global(*) {
		height: 100%;
	}

	.editor-empty {
		display: flex;
		grid-row: 1 / -1;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 8px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-body);
	}

	.editor-empty strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-section-title);
	}

	.empty-icon {
		display: grid;
		width: 52px;
		height: 52px;
		margin-bottom: 4px;
		place-items: center;
		border: 1px solid var(--gray-6);
		border-radius: 8px;
		background: var(--gray-2);
		color: var(--gray-8);
	}

	.unsupported-document span {
		max-width: min(420px, calc(100% - 32px));
		text-align: center;
	}

	.parse-error {
		position: absolute;
		z-index: 2;
		top: 12px;
		left: 50%;
		width: fit-content;
		height: auto;
		max-width: min(90%, 720px);
		transform: translateX(-50%);
		border: 1px solid var(--red-7);
		border-radius: 6px;
		background: var(--red-3);
		padding: 9px 12px;
		color: var(--red-11);
		font-size: var(--font-size-ui-text);
		white-space: pre-wrap;
	}

	.conformance-error {
		position: absolute;
		z-index: 3;
		top: 12px;
		left: 50%;
		display: flex;
		width: min(720px, calc(100% - 24px));
		height: auto;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		transform: translateX(-50%);
		border: 1px solid var(--red-7);
		border-radius: 6px;
		background: var(--red-3);
		padding: 8px 9px 8px 12px;
		box-shadow: 0 2px 8px var(--black-a3);
		color: var(--red-11);
		font-size: var(--font-size-ui-text);
	}

	.conformance-error > div {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.conformance-error :global(svg) {
		flex: none;
	}

	@media (max-width: 560px) {
		.conformance-error {
			align-items: flex-start;
			flex-direction: column;
			gap: 8px;
		}

		.conformance-error :global(.ui-button) {
			width: 100%;
			height: auto;
			min-height: 26px;
			padding-block: 4px;
			white-space: normal;
		}
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
