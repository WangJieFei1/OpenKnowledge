import { unwatchFile, watchFile } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import {
	defaultApplicationSettings,
	UpdateApplicationSettingsInputSchema,
	type ApplicationLanguage,
	type ApplicationSettings,
	type ResetSettingsInput,
	type SettingsScope,
	type SettingsSnapshot,
	type UpdateApplicationSettingsInput,
	type UpdateSettingsInput
} from '../../src/lib/settings/api'
import { object, PlainRecordSchema } from '../validation'
import { JSONCFile } from './jsonc-file'

export interface SettingsChange {
	scope: SettingsScope
	workspaceID: string | null
}

type SettingsListener = (change: SettingsChange) => void
type WorkspaceRoot = (workspaceID: string) => string | null
type WorkspaceRootIdentity = (workspaceID: string) => string | null

interface ProjectSettings {
	file: JSONCFile<UpdateApplicationSettingsInput>
	values: UpdateApplicationSettingsInput
}

const LocalProjectSettingsSchema = object({
	rootIdentity: v.pipe(v.string(), v.minLength(1)),
	resolveAbsolutePathsFromProjectRoot: v.optional(v.boolean())
})
const LocalWorkspaceSettingsSchema = v.pipe(
	PlainRecordSchema,
	v.record(v.string(), LocalProjectSettingsSchema)
)
type LocalProjectSettings = v.InferOutput<typeof LocalProjectSettingsSchema>
type LocalWorkspaceSettings = v.InferOutput<typeof LocalWorkspaceSettingsSchema>

export class SettingsService {
	private readonly globalFile: JSONCFile<UpdateApplicationSettingsInput>
	private readonly localWorkspaceFile: JSONCFile<LocalWorkspaceSettings>
	private readonly remoteProjectDirectory: string
	private global: UpdateApplicationSettingsInput = {}
	private localWorkspaces: LocalWorkspaceSettings = {}
	private readonly projects = new Map<string, ProjectSettings>()
	private readonly watchedPaths = new Set<string>()
	private readonly listeners = new Set<SettingsListener>()
	private operationTail = Promise.resolve()
	private initialLanguage: ApplicationLanguage = defaultApplicationSettings.language

	constructor(
		globalSettingsPath: string,
		private readonly workspaceRoot: WorkspaceRoot,
		private readonly workspaceRootIdentity: WorkspaceRootIdentity = () => null,
		localWorkspaceSettingsPath = path.join(
			path.dirname(globalSettingsPath),
			'workspace-settings.json'
		)
	) {
		this.globalFile = settingsFile(globalSettingsPath)
		this.remoteProjectDirectory = path.join(
			path.dirname(globalSettingsPath),
			'remote-workspace-settings'
		)
		this.localWorkspaceFile = new JSONCFile(localWorkspaceSettingsPath, {
			fileMode: 0o600,
			directoryMode: 0o700,
			normalize: (value) => v.parse(LocalWorkspaceSettingsSchema, value)
		})
	}

	async initialize(initialLanguage?: ApplicationLanguage): Promise<void> {
		if (initialLanguage) {
			this.initialLanguage = initialLanguage
		}
		let globalLoaded = false
		try {
			this.global = await this.globalFile.load()
			globalLoaded = true
		} catch (error) {
			console.error(`Settings could not be loaded from ${this.globalFile.filePath}.`, error)
		}
		if (globalLoaded && initialLanguage && this.global.language === undefined) {
			try {
				this.global = await this.globalFile.update({ language: initialLanguage })
			} catch (error) {
				console.error(`Initial language could not be saved to ${this.globalFile.filePath}.`, error)
			}
		}
		try {
			this.localWorkspaces = await this.localWorkspaceFile.load()
		} catch (error) {
			console.error(`Settings could not be loaded from ${this.localWorkspaceFile.filePath}.`, error)
		}
		this.watch(this.globalFile.filePath, null)
	}

	async get(workspaceID: string | null): Promise<ApplicationSettings> {
		return (await this.inspect(workspaceID)).resolved
	}

	async inspect(workspaceID: string | null): Promise<SettingsSnapshot> {
		const localWorkspace = workspaceID !== null && this.workspaceRoot(workspaceID) !== null
		const project = workspaceID ? await this.project(workspaceID) : null
		const global = globalSettings(this.global)
		const local = workspaceID && localWorkspace ? this.localProjectSettings(workspaceID) : {}
		const projectValues = {
			...(project?.values ?? {}),
			...local
		}
		const resolved: ApplicationSettings = {
			...defaultApplicationSettings,
			language: this.initialLanguage,
			...global,
			...projectValues,
			...(workspaceID && !localWorkspace ? { resolveAbsolutePathsFromProjectRoot: true } : {})
		}
		return {
			workspaceID,
			localWorkspace,
			global,
			project: projectValues,
			resolved
		}
	}

