import type { MCPConnectionDetails } from './api'

export function serializeMCPHTTPConnectionConfiguration(connection: MCPConnectionDetails): string {
	return JSON.stringify(
		{
			url: connection.http.url,
			headers: { Authorization: `Bearer ${connection.http.bearerToken}` }
		},
		null,
		2
	)
}

export function serializeMCPStdioConnectionConfiguration(connection: MCPConnectionDetails): string {
	return JSON.stringify(
		{
			command: connection.stdio.command,
			args: connection.stdio.args,
			env: connection.stdio.env
		},
		null,
		2
	)
}

/** Codex's STDIO bridge reads the private connection file; no bearer token is copied. */
export function serializeMCPCodexConnectionConfiguration(connection: MCPConnectionDetails): string {
	const server = 'mcp_servers."open_knowledge_codex"'
	return [
		`[${server}]`,
		`command = ${tomlString(connection.stdio.command)}`,
		`args = [${connection.stdio.args.map(tomlString).join(', ')}]`,
		'',
		`[${server}.env]`,
		...Object.entries(connection.stdio.env).map(
			([key, value]) => `${tomlString(key)} = ${tomlString(value)}`
		)
	].join('\n')
}

function tomlString(value: string): string {
	// JSON basic strings also escape TOML quotes, backslashes and C0 controls.
	// TOML additionally forbids literal DEL and non-Unicode surrogate escapes.
	if (/[\uD800-\uDFFF]/u.test(value)) {
		throw new Error('MCP configuration must contain valid Unicode strings.')
	}
	return JSON.stringify(value).replaceAll(String.fromCharCode(0x7f), '\\u007f')
}
