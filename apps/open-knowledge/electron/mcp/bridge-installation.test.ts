import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mcpConnectionFileEnvironment } from './connection-file'
import {
	fallbackMCPStdioConfiguration,
	installMCPStdioBridge,
	mcpApplicationArguments,
	mcpStdioSwitch
} from './bridge-installation'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

describe('packaged MCP stdio bridge', () => {
	test('installs a stable launcher and refreshes it for the current Electron executable', async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), 'open-knowledge-bridge-'))
		temporaryDirectories.push(directory)
		const userDataPath = path.join(directory, 'user data')
		const firstElectronPath = path.join(directory, 'first Electron', 'electron')
		const secondElectronPath = path.join(directory, 'second Electron', 'electron')
		const applicationArguments = [path.join(directory, 'application path'), mcpStdioSwitch]
		const mcpDirectory = path.join(userDataPath, 'mcp')
		const binDirectory = path.join(mcpDirectory, 'bin')
		const launcherPath = path.join(
			binDirectory,
			process.platform === 'win32' ? 'open-knowledge-mcp.cmd' : 'open-knowledge-mcp'
		)

		const first = await installMCPStdioBridge(userDataPath, firstElectronPath, applicationArguments)
		expect(first).toEqual(
			process.platform === 'win32'
				? {
						command: process.env.ComSpec ?? 'cmd.exe',
						args: ['/d', '/c', launcherPath],
						env: {}
					}
				: { command: launcherPath, args: [], env: {} }
		)
		const firstLauncher = await readFile(launcherPath, 'utf8')
		expect(firstLauncher).toContain(firstElectronPath)
		expect(firstLauncher).toContain(applicationArguments[0]!)
		expect(firstLauncher).toContain(mcpStdioSwitch)
		expect(firstLauncher).toContain(mcpConnectionFileEnvironment)
		expect(firstLauncher).toContain(path.join(mcpDirectory, 'connection.json'))
		expect(firstLauncher).not.toContain('ELECTRON_RUN_AS_NODE')

		const second = await installMCPStdioBridge(
			userDataPath,
			secondElectronPath,
			applicationArguments
		)
		expect(second).toEqual(first)
		const secondLauncher = await readFile(launcherPath, 'utf8')
		expect(secondLauncher).not.toBe(firstLauncher)
		expect(secondLauncher).toContain(secondElectronPath)
		expect(secondLauncher).not.toContain(firstElectronPath)

		expect((await readdir(binDirectory)).some((name) => name.endsWith('.tmp'))).toBe(false)
		if (process.platform !== 'win32') {
			expect((await stat(mcpDirectory)).mode & 0o777).toBe(0o700)
			expect((await stat(binDirectory)).mode & 0o777).toBe(0o700)
			expect((await stat(launcherPath)).mode & 0o777).toBe(0o700)
		}
	})

	test('uses the packaged application entry point without Electron Node mode', () => {
		const userDataPath = path.join('/private', 'user data')
		const executablePath = path.join('/Applications', 'Open Knowledge.app', 'open-knowledge')
		expect(mcpApplicationArguments(false, '/ignored')).toEqual([mcpStdioSwitch])
		expect(mcpApplicationArguments(true, '/development/application')).toEqual([
			'/development/application',
			mcpStdioSwitch
		])
		expect(fallbackMCPStdioConfiguration(userDataPath, executablePath, [mcpStdioSwitch])).toEqual({
			command: executablePath,
			args: [mcpStdioSwitch],
			env: {
				[mcpConnectionFileEnvironment]: path.join(userDataPath, 'mcp', 'connection.json')
			}
		})
	})
})
