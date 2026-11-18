<script lang="ts" module>
	import { propertiesPanelTranslation as t } from './PropertiesPanel.translation'
</script>

<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte'
	import type { ParsedKnowledgeMarkdown } from '@open-knowledge/knowledge-bundle/frontmatter'
	import { Popover } from 'bits-ui'
	import { Braces, Plus, Tags, X } from 'lucide-svelte'
	import PropertyRow from './PropertyRow.svelte'
	import { recommendedProperties } from './property-input'
	import {
		addProperty,
		deleteProperty,
		renameProperty,
		updateProperty,
		type PropertyMutationError,
		type PropertyMutationResult
	} from './property-mutations'

	type Props = {
		parsed: ParsedKnowledgeMarkdown
		open?: boolean
		showRecommendations?: boolean
		onchange: (markdown: string) => void
		onsource: () => void
	}

	let {
		parsed,
		open = $bindable(false),
		showRecommendations = false,
		onchange,
		onsource
	}: Props = $props()

	const properties = $derived(Object.entries(parsed.frontmatter))
	const missingRecommendations = $derived(
		showRecommendations
			? recommendedProperties.filter(
					(recommendation) => !Object.hasOwn(parsed.frontmatter, recommendation.key)
				)
			: []
	)
	let adding = $state(false)
	let newPropertyName = $state('')
	let error = $state.raw<(() => string) | null>(null)
	let newPropertyInput = $state.raw<HTMLInputElement | null>(null)

	$effect(() => {
		if (adding && newPropertyInput) {
			newPropertyInput.focus()
		}
	})

	function mutationErrorMessage(mutationError: PropertyMutationError): () => string {
		switch (mutationError.code) {
			case 'name-required':
				return () => t.enterPropertyName
			case 'property-exists':
				return () => t.propertyExists(mutationError.key)
			case 'update-failed':
				return () => t.updateFailed
			case 'rename-failed':
				return () => t.renameFailed
			case 'delete-failed':
				return () => t.removeFailed
		}
	}

	function applyMutation(result: PropertyMutationResult): boolean {
		if (!result.ok) {
			error = mutationErrorMessage(result.error)
			return false
		}
		onchange(result.markdown)
		error = null
		return true
	}

	function commit(key: string, value: unknown): void {
		applyMutation(updateProperty(parsed, key, value))
	}

	function rename(key: string, nextKey: string): boolean {
		return applyMutation(renameProperty(parsed, key, nextKey))
	}

	function remove(key: string): void {
		applyMutation(deleteProperty(parsed, key))
	}

	function reportError(nextError: () => string): void {
		error = nextError
	}

	function add(key = newPropertyName, value: unknown = ''): void {
		if (!applyMutation(addProperty(parsed, key, value))) {
			return
		}
		newPropertyName = ''
		adding = false
	}

	function editSource(): void {
		open = false
		onsource()
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="properties-trigger"
		aria-label={t.propertyCount(properties.length)}
		title={t.documentProperties}
	>
		<Tags size={14} />
		<span>{properties.length}</span>
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			class="properties-popover"
			data-motion="anchored"
			align="end"
			sideOffset={6}
			collisionPadding={8}
		>
			<header class="property-header">
				<div>
					<strong>{t.documentProperties}</strong>
					<span>{t.openKnowledgeFrontmatter}</span>
				</div>
				<Popover.Close class="property-close" aria-label={t.closeProperties}>
					<X size={15} />
				</Popover.Close>
			</header>

			<div class={['property-actions', { 'without-recommendations': !showRecommendations }]}>
				{#if showRecommendations}
					<div class="recommendations" aria-label={t.recommendedProperties}>
						{#each missingRecommendations.slice(0, 4) as recommendation (recommendation.key)}
							<button type="button" onclick={() => add(recommendation.key, recommendation.value)}>
								+ {recommendation.key}
							</button>
						{/each}
					</div>
				{/if}
				<div class="panel-buttons">
					<Button size="small" variant="ghost" onclick={() => (adding = !adding)}>
						<Plus size={14} />
						{t.addProperty}
					</Button>
					<Button size="small" variant="ghost" onclick={editSource}>
						<Braces size={14} />
						{t.editYAML}
					</Button>
				</div>
			</div>

			{#if adding}
				<form
					class="add-property"
					onsubmit={(event) => {
						event.preventDefault()
						add()
					}}
				>
					<label for="new-property-name">{t.propertyName}</label>
					<input
						id="new-property-name"
						bind:this={newPropertyInput}
						bind:value={newPropertyName}
						placeholder="custom_property"
					/>
					<Button type="submit" size="small">{t.add}</Button>
				</form>
			{/if}

			<div class="property-list">
				{#each properties as [key, value] (key)}
					<PropertyRow
						propertyKey={key}
						{value}
						onrename={(nextKey) => rename(key, nextKey)}
						onupdate={(nextValue) => commit(key, nextValue)}
						onerror={reportError}
						ondelete={() => remove(key)}
					/>
				{:else}
					<div class="empty-properties">
						{t.emptyProperties}
					</div>
				{/each}
			</div>

			{#if error}<p class="property-error" role="alert">{error()}</p>{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

<style>
	:global(.properties-trigger) {
		display: inline-flex;
		height: 26px;
		align-items: center;
		gap: 4px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		padding: 0 6px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
		font-weight: 600;
		cursor: default;
	}

	:global(.properties-trigger:hover),
	:global(.properties-trigger[data-state='open']) {
		border-color: var(--gray-6);
		background: var(--gray-4);
		color: var(--gray-12);
	}

	:global(.properties-trigger > span) {
		min-width: 16px;
		border-radius: 8px;
		background: var(--gray-5);
		padding: 1px 4px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-caption);
		text-align: center;
	}

	:global(.properties-popover) {
		z-index: 96;
		display: flex;
		width: min(700px, calc(100vw - 24px));
		max-height: min(68vh, 560px);
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--gray-7);
		border-radius: 8px;
		background: var(--gray-1);
		box-shadow: var(--ui-shadow-dialog);
		outline: none;
	}

	.property-header {
		display: flex;
		min-height: 48px;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid var(--gray-6);
		padding: 7px 8px 7px 13px;
	}

	.property-header > div {
		display: grid;
		gap: 1px;
	}

	.property-header strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-section-title);
		font-weight: 650;
	}

	.property-header span {
		color: var(--gray-10);
		font-size: var(--font-size-ui-text);
	}

	:global(.property-close) {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--gray-10);
	}

	:global(.property-close:hover) {
		background: var(--gray-4);
		color: var(--gray-12);
	}

	.property-actions,
	.panel-buttons,
	.recommendations,
	.add-property {
		display: flex;
		align-items: center;
	}

	.property-actions {
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid var(--gray-5);
		padding: 6px 8px 6px 10px;
	}

	.property-actions.without-recommendations {
		justify-content: flex-end;
	}

	.panel-buttons,
	.recommendations {
		gap: 4px;
	}

	.recommendations {
		min-width: 0;
		overflow: hidden;
	}

	.recommendations button {
		border: 0;
		background: transparent;
		padding: 3px 5px;
		color: var(--accent-11);
		font-size: var(--font-size-ui-caption);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}

	.add-property {
		gap: 7px;
		margin: 8px 10px 0;
		border: 1px solid var(--gray-6);
		border-radius: 5px;
		background: var(--gray-1);
		padding: 6px;
	}

	.add-property label {
		padding-left: 3px;
		color: var(--gray-10);
		font-size: var(--font-size-ui-caption);
		font-weight: 650;
	}

	.add-property input {
		flex: 1;
	}

	input {
		width: 100%;
		min-width: 0;
		height: 30px;
		border: 1px solid transparent;
		border-radius: 4px;
		background: var(--gray-1);
		padding: 0 8px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
	}

	input:hover {
		border-color: var(--gray-6);
	}

	input:focus {
		border-color: var(--accent-8);
		outline: 2px solid var(--accent-5);
	}

	input:disabled {
		color: var(--gray-12);
		opacity: 1;
	}

	.property-list {
		display: grid;
		min-height: 0;
		flex: 1 1 auto;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		gap: 3px;
		padding: 8px 10px 10px;
	}

	.empty-properties {
		padding: 12px 4px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
	}

	.property-error {
		margin: 0 10px 10px;
		border-radius: 4px;
		background: var(--red-3);
		padding: 6px 8px;
		color: var(--red-11);
		font-size: var(--font-size-ui-text);
		white-space: pre-wrap;
	}

	@media (max-width: 760px) {
		.recommendations {
			display: none;
		}
	}
</style>
