import type { KnowledgeBundlePath } from '#lib/knowledge/api.js'
import type { ApplicationSettings } from '#lib/settings/api.js'
import type { WindowEditActionInput } from '#lib/window/api.js'
import type { VirtualElement } from '@floating-ui/dom'
import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { canInsertInlineNode, insertImage } from './prosemirror/commands'
import {
	parseMarkdown,
	serializeMarkdown,
	withMarkdownTrailingLineBreaks
} from './prosemirror/markdown'
import { createEditorPlugins } from './prosemirror/plugins'
import { editorMark, editorNode, editorSchema } from './prosemirror/schema'
import { resolveMarkdownLinkTarget } from './links/markdown-links'
import {
	clampSelectedIndex,
	retainDismissedTrigger,
	shouldReplaceControlledMarkdown
} from './markdown-editor-state'
import {
	detectReference,
	filterReferences,
	insertReference,
	type WorkspaceReference,
	type ReferenceMatch
} from './references/references'
import {
	detectSlashCommand,
	filterSlashCommands,
	runSlashCommand,
	type SlashCommandID,
	type SlashCommandMatch,
	type SlashCommandSearchText
} from './slash-commands/slash-commands'

type LinkEditor = {
	from: number
	to: number
	left: number
	top: number
}

type ImageEditor = {
	left: number
	top: number
	initialAlt: string
}

export type MarkdownEditorControllerSnapshot = {
	markdown: string
	disabled: boolean
	readonly: boolean
	editorControls: ApplicationSettings['editorControls']
	documentPath: KnowledgeBundlePath
	documentPaths: KnowledgeBundlePath[]
	resolveAbsolutePathsFromProjectRoot: boolean
	references: WorkspaceReference[]
	documentEditorLabel: string
	slashCommandSearch: SlashCommandSearchText
	onopenreference: (path: KnowledgeBundlePath) => void
	onopensystempath: (path: string) => void
	onchange: (markdown: string) => void
	performEditAction: ((input: WindowEditActionInput) => Promise<void> | void) | null
}

export class MarkdownEditorController {
	readonly referenceMenuID = 'knowledge-reference-menu'
	readonly slashMenuID = 'slash-command-menu'

	editorState = $state.raw<EditorState | null>(null)
	slashMatch = $state.raw<SlashCommandMatch | null>(null)
	referenceMatch = $state.raw<ReferenceMatch | null>(null)
	slashCommands = $state.raw<SlashCommandID[]>([])
	referenceResults = $state.raw<WorkspaceReference[]>([])
	selectedIndex = $state(0)
	popupLeft = $state(0)
	popupTop = $state(0)
	linkEditor = $state.raw<LinkEditor | null>(null)
	imageEditor = $state.raw<ImageEditor | null>(null)
	selectionReference = $state.raw<VirtualElement | null>(null)

	private snapshot = $state.raw<MarkdownEditorControllerSnapshot | null>(null)
	private view = $state.raw<EditorView | null>(null)
	private lastRendered: string
	private dismissedSlashFrom: number | null = null
	private dismissedReferenceFrom: number | null = null
	private positionFrame: number | undefined
	private selectionUpdatePending = false
	private readonly editFrames: number[] = []
	private browserWindow: (Window & typeof globalThis) | null = null
	private browserDocument: Document | null = null
	private visualViewport: VisualViewport | null = null
	private mounted = false
	private disposed = false

	constructor(snapshot: MarkdownEditorControllerSnapshot) {
		this.snapshot = snapshot
		this.lastRendered = snapshot.markdown
	}

	get editingDisabled(): boolean {
		const snapshot = this.snapshot
		return !snapshot || snapshot.disabled || snapshot.readonly
	}

	synchronize(snapshot: MarkdownEditorControllerSnapshot): void {
		if (this.disposed) {
			return
		}
		const previous = this.currentSnapshot()
		const wasEditingDisabled = this.editingDisabled
		const nextEditingDisabled = snapshot.disabled || snapshot.readonly
		const markdownChanged = snapshot.markdown !== previous.markdown
		const replaceMarkdown = shouldReplaceControlledMarkdown(
			previous.markdown,
			snapshot.markdown,
			this.lastRendered,
			nextEditingDisabled
		)
		const assistsChanged =
			snapshot.references !== previous.references ||
			snapshot.editorControls !== previous.editorControls ||
			snapshot.slashCommandSearch !== previous.slashCommandSearch

		this.snapshot = snapshot
		if (this.editingDisabled) {
			this.clearMutatingTransientUI()
		}
		if (!this.mounted) {
			if (markdownChanged) {
				this.lastRendered = snapshot.markdown
			}
			return
		}

		this.synchronizeEditorARIA()
		if (replaceMarkdown) {
			this.replaceMarkdown(snapshot.markdown)
			return
		}
		if (!this.editingDisabled && (wasEditingDisabled || assistsChanged)) {
			this.updateMenus()
			this.schedulePositionUpdate()
		}
	}

