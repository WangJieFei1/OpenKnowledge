import {
	ApplicationSettingsSchema,
	SettingsSnapshotSchema,
	type ApplicationSettings,
	type ResetSettingsInput,
	type SettingsAPI,
	type UpdateSettingsInput
} from '../../src/lib/settings/api'
import { channels } from '../channels'
import { invoke, subscribe } from './transport'

export function createSettingsAPI(): SettingsAPI {
	return {
		get() {
			return invoke(channels.settingsGet, undefined, ApplicationSettingsSchema)
		},
		inspect() {
			return invoke(channels.settingsInspect, undefined, SettingsSnapshotSchema)
		},
		update(input: UpdateSettingsInput) {
			return invoke(channels.settingsUpdate, input, ApplicationSettingsSchema)
		},
		reset(input: ResetSettingsInput) {
			return invoke(channels.settingsReset, input, ApplicationSettingsSchema)
		},
		onChange(listener: (settings: ApplicationSettings) => void) {
			return subscribe(channels.settingsChange, ApplicationSettingsSchema, listener)
		}
	}
}
