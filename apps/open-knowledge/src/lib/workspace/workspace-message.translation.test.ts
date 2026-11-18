import { expect, test } from 'bun:test'
import { mutationMessageID } from './workspace-message.translation'

test('maps transport-neutral mutation codes to workspace messages', () => {
	expect(
		mutationMessageID({ code: 'not_empty', message: 'Directory is not empty.' }, 'delete')
	).toBe('error.mutation.folder.not-empty')
	expect(
		mutationMessageID({ code: 'revision_conflict', message: 'The revision changed.' }, 'save')
	).toBe('error.mutation.document.save.conflict')
	expect(
		mutationMessageID({ code: 'not_found', message: 'error.mutation.entry.not-found' }, 'save')
	).toBe('error.mutation.document.not-found')
	expect(
		mutationMessageID(
			{ code: 'io_error', message: 'error.mutation.entry.rename.conflict' },
			'rename'
		)
	).toBe('error.mutation.entry.rename.conflict')
})
