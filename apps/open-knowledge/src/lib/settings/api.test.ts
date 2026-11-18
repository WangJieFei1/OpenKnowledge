import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'
import {
	ApplicationSettingsSchema,
	defaultApplicationSettings,
	selectApplicationLanguage,
	UpdateApplicationSettingsInputSchema
} from './api'

describe('application settings schemas', () => {
	test('defaults settings missing from legacy data', () => {
		const legacySettings = {
			editorControls: defaultApplicationSettings.editorControls,
			editorFontFamily: defaultApplicationSettings.editorFontFamily,
			editorFontSize: defaultApplicationSettings.editorFontSize,
			sidebarVisible: defaultApplicationSettings.sidebarVisible,
			sidebarWidth: defaultApplicationSettings.sidebarWidth
		}

		expect(v.parse(ApplicationSettingsSchema, legacySettings)).toMatchObject({
			colorMode: 'system',
			colorTheme: 'indigo',
			language: 'en',
			resolveAbsolutePathsFromProjectRoot: true,
			showEditorModeControls: true,
			strictOpenKnowledgeFormat: false
		})
	})

	test('does not inject defaults into partial updates', () => {
		expect(
			v.parse(UpdateApplicationSettingsInputSchema, {
				colorTheme: 'violet',
				language: 'zh-cn',
				sidebarVisible: false
			})
		).toEqual({
			colorTheme: 'violet',
			language: 'zh-cn',
			sidebarVisible: false
		})
	})

	test('rejects array-shaped partial updates', () => {
		expect(
			v.safeParse(
				UpdateApplicationSettingsInputSchema,
				Object.assign([], { sidebarVisible: false })
			).success
		).toBe(false)
	})
})

describe('selectApplicationLanguage', () => {
	test('chooses the first supported browser or system language', () => {
		expect(selectApplicationLanguage(['fr-FR', 'zh-Hans-CN', 'en-US'])).toBe('zh-cn')
		expect(selectApplicationLanguage(['en-GB', 'zh-CN'])).toBe('en')
	})

	test('falls back to English when no locale is supported', () => {
		expect(selectApplicationLanguage(['fr-FR', 'de-DE'])).toBe('en')
	})
})
