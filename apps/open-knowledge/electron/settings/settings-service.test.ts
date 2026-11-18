import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultApplicationSettings } from '../../src/lib/settings/api'
import { SettingsService } from './settings-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

async function setup(): Promise<{
	service: SettingsService
	globalPath: string
	localPath: string
	projectPath: string
}> {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-settings-'))
	temporaryDirectories.push(directory)
	const workspaceRoot = path.join(directory, 'workspace')
	await mkdir(workspaceRoot)
	const globalPath = path.join(directory, 'user-data', 'settings.json')
	const localPath = path.join(directory, 'user-data', 'workspace-settings.json')
	const projectPath = path.join(workspaceRoot, '.open-knowledge', 'settings.json')
	const service = new SettingsService(
		globalPath,
		(workspaceID) => (workspaceID === 'workspace-one' ? workspaceRoot : null),
		(workspaceID) => (workspaceID === 'workspace-one' ? '42:1001:2002' : null)
	)
	await service.initialize()
	return { service, globalPath, localPath, projectPath }
}

describe('SettingsService', () => {
	test('resolves defaults, global settings, and project overrides', async () => {
		const { service } = await setup()
		await service.update(null, {
			workspaceID: null,
			scope: 'global',
			patch: { editorFontSize: 18, colorTheme: 'blue' }
		})
		await service.update('workspace-one', {
			workspaceID: 'workspace-one',
			scope: 'project',
			patch: { editorFontSize: 20 }
		})

		const global = await service.inspect(null)
		expect(global.project).toEqual({})
		expect(global.resolved).toMatchObject({ editorFontSize: 18, colorTheme: 'blue' })

		const project = await service.inspect('workspace-one')
		expect(project.global).toEqual({ editorFontSize: 18, colorTheme: 'blue' })
		expect(project.project).toEqual({ editorFontSize: 20 })
		expect(project.resolved).toMatchObject({ editorFontSize: 20, colorTheme: 'blue' })
		service.close()
	})

	test('does not create a project file until a project setting changes', async () => {
		const { service, projectPath } = await setup()
		await service.inspect('workspace-one')
		await expect(stat(projectPath)).rejects.toThrow()

		await service.update('workspace-one', {
			workspaceID: 'workspace-one',
			scope: 'project',
			patch: { sidebarVisible: false }
		})
		expect(await readFile(projectPath, 'utf8')).toContain('"sidebarVisible": false')
		if (process.platform !== 'win32') {
			expect((await stat(projectPath)).mode & 0o777).toBe(0o644)
			expect((await stat(path.dirname(projectPath))).mode & 0o777).toBe(0o755)
		}
		service.close()
	})

	test('stores remote workspace preferences locally and disables system paths', async () => {
		const { service, globalPath } = await setup()
		const workspaceID = 'remote-workspace'
		const initial = await service.inspect(workspaceID)
		expect(initial.localWorkspace).toBe(false)
		expect(initial.project.resolveAbsolutePathsFromProjectRoot).toBeUndefined()
		expect(initial.resolved.resolveAbsolutePathsFromProjectRoot).toBe(true)

		await service.update(workspaceID, {
			workspaceID,
			scope: 'project',
			patch: { sidebarVisible: false }
		})
		expect((await service.get(workspaceID)).sidebarVisible).toBe(false)
		const remotePath = path.join(
			path.dirname(globalPath),
			'remote-workspace-settings',
			`${workspaceID}.json`
		)
		expect(await readFile(remotePath, 'utf8')).toContain('"sidebarVisible": false')
		if (process.platform !== 'win32') {
			expect((await stat(remotePath)).mode & 0o777).toBe(0o600)
		}
		service.close()
	})

	test('keeps system absolute-path resolution opt-in and project-only', async () => {
		const { service, localPath, projectPath } = await setup()
		expect((await service.get('workspace-one')).resolveAbsolutePathsFromProjectRoot).toBe(true)

		expect(() =>
			service.update(null, {
				workspaceID: null,
				scope: 'global',
				patch: { resolveAbsolutePathsFromProjectRoot: false }
			})
		).toThrow('project-only')
		await service.update('workspace-one', {
			workspaceID: 'workspace-one',
			scope: 'project',
			patch: { resolveAbsolutePathsFromProjectRoot: false }
		})
		expect((await service.get('workspace-one')).resolveAbsolutePathsFromProjectRoot).toBe(false)
		await expect(stat(projectPath)).rejects.toThrow()
		expect(await readFile(localPath, 'utf8')).toContain(
			'"resolveAbsolutePathsFromProjectRoot": false'
		)
		if (process.platform !== 'win32') {
			expect((await stat(localPath)).mode & 0o777).toBe(0o600)
		}

		const reset = await service.reset('workspace-one', {
			workspaceID: 'workspace-one',
			scope: 'project',
			keys: ['resolveAbsolutePathsFromProjectRoot']
		})
		expect(reset.resolveAbsolutePathsFromProjectRoot).toBe(true)
		expect(await readFile(localPath, 'utf8')).not.toContain('workspace-one')
		service.close()
	})

	test('ignores unsafe path-resolution settings supplied by project content', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-settings-'))
		temporaryDirectories.push(directory)
		const workspaceRoot = path.join(directory, 'workspace')
		const projectPath = path.join(workspaceRoot, '.open-knowledge', 'settings.json')
		await mkdir(path.dirname(projectPath), { recursive: true })
		await writeFile(projectPath, '{ "resolveAbsolutePathsFromProjectRoot": false }\n')
		const service = new SettingsService(path.join(directory, 'user-data', 'settings.json'), (id) =>
			id === 'workspace-one' ? workspaceRoot : null
		)
		await service.initialize()

		const snapshot = await service.inspect('workspace-one')
		expect(snapshot.resolved.resolveAbsolutePathsFromProjectRoot).toBe(true)
		expect(snapshot.project.resolveAbsolutePathsFromProjectRoot).toBeUndefined()
		service.close()
	})

	test('revokes local path access and cached project settings when a workspace is reauthorized', async () => {
		const { service, localPath } = await setup()
		await service.update('workspace-one', {
			workspaceID: 'workspace-one',
			scope: 'project',
			patch: { resolveAbsolutePathsFromProjectRoot: false }
		})
		await service.forgetWorkspace('workspace-one')
		expect((await service.get('workspace-one')).resolveAbsolutePathsFromProjectRoot).toBe(true)
		expect(await readFile(localPath, 'utf8')).not.toContain('workspace-one')
		service.close()
	})

	test('ignores a local path opt-in issued for a different root identity', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-settings-'))
		temporaryDirectories.push(directory)
		const workspaceRoot = path.join(directory, 'workspace')
		const globalPath = path.join(directory, 'user-data', 'settings.json')
		const localPath = path.join(directory, 'user-data', 'workspace-settings.json')
		await mkdir(workspaceRoot)
		await mkdir(path.dirname(localPath), { recursive: true })
		await writeFile(
			localPath,
			JSON.stringify({
				'workspace-one': {
					rootIdentity: 'old-root',
					resolveAbsolutePathsFromProjectRoot: false
				}
			})
		)
		const service = new SettingsService(
			globalPath,
			(id) => (id === 'workspace-one' ? workspaceRoot : null),
			(id) => (id === 'workspace-one' ? 'new-root' : null),
			localPath
		)
		await service.initialize()

		expect((await service.get('workspace-one')).resolveAbsolutePathsFromProjectRoot).toBe(true)
		service.close()
	})

	test('rejects a mutation queued for a different window context', async () => {
		const { service } = await setup()
		expect(() =>
			service.update('workspace-one', {
				workspaceID: 'workspace-two',
				scope: 'project',
				patch: { sidebarVisible: false }
			})
		).toThrow('changed workspace context')
		service.close()
	})

	test('reset removes the scoped key and restores inheritance', async () => {
		const { service, projectPath } = await setup()
		await service.update(null, {
			workspaceID: null,
			scope: 'global',
			patch: { editorFontSize: 18 }
		})
		await service.update('workspace-one', {
			workspaceID: 'workspace-one',
			scope: 'project',
			patch: { editorFontSize: 22, editorFontFamily: 'mono' }
		})

		const resolved = await service.reset('workspace-one', {
			workspaceID: 'workspace-one',
			scope: 'project',
			keys: ['editorFontSize']
		})
		expect(resolved.editorFontSize).toBe(18)
		expect(resolved.editorFontFamily).toBe('mono')
		expect(await readFile(projectPath, 'utf8')).not.toContain('editorFontSize')
		service.close()
	})

	test('reloads externally edited settings and reports their scope', async () => {
		const { service, globalPath } = await setup()
		const changed = new Promise<{ scope: string; workspaceID: string | null }>(
			(resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Settings watch timed out.')), 5_000)
				service.subscribe((change) => {
					clearTimeout(timeout)
					resolve(change)
				})
			}
		)
		await mkdir(path.dirname(globalPath), { recursive: true })
		await writeFile(globalPath, '{ "editorFontSize": 21 }\n')

		await expect(changed).resolves.toEqual({ scope: 'global', workspaceID: null })
		expect((await service.get('workspace-one')).editorFontSize).toBe(21)
		service.close()
	})

	test('keeps the application usable without overwriting malformed settings', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-settings-'))
		temporaryDirectories.push(directory)
		const globalPath = path.join(directory, 'settings.json')
		const malformed = '{ "editorFontSize": }\n'
		await writeFile(globalPath, malformed)
		const service = new SettingsService(globalPath, () => null)
		const originalConsoleError = console.error
		console.error = () => undefined
		try {
			await service.initialize()
			expect(await service.get(null)).toEqual(defaultApplicationSettings)
			await expect(
				service.update(null, {
					workspaceID: null,
					scope: 'global',
					patch: { editorFontSize: 20 }
				})
			).rejects.toBeInstanceOf(SyntaxError)
			expect(await readFile(globalPath, 'utf8')).toBe(malformed)
		} finally {
			console.error = originalConsoleError
			service.close()
		}
	})

	test('saves the system language only when no language choice exists', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-settings-'))
		temporaryDirectories.push(directory)
		const globalPath = path.join(directory, 'settings.json')
		const firstRun = new SettingsService(globalPath, () => null)
		await firstRun.initialize('zh-cn')
		expect((await firstRun.get(null)).language).toBe('zh-cn')
		expect(await readFile(globalPath, 'utf8')).toContain('"language": "zh-cn"')
		firstRun.close()

		const restarted = new SettingsService(globalPath, () => null)
		await restarted.initialize('en')
		expect((await restarted.get(null)).language).toBe('zh-cn')
		restarted.close()
	})
})
