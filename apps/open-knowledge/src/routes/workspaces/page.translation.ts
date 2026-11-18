import { translation } from '#lib/i18n/index.js'

export type WorkspaceSelectorMessageID =
	| 'runtimeUnavailable'
	| 'recentWorkspacesFailed'
	| 'folderPickerUnavailable'
	| 'folderNotFound'
	| 'folderPermissionDenied'
	| 'folderNotDirectory'
	| 'folderRootNotSupported'
	| 'folderUnavailable'
	| 'workspaceStorageFull'
	| 'workspaceStorageUnavailable'
	| 'folderOpenUnexpected'
	| 'remoteConnectionFailed'
	| 'workspaceOpenFailed'
	| 'settingsOpenFailed'

export const pageTranslation = translation({
	en: {
		pageTitle: 'Choose a workspace · Open Knowledge',
		windowTitle: 'Choose a workspace',
		heading: 'Workspaces',
		description: 'Open a Markdown folder or connect directly to a remote knowledge bundle.',
		openFolder: 'Open folder',
		connectRemote: 'Connect remote',
		remoteEndpoint: 'Remote endpoint',
		remoteHeading: 'Connect a remote bundle',
		remoteDescription: 'Configure the endpoint and credentials supplied by your bundle provider.',
		remoteURI: 'Endpoint URI',
		remotePlaceholder: 'okb://knowledge.example/bundles/main',
		remoteURIHint: 'Use the okb:// address supplied by the endpoint.',
		remoteAuthorization: 'Authorization (optional)',
		remoteAuthorizationPlaceholder: 'Bearer token',
		remoteAuthorizationHint: 'Paste the complete Authorization header value, if required.',
		remoteSecurity: 'Credentials are encrypted at rest and sent only to this endpoint.',
		showAuthorization: 'Show credential',
		hideAuthorization: 'Hide credential',
		cancel: 'Cancel',
		connect: 'Connect',
		connecting: 'Connecting',
		recent: 'Recent',
		loadingWorkspaces: 'Loading workspaces',
		noRecentWorkspaces: 'No recent workspaces',
		runtimeUnavailable: 'Start Open Knowledge through Electron to choose a workspace.',
		recentWorkspacesFailed: 'Recent workspaces could not be loaded.',
		folderPickerUnavailable:
			'The system folder picker could not open. Restart Open Knowledge and try again.',
		folderNotFound: 'That folder no longer exists. Restore it or choose another folder.',
		folderPermissionDenied:
			'Open Knowledge does not have permission to read that folder. Grant access in system settings or choose another folder.',
		folderNotDirectory: 'The selected path is not a folder. Choose a folder instead.',
		folderRootNotSupported:
			'An entire filesystem cannot be a workspace. Choose a folder inside the drive instead.',
		folderUnavailable:
			'That folder is unavailable. Reconnect its drive or network location, then try again.',
		workspaceStorageFull:
			'Open Knowledge cannot remember this workspace because the disk is full. Free some space and try again.',
		workspaceStorageUnavailable:
			'The folder is readable, but Open Knowledge cannot save it to Recent Workspaces. Check the app data permissions and try again.',
		folderOpenUnexpected:
			'An unexpected system error prevented Open Knowledge from adding this folder.',
		remoteConnectionFailed: 'The remote knowledge bundle could not be connected.',
		workspaceOpenFailed: 'The workspace could not be opened.',
		settingsOpenFailed: 'Application settings could not be opened.',
		systemDetail: 'System detail',
		now: 'Now',
		minutesAgo: (count: number) => `${count}m`,
		hoursAgo: (count: number) => `${count}h`,
		daysAgo: (count: number) => `${count}d`
	},
	'zh-cn': {
		pageTitle: '选择工作区 · Open Knowledge',
		windowTitle: '选择工作区',
		heading: '工作区',
		description: '打开 Markdown 文件夹，或直接连接远程知识包。',
		openFolder: '打开文件夹',
		connectRemote: '连接远程',
		remoteEndpoint: '远程端点',
		remoteHeading: '连接远程知识包',
		remoteDescription: '配置知识包服务提供的端点地址和访问凭据。',
		remoteURI: '端点 URI',
		remotePlaceholder: 'okb://knowledge.example/bundles/main',
		remoteURIHint: '使用端点提供的 okb:// 地址。',
		remoteAuthorization: 'Authorization（可选）',
		remoteAuthorizationPlaceholder: 'Bearer 令牌',
		remoteAuthorizationHint: '如有需要，请粘贴完整的 Authorization 请求头值。',
		remoteSecurity: '凭据将加密存储，并且仅发送到此端点。',
		showAuthorization: '显示凭据',
		hideAuthorization: '隐藏凭据',
		cancel: '取消',
		connect: '连接',
		connecting: '正在连接',
		recent: '最近使用',
		loadingWorkspaces: '正在加载工作区',
		noRecentWorkspaces: '没有最近使用的工作区',
		runtimeUnavailable: '请通过 Electron 启动 Open Knowledge 以选择工作区。',
		recentWorkspacesFailed: '无法加载最近使用的工作区。',
		folderPickerUnavailable: '无法打开系统文件夹选择器。请重新启动 Open Knowledge 后再试。',
		folderNotFound: '所选文件夹已不存在。请恢复该文件夹，或选择其他文件夹。',
		folderPermissionDenied:
			'Open Knowledge 没有读取该文件夹的权限。请在系统设置中授予访问权限，或选择其他文件夹。',
		folderNotDirectory: '所选路径不是文件夹。请选择一个文件夹。',
		folderRootNotSupported: '不能将整个文件系统作为工作区。请选择磁盘内的文件夹。',
		folderUnavailable: '所选文件夹当前不可用。请重新连接其磁盘或网络位置，然后重试。',
		workspaceStorageFull: '磁盘空间不足，Open Knowledge 无法记住此工作区。请释放空间后重试。',
		workspaceStorageUnavailable:
			'文件夹可读取，但 Open Knowledge 无法保存“最近使用的工作区”数据。请检查应用数据目录的写入权限后重试。',
		folderOpenUnexpected: '意外的系统错误导致 Open Knowledge 无法添加此文件夹。',
		remoteConnectionFailed: '无法连接远程知识包。',
		workspaceOpenFailed: '无法打开工作区。',
		settingsOpenFailed: '无法打开应用设置。',
		systemDetail: '系统详情',
		now: '刚刚',
		minutesAgo: (count: number) => `${count} 分钟前`,
		hoursAgo: (count: number) => `${count} 小时前`,
		daysAgo: (count: number) => `${count} 天前`
	}
})

export function relativeTime(value: string): string {
	const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
	const minutes = Math.floor(elapsed / 60_000)
	if (minutes < 1) {
		return pageTranslation.now
	}
	if (minutes < 60) {
		return pageTranslation.minutesAgo(minutes)
	}
	const hours = Math.floor(minutes / 60)
	if (hours < 24) {
		return pageTranslation.hoursAgo(hours)
	}
	return pageTranslation.daysAgo(Math.floor(hours / 24))
}
