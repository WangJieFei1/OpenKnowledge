import type { WindowAPI } from '#lib/window/api.js'

type FlushableWorkspace = {
	flushAll(): Promise<boolean>
}

type ClosableWindow = Pick<WindowAPI, 'close'>

export async function requestWorkspaceWindowClose(
	workspace: FlushableWorkspace,
	windowAPI?: ClosableWindow | null
): Promise<void> {
	if (!(await workspace.flushAll())) {
		return
	}
	await windowAPI?.close()
}
