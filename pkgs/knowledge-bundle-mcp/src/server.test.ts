import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type {
	CreateKnowledgeBundleDirectoryInput,
	CreateKnowledgeBundleFileInput,
	EditableKnowledgeBundle,
	KnowledgeBundleDirectoryEntry,
	KnowledgeBundleEntry,
	KnowledgeBundleFile,
	KnowledgeBundleFileEntry,
	KnowledgeBundlePath,
	PatchKnowledgeBundleFileInput,
	ReadonlyKnowledgeBundle,
	WriteKnowledgeBundleFileInput
} from '@open-knowledge/knowledge-bundle-api'
import { applyExactTextPatch, ExactTextPatchError } from '@open-knowledge/knowledge-bundle-patch'
import { createKnowledgeBundleMCPServer, type KnowledgeBundleMCPGrant } from './index'

const alphaRef = 'ws_alpha-opaque-reference'
const betaRef = 'ws_beta-opaque-reference'
const modifiedAt = '2026-07-27T12:00:00.000Z'
const documentID = 'stable-guide-id'
const documentPath = '/notes/guide.md' as const
const privateRoot = '/private/knowledge/product-notes'

type BundleMetadata = {
	readonly title: string
}

type CapabilityCalls = {
	getInfo: number
	lists: Array<{ id?: string; path: string; depth: number; limit?: number }>
	reads: Array<{ id?: string; path: string; maximumBytes?: number }>
	createDirectories: CreateKnowledgeBundleDirectoryInput[]
	createFiles: CreateKnowledgeBundleFileInput[]
	writes: WriteKnowledgeBundleFileInput[]
	patches: PatchKnowledgeBundleFileInput[]
}

type BundleState = {
	root: KnowledgeBundleDirectoryEntry
	notes: KnowledgeBundleDirectoryEntry
	file: KnowledgeBundleFile
	createdDirectories: KnowledgeBundleDirectoryEntry[]
	createdFiles: KnowledgeBundleFile[]
	revisionNumber: number
	entryNumber: number
}

type BundleFixture = {
	readonly readonlyBundle: ReadonlyKnowledgeBundle<BundleMetadata>
	readonly editableBundle: EditableKnowledgeBundle<BundleMetadata>
	readonly calls: CapabilityCalls
	readonly state: BundleState
	relocateFile(path: KnowledgeBundlePath): void
}

function hash(content: string): string {
	return createHash('sha256').update(content).digest('hex')
}

