import {
	AppWindow,
	ArrowLeftToLine,
	ArrowRightToLine,
	BookOpenText,
	ClipboardPaste,
	CodeXml,
	Copy,
	FilePlus2,
	FileText,
	FolderOpen,
	FolderPlus,
	FolderSearch,
	Keyboard,
	Moon,
	PanelLeft,
	PanelTopClose,
	PanelsTopLeft,
	Redo2,
	Save,
	ScanText,
	Scissors,
	Search,
	Settings,
	Undo2,
	Waypoints,
	X
} from 'lucide-svelte'
import type { ApplicationCommand } from './application-command'

export function applicationCommandIcon(command: ApplicationCommand) {
	if (command.id.startsWith('open:')) {
		return FileText
	}

	switch (command.id) {
		case 'file.new-document':
			return FilePlus2
		case 'file.new-folder':
			return FolderPlus
		case 'workspace.switch':
			return FolderOpen
		case 'workspace.new-window':
			return PanelsTopLeft
		case 'document.new-window':
			return AppWindow
		case 'workspace.reveal':
			return FolderSearch
		case 'document.save':
			return Save
		case 'document.close':
			return X
		case 'window.close':
			return PanelTopClose
		case 'edit.undo':
			return Undo2
		case 'edit.redo':
			return Redo2
		case 'edit.cut':
			return Scissors
		case 'edit.copy':
			return Copy
		case 'edit.paste':
			return ClipboardPaste
		case 'edit.select-all':
			return ScanText
		case 'app.command-palette':
			return Search
		case 'view.sidebar':
			return PanelLeft
		case 'view.previous-tab':
			return ArrowLeftToLine
		case 'view.next-tab':
			return ArrowRightToLine
		case 'view.rich-text':
			return FileText
		case 'view.markdown':
			return CodeXml
		case 'view.dark-theme':
			return Moon
		case 'view.settings':
			return Settings
		case 'mcp.workspace-access':
			return FolderOpen
		case 'mcp.settings':
			return Waypoints
		case 'help.shortcuts':
			return Keyboard
		default:
			return BookOpenText
	}
}
