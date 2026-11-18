import { ipcRenderer, type IpcRendererEvent as IPCRendererEvent } from 'electron'
import * as v from 'valibot'

export const NullSchema = v.null_()

export async function invoke<TSchema extends v.GenericSchema>(
	channel: string,
	input: unknown,
	schema: TSchema
): Promise<v.InferOutput<TSchema>> {
	const value: unknown = await ipcRenderer.invoke(channel, input)
	return v.parse(schema, value)
}

export function subscribe<TSchema extends v.GenericSchema>(
	channel: string,
	schema: TSchema,
	listener: (value: v.InferOutput<TSchema>) => void
): () => void {
	function receive(_event: IPCRendererEvent, value: unknown): void {
		const parsed = v.safeParse(schema, value)
		if (parsed.success) {
			listener(parsed.output)
		}
	}
	ipcRenderer.on(channel, receive)
	return () => {
		ipcRenderer.removeListener(channel, receive)
	}
}
