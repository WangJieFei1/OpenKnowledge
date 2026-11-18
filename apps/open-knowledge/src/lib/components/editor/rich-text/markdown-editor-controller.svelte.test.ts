import { plugin } from 'bun'
import { describe, expect, test } from 'bun:test'
import { compileModule } from 'svelte/compiler'
import ts from 'typescript'
import type { KnowledgeBundlePath } from '#lib/knowledge/api.js'
import type { MarkdownEditorControllerSnapshot } from './markdown-editor-controller.svelte'
import { shouldReplaceControlledMarkdown } from './markdown-editor-state'
import { slashCommandIDs, type SlashCommandSearchText } from './slash-commands/slash-commands'

plugin({
	name: 'markdown-editor-controller-runes-test-loader',
	setup(build) {
		build.onLoad({ filter: /markdown-editor-controller\.svelte\.ts$/ }, async ({ path }) => {
			const source = await Bun.file(path).text()
			const javascript = ts.transpileModule(source, {
				compilerOptions: {
					target: ts.ScriptTarget.ESNext,
					module: ts.ModuleKind.ESNext,
					verbatimModuleSyntax: true
				}
			}).outputText
			return {
				contents: compileModule(javascript, { filename: path, generate: 'client' }).js.code,
				loader: 'js'
			}
		})
	}
})

const { MarkdownEditorController } = await import('./markdown-editor-controller.svelte')

const documentPath = '/notes.md' as KnowledgeBundlePath
const reference = {
	kind: 'file' as const,
	path: '/reference.md' as KnowledgeBundlePath,
	label: 'Reference'
}
const slashCommandSearch = Object.fromEntries(
	slashCommandIDs.map((id) => [id, id])
) as SlashCommandSearchText

function snapshot(
	overrides: Partial<MarkdownEditorControllerSnapshot> = {}
): MarkdownEditorControllerSnapshot {
	return {
		markdown: 'Initial',
		disabled: false,
		readonly: false,
		editorControls: 'both',
		documentPath,
		documentPaths: [documentPath, reference.path],
		resolveAbsolutePathsFromProjectRoot: true,
		references: [reference],
		documentEditorLabel: 'Document editor',
		slashCommandSearch,
		onopenreference: () => undefined,
		onopensystempath: () => undefined,
		onchange: () => undefined,
		performEditAction: null,
		...overrides
	}
}

describe('Markdown editor state policies', () => {
	test('distinguishes parent echoes and unchanged inputs from authoritative replacements', () => {
		expect(shouldReplaceControlledMarkdown('Initial', 'Edited', 'Edited')).toBe(false)
		expect(shouldReplaceControlledMarkdown('Initial', 'Initial', 'Edited')).toBe(false)
		expect(shouldReplaceControlledMarkdown('Initial', 'External', 'Edited')).toBe(true)
		expect(shouldReplaceControlledMarkdown('Initial', 'Initial', 'Rejected edit', true)).toBe(true)
	})
})

describe('MarkdownEditorController lifecycle', () => {
	test('locking clears mutating transient UI and uses the latest snapshot', () => {
		const controller = new MarkdownEditorController(snapshot())
		controller.linkEditor = { from: 1, to: 2, left: 10, top: 20 }
		controller.imageEditor = { left: 10, top: 20, initialAlt: 'alt' }
		controller.selectionReference = {} as never
		controller.slashMatch = { from: 1, to: 2, query: '' }
		controller.slashCommands = ['image']
		controller.referenceMatch = { from: 3, to: 4, query: '' }
		controller.referenceResults = [reference]

		controller.synchronize(snapshot({ readonly: true }))

		expect(controller.editingDisabled).toBe(true)
		expect(controller.linkEditor).toBeNull()
		expect(controller.imageEditor).toBeNull()
		expect(controller.selectionReference).toBeNull()
		expect(controller.slashMatch).toBeNull()
		expect(controller.slashCommands).toEqual([])
		expect(controller.referenceMatch).toBeNull()
		expect(controller.referenceResults).toEqual([])

		controller.synchronize(snapshot())
		expect(controller.editingDisabled).toBe(false)
		controller.dispose()
	})
})
