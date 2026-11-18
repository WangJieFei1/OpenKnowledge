import { describe, expect, test } from 'bun:test'
import { resolveAppEdition } from '../src/lib/app-edition'
import { assertEditionManifest, editionManifest } from './edition-build'

describe('edition packaging guard', () => {
	const general = resolveAppEdition('general')
	const codex = resolveAppEdition('codex')
	test('accepts matching build identities', () => {
		for (const edition of [general, codex]) {
			expect(() =>
				assertEditionManifest(editionManifest(edition, '0.0.3'), edition, '0.0.3')
			).not.toThrow()
		}
	})
	test('rejects stale or missing artifacts and capability mismatches', () => {
		for (const manifest of [
			null,
			{},
			editionManifest(codex, '0.0.3'),
			editionManifest(general, '0.0.2'),
			{ ...editionManifest(general, '0.0.3'), codexMemory: true }
		]) {
			expect(() => assertEditionManifest(manifest, general, '0.0.3')).toThrow()
		}
	})
})