	update(workspaceID: string | null, input: UpdateSettingsInput): Promise<ApplicationSettings> {
		this.assertWorkspaceContext(workspaceID, input.workspaceID)
		assertProjectOnlySettings(input.scope, Object.keys(input.patch))
		return this.enqueue(async () => {
			if (input.scope === 'global') {
				const target = await this.target(workspaceID, input.scope)
				if (samePatch(target.values, input.patch)) {
					return (await this.inspect(workspaceID)).resolved
				}
				const values = await target.file.update(input.patch)
				await this.commitTarget(workspaceID, input.scope, values)
				this.emit({ scope: input.scope, workspaceID: null })
				return (await this.inspect(workspaceID)).resolved
			}
			if (!workspaceID) {
				throw new Error('Project settings require a workspace window.')
			}
			const project = await this.project(workspaceID)
			const sharedPatch = sharedProjectSettings(input.patch)
			const updatesLocal = Object.hasOwn(input.patch, 'resolveAbsolutePathsFromProjectRoot')
			const rootIdentity = updatesLocal ? this.workspaceRootIdentity(workspaceID) : null
			if (updatesLocal && !rootIdentity) {
				throw new Error('The workspace root must be authorized before changing this setting.')
			}
			let changed = false
			if (Object.keys(sharedPatch).length > 0 && !samePatch(project.values, sharedPatch)) {
				project.values = sharedProjectSettings(await project.file.update(sharedPatch))
				changed = true
			}
			const localValue = input.patch.resolveAbsolutePathsFromProjectRoot
			if (
				updatesLocal &&
				rootIdentity &&
				localValue !== undefined &&
				this.localProjectSettings(workspaceID).resolveAbsolutePathsFromProjectRoot !== localValue
			) {
				await this.setLocalProjectSettings(workspaceID, {
					rootIdentity,
					resolveAbsolutePathsFromProjectRoot: localValue
				})
				changed = true
			}
			if (!changed) {
				return (await this.inspect(workspaceID)).resolved
			}
			this.emit({ scope: 'project', workspaceID })
			return (await this.inspect(workspaceID)).resolved
		})
	}

	reset(workspaceID: string | null, input: ResetSettingsInput): Promise<ApplicationSettings> {
		this.assertWorkspaceContext(workspaceID, input.workspaceID)
		assertProjectOnlySettings(input.scope, input.keys)
		return this.enqueue(async () => {
			if (input.scope === 'global') {
				const target = await this.target(workspaceID, input.scope)
				const keys = input.keys.filter((key) => Object.hasOwn(target.values, key))
				if (keys.length === 0) {
					return (await this.inspect(workspaceID)).resolved
				}
				const values = await target.file.update({}, keys)
				await this.commitTarget(workspaceID, input.scope, values)
				this.emit({ scope: input.scope, workspaceID: null })
				return (await this.inspect(workspaceID)).resolved
			}
			if (!workspaceID) {
				throw new Error('Project settings require a workspace window.')
			}
			const project = await this.project(workspaceID)
			const sharedKeys = input.keys.filter(
				(key) => key !== 'resolveAbsolutePathsFromProjectRoot' && Object.hasOwn(project.values, key)
			)
			const resetLocal =
				input.keys.includes('resolveAbsolutePathsFromProjectRoot') &&
				this.localProjectSettings(workspaceID).resolveAbsolutePathsFromProjectRoot !== undefined
			if (sharedKeys.length === 0 && !resetLocal) {
				return (await this.inspect(workspaceID)).resolved
			}
			if (sharedKeys.length > 0) {
				project.values = sharedProjectSettings(await project.file.update({}, sharedKeys))
			}
			if (resetLocal) {
				await this.setLocalProjectSettings(workspaceID, null)
			}
			this.emit({ scope: 'project', workspaceID })
			return (await this.inspect(workspaceID)).resolved
		})
	}

