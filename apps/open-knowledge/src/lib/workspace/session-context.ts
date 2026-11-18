import { getContext, setContext } from 'svelte'
import type { WorkspaceSession } from './workspace-session.svelte'

const workspaceSessionKey = Symbol('workspace-session')

export function provideWorkspaceSession(session: WorkspaceSession): void {
	setContext(workspaceSessionKey, session)
}

export function useWorkspaceSession(): WorkspaceSession {
	const session = getContext<WorkspaceSession | undefined>(workspaceSessionKey)
	if (!session) {
		throw new Error('Workspace session is not available in this route.')
	}
	return session
}
