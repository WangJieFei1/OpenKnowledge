<script lang="ts">
	import type { EditorMode } from '#lib/workspace/workspace-session.svelte.js'
	import { Tabs } from 'bits-ui'
	import { CodeXml, FileText } from 'lucide-svelte'
	import { windowTitleBarTranslation as t } from '../WindowTitleBar.translation'

	type Props = {
		value: EditorMode
		onchange?: (value: EditorMode) => void
	}

	let { value, onchange }: Props = $props()

	function changeMode(value: string): void {
		if (value === 'source' || value === 'rich') {
			onchange?.(value)
		}
	}
</script>

<Tabs.Root {value} onValueChange={changeMode} activationMode="manual">
	<Tabs.List class="title-mode-tabs" aria-label={t.editorMode}>
		<Tabs.Trigger class="title-mode-tab" value="rich" title={t.richText}>
			<FileText size={13} /><span>{t.richText}</span>
		</Tabs.Trigger>
		<Tabs.Trigger class="title-mode-tab" value="source" title={t.markdownSource}>
			<CodeXml size={13} /><span>{t.markdown}</span>
		</Tabs.Trigger>
	</Tabs.List>
</Tabs.Root>

<style>
	:global(.title-mode-tabs),
	:global(.title-mode-tab) {
		display: flex;
		align-items: center;
	}

	:global(.title-mode-tabs) {
		height: 26px;
		gap: 1px;
		border: 1px solid var(--gray-6);
		border-radius: 5px;
		background: var(--gray-3);
		padding: 1px;
	}

	:global(.title-mode-tab) {
		height: 22px;
		gap: 4px;
		border: 0;
		border-radius: 3px;
		background: transparent;
		padding: 0 6px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		font-weight: 550;
		cursor: default;
	}

	:global(.title-mode-tab[data-state='active']) {
		background: var(--gray-1);
		box-shadow: 0 1px 2px var(--black-a4);
		color: var(--gray-12);
	}

	@media (max-width: 1260px) {
		:global(.title-mode-tab span) {
			display: none;
		}

		:global(.title-mode-tab) {
			width: 25px;
			justify-content: center;
			padding: 0;
		}
	}
</style>
