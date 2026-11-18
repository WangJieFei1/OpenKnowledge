import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
	InvalidBundlePathError,
	parseBundlePath,
	type MutationMessageID
} from '@open-knowledge/knowledge-bundle'
import type { KnowledgeBundlePath } from '@open-knowledge/knowledge-bundle-api'
import { nodeErrorCode } from './node-error'

export type PathPolicyErrorCode = 'invalid_name' | 'invalid_path' | 'not_found'

export class PathPolicyError extends Error {
	override readonly name = 'PathPolicyError'

	constructor(
		readonly code: PathPolicyErrorCode,
		readonly messageID: MutationMessageID
	) {
		super(messageID)
	}
}

export function filesystemPathIdentity(stats: {
	dev: bigint
	ino: bigint
	birthtimeNs: bigint
	ctimeNs: bigint
}): string {
	const stableBirthtime = stats.birthtimeNs > 0n && stats.birthtimeNs !== stats.ctimeNs
	return `${stats.dev}:${stats.ino}${stableBirthtime ? `:${stats.birthtimeNs}` : ''}`
}

export function matchesFilesystemPathIdentity(
	expected: string,
	stats: { dev: bigint; ino: bigint; birthtimeNs: bigint }
): boolean {
	const base = `${stats.dev}:${stats.ino}`
	return expected === base || expected === `${base}:${stats.birthtimeNs}`
}

export async function canonicalizeRoot(candidate: string): Promise<string> {
	const root = await realpath(candidate)
	const stats = await lstat(root)
	if (!stats.isDirectory()) {
		throw new PathPolicyError('invalid_path', 'error.mutation.workspace.not-directory')
	}
	return root
}

export function validateEntryName(name: string): string {
	if (!name.trim() || name === '.' || name === '..') {
		throw new PathPolicyError('invalid_name', 'error.mutation.name.required')
	}
	if (
		/[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
		/^ |[. ]$/.test(name) ||
		name.includes('\u{10ffff}')
	) {
		throw new PathPolicyError('invalid_name', 'error.mutation.name.unsupported')
	}
	if (Buffer.byteLength(name, 'utf8') > 240) {
		throw new PathPolicyError('invalid_name', 'error.mutation.name.too-long')
	}

	const portableBase = name.split('.', 1)[0]?.trim().toLowerCase() ?? ''
	if (/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/.test(portableBase)) {
		throw new PathPolicyError('invalid_name', 'error.mutation.name.reserved')
	}
	return name
}

/** Converts the canonical API path to the relative path used by the confined filesystem helpers. */
export function internalBundlePath(bundlePath: KnowledgeBundlePath): string {
	if (bundlePath === '/') {
		return ''
	}
	if (!bundlePath.startsWith('/')) {
		throw new PathPolicyError('invalid_path', 'error.mutation.path.not-portable')
	}
	const relative = bundlePath.slice(1)
	validatedBundlePathSegments(relative)
	return relative
}

/** Converts a validated relative filesystem-helper path to the canonical API representation. */
export function absoluteBundlePath(bundlePath: string): KnowledgeBundlePath {
	validatedBundlePathSegments(bundlePath)
	return bundlePath ? `/${bundlePath}` : '/'
}

export async function resolveExistingPath(root: string, bundlePath: string): Promise<string> {
	const segments = validatedBundlePathSegments(bundlePath)
	const rootStats = await lstat(root)
	if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
		throw new PathPolicyError('invalid_path', 'error.mutation.workspace.root-unavailable')
	}
	let current = root

	for (const segment of segments) {
		current = path.join(current, segment)
		let stats
		try {
			stats = await lstat(current)
		} catch (error) {
			if (nodeErrorCode(error) === 'ENOENT') {
				throw new PathPolicyError('not_found', 'error.mutation.entry.not-found')
			}
			throw error
		}
		if (stats.isSymbolicLink()) {
			throw new PathPolicyError('invalid_path', 'error.mutation.path.symlink')
		}
	}
	if (process.platform === 'win32') {
		await assertCanonicalWindowsPath(root, current, segments)
	}

	return current
}

export async function resolveNewPath(root: string, bundlePath: string): Promise<string> {
	const segments = validatedBundlePathSegments(bundlePath)
	if (segments.length === 0) {
		throw new PathPolicyError('invalid_path', 'error.mutation.workspace.root-replace')
	}
	const parent = segments.slice(0, -1).join('/')
	const parentPath = await resolveExistingPath(root, parent)
	const parentStats = await lstat(parentPath)
	if (!parentStats.isDirectory()) {
		throw new PathPolicyError('invalid_path', 'error.mutation.parent.not-folder')
	}
	return path.join(parentPath, segments.at(-1) ?? '')
}

export function relativeBundlePath(root: string, absolutePath: string): string | null {
	const relative = path.relative(root, absolutePath)
	if (!relative || relative === '.') {
		return ''
	}
	if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		return null
	}
	return relative.split(path.sep).join('/')
}

function validatedBundlePathSegments(bundlePath: string): string[] {
	try {
		const segments = parseBundlePath(bundlePath)
		for (const segment of segments) {
			validateEntryName(segment)
		}
		return segments
	} catch (error) {
		if (error instanceof PathPolicyError) {
			throw error
		}
		if (!(error instanceof InvalidBundlePathError)) {
			throw error
		}
		const messageID =
			bundlePath.includes('\\') || bundlePath.startsWith('/') || bundlePath.includes('\0')
				? 'error.mutation.path.not-portable'
				: 'error.mutation.path.not-canonical'
		throw new PathPolicyError('invalid_path', messageID)
	}
}

async function assertCanonicalWindowsPath(
	root: string,
	resolvedPath: string,
	requestedSegments: readonly string[]
): Promise<void> {
	const canonicalPath = await realpath(resolvedPath)
	const canonicalRelativePath = relativeBundlePath(root, canonicalPath)
	if (canonicalRelativePath === null) {
		throw new PathPolicyError('invalid_path', 'error.mutation.path.not-portable')
	}
	const canonicalSegments = canonicalRelativePath ? canonicalRelativePath.split('/') : []
	if (
		canonicalSegments.length !== requestedSegments.length ||
		canonicalSegments.some(
			(segment, index) => segment.toLowerCase() !== requestedSegments[index]?.toLowerCase()
		)
	) {
		throw new PathPolicyError('invalid_path', 'error.mutation.path.not-canonical')
	}
}