	mount(host: HTMLDivElement): void {
		if (this.mounted || this.disposed) {
			return
		}
		const browserDocument = host.ownerDocument
		const browserWindow = browserDocument.defaultView
		if (!browserWindow) {
			throw new Error('The Markdown editor requires a browser window.')
		}

		const snapshot = this.currentSnapshot()
		const state = this.createState(snapshot.markdown)
		this.browserDocument = browserDocument
		this.browserWindow = browserWindow
		this.visualViewport = browserWindow.visualViewport
		this.lastRendered = snapshot.markdown
		this.editorState = state
		this.view = new EditorView(host, {
			state,
			attributes: this.editorAttributes(),
			editable: () => !this.editingDisabled,
			dispatchTransaction: this.dispatchTransaction,
			handleKeyDown: (_view, event) => this.handlePopupKeydown(event),
			handleClick: (_view, _position, event) => this.openInternalLink(event),
			handleDOMEvents: {
				focus: () => {
					this.schedulePositionUpdate()
					return false
				},
				blur: () => {
					this.selectionReference = null
					return false
				}
			}
		})
		this.mounted = true
		this.updateMenus()
		this.schedulePositionUpdate()
		browserWindow.addEventListener('resize', this.scheduleViewportUpdate)
		browserDocument.addEventListener('scroll', this.scheduleViewportUpdate, true)
		this.visualViewport?.addEventListener('resize', this.scheduleViewportUpdate)
		this.visualViewport?.addEventListener('scroll', this.scheduleViewportUpdate)
	}

	dispose(): void {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.browserWindow?.removeEventListener('resize', this.scheduleViewportUpdate)
		this.browserDocument?.removeEventListener('scroll', this.scheduleViewportUpdate, true)
		this.visualViewport?.removeEventListener('resize', this.scheduleViewportUpdate)
		this.visualViewport?.removeEventListener('scroll', this.scheduleViewportUpdate)
		this.cancelPositionUpdate()
		if (this.browserWindow) {
			for (const frame of this.editFrames) {
				this.browserWindow.cancelAnimationFrame(frame)
			}
		}
		this.editFrames.length = 0
		this.view?.destroy()
		this.view = null
		this.editorState = null
		this.slashMatch = null
		this.referenceMatch = null
		this.slashCommands = []
		this.referenceResults = []
		this.linkEditor = null
		this.imageEditor = null
		this.selectionReference = null
		this.browserWindow = null
		this.browserDocument = null
		this.visualViewport = null
		this.mounted = false
	}

	run = (command: Command): boolean => {
		const view = this.mutableView()
		if (!view) {
			return false
		}
		const handled = command(view.state, view.dispatch, view)
		if (handled) {
			view.focus()
			this.schedulePositionUpdate()
		}
		return handled
	}

	editLink = (): void => {
		const view = this.mutableView()
		const browserWindow = this.browserWindow
		if (!view || !browserWindow || view.state.selection.empty) {
			return
		}
		const { from, to } = view.state.selection
		const link = editorMark('link')
		if (view.state.doc.rangeHasMark(from, to, link)) {
			view.dispatch(view.state.tr.removeMark(from, to, link))
			view.focus()
			return
		}
		const coordinates = view.coordsAtPos(to)
		this.linkEditor = {
			from,
			to,
			left: Math.max(8, Math.min(coordinates.left, browserWindow.innerWidth - 338)),
			top: Math.max(8, Math.min(coordinates.bottom + 6, browserWindow.innerHeight - 48))
		}
		this.imageEditor = null
		this.selectionReference = null
	}

	applyLink = (href: string): void => {
		const view = this.mutableView()
		const linkEditor = this.linkEditor
		if (!view || !linkEditor) {
			return
		}
		if (
			linkEditor.from < 0 ||
			linkEditor.from >= linkEditor.to ||
			linkEditor.to > view.state.doc.content.size
		) {
			this.linkEditor = null
			return
		}
		const link = editorMark('link')
		view.dispatch(
			view.state.tr.addMark(linkEditor.from, linkEditor.to, link.create({ href, title: null }))
		)
		this.linkEditor = null
		view.focus()
		this.schedulePositionUpdate()
	}

