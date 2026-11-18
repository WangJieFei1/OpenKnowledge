import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import {
	connectRemoteKnowledgeBundle,
	remoteKnowledgeBundleLocation,
	remoteKnowledgeBundleName
} from './remote-knowledge-bundle'
import { createApp, InMemoryKnowledgeBundle } from '@open-knowledge/knowledge-bundle-remote-test'

class IgnoringReadBoundBundle extends InMemoryKnowledgeBundle {
	override async readFile(input: Parameters<InMemoryKnowledgeBundle['readFile']>[0]) {
		return super.readFile({
			path: input.path,
			...(input.id === undefined ? {} : { id: input.id })
		})
	}
}

class IgnoringPatchBoundBundle extends InMemoryKnowledgeBundle {
	override async patchFile(input: Parameters<InMemoryKnowledgeBundle['patchFile']>[0]) {
		const unbounded = { ...input }
		delete unbounded.maximumBytes
		return super.patchFile(unbounded)
	}
}

class InconsistentUnchangedPatchBundle extends InMemoryKnowledgeBundle {
	override async patchFile(input: Parameters<InMemoryKnowledgeBundle['patchFile']>[0]) {
		const file = await this.readFile({
			path: input.path,
			...(input.id === undefined ? {} : { id: input.id })
		})
		if (!file) {
			return { ok: false as const, error: { code: 'not_found' as const, message: 'Missing.' } }
		}
		const entry = { ...file }
		delete (entry as { content?: string }).content
		return {
			ok: true as const,
			value: {
				status: 'unchanged' as const,
				file: { ...entry, id: 'inconsistent-replacement-id' }
			}
		}
	}
}

describe('remote knowledge bundle URI', () => {
	test('uses HTTPS by default and preserves endpoint query parameters', () => {
		const location = remoteKnowledgeBundleLocation('okb://knowledge.example/bundles/main?token=a')
		expect(location.endpoint.href).toBe('https://knowledge.example/bundles/main?token=a')
		expect(remoteKnowledgeBundleName(location.uri)).toBe('knowledge.example/bundles/main')
	})

	test('uses HTTP only for insecure=true and removes the transport parameter', () => {
		const insecure = remoteKnowledgeBundleLocation(
			'okb://127.0.0.1:8787/bundle?insecure=true&profile=test'
		)
		expect(insecure.endpoint.href).toBe('http://127.0.0.1:8787/bundle?profile=test')
		expect(insecure.uri).toBe('okb://127.0.0.1:8787/bundle?profile=test&insecure=true')

		const secure = remoteKnowledgeBundleLocation('okb://127.0.0.1:8787/bundle?insecure=false')
		expect(secure.endpoint.href).toBe('https://127.0.0.1:8787/bundle')
		expect(() =>
			remoteKnowledgeBundleLocation('okb://knowledge.example/bundle?insecure=true')
		).toThrow('restricted to loopback hosts')
	})

	test('canonicalizes the endpoint identity', () => {
		const location = remoteKnowledgeBundleLocation('okb://KNOWLEDGE.EXAMPLE:443/bundle')
		expect(location.uri).toBe('okb://knowledge.example/bundle')
		expect(location.endpoint.href).toBe('https://knowledge.example/bundle')
	})

	test('rejects other schemes, missing hosts, and fragments', () => {
		expect(() => remoteKnowledgeBundleLocation('https://knowledge.example/bundle')).toThrow()
		expect(() => remoteKnowledgeBundleLocation('okb:///bundle')).toThrow()
		expect(() => remoteKnowledgeBundleLocation('okb://knowledge.example/bundle#entry')).toThrow()
		expect(() => remoteKnowledgeBundleLocation('okb://knowledge.example/bundle#')).toThrow()
		expect(() => remoteKnowledgeBundleLocation('okb://user@knowledge.example/bundle')).toThrow()
		expect(() =>
			remoteKnowledgeBundleLocation('okb://knowledge.example/bundle?insecure=false&insecure=true')
		).toThrow()
	})
})

