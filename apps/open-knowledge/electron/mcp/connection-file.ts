import { lstat, readFile } from 'node:fs/promises'
import * as v from 'valibot'
import { object, UUIDSchema } from '../validation'

export const mcpConnectionFileEnvironment = 'OPEN_KNOWLEDGE_MCP_CONNECTION_FILE'

export const MCPConnectionTokenSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/))

export const MCPConnectionFileSchema = object({
	version: v.literal(1),
	pid: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
	instanceID: UUIDSchema,
	profileID: UUIDSchema,
	port: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(65_535)),
	token: MCPConnectionTokenSchema
})

export type MCPConnectionFile = v.InferOutput<typeof MCPConnectionFileSchema>

export async function readMCPConnectionFile(filePath: string): Promise<MCPConnectionFile> {
	const stats = await lstat(filePath)
	if (!stats.isFile() || stats.isSymbolicLink()) {
		throw new Error('The MCP connection file is not a regular file.')
	}
	if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
		throw new Error('The MCP connection file permissions are too broad.')
	}
	const value: unknown = JSON.parse(await readFile(filePath, 'utf8'))
	return v.parse(MCPConnectionFileSchema, value)
}
