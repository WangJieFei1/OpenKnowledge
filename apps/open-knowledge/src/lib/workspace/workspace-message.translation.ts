import { translation } from '#lib/i18n/index.js'
import type { KnowledgeBundleMutationError } from '#lib/knowledge/api.js'
import * as v from 'valibot'

const en = {
	'error.workspace.initialize': 'The workspace could not be initialized.',
	'error.workspace.selector.open': 'The workspace selector could not be opened.',
	'error.workspace.reveal': 'The workspace could not be revealed in the file manager.',
	'error.workspace.leave.unsaved': 'Resolve the unsaved document before leaving this workspace.',
	'error.workspace.refresh': 'The workspace could not be refreshed.',
	'error.settings.save': 'The settings could not be saved.',
	'error.mcp.settings.open': 'MCP settings could not be opened.',
	'error.mcp.access.update': 'MCP access could not be updated.',
	'error.mcp.start': 'The shared MCP server could not be started.',
	'error.mcp.update': 'The shared MCP server could not be updated.',
	'error.mcp.memory': 'Codex session memory access could not be updated.',
	'error.mcp.regenerate': 'The shared MCP credential could not be regenerated.',
	'error.mcp.workspace.not-recent': 'The workspace is not in the recent workspace list.',
	'error.mcp.credential.requires-included':
		'Include this workspace before regenerating the shared credential.',
	'error.mcp.connection.not-listening':
		'The shared MCP connection is not listening for this workspace.',
	'error.mcp.unavailable': 'The MCP server is shutting down.',
	'error.document.close.unsaved': 'Resolve or reload this document before closing its tab.',
	'error.document.window.unsaved':
		'Save or reload the document before opening it in another window.',
	'error.document.window.open': 'The document could not be opened in a new window.',
	'error.document.rename.unsaved': 'Resolve the unsaved document before renaming its path.',
	'error.document.delete.unsaved': 'Resolve the unsaved document before deleting its path.',
	'error.document.missing': 'The document no longer exists.',
	'error.document.removed': 'The open document was removed from the workspace.',
	'error.document.open': 'The document could not be opened.',
	'error.document.convert': 'The document could not be converted to Markdown.',
	'error.document.convert.conflict': 'A file with the target .md name already exists.',
	'error.document.convert.missing': 'The document no longer exists and could not be converted.',
	'error.document.system-path.open': 'The system path could not be opened.',
	'error.document.save': 'The document could not be saved.',
	'error.entry.destination-missing': 'The destination folder is no longer available.',
	'error.entry.missing': 'The entry no longer exists.',
	'error.tab.transfer.unsaved':
		'Save or reload the document before moving its tab to another window.',
	'error.tab.transfer.prepare': 'The tab could not be prepared for another window.',
	'error.tab.transfer.incompatible':
		'Tabs can only move to another normal window of the same workspace.',
	'error.tab.transfer.commit': 'The document opened, but the source tab could not be closed.',
	'error.tab.transfer.route': 'The transferred document could not be routed.',
	'error.mutation.workspace.not-directory': 'A workspace must be a directory.',
	'error.mutation.workspace.root-unavailable': 'The workspace root is no longer available.',
	'error.mutation.workspace.root-replace': 'The workspace root cannot be replaced.',
	'error.mutation.workspace.root-changed': 'The workspace root changed.',
	'error.mutation.name.required': 'Enter a valid name.',
	'error.mutation.name.unsupported':
		'The name contains characters unsupported by desktop filesystems.',
	'error.mutation.name.unsupported-document':
		'Rendered documents must keep a file extension supported by Anydoc.',
	'error.mutation.name.change-file-type':
		'Renaming cannot change an unsupported file into an editable or rendered document.',
	'error.mutation.name.too-long': 'The name is too long.',
	'error.mutation.name.reserved': 'That name is reserved by the operating system.',
	'error.mutation.entry.not-found': 'The entry no longer exists.',
	'error.mutation.entry.already-exists': 'An entry with that name already exists.',
	'error.mutation.entry.create': 'The entry could not be created.',
	'error.mutation.entry.rename.conflict': 'The entry changed. Refresh before renaming it.',
	'error.mutation.entry.rename': 'The entry could not be renamed.',
	'error.mutation.entry.delete.conflict': 'The entry changed. Refresh before deleting it.',
	'error.mutation.entry.delete': 'The entry could not be deleted.',
	'error.mutation.document.not-found': 'The document no longer exists.',
	'error.mutation.document.save.conflict': 'The document changed. Reload it before saving.',
	'error.mutation.document.save.read-back': 'The saved document could not be read back.',
	'error.mutation.document.save': 'The document could not be saved.',
	'error.mutation.folder.not-empty': 'Only empty folders can be deleted.',
	'error.mutation.parent.not-folder': 'The parent entry is not a folder.',
	'error.mutation.parent.conflict': 'The parent folder changed.',
	'error.mutation.path.symlink': 'Symbolic links are outside the editable workspace boundary.',
	'error.mutation.path.not-portable': 'The bundle path is not portable.',
	'error.mutation.path.not-canonical': 'The bundle path is not canonical.',
	'error.mutation.path.not-directory': 'The requested entry is not a directory.',
	'error.mutation.path.changed': 'The workspace path changed while it was read.'
} as const

