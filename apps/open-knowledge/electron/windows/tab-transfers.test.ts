import { describe, expect, test } from 'bun:test'
import { TabTransfers, type TabTransferRegistration } from './tab-transfers'

const sourceToken = '11111111-1111-4111-8111-111111111111'
const secondToken = '22222222-2222-4222-8222-222222222222'

function registration(
	token = sourceToken,
	overrides: Partial<TabTransferRegistration> = {}
): TabTransferRegistration {
	return {
		token,
		sourceWebContentsID: 1,
		workspaceID: 'workspace-a',
		documentPath: '/notes/design.md',
		sourceTabID: 'document-tab-7',
		...overrides
	}
}

describe('TabTransfers', () => {
	test('enforces source and destination ownership', async () => {
		const transfers = new TabTransfers()
		transfers.register(registration())

		expect(() => transfers.status(sourceToken, 9)).toThrow('source window')
		expect(() => transfers.cancel(sourceToken, 9)).toThrow('source window')
		await expect(
			transfers.accept(sourceToken, {
				webContentsID: 1,
				workspaceID: 'workspace-a',
				presentation: 'workspace'
			})
		).rejects.toThrow('different window')

		transfers.register(registration(secondToken))
		await transfers.accept(secondToken, {
			webContentsID: 2,
			workspaceID: 'workspace-a',
			presentation: 'workspace'
		})
		expect(() => transfers.commit(secondToken, 3)).toThrow('accepting destination')
		transfers.dispose()
	})

	test('rejects and marks cross-workspace and dedicated destination drops', async () => {
		const transfers = new TabTransfers()
		transfers.register(registration())

		await expect(
			transfers.accept(sourceToken, {
				webContentsID: 2,
				workspaceID: 'workspace-b',
				presentation: 'workspace'
			})
		).rejects.toThrow('same workspace')
		expect(transfers.status(sourceToken, 1)).toBe('rejected')

		transfers.register(registration(secondToken))
		await expect(
			transfers.accept(secondToken, {
				webContentsID: 2,
				workspaceID: 'workspace-a',
				presentation: 'editor'
			})
		).rejects.toThrow('Dedicated document windows')
		expect(transfers.status(secondToken, 1)).toBe('rejected')
		transfers.dispose()
	})

	test('expires and cancels pending transfers', () => {
		let now = 1_000
		const transfers = new TabTransfers({ ttlMs: 100, now: () => now })
		transfers.register(registration())
		transfers.cancel(sourceToken, 1)
		expect(transfers.status(sourceToken, 1)).toBeNull()

		transfers.register(registration(secondToken))
		now += 101
		expect(transfers.status(secondToken, 1)).toBeNull()
		transfers.dispose()
	})

	test('commits once and retains a short-lived committed status', async () => {
		const transfers = new TabTransfers()
		transfers.register(registration())
		await transfers.accept(sourceToken, {
			webContentsID: 2,
			workspaceID: 'workspace-a',
			presentation: 'workspace'
		})

		expect(transfers.commit(sourceToken, 2)).toEqual({
			sourceWebContentsID: 1,
			sourceTabID: 'document-tab-7'
		})
		expect(transfers.status(sourceToken, 1)).toBe('committed')
		expect(() => transfers.commit(sourceToken, 2)).toThrow('once')
		expect(() => transfers.cancel(sourceToken, 1)).toThrow('cannot be cancelled')
		transfers.dispose()
	})

	test('cleans transfers when either owning window closes', async () => {
		const transfers = new TabTransfers()
		transfers.register(registration())
		transfers.removeWebContents(1)
		expect(transfers.status(sourceToken, 1)).toBeNull()

		transfers.register(registration(secondToken))
		await transfers.accept(secondToken, {
			webContentsID: 2,
			workspaceID: 'workspace-a',
			presentation: 'workspace'
		})
		transfers.removeWebContents(2)
		expect(transfers.status(secondToken, 1)).toBeNull()
		transfers.dispose()
	})

	test('waits briefly when destination acceptance races registration', async () => {
		const transfers = new TabTransfers({ acceptanceWaitMs: 100 })
		const accepted = transfers.accept(sourceToken, {
			webContentsID: 2,
			workspaceID: 'workspace-a',
			presentation: 'workspace'
		})
		transfers.register(registration())

		await expect(accepted).resolves.toEqual({
			token: sourceToken,
			documentPath: '/notes/design.md'
		})
		transfers.dispose()
	})

	test('rejects waiting acceptance when its destination closes', async () => {
		const transfers = new TabTransfers({ acceptanceWaitMs: 100 })
		const accepted = transfers.accept(sourceToken, {
			webContentsID: 2,
			workspaceID: 'workspace-a',
			presentation: 'workspace'
		})
		transfers.removeWebContents(2)
		await expect(accepted).rejects.toThrow('destination window was closed')
		transfers.dispose()
	})
})
