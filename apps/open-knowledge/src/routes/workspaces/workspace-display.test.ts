import { describe, expect, test } from 'bun:test'
import type { Workspace } from '#lib/knowledge/api.js'
import { errorDetail, workspaceLocation } from './workspace-display'

describe('workspace display', () => {
	test('redacts remote credentials and query values while preserving insecure mode', () => {
		const workspace = {
			id: 'remote',
			kind: 'remote',
			name: 'Remote notes',
			uri: 'okb://user:password@knowledge.example/bundles/main?token=secret&insecure=true#section',
			lastOpenedAt: '2026-08-16T00:00:00.000Z'
		} satisfies Workspace

		expect(workspaceLocation(workspace)).toBe(
			'okb://knowledge.example/bundles/main?insecure=true#section'
		)
		expect(workspaceLocation({ ...workspace, uri: 'not a URI' })).toBe('okb://...')
	})

	test('normalizes and bounds error details', () => {
		expect(errorDetail(new Error('  open\nfailed  '))).toBe('open failed')
		expect(errorDetail('x'.repeat(513))).toBe('x'.repeat(512))
		expect(errorDetail({ message: 42 })).toBeNull()
	})
})
