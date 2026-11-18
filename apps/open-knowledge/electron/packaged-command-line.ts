export type ElectronCommandLine = {
	removeSwitch(name: string): void
}

export const forbiddenPackagedSwitches = [
	'allow-running-insecure-content',
	'disable-gpu-sandbox',
	'disable-site-isolation-trials',
	'disable-web-security',
	'ignore-certificate-errors',
	'inspect',
	'inspect-brk',
	'inspect-port',
	'js-flags',
	'no-sandbox',
	'remote-debugging-address',
	'remote-debugging-port'
] as const

/** Remove debugging and sandbox-bypass flags before Chromium starts in a packaged application. */
export function hardenPackagedCommandLine(
	packaged: boolean,
	commandLine: ElectronCommandLine
): void {
	if (!packaged) {
		return
	}
	for (const name of forbiddenPackagedSwitches) {
		commandLine.removeSwitch(name)
	}
}