	closeLinkEditor = (): void => {
		this.linkEditor = null
	}

	editImage = (): void => {
		const view = this.mutableView()
		const browserWindow = this.browserWindow
		if (!view || !browserWindow || !canInsertInlineNode(view.state, editorNode('image'))) {
			return
		}
		const { from, to } = view.state.selection
		const coordinates = view.coordsAtPos(to)
		const width = Math.min(360, browserWindow.innerWidth - 16)
		const height = 116
		const below = coordinates.bottom + 6
		this.imageEditor = {
			left: Math.max(8, Math.min(coordinates.left, browserWindow.innerWidth - width - 8)),
			top:
				below + height <= browserWindow.innerHeight - 8
					? below
					: Math.max(8, coordinates.top - height - 6),
			initialAlt: view.state.doc.textBetween(from, to, ' ')
		}
		this.linkEditor = null
		this.selectionReference = null
	}

	applyImage = (src: string, alt: string, title: string | null): void => {
		if (!this.imageEditor || !this.mutableView()) {
			return
		}
		this.imageEditor = null
		this.run(insertImage(editorSchema, src, alt, title))
	}

	closeImageEditor = (): void => {
		this.imageEditor = null
	}

	edit = (action: WindowEditActionInput['action']): void => {
		const browserWindow = this.browserWindow
		if (!browserWindow || this.disposed) {
			return
		}
		const frame = browserWindow.requestAnimationFrame(() => {
			const frameIndex = this.editFrames.indexOf(frame)
			if (frameIndex >= 0) {
				this.editFrames.splice(frameIndex, 1)
			}
			const view = action === 'copy' ? this.view : this.mutableView()
			if (!view || this.disposed) {
				return
			}
			view.focus()
			void this.currentSnapshot().performEditAction?.({ action })
		})
		this.editFrames.push(frame)
	}

	restoreEditorFocus = (): void => {
		this.view?.focus()
	}

	selectSlashCommand = (commandID: SlashCommandID): void => {
		const view = this.mutableView()
		if (!view || !this.slashMatch) {
			return
		}
		const match = this.slashMatch
		this.dismissedSlashFrom = match.from
		this.clearMenus()
		if (runSlashCommand(view, match, commandID) === 'image') {
			this.editImage()
		}
	}

	selectReference = (reference: WorkspaceReference): void => {
		const view = this.mutableView()
		if (!view || !this.referenceMatch) {
			return
		}
		const match = this.referenceMatch
		this.dismissedReferenceFrom = match.from
		this.clearMenus()
		const snapshot = this.currentSnapshot()
		insertReference(
			view,
			match,
			reference,
			snapshot.documentPath,
			snapshot.resolveAbsolutePathsFromProjectRoot
		)
	}

	private currentSnapshot(): MarkdownEditorControllerSnapshot {
		const snapshot = this.snapshot
		if (!snapshot) {
			throw new Error('The Markdown editor controller has no snapshot.')
		}
		return snapshot
	}

	private mutableView(): EditorView | null {
		return this.disposed || this.editingDisabled ? null : this.view
	}

	private createState(value: string): EditorState {
		return EditorState.create({
			doc: parseMarkdown(value),
			schema: editorSchema,
			plugins: createEditorPlugins()
		})
	}

	private replaceMarkdown(markdown: string): void {
		const view = this.view
		if (!view) {
			return
		}
		const state = this.createState(markdown)
		this.lastRendered = markdown
		this.clearPositionBearingUI()
		this.editorState = state
		view.updateState(state)
		this.updateMenus()
		this.schedulePositionUpdate()
	}

	private dispatchTransaction = (transaction: Transaction): void => {
		const view = this.view
		if (!view || this.disposed) {
			return
		}
		if (transaction.docChanged && this.editingDisabled) {
			this.clearMutatingTransientUI()
			return
		}
		const nextState = view.state.apply(transaction)
		view.updateState(nextState)
		this.editorState = nextState
		this.updateMenus()
		this.schedulePositionUpdate()
		if (!transaction.docChanged) {
			return
		}
		const output = withMarkdownTrailingLineBreaks(
			serializeMarkdown(nextState.doc),
			this.lastRendered
		)
		this.lastRendered = output
		this.currentSnapshot().onchange(output)
	}

	private synchronizeEditorARIA(): void {
		const view = this.view
		if (!view) {
			return
		}
		const snapshot = this.currentSnapshot()
		view.setProps({ editable: () => !this.editingDisabled })
		view.dom.setAttribute('aria-label', snapshot.documentEditorLabel)
		view.dom.setAttribute('role', snapshot.readonly ? 'document' : 'textbox')
		view.dom.removeAttribute('aria-readonly')
		view.dom.toggleAttribute('aria-multiline', !snapshot.readonly)
	}

