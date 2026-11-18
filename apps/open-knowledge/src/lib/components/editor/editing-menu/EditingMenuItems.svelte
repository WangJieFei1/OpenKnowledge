<script lang="ts" module>
	import { editingMenuItemsTranslation as t } from './EditingMenuItems.translation'
</script>

<script lang="ts">
	import type { WindowEditActionInput } from '#lib/window/api.js'
	import { ContextMenu } from 'bits-ui'
	import { ClipboardPaste, Copy, Redo2, ScanText, Scissors, Undo2 } from 'lucide-svelte'

	type Props = {
		disabled?: boolean
		canUndo?: boolean
		canRedo?: boolean
		canCutCopy?: boolean
		onaction: (action: WindowEditActionInput['action']) => void
	}

	let {
		disabled = false,
		canUndo = true,
		canRedo = true,
		canCutCopy = true,
		onaction
	}: Props = $props()
</script>

<ContextMenu.Item
	class="ui-menu-item"
	disabled={disabled || !canUndo}
	textValue={t.undo}
	onSelect={() => onaction('undo')}
>
	<Undo2 size={14} /><span>{t.undo}</span>
</ContextMenu.Item>
<ContextMenu.Item
	class="ui-menu-item"
	disabled={disabled || !canRedo}
	textValue={t.redo}
	onSelect={() => onaction('redo')}
>
	<Redo2 size={14} /><span>{t.redo}</span>
</ContextMenu.Item>
<ContextMenu.Separator class="ui-menu-separator" />
<ContextMenu.Item
	class="ui-menu-item"
	disabled={disabled || !canCutCopy}
	textValue={t.cut}
	onSelect={() => onaction('cut')}
>
	<Scissors size={14} /><span>{t.cut}</span>
</ContextMenu.Item>
<ContextMenu.Item
	class="ui-menu-item"
	disabled={!canCutCopy}
	textValue={t.copy}
	onSelect={() => onaction('copy')}
>
	<Copy size={14} /><span>{t.copy}</span>
</ContextMenu.Item>
<ContextMenu.Item
	class="ui-menu-item"
	{disabled}
	textValue={t.paste}
	onSelect={() => onaction('paste')}
>
	<ClipboardPaste size={14} /><span>{t.paste}</span>
</ContextMenu.Item>
<ContextMenu.Item
	class="ui-menu-item"
	{disabled}
	textValue={t.selectAll}
	onSelect={() => onaction('select-all')}
>
	<ScanText size={14} /><span>{t.selectAll}</span>
</ContextMenu.Item>
