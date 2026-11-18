import * as v from 'valibot'
import { KnowledgeBundlePathSchema, WorkspaceEntryLocatorSchema } from '../knowledge/api'
import { object, UUIDSchema } from '../validation'

export const WindowRoleSchema = v.picklist(['workspace', 'selector', 'mcp', 'settings'])
export const DocumentWindowPresentationSchema = v.picklist(['workspace', 'editor'])
export const WindowStateSchema = object({
	role: WindowRoleSchema,
	maximized: v.boolean(),
	presentation: v.nullable(DocumentWindowPresentationSchema)
})
export const WindowEditActionSchema = v.picklist([
	'undo',
	'redo',
	'cut',
	'copy',
	'paste',
	'select-all'
])
export const WindowEditActionInputSchema = object({ action: WindowEditActionSchema })
export const OpenDocumentWindowInputSchema = v.intersect([
	WorkspaceEntryLocatorSchema,
	object({ presentation: DocumentWindowPresentationSchema })
])
export const TabTransferTokenSchema = UUIDSchema
export const PrepareTabTransferInputSchema = object({
	token: TabTransferTokenSchema,
	path: KnowledgeBundlePathSchema,
	sourceTabID: v.pipe(v.string(), v.nonEmpty(), v.maxLength(512))
})
export const TabTransferInputSchema = object({ token: TabTransferTokenSchema })
export const AcceptedTabTransferSchema = object({
	token: TabTransferTokenSchema,
	path: KnowledgeBundlePathSchema
})
export const TabTransferStatusSchema = v.nullable(
	v.picklist(['pending', 'accepted', 'committed', 'rejected'])
)
export const TabTransferCommittedSchema = object({
	token: TabTransferTokenSchema,
	sourceTabID: v.pipe(v.string(), v.nonEmpty(), v.maxLength(512))
})

export type WindowRole = v.InferOutput<typeof WindowRoleSchema>
export type WindowState = v.InferOutput<typeof WindowStateSchema>
export type WindowEditActionInput = v.InferOutput<typeof WindowEditActionInputSchema>
export type DocumentWindowPresentation = v.InferOutput<typeof DocumentWindowPresentationSchema>
export type OpenDocumentWindowInput = v.InferOutput<typeof OpenDocumentWindowInputSchema>
export type PrepareTabTransferInput = v.InferOutput<typeof PrepareTabTransferInputSchema>
export type TabTransferInput = v.InferOutput<typeof TabTransferInputSchema>
export type AcceptedTabTransfer = v.InferOutput<typeof AcceptedTabTransferSchema>
export type TabTransferStatus = v.InferOutput<typeof TabTransferStatusSchema>
export type TabTransferCommitted = v.InferOutput<typeof TabTransferCommittedSchema>

export const TAB_TRANSFER_MIME = 'application/x-open-knowledge-tab'

export interface WindowAPI {
	getState(): Promise<WindowState>
	rendererReady(): Promise<void>
	openApplicationSettings(): Promise<void>
	openDocumentWindow(input: OpenDocumentWindowInput): Promise<void>
	prepareTabTransfer(input: PrepareTabTransferInput): Promise<void>
	acceptTabTransfer(input: TabTransferInput): Promise<AcceptedTabTransfer>
	commitTabTransfer(input: TabTransferInput): Promise<void>
	cancelTabTransfer(input: TabTransferInput): Promise<void>
	tabTransferStatus(input: TabTransferInput): Promise<TabTransferStatus>
	performEditAction(input: WindowEditActionInput): Promise<void>
	minimize(): Promise<void>
	toggleMaximize(): Promise<void>
	close(): Promise<void>
	onApplicationCommand(listener: (commandID: string) => void): () => void
	onTabTransferCommitted(listener: (transfer: TabTransferCommitted) => void): () => void
	onMaximizedChange(listener: (maximized: boolean) => void): () => void
}
