<script lang="ts">
	import { displayShortcut } from '#lib/components/app/application-command.js'
	import ToggleSwitch from '#lib/components/ui/ToggleSwitch.svelte'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import type {
		ApplicationSettings,
		SettingsScope,
		UpdateApplicationSettingsInput
	} from '#lib/settings/api.js'
	import { FolderRoot, PanelLeft, ShieldCheck } from 'lucide-svelte'
	import { settingsViewTranslation as t } from '../SettingsView.translation'
	import SettingsSection from './SettingsSection.svelte'

	type WorkspaceSettings = Pick<
		ApplicationSettings,
		'sidebarVisible' | 'resolveAbsolutePathsFromProjectRoot' | 'strictOpenKnowledgeFormat'
	>
	type Props = {
		settings: Readonly<WorkspaceSettings>
		scope: SettingsScope
		localWorkspace: boolean
		onupdate: (patch: UpdateApplicationSettingsInput) => void | Promise<void>
	}

	let { settings, scope, localWorkspace, onupdate }: Props = $props()
	const sidebarShortcut = displayShortcut('Mod+B', desktopAPI()?.nativeMenuBar ?? false)
</script>

<SettingsSection title={t.workspace} description={t.workspaceDescription}>
	{#snippet icon()}<PanelLeft size={17} />{/snippet}
	<div class="setting-row">
		<div>
			<strong>{t.showSidebar}</strong><span>{t.showSidebarDescription(sidebarShortcut)}</span>
		</div>
		<ToggleSwitch
			label={t.showSidebar}
			checked={settings.sidebarVisible}
			onCheckedChange={(sidebarVisible) => void onupdate({ sidebarVisible })}
		/>
	</div>
</SettingsSection>

{#if scope === 'project'}
	{#if localWorkspace}
		<SettingsSection title={t.linkPaths} description={t.linkPathsDescription}>
			{#snippet icon()}<FolderRoot size={17} />{/snippet}
			<div class="setting-row">
				<div>
					<strong>{t.resolveAbsolutePathsFromProjectRoot}</strong><span
						>{t.resolveAbsolutePathsFromProjectRootDescription}</span
					>
				</div>
				<ToggleSwitch
					label={t.resolveAbsolutePathsFromProjectRoot}
					checked={settings.resolveAbsolutePathsFromProjectRoot}
					onCheckedChange={(resolveAbsolutePathsFromProjectRoot) =>
						void onupdate({ resolveAbsolutePathsFromProjectRoot })}
				/>
			</div>
		</SettingsSection>
	{/if}

	<SettingsSection title={t.openKnowledgeFormat} description={t.openKnowledgeFormatDescription}>
		{#snippet icon()}<ShieldCheck size={17} />{/snippet}
		<div class="setting-row">
			<div>
				<strong>{t.strictOpenKnowledgeFormat}</strong><span
					>{t.strictOpenKnowledgeFormatDescription}</span
				>
			</div>
			<ToggleSwitch
				label={t.strictOpenKnowledgeFormat}
				checked={settings.strictOpenKnowledgeFormat}
				onCheckedChange={(strictOpenKnowledgeFormat) =>
					void onupdate({ strictOpenKnowledgeFormat })}
			/>
		</div>
	</SettingsSection>
{/if}

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

	.setting-row > div:first-child {
		display: grid;
		gap: 3px;
	}

	.setting-row strong {
		color: var(--gray-12);
		font-size: var(--font-size-ui-body);
		font-weight: 620;
	}

	.setting-row span {
		color: var(--gray-11);
		font-size: var(--font-size-ui-caption);
		line-height: 1.4;
	}
</style>
