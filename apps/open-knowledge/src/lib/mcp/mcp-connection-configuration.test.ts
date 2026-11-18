import { describe, expect, test } from 'bun:test'
import type { MCPConnectionDetails } from './api'
import {
	serializeMCPCodexConnectionConfiguration,
	serializeMCPHTTPConnectionConfiguration,
	serializeMCPStdioConnectionConfiguration
} from './mcp-connection-configuration'

function connection(stdio?: Partial<MCPConnectionDetails['stdio']>): MCPConnectionDetails {
	return {
		workspaceID: 'workspace-one',
		workspaceCount: 1,
		credentialRevision: '00000000-0000-4000-8000-000000000001',
		http: {
			url: 'http://127.0.0.1:4123/mcp',
			bearerToken: 'test-only-token-with-thirty-two-characters'
		},
		stdio: {
			command: '/Applications/Open Knowledge Codex.app/Contents/MacOS/Open Knowledge Codex',
			args: ['/Users/test/Library/Application Support/Open Knowledge Codex/mcp/bridge.mjs'],
			env: {
				ELECTRON_RUN_AS_NODE: '1',
				OPEN_KNOWLEDGE_MCP_CONNECTION_FILE:
					'/Users/test/Library/Application Support/Open Knowledge Codex/mcp/connection.json'
			},
			...stdio
		}
	}
}

function expectCodexRoundTrip(details: MCPConnectionDetails): void {
	expect(Bun.TOML.parse(serializeMCPCodexConnectionConfiguration(details))).toEqual({
		mcp_servers: { open_knowledge_codex: details.stdio }
	})
}

describe('MCP connection configuration', () => {
	test('keeps client-neutral STDIO JSON with original launcher arguments and environment', () => {
		const details = connection()
		expect(JSON.parse(serializeMCPStdioConnectionConfiguration(details))).toEqual(details.stdio)
	})

	test('keeps client-neutral HTTP JSON with the required bearer header', () => {
		const details = connection()
		expect(JSON.parse(serializeMCPHTTPConnectionConfiguration(details))).toEqual({
			url: details.http.url,
			headers: { Authorization: `Bearer ${details.http.bearerToken}` }
		})
	})

	test('creates valid Codex TOML without embedding HTTP credentials or transient ports', () => {
		const details = connection()
		const toml = serializeMCPCodexConnectionConfiguration(details)
		expectCodexRoundTrip(details)
		expect(toml).not.toContain(details.http.bearerToken)
		expect(toml).not.toContain(details.http.url)
		expect(toml).toContain('OPEN_KNOWLEDGE_MCP_CONNECTION_FILE')
	})

	test('round-trips Windows paths, Unicode, quotes, spaces and shell metacharacters', () => {
		expectCodexRoundTrip(
			connection({
				command: 'C:\\Program Files\\Open Knowledge Codex\\应用.exe',
				args: ['C:\\Users\\分析员\\知识🧠\\bridge.mjs', '"quoted"', '$HOME', '`echo test`', ''],
				env: { 'a.b': 'C:\\Users\\test\\profile', 'quotes" and spaces': '值🧠' }
			})
		)
	})

	test('escapes every forbidden TOML control character in values and keys', () => {
		const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join('')
		const value = controls + String.fromCharCode(0x7f)
		const details = connection({ args: [value], env: { [value]: value } })
		const toml = serializeMCPCodexConnectionConfiguration(details)
		// Bun 1.3's TOML-to-JSON bridge mishandles some C0 escapes. Verify their
		// escaped output independently; common Unicode/path round trips are above.
		const escaped = JSON.stringify(value).replaceAll(String.fromCharCode(0x7f), '\\u007f')
		expect(toml).toContain(`args = [${escaped}]`)
		expect(toml).toContain(`${escaped} = ${escaped}`)
		for (const character of value.replaceAll('\n', '')) {
			expect(toml).not.toContain(character)
		}
	})

	test('round-trips escaped line breaks, backspace and DEL', () => {
		const value = '\b\n\r' + String.fromCharCode(0x7f)
		expectCodexRoundTrip(connection({ args: [value], env: { [value]: value } }))
	})

	test('quoted strings and keys cannot inject additional TOML tables', () => {
		expectCodexRoundTrip(
			connection({
				command: 'launcher"\n[mcp_servers.injected]\ncommand = "bad',
				args: [']\n[mcp_servers.injected]\ncommand = "bad" #'],
				env: { 'key"\n[mcp_servers.injected]': '\ncommand = "bad" #\\' }
			})
		)
	})

	test('supports an empty argument list and environment', () => {
		expectCodexRoundTrip(connection({ args: [], env: {} }))
	})

	test('rejects unpaired UTF-16 surrogates instead of emitting invalid TOML Unicode', () => {
		for (const value of ['\uD800', '\uDC00']) {
			expect(() =>
				serializeMCPCodexConnectionConfiguration(connection({ command: value }))
			).toThrow('valid Unicode')
			expect(() => serializeMCPCodexConnectionConfiguration(connection({ args: [value] }))).toThrow(
				'valid Unicode'
			)
			expect(() =>
				serializeMCPCodexConnectionConfiguration(connection({ env: { [value]: 'test' } }))
			).toThrow('valid Unicode')
		}
	})
})
