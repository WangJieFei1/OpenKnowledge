<script lang="ts">
	import ToggleSwitch from '#lib/components/ui/ToggleSwitch.svelte'
	import {
		EditorControlsSchema,
		EditorFontFamilySchema,
		type ApplicationSettings,
		type UpdateApplicationSettingsInput
	} from '#lib/settings/api.js'
	import { RadioGroup } from 'bits-ui'
	import { Check, Type } from 'lucide-svelte'
	import * as v from 'valibot'
	import { settingsViewTranslation as t } from '../SettingsView.translation'
	import SettingsSection from './SettingsSection.svelte'

	type EditorSettings = Pick<
		ApplicationSettings,
		'editorControls' | 'showEditorModeControls' | 'editorFontFamily' | 'editorFontSize'
	>
	type Props = {
		settings: Readonly<EditorSettings>
		onupdate: (patch: UpdateApplicationSettingsInput) => void | Promise<void>
	}

	let { settings, onupdate }: Props = $props()

	const controlOptions: Array<{
		value: ApplicationSettings['editorControls']
		label: string
		description: string
	}> = [
		{ value: 'toolbar', label: t.controlToolbar, description: t.controlToolbarDescription },
		{ value: 'slash', label: t.controlSlash, description: t.controlSlashDescription },
		{ value: 'both', label: t.controlBoth, description: t.controlBothDescription }
	]
	const fontOptions: Array<{
		value: ApplicationSettings['editorFontFamily']
		label: string
		description: string
		className: string
	}> = [
		{
			value: 'book',
			label: t.fontBook,
			description: t.fontBookDescription,
			className: 'book'
		},
		{ value: 'sans', label: t.fontSans, description: t.fontSansDescription, className: 'sans' },
		{
			value: 'mono',
			label: t.fontMono,
			description: t.fontMonoDescription,
			className: 'mono'
		}
	]

	function changeFontSize(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) {
			return
		}
		void onupdate({ editorFontSize: Number(event.currentTarget.value) })
	}

	function changeEditorControls(value: string): void {
		if (v.is(EditorControlsSchema, value)) {
			void onupdate({ editorControls: value })
		}
	}

	function changeEditorFont(value: string): void {
		if (v.is(EditorFontFamilySchema, value)) {
			void onupdate({ editorFontFamily: value })
		}
	}
</script>

<SettingsSection title={t.editor} description={t.editorDescription}>
	{#snippet icon()}<Type size={17} />{/snippet}
	<div class="setting-row vertical">
		<div><strong>{t.writingControls}</strong><span>{t.writingControlsDescription}</span></div>
		<RadioGroup.Root
			class="control-options"
			value={settings.editorControls}
			onValueChange={changeEditorControls}
			aria-label={t.writingControls}
		>
			{#each controlOptions as option (option.value)}
				<RadioGroup.Item class="choice-option" value={option.value}>
					<span><strong>{option.label}</strong><small>{option.description}</small></span>
					{#if settings.editorControls === option.value}<Check size={16} />{/if}
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</div>

	<div class="setting-row">
		<div>
			<strong>{t.editorMode}</strong><span>{t.editorModeDescription}</span>
		</div>
		<ToggleSwitch
			label={t.showEditorModeControls}
			checked={settings.showEditorModeControls}
			onCheckedChange={(showEditorModeControls) => void onupdate({ showEditorModeControls })}
		/>
	</div>

	<div class="setting-row vertical">
		<div><strong>{t.documentFont}</strong><span>{t.documentFontDescription}</span></div>
		<RadioGroup.Root
			class="font-options"
			value={settings.editorFontFamily}
			onValueChange={changeEditorFont}
			aria-label={t.documentFont}
		>
			{#each fontOptions as option (option.value)}
				<RadioGroup.Item class={['font-option', option.className]} value={option.value}>
					<span class="font-sample">{t.fontSample}</span>
					<span><strong>{option.label}</strong><small>{option.description}</small></span>
					{#if settings.editorFontFamily === option.value}<Check size={16} />{/if}
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</div>

	<label class="setting-row font-size-row">
		<div><strong>{t.textSize}</strong><span>{t.textSizeDescription}</span></div>
		<input
			type="range"
			min="13"
			max="24"
			step="1"
			value={settings.editorFontSize}
			onchange={changeFontSize}
		/>
		<output>{t.fontSizeValue(settings.editorFontSize)}</output>
	</label>
</SettingsSection>

<style>
	.setting-row {
		display: grid;
		min-height: 66px;
		align-items: center;
		grid-template-columns: minmax(180px, 1fr) auto;
		gap: 20px;
		border-bottom: 1px solid var(--gray-5);
		padding: 13px 0;
	}

	.setting-row.vertical {
		align-items: start;
		grid-template-columns: 190px minmax(0, 1fr);
		padding: 18px 0;
	}

	.setting-row > div:first-child,
	.setting-row :global(.control-options .choice-option span),
	.setting-row :global(.font-options .font-option > span:nth-child(2)) {
		display: grid;
		gap: 3px;
	}

	.setting-row strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
		font-weight: 620;
	}

	.setting-row span,
	.setting-row small {
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		line-height: 1.4;
	}

	.setting-row :global(.control-options),
	.setting-row :global(.font-options) {
		display: grid;
		gap: 6px;
	}

	.setting-row :global(.control-options .choice-option),
	.setting-row :global(.font-options .font-option) {
		display: grid;
		min-height: 50px;
		align-items: center;
		grid-template-columns: minmax(0, 1fr) 18px;
		gap: 10px;
		border: 1px solid var(--gray-6);
		border-radius: 6px;
		background: var(--gray-1);
		padding: 8px 11px;
		color: var(--gray-10);
		text-align: left;
		cursor: pointer;
	}

	.setting-row :global(.font-options .font-option) {
		grid-template-columns: 46px minmax(0, 1fr) 18px;
	}

	.setting-row :global(.control-options .choice-option:hover),
	.setting-row :global(.font-options .font-option:hover),
	.setting-row :global(.control-options .choice-option[data-state='checked']),
	.setting-row :global(.font-options .font-option[data-state='checked']) {
		border-color: var(--accent-7);
		background: var(--accent-2);
	}

	.font-sample {
		color: var(--gray-12) !important;
		font-size: var(--font-size-ui-display) !important;
		text-align: center;
	}

	.setting-row :global(.font-options .font-option.book .font-sample) {
		font-family: var(--font-book);
	}

	.setting-row :global(.font-options .font-option.sans .font-sample) {
		font-family: var(--font-ui);
	}

	.setting-row :global(.font-options .font-option.mono .font-sample) {
		font-family: var(--font-mono);
	}

	.font-size-row {
		grid-template-columns: minmax(180px, 1fr) minmax(160px, 280px) 42px;
	}

	.font-size-row input {
		accent-color: var(--accent-9);
	}

	output {
		color: var(--gray-11);
		font-family: var(--font-mono);
		font-size: var(--font-size-ui-text);
		text-align: right;
	}

	@media (max-width: 820px) {
		.setting-row.vertical {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		.font-size-row {
			grid-template-columns: minmax(0, 1fr) 42px;
		}

		.font-size-row > div:first-child {
			grid-column: 1 / -1;
		}

		.font-size-row input {
			width: 100%;
			min-width: 0;
		}
	}
</style>
