import { WorkspaceSchema, type Workspace, type WorkspaceInput } from '../../src/lib/knowledge/api'
import {
	WorkspaceSelectorBrowseResultSchema,
	WorkspaceSelectorSnapshotSchema,
	type WorkspaceSelectorAPI,
	type WorkspaceSelectorBrowseResult,
	type WorkspaceSelectorConnectInput,
	type WorkspaceSelectorOpenInput
} from '../../src/lib/workspace/selector-api'
import { channels } from '../channels'
import { invoke, NullSchema } from './transport'

export function createWorkspaceSelectorAPI(): WorkspaceSelectorAPI {
	return {
		getSnapshot() {
			return invoke(channels.selectorSnapshot, undefined, WorkspaceSelectorSnapshotSchema)
		},
		browse(): Promise<WorkspaceSelectorBrowseResult> {
			return invoke(channels.selectorBrowse, undefined, WorkspaceSelectorBrowseResultSchema)
		},
		connect(input: WorkspaceSelectorConnectInput): Promise<Workspace> {
			return invoke(channels.selectorConnect, input, WorkspaceSchema)
		},
		async select(input: WorkspaceInput) {
			await invoke(channels.selectorSelect, input, NullSchema)
		},
		async open(input: WorkspaceSelectorOpenInput = { target: 'replace-current-window' }) {
			await invoke(channels.selectorOpen, input, NullSchema)
		}
	}
}
