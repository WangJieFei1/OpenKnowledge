import eslint from '@eslint/js'
import globals from 'globals'
import svelte from 'eslint-plugin-svelte'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default tseslint.config(
	{
		ignores: [
			'.cache/**',
			'.svelte-kit/**',
			'build/**',
			'dist-electron/**',
			'node_modules/**',
			'out/**'
		]
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs.recommended,
	{
		plugins: {
			'@stylistic': stylistic
		},
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			'@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
			curly: ['error', 'all'],
			'no-constant-condition': ['error', { checkLoops: false }],
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		}
	},
	{
		files: ['**/*.svelte.ts'],
		languageOptions: {
			parser: tseslint.parser
		}
	},
	{
		files: ['electron/workspace/path-policy.ts'],
		rules: {
			'no-control-regex': 'off'
		}
	}
)