type WorkspaceMessageCatalog = { [Key in keyof typeof en]: string }

const zhCN: WorkspaceMessageCatalog = {
	'error.workspace.initialize': '无法初始化工作区。',
	'error.workspace.selector.open': '无法打开工作区选择器。',
	'error.workspace.reveal': '无法在文件管理器中显示工作区。',
	'error.workspace.leave.unsaved': '请先处理未保存的文档，再离开此工作区。',
	'error.workspace.refresh': '无法刷新工作区。',
	'error.settings.save': '无法保存设置。',
	'error.mcp.settings.open': '无法打开 MCP 设置。',
	'error.mcp.access.update': '无法更新 MCP 访问权限。',
	'error.mcp.start': '无法启动共享 MCP 服务器。',
	'error.mcp.update': '无法更新共享 MCP 服务器。',
	'error.mcp.memory': '无法更新 Codex 会话记忆权限。',
	'error.mcp.regenerate': '无法重新生成共享 MCP 凭据。',
	'error.mcp.workspace.not-recent': '此工作区不在最近使用的工作区列表中。',
	'error.mcp.credential.requires-included': '请先包含此工作区，再重新生成共享凭据。',
	'error.mcp.connection.not-listening': '共享 MCP 连接未侦听此工作区。',
	'error.mcp.unavailable': 'MCP 服务器正在关闭。',
	'error.document.close.unsaved': '请先解决保存问题或重新加载此文档，再关闭标签页。',
	'error.document.window.unsaved': '请先保存或重新加载文档，再在其他窗口中打开。',
	'error.document.window.open': '无法在新窗口中打开文档。',
	'error.document.rename.unsaved': '请先处理未保存的文档，再重命名其路径。',
	'error.document.delete.unsaved': '请先处理未保存的文档，再删除其路径。',
	'error.document.missing': '文档已不存在。',
	'error.document.removed': '打开的文档已从工作区中移除。',
	'error.document.open': '无法打开文档。',
	'error.document.convert': '无法将文档转换为 Markdown。',
	'error.document.convert.conflict': '已存在与目标 .md 名称相同的文件。',
	'error.document.convert.missing': '文档已不存在，无法转换。',
	'error.document.system-path.open': '无法打开系统路径。',
	'error.document.save': '无法保存文档。',
	'error.entry.destination-missing': '目标文件夹已不可用。',
	'error.entry.missing': '项目已不存在。',
	'error.tab.transfer.unsaved': '请先保存或重新加载文档，再将标签页移动到其他窗口。',
	'error.tab.transfer.prepare': '无法准备将此标签页移动到其他窗口。',
	'error.tab.transfer.incompatible': '标签页只能移动到同一工作区的其他普通窗口。',
	'error.tab.transfer.commit': '文档已打开，但无法关闭源标签页。',
	'error.tab.transfer.route': '无法转到传入文档。',
	'error.mutation.workspace.not-directory': '工作区必须是目录。',
	'error.mutation.workspace.root-unavailable': '工作区根目录已不可用。',
	'error.mutation.workspace.root-replace': '不能替换工作区根目录。',
	'error.mutation.workspace.root-changed': '工作区根目录已更改。',
	'error.mutation.name.required': '请输入有效名称。',
	'error.mutation.name.unsupported': '名称包含桌面文件系统不支持的字符。',
	'error.mutation.name.unsupported-document': '渲染文档必须保留 Anydoc 支持的文件扩展名。',
	'error.mutation.name.change-file-type': '重命名不能将不支持的文件变为可编辑或可渲染的文档。',
	'error.mutation.name.too-long': '名称过长。',
	'error.mutation.name.reserved': '该名称已被操作系统保留。',
	'error.mutation.entry.not-found': '项目已不存在。',
	'error.mutation.entry.already-exists': '已存在同名项目。',
	'error.mutation.entry.create': '无法创建项目。',
	'error.mutation.entry.rename.conflict': '项目已更改。请刷新后再重命名。',
	'error.mutation.entry.rename': '无法重命名项目。',
	'error.mutation.entry.delete.conflict': '项目已更改。请刷新后再删除。',
	'error.mutation.entry.delete': '无法删除项目。',
	'error.mutation.document.not-found': '文档已不存在。',
	'error.mutation.document.save.conflict': '文档已更改。请重新加载后再保存。',
	'error.mutation.document.save.read-back': '无法重新读取已保存的文档。',
	'error.mutation.document.save': '无法保存文档。',
	'error.mutation.folder.not-empty': '只能删除空文件夹。',
	'error.mutation.parent.not-folder': '父项目不是文件夹。',
	'error.mutation.parent.conflict': '父文件夹已更改。',
	'error.mutation.path.symlink': '符号链接超出了可编辑工作区的范围。',
	'error.mutation.path.not-portable': '知识包路径不具备跨平台兼容性。',
	'error.mutation.path.not-canonical': '知识包路径不是规范路径。',
	'error.mutation.path.not-directory': '请求的项目不是目录。',
	'error.mutation.path.changed': '读取期间工作区路径发生了变化。'
}

