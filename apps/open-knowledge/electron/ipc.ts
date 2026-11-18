import {
	ipcMain,
	type BrowserWindow,
	type IpcMainInvokeEvent as IPCMainInvokeEvent
} from 'electron'
import * as v from 'valibot'
import {
	CreateKnowledgeBundleDirectoryInputSchema,
	CreateKnowledgeBundleFileInputSchema,
	DeleteKnowledgeBundleEntryInputSchema,
	ListKnowledgeBundleInputSchema,
	MoveKnowledgeBundleEntryInputSchema,
	OpenSystemPathInputSchema,
	OpenWorkspaceInputSchema,
	PatchKnowledgeBundleFileInputSchema,
	ReadKnowledgeBundleFileInputSchema,
	SearchKnowledgeInputSchema,
	WorkspaceInputSchema,
	WriteKnowledgeBundleFileInputSchema
} from '../src/lib/knowledge/api'
import {
	MCPWorkspaceInputSchema,
	UpdateMCPEnabledInputSchema,
	UpdateMCPMemoryEnabledInputSchema,
	UpdateMCPWorkspaceInputSchema,
	type MCPManagementSnapshot
} from '../src/lib/mcp/api'
import { ResetSettingsInputSchema, UpdateSettingsInputSchema } from '../src/lib/settings/api'
import {
	OpenDocumentWindowInputSchema,
	PrepareTabTransferInputSchema,
	TabTransferInputSchema,
	WindowEditActionInputSchema,
	type DocumentWindowPresentation,
	type WindowRole
} from '../src/lib/window/api'
import {
	WorkspaceSelectorConnectInputSchema,
	WorkspaceSelectorOpenInputSchema
} from '../src/lib/workspace/selector-api'
import { channels } from './channels'
import type { WorkspaceMCPGateway } from './mcp/workspace-gateway'
import type { SettingsService } from './settings/settings-service'
import type { ApplicationWindows } from './windows/application-windows'
import type { TabTransfers } from './windows/tab-transfers'
import type { WorkspaceManager } from './workspace/workspace-manager'