function makeBundleFixture(title: string, subject: string): BundleFixture {
	const markdown = `# ${title}\n\nThe ${subject} field notes cover isolation.`
	const state: BundleState = {
		root: {
			kind: 'directory',
			id: `${subject}-root-id`,
			path: '/',
			name: '',
			parentPath: null,
			revision: `${subject}-root-r1`,
			modifiedAt
		},
		notes: {
			kind: 'directory',
			id: `${subject}-notes-id`,
			path: '/notes',
			name: 'notes',
			parentPath: '/',
			revision: `${subject}-notes-r1`,
			modifiedAt
		},
		file: {
			kind: 'file',
			id: documentID,
			path: documentPath,
			name: 'guide.md',
			parentPath: '/notes',
			revision: `${subject}-file-r1`,
			modifiedAt,
			byteLength: Buffer.byteLength(markdown),
			contentHash: hash(markdown),
			mediaType: 'text/markdown',
			content: markdown
		},
		createdDirectories: [],
		createdFiles: [],
		revisionNumber: 1,
		entryNumber: 0
	}
	const calls: CapabilityCalls = {
		getInfo: 0,
		lists: [],
		reads: [],
		createDirectories: [],
		createFiles: [],
		writes: [],
		patches: []
	}

	function directories(): KnowledgeBundleDirectoryEntry[] {
		return [state.root, state.notes, ...state.createdDirectories]
	}

	function files(): KnowledgeBundleFile[] {
		return [state.file, ...state.createdFiles]
	}

	function resolveDirectory(
		id: string | undefined,
		path: string
	): KnowledgeBundleDirectoryEntry | null {
		if (id !== undefined) {
			return directories().find((entry) => entry.id === id) ?? null
		}
		return directories().find((entry) => entry.path === path) ?? null
	}

	function resolveFile(id: string | undefined, path: string): KnowledgeBundleFile | null {
		if (id !== undefined) {
			return files().find((entry) => entry.id === id) ?? null
		}
		return files().find((entry) => entry.path === path) ?? null
	}

	function replaceFile(file: KnowledgeBundleFile): void {
		if (file.id === state.file.id) {
			state.file = file
			return
		}
		const index = state.createdFiles.findIndex((entry) => entry.id === file.id)
		if (index < 0) {
			throw new Error('Expected the fixture file to exist.')
		}
		state.createdFiles[index] = file
	}

	function entryAt(path: string): KnowledgeBundleEntry | null {
		return resolveDirectory(undefined, path) ?? resolveFile(undefined, path)
	}

	function creationParent(path: string):
		| { ok: true; directory: KnowledgeBundleDirectoryEntry }
		| {
				ok: false
				error: {
					code: 'invalid_path' | 'not_found' | 'not_a_directory'
					message: string
					current?: KnowledgeBundleEntry
				}
		  } {
		const separator = path.lastIndexOf('/')
		if (separator < 0 || path === '/') {
			return {
				ok: false,
				error: { code: 'invalid_path', message: 'Invalid target.' }
			}
		}
		const parentPath = separator === 0 ? '/' : path.slice(0, separator)
		const directory = resolveDirectory(undefined, parentPath)
		if (directory) {
			return { ok: true, directory }
		}
		const file = resolveFile(undefined, parentPath)
		return file
			? {
					ok: false,
					error: {
						code: 'not_a_directory',
						message: 'Parent is not a directory.',
						current: fileMetadata(file)
					}
				}
			: {
					ok: false,
					error: { code: 'not_found', message: 'Parent is missing.' }
				}
	}

	function createdEntryBase(path: string): {
		id: string
		path: KnowledgeBundlePath
		name: string
		parentPath: KnowledgeBundlePath
		revision: string
		modifiedAt: string
	} {
		state.entryNumber += 1
		const separator = path.lastIndexOf('/')
		return {
			id: `${subject}-created-${state.entryNumber}-id`,
			path: path as KnowledgeBundlePath,
			name: path.slice(separator + 1),
			parentPath: (separator === 0 ? '/' : path.slice(0, separator)) as KnowledgeBundlePath,
			revision: `${subject}-created-${state.entryNumber}-r1`,
			modifiedAt
		}
	}

	function descendants(
		directory: KnowledgeBundleDirectoryEntry,
		depth: number
	): KnowledgeBundleEntry[] {
		const entries = [
			state.notes,
			...state.createdDirectories,
			fileMetadata(state.file),
			...state.createdFiles.map(fileMetadata)
		]
		const prefix = directory.path === '/' ? '/' : `${directory.path}/`
		return entries.filter((entry) => {
			if (!entry.path.startsWith(prefix)) {
				return false
			}
			const relative = entry.path.slice(prefix.length)
			return relative.length > 0 && relative.split('/').length <= depth
		})
	}

	const readonlyBundle: ReadonlyKnowledgeBundle<BundleMetadata> = {
		async getInfo() {
			calls.getInfo += 1
			return { access: 'readonly', metadata: { title } }
		},
		async list(input) {
			calls.lists.push({ ...input })
			const directory = resolveDirectory(input.id, input.path)
			if (!directory) {
				return null
			}
			const allEntries = descendants(directory, input.depth)
			const entries = allEntries.slice(0, input.limit ?? allEntries.length)
			return {
				directory: { ...directory },
				entries: entries.map((entry) => ({ ...entry })),
				truncated: entries.length < allEntries.length
			}
		},
		async readFile(input) {
			calls.reads.push({ ...input })
			const file = resolveFile(input.id, input.path)
			if (!file || (input.maximumBytes !== undefined && file.byteLength > input.maximumBytes)) {
				return null
			}
			return { ...file }
		}
	}

	const editableBundle: EditableKnowledgeBundle<BundleMetadata> = {
		async getInfo() {
			calls.getInfo += 1
			return { access: 'editable', metadata: { title } }
		},
		list: (input) => readonlyBundle.list(input),
		readFile: (input) => readonlyBundle.readFile(input),
		async createDirectory(input) {
			calls.createDirectories.push({ ...input })
			if (input.id !== undefined) {
				return {
					ok: false,
					error: {
						code: 'unsupported',
						message: 'Caller IDs are unsupported.'
					}
				}
			}
			if (entryAt(input.path)) {
				return {
					ok: false,
					error: { code: 'already_exists', message: 'Target exists.' }
				}
			}
			const parent = creationParent(input.path)
			if (!parent.ok) {
				return { ok: false, error: parent.error }
			}
			const directory: KnowledgeBundleDirectoryEntry = {
				kind: 'directory',
				...createdEntryBase(input.path)
			}
			state.createdDirectories.push(directory)
			return { ok: true, value: { directory: { ...directory } } }
		},
		async createFile(input) {
			calls.createFiles.push({ ...input })
			if (input.id !== undefined) {
				return {
					ok: false,
					error: {
						code: 'unsupported',
						message: 'Caller IDs are unsupported.'
					}
				}
			}
			if (entryAt(input.path)) {
				return {
					ok: false,
					error: { code: 'already_exists', message: 'Target exists.' }
				}
			}
			const parent = creationParent(input.path)
			if (!parent.ok) {
				return { ok: false, error: parent.error }
			}
			const file: KnowledgeBundleFile = {
				kind: 'file',
				...createdEntryBase(input.path),
				byteLength: Buffer.byteLength(input.content),
				contentHash: hash(input.content),
				...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
				content: input.content
			}
			state.createdFiles.push(file)
			return { ok: true, value: { file: fileMetadata(file) } }
		},
		async writeFile(input) {
			calls.writes.push({ ...input })
			const current = resolveFile(input.id, input.path)
			if (!current) {
				return { ok: false, error: { code: 'not_found', message: 'Missing.' } }
			}
			if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
				return {
					ok: false,
					error: {
						code: 'revision_conflict',
						message: 'Stale.',
						current: fileMetadata(current)
					}
				}
			}
			if (
				input.expectedContentHash !== undefined &&
				input.expectedContentHash !== current.contentHash
			) {
				return {
					ok: false,
					error: {
						code: 'content_conflict',
						message: 'Stale.',
						current: fileMetadata(current)
					}
				}
			}

			const status = input.content === current.content ? 'unchanged' : 'updated'
			let written = current
			if (status === 'updated') {
				state.revisionNumber += 1
				written = {
					...current,
					revision: `${subject}-file-r${state.revisionNumber}`,
					content: input.content,
					byteLength: Buffer.byteLength(input.content),
					contentHash: hash(input.content),
					...(input.mediaType === undefined ? {} : { mediaType: input.mediaType })
				}
				replaceFile(written)
			}
			return { ok: true, value: { status, file: fileMetadata(written) } }
		},
		async patchFile(input) {
			calls.patches.push({
				...input,
				edits: input.edits.map((edit) => ({ ...edit }))
			})
			const current = resolveFile(input.id, input.path)
			if (!current) {
				return { ok: false, error: { code: 'not_found', message: 'Missing.' } }
			}
			if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
				return {
					ok: false,
					error: {
						code: 'revision_conflict',
						message: 'Stale.',
						current: fileMetadata(current)
					}
				}
			}
			if (
				input.expectedContentHash !== undefined &&
				input.expectedContentHash !== current.contentHash
			) {
				return {
					ok: false,
					error: {
						code: 'content_conflict',
						message: 'Stale.',
						current: fileMetadata(current)
					}
				}
			}

			let content: string
			try {
				content = applyExactTextPatch(current.content, input.edits)
			} catch (error) {
				if (!(error instanceof ExactTextPatchError)) {
					throw error
				}
				const code =
					error.reason === 'not_found'
						? 'patch_not_found'
						: error.reason === 'ambiguous'
							? 'patch_ambiguous'
							: error.reason === 'too_many_edits' || error.reason === 'too_large'
								? 'too_large'
								: 'invalid_patch'
				return {
					ok: false,
					error: {
						code,
						message: error.message,
						...(error.editNumber === null ? {} : { editNumber: error.editNumber }),
						current: fileMetadata(current)
					}
				}
			}
			if (input.maximumBytes !== undefined && Buffer.byteLength(content) > input.maximumBytes) {
				return {
					ok: false,
					error: {
						code: 'too_large',
						message: 'Patched content is too large.'
					}
				}
			}

			const status = content === current.content ? 'unchanged' : 'patched'
			let patched = current
			if (status === 'patched') {
				state.revisionNumber += 1
				patched = {
					...current,
					revision: `${subject}-file-r${state.revisionNumber}`,
					content,
					byteLength: Buffer.byteLength(content),
					contentHash: hash(content)
				}
				replaceFile(patched)
			}
			return { ok: true, value: { status, file: fileMetadata(patched) } }
		},
		async moveEntry() {
			return {
				ok: false,
				error: { code: 'unsupported', message: 'Not needed by this test.' }
			}
		},
		async deleteEntry() {
			return {
				ok: false,
				error: { code: 'unsupported', message: 'Not needed by this test.' }
			}
		}
	}

	return {
		readonlyBundle,
		editableBundle,
		calls,
		state,
		relocateFile(path) {
			const separator = path.lastIndexOf('/')
			state.file = {
				...state.file,
				path,
				name: path.slice(separator + 1),
				parentPath: (path.slice(0, separator) || '/') as KnowledgeBundlePath
			}
		}
	}
}

