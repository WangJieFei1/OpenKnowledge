import { createHash } from 'node:crypto'
import type {
	EditableKnowledgeBundle,
	KnowledgeBundle,
	KnowledgeBundleAccess,
	KnowledgeBundleInfo,
	ReadonlyKnowledgeBundle
} from '@open-knowledge/knowledge-bundle-api'
import { newHttpBatchRpcSession, type RpcStub } from 'capnweb'
import * as v from 'valibot'
import {
	CreateKnowledgeBundleDirectoryResultSchema,
	CreateKnowledgeBundleFileResultSchema,
	DeleteKnowledgeBundleEntryResultSchema,
	KnowledgeBundleFileSchema,
	KnowledgeBundleInfoSchema,
	KnowledgeBundleListingSchema,
	MoveKnowledgeBundleEntryResultSchema,
	PatchKnowledgeBundleFileResultSchema,
	WriteKnowledgeBundleFileResultSchema
} from '../../src/lib/knowledge/api'

const REMOTE_RPC_TIMEOUT_MS = 15_000

export type RemoteKnowledgeBundleLocation = {
	readonly uri: string
	readonly endpoint: URL
}

export type RemoteKnowledgeBundleConnection =
	| {
			readonly access: 'readonly'
			readonly bundle: ReadonlyKnowledgeBundle
	  }
	| {
			readonly access: 'editable'
			readonly bundle: EditableKnowledgeBundle
	  }

type ReadonlyBundle = ReadonlyKnowledgeBundle
type EditableBundle = EditableKnowledgeBundle

export function remoteKnowledgeBundleLocation(input: string): RemoteKnowledgeBundleLocation {
	const candidate = input.trim()
	if (candidate.includes('#')) {
		throw new TypeError('Remote knowledge bundle URIs cannot contain fragments.')
	}
	const uri = new URL(candidate)
	if (uri.protocol !== 'okb:' || !uri.hostname || uri.hash) {
		throw new TypeError('Use an okb:// endpoint without a fragment.')
	}
	if (uri.username || uri.password) {
		throw new TypeError('Remote knowledge bundle URIs cannot contain credentials.')
	}
	const insecureValues = uri.searchParams.getAll('insecure')
	if (insecureValues.length > 1) {
		throw new TypeError('Remote knowledge bundle URIs can contain at most one insecure parameter.')
	}
	const protocol = insecureValues[0] === 'true' ? 'http:' : 'https:'
	if (protocol === 'http:' && !isLoopbackHostname(uri.hostname)) {
		throw new TypeError(
			'Insecure remote knowledge bundle connections are restricted to loopback hosts.'
		)
	}
	const endpoint = new URL(uri.href.replace(/^okb:/, protocol))
	endpoint.searchParams.delete('insecure')
	const canonicalURI = new URL(endpoint.href.replace(/^https?:/, 'okb:'))
	if (protocol === 'http:') {
		canonicalURI.searchParams.append('insecure', 'true')
	}
	return { uri: canonicalURI.href, endpoint }
}

function isLoopbackHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

export function remoteKnowledgeBundleName(uri: string): string {
	const location = remoteKnowledgeBundleLocation(uri)
	const path = location.endpoint.pathname.replace(/^\/+|\/+$/g, '')
	return path ? `${location.endpoint.host}/${path}` : location.endpoint.host
}

export async function connectRemoteKnowledgeBundle(
	input: string,
	authorization?: string | null
): Promise<RemoteKnowledgeBundleLocation & RemoteKnowledgeBundleConnection> {
	const location = remoteKnowledgeBundleLocation(input)
	using bundle = newHttpBatchRpcSession<KnowledgeBundle>(
		rpcRequest(location.endpoint, authorization)
	)
	const info = v.parse(KnowledgeBundleInfoSchema, await bundle.getInfo())
	return info.access === 'editable'
		? {
				...location,
				access: 'editable',
				bundle: new RemoteEditable(location.endpoint, authorization)
			}
		: {
				...location,
				access: 'readonly',
				bundle: new RemoteReadonly(location.endpoint, authorization)
			}
}

