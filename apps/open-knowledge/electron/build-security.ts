import { FuseVersion, FuseV1Options, type FuseV1Config } from '@electron/fuses'

export const packagedElectronFuses = {
	version: FuseVersion.V1,
	strictlyRequireAllFuses: true,
	[FuseV1Options.RunAsNode]: false,
	[FuseV1Options.EnableCookieEncryption]: true,
	[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
	[FuseV1Options.EnableNodeCliInspectArguments]: false,
	[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
	[FuseV1Options.OnlyLoadAppFromAsar]: true,
	[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
	[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
	[FuseV1Options.WasmTrapHandlers]: true
} satisfies FuseV1Config<boolean>

type Environment = Readonly<Record<string, string | undefined>>

export type MacReleaseSecurity = {
	osxSign?: {
		identity: string
		identityValidation?: boolean
		optionsForFile: () => { entitlements: string; hardenedRuntime: boolean }
		timestamp?: string
	}
	osxNotarize?: { keychainProfile: string }
}

export function resolveMacReleaseSecurity(
	platform: NodeJS.Platform,
	environment: Environment,
	entitlementsPath: string
): MacReleaseSecurity {
	const release = environment.OPEN_KNOWLEDGE_MAC_RELEASE === '1'
	if (platform !== 'darwin' && !release) {
		return {}
	}
	if (platform !== 'darwin') {
		throw new Error('A hardened macOS release must be built on macOS.')
	}
	if (!release) {
		return {
			osxSign: {
				identity: '-',
				identityValidation: false,
				optionsForFile: () => ({ entitlements: entitlementsPath, hardenedRuntime: false }),
				timestamp: 'none'
			}
		}
	}
	const identity = requiredReleaseValue(environment, 'OPEN_KNOWLEDGE_MAC_SIGN_IDENTITY')
	const keychainProfile = requiredReleaseValue(environment, 'OPEN_KNOWLEDGE_MAC_NOTARY_PROFILE')
	return {
		osxSign: {
			identity,
			optionsForFile: () => ({ entitlements: entitlementsPath, hardenedRuntime: true })
		},
		osxNotarize: { keychainProfile }
	}
}

function requiredReleaseValue(environment: Environment, name: string): string {
	const value = environment[name]?.trim()
	if (!value || value.length > 512 || /[\r\n\0]/.test(value)) {
		throw new Error(`${name} must be a non-empty single-line value for a macOS release.`)
	}
	return value
}
