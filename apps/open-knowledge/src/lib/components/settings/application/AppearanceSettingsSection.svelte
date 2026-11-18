<script lang="ts">
	import {
		ApplicationLanguageSchema,
		type ApplicationSettings,
		type UpdateApplicationSettingsInput
	} from '#lib/settings/api.js'
	import {
		applicationThemes,
		isApplicationTheme,
		isApplicationThemeMode,
		type ApplicationTheme,
		type ApplicationThemeMode
	} from '#lib/theme/theme.js'
	import { RadioGroup } from 'bits-ui'
	import { Check, Monitor, Moon, Palette, Sun } from 'lucide-svelte'
	import * as v from 'valibot'
	import { settingsViewTranslation as t } from '../SettingsView.translation'
	import SettingsSection from './SettingsSection.svelte'

	type AppearanceSettings = Pick<ApplicationSettings, 'colorMode' | 'colorTheme' | 'language'>
	type Props = {
		settings: Readonly<AppearanceSettings>
		onupdate: (patch: UpdateApplicationSettingsInput) => void | Promise<void>
	}

	let { settings, onupdate }: Props = $props()

	const modeOptions: Array<{
		value: ApplicationThemeMode
		label: string
		description: string
	}> = [
		{ value: 'system', label: t.modeSystem, description: t.modeSystemDescription },
		{ value: 'light', label: t.modeLight, description: t.modeLightDescription },
		{ value: 'dark', label: t.modeDark, description: t.modeDarkDescription }
	]
	const languageOptions: Array<{
		value: ApplicationSettings['language']
		label: string
		description: string
	}> = [
		{
			value: 'en',
			label: t.languageEnglish,
			description: t.languageEnglishDescription
		},
		{
			value: 'zh-cn',
			label: t.languageChinese,
			description: t.languageChineseDescription
		}
	]
	const themeLabels = $derived({
		indigo: t.colorIndigo,
		blue: t.colorBlue,
		cyan: t.colorCyan,
		teal: t.colorTeal,
		green: t.colorGreen,
		grass: t.colorGrass,
		orange: t.colorOrange,
		red: t.colorRed,
		crimson: t.colorCrimson,
		pink: t.colorPink,
		purple: t.colorPurple,
		violet: t.colorViolet
	} satisfies Record<ApplicationTheme, string>)

	function changeLanguage(value: string): void {
		if (v.is(ApplicationLanguageSchema, value)) {
			void onupdate({ language: value })
		}
	}

	function changeThemeMode(value: string): void {
		if (isApplicationThemeMode(value)) {
			void onupdate({ colorMode: value })
		}
	}

	function changeTheme(value: string): void {
		if (isApplicationTheme(value)) {
			void onupdate({ colorTheme: value })
		}
	}
</script>