class RemoteKnowledgeBundle<Access extends KnowledgeBundleAccess> implements KnowledgeBundle<
	unknown,
	Access
> {
	constructor(
		private readonly endpoint: URL,
		private readonly access: Access,
		private readonly authorization?: string | null
	) {}

	async getInfo(): Promise<KnowledgeBundleInfo<unknown, Access>> {
		using bundle = this.session<KnowledgeBundle>()
		const info = v.parse(remoteInfoSchema(this.access), await bundle.getInfo())
		return { access: this.access, metadata: info.metadata }
	}

	async list(
		input: Parameters<KnowledgeBundle['list']>[0]
	): Promise<Awaited<ReturnType<KnowledgeBundle['list']>>> {
		using bundle = this.session<KnowledgeBundle>()
		return v.parse(remoteListingSchema(input.limit), await bundle.list(input))
	}

	async readFile(
		input: Parameters<KnowledgeBundle['readFile']>[0]
	): Promise<Awaited<ReturnType<KnowledgeBundle['readFile']>>> {
		using bundle = this.session<KnowledgeBundle>()
		return v.parse(remoteFileSchema(input.maximumBytes), await bundle.readFile(input))
	}

	protected session<Contract extends KnowledgeBundle>(): RpcStub<Contract> {
		return newHttpBatchRpcSession<Contract>(rpcRequest(this.endpoint, this.authorization))
	}
}

function remoteInfoSchema(access: KnowledgeBundleAccess) {
	return v.pipe(
		KnowledgeBundleInfoSchema,
		v.check(
			(info) => info.access === access,
			'The remote knowledge bundle access changed while it was connected.'
		)
	)
}

function remoteListingSchema(limit: number | undefined) {
	return v.nullable(
		v.pipe(
			KnowledgeBundleListingSchema,
			v.check(
				(listing) => limit === undefined || listing.entries.length <= limit,
				'The remote knowledge bundle exceeded the requested listing limit.'
			)
		)
	)
}

function remoteFileSchema(maximumBytes: number | undefined) {
	return v.nullable(
		v.pipe(
			KnowledgeBundleFileSchema,
			v.check(
				(file) => new TextEncoder().encode(file.content).byteLength === file.byteLength,
				'The remote knowledge bundle returned inconsistent file metadata.'
			),
			v.check(
				(file) => maximumBytes === undefined || file.byteLength <= maximumBytes,
				'The remote knowledge bundle exceeded the requested file size limit.'
			),
			v.check(
				(file) => createHash('sha256').update(file.content).digest('hex') === file.contentHash,
				'The remote knowledge bundle returned an invalid content hash.'
			)
		)
	)
}

function rpcRequest(endpoint: URL, authorization?: string | null): Request {
	return new Request(endpoint.href, {
		redirect: 'error',
		signal: AbortSignal.timeout(REMOTE_RPC_TIMEOUT_MS),
		...(authorization ? { headers: { Authorization: authorization } } : {})
	})
}

class RemoteReadonly extends RemoteKnowledgeBundle<'readonly'> implements ReadonlyBundle {
	constructor(endpoint: URL, authorization?: string | null) {
		super(endpoint, 'readonly', authorization)
	}
}

class RemoteEditable extends RemoteKnowledgeBundle<'editable'> implements EditableBundle {
	constructor(endpoint: URL, authorization?: string | null) {
		super(endpoint, 'editable', authorization)
	}

	async createDirectory(
		input: Parameters<EditableKnowledgeBundle['createDirectory']>[0]
	): Promise<Awaited<ReturnType<EditableKnowledgeBundle['createDirectory']>>> {
		using bundle = this.session<EditableKnowledgeBundle>()
		return v.parse(CreateKnowledgeBundleDirectoryResultSchema, await bundle.createDirectory(input))
	}

