import { TAB_TRANSFER_MIME } from './api'

export function hasTabTransfer(dataTransfer: DataTransfer | null): boolean {
	return dataTransfer ? Array.from(dataTransfer.types).includes(TAB_TRANSFER_MIME) : false
}

export function readTabTransferToken(dataTransfer: DataTransfer | null): string {
	return hasTabTransfer(dataTransfer) ? (dataTransfer?.getData(TAB_TRANSFER_MIME) ?? '') : ''
}

export function writeTabTransferToken(dataTransfer: DataTransfer, token: string): void {
	dataTransfer.setData(TAB_TRANSFER_MIME, token)
}
