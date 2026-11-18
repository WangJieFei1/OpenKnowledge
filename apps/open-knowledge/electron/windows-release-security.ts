import type { MakerSquirrelConfig } from '@electron-forge/maker-squirrel'

type WindowsSigning = NonNullable<MakerSquirrelConfig['windowsSign']>

export function resolveWindowsReleaseSigning(
	platform: NodeJS.Platform,
	environment: Readonly<Record<string, string | undefined>>
): WindowsSigning | undefined {
	if (environment.OPEN_KNOWLEDGE_WINDOWS_RELEASE !== '1') return undefined
	if (platform !== 'win32') throw new Error('Build a signed Windows installer on Windows.')
	const thumbprint = environment.OPEN_KNOWLEDGE_WINDOWS_CERT_THUMBPRINT?.trim()
	if (!thumbprint || !/^[0-9a-f]{40}$/i.test(thumbprint)) {
		throw new Error(
			'Set OPEN_KNOWLEDGE_WINDOWS_CERT_THUMBPRINT to a code-signing certificate thumbprint.'
		)
	}
	return { signWithParams: ['/sha1', thumbprint], hashes: ['sha256'] as WindowsSigning['hashes'] }
}
