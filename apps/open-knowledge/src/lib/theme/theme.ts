import * as v from 'valibot'

export const applicationThemes = [
	'indigo',
	'blue',
	'cyan',
	'teal',
	'green',
	'grass',
	'orange',
	'red',
	'crimson',
	'pink',
	'purple',
	'violet'
] as const

export const applicationThemeModes = ['system', 'light', 'dark'] as const

export const ApplicationThemeSchema = v.picklist(applicationThemes)
export const ApplicationThemeModeSchema = v.picklist(applicationThemeModes)

export type ApplicationTheme = (typeof applicationThemes)[number]
export type ApplicationThemeMode = (typeof applicationThemeModes)[number]

export const defaultApplicationTheme: ApplicationTheme = 'indigo'
export const defaultApplicationThemeMode: ApplicationThemeMode = 'system'
export const applicationBackgroundColors = {
	light: '#f9f9f9',
	dark: '#191919'
} as const

export function isApplicationTheme(value: unknown): value is ApplicationTheme {
	return v.is(ApplicationThemeSchema, value)
}

export function isApplicationThemeMode(value: unknown): value is ApplicationThemeMode {
	return v.is(ApplicationThemeModeSchema, value)
}

export function applicationThemeLabel(theme: ApplicationTheme): string {
	return `${theme.charAt(0).toUpperCase()}${theme.slice(1)}`
}
