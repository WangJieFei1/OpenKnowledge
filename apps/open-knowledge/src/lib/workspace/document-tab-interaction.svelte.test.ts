import { plugin } from 'bun'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { compileModule } from 'svelte/compiler'
import ts from 'typescript'
import { readTabTransferToken, writeTabTransferToken } from '../window/tab-transfer-data'
import type { WorkspaceDocumentTab, WorkspaceSession } from './workspace-session.svelte'

const TOKEN = '11111111-1111-4111-8111-111111111111'
const elementDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Element')

plugin({
	name: 'document-tab-interaction-runes-test-loader',
	setup(build) {
		build.onLoad({ filter: /document-tab-interaction\.svelte\.ts$/ }, async ({ path }) => {
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

const { DocumentTabInteraction } = await import('./document-tab-interaction.svelte')

type Bounds = {
	left: number
	top: number
	width: number
	height: number
}

class TestElement extends EventTarget {
	readonly clientWidth: number

	constructor(
		private readonly bounds: Bounds,
		private readonly closestElement: TestElement | null = null,
		clientWidth = bounds.width
	) {
		super()
		this.clientWidth = clientWidth
	}

	closest(selector: string): TestElement | null {
		return selector === '[role="tablist"]' ? this.closestElement : null
	}

	getBoundingClientRect(): DOMRect {
		return {
			left: this.bounds.left,
			top: this.bounds.top,
			width: this.bounds.width,
			height: this.bounds.height,
			right: this.bounds.left + this.bounds.width,
			bottom: this.bounds.top + this.bounds.height
		} as DOMRect
	}
}

class TestDataTransfer {
	effectAllowed: DataTransfer['effectAllowed'] = 'uninitialized'
	dropEffect: DataTransfer['dropEffect'] = 'none'
	private readonly data = new Map<string, string>()

	get types(): readonly string[] {
		return [...this.data.keys()]
	}

	clearData(format?: string): void {
		if (format) {
			this.data.delete(format)
		} else {
			this.data.clear()
		}
	}

	getData(format: string): string {
		return this.data.get(format) ?? ''
	}

	setData(format: string, value: string): void {
		this.data.set(format, value)
	}

	asDataTransfer(): DataTransfer {
		return this as unknown as DataTransfer
	}
}

type DragEventOptions = {
	dataTransfer?: DataTransfer | null
	target?: EventTarget | null
	currentTarget?: EventTarget | null
	clientX?: number
	clientY?: number
}

function dragEvent(options: DragEventOptions = {}): DragEvent {
	let defaultPrevented = false
	return {
		dataTransfer: options.dataTransfer ?? null,
		target: options.target ?? null,
		currentTarget: options.currentTarget ?? null,
		clientX: options.clientX ?? 0,
		clientY: options.clientY ?? 0,
		get defaultPrevented() {
			return defaultPrevented
		},
		preventDefault() {
			defaultPrevented = true
		},
		stopPropagation() {}
	} as unknown as DragEvent
}

type SessionCalls = {
	selected: string[]
	moved: Array<[string, -1 | 1]>
	prepared: Array<[string, string]>
	cancelled: string[]
	tornOff: Array<[string, string]>
	received: Array<[string, number | undefined]>
	opened: Array<[string | undefined, 'workspace' | 'editor' | undefined]>
}

type SessionOverrides = {
	prepareTabTransfer?: WorkspaceSession['prepareTabTransfer']
	openDocumentInNewWindow?: WorkspaceSession['openDocumentInNewWindow']
}

function createSession(
	tabs: WorkspaceDocumentTab[],
	overrides: SessionOverrides = {}
): { session: WorkspaceSession; calls: SessionCalls } {
	const calls: SessionCalls = {
		selected: [],
		moved: [],
		prepared: [],
		cancelled: [],
		tornOff: [],
		received: [],
		opened: []
	}
	const session = {
		tabs,
		draggingTabID: null,
		selectTab(tabID: string) {
			calls.selected.push(tabID)
		},
		moveTab(tabID: string, direction: -1 | 1) {
			calls.moved.push([tabID, direction])
			const index = tabs.findIndex((candidate) => candidate.id === tabID)
			const nextIndex = index + direction
			if (index < 0 || nextIndex < 0 || nextIndex >= tabs.length) {
				return
			}
			const [moved] = tabs.splice(index, 1)
			if (moved) {
				tabs.splice(nextIndex, 0, moved)
			}
		},
		prepareTabTransfer:
			overrides.prepareTabTransfer ??
			(async (tabID: string, token: string) => {
				calls.prepared.push([tabID, token])
				return true
			}),
		async cancelTabTransfer(token: string) {
			calls.cancelled.push(token)
		},
		async tearOffTab(tabID: string, token: string) {
			calls.tornOff.push([tabID, token])
			return true
		},
		async receiveTabTransfer(token: string, insertionIndex?: number) {
			calls.received.push([token, insertionIndex])
			return true
		},
		openDocumentInNewWindow:
			overrides.openDocumentInNewWindow ??
			(async (path: string | undefined, presentation: 'workspace' | 'editor' | undefined) => {
				calls.opened.push([path, presentation])
				return true
			})
	} as unknown as WorkspaceSession
	return { session, calls }
}

function tab(id: string): WorkspaceDocumentTab {
	return {
		id,
		path: `/${id}.md`,
		loading: false
	} as WorkspaceDocumentTab
}

function tabIDs(tabs: WorkspaceDocumentTab[]): string[] {
	return tabs.map((candidate) => candidate.id)
}

async function settle(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

beforeAll(() => {
	Object.defineProperty(globalThis, 'Element', {
		configurable: true,
		value: TestElement
	})
})

afterAll(() => {
	if (elementDescriptor) {
		Object.defineProperty(globalThis, 'Element', elementDescriptor)
	} else {
		Reflect.deleteProperty(globalThis, 'Element')
	}
})

describe('DocumentTabInteraction', () => {
	test('uses exact midpoints while reordering and restores the origin on Escape', async () => {
		const tabs = [tab('a'), tab('b'), tab('c')]
		const { session, calls } = createSession(tabs)
		const interaction = new DocumentTabInteraction(session, { createToken: () => TOKEN })
		const transfer = new TestDataTransfer()
		const target = new TestElement({ left: 200, top: 0, width: 100, height: 32 })

		interaction.dragStart(dragEvent({ dataTransfer: transfer.asDataTransfer() }), tabs[1]!)

		expect(interaction.draggingTabID).toBe('b')
		expect(session.draggingTabID).toBe('b')
		expect(calls.selected).toEqual(['b'])
		expect(transfer.effectAllowed).toBe('copyMove')
		expect(readTabTransferToken(transfer.asDataTransfer())).toBe(TOKEN)

		interaction.dragOver(dragEvent({ currentTarget: target, clientX: 250 }), tabs[2]!)
		expect(tabIDs(tabs)).toEqual(['a', 'b', 'c'])
		interaction.dragOver(dragEvent({ currentTarget: target, clientX: 251 }), tabs[2]!)
		expect(tabIDs(tabs)).toEqual(['a', 'c', 'b'])
		interaction.dragOver(dragEvent({ currentTarget: target, clientX: 250 }), tabs[1]!)
		expect(tabIDs(tabs)).toEqual(['a', 'c', 'b'])
		interaction.dragOver(dragEvent({ currentTarget: target, clientX: 249 }), tabs[1]!)
		expect(tabIDs(tabs)).toEqual(['a', 'b', 'c'])
		interaction.dragOver(dragEvent({ currentTarget: target, clientX: 251 }), tabs[2]!)
		expect(tabIDs(tabs)).toEqual(['a', 'c', 'b'])

		interaction.cancelDrag({ key: 'Escape' } as KeyboardEvent)
		interaction.dragEnd(dragEvent({ dataTransfer: transfer.asDataTransfer() }), tabs[2]!)
		await settle()

		expect(tabIDs(tabs)).toEqual(['a', 'b', 'c'])
		expect(interaction.draggingTabID).toBeNull()
		expect(session.draggingTabID).toBeNull()
		expect(calls.cancelled).toEqual([TOKEN])
		interaction.dispose()
	})

	test('cancels a local drop instead of tearing the tab off', async () => {
		const tabs = [tab('a'), tab('b')]
		const { session, calls } = createSession(tabs)
		const interaction = new DocumentTabInteraction(session, { createToken: () => TOKEN })
		const transfer = new TestDataTransfer()
		const tabList = new TestElement({ left: 0, top: 0, width: 200, height: 32 })
		const trigger = new TestElement({ left: 0, top: 0, width: 100, height: 32 }, tabList)

		interaction.dragStart(dragEvent({ dataTransfer: transfer.asDataTransfer() }), tabs[0]!)
		const drop = dragEvent({ dataTransfer: transfer.asDataTransfer() })
		interaction.dropOnList(drop)
		interaction.dragEnd(
			dragEvent({
				dataTransfer: transfer.asDataTransfer(),
				currentTarget: trigger,
				clientX: 400,
				clientY: 16
			}),
			tabs[0]!
		)
		await settle()

		expect(drop.defaultPrevented).toBe(true)
		expect(calls.cancelled).toEqual([TOKEN])
		expect(calls.tornOff).toEqual([])
		interaction.dispose()
	})

	test('waits 140ms for a destination claim before tearing a tab off', async () => {
		const tabs = [tab('a')]
		const { session, calls } = createSession(tabs)
		const delays: number[] = []
		let releaseDelay: (() => void) | undefined
		const interaction = new DocumentTabInteraction(session, {
			createToken: () => TOKEN,
			delay: (milliseconds) => {
				delays.push(milliseconds)
				return new Promise((resolve) => {
					releaseDelay = resolve
				})
			}
		})
		const transfer = new TestDataTransfer()
		const tabList = new TestElement({ left: 0, top: 0, width: 100, height: 32 })
		const trigger = new TestElement({ left: 0, top: 0, width: 100, height: 32 }, tabList)

		interaction.dragStart(dragEvent({ dataTransfer: transfer.asDataTransfer() }), tabs[0]!)
		interaction.dragEnd(
			dragEvent({
				dataTransfer: transfer.asDataTransfer(),
				currentTarget: trigger,
				clientX: 200,
				clientY: 16
			}),
			tabs[0]!
		)
		await settle()

		expect(delays).toEqual([140])
		expect(calls.tornOff).toEqual([])
		releaseDelay?.()
		await settle()

		expect(calls.tornOff).toEqual([['a', TOKEN]])
		expect(calls.cancelled).toEqual([])
		interaction.dispose()
	})

	test('inserts cross-window drops on the correct side of the target midpoint', () => {
		const tabs = [tab('a'), tab('b'), tab('c')]
		const { session, calls } = createSession(tabs)
		const interaction = new DocumentTabInteraction(session)
		const transfer = new TestDataTransfer()
		writeTabTransferToken(transfer.asDataTransfer(), TOKEN)
		const target = new TestElement({ left: 100, top: 0, width: 80, height: 32 })

		const dragOver = dragEvent({ dataTransfer: transfer.asDataTransfer(), currentTarget: target })
		interaction.dragOver(dragOver, tabs[1]!)
		interaction.dropOnTab(
			dragEvent({ dataTransfer: transfer.asDataTransfer(), currentTarget: target, clientX: 140 }),
			tabs[1]!
		)
		interaction.dropOnTab(
			dragEvent({ dataTransfer: transfer.asDataTransfer(), currentTarget: target, clientX: 141 }),
			tabs[1]!
		)

		expect(dragOver.defaultPrevented).toBe(true)
		expect(transfer.dropEffect).toBe('move')
		expect(calls.received).toEqual([
			[TOKEN, 1],
			[TOKEN, 2]
		])
		interaction.dispose()
	})

	test('keeps opening a dedicated window behind a single loading mutex', async () => {
		const tabs = [tab('a'), tab('b')]
		let releaseOpen: (() => void) | undefined
		const opened: string[] = []
		const { session } = createSession(tabs, {
			openDocumentInNewWindow: async (path) => {
				opened.push(path ?? '')
				await new Promise<void>((resolve) => {
					releaseOpen = resolve
				})
				return true
			}
		})
		const interaction = new DocumentTabInteraction(session)

		const opening = interaction.openDedicated(tabs[0]!)
		expect(interaction.openingDedicatedTabID).toBe('a')
		await interaction.openDedicated(tabs[1]!)
		expect(opened).toEqual(['/a.md'])

		releaseOpen?.()
		await opening
		expect(interaction.openingDedicatedTabID).toBeNull()
		interaction.dispose()
	})

	test('dispose restores an active drag and cancels its prepared transfer', async () => {
		const tabs = [tab('a'), tab('b'), tab('c')]
		let resolvePreparation: ((ready: boolean) => void) | undefined
		const { session, calls } = createSession(tabs, {
			prepareTabTransfer: () =>
				new Promise((resolve) => {
					resolvePreparation = resolve
				})
		})
		const interaction = new DocumentTabInteraction(session, { createToken: () => TOKEN })
		const transfer = new TestDataTransfer()
		const target = new TestElement({ left: 200, top: 0, width: 100, height: 32 })

		interaction.dragStart(dragEvent({ dataTransfer: transfer.asDataTransfer() }), tabs[1]!)
		interaction.dragOver(dragEvent({ currentTarget: target, clientX: 251 }), tabs[2]!)
		expect(tabIDs(tabs)).toEqual(['a', 'c', 'b'])

		interaction.dispose()
		interaction.dispose()
		resolvePreparation?.(true)
		await settle()

		expect(tabIDs(tabs)).toEqual(['a', 'b', 'c'])
		expect(interaction.draggingTabID).toBeNull()
		expect(session.draggingTabID).toBeNull()
		expect(calls.cancelled).toEqual([TOKEN])
	})
})