export type WorkspaceMessageID = keyof typeof en
export type MutationAction = 'create' | 'delete' | 'rename' | 'save'

const WorkspaceMessageIDSchema = v.picklist(
	Object.keys(en) as [WorkspaceMessageID, ...WorkspaceMessageID[]]
)

export function workspaceMessageID(value: string): WorkspaceMessageID | null {
	return v.is(WorkspaceMessageIDSchema, value) ? value : null
}

export function mutationMessageID(
	error: KnowledgeBundleMutationError,
	action: MutationAction
): WorkspaceMessageID {
	const provided = workspaceMessageID(error.message)
	if (error.code === 'not_found') {
		return action === 'save'
			? 'error.mutation.document.not-found'
			: 'error.mutation.entry.not-found'
	}
	if (error.code === 'already_exists') {
		return 'error.mutation.entry.already-exists'
	}
	if (error.code === 'not_empty') {
		return 'error.mutation.folder.not-empty'
	}
	if (error.code === 'not_a_directory') {
		return 'error.mutation.parent.not-folder'
	}
	if (error.code === 'revision_conflict' || error.code === 'content_conflict') {
		if (action === 'save') {
			return 'error.mutation.document.save.conflict'
		}
		if (action === 'rename') {
			return 'error.mutation.entry.rename.conflict'
		}
		if (action === 'delete') {
			return 'error.mutation.entry.delete.conflict'
		}
	}
	if (provided) {
		return provided
	}
	if (action === 'save') {
		return 'error.mutation.document.save'
	}
	return `error.mutation.entry.${action}` as WorkspaceMessageID
}

export const workspaceMessages = translation({ en, 'zh-cn': zhCN })
