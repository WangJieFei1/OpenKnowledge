<script lang="ts">
	import type { Snippet } from 'svelte'

	type Props = {
		title: string
		description: string
		icon: Snippet
		children: Snippet
	}

	let { title, description, icon, children }: Props = $props()
</script>

<section>
	<div class="section-heading">
		{@render icon()}
		<div>
			<h2>{title}</h2>
			<p>{description}</p>
		</div>
	</div>
	{@render children()}
</section>

<style>
	section {
		width: min(100%, 780px);
		margin: 0 auto 42px;
	}

	.section-heading {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		border-bottom: 1px solid var(--gray-6);
		padding-bottom: 13px;
		color: var(--gray-11);
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		color: var(--gray-12);
		font-size: var(--font-size-ui-section-title);
		font-weight: 680;
	}

	.section-heading p {
		margin-top: 2px;
		color: var(--gray-11);
		font-size: var(--font-size-ui-text);
	}
</style>