function fileMetadata(file: KnowledgeBundleFile): KnowledgeBundleFileEntry {
	const { content: _content, ...metadata } = file
	return metadata
}

function fixture(): {
	grants: KnowledgeBundleMCPGrant<BundleMetadata>[]
	alpha: BundleFixture
	beta: BundleFixture
} {
	const alpha = makeBundleFixture('Product Guide', 'alpha')
	const beta = makeBundleFixture('Research Guide', 'beta')
	return {
		alpha,
		beta,
		grants: [
			{
				reference: alphaRef,
				label: 'Product Notes',
				access: 'editable',
				bundle: alpha.editableBundle,
				search: async () => ({
					matches: [
						{
							path: alpha.state.file.path,
							lineNumber: 3,
							columnNumber: 5,
							preview: 'The alpha field notes cover isolation.',
							match: 'alpha',
							representation: 'source_markdown',
							documentAccess: 'writable'
						}
					],
					truncated: false
				})
			},
			{
				reference: betaRef,
				label: 'Research Notes',
				access: 'readonly',
				bundle: beta.readonlyBundle,
				search: async () => ({
					matches: [
						{
							path: beta.state.file.path,
							lineNumber: 3,
							columnNumber: 5,
							preview: 'The beta field notes cover isolation.',
							match: 'beta',
							representation: 'source_markdown',
							documentAccess: 'readonly'
						}
					],
					truncated: false
				})
			}
		]
	}
}

async function connectedClient(
	workspaceGrants: readonly KnowledgeBundleMCPGrant[] = fixture().grants
): Promise<{ client: Client; close(): Promise<void> }> {
	const server = createKnowledgeBundleMCPServer(workspaceGrants)
	const client = new Client({ name: 'open-knowledge-test', version: '1.0.0' })
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await server.connect(serverTransport)
	await client.connect(clientTransport)
	return {
		client,
		async close() {
			await client.close()
			await server.close()
		}
	}
}

