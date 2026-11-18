import { describe, expect, test } from 'bun:test'
import { FuseV1Options } from '@electron/fuses'
import { packagedElectronFuses, resolveMacReleaseSecurity } from './build-security'

describe('packaged Electron security', () => {
	test('locks every known V1 fuse to an explicit production value', () => {
		expect(packagedElectronFuses.strictlyRequireAllFuses).toBe(true)
		expect(packagedElectronFuses[FuseV1Options.RunAsNode]).toBe(false)
		expect(packagedElectronFuses[FuseV1Options.EnableCookieEncryption]).toBe(true)
		expect(packagedElectronFuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
		expect(packagedElectronFuses[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
		expect(packagedElectronFuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true)
		expect(packagedElectronFuses[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)
		expect(packagedElectronFuses[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]).toBe(false)
		expect(packagedElectronFuses[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(false)
		expect(packagedElectronFuses[FuseV1Options.WasmTrapHandlers]).toBe(true)
	})

	test('ad-hoc signs local macOS packages and rejects incomplete release credentials', () => {
		const local = resolveMacReleaseSecurity('darwin', {}, '/entitlements.plist')
		expect(local.osxSign?.identity).toBe('-')
		expect(local.osxSign?.identityValidation).toBe(false)
		expect(local.osxSign?.timestamp).toBe('none')
		expect(local.osxSign?.optionsForFile()).toEqual({
			entitlements: '/entitlements.plist',
			hardenedRuntime: false
		})
		expect(resolveMacReleaseSecurity('linux', {}, '/entitlements.plist')).toEqual({})
		expect(() =>
			resolveMacReleaseSecurity(
				'darwin',
				{ OPEN_KNOWLEDGE_MAC_RELEASE: '1' },
				'/entitlements.plist'
			)
		).toThrow('OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY')
		expect(() =>
			resolveMacReleaseSecurity(
				'darwin',
				{
					OPEN_KNOWLEDGE_MAC_RELEASE: '1',
					OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY: 'Developer ID Application: Example'
				},
				'/entitlements.plist'
			)
		).toThrow('OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE')
		expect(() =>
			resolveMacReleaseSecurity('linux', { OPEN_KNOWLEDGE_MAC_RELEASE: '1' }, '/entitlements.plist')
		).toThrow('must be built on macOS')
	})

	test('configures hardened signing and keychain-profile notarization without embedding secrets', () => {
		const security = resolveMacReleaseSecurity(
			'darwin',
			{
				OPEN_KNOWLEDGE_MAC_RELEASE: '1',
				OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY: '  Developer ID Application: Example Corp  ',
				OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE: '  open-knowledge-notary  '
			},
			'/secure/entitlements.plist'
		)
		expect(security.osxSign?.identity).toBe('Developer ID Application: Example Corp')
		expect(security.osxSign?.identityValidation).toBeUndefined()
		expect(security.osxSign?.timestamp).toBeUndefined()
		expect(security.osxSign?.optionsForFile()).toEqual({
			entitlements: '/secure/entitlements.plist',
			hardenedRuntime: true
		})
		expect(security.osxNotarize).toEqual({ keychainProfile: 'open-knowledge-notary' })
	})
})
