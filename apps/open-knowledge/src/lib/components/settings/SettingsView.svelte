<script lang="ts">
	import MessageBanner from '#lib/components/app/MessageBanner.svelte'
	import {
		AppearanceSettingsSection,
		EditorSettingsSection,
		SettingsHeader,
		WorkspaceSettingsSections
	} from '#lib/components/settings/application/index.js'
	import type { SettingsAPI } from '#lib/settings/api.js'
	import { SettingsManagementSession } from '#lib/settings/settings-management-session.svelte.js'
	import { onMount, untrack } from 'svelte'
	import { settingsViewTranslation as t } from './SettingsView.translation'

	type Props = {
		api: SettingsAPI
	}
	let { api }: Props = $props()
	const session = new SettingsManagementSession(untrack(() => api))

	onMount(() => {
		void session.start()
		return () => {
			session.dispose()
		}
	})
</script>

<main class="settings-view">
	<SettingsHeader
		scope={session.scope}
		hasProject={session.snapshot.workspaceID !== null}
		overrideCount={session.overrideCount}
		onscopechange={(scope) => session.selectScope(scope)}
		onreset={() => session.resetScope()}
	/>

	<div class="settings-scroll" aria-busy={session.loading} inert={session.loading}>
		<AppearanceSettingsSection
			settings={session.settings}
			onupdate={(input) => session.update(input)}
		/>
		<EditorSettingsSection
			settings={session.settings}
			onupdate={(input) => session.update(input)}
		/>
		<WorkspaceSettingsSections
			settings={session.settings}
			scope={session.scope}
			localWorkspace={session.snapshot.localWorkspace}
			onupdate={(input) => session.update(input)}
		/>
	</div>
	{#if session.errorKey}
		<MessageBanner message={t[session.errorKey]} ondismiss={() => session.dismissError()} />
	{/if}
</main>

<style>
	.settings-view {
		display: grid;
		height: 100%;
		grid-template-rows: 68px minmax(0, 1fr);
		background: var(--gray-1);
	}

	.settings-scroll {
		overflow: auto;
		padding: 34px clamp(28px, 6vw, 84px) 90px;
	}

	@media (max-width: 560px) {
		.settings-view {
			grid-template-rows: auto minmax(0, 1fr);
		}

		.settings-scroll {
			padding: 26px 20px 72px;
		}
	}
</style>