describe('knowledge bundle MCP server', () => {
	test('without a session-memory grant, instructions and all research prompts stay client-neutral', async () => {
		const connection = await connectedClient()
		try {
			const instructions = connection.client.getInstructions() ?? ''
			expect(instructions).not.toContain('Codex')
			expect(instructions).not.toContain('knowledge_search_memory')
			expect(instructions).toContain('research_brief, quant_research_review, consulting_handoff')
			expect(connection.client.getServerVersion()?.version).toBe('0.0.4')
			for (const [name, subject] of [
				['research_brief', 'question'],
				['quant_research_review', 'hypothesis'],
				['consulting_handoff', 'engagement']
			]) {
				for (const workspaceRef of [undefined, alphaRef, 'ws_unknown']) {
					const prompt = await connection.client.getPrompt({
						name: name!,
						arguments: {
							[subject!]: 'Synthetic review',
							...(workspaceRef === undefined ? {} : { workspace_ref: workspaceRef })
						}
					})
					expect(JSON.stringify(prompt)).not.toContain('Codex')
					expect(JSON.stringify(prompt)).not.toContain('knowledge_search_memory')
				}
			}
		} finally {
			await connection.close()
		}
	})

	test('mixed grants scope research prompt memory guidance to the selected workspace', async () => {
		const grants = fixture().grants.map((grant, index) =>
			index === 0
				? {
						...grant,
						sessionMemory: {
							snapshot: async () => ({
								sessions: [],
								complete: true,
								warnings: []
							})
						}
					}
				: grant
		)
		const connection = await connectedClient(grants)
		try {
			expect(connection.client.getInstructions()).toContain('read-only Codex project history')
			expect(connection.client.getInstructions()).toContain(
				'never automatically inject history or assume every authorized workspace has memory enabled'
			)
			for (const [name, subject] of [
				['research_brief', 'question'],
				['quant_research_review', 'hypothesis'],
				['consulting_handoff', 'engagement']
			]) {
				for (const workspaceRef of [undefined, alphaRef, betaRef, 'ws_unknown']) {
					const prompt = await connection.client.getPrompt({
						name: name!,
						arguments: {
							[subject!]: 'Synthetic review',
							...(workspaceRef === undefined ? {} : { workspace_ref: workspaceRef })
						}
					})
					const text = JSON.stringify(prompt)
					const enabled = workspaceRef === undefined || workspaceRef === alphaRef
					expect(text.includes('Codex')).toBe(enabled)
					expect(text.includes('knowledge_search_memory')).toBe(enabled)
					expect(text).toContain('knowledge_recall')
				}
			}
		} finally {
			await connection.close()
		}
	})

	test('requires at least one grant with a unique opaque reference', () => {
		const context = fixture()
		expect(() => createKnowledgeBundleMCPServer([])).toThrow('at least one workspace grant')
		expect(() => createKnowledgeBundleMCPServer([context.grants[0]!, context.grants[0]!])).toThrow(
			'references must be unique'
		)
	})

	test('lists explicit grant access and permission-scoped tools', async () => {
		const connection = await connectedClient()
		try {
			const listed = await connection.client.listTools()
			expect(listed.tools.map(({ name }) => name)).toEqual([
				'knowledge_list_workspaces',
				'knowledge_bundle_info',
				'knowledge_list_entries',
				'knowledge_create_directory',
				'knowledge_search',
				'knowledge_get_document',
				'knowledge_create_document',
				'knowledge_patch_document',
				'knowledge_update_document',
				'knowledge_get_excerpt',
				'knowledge_get_excerpts',
				'knowledge_recall'
			])
			for (const tool of listed.tools) {
				expect(tool.inputSchema).toMatchObject({ type: 'object' })
				if (
					['knowledge_get_excerpt', 'knowledge_get_excerpts', 'knowledge_recall'].includes(tool.name)
				) {
					expect(tool.outputSchema).toBeUndefined()
				} else {
					expect(tool.outputSchema).toMatchObject({ type: 'object' })
				}
				const create = ['knowledge_create_directory', 'knowledge_create_document'].includes(
					tool.name
				)
				const edit = ['knowledge_patch_document', 'knowledge_update_document'].includes(tool.name)
				expect(tool.annotations).toMatchObject(
					create
						? {
								readOnlyHint: false,
								destructiveHint: false,
								idempotentHint: true,
								openWorldHint: false
							}
						: edit
							? {
									readOnlyHint: false,
									destructiveHint: true,
									openWorldHint: false
								}
							: {
									readOnlyHint: true,
									destructiveHint: false,
									openWorldHint: false
								}
				)
				expect(JSON.stringify(tool.inputSchema)).not.toContain('rootPath')
			}
			const createDirectoryTool = listed.tools.find(
				({ name }) => name === 'knowledge_create_directory'
			)
			const createDocumentTool = listed.tools.find(
				({ name }) => name === 'knowledge_create_document'
			)
			expect(createDocumentTool?.inputSchema).toMatchObject({
				properties: {
					workspace_ref: expect.any(Object),
					path: expect.any(Object),
					markdown: expect.any(Object)
				}
			})
			expect(createDirectoryTool?.description).toContain('never an operating-system path')
			expect(createDirectoryTool?.description).toContain(
				'does not create missing parents or replace any file or directory'
			)
			expect(createDocumentTool?.description).toContain('never an operating-system path')
			expect(createDocumentTool?.description).toContain('UTF-8 bytes')
			expect(createDocumentTool?.description).toContain('without echoing the Markdown')
			expect(JSON.stringify(createDirectoryTool?.inputSchema)).not.toContain('"id"')
			expect(JSON.stringify(createDocumentTool?.inputSchema)).not.toContain('media_type')

			const result = await connection.client.callTool({
				name: 'knowledge_list_workspaces',
				arguments: {}
			})
			expect(result.structuredContent).toEqual({
				workspaces: [
					{
						workspace_ref: alphaRef,
						label: 'Product Notes',
						access: 'editable'
					},
					{
						workspace_ref: betaRef,
						label: 'Research Notes',
						access: 'readonly'
					}
				]
			})
		} finally {
			await connection.close()
		}
	})

	test('searches with explicit ripgrep semantics and bounded canonical results', async () => {
		const context = fixture()
		const calls: unknown[] = []
		const connection = await connectedClient([
			{
				...context.grants[1]!,
				search: async (input) => {
					calls.push({ input })
					return {
						matches: [
							{
								path: documentPath,
								lineNumber: 3,
								columnNumber: 5,
								preview: 'The alpha field notes cover isolation.',
								match: 'alpha field',
								representation: 'source_markdown',
								documentAccess: 'writable'
							}
						],
						truncated: false
					}
				}
			}
		])
		try {
			const result = await connection.client.callTool({
				name: 'knowledge_search',
				arguments: {
					query: 'alpha field',
					case_mode: 'insensitive',
					fixed_strings: true,
					whole_word: false,
					path: '/notes',
					exclude_globs: ['drafts/**'],
					limit: 12
				}
			})
			expect(calls).toEqual([
				{
					input: {
						query: 'alpha field',
						caseMode: 'insensitive',
						fixedStrings: true,
						wholeWord: false,
						path: '/notes',
						excludeGlobs: ['drafts/**'],
						limit: 12
					}
				}
			])
			expect(result.structuredContent).toEqual({
				workspace_ref: betaRef,
				matches: [
					{
						path: documentPath,
						line_number: 3,
						column_number: 5,
						preview: 'The alpha field notes cover isolation.',
						match: 'alpha field',
						representation: 'source_markdown',
						document_access: 'readonly'
					}
				],
				truncated: false
			})
		} finally {
			await connection.close()
		}
	})

	test('uses getInfo for pass-by-value bundle metadata', async () => {
		const context = fixture()
		const connection = await connectedClient(context.grants)
		try {
			const info = await connection.client.callTool({
				name: 'knowledge_bundle_info',
				arguments: { workspace_ref: betaRef }
			})
			expect(info.structuredContent).toEqual({
				workspace_ref: betaRef,
				label: 'Research Notes',
				access: 'readonly',
				metadata: { title: 'Research Guide' }
			})
		} finally {
			await connection.close()
		}
	})

	test('rejects non-JSON bundle metadata at the MCP boundary', async () => {
		const context = fixture()
		const bundle: ReadonlyKnowledgeBundle<Date> = {
			...context.alpha.readonlyBundle,
			async getInfo() {
				return { access: 'readonly', metadata: new Date() }
			}
		}
		const connection = await connectedClient([
			{
				reference: alphaRef,
				label: 'Product Notes',
				access: 'readonly',
				bundle
			}
		])
		try {
			const info = await connection.client.callTool({
				name: 'knowledge_bundle_info',
				arguments: {}
			})
			expect(info.isError).toBe(true)
			expect(info.structuredContent).toBeUndefined()
		} finally {
			await connection.close()
		}
	})

	test('requires workspace_ref only when the session grant is ambiguous', async () => {
		const connection = await connectedClient()
		try {
			const missing = await connection.client.callTool({
				name: 'knowledge_bundle_info',
				arguments: {}
			})
			expect(missing.isError).toBe(true)
			expect(JSON.stringify(missing.content)).toContain(
				'workspace_ref is required when more than one workspace is available'
			)

			const unknown = await connection.client.callTool({
				name: 'knowledge_bundle_info',
				arguments: { workspace_ref: 'ws_unknown-opaque-reference' }
			})
			expect(unknown.isError).toBe(true)
			expect(JSON.stringify(unknown.content)).toContain(
				'The workspace_ref is not available in this session'
			)
		} finally {
			await connection.close()
		}
	})

	test('lists bounded entries with depth and agent-reusable identity metadata', async () => {
		const context = fixture()
		const connection = await connectedClient(context.grants)
		try {
			const listing = await connection.client.callTool({
				name: 'knowledge_list_entries',
				arguments: { workspace_ref: alphaRef, path: '/', depth: 2, limit: 50 }
			})
			expect(context.alpha.calls.lists).toEqual([{ path: '/', depth: 2, limit: 50 }])
			expect(listing.structuredContent).toMatchObject({
				workspace_ref: alphaRef,
				depth: 2,
				directory: {
					kind: 'directory',
					id: 'alpha-root-id',
					path: '/',
					revision: 'alpha-root-r1'
				},
				entries: [
					{ kind: 'directory', id: 'alpha-notes-id', path: '/notes' },
					{
						kind: 'file',
						id: documentID,
						path: documentPath,
						revision: 'alpha-file-r1',
						content_hash: context.alpha.state.file.contentHash,
						document_access: 'writable'
					}
				],
				truncated: false
			})
		} finally {
			await connection.close()
		}
	})

	test('defaults listing to one level and the existing entry bound', async () => {
		const context = fixture()
		const connection = await connectedClient([context.grants[0]!])
		try {
			await connection.client.callTool({
				name: 'knowledge_list_entries',
				arguments: { id: 'alpha-root-id', path: '/' }
			})
			expect(context.alpha.calls.lists).toEqual([
				{ id: 'alpha-root-id', path: '/', depth: 1, limit: 10_000 }
			])
		} finally {
			await connection.close()
		}
	})

	test('creates one directory and one Markdown document with exact calls and compact metadata', async () => {
		const context = fixture()
		const connection = await connectedClient([context.grants[0]!])
		const markdown = '# Roadmap 🧭\n\nCafé notes.'
		try {
			const directory = await connection.client.callTool({
				name: 'knowledge_create_directory',
				arguments: { path: '/projects' }
			})
			const document = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/projects/roadmap.md', markdown }
			})

			expect(context.alpha.calls.createDirectories).toEqual([{ path: '/projects' }])
			expect(context.alpha.calls.createFiles).toEqual([
				{
					path: '/projects/roadmap.md',
					content: markdown,
					mediaType: 'text/markdown'
				}
			])
			expect(directory.structuredContent).toEqual({
				workspace_ref: alphaRef,
				kind: 'directory',
				id: 'alpha-created-1-id',
				path: '/projects',
				name: 'projects',
				parent_path: '/',
				revision: 'alpha-created-1-r1',
				modified_at: modifiedAt
			})
			expect(document.structuredContent).toEqual({
				workspace_ref: alphaRef,
				kind: 'file',
				id: 'alpha-created-2-id',
				path: '/projects/roadmap.md',
				name: 'roadmap.md',
				parent_path: '/projects',
				revision: 'alpha-created-2-r1',
				modified_at: modifiedAt,
				byte_length: Buffer.byteLength(markdown),
				content_hash: hash(markdown),
				media_type: 'text/markdown',
				document_access: 'writable'
			})
			expect((document.structuredContent as Record<string, unknown>).markdown).toBeUndefined()
			expect(JSON.stringify(document.content)).not.toContain(markdown)

			const listing = await connection.client.callTool({
				name: 'knowledge_list_entries',
				arguments: { path: '/projects', depth: 1 }
			})
			expect(listing.structuredContent).toMatchObject({
				directory: { id: 'alpha-created-1-id', path: '/projects' },
				entries: [{ id: 'alpha-created-2-id', path: '/projects/roadmap.md' }]
			})
		} finally {
			await connection.close()
		}
	})

	test('never overwrites entries or creates missing parent directories', async () => {
		const context = fixture()
		const connection = await connectedClient([context.grants[0]!])
		try {
			const createdDirectory = await connection.client.callTool({
				name: 'knowledge_create_directory',
				arguments: { path: '/drafts' }
			})
			expect(createdDirectory.isError).not.toBe(true)
			const duplicateDirectory = await connection.client.callTool({
				name: 'knowledge_create_directory',
				arguments: { path: '/drafts' }
			})
			expect(duplicateDirectory.isError).toBe(true)
			expect(JSON.stringify(duplicateDirectory)).toContain('already exists')

			const createdDocument = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/drafts/idea.md', markdown: '# Idea' }
			})
			expect(createdDocument.isError).not.toBe(true)
			const duplicateDocument = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/drafts/idea.md', markdown: '# Replacement' }
			})
			expect(duplicateDocument.isError).toBe(true)
			expect(JSON.stringify(duplicateDocument)).toContain('already exists')
			expect(context.alpha.state.createdFiles).toHaveLength(1)
			expect(context.alpha.state.createdFiles[0]?.content).toBe('# Idea')

			for (const [name, path, markdown] of [
				['knowledge_create_directory', '/missing/child', undefined],
				['knowledge_create_document', '/missing/child.md', '# Missing'],
				['knowledge_create_directory', '/notes/guide.md/child', undefined],
				['knowledge_create_document', '/notes/guide.md/child.md', '# Child']
			] as const) {
				const result = await connection.client.callTool({
					name,
					arguments: markdown === undefined ? { path } : { path, markdown }
				})
				expect(result.isError).toBe(true)
				expect(JSON.stringify(result)).toMatch(/parent knowledge (directory|path)/i)
			}

			const existingDirectory = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/notes', markdown: '# Wrong kind' }
			})
			expect(existingDirectory.isError).toBe(true)
			const existingFile = await connection.client.callTool({
				name: 'knowledge_create_directory',
				arguments: { path: documentPath }
			})
			expect(existingFile.isError).toBe(true)
		} finally {
			await connection.close()
		}
	})

	test('rejects noncanonical, root, non-Markdown, and hidden creation paths before capability calls', async () => {
		const context = fixture()
		const connection = await connectedClient([context.grants[0]!])
		try {
			for (const path of [
				'',
				'notes/new',
				'/',
				'/notes//new',
				'/notes/new/',
				'/notes/./new',
				'/../secret',
				'/.. /secret',
				'/. /secret',
				'/node_modules./new',
				'/.git /new',
				'/ node_modules/new',
				'/CON/new',
				'/notes:new/new',
				'/notes\\new',
				'/notes/\u{10ffff}',
				`/${'a'.repeat(1024)}`,
				'/notes/\ud800',
				'/.git/new',
				'/.open-knowledge/new',
				'/node_modules/new',
				'/notes/.draft.open-knowledge-123.tmp/child'
			]) {
				const result = await connection.client.callTool({
					name: 'knowledge_create_directory',
					arguments: { path }
				})
				expect(result.isError).toBe(true)
			}
			for (const path of [
				'',
				'notes/new.md',
				'/notes//new.md',
				'/notes/new.md/',
				'/notes/./new.md',
				'/notes/new.txt',
				'/../secret.md',
				'/.. /secret.md',
				'/. /secret.md',
				'/node_modules./new.md',
				'/.git /new.md',
				'/ node_modules/new.md',
				'/CON/new.md',
				'/notes/file:stream.md',
				'/notes\\new.md',
				'/notes/\u{10ffff}.md',
				`/${'a'.repeat(1021)}.md`,
				'/notes/\ud800.md',
				'/.git/new.md',
				'/.open-knowledge/new.md',
				'/node_modules/new.md',
				'/notes/.draft.open-knowledge-123.tmp/child.md'
			]) {
				const result = await connection.client.callTool({
					name: 'knowledge_create_document',
					arguments: { path, markdown: '' }
				})
				expect(result.isError).toBe(true)
			}
			expect(context.alpha.calls.createDirectories).toHaveLength(0)
			expect(context.alpha.calls.createFiles).toHaveLength(0)
		} finally {
			await connection.close()
		}
	})

	test('validates Unicode and the UTF-8 document bound before creation', async () => {
		const context = fixture()
		const connection = await connectedClient([context.grants[0]!])
		try {
			for (const markdown of ['\ud800', 'a'.repeat(1024 * 1024 + 1), 'é'.repeat(1024 * 512 + 1)]) {
				const result = await connection.client.callTool({
					name: 'knowledge_create_document',
					arguments: { path: '/notes/bounded.md', markdown }
				})
				expect(result.isError).toBe(true)
			}
			expect(context.alpha.calls.createFiles).toHaveLength(0)

			const boundary = 'é'.repeat(1024 * 512)
			const created = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/notes/bounded.md', markdown: boundary }
			})
			expect(created.isError).not.toBe(true)
			expect(created.structuredContent).toMatchObject({
				byte_length: 1024 * 1024
			})

			const empty = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/notes/empty.md', markdown: '' }
			})
			expect(empty.isError).not.toBe(true)
			expect(empty.structuredContent).toMatchObject({
				path: '/notes/empty.md',
				byte_length: 0,
				content_hash: hash('')
			})

			expect(context.alpha.calls.createFiles).toHaveLength(2)
			expect(context.alpha.calls.createFiles[0]).toMatchObject({
				path: '/notes/bounded.md',
				mediaType: 'text/markdown'
			})
			expect(Buffer.byteLength(context.alpha.calls.createFiles[0]?.content ?? '')).toBe(1024 * 1024)
			expect(context.alpha.calls.createFiles[1]).toEqual({
				path: '/notes/empty.md',
				content: '',
				mediaType: 'text/markdown'
			})
		} finally {
			await connection.close()
		}
	})

	test('reads by optional id with the document byte bound and canonical metadata', async () => {
		const context = fixture()
		const connection = await connectedClient(context.grants)
		try {
			const read = await connection.client.callTool({
				name: 'knowledge_get_document',
				arguments: {
					workspace_ref: alphaRef,
					id: documentID,
					path: documentPath
				}
			})
			expect(context.alpha.calls.reads).toEqual([
				{ id: documentID, path: documentPath, maximumBytes: 1024 * 1024 }
			])
			expect(read.structuredContent).toMatchObject({
				workspace_ref: alphaRef,
				kind: 'file',
				id: documentID,
				path: documentPath,
				revision: 'alpha-file-r1',
				content_hash: context.alpha.state.file.contentHash,
				media_type: 'text/markdown',
				document_access: 'writable',
				representation: 'source_markdown',
				markdown_byte_length: context.alpha.state.file.byteLength
			})
			expect(read.content).toEqual([{ type: 'text', text: context.alpha.state.file.content }])
			expect((read.structuredContent as Record<string, unknown>).markdown).toBeUndefined()
		} finally {
			await connection.close()
		}
	})

	test('reads host-converted Markdown without exposing source bytes', async () => {
		const context = fixture()
		const markdown = '| Name | Score |\n| --- | --- |\n| Ada | 10 |'
		const convertedFile: KnowledgeBundleFileEntry & {
			documentAccess: 'readonly'
		} = {
			kind: 'file',
			id: 'scores-id',
			path: '/scores.csv',
			name: 'scores.csv',
			parentPath: '/',
			revision: 'scores-r1',
			modifiedAt,
			byteLength: 18,
			contentHash: 'c'.repeat(64),
			mediaType: 'text/csv',
			documentAccess: 'readonly'
		}
		const reads: unknown[] = []
		const connection = await connectedClient([
			{
				reference: betaRef,
				label: 'Research Notes',
				access: 'readonly',
				bundle: context.beta.readonlyBundle,
				readDocument: async (input) => {
					reads.push({ input })
					return {
						status: 'readable',
						file: convertedFile,
						markdown,
						representation: 'converted_markdown'
					}
				}
			}
		])
		try {
			const read = await connection.client.callTool({
				name: 'knowledge_get_document',
				arguments: { path: '/scores.csv' }
			})
			expect(reads).toEqual([
				{
					input: { path: '/scores.csv', maximumMarkdownBytes: 1024 * 1024 }
				}
			])
			expect(context.beta.calls.reads).toHaveLength(0)
			expect(read.content).toEqual([{ type: 'text', text: markdown }])
			expect(read.structuredContent).toMatchObject({
				path: '/scores.csv',
				byte_length: convertedFile.byteLength,
				content_hash: convertedFile.contentHash,
				document_access: 'readonly',
				representation: 'converted_markdown',
				markdown_byte_length: Buffer.byteLength(markdown)
			})
		} finally {
			await connection.close()
		}
	})

	test('rejects host-declared unsupported documents without a source read', async () => {
		const context = fixture()
		const unsupportedFile: KnowledgeBundleFileEntry & {
			documentAccess: 'not_supported'
		} = {
			kind: 'file',
			id: 'archive-id',
			path: '/archive.zip',
			name: 'archive.zip',
			parentPath: '/',
			revision: 'archive-r1',
			modifiedAt,
			byteLength: 128,
			contentHash: 'd'.repeat(64),
			documentAccess: 'not_supported'
		}
		const connection = await connectedClient([
			{
				reference: betaRef,
				label: 'Research Notes',
				access: 'readonly',
				bundle: context.beta.readonlyBundle,
				readDocument: async () => ({
					status: 'not_supported',
					file: unsupportedFile
				})
			}
		])
		try {
			const read = await connection.client.callTool({
				name: 'knowledge_get_document',
				arguments: { path: '/archive.zip' }
			})
			expect(read.isError).toBe(true)
			expect(read.content).toEqual([
				{
					type: 'text',
					text: 'This file is not supported as a knowledge document.'
				}
			])
			expect(context.beta.calls.reads).toHaveLength(0)
		} finally {
			await connection.close()
		}
	})

	test('keeps fallback document access coherent without a host reader', async () => {
		const context = fixture()
		context.beta.state.file = {
			...context.beta.state.file,
			documentAccess: 'not_supported'
		}
		const connection = await connectedClient([context.grants[1]!])
		try {
			const listing = await connection.client.callTool({
				name: 'knowledge_list_entries',
				arguments: { path: '/', depth: 2 }
			})
			expect(listing.structuredContent).toMatchObject({
				entries: expect.arrayContaining([
					expect.objectContaining({
						path: documentPath,
						document_access: 'not_supported'
					})
				])
			})
			const read = await connection.client.callTool({
				name: 'knowledge_get_document',
				arguments: { path: documentPath }
			})
			expect(read.isError).toBe(true)
			expect(read.content).toEqual([
				{
					type: 'text',
					text: 'This file is not supported as a knowledge document.'
				}
			])
		} finally {
			await connection.close()
		}
	})

	test('follows an authoritative id from a stale non-Markdown path to Markdown', async () => {
		const context = fixture()
		context.beta.relocateFile('/notes/renamed.md')
		const connection = await connectedClient([context.grants[1]!])
		try {
			const read = await connection.client.callTool({
				name: 'knowledge_get_document',
				arguments: { id: documentID, path: '/notes/guide.pdf' }
			})
			expect(read.isError).not.toBe(true)
			expect(read.structuredContent).toMatchObject({
				id: documentID,
				path: '/notes/renamed.md',
				representation: 'source_markdown'
			})
		} finally {
			await connection.close()
		}
	})

	test('requires absolute canonical paths before invoking a capability', async () => {
		const context = fixture()
		const connection = await connectedClient(context.grants)
		try {
			for (const path of [
				'',
				'notes/guide.md',
				'/../secret.md',
				'/notes//guide.md',
				'/.git/secret.md',
				'/.open-knowledge/secret.md',
				'/node_modules/package/readme.md'
			]) {
				const result = await connection.client.callTool({
					name: 'knowledge_get_document',
					arguments: { workspace_ref: alphaRef, path }
				})
				expect(result.isError).toBe(true)
			}
			expect(context.alpha.calls.reads).toHaveLength(0)
		} finally {
			await connection.close()
		}
	})

	test('updates with both preconditions and returns the canonical relocated path', async () => {
		const context = fixture()
		const original = { ...context.alpha.state.file }
		context.alpha.relocateFile('/archive/guide.md')
		const connection = await connectedClient(context.grants)
		try {
			const updated = await connection.client.callTool({
				name: 'knowledge_update_document',
				arguments: {
					workspace_ref: alphaRef,
					id: documentID,
					path: documentPath,
					expected_revision: original.revision,
					expected_content_hash: original.contentHash,
					markdown: '# Updated safely'
				}
			})
			expect(context.alpha.calls.writes).toMatchObject([
				{
					id: documentID,
					path: documentPath,
					expectedRevision: original.revision,
					expectedContentHash: original.contentHash,
					content: '# Updated safely'
				}
			])
			expect(updated.structuredContent).toMatchObject({
				status: 'updated',
				id: documentID,
				path: '/archive/guide.md',
				revision: 'alpha-file-r2',
				content_hash: hash('# Updated safely')
			})
			expect(
				(updated.structuredContent as Record<string, unknown> | undefined)?.markdown
			).toBeUndefined()
		} finally {
			await connection.close()
		}
	})

	test('patches exact text and writes against the canonical path returned by readFile', async () => {
		const context = fixture()
		const original = { ...context.alpha.state.file }
		context.alpha.relocateFile('/archive/guide.md')
		const connection = await connectedClient(context.grants)
		try {
			const patched = await connection.client.callTool({
				name: 'knowledge_patch_document',
				arguments: {
					workspace_ref: alphaRef,
					id: documentID,
					path: documentPath,
					expected_revision: original.revision,
					expected_content_hash: original.contentHash,
					edits: [
						{ old_text: '# Product Guide', new_text: '# Product Handbook' },
						{
							old_text: 'alpha field notes',
							new_text: 'updated product notes'
						}
					]
				}
			})
			expect(context.alpha.calls.patches[0]).toMatchObject({
				id: documentID,
				path: documentPath,
				expectedRevision: original.revision,
				expectedContentHash: original.contentHash,
				maximumBytes: 1024 * 1024
			})
			expect(context.alpha.calls.reads).toHaveLength(0)
			expect(context.alpha.calls.writes).toHaveLength(0)
			expect(patched.structuredContent).toMatchObject({
				status: 'patched',
				id: documentID,
				path: '/archive/guide.md',
				applied_edits: 2,
				content_hash: hash('# Product Handbook\n\nThe updated product notes cover isolation.')
			})
			expect(
				(patched.structuredContent as Record<string, unknown> | undefined)?.markdown
			).toBeUndefined()
		} finally {
			await connection.close()
		}
	})

	test('performs the backend compare-and-swap when patch edits cancel out', async () => {
		const context = fixture()
		const original = { ...context.alpha.state.file }
		const connection = await connectedClient([context.grants[0]!])
		try {
			const result = await connection.client.callTool({
				name: 'knowledge_patch_document',
				arguments: {
					id: documentID,
					path: documentPath,
					expected_revision: original.revision,
					expected_content_hash: original.contentHash,
					edits: [
						{ old_text: 'Product Guide', new_text: 'Product Handbook' },
						{ old_text: 'Product Handbook', new_text: 'Product Guide' }
					]
				}
			})
			expect(result.structuredContent).toMatchObject({
				status: 'unchanged',
				applied_edits: 2
			})
			expect(context.alpha.calls.patches[0]).toMatchObject({
				expectedRevision: original.revision,
				expectedContentHash: original.contentHash,
				edits: [
					{ oldText: 'Product Guide', newText: 'Product Handbook' },
					{ oldText: 'Product Handbook', newText: 'Product Guide' }
				]
			})
		} finally {
			await connection.close()
		}
	})

	test('rejects stale and ambiguous patches without partial writes', async () => {
		const context = fixture()
		const original = { ...context.alpha.state.file }
		const connection = await connectedClient(context.grants)
		try {
			const stale = await connection.client.callTool({
				name: 'knowledge_patch_document',
				arguments: {
					workspace_ref: alphaRef,
					id: documentID,
					path: documentPath,
					expected_revision: 'stale-revision',
					expected_content_hash: original.contentHash,
					edits: [{ old_text: 'alpha', new_text: 'changed' }]
				}
			})
			expect(stale.isError).toBe(true)
			expect(JSON.stringify(stale)).toContain('changed. Read it again')

			const ambiguous = await connection.client.callTool({
				name: 'knowledge_patch_document',
				arguments: {
					workspace_ref: alphaRef,
					id: documentID,
					path: documentPath,
					expected_revision: original.revision,
					expected_content_hash: original.contentHash,
					edits: [{ old_text: ' ', new_text: '-' }]
				}
			})
			expect(ambiguous.isError).toBe(true)
			expect(JSON.stringify(ambiguous)).toContain('matched more than once')
			expect(context.alpha.calls.writes).toHaveLength(0)
			expect(context.alpha.calls.reads).toHaveLength(0)
			expect(context.alpha.calls.patches).toHaveLength(2)
		} finally {
			await connection.close()
		}
	})

	test('never invokes a mutation through a readonly grant', async () => {
		const context = fixture()
		const connection = await connectedClient(context.grants)
		try {
			const update = await connection.client.callTool({
				name: 'knowledge_update_document',
				arguments: {
					workspace_ref: betaRef,
					id: documentID,
					path: documentPath,
					expected_revision: context.beta.state.file.revision,
					expected_content_hash: context.beta.state.file.contentHash,
					markdown: '# Forbidden'
				}
			})
			const createDirectory = await connection.client.callTool({
				name: 'knowledge_create_directory',
				arguments: { workspace_ref: betaRef, path: '/forbidden' }
			})
			const createDocument = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: {
					workspace_ref: betaRef,
					path: '/notes/forbidden.md',
					markdown: '# Forbidden'
				}
			})
			for (const result of [update, createDirectory, createDocument]) {
				expect(result.isError).toBe(true)
				expect(JSON.stringify(result)).toContain('workspace is read-only')
			}
			expect(context.beta.calls.createDirectories).toHaveLength(0)
			expect(context.beta.calls.createFiles).toHaveLength(0)
			expect(context.beta.calls.writes).toHaveLength(0)
		} finally {
			await connection.close()
		}
	})

	test('does not advertise mutation tools when every grant is readonly', async () => {
		const context = fixture()
		const connection = await connectedClient([
			{
				reference: alphaRef,
				label: 'Product Notes',
				access: 'readonly',
				bundle: context.alpha.readonlyBundle
			},
			context.grants[1]!
		])
		try {
			const listed = await connection.client.listTools()
			const names = listed.tools.map(({ name }) => name)
			for (const name of [
				'knowledge_create_directory',
				'knowledge_create_document',
				'knowledge_patch_document',
				'knowledge_update_document'
			]) {
				expect(names).not.toContain(name)
			}
		} finally {
			await connection.close()
		}
	})

	test('preserves namespaced resources and the scope-explicit exploration prompt', async () => {
		const connection = await connectedClient()
		try {
			const resources = await connection.client.listResources()
			expect(resources.resources.map(({ uri }) => uri)).toEqual([
				`knowledge://workspace/${alphaRef}/overview`,
				`knowledge://workspace/${betaRef}/overview`
			])
			const templates = await connection.client.listResourceTemplates()
			expect(templates.resourceTemplates).toMatchObject([
				{
					name: 'knowledge-document',
					uriTemplate: 'knowledge://workspace/{workspace_ref}/document/{path}'
				}
			])
			const read = await connection.client.readResource({
				uri: `knowledge://workspace/${betaRef}/document/%2Fnotes%2Fguide.md`
			})
			expect(read.contents[0]).toMatchObject({
				mimeType: 'text/markdown',
				text: expect.stringContaining('beta field')
			})

			const prompt = await connection.client.getPrompt({
				name: 'explore_knowledge_bundle',
				arguments: { topic: 'launch safety' }
			})
			const prompts = await connection.client.listPrompts()
			expect(
				prompts.prompts.filter((prompt) => prompt.name === 'explore_knowledge_bundle')
			).toMatchObject([
				{
					name: 'explore_knowledge_bundle',
					arguments: [{ name: 'topic', required: false }]
				}
			])
			expect(JSON.stringify(prompt)).toContain('knowledge_list_workspaces')
			expect(JSON.stringify(prompt)).toContain('knowledge_search')
			expect(JSON.stringify(prompt)).toContain('canonical absolute path')
			expect(JSON.stringify(prompt)).toContain('returned id')
		} finally {
			await connection.close()
		}
	})

	test('reports backend creation limits without exposing backend details', async () => {
		const context = fixture()
		const createDirectory: EditableKnowledgeBundle<BundleMetadata>['createDirectory'] =
			async () => ({
				ok: false,
				error: { code: 'too_large', message: privateRoot }
			})
		const connection = await connectedClient([
			{
				reference: alphaRef,
				label: 'Product Notes',
				access: 'editable',
				bundle: { ...context.alpha.editableBundle, createDirectory }
			}
		])
		try {
			const result = await connection.client.callTool({
				name: 'knowledge_create_directory',
				arguments: { path: '/capacity-directory' }
			})
			expect(result.isError).toBe(true)
			expect(JSON.stringify(result)).toContain('workspace exceeds a creation limit')
			expect(JSON.stringify(result)).not.toContain(privateRoot)
		} finally {
			await connection.close()
		}
	})

	test('sanitizes capability errors', async () => {
		let createDirectoryCalls = 0
		let createFileCalls = 0
		let writeCalls = 0
		const failingBundle: EditableKnowledgeBundle<BundleMetadata> = {
			async getInfo() {
				return { access: 'editable', metadata: { title: 'Private' } }
			},
			async list() {
				throw new Error(`EACCES: scandir '${privateRoot}'`)
			},
			async readFile() {
				throw new Error(`EACCES: open '${privateRoot}/guide.md'`)
			},
			async createDirectory() {
				createDirectoryCalls += 1
				return {
					ok: false,
					error: { code: 'unsupported', message: privateRoot }
				}
			},
			async createFile() {
				createFileCalls += 1
				return {
					ok: false,
					error: { code: 'unsupported', message: privateRoot }
				}
			},
			async writeFile() {
				writeCalls += 1
				return { ok: false, error: { code: 'io_error', message: privateRoot } }
			},
			async patchFile() {
				return { ok: false, error: { code: 'io_error', message: privateRoot } }
			},
			async moveEntry() {
				return {
					ok: false,
					error: { code: 'unsupported', message: privateRoot }
				}
			},
			async deleteEntry() {
				return {
					ok: false,
					error: { code: 'unsupported', message: privateRoot }
				}
			}
		}
		const connection = await connectedClient([
			{
				reference: alphaRef,
				label: 'Product Notes',
				access: 'editable',
				bundle: failingBundle
			}
		])
		try {
			const listing = await connection.client.callTool({
				name: 'knowledge_list_entries',
				arguments: { path: '/' }
			})
			expect(listing.isError).toBe(true)
			expect(JSON.stringify(listing)).not.toContain(privateRoot)

			const createDirectory = await connection.client.callTool({
				name: 'knowledge_create_directory',
				arguments: { path: '/private-directory' }
			})
			const createDocument = await connection.client.callTool({
				name: 'knowledge_create_document',
				arguments: { path: '/private-document.md', markdown: '# Private' }
			})
			for (const result of [createDirectory, createDocument]) {
				expect(result.isError).toBe(true)
				expect(result.structuredContent).toBeUndefined()
				expect(JSON.stringify(result)).not.toContain(privateRoot)
			}
			expect(createDirectoryCalls).toBe(1)
			expect(createFileCalls).toBe(1)

			const update = await connection.client.callTool({
				name: 'knowledge_update_document',
				arguments: {
					path: documentPath,
					expected_revision: 'r1',
					expected_content_hash: 'a'.repeat(64),
					markdown: '# Updated'
				}
			})
			expect(update.isError).toBe(true)
			expect(JSON.stringify(update)).not.toContain(privateRoot)
			expect(writeCalls).toBe(1)
		} finally {
			await connection.close()
		}
	})
})