test('connects to the Hono endpoint as a typed editable bundle', async () => {
	const app = createApp()
	const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
	try {
		const connection = await connectRemoteKnowledgeBundle(
			`okb://127.0.0.1:${server.port}/bundle?insecure=true`
		)
		expect(connection.access).toBe('editable')
		if (connection.access !== 'editable') {
			throw new Error('Expected an editable remote bundle.')
		}
		expect(await connection.bundle.list({ path: '/', depth: 1 })).toMatchObject({
			entries: expect.arrayContaining([
				expect.objectContaining({ kind: 'file', documentAccess: 'writable' })
			])
		})
		const created = await connection.bundle.createFile({
			path: '/connected.md',
			content: '# Connected'
		})
		expect(created).toMatchObject({ ok: true, value: { file: { path: '/connected.md' } } })
		if (!created.ok) {
			throw new Error('Expected the remote file to be created.')
		}
		const patched = await connection.bundle.patchFile({
			id: created.value.file.id,
			path: created.value.file.path,
			expectedRevision: created.value.file.revision,
			expectedContentHash: created.value.file.contentHash,
			edits: [{ oldText: '# Connected', newText: '# Patched remotely' }]
		})
		expect(patched).toMatchObject({ ok: true, value: { status: 'patched' } })
		expect(await connection.bundle.readFile({ path: '/connected.md' })).toMatchObject({
			content: '# Patched remotely'
		})
	} finally {
		await server.stop(true)
	}
})

test('sends the configured Authorization value with every RPC batch', async () => {
	const authorizations: (string | undefined)[] = []
	const app = new Hono()
	app.use('/bundle', async (context, next) => {
		const authorization = context.req.header('authorization')
		authorizations.push(authorization)
		if (authorization !== 'Bearer secret-token') {
			return context.text('Unauthorized', 401)
		}
		await next()
	})
	app.route('/', createApp())
	const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
	try {
		await expect(
			connectRemoteKnowledgeBundle(`okb://127.0.0.1:${server.port}/bundle?insecure=true`)
		).rejects.toThrow()
		const connection = await connectRemoteKnowledgeBundle(
			`okb://127.0.0.1:${server.port}/bundle?insecure=true`,
			'Bearer secret-token'
		)
		if (connection.access !== 'editable') {
			throw new Error('Expected an editable remote bundle.')
		}
		await connection.bundle.list({ path: '/', depth: 1 })
		await connection.bundle.readFile({ path: '/welcome.md' })
		expect(authorizations).toEqual([
			undefined,
			'Bearer secret-token',
			'Bearer secret-token',
			'Bearer secret-token'
		])
	} finally {
		await server.stop(true)
	}
})

test('rejects a server response which ignores a requested read bound', async () => {
	const app = createApp(new IgnoringReadBoundBundle())
	const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
	try {
		const connection = await connectRemoteKnowledgeBundle(
			`okb://127.0.0.1:${server.port}/bundle?insecure=true`
		)
		await expect(
			connection.bundle.readFile({ path: '/welcome.md', maximumBytes: 8 })
		).rejects.toThrow('exceeded the requested file size limit')
	} finally {
		await server.stop(true)
	}
})

test('rejects a server response which ignores a requested patch result bound', async () => {
	const app = createApp(new IgnoringPatchBoundBundle())
	const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
	try {
		const connection = await connectRemoteKnowledgeBundle(
			`okb://127.0.0.1:${server.port}/bundle?insecure=true`
		)
		if (connection.access !== 'editable') {
			throw new Error('Expected an editable remote bundle.')
		}
		const file = await connection.bundle.readFile({ path: '/welcome.md' })
		if (!file) {
			throw new Error('Expected the welcome document.')
		}
		await expect(
			connection.bundle.patchFile({
				id: file.id,
				path: file.path,
				expectedRevision: file.revision,
				expectedContentHash: file.contentHash,
				maximumBytes: 8,
				edits: [{ oldText: '# Remote Knowledge Bundle', newText: '# Patched Bundle' }]
			})
		).rejects.toThrow('exceeded the requested patched file size limit')
	} finally {
		await server.stop(true)
	}
})

test('rejects inconsistent unchanged patch metadata from a remote server', async () => {
	const app = createApp(new InconsistentUnchangedPatchBundle())
	const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
	try {
		const connection = await connectRemoteKnowledgeBundle(
			`okb://127.0.0.1:${server.port}/bundle?insecure=true`
		)
		if (connection.access !== 'editable') {
			throw new Error('Expected an editable remote bundle.')
		}
		const file = await connection.bundle.readFile({ path: '/welcome.md' })
		if (!file) {
			throw new Error('Expected the welcome document.')
		}
		await expect(
			connection.bundle.patchFile({
				id: file.id,
				path: file.path,
				expectedRevision: file.revision,
				expectedContentHash: file.contentHash,
				edits: [{ oldText: '# Remote Knowledge Bundle', newText: '# Patched Bundle' }]
			})
		).rejects.toThrow('inconsistent unchanged patch metadata')
	} finally {
		await server.stop(true)
	}
})
