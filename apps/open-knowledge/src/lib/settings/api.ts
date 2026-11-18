import * as v from 'valibot'
import {
	ApplicationThemeModeSchema,
	ApplicationThemeSchema,
	defaultApplicationTheme,
	defaultApplicationThemeMode
} from '../theme/theme'
import { object } from '../validation'

export const applicationLanguages = ['en', 'zh-cn'] as const

export const ApplicationLanguageSchema = v.picklist(applicationLanguages)
export const EditorControlsSchema = v.picklist(['toolbar', 'slash', 'both'])
export const EditorFontFamilySchema = v.picklist(['book', 'sans', 'mono'])

const editorFontSizeSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(13), v.maxValue(24))
const sidebarWidthSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(220), v.maxValue(480))
const ApplicationSettingsEntries = {
	colorMode: v.optional(ApplicationThemeModeSchema, defaultApplicationThemeMode),
	colorTheme: v.optional(ApplicationThemeSchema, defaultApplicationTheme),
	editorControls: EditorControlsSchema,
	editorFontFamily: EditorFontFamilySchema,
	editorFontSize: editorFontSizeSchema,
	language: v.optional(ApplicationLanguageSchema, 'en'),
	resolveAbsolutePathsFromProjectRoot: v.optional(v.boolean(), true),
	showEditorModeControls: v.optional(v.boolean(), true),
	strictOpenKnowledgeFormat: v.optional(v.boolean(), false),
	sidebarVisible: v.boolean(),
	sidebarWidth: sidebarWidthSchema
}
const applicationSettingsObjectSchema = v.object(ApplicationSettingsEntries)
export const ApplicationSettingsSchema = object(ApplicationSettingsEntries)

export const UpdateApplicationSettingsInputSchema = object(
	v.partial(applicationSettingsObjectSchema).entries
)

export const ApplicationSettingKeySchema = v.keyof(applicationSettingsObjectSchema)
export const SettingsScopeSchema = v.picklist(['global', 'project'])
const WorkspaceIDSchema = v.pipe(v.string(), v.nonEmpty())
export const SettingsSnapshotSchema = object({
	workspaceID: v.nullable(WorkspaceIDSchema),
	localWorkspace: v.boolean(),
	global: UpdateApplicationSettingsInputSchema,
	project: UpdateApplicationSettingsInputSchema,
	resolved: ApplicationSettingsSchema
})
export const UpdateSettingsInputSchema = object({
	workspaceID: v.nullable(WorkspaceIDSchema),
	scope: SettingsScopeSchema,
	patch: UpdateApplicationSettingsInputSchema
})
export const ResetSettingsInputSchema = object({
	workspaceID: v.nullable(WorkspaceIDSchema),
	scope: SettingsScopeSchema,
	keys: v.pipe(v.array(ApplicationSettingKeySchema), v.minLength(1))
})

export type ApplicationLanguage = v.InferOutput<typeof ApplicationLanguageSchema>
export type ApplicationSettings = v.InferOutput<typeof ApplicationSettingsSchema>
export type UpdateApplicationSettingsInput = v.InferOutput<
	typeof UpdateApplicationSettingsInputSchema
>
export type ApplicationSettingKey = v.InferOutput<typeof ApplicationSettingKeySchema>
export type SettingsScope = v.InferOutput<typeof SettingsScopeSchema>
export type SettingsSnapshot = v.InferOutput<typeof SettingsSnapshotSchema>
export type UpdateSettingsInput = v.InferOutput<typeof UpdateSettingsInputSchema>
export type ResetSettingsInput = v.InferOutput<typeof ResetSettingsInputSchema>

export function selectApplicationLanguage(locales: readonly string[]): ApplicationLanguage {
	for (const locale of locales) {
		const normalizedLocale = locale.trim().toLowerCase().replaceAll('_', '-')
		const exactMatch = applicationLanguages.find((language) => language === normalizedLocale)
		if (exactMatch) {
			return exactMatch
		}
		const baseLanguage = normalizedLocale.split('-', 1)[0]
		const languageMatch = applicationLanguages.find(
			(language) => language.split('-', 1)[0] === baseLanguage
		)
		if (languageMatch) {
			return languageMatch
		}
	}
	return applicationLanguages[0]
}

export const defaultApplicationSettings: ApplicationSettings = {
	colorMode: defaultApplicationThemeMode,
	colorTheme: defaultApplicationTheme,
	editorControls: 'toolbar',
	editorFontFamily: 'book',
	editorFontSize: 16,
	language: 'en',
	resolveAbsolutePathsFromProjectRoot: true,
	showEditorModeControls: true,
	strictOpenKnowledgeFormat: false,
	sidebarVisible: true,
	sidebarWidth: 268
}

export interface SettingsAPI {
	get(): Promise<ApplicationSettings>
	inspect(): Promise<SettingsSnapshot>
	update(input: UpdateSettingsInput): Promise<ApplicationSettings>
	reset(input: ResetSettingsInput): Promise<ApplicationSettings>
	onChange(listener: (settings: ApplicationSettings) => void): () => void
}
