import * as v from 'valibot'
import {
	AcceptedTabTransferSchema,
	TabTransferCommittedSchema,
	TabTransferStatusSchema,
	WindowStateSchema,
	type OpenDocumentWindowInput,
	type PrepareTabTransferInput,
	type TabTransferInput,
	type WindowAPI
} from '../../src/lib/window/api'
import { channels } from '../channels'
import { invoke, NullSchema, subscribe } from './transport'

export function createWindowAPI(): WindowAPI {
	return {
		getState() {
			return invoke(channels.windowGetState, undefined, WindowStateSchema)
		},
		async rendererReady() {
			await invoke(channels.windowRendererReady, undefined, NullSchema)
		},
		async openApplicationSettings() {
			await invoke(channels.windowOpenApplicationSettings, undefined, NullSchema)
		},
		async openDocumentWindow(input: OpenDocumentWindowInput) {
			await invoke(channels.windowOpenDocument, input, NullSchema)
		},
		async prepareTabTransfer(input: PrepareTabTransferInput) {
			await invoke(channels.windowPrepareTabTransfer, input, NullSchema)
		},
		acceptTabTransfer(input: TabTransferInput) {
			return invoke(channels.windowAcceptTabTransfer, input, AcceptedTabTransferSchema)
		},
		async commitTabTransfer(input: TabTransferInput) {
			await invoke(channels.windowCommitTabTransfer, input, NullSchema)
		},
		async cancelTabTransfer(input: TabTransferInput) {
			await invoke(channels.windowCancelTabTransfer, input, NullSchema)
		},
		tabTransferStatus(input: TabTransferInput) {
			return invoke(channels.windowTabTransferStatus, input, TabTransferStatusSchema)
		},
		async performEditAction(input) {
			await invoke(channels.windowEdit, input, NullSchema)
		},
		async minimize() {
			await invoke(channels.windowMinimize, undefined, NullSchema)
		},
		async toggleMaximize() {
			await invoke(channels.windowToggleMaximize, undefined, NullSchema)
		},
		async close() {
			await invoke(channels.windowClose, undefined, NullSchema)
		},
		onApplicationCommand(listener: (commandID: string) => void) {
			return subscribe(channels.applicationCommand, v.string(), listener)
		},
		onTabTransferCommitted(listener) {
			return subscribe(channels.tabTransferCommitted, TabTransferCommittedSchema, listener)
		},
		onMaximizedChange(listener: (maximized: boolean) => void) {
			return subscribe(channels.maximizedChange, v.boolean(), listener)
		}
	}
}
