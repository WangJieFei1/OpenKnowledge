import {
	deleteFrontmatterProperty,
	renameFrontmatterProperty,
	updateFrontmatterProperty,
	type ParsedKnowledgeMarkdown
} from '@open-knowledge/knowledge-bundle/frontmatter'

type MutationFailureCode = 'update-failed' | 'rename-failed' | 'delete-failed'

export type PropertyMutationError =
	| { code: 'name-required' }
	| { code: 'property-exists'; key: string }
	| { code: MutationFailureCode }

export type PropertyMutationResult =
	{ ok: true; markdown: string } | { ok: false; error: PropertyMutationError }

export function addProperty(
	parsed: ParsedKnowledgeMarkdown,
	key: string,
	value: unknown
): PropertyMutationResult {
	const normalizedKey = key.trim()
	if (!normalizedKey) {
		return { ok: false, error: { code: 'name-required' } }
	}
	if (Object.hasOwn(parsed.frontmatter, normalizedKey)) {
		return { ok: false, error: { code: 'property-exists', key: normalizedKey } }
	}
	return updateProperty(parsed, normalizedKey, value)
}

export function updateProperty(
	parsed: ParsedKnowledgeMarkdown,
	key: string,
	value: unknown
): PropertyMutationResult {
	const normalizedKey = key.trim()
	if (!normalizedKey) {
		return { ok: false, error: { code: 'name-required' } }
	}
	return mutate('update-failed', () => updateFrontmatterProperty(parsed, normalizedKey, value))
}

export function renameProperty(
	parsed: ParsedKnowledgeMarkdown,
	key: string,
	nextKey: string
): PropertyMutationResult {
	const normalizedKey = nextKey.trim()
	if (!normalizedKey) {
		return { ok: false, error: { code: 'name-required' } }
	}
	if (normalizedKey !== key && Object.hasOwn(parsed.frontmatter, normalizedKey)) {
		return { ok: false, error: { code: 'property-exists', key: normalizedKey } }
	}
	return mutate('rename-failed', () => renameFrontmatterProperty(parsed, key, normalizedKey))
}

export function deleteProperty(
	parsed: ParsedKnowledgeMarkdown,
	key: string
): PropertyMutationResult {
	return mutate('delete-failed', () => deleteFrontmatterProperty(parsed, key))
}

function mutate(code: MutationFailureCode, mutation: () => string): PropertyMutationResult {
	try {
		return { ok: true, markdown: mutation() }
	} catch {
		return { ok: false, error: { code } }
	}
}
