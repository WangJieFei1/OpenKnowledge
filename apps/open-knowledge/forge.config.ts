import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerAppImage } from '@reforged/maker-appimage'
import { packagedElectronFuses, resolveMacReleaseSecurity } from './electron/build-security'
import { resolveAppEdition } from './src/lib/app-edition'
import { assertEditionManifest } from './scripts/edition-build'

const edition = resolveAppEdition(process.env.OPEN_KNOWLEDGE_EDITION)

const applicationRoot = path.dirname(fileURLToPath(import.meta.url)).replaceAll('\\', '/')
const packagedDirectories = ['build', 'dist-electron']
const macReleaseSecurity = resolveMacReleaseSecurity(
	process.platform,
	process.env,
	path.join(applicationRoot, 'resources', 'entitlements.mac.plist')
)

function ignoreUnpackagedFiles(filePath: string): boolean {
	const normalizedPath = filePath.replaceAll('\\', '/')
	const relativePath = normalizedPath.startsWith(`${applicationRoot}/`)
		? normalizedPath.slice(applicationRoot.length + 1)
		: normalizedPath.replace(/^\/+/, '')

	if (!relativePath || relativePath === 'package.json') {
		return false
	}
	return !packagedDirectories.some(
		(directory) => relativePath === directory || relativePath.startsWith(`${directory}/`)
	)
}

const config: ForgeConfig = {
	// Preserve the existing CI's out/make glob when no edition was explicitly selected.
	// The named edition scripts always set the environment and use isolated output directories.
	outDir: process.env.OPEN_KNOWLEDGE_EDITION === undefined ? 'out' : `out/${edition.id}`,
	hooks: {
		async readPackageJson(_config, packageJSON) {
			return {
				...packageJSON,
				name: edition.packageName,
				productName: edition.name,
				desktopName: `${edition.packageName}.desktop`
			}
		},
		async prePackage() {
			const packageJSON = JSON.parse(
				await readFile(path.join(applicationRoot, 'package.json'), 'utf8')
			)
			for (const directory of ['build', 'dist-electron']) {
				const manifest = JSON.parse(
					await readFile(path.join(applicationRoot, directory, 'edition.json'), 'utf8')
				)
				assertEditionManifest(manifest, edition, packageJSON.version)
			}
		},
		async packageAfterCopy(_config, buildPath) {
			const packagePath = path.join(buildPath, 'package.json')
			const packageJSON = JSON.parse(await readFile(packagePath, 'utf8'))
			await writeFile(
				packagePath,
				JSON.stringify(
					{
						...packageJSON,
						name: edition.packageName,
						productName: edition.name,
						desktopName: `${edition.packageName}.desktop`
					},
					null,
					2
				)
			)
		}
	},
	packagerConfig: {
		name: edition.name,
		executableName: edition.executableName,
		icon: 'src/lib/assets/app-icon',
		appBundleId: edition.bundleID,
		appCategoryType: 'public.app-category.productivity',
		appCopyright: 'Copyright 2026 OpenKnowledgeApp',
		...macReleaseSecurity,
		extendInfo: {
			NSDesktopFolderUsageDescription:
				'Open Knowledge needs access to Desktop folders you select as workspaces.',
			NSDocumentsFolderUsageDescription:
				'Open Knowledge needs access to Documents folders you select as workspaces.',
			NSDownloadsFolderUsageDescription:
				'Open Knowledge needs access to Downloads folders you select as workspaces.',
			NSNetworkVolumesUsageDescription:
				'Open Knowledge needs access to network folders you select as workspaces.',
			NSRemovableVolumesUsageDescription:
				'Open Knowledge needs access to removable folders you select as workspaces.'
		},
		asar: { unpack: '**/node_modules/onnxruntime-node/bin/**/*' },
		prune: false,
		ignore: ignoreUnpackagedFiles
	},
	makers: [
		new MakerZIP(),
		new MakerAppImage({
			options: {
				categories: ['Office'],
				icon: 'src/lib/assets/favicon.svg'
			}
		}),
		new MakerDMG({}, ['darwin']),
		new MakerSquirrel(
			{
				name: edition.id === 'codex' ? 'OpenKnowledgeCodex' : 'OpenKnowledgeGeneral',
				setupIcon: 'src/lib/assets/app-icon.ico'
			},
			['win32']
		)
	],
	plugins: [new FusesPlugin(packagedElectronFuses)]
}

export default config
