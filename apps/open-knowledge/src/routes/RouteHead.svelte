<script lang="ts">
	import { appEdition } from '#lib/app-edition.js'
	let { title }: { title: string } = $props()
	const editionTitle = $derived(
		title.endsWith('Open Knowledge')
			? `${title.slice(0, -'Open Knowledge'.length)}${appEdition.name}`
			: `${title} · ${appEdition.name}`
	)
</script>

<svelte:head><title>{editionTitle}</title></svelte:head>
