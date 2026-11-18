import * as v from 'valibot'
import { WorkspaceSchema, type Workspace, type WorkspaceInput } from '../knowledge/api'
import { object } from '../validation'

export const WorkspaceSelectorSnapshotSchema = object({
	recentWorkspaces: v.array(WorkspaceSchema)
})
export const WorkspaceSelectorBrowseErrorCodeSchema = v.picklist([
	'picker-unavailable',
	'folder-not-found',
	'folder-permission-denied',
	'folder-not-directory',
	'folder-root-not-supported',
	'folder-unavailable',
	'storage-full',
	'storage-unavailable',
	'unexpected'
])
export const WorkspaceSelectorBrowseErrorSchema = object({
	code: WorkspaceSelectorBrowseErrorCodeSchema,
	detail: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(512)))
})
export const WorkspaceSelectorBrowseResultSchema = v.union([
	object({ status: v.literal('cancelled') }),
	object({ status: v.literal('selected'), workspace: WorkspaceSchema }),
	object({ status: v.literal('failed'), error: WorkspaceSelectorBrowseErrorSchema })
])
export const WorkspaceSelectorOpenTargetSchema = v.picklist([
	'replace-current-window',
	'new-window'
])
export const WorkspaceSelectorOpenInputSchema = object({
	target: WorkspaceSelectorOpenTargetSchema
})
export const WorkspaceSelectorConnectInputSchema = object({
	uri: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(8_192)),
	authorization: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.nonEmpty(),
			v.maxLength(8_192),
			v.check((value) => !/[\r\n]/.test(value), 'Authorization cannot contain line breaks.')
		)
	)
})

export type WorkspaceSelectorSnapshot = v.InferOutput<typeof WorkspaceSelectorSnapshotSchema>
export type WorkspaceSelectorBrowseErrorCode = v.InferOutput<
	typeof WorkspaceSelectorBrowseErrorCodeSchema
>
export type WorkspaceSelectorBrowseError = v.InferOutput<typeof WorkspaceSelectorBrowseErrorSchema>
export type WorkspaceSelectorBrowseResult = v.InferOutput<
	typeof WorkspaceSelectorBrowseResultSchema
>
export type WorkspaceSelectorOpenTarget = v.InferOutput<typeof WorkspaceSelectorOpenTargetSchema>
export type WorkspaceSelectorOpenInput = v.InferOutput<typeof WorkspaceSelectorOpenInputSchema>
export type WorkspaceSelectorConnectInput = v.InferOutput<
	typeof WorkspaceSelectorConnectInputSchema
>

export interface WorkspaceSelectorAPI {
	getSnapshot(): Promise<WorkspaceSelectorSnapshot>
	browse(): Promise<WorkspaceSelectorBrowseResult>
	connect(input: WorkspaceSelectorConnectInput): Promise<Workspace>
	select(input: WorkspaceInput): Promise<void>
	open(input?: WorkspaceSelectorOpenInput): Promise<void>
}
