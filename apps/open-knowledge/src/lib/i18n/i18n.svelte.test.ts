import { afterEach, describe, expect, test } from 'bun:test'
import { i18nState, translation } from './i18n.svelte'

const originalLanguage = i18nState.current

afterEach(() => {
	i18nState.apply(originalLanguage)
})

describe('translation', () => {
	test('reads strings and functions from the active catalog', () => {
		const t = translation({
			en: {
				title: 'Title',
				greeting: (name: string): string => `Hello, ${name}`
			},
			'zh-cn': {
				title: '标题',
				greeting: (name: string): string => `你好，${name}`
			}
		})

		i18nState.apply('en')
		expect(t.title).toBe('Title')
		expect(t.greeting('Ada')).toBe('Hello, Ada')

		i18nState.apply('zh-cn')
		expect(t.title).toBe('标题')
		expect(t.greeting('Ada')).toBe('你好，Ada')
	})
})
