import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { mcpConnectionFileEnvironment } from './connection-file'

const privateDirectoryMode = 0o700
const executableFileMode = 0o700
export const mcpStdioSwitch = '--open-knowledge-mcp-stdio'

export interface MCPStdioConfiguration {
	command: string
	args: string[]
	env: Record<string, string>
}

export async function installMCPStdioBridge(
	userDataPath: string,
	electronPath = process.execPath,
	applicationArguments: readonly string[] = [mcpStdioSwitch]
): Promise<MCPStdioConfiguration> {
	const mcpDirectory = path.join(userDataPath, 'mcp')
	const binDirectory = path.join(mcpDirectory, 'bin')
	await ensurePrivateDirectory(mcpDirectory)
	await ensurePrivateDirectory(binDirectory)

	const connectionFilePath = path.join(mcpDirectory, 'connection.json')
	const windows = process.platform === 'win32'
	const launcherPath = path.join(
		binDirectory,
		windows ? 'open-knowledge-mcp.cmd' : 'open-knowledge-mcp'
	)
	const launcher = windows
		? windowsLauncher(electronPath, applicationArguments, connectionFilePath)
		: unixLauncher(electronPath, applicationArguments, connectionFilePath)
	await writeFileAtomic(launcherPath, launcher, executableFileMode)
	return windows
		? {
				command: process.env.ComSpec ?? 'cmd.exe',
				args: ['/d', '/c', launcherPath],
				env: {}
			}
		: { command: launcherPath, args: [], env: {} }
}

export function fallbackMCPStdioConfiguration(
	userDataPath: string,
	electronPath = process.execPath,
	applicationArguments: readonly string[] = [mcpStdioSwitch]
): MCPStdioConfiguration {
	return {
		command: electronPath,
		args: [...applicationArguments],
		env: {
			[mcpConnectionFileEnvironment]: path.join(userDataPath, 'mcp', 'connection.json')
		}
	}
}

export function mcpApplicationArguments(
	defaultApplication: boolean,
	applicationPath: string
): string[] {
	return defaultApplication ? [applicationPath, mcpStdioSwitch] : [mcpStdioSwitch]
}

async function writeFileAtomic(
	filePath: string,
	content: string | Buffer,
	mode: number
): Promise<void> {
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`
	let handle: FileHandle | undefined
	let temporaryExists = false
	try {
		handle = await open(temporaryPath, 'wx', mode)
		temporaryExists = true
		await handle.writeFile(content)
		await handle.sync()
		await handle.close()
		handle = undefined
		await rename(temporaryPath, filePath)
		temporaryExists = false
		if (process.platform !== 'win32') {
			await chmod(filePath, mode)
		}
		await syncDirectory(path.dirname(filePath))
	} finally {
		if (handle) {
			await handle.close().catch(() => undefined)
		}
		if (temporaryExists) {
			await rm(temporaryPath, { force: true })
		}
	}
}

function unixLauncher(
	electronPath: string,
	applicationArguments: readonly string[],
	connectionFilePath: string
): string {
	const argumentsText = applicationArguments.map(shellQuote).join(' ')
	return `#!/bin/sh\nexport ${mcpConnectionFileEnvironment}=${shellQuote(connectionFilePath)}\nexec ${shellQuote(electronPath)}${argumentsText ? ` ${argumentsText}` : ''} "$@"\n`
}

function windowsLauncher(
	electronPath: string,
	applicationArguments: readonly string[],
	connectionFilePath: string
): string {
	const argumentsText = applicationArguments
		.map((argument) => `"${escapeBatchValue(argument)}"`)
		.join(' ')
	return `@echo off\r\nset "${mcpConnectionFileEnvironment}=${escapeBatchValue(connectionFilePath)}"\r\n"${escapeBatchValue(electronPath)}"${argumentsText ? ` ${argumentsText}` : ''} %*\r\n`
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`
}

function escapeBatchValue(value: string): string {
	return value.replaceAll('%', '%%').replaceAll('"', '""')
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true, mode: privateDirectoryMode })
	const stats = await lstat(directory)
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		throw new Error('The MCP application-data path is not a private directory.')
	}
	if (process.platform !== 'win32') {
		await chmod(directory, privateDirectoryMode)
	}
}

async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') {
		return
	}
	const handle = await open(directory, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}
