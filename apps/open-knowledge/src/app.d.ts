import type { OpenKnowledgeAPI } from '#lib/desktop/api.js'

declare global {
	interface Window {
		openKnowledge?: OpenKnowledgeAPI
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {}
