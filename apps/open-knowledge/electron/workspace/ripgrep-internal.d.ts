declare module '*ripgrep/lib/_wasi.mjs' {
	type OutputStream = {
		write(chunk: Uint8Array | Buffer): unknown
	}

	type WASIRuntime = {
		imports: WebAssembly.Imports
		start(instance: WebAssembly.Instance): number | Promise<number>
	}

	export function createWasi(options: {
		args: readonly string[]
		stdout?: OutputStream
		stderr?: OutputStream
		env: Record<string, string | undefined>
		preopens: Record<string, string>
		returnOnExit: boolean
	}): WASIRuntime
}

declare module '*ripgrep/lib/_rg.wasm.mjs' {
	export function getCompressedBytes(): Uint8Array
}
