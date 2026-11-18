import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import {
	applyEdits,
	modify,
	parse,
	parseTree,
	printParseErrorCode,
	type FormattingOptions,
	type ParseError
} from 'jsonc-parser'
import { nodeErrorCode, UnknownRecordSchema } from '../validation'

export type JSONCObject = Record<string, unknown>

export interface JSONCFileOptions<T extends object> {
	/** JSONC used as the base for the first explicit write. */
	initialContent?: string
	/** Permissions used for newly written files and directories. */
	fileMode?: number
	directoryMode?: number
	/** May validate by throwing and may return a normalized view without rewriting the file. */
	normalize?: (value: JSONCObject) => T
}

export class JSONCFile<T extends object = JSONCObject> {
	private readonly initialContent: string
	private writeTail: Promise<void> = Promise.resolve()

	constructor(
		readonly filePath: string,
		private readonly options: JSONCFileOptions<T> = {}
	) {
		this.initialContent = options.initialContent ?? '{}'
	}

	load(): Promise<T> {
		return this.writeTail.then(() => this.read())
	}

	set(key: string, value: unknown): Promise<T> {
		if (value === undefined) {
			return Promise.reject(new TypeError('Use delete() to remove a JSONC setting.'))
		}
		return this.enqueue(() => this.edit(key, value))
	}

	delete(key: string): Promise<T> {
		return this.enqueue(() => this.edit(key, undefined))
	}

	update(values: JSONCObject, deletedKeys: string[] = []): Promise<T> {
		return this.enqueue(() => this.editMany(values, deletedKeys))
	}

	private enqueue(operation: () => Promise<T>): Promise<T> {
		const result = this.writeTail.then(operation)
		this.writeTail = result.then(
			() => undefined,
			() => undefined
		)
		return result
	}

	private async read(): Promise<T> {
		const source = await readOptionalFile(this.filePath)
		return this.normalize(source === undefined ? {} : parseObject(source, this.filePath))
	}

	private async edit(key: string, value: unknown): Promise<T> {
		return this.editMany(
			value === undefined ? {} : { [key]: value },
			value === undefined ? [key] : []
		)
	}

	private async editMany(values: JSONCObject, deletedKeys: string[]): Promise<T> {
		const storedSource = await readOptionalFile(this.filePath)
		let content = storedSource ?? this.initialContent
		parseObject(content, this.filePath)
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) {
				throw new TypeError('Use deletedKeys to remove a JSONC setting.')
			}
			content = applyEdits(
				content,
				modify(content, [key], value, { formattingOptions: inferFormatting(content) })
			)
		}
		for (const key of deletedKeys) {
			content = applyEdits(
				content,
				modify(content, [key], undefined, { formattingOptions: inferFormatting(content) })
			)
		}
		const result = this.normalize(parseObject(content, this.filePath))
		await writeAtomic(
			this.filePath,
			content,
			this.options.fileMode ?? 0o600,
			this.options.directoryMode ?? 0o700
		)
		return result
	}

	private normalize(value: JSONCObject): T {
		return this.options.normalize ? this.options.normalize(value) : (value as T)
	}
}

function parseObject(source: string, filePath: string): JSONCObject {
	const errors: ParseError[] = []
	const value: unknown = parse(source, errors, {
		allowTrailingComma: true,
		disallowComments: false
	})
	const error = errors[0]
	if (error) {
		throw new SyntaxError(
			`Invalid JSONC in ${filePath}: ${printParseErrorCode(error.error)} at offset ${error.offset}.`
		)
	}
	const result = v.safeParse(UnknownRecordSchema, value)
	if (!result.success) {
		throw new TypeError(`Expected ${filePath} to contain a JSONC object.`)
	}
	const seen = new Set<string>()
	for (const property of parseTree(source)?.children ?? []) {
		const key = property.children?.[0]?.value
		if (typeof key !== 'string') {
			continue
		}
		if (seen.has(key)) {
			throw new SyntaxError(`Invalid JSONC in ${filePath}: duplicate property "${key}".`)
		}
		seen.add(key)
	}
	return result.output
}

function inferFormatting(source: string): FormattingOptions {
	const indentation = source.match(/(?:^|\r?\n)([ \t]+)(?="(?:[^"\\]|\\.)*"\s*:)/)?.[1]
	return {
		eol: source.includes('\r\n') ? '\r\n' : '\n',
		insertSpaces: !indentation?.includes('\t'),
		tabSize: indentation && !indentation.includes('\t') ? indentation.length : 2
	}
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
	try {
		return await readFile(filePath, 'utf8')
	} catch (error) {
		if (nodeErrorCode(error) === 'ENOENT') {
			return undefined
		}
		throw error
	}
}

async function writeAtomic(
	filePath: string,
	content: string,
	fileMode: number,
	directoryMode: number
): Promise<void> {
	const directory = path.dirname(filePath)
	await mkdir(directory, { recursive: true, mode: directoryMode })
	const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
	let handle: FileHandle | undefined
	let temporaryExists = false
	try {
		handle = await open(temporaryPath, 'wx', fileMode)
		temporaryExists = true
		if (process.platform !== 'win32') {
			await handle.chmod(fileMode)
		}
		await handle.writeFile(content, 'utf8')
		await handle.sync()
		await handle.close()
		handle = undefined
		await rename(temporaryPath, filePath)
		temporaryExists = false
		await syncDirectory(directory)
	} finally {
		if (handle) {
			await handle.close().catch(() => undefined)
		}
		if (temporaryExists) {
			await rm(temporaryPath, { force: true })
		}
	}
}

async function syncDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') {
		return
	}
	const handle = await open(directory, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}
