<script lang="ts" module>
	import { propertiesPanelTranslation as t } from './PropertiesPanel.translation'

	function withParserDetail(summary: string, detail?: string): string {
		return detail ? `${summary}\n${t.yamlParserDetail(detail)}` : summary
	}
</script>

<script lang="ts">
	import IconButton from '#lib/components/ui/IconButton.svelte'
	import {
		frontmatterValueKind,
		stringifyFrontmatterValue
	} from '@open-knowledge/knowledge-bundle/frontmatter'
	import { Trash2 } from 'lucide-svelte'
	import { parseNumberInput, parseYAMLInput } from './property-input'

	type ErrorMessage = () => string
	type Props = {
		propertyKey: string
		value: unknown
		onrename: (nextKey: string) => boolean
		onupdate: (value: unknown) => void
		onerror: (error: ErrorMessage) => void
		ondelete: () => void
	}

	let { propertyKey, value, onrename, onupdate, onerror, ondelete }: Props = $props()

	const kind = $derived(frontmatterValueKind(value))

	function inputValue(event: Event): string | null {
		return event.currentTarget instanceof HTMLInputElement ||
			event.currentTarget instanceof HTMLTextAreaElement
			? event.currentTarget.value
			: null
	}

	function rename(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return
		}
		const nextKey = event.currentTarget.value.trim()
		if (!nextKey || nextKey === propertyKey || !onrename(nextKey)) {
			event.currentTarget.value = propertyKey
		}
	}

	function updateText(event: Event): void {
		const source = inputValue(event)
		if (source !== null) {
			onupdate(source)
		}
	}

	function updateNumber(event: Event): void {
		const source = inputValue(event)
		if (source === null) {
			return
		}
		const result = parseNumberInput(source)
		if (!result.ok) {
			onerror(() => t[result.message])
			return
		}
		onupdate(result.value)
	}

	function updateBoolean(event: Event): void {
		if (event.currentTarget instanceof HTMLInputElement) {
			onupdate(event.currentTarget.checked)
		}
	}

	function updateYAML(event: Event): void {
		const source = inputValue(event)
		if (source === null) {
			return
		}
		const result = parseYAMLInput(source)
		if (!result.ok) {
			const { message, detail } = result
			onerror(() => withParserDetail(t[message](propertyKey), detail))
			return
		}
		onupdate(result.value)
	}
</script>

<div class="property-row">
	<div class="property-key">
		<input aria-label={t.renameProperty(propertyKey)} value={propertyKey} onchange={rename} />
		<span>{t[kind]}</span>
	</div>
	<div class="property-value">
		{#if kind === 'boolean'}
			<label class="boolean-value">
				<input type="checkbox" checked={value === true} onchange={updateBoolean} />
				<span>{value ? t.trueValue : t.falseValue}</span>
			</label>
		{:else if kind === 'number'}
			<input type="number" step="1" value={String(value)} onchange={updateNumber} />
		{:else if kind === 'text'}
			<input value={String(value ?? '')} onchange={updateText} />
		{:else}
			<textarea
				aria-label={t.yamlValue(propertyKey)}
				value={stringifyFrontmatterValue(value)}
				onchange={updateYAML}></textarea>
		{/if}
	</div>
	<IconButton
		label={t.removeProperty(propertyKey)}
		size="small"
		variant="danger"
		onclick={ondelete}
	>
		<Trash2 size={14} />
	</IconButton>
</div>

<style>
	.property-row {
		display: grid;
		min-width: 0;
		align-items: start;
		grid-template-columns: minmax(150px, 0.36fr) minmax(180px, 1fr) 26px;
		gap: 7px;
	}

	.property-key {
		position: relative;
		min-width: 0;
	}

	.property-key span {
		position: absolute;
		top: 9px;
		right: 7px;
		color: var(--gray-9);
		font-size: var(--font-size-ui-caption);
		font-weight: 650;
		pointer-events: none;
		text-transform: uppercase;
	}

	.property-key input {
		padding-right: 48px;
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-text);
	}

	input,
	textarea {
		width: 100%;
		min-width: 0;
		border: 1px solid transparent;
		border-radius: 4px;
		background: var(--gray-1);
		padding: 0 8px;
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
	}

	input {
		height: 30px;
	}

	textarea {
		min-height: 30px;
		max-height: 112px;
		resize: vertical;
		padding-block: 6px;
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-text);
		line-height: 1.4;
	}

	input:hover,
	textarea:hover {
		border-color: var(--gray-6);
	}

	input:focus,
	textarea:focus {
		border-color: var(--accent-8);
		outline: 2px solid var(--accent-5);
	}

	input:disabled {
		color: var(--gray-12);
		opacity: 1;
	}

	.boolean-value {
		display: flex;
		height: 30px;
		align-items: center;
		gap: 8px;
		padding: 0 8px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
	}

	.boolean-value input {
		width: 14px;
		height: 14px;
	}

	@media (max-width: 760px) {
		.property-row {
			grid-template-columns: minmax(120px, 0.42fr) minmax(130px, 1fr) 26px;
		}
	}
</style>