	private editorAttributes(): Record<string, string> {
		const snapshot = this.currentSnapshot()
		return {
			role: snapshot.readonly ? 'document' : 'textbox',
			'aria-label': snapshot.documentEditorLabel,
			...(snapshot.readonly ? {} : { 'aria-multiline': 'true' })
		}
	}

	private updateMenus(): void {
		const view = this.view
		if (!view || this.editingDisabled) {
			this.clearMenus()
			return
		}
		const snapshot = this.currentSnapshot()
		const nextReference = detectReference(view.state)
		const slashEnabled = snapshot.editorControls === 'slash' || snapshot.editorControls === 'both'
		const nextSlash = slashEnabled ? detectSlashCommand(view.state) : null
		this.dismissedReferenceFrom = retainDismissedTrigger(
			this.dismissedReferenceFrom,
			nextReference?.from ?? null
		)
		this.dismissedSlashFrom = retainDismissedTrigger(
			this.dismissedSlashFrom,
			nextSlash?.from ?? null
		)

		if (nextReference && nextReference.from !== this.dismissedReferenceFrom) {
			const queryChanged = this.referenceMatch?.query !== nextReference.query
			const results = filterReferences(snapshot.references, nextReference.query)
			this.referenceMatch = nextReference
			this.referenceResults = results
			this.slashMatch = null
			this.slashCommands = []
			this.selectedIndex = queryChanged ? 0 : clampSelectedIndex(this.selectedIndex, results.length)
			this.updatePopupPosition(nextReference.to, 300, 340)
			this.synchronizePopupARIA()
			return
		}

		this.referenceMatch = null
		this.referenceResults = []
		if (nextSlash && nextSlash.from !== this.dismissedSlashFrom) {
			const queryChanged = this.slashMatch?.query !== nextSlash.query
			const commands = filterSlashCommands(nextSlash.query, snapshot.slashCommandSearch)
			this.slashMatch = nextSlash
			this.slashCommands = commands
			this.selectedIndex = queryChanged
				? 0
				: clampSelectedIndex(this.selectedIndex, commands.length)
			this.updatePopupPosition(nextSlash.to, 248, 360)
			this.synchronizePopupARIA()
			return
		}

		this.slashMatch = null
		this.slashCommands = []
		this.synchronizePopupARIA()
	}

	private clearMenus(): void {
		this.slashMatch = null
		this.referenceMatch = null
		this.slashCommands = []
		this.referenceResults = []
		this.synchronizePopupARIA()
	}

	private synchronizePopupARIA(): void {
		const view = this.view
		if (!view) {
			return
		}
		const menuID = this.referenceMatch
			? this.referenceMenuID
			: this.slashMatch
				? this.slashMenuID
				: null
		const itemCount = this.referenceMatch
			? this.referenceResults.length
			: this.slashMatch
				? this.slashCommands.length
				: 0
		const optionID =
			menuID && this.selectedIndex < itemCount ? `${menuID}-option-${this.selectedIndex}` : null
		if (!menuID) {
			view.dom.removeAttribute('aria-controls')
			view.dom.removeAttribute('aria-activedescendant')
			view.dom.removeAttribute('aria-autocomplete')
			view.dom.removeAttribute('aria-haspopup')
			view.dom.removeAttribute('aria-expanded')
			return
		}
		view.dom.setAttribute('aria-controls', menuID)
		view.dom.setAttribute('aria-autocomplete', 'list')
		view.dom.setAttribute('aria-haspopup', 'listbox')
		view.dom.setAttribute('aria-expanded', 'true')
		if (optionID) {
			view.dom.setAttribute('aria-activedescendant', optionID)
		} else {
			view.dom.removeAttribute('aria-activedescendant')
		}
	}

	private updatePopupPosition(position: number, width: number, height: number): void {
		const view = this.view
		const browserWindow = this.browserWindow
		if (!view || !browserWindow) {
			return
		}
		const coordinates = view.coordsAtPos(position)
		this.popupLeft = Math.max(8, Math.min(coordinates.left, browserWindow.innerWidth - width - 8))
		const below = coordinates.bottom + 6
		this.popupTop =
			below + height <= browserWindow.innerHeight - 8
				? below
				: Math.max(8, coordinates.top - height - 6)
	}

	private scheduleViewportUpdate = (): void => {
		this.schedulePositionUpdate(false)
	}

