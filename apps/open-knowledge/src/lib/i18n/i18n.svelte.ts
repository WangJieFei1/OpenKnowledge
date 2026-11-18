import { createSubscriber } from 'svelte/reactivity'
import type { ApplicationLanguage } from '../settings/api'

export type I18NValue = string | ((...args: never[]) => string)

type MatchingCatalog<T extends Record<string, I18NValue>> = {
	[Key in keyof T]: T[Key] extends (...args: infer Args) => string
		? (...args: Args) => string
		: string
}

export type Translation<T extends Record<string, I18NValue>> = {
	en: T
	'zh-cn': MatchingCatalog<NoInfer<T>>
}

class I18NState {
	#language: ApplicationLanguage = 'en'
	#update: (() => void) | undefined
	#subscribe = createSubscriber((update) => {
		this.#update = update
		return () => {
			this.#update = undefined
		}
	})

	get current(): ApplicationLanguage {
		this.#subscribe()
		return this.#language
	}

	apply(language: ApplicationLanguage): void {
		if (language === this.#language) {
			return
		}
		this.#language = language
		this.#update?.()
	}
}

export const i18nState = new I18NState()

export function translation<const T extends Record<string, I18NValue>>(
	catalogs: Translation<T>
): MatchingCatalog<T> {
	const facade = {} as MatchingCatalog<T>
	for (const key of Object.keys(catalogs.en) as Array<keyof T>) {
		Object.defineProperty(facade, key, {
			enumerable: true,
			get() {
				const catalog = catalogs[i18nState.current] as MatchingCatalog<T>
				return catalog[key]
			}
		})
	}

	return facade
}
