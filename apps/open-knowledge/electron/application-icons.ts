import { nativeImage, type NativeImage } from 'electron'
import applicationIconDataURL from '../src/lib/assets/app-icon.png?inline'
import trayIconDataURL from '../src/lib/assets/tray-icon.png?inline'

export interface ApplicationIcons {
	application: NativeImage
	tray: NativeImage
}

export function loadApplicationIcons(): ApplicationIcons {
	const application = nativeImage.createFromDataURL(applicationIconDataURL)
	const tray = nativeImage.createFromBuffer(
		Buffer.from(trayIconDataURL.slice(trayIconDataURL.indexOf(',') + 1), 'base64'),
		{ scaleFactor: 2 }
	)
	if (application.isEmpty() || tray.isEmpty()) {
		throw new Error('The application icons could not be loaded.')
	}
	return { application, tray }
}
