<script lang="ts">
	import type {
		KnowledgeSearchMatch,
		WorkspaceEntry,
		WorkspaceFileEntry
	} from '#lib/knowledge/api.js'
	import { FileText, LoaderCircle } from 'lucide-svelte'
	import { workspaceSidebarTranslation as t } from './WorkspaceSidebar.translation'

	type Props = {
		entries: WorkspaceEntry[]
		query: string
		matches: KnowledgeSearchMatch[]
		loading: boolean
		failed: boolean
		truncated: boolean
		onopen: (entry: WorkspaceFileEntry) => void
	}

	let { entries, query, matches, loading, failed, truncated, onopen }: Props = $props()

	const files = $derived(
		entries.filter((entry): entry is WorkspaceFileEntry => entry.kind === 'file')
	)
	const filesByPath = $derived(new Map(files.map((entry) => [entry.path, entry])))
	const fileNameMatches = $derived.by(() => {
		const normalized = query.trim().toLowerCase()
		return normalized
			? files.filter((entry) => entry.path.toLowerCase().includes(normalized)).slice(0, 50)
			: []
	})
	const contentMatches = $derived(
		matches.flatMap((match) => {
			const entry = filesByPath.get(match.path)
			return entry ? [{ entry, match }] : []
		})
	)
	const empty = $derived(fileNameMatches.length === 0 && contentMatches.length === 0)

	function displayName(entry: WorkspaceFileEntry): string {
		return entry.name.replace(/\.md$/i, '')
	}
</script>

<div class="search-results" aria-live="polite">
	{#if fileNameMatches.length > 0}
		<div class="result-heading">{t.fileNameMatches}</div>
		{#each fileNameMatches as entry (entry.path)}
			<button class="file-result" type="button" onclick={() => onopen(entry)} title={entry.path}>
				<FileText size={14} />
				<span>
					<strong>{displayName(entry)}</strong>
					<small>{entry.path}</small>
				</span>
			</button>
		{/each}
	{/if}

	{#if contentMatches.length > 0}
		<div class="result-heading">{t.contentMatches}</div>
		{#each contentMatches as result (`${result.match.path}:${result.match.lineNumber}:${result.match.columnNumber}`)}
			<button
				class="content-result"
				type="button"
				onclick={() => onopen(result.entry)}
				title={`${result.entry.path}:${result.match.lineNumber}`}
			>
				<span class="result-title">
					<FileText size={14} />
					<strong>{displayName(result.entry)}</strong>
					<small>{t.line(result.match.lineNumber)}</small>
				</span>
				<span class="result-path">{result.entry.path}</span>
				<code>{result.match.preview}</code>
			</button>
		{/each}
	{/if}

	{#if loading}
		<div class="search-state"><LoaderCircle class="spin" size={14} /> {t.searching}</div>
	{:else if failed}
		<div class="search-state">{t.searchFailed}</div>
	{:else if empty}
		<div class="search-state">{t.noSearchResults}</div>
	{:else if truncated}
		<div class="search-state">{t.moreSearchResults}</div>
	{/if}
</div>

<style>
	.search-results {
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 0 6px 12px;
	}

	.result-heading {
		padding: 9px 7px 5px;
		color: var(--gray-10);
		font-size: var(--font-size-ui-caption);
		font-weight: 650;
		text-transform: uppercase;
	}

	.file-result,
	.content-result {
		width: 100%;
		min-width: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--gray-11);
		text-align: left;
		cursor: default;
	}

	.file-result:hover,
	.file-result:focus-visible,
	.content-result:hover,
	.content-result:focus-visible {
		background: var(--gray-4);
		color: var(--gray-12);
		outline: none;
	}

	.file-result {
		display: grid;
		min-height: 38px;
		align-items: center;
		grid-template-columns: 19px minmax(0, 1fr);
		padding: 4px 7px;
	}

	.file-result > span,
	.result-title {
		min-width: 0;
	}

	strong,
	small,
	.result-path,
	code {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	strong {
		font-size: var(--font-size-ui-text);
		font-weight: 560;
	}

	small,
	.result-path {
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
	}

	.content-result {
		display: block;
		margin-block-end: 2px;
		padding: 7px;
	}

	.result-title {
		display: grid;
		align-items: center;
		grid-template-columns: 19px minmax(0, 1fr) auto;
		gap: 2px;
	}

	.result-path {
		padding: 2px 0 0 21px;
	}

	code {
		margin: 5px 0 0 21px;
		color: var(--gray-11);
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-caption);
	}

	.search-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 18px 10px;
		color: var(--gray-10);
		font-size: var(--font-size-ui-text);
		text-align: center;
	}
</style>
