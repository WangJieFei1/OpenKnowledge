import { desktopAPI } from '../../knowledge/client'

export const applicationCommandGroups = ['File', 'Edit', 'View', 'MCP', 'Help', 'Open'] as const

export type ApplicationCommandGroup = (typeof applicationCommandGroups)[number]

export interface ApplicationCommand {
	id: string
	label: string
	group: ApplicationCommandGroup
	keywords?: string[]
	shortcut?: string
	disabled?: boolean
	checked?: boolean
	paletteOnly?: boolean
	separatorBefore?: boolean
	run: () => unknown | Promise<unknown>
}

export function displayShortcut(
	shortcut: string,
	macOS = typeof window !== 'undefined' && Boolean(desktopAPI()?.nativeMenuBar)
): string {
	const keys = shortcut.split('+')
	if (macOS) {
		const modifiers: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' }
		const keySymbols: Record<string, string> = {
			Tab: '⇥',
			Enter: '↩',
			Escape: '⎋',
			Backspace: '⌫',
			Delete: '⌦'
		}
		return (
			Object.keys(modifiers)
				.filter((key) => keys.includes(key))
				.map((key) => modifiers[key])
				.join('') +
			keys
				.filter((key) => !(key in modifiers))
				.map((key) => keySymbols[key] ?? key)
				.join('')
		)
	}
	return keys.map((key) => (key === 'Mod' ? 'Ctrl' : key)).join('+')
}
