#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
	StreamableHTTPClientTransport,
	isInitializeRequest,
	isJSONRPCRequest,
	isJSONRPCResultResponse,
	isSpecType,
	type JSONRPCMessage,
	type RequestId
} from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { nodeErrorCode } from '../validation'
import { mcpConnectionFileEnvironment, readMCPConnectionFile } from './connection-file'

const shutdownTimeoutMilliseconds = 1500
const primaryProcessCheckMilliseconds = 2000

class MCPStdioBridge {
	private readonly stdio = new StdioServerTransport()
	private readonly http: StreamableHTTPClientTransport
	private toHTTP = Promise.resolve()
	private toStdio = Promise.resolve()
	private initializeRequestID: RequestId | undefined
	private primaryProcessTimer: ReturnType<typeof setInterval> | undefined
	private closing = false
	private readonly completion = Promise.withResolvers<number>()

	constructor(
		private readonly primaryProcessID: number,
		endpoint: URL,
		token: string,
		instanceID: string
	) {
		this.http = new StreamableHTTPClientTransport(endpoint, {
			requestInit: {
				headers: { Authorization: `Bearer ${token}` },
				redirect: 'error'
			},
			fetch: async (url, init) => {
				const response = await fetch(url, { ...init, redirect: 'error' })
				if (response.headers.get('x-open-knowledge-instance-id') !== instanceID) {
					await response.body?.cancel()
					throw new Error('The MCP endpoint does not belong to this application instance.')
				}
				return response
			}
		})
	}

	async start(): Promise<number> {
		this.stdio.onmessage = (message) => {
			this.toHTTP = this.toHTTP
				.then(async () => {
					if (isJSONRPCRequest(message) && isInitializeRequest(message)) {
						this.initializeRequestID = message.id
					}
					await this.http.send(message)
				})
				.catch(() => this.fail())
		}
		this.http.onmessage = (message) => {
			this.toStdio = this.toStdio
				.then(async () => {
					this.captureProtocolVersion(message)
					await this.stdio.send(message)
				})
				.catch(() => this.fail())
		}
		this.stdio.onerror = () => this.fail()
		this.http.onerror = () => this.fail()
		this.stdio.onclose = () => {
			if (!this.closing) {
				void this.shutdown(0)
			}
		}
		this.http.onclose = () => {
			if (!this.closing) {
				this.fail()
			}
		}

		process.stdin.once('end', () => void this.shutdown(0))
		process.stdin.once('close', () => void this.shutdown(0))
		process.stdout.once('error', (error) => {
			void this.shutdown(nodeErrorCode(error) === 'EPIPE' ? 0 : 1)
		})
		process.once('SIGINT', () => void this.shutdown(130))
		process.once('SIGTERM', () => void this.shutdown(143))

		await this.http.start()
		await this.stdio.start()
		this.primaryProcessTimer = setInterval(() => {
			if (!processExists(this.primaryProcessID)) {
				this.fail()
			}
		}, primaryProcessCheckMilliseconds)
		return this.completion.promise
	}

	async shutdown(exitCode: number): Promise<void> {
		if (this.closing) {
			return
		}
		this.closing = true
		clearInterval(this.primaryProcessTimer)
		await withTimeout(this.http.terminateSession(), shutdownTimeoutMilliseconds)
		await Promise.allSettled([this.http.close(), this.stdio.close()])
		this.completion.resolve(exitCode)
	}

	private captureProtocolVersion(message: JSONRPCMessage): void {
		if (
			this.initializeRequestID === undefined ||
			!isJSONRPCResultResponse(message) ||
			message.id !== this.initializeRequestID
		) {
			return
		}
		if (!isSpecType.InitializeResult(message.result)) {
			throw new Error('The MCP server returned an invalid initialize result.')
		}
		this.http.setProtocolVersion(message.result.protocolVersion)
		this.initializeRequestID = undefined
	}

	private fail(): void {
		if (this.closing) {
			return
		}
		process.stderr.write(
			'Open Knowledge MCP connection failed. Ensure the desktop app is running and the shared connection includes at least one workspace.\n'
		)
		void this.shutdown(1)
	}
}

export async function runMCPStdioBridge(): Promise<number> {
	const connectionFilePath = process.env[mcpConnectionFileEnvironment]
	if (!connectionFilePath || !path.isAbsolute(connectionFilePath)) {
		throw new Error('The MCP connection file is not configured.')
	}
	const connection = await readMCPConnectionFile(connectionFilePath)
	if (!processExists(connection.pid)) {
		throw new Error('The Open Knowledge process is not running.')
	}
	const endpoint = new URL(`http://127.0.0.1:${connection.port}/mcp/${connection.profileID}`)
	const bridge = new MCPStdioBridge(
		connection.pid,
		endpoint,
		connection.token,
		connection.instanceID
	)
	return bridge.start()
}

async function withTimeout(operation: Promise<unknown>, milliseconds: number): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined
	await Promise.race([
		operation.then(() => undefined).catch(() => undefined),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, milliseconds)
		})
	])
	clearTimeout(timer)
}

function processExists(processID: number): boolean {
	try {
		process.kill(processID, 0)
		return true
	} catch (error) {
		return nodeErrorCode(error) === 'EPERM'
	}
}

function isDirectNodeEntry(moduleURL: string, entryPath: string | undefined): boolean {
	return Boolean(entryPath && pathToFileURL(path.resolve(entryPath)).href === moduleURL)
}

if (isDirectNodeEntry(import.meta.url, process.argv[1])) {
	void runMCPStdioBridge()
		.then((exitCode) => {
			process.exitCode = exitCode
		})
		.catch(() => {
			process.stderr.write(
				'Open Knowledge MCP could not start. Ensure the desktop app is running and the shared connection includes at least one workspace.\n'
			)
			process.exitCode = 1
		})
}
