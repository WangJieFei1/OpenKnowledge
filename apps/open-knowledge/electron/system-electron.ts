import { existsSync } from 'node:fs'
import path from 'node:path'

const executable =
	process.env.OPEN_KNOWLEDGE_SYSTEM_ELECTRON ??
	process.env.PATH?.split(path.delimiter)
		.filter((directory) => !directory.includes('node_modules'))
		.map((directory) =>
			path.join(directory, process.platform === 'win32' ? 'electron.exe' : 'electron')
		)
		.find((candidate) => existsSync(candidate))

if (!executable) {
	throw new Error('A system Electron executable was not found on PATH.')
}

export default executable
