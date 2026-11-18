<script lang="ts">
	import './layout.css'
	import '#lib/components/ui/ui.css'
	import favicon from '#lib/assets/favicon.svg'
	import { i18nState } from '#lib/i18n/index.js'
	import { desktopAPI } from '#lib/knowledge/client.js'
	import {
		defaultApplicationSettings,
		selectApplicationLanguage,
		type ApplicationSettings
	} from '#lib/settings/api.js'
	import { applicationBackgroundColors } from '#lib/theme/theme.js'
	import { Tooltip } from 'bits-ui'
	import { onMount, tick } from 'svelte'

	let { children } = $props()

	$effect(() => {
		document.documentElement.lang = i18nState.current
	})

	onMount(() => {
		document.documentElement.dataset.platform = desktopAPI()?.nativeMenuBar ? 'macos' : 'other'
		let disposed = false
		let settingsChanged = false
		let currentSettings: ApplicationSettings | undefined
		let unsubscribeSettings: (() => void) | undefined
		let mountedFrame = 0
		let paintedFrame = 0
		const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

		function applySettings(settings: ApplicationSettings): void {
			currentSettings = settings
			i18nState.apply(settings.language)
			const dark =
				settings.colorMode === 'dark' || (settings.colorMode === 'system' && systemTheme.matches)
			const root = document.documentElement
			root.classList.toggle('dark', dark)
			root.dataset.theme = settings.colorTheme
			root.style.colorScheme = dark ? 'dark' : 'light'
			document
				.querySelector('meta[name="theme-color"]')
				?.setAttribute(
					'content',
					dark ? applicationBackgroundColors.dark : applicationBackgroundColors.light
				)
		}

		function systemThemeChanged(): void {
			if (currentSettings?.colorMode === 'system') {
				applySettings(currentSettings)
			}
		}
		systemTheme.addEventListener('change', systemThemeChanged)

		async function initialize(): Promise<void> {
			const api = desktopAPI()
			const fallbackSettings: ApplicationSettings = {
				...defaultApplicationSettings,
				language: selectApplicationLanguage(
					navigator.languages.length > 0 ? navigator.languages : [navigator.language]
				)
			}
			try {
				if (api) {
					unsubscribeSettings = api.settings.onChange((settings) => {
						if (!disposed) {
							settingsChanged = true
							applySettings(settings)
						}
					})
					const settings = await api.settings.get()
					if (!disposed && !settingsChanged) {
						applySettings(settings)
					}
				} else if (!disposed && !settingsChanged) {
					applySettings(fallbackSettings)
				}
			} catch {
				if (!disposed && !settingsChanged) {
					applySettings(fallbackSettings)
				}
			}

			if (disposed) {
				return
			}
			await tick()
			if (disposed) {
				return
			}
			mountedFrame = requestAnimationFrame(() => {
				paintedFrame = requestAnimationFrame(() => {
					if (!disposed) {
						void api?.window.rendererReady()
					}
				})
			})
		}

		void initialize()
		return () => {
			disposed = true
			unsubscribeSettings?.()
			systemTheme.removeEventListener('change', systemThemeChanged)
			cancelAnimationFrame(mountedFrame)
			cancelAnimationFrame(paintedFrame)
		}
	})
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content={applicationBackgroundColors.light} />
</svelte:head>
<Tooltip.Provider delayDuration={450} skipDelayDuration={250} disableHoverableContent>
	{@render children()}
</Tooltip.Provider>
