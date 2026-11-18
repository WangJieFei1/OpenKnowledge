import * as v from 'valibot'
import {
	CreateKnowledgeBundleDirectoryResultSchema,
	CreateKnowledgeBundleFileResultSchema,
	DeleteKnowledgeBundleEntryResultSchema,
	KnowledgeBundleFileSchema,
	KnowledgeBundleInfoSchema,
	KnowledgeBundleListingSchema,
	MoveKnowledgeBundleEntryResultSchema,
	PatchKnowledgeBundleFileResultSchema,
	RenderedDocumentSchema,
	KnowledgeSearchResultSchema,
	WorkspaceChangeSchema,
	WorkspaceSnapshotSchema,
	WriteKnowledgeBundleFileResultSchema,
	type KnowledgeAPI,
	type OpenSystemPathInput,
	type OpenWorkspaceInput,
	type SearchKnowledgeInput,
	type WorkspaceChange,
	type WorkspaceCreateKnowledgeBundleDirectoryInput,
	type WorkspaceCreateKnowledgeBundleFileInput,
	type WorkspaceDeleteKnowledgeBundleEntryInput,
	type WorkspaceInput,
	type WorkspaceListKnowledgeBundleInput,
	type WorkspaceMoveKnowledgeBundleEntryInput,
	type WorkspacePatchKnowledgeBundleFileInput,
	type WorkspaceReadKnowledgeBundleFileInput,
	type WorkspaceReadRenderedDocumentInput,
	type WorkspaceWriteKnowledgeBundleFileInput
} from '../../src/lib/knowledge/api'
import { channels } from '../channels'
import { invoke, NullSchema, subscribe } from './transport'

export function createKnowledgeAPI(): KnowledgeAPI {
	return {
		openWorkspace(input: OpenWorkspaceInput) {
			return invoke(channels.openWorkspace, input, WorkspaceSnapshotSchema)
		},
		refreshWorkspace(input: WorkspaceInput) {
			return invoke(channels.refreshWorkspace, input, WorkspaceSnapshotSchema)
		},
		getInfo(input: WorkspaceInput) {
			return invoke(channels.bundleInfo, input, KnowledgeBundleInfoSchema)
		},
		list(input: WorkspaceListKnowledgeBundleInput) {
			return invoke(channels.listEntries, input, v.nullable(KnowledgeBundleListingSchema))
		},
		search(input: SearchKnowledgeInput) {
			return invoke(channels.search, input, KnowledgeSearchResultSchema)
		},
		readFile(input: WorkspaceReadKnowledgeBundleFileInput) {
			return invoke(channels.readFile, input, v.nullable(KnowledgeBundleFileSchema))
		},
		readRenderedDocument(input: WorkspaceReadRenderedDocumentInput) {
			return invoke(channels.readRenderedDocument, input, v.nullable(RenderedDocumentSchema))
		},
		createDirectory(input: WorkspaceCreateKnowledgeBundleDirectoryInput) {
			return invoke(channels.createDirectory, input, CreateKnowledgeBundleDirectoryResultSchema)
		},
		createFile(input: WorkspaceCreateKnowledgeBundleFileInput) {
			return invoke(channels.createFile, input, CreateKnowledgeBundleFileResultSchema)
		},
		writeFile(input: WorkspaceWriteKnowledgeBundleFileInput) {
			return invoke(channels.writeFile, input, WriteKnowledgeBundleFileResultSchema)
		},
		patchFile(input: WorkspacePatchKnowledgeBundleFileInput) {
			return invoke(channels.patchFile, input, PatchKnowledgeBundleFileResultSchema)
		},
		moveEntry(input: WorkspaceMoveKnowledgeBundleEntryInput) {
			return invoke(channels.moveEntry, input, MoveKnowledgeBundleEntryResultSchema)
		},
		deleteEntry(input: WorkspaceDeleteKnowledgeBundleEntryInput) {
			return invoke(channels.deleteEntry, input, DeleteKnowledgeBundleEntryResultSchema)
		},
		async openSystemPath(input: OpenSystemPathInput) {
			await invoke(channels.openSystemPath, input, NullSchema)
		},
		async revealWorkspace(input: WorkspaceInput) {
			await invoke(channels.revealWorkspace, input, NullSchema)
		},
		onWorkspaceChange(listener: (change: WorkspaceChange) => void) {
			return subscribe(channels.workspaceChange, WorkspaceChangeSchema, listener)
		}
	}
}