	async createFile(
		input: Parameters<EditableKnowledgeBundle['createFile']>[0]
	): Promise<Awaited<ReturnType<EditableKnowledgeBundle['createFile']>>> {
		using bundle = this.session<EditableKnowledgeBundle>()
		return v.parse(CreateKnowledgeBundleFileResultSchema, await bundle.createFile(input))
	}

	async writeFile(
		input: Parameters<EditableKnowledgeBundle['writeFile']>[0]
	): Promise<Awaited<ReturnType<EditableKnowledgeBundle['writeFile']>>> {
		using bundle = this.session<EditableKnowledgeBundle>()
		return v.parse(WriteKnowledgeBundleFileResultSchema, await bundle.writeFile(input))
	}

	async patchFile(
		input: Parameters<EditableKnowledgeBundle['patchFile']>[0]
	): Promise<Awaited<ReturnType<EditableKnowledgeBundle['patchFile']>>> {
		using bundle = this.session<EditableKnowledgeBundle>()
		return v.parse(remotePatchResultSchema(input), await bundle.patchFile(input))
	}

	async moveEntry(
		input: Parameters<EditableKnowledgeBundle['moveEntry']>[0]
	): Promise<Awaited<ReturnType<EditableKnowledgeBundle['moveEntry']>>> {
		using bundle = this.session<EditableKnowledgeBundle>()
		return v.parse(MoveKnowledgeBundleEntryResultSchema, await bundle.moveEntry(input))
	}

	async deleteEntry(
		input: Parameters<EditableKnowledgeBundle['deleteEntry']>[0]
	): Promise<Awaited<ReturnType<EditableKnowledgeBundle['deleteEntry']>>> {
		using bundle = this.session<EditableKnowledgeBundle>()
		return v.parse(DeleteKnowledgeBundleEntryResultSchema, await bundle.deleteEntry(input))
	}
}

function remotePatchResultSchema(input: Parameters<EditableKnowledgeBundle['patchFile']>[0]) {
	return v.pipe(
		PatchKnowledgeBundleFileResultSchema,
		v.check((result) => {
			if (!result.ok) {
				return true
			}
			const { file } = result.value
			const separator = file.path.lastIndexOf('/')
			const expectedParentPath = separator === 0 ? '/' : file.path.slice(0, separator)
			const expectedName = file.path.slice(separator + 1)
			return (
				file.path !== '/' && file.parentPath === expectedParentPath && file.name === expectedName
			)
		}, 'The remote knowledge bundle returned incoherent patched file metadata.'),
		v.check(
			(result) => !result.ok || input.id !== undefined || result.value.file.path === input.path,
			'The remote knowledge bundle returned a mismatched patched file path.'
		),
		v.check(
			(result) =>
				!result.ok ||
				input.maximumBytes === undefined ||
				result.value.file.byteLength <= input.maximumBytes,
			'The remote knowledge bundle exceeded the requested patched file size limit.'
		),
		v.check((result) => {
			if (!result.ok || result.value.status !== 'unchanged') {
				return true
			}
			const { file } = result.value
			return (
				(input.expectedRevision === undefined || file.revision === input.expectedRevision) &&
				(input.expectedContentHash === undefined ||
					file.contentHash === input.expectedContentHash) &&
				(input.id === undefined || file.id === input.id)
			)
		}, 'The remote knowledge bundle returned inconsistent unchanged patch metadata.'),
		v.check((result) => {
			if (!result.ok || result.value.status !== 'patched') {
				return true
			}
			const { file } = result.value
			return (
				(input.expectedContentHash === undefined ||
					file.contentHash !== input.expectedContentHash) &&
				(input.id !== file.id ||
					input.expectedRevision === undefined ||
					file.revision !== input.expectedRevision)
			)
		}, 'The remote knowledge bundle returned unchanged metadata for a patched file.'),
		v.check((result) => {
			if (
				result.ok ||
				(result.error.code !== 'patch_not_found' && result.error.code !== 'patch_ambiguous')
			) {
				return true
			}
			return result.error.editNumber !== undefined && result.error.editNumber <= input.edits.length
		}, 'The remote knowledge bundle returned an invalid patch error index.')
	)
}