	private schedulePositionUpdate(updateSelection = true): void {
		const browserWindow = this.browserWindow
		if (!browserWindow || this.disposed) {
			return
		}
		this.selectionUpdatePending ||= updateSelection
		if (this.positionFrame !== undefined) {
			return
		}
		this.positionFrame = browserWindow.requestAnimationFrame(() => {
			this.positionFrame = undefined
			if (this.disposed) {
				return
			}
			if (this.referenceMatch) {
				this.updatePopupPosition(this.referenceMatch.to, 300, 340)
			} else if (this.slashMatch) {
				this.updatePopupPosition(this.slashMatch.to, 248, 360)
			}
			if (this.selectionUpdatePending) {
				this.selectionUpdatePending = false
				this.updateSelectionToolbar()
			}
		})
	}

	private cancelPositionUpdate(): void {
		if (this.positionFrame !== undefined) {
			this.browserWindow?.cancelAnimationFrame(this.positionFrame)
			this.positionFrame = undefined
		}
		this.selectionUpdatePending = false
	}

	private updateSelectionToolbar(): void {
		const view = this.view
		const browserWindow = this.browserWindow
		if (
			!view ||
			!browserWindow ||
			this.editingDisabled ||
			this.linkEditor ||
			this.imageEditor ||
			!view.hasFocus() ||
			!(view.state.selection instanceof TextSelection) ||
			view.state.selection.empty
		) {
			this.selectionReference = null
			return
		}

		const nativeSelection = browserWindow.getSelection()
		if (!nativeSelection || nativeSelection.rangeCount === 0) {
			this.selectionReference = null
			return
		}
		const range = nativeSelection.getRangeAt(0).cloneRange()
		if (!view.dom.contains(range.commonAncestorContainer)) {
			this.selectionReference = null
			return
		}
		const bounds = range.getBoundingClientRect()
		if (bounds.width === 0 && bounds.height === 0) {
			this.selectionReference = null
			return
		}
		this.selectionReference = {
			getBoundingClientRect: () => range.getBoundingClientRect(),
			getClientRects: () => range.getClientRects(),
			contextElement: view.dom
		}
	}

	private handlePopupKeydown(event: KeyboardEvent): boolean {
		if (event.isComposing || event.keyCode === 229) {
			return false
		}
		const itemCount = this.referenceMatch
			? this.referenceResults.length
			: this.slashMatch
				? this.slashCommands.length
				: 0
		if (!this.referenceMatch && !this.slashMatch) {
			return false
		}
		if (event.key === 'Escape') {
			if (this.referenceMatch) {
				this.dismissedReferenceFrom = this.referenceMatch.from
			} else if (this.slashMatch) {
				this.dismissedSlashFrom = this.slashMatch.from
			}
			this.clearMenus()
			return true
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (itemCount === 0) {
				return false
			}
			const direction = event.key === 'ArrowDown' ? 1 : -1
			this.selectedIndex = (this.selectedIndex + direction + itemCount) % itemCount
			this.synchronizePopupARIA()
			return true
		}
		if (event.key === 'Enter') {
			if (itemCount === 0) {
				return false
			}
			if (this.referenceMatch) {
				const reference = this.referenceResults[this.selectedIndex]
				if (reference) {
					this.selectReference(reference)
				}
			} else if (this.slashMatch) {
				const command = this.slashCommands[this.selectedIndex]
				if (command) {
					this.selectSlashCommand(command)
				}
			}
			return true
		}
		return false
	}

	private openInternalLink(event: MouseEvent): boolean {
		const browserWindow = this.browserWindow
		if (!browserWindow || (!event.metaKey && !event.ctrlKey)) {
			return false
		}
		const target = event.target instanceof browserWindow.Element ? event.target.closest('a') : null
		const href = target?.getAttribute('href')
		if (!href) {
			return false
		}
		const snapshot = this.currentSnapshot()
		const link = resolveMarkdownLinkTarget(
			href,
			snapshot.documentPath,
			snapshot.resolveAbsolutePathsFromProjectRoot
		)
		if (!link) {
			return false
		}
		event.preventDefault()
		if (link.kind === 'system') {
			snapshot.onopensystempath(link.path)
		} else if (snapshot.documentPaths.includes(link.path)) {
			snapshot.onopenreference(link.path)
		}
		return true
	}

	private clearMutatingTransientUI(): void {
		this.clearPositionBearingUI()
	}

	private clearPositionBearingUI(): void {
		this.cancelPositionUpdate()
		this.dismissedSlashFrom = null
		this.dismissedReferenceFrom = null
		this.linkEditor = null
		this.imageEditor = null
		this.selectionReference = null
		this.clearMenus()
	}
}