export function registerKnowledgeIPC(
	manager: WorkspaceManager,
	settings: SettingsService,
	mcpGateway: WorkspaceMCPGateway,
	windows: ApplicationWindows,
	tabTransfers: TabTransfers
): () => void {
	const searchControllers = new Map<number, AbortController>()
	ipcMain.handle(channels.openWorkspace, (event, input: unknown) => {
		const parsed = v.parse(OpenWorkspaceInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.openWorkspace(parsed, false)
	})
	ipcMain.handle(channels.refreshWorkspace, (event, input: unknown) => {
		const parsed = v.parse(WorkspaceInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.refreshWorkspace(parsed)
	})
	ipcMain.handle(channels.bundleInfo, (event, input: unknown) => {
		const parsed = v.parse(WorkspaceInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.getInfo(parsed)
	})
	ipcMain.handle(channels.listEntries, (event, input: unknown) => {
		const parsed = v.parse(ListKnowledgeBundleInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.list(parsed)
	})
	ipcMain.handle(channels.search, async (event, input: unknown) => {
		const parsed = v.parse(SearchKnowledgeInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		const senderID = event.sender.id
		searchControllers.get(senderID)?.abort()
		const controller = new AbortController()
		searchControllers.set(senderID, controller)
		try {
			return await manager.search(parsed, controller.signal)
		} finally {
			if (searchControllers.get(senderID) === controller) {
				searchControllers.delete(senderID)
			}
		}
	})
	ipcMain.handle(channels.readFile, (event, input: unknown) => {
		const parsed = v.parse(ReadKnowledgeBundleFileInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.readFile(parsed)
	})
	ipcMain.handle(channels.readRenderedDocument, (event, input: unknown) => {
		const parsed = v.parse(ReadKnowledgeBundleFileInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.readRenderedDocument(parsed)
	})
	ipcMain.handle(channels.createDirectory, (event, input: unknown) => {
		const parsed = v.parse(CreateKnowledgeBundleDirectoryInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.createDirectory(parsed)
	})
	ipcMain.handle(channels.createFile, (event, input: unknown) => {
		const parsed = v.parse(CreateKnowledgeBundleFileInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.createFile(parsed)
	})
	ipcMain.handle(channels.writeFile, (event, input: unknown) => {
		const parsed = v.parse(WriteKnowledgeBundleFileInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.writeFile(parsed)
	})
	ipcMain.handle(channels.patchFile, (event, input: unknown) => {
		const parsed = v.parse(PatchKnowledgeBundleFileInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.patchFile(parsed)
	})
	ipcMain.handle(channels.moveEntry, (event, input: unknown) => {
		const parsed = v.parse(MoveKnowledgeBundleEntryInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.moveEntry(parsed)
	})
	ipcMain.handle(channels.deleteEntry, (event, input: unknown) => {
		const parsed = v.parse(DeleteKnowledgeBundleEntryInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return manager.deleteEntry(parsed)
	})
	ipcMain.handle(channels.openSystemPath, async (event, input: unknown) => {
		const parsed = v.parse(OpenSystemPathInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		await manager.openSystemPath(
			parsed,
			async () => !(await settings.get(parsed.workspaceID)).resolveAbsolutePathsFromProjectRoot
		)
		return null
	})
	ipcMain.handle(channels.revealWorkspace, async (event, input: unknown) => {
		const parsed = v.parse(WorkspaceInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		await manager.revealWorkspace(parsed)
		return null
	})

	ipcMain.handle(channels.selectorSnapshot, (event) => {
		assertTrustedSender(event, windows, ['selector'])
		return manager.selectorSnapshot()
	})
	ipcMain.handle(channels.selectorBrowse, (event) => {
		const window = trustedWindow(event, windows, ['selector'])
		return manager.browseWorkspace(window)
	})
	ipcMain.handle(channels.selectorConnect, (event, input: unknown) => {
		const parsed = v.parse(WorkspaceSelectorConnectInputSchema, input)
		assertTrustedSender(event, windows, ['selector'])
		return manager.connectRemoteWorkspace(parsed.uri, parsed.authorization ?? null)
	})
	ipcMain.handle(channels.selectorSelect, async (event, input: unknown) => {
		const parsed = v.parse(WorkspaceInputSchema, input)
		assertTrustedSender(event, windows, ['selector'])
		await manager.openWorkspace(parsed, true)
		const forceReload = manager.consumeWorkspaceReauthorization(parsed.workspaceID)
		setTimeout(() => {
			void windows
				.completeSelector(event.sender, parsed.workspaceID, forceReload)
				.catch((error: unknown) => {
					console.error('The workspace selection could not be completed.', error)
				})
		}, 0)
		return null
	})
	ipcMain.handle(channels.selectorOpen, async (event, input: unknown) => {
		const parsed = v.parse(WorkspaceSelectorOpenInputSchema, input)
		const window = trustedWindow(event, windows, ['workspace'])
		await windows.showSelector(parsed, window)
		return null
	})

	ipcMain.handle(channels.settingsGet, (event) => {
		assertTrustedSender(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		return settings.get(windows.settingsWorkspaceIDFor(event.sender))
	})
	ipcMain.handle(channels.settingsInspect, (event) => {
		assertTrustedSender(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		return settings.inspect(windows.settingsWorkspaceIDFor(event.sender))
	})
	ipcMain.handle(channels.settingsUpdate, (event, input: unknown) => {
		assertTrustedSender(event, windows, ['workspace', 'selector', 'settings'])
		const parsed = v.parse(UpdateSettingsInputSchema, input)
		if (
			Object.hasOwn(parsed.patch, 'resolveAbsolutePathsFromProjectRoot') &&
			windows.roleFor(event.sender) !== 'settings'
		) {
			throw new Error('System path resolution can only be changed from the Settings window.')
		}
		return settings.update(windows.settingsWorkspaceIDFor(event.sender), parsed)
	})
	ipcMain.handle(channels.settingsReset, (event, input: unknown) => {
		assertTrustedSender(event, windows, ['workspace', 'selector', 'settings'])
		const parsed = v.parse(ResetSettingsInputSchema, input)
		if (
			parsed.keys.includes('resolveAbsolutePathsFromProjectRoot') &&
			windows.roleFor(event.sender) !== 'settings'
		) {
			throw new Error('System path resolution can only be changed from the Settings window.')
		}
		return settings.reset(windows.settingsWorkspaceIDFor(event.sender), parsed)
	})

	ipcMain.handle(channels.mcpGet, (event, input: unknown) => {
		const parsed = v.parse(MCPWorkspaceInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		return mcpGateway.status(parsed)
	})
	ipcMain.handle(channels.mcpOpenSettings, async (event) => {
		assertTrustedSender(event, windows, ['workspace'])
		await windows.showMCPSettings()
		return null
	})
	ipcMain.handle(channels.mcpManagementSnapshot, (event) => {
		assertTrustedSender(event, windows, ['mcp'])
		const registered = manager.mcpWorkspaceIDs().map((workspaceID) => {
			const label = manager.mcpWorkspaceLabel(workspaceID)
			if (!label) {
				throw new Error('A registered MCP workspace is unavailable.')
			}
			return { workspaceID, label }
		})
		const labelCounts = new Map<string, number>()
		for (const { label } of registered) {
			labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
		}
		const workspaces = registered.map(({ workspaceID, label }) => {
			const displayLabel =
				(labelCounts.get(label) ?? 0) > 1 ? `${label} (${workspaceID.slice(0, 6)})` : label
			return { ...mcpGateway.status({ workspaceID }), label: displayLabel }
		})
		return {
			enabled: mcpGateway.enabled(),
			memoryEnabled: mcpGateway.memoryEnabled(),
			workspaces
		} satisfies MCPManagementSnapshot
	})
	ipcMain.handle(channels.mcpUpdate, (event, input: unknown) => {
		const parsed = v.parse(UpdateMCPWorkspaceInputSchema, input)
		assertMCPWorkspaceSender(event, windows, parsed.workspaceID)
		return mcpGateway.update(parsed)
	})
	ipcMain.handle(channels.mcpSetEnabled, async (event, input: unknown) => {
		assertTrustedSender(event, windows, ['mcp'])
		const parsed = v.parse(UpdateMCPEnabledInputSchema, input)
		await mcpGateway.setEnabled(parsed.enabled)
		return null
	})
	ipcMain.handle(channels.mcpSetMemoryEnabled, async (event, input: unknown) => {
		assertTrustedSender(event, windows, ['mcp'])
		const parsed = v.parse(UpdateMCPMemoryEnabledInputSchema, input)
		await mcpGateway.setMemoryEnabled(parsed.enabled)
		return null
	})
	ipcMain.handle(channels.mcpRevealConnection, (event, input: unknown) => {
		const parsed = v.parse(MCPWorkspaceInputSchema, input)
		assertTrustedSender(event, windows, ['mcp'])
		return mcpGateway.revealConnection(parsed)
	})
	ipcMain.handle(channels.mcpRegenerateCredential, (event, input: unknown) => {
		const parsed = v.parse(MCPWorkspaceInputSchema, input)
		assertTrustedSender(event, windows, ['mcp'])
		return mcpGateway.regenerateCredential(parsed)
	})

	ipcMain.handle(channels.windowGetState, (event) => {
		assertTrustedSender(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		const state = windows.stateFor(event.sender)
		if (!state) {
			throw new Error('The application window is not available.')
		}
		return state
	})
	ipcMain.handle(channels.windowRendererReady, (event) => {
		assertTrustedSender(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		windows.rendererReady(event.sender)
		return null
	})
	ipcMain.handle(channels.windowOpenApplicationSettings, async (event) => {
		assertTrustedSender(event, windows, ['workspace', 'selector', 'mcp'])
		await windows.showApplicationSettings(windows.workspaceIDFor(event.sender))
		return null
	})
	ipcMain.handle(channels.windowOpenDocument, async (event, input: unknown) => {
		const parsed = v.parse(OpenDocumentWindowInputSchema, input)
		assertWorkspaceSender(event, windows, parsed.workspaceID)
		const { presentation, ...locator } = parsed
		const documentPath = await manager.resolveDocument(locator)
		if (!documentPath) {
			throw new Error('The document no longer exists.')
		}
		await windows.openDocumentWindow(parsed.workspaceID, documentPath, presentation)
		return null
	})
	ipcMain.handle(channels.windowPrepareTabTransfer, async (event, input: unknown) => {
		const parsed = v.parse(PrepareTabTransferInputSchema, input)
		const source = normalWorkspaceSender(event, windows)
		tabTransfers.register({
			token: parsed.token,
			sourceWebContentsID: event.sender.id,
			workspaceID: source.workspaceID,
			documentPath: parsed.path,
			sourceTabID: parsed.sourceTabID
		})
		return null
	})
	ipcMain.handle(channels.windowAcceptTabTransfer, (event, input: unknown) => {
		const parsed = v.parse(TabTransferInputSchema, input)
		const destination = workspaceSender(event, windows)
		return tabTransfers
			.accept(parsed.token, {
				webContentsID: event.sender.id,
				workspaceID: destination.workspaceID,
				presentation: destination.presentation
			})
			.then((transfer) => ({ token: transfer.token, path: transfer.documentPath }))
	})
	ipcMain.handle(channels.windowCommitTabTransfer, (event, input: unknown) => {
		const parsed = v.parse(TabTransferInputSchema, input)
		assertTrustedSender(event, windows, ['workspace'])
		const committed = tabTransfers.commit(parsed.token, event.sender.id)
		const source = windows.webContentsForID(committed.sourceWebContentsID)
		if (!source) {
			throw new Error('The source window is no longer available.')
		}
		source.send(channels.tabTransferCommitted, {
			token: parsed.token,
			sourceTabID: committed.sourceTabID
		})
		return null
	})
	ipcMain.handle(channels.windowCancelTabTransfer, (event, input: unknown) => {
		const parsed = v.parse(TabTransferInputSchema, input)
		normalWorkspaceSender(event, windows)
		tabTransfers.cancel(parsed.token, event.sender.id)
		return null
	})
	ipcMain.handle(channels.windowTabTransferStatus, (event, input: unknown) => {
		const parsed = v.parse(TabTransferInputSchema, input)
		normalWorkspaceSender(event, windows)
		return tabTransfers.status(parsed.token, event.sender.id)
	})
	ipcMain.handle(channels.windowEdit, (event, input: unknown) => {
		const parsed = v.parse(WindowEditActionInputSchema, input)
		const window = trustedWindow(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		if (parsed.action === 'undo') {
			window.webContents.undo()
		} else if (parsed.action === 'redo') {
			window.webContents.redo()
		} else if (parsed.action === 'cut') {
			window.webContents.cut()
		} else if (parsed.action === 'copy') {
			window.webContents.copy()
		} else if (parsed.action === 'paste') {
			window.webContents.paste()
		} else {
			window.webContents.selectAll()
		}
		return null
	})
	ipcMain.handle(channels.windowMinimize, (event) => {
		const window = trustedWindow(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		window.minimize()
		return null
	})
	ipcMain.handle(channels.windowToggleMaximize, (event) => {
		const window = trustedWindow(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		if (window.isMaximized()) {
			window.unmaximize()
		} else {
			window.maximize()
		}
		return null
	})
	ipcMain.handle(channels.windowClose, (event) => {
		const window = trustedWindow(event, windows, ['workspace', 'selector', 'mcp', 'settings'])
		setTimeout(() => {
			window.close()
		}, 0)
		return null
	})

	const unsubscribeWorkspace = manager.subscribe((change) => {
		windows.broadcastWorkspaceChange(change)
	})
	const unsubscribeSettings = settings.subscribe(({ workspaceID }) => {
		void windows
			.broadcastSettingsChange(workspaceID, (contextWorkspaceID) =>
				settings.get(contextWorkspaceID)
			)
			.catch((error: unknown) => {
				console.error('Settings changes could not be broadcast.', error)
			})
	})
	const unsubscribeMCP = mcpGateway.subscribe((status) => {
		windows.broadcastMCPChange(status)
	})
	return () => {
		for (const controller of searchControllers.values()) {
			controller.abort()
		}
		searchControllers.clear()
		unsubscribeWorkspace()
		unsubscribeSettings()
		unsubscribeMCP()
		tabTransfers.dispose()
	}
}

function normalWorkspaceSender(
	event: IPCMainInvokeEvent,
	windows: ApplicationWindows
): { workspaceID: string; presentation: 'workspace' } {
	const sender = workspaceSender(event, windows)
	if (sender.presentation !== 'workspace') {
		throw new Error('Dedicated document windows cannot transfer tabs.')
	}
	return sender as { workspaceID: string; presentation: 'workspace' }
}

function workspaceSender(
	event: IPCMainInvokeEvent,
	windows: ApplicationWindows
): { workspaceID: string; presentation: DocumentWindowPresentation } {
	assertTrustedSender(event, windows, ['workspace'])
	const workspaceID = windows.workspaceIDFor(event.sender)
	const presentation = windows.presentationFor(event.sender)
	if (!workspaceID || !presentation) {
		throw new Error('The workspace window is not available.')
	}
	return { workspaceID, presentation }
}

function assertWorkspaceSender(
	event: IPCMainInvokeEvent,
	windows: ApplicationWindows,
	workspaceID: string
): void {
	assertTrustedSender(event, windows, ['workspace'])
	if (windows.workspaceIDFor(event.sender) !== workspaceID) {
		throw new Error('Rejected IPC for a workspace not assigned to the sender.')
	}
}

function assertMCPWorkspaceSender(
	event: IPCMainInvokeEvent,
	windows: ApplicationWindows,
	workspaceID: string
): void {
	assertTrustedSender(event, windows, ['workspace', 'mcp'])
	if (
		windows.roleFor(event.sender) === 'workspace' &&
		windows.workspaceIDFor(event.sender) !== workspaceID
	) {
		throw new Error('Rejected IPC for a workspace not assigned to the sender.')
	}
}

function trustedWindow(
	event: IPCMainInvokeEvent,
	windows: ApplicationWindows,
	roles: WindowRole[]
): BrowserWindow {
	assertTrustedSender(event, windows, roles)
	const window = windows.windowFor(event.sender)
	if (!window) {
		throw new Error('The application window is not available.')
	}
	return window
}

function assertTrustedSender(
	event: IPCMainInvokeEvent,
	windows: ApplicationWindows,
	roles: WindowRole[]
): void {
	const role = windows.roleFor(event.sender)
	if (!role || !roles.includes(role) || event.senderFrame !== event.sender.mainFrame) {
		throw new Error('Rejected IPC from an untrusted renderer.')
	}
}