	subscribe(listener: SettingsListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	close(): void {
		for (const filePath of this.watchedPaths) {
			unwatchFile(filePath)
		}
		this.watchedPaths.clear()
		this.listeners.clear()
	}

	forgetWorkspace(workspaceID: string): Promise<void> {
		return this.enqueue(async () => {
			const project = this.projects.get(workspaceID)
			if (project) {
				unwatchFile(project.file.filePath)
				this.watchedPaths.delete(project.file.filePath)
				this.projects.delete(workspaceID)
			}
			if (this.localWorkspaces[workspaceID]) {
				this.localWorkspaces = await this.localWorkspaceFile.delete(workspaceID)
			}
			this.emit({ scope: 'project', workspaceID })
		})
	}

	private assertWorkspaceContext(actual: string | null, expected: string | null): void {
		if (actual !== expected) {
			throw new Error('The settings window changed workspace context.')
		}
	}

	private async target(
		workspaceID: string | null,
		scope: SettingsScope
	): Promise<{
		file: JSONCFile<UpdateApplicationSettingsInput>
		values: UpdateApplicationSettingsInput
	}> {
		if (scope === 'global') {
			return { file: this.globalFile, values: this.global }
		}
		if (!workspaceID) {
			throw new Error('Project settings require a workspace window.')
		}
		return this.project(workspaceID)
	}

	private async commitTarget(
		workspaceID: string | null,
		scope: SettingsScope,
		values: UpdateApplicationSettingsInput
	): Promise<void> {
		if (scope === 'global') {
			this.global = values
			return
		}
		if (!workspaceID) {
			throw new Error('Project settings require a workspace window.')
		}
		const project = await this.project(workspaceID)
		project.values = sharedProjectSettings(values)
	}

	private async project(workspaceID: string): Promise<ProjectSettings> {
		const existing = this.projects.get(workspaceID)
		if (existing) {
			return existing
		}
		const rootPath = this.workspaceRoot(workspaceID)
		const file = rootPath
			? settingsFile(path.join(rootPath, '.open-knowledge', 'settings.json'), true)
			: settingsFile(
					path.join(this.remoteProjectDirectory, `${encodeURIComponent(workspaceID)}.json`)
				)
		let values: UpdateApplicationSettingsInput = {}
		try {
			values = sharedProjectSettings(await file.load())
		} catch (error) {
			console.error(`Settings could not be loaded from ${file.filePath}.`, error)
		}
		const project = { file, values }
		this.projects.set(workspaceID, project)
		this.watch(file.filePath, workspaceID)
		return project
	}

	private async setLocalProjectSettings(
		workspaceID: string,
		settings: LocalProjectSettings | null
	): Promise<void> {
		this.localWorkspaces =
			settings === null
				? await this.localWorkspaceFile.delete(workspaceID)
				: await this.localWorkspaceFile.set(workspaceID, settings)
	}

	private localProjectSettings(workspaceID: string): UpdateApplicationSettingsInput {
		const local = this.localWorkspaces[workspaceID]
		return local &&
			local.rootIdentity === this.workspaceRootIdentity(workspaceID) &&
			local.resolveAbsolutePathsFromProjectRoot !== undefined
			? { resolveAbsolutePathsFromProjectRoot: local.resolveAbsolutePathsFromProjectRoot }
			: {}
	}

	private watch(filePath: string, workspaceID: string | null): void {
		if (this.watchedPaths.has(filePath)) {
			return
		}
		this.watchedPaths.add(filePath)
		watchFile(filePath, { interval: 500, persistent: false }, () => {
			void this.reload(filePath, workspaceID)
		})
	}

	private reload(filePath: string, workspaceID: string | null): Promise<void> {
		return this.enqueue(async () => {
			try {
				const target =
					workspaceID === null
						? { file: this.globalFile, values: this.global }
						: await this.project(workspaceID)
				const loaded = await target.file.load()
				const values = workspaceID === null ? loaded : sharedProjectSettings(loaded)
				if (sameSettings(target.values, values)) {
					return
				}
				if (workspaceID === null) {
					this.global = values
				} else {
					target.values = values
				}
				this.emit({ scope: workspaceID === null ? 'global' : 'project', workspaceID })
			} catch (error) {
				console.error(`Settings could not be reloaded from ${filePath}.`, error)
			}
		})
	}

	private emit(change: SettingsChange): void {
		for (const listener of this.listeners) {
			try {
				listener(change)
			} catch (error) {
				console.error('A settings listener failed.', error)
			}
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationTail.then(operation)
		this.operationTail = result.then(
			() => undefined,
			() => undefined
		)
		return result
	}
}

function settingsFile(filePath: string, shared = false): JSONCFile<UpdateApplicationSettingsInput> {
	return new JSONCFile(filePath, {
		fileMode: shared ? 0o644 : 0o600,
		directoryMode: shared ? 0o755 : 0o700,
		normalize: (value) => v.parse(UpdateApplicationSettingsInputSchema, value)
	})
}

function samePatch(
	settings: UpdateApplicationSettingsInput,
	patch: UpdateApplicationSettingsInput
): boolean {
	return Object.entries(patch).every(
		([key, value]) => settings[key as keyof UpdateApplicationSettingsInput] === value
	)
}

function sameSettings(
	left: UpdateApplicationSettingsInput,
	right: UpdateApplicationSettingsInput
): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function globalSettings(settings: UpdateApplicationSettingsInput): UpdateApplicationSettingsInput {
	const global = { ...settings }
	delete global.resolveAbsolutePathsFromProjectRoot
	return global
}

function sharedProjectSettings(
	settings: UpdateApplicationSettingsInput
): UpdateApplicationSettingsInput {
	const shared = { ...settings }
	delete shared.resolveAbsolutePathsFromProjectRoot
	return shared
}

function assertProjectOnlySettings(scope: SettingsScope, keys: readonly string[]): void {
	if (scope === 'global' && keys.includes('resolveAbsolutePathsFromProjectRoot')) {
		throw new Error('Absolute path resolution is a project-only setting.')
	}
}