<SettingsSection title={t.appearance} description={t.appearanceDescription}>
	{#snippet icon()}<Palette size={17} />{/snippet}
	<div class="setting-row">
		<div>
			<strong>{t.colorMode}</strong><span>{t.colorModeDescription}</span>
		</div>
		<RadioGroup.Root
			class="mode-options"
			value={settings.colorMode}
			onValueChange={changeThemeMode}
			aria-label={t.colorMode}
		>
			{#each modeOptions as option (option.value)}
				<RadioGroup.Item class="mode-option" value={option.value}>
					<span class="mode-icon" aria-hidden="true">
						{#if option.value === 'system'}
							<Monitor size={15} />
						{:else if option.value === 'light'}
							<Sun size={15} />
						{:else}
							<Moon size={15} />
						{/if}
					</span>
					<span><strong>{option.label}</strong><small>{option.description}</small></span>
					{#if settings.colorMode === option.value}<Check size={16} />{/if}
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</div>
	<div class="setting-row">
		<div>
			<strong>{t.colorTheme}</strong><span>{t.colorThemeDescription}</span>
		</div>
		<RadioGroup.Root
			class="theme-options"
			value={settings.colorTheme}
			onValueChange={changeTheme}
			aria-label={t.colorTheme}
		>
			{#each applicationThemes as option (option)}
				<RadioGroup.Item class="theme-option" value={option} data-theme-preview={option}>
					<span class="theme-swatch" aria-hidden="true"></span>
					<span class="theme-name">{themeLabels[option]}</span>
					{#if settings.colorTheme === option}<Check size={15} />{/if}
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</div>
	<div class="setting-row">
		<div>
			<strong>{t.language}</strong><span>{t.languageDescription}</span>
		</div>
		<RadioGroup.Root
			class="control-options"
			value={settings.language}
			onValueChange={changeLanguage}
			aria-label={t.applicationLanguage}
		>
			{#each languageOptions as option (option.value)}
				<RadioGroup.Item class="choice-option" value={option.value}>
					<span><strong>{option.label}</strong><small>{option.description}</small></span>
					{#if settings.language === option.value}<Check size={16} />{/if}
				</RadioGroup.Item>
			{/each}
		</RadioGroup.Root>
	</div>
</SettingsSection>

<style>
	.setting-row {
		display: grid;
		min-height: 66px;
		align-items: start;
		grid-template-columns: 190px minmax(0, 1fr);
		gap: 20px;
		border-bottom: 1px solid var(--gray-5);
		padding: 18px 0;
	}

	.setting-row > div:first-child,
	.setting-row :global(.control-options .choice-option span) {
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

	.setting-row :global(.mode-options) {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
	}

	.setting-row :global(.mode-option) {
		display: grid;
		min-width: 0;
		min-height: 58px;
		align-items: center;
		grid-template-columns: 20px minmax(0, 1fr) 16px;
		gap: 7px;
		border: 1px solid var(--gray-6);
		border-radius: 6px;
		background: var(--gray-1);
		padding: 8px;
		text-align: left;
		cursor: pointer;
	}

	.setting-row :global(.mode-option:hover),
	.setting-row :global(.mode-option[data-state='checked']) {
		border-color: var(--accent-7);
		background: var(--accent-2);
	}

	.setting-row :global(.mode-option > span:nth-child(2)) {
		display: grid;
		min-width: 0;
		gap: 2px;
	}

	.setting-row :global(.mode-option .mode-icon) {
		display: grid;
		place-items: center;
		color: var(--accent-11);
	}

	.setting-row :global(.mode-option strong),
	.setting-row :global(.theme-option .theme-name) {
		color: var(--gray-12);
		font-size: var(--font-size-ui-text);
		font-weight: 620;
	}

	.setting-row :global(.mode-option small) {
		color: var(--gray-10);
		font-size: var(--font-size-ui-caption);
	}

	.setting-row :global(.theme-options) {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 6px;
	}

	.setting-row :global(.theme-option) {
		display: grid;
		min-width: 0;
		height: 42px;
		align-items: center;
		grid-template-columns: 24px minmax(0, 1fr) 15px;
		gap: 7px;
		border: 1px solid var(--gray-6);
		border-radius: 6px;
		background: var(--gray-1);
		padding: 0 8px;
		text-align: left;
		cursor: pointer;
	}

	.setting-row :global(.theme-option:hover),
	.setting-row :global(.theme-option[data-state='checked']) {
		border-color: var(--accent-7);
		background: var(--accent-2);
	}

	.setting-row :global(.theme-option .theme-swatch) {
		display: block;
		width: 20px;
		height: 20px;
		border: 1px solid var(--accent-7);
		border-radius: 50%;
		background: var(--accent-9);
		box-shadow: inset 0 0 0 4px var(--accent-3);
	}

	.setting-row :global(.theme-option > svg),
	.setting-row :global(.mode-option > svg) {
		color: var(--accent-11);
	}

	.setting-row :global(.control-options) {
		display: grid;
		gap: 6px;
	}

	.setting-row :global(.control-options .choice-option) {
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

	.setting-row :global(.control-options .choice-option:hover),
	.setting-row :global(.control-options .choice-option[data-state='checked']) {
		border-color: var(--accent-7);
		background: var(--accent-2);
	}

	@media (max-width: 820px) {
		.setting-row {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 560px) {
		.setting-row :global(.mode-options) {
			grid-template-columns: 1fr;
		}
	}
</style>
