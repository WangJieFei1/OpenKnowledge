(() => {
	let preference = 'system'
	let theme = 'indigo'
	if (!window.openKnowledge) {
		try {
			preference = localStorage.getItem('open-knowledge-mode') ?? preference
			const storedTheme = localStorage.getItem('open-knowledge-theme')
			const themes = [
				'indigo',
				'blue',
				'cyan',
				'teal',
				'green',
				'grass',
				'orange',
				'red',
				'crimson',
				'pink',
				'purple',
				'violet'
			]
			if (storedTheme && themes.includes(storedTheme)) {
				theme = storedTheme
			}
		} catch {
			// System preference remains a safe fallback when storage is unavailable.
		}
	}
	const dark =
		preference === 'dark' ||
		(preference !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
	document.documentElement.classList.toggle('dark', dark)
	document.documentElement.dataset.theme = theme
	document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', dark ? '#191919' : '#f9f9f9')
})()
