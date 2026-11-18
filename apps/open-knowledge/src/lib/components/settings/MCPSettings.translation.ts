import { translation } from '#lib/i18n/index.js'

const english = {
	generalEditionTitle: 'General edition',
	generalEditionDescription:
		'Client-neutral knowledge retrieval for research, analysis and consulting. Connect any compatible local MCP client with STDIO or HTTP. This edition does not read AI-client conversation history.',
	codexEditionTitle: 'Codex-optimized edition',
	codexEditionDescription:
		'The same open MCP knowledge tools, plus ready-to-copy Codex setup and optional project-scoped Codex session memory. Memory stays off until you enable it; other compatible MCP clients are still supported.',
	eyebrow: 'LOCAL MCP',
	overviewTitle: 'One connection, explicit workspace access',
	overviewDescription: 'Choose which knowledge workspaces local MCP clients can read or edit.',
	semanticTitle: 'Local semantic search for connected AI',
	semanticDescription:
		'Recall searches by meaning and keywords, including across Chinese and English. The bundled model runs on this device with no embedding API charge. The first search builds a private cache; later searches reuse unchanged passages. Your AI service still charges for the excerpts it reads.',
	memoryTitle: 'Codex session memory',
	memoryDescription:
		'Allow authorized MCP clients to search user/assistant history for included local projects and their subfolders. Retrieval runs locally; returned excerpts are shared with the client and may be sent to its AI service. Other projects are excluded. Off by default; reconnect clients after changing.',
	workflowsTitle: 'Research workflows',
	workflowsDescription:
		'Choose a prompt in your connected MCP client. Each workflow checks sources, dates, assumptions and missing evidence.',
	researchTitle: 'Data analysis & research',
	researchDescription:
		'Turn a question into a sourced brief with findings, counterevidence and next steps.',
	quantTitle: 'Quantitative research review',
	quantDescription:
		'Review hypotheses, data provenance, leakage, out-of-sample evidence and transaction costs.',
	handoffTitle: 'Consulting project handoff',
	handoffDescription:
		'Recover decisions, deliverables, owners, dependencies and open issues with source citations.',
	memoryEnabled: 'Enabled',
	memoryDisabled: 'Disabled',
	memoryToggleAria: 'Allow access to local Codex session memory',
	statusOff: 'Off',
	statusListening: 'Listening on this device',
	statusUnavailable: 'Unavailable',
	statusStarting: 'Starting',
	globalEnabled: 'On',
	globalPaused: 'Paused',
	globalEnabledAria: 'Enable MCP connections',
	workspaceCount: (count: number): string =>
		`${count} included ${count === 1 ? 'workspace' : 'workspaces'}`,
	workspaceStatusNotIncluded: 'Not included',
	workspaceStatusListening: 'Included | Listening',
	workspaceStatusUnavailable: 'Included | Unavailable',
	workspaceStatusStarting: 'Included | Starting',
	workspaceStatusPaused: 'Included | Paused',
	workspaceAccess: 'Workspace access',
	workspaceAccessManyDescription: 'Each workspace keeps its own access control.',
	workspaceAccessSingleDescription:
		'Control access for this workspace without another settings page.',
	loadingWorkspaces: 'Loading registered workspaces...',
	noWorkspaces: 'Open a workspace before configuring MCP access.',
	accessOff: 'Off',
	accessRead: 'Read',
	accessWrite: 'Read & edit',
	workspaceAccessAria: (label: string): string => `MCP access for ${label}`,
	connection: 'Connection',
	connectionDescription:
		'Credentials are shared by included workspaces and stay hidden by default.',
	noWorkspaceAccess: 'No workspace access',
	noWorkspaceAccessDescription: 'Include a workspace to start the local connection.',
	connectionDetails: 'Connection details',
	connectionAccessDescription: (workspaceCount: string): string =>
		`The app must remain running. This connection can access ${workspaceCount}.`,
	hideCredential: 'Hide credential',
	revealConnection: 'Reveal connection',
	credentialWarning:
		'These details grant local access to every included workspace, including edits where enabled. Treat them as secrets and share them only with clients you trust.',
	transportAria: 'MCP connection transport',
	commandStdio: 'Command (stdio)',
	codexSetup: 'Codex setup',
	codexConfiguration: 'Codex configuration (TOML)',
	codexConfigurationDescription:
		'Add this server block to ~/.codex/config.toml, or the .codex/config.toml of a trusted project. Replace an existing open_knowledge_codex block instead of adding a duplicate.',
	codexNote:
		'Keep this app running, save the configuration, then restart the Codex client. The stable STDIO bridge reads the private connection file; this snippet does not copy a bearer token. Session memory is enabled separately above.',
	codexDocumentation: 'Official Codex MCP documentation',
	streamableHTTP: 'Streamable HTTP',
	commandConfiguration: 'Command configuration',
	commandConfigurationDescription: 'Paste this object into a command-based MCP client.',
	copy: 'Copy',
	stdioNote:
		'Configure this command once. The app refreshes its private launcher and connection file automatically; restart the client after access changes.',
	httpConfiguration: 'HTTP configuration',
	httpConfigurationDescription: 'Use the complete URL and header with Streamable HTTP.',
	httpNote:
		'The URL is bound to 127.0.0.1. Hosted or cloud connectors cannot reach it; use a client running on this device.',
	regenerateCredential: 'Regenerate credential',
	regenerateTitle: 'Regenerate shared MCP credential?',
	regenerateDescription:
		'All connected MCP clients will be disconnected immediately. Included workspaces do not change. Update the HTTP credential or restart the command connection afterward; its saved command does not change.',
	regenerateConfirm: 'Regenerate',
	copied: (label: string): string => `${label} copied.`,
	clipboardUnavailable: 'Clipboard access was unavailable. Select the configuration manually.',
	errorLoad: 'MCP settings could not be loaded.',
	errorUpdateAccess: 'MCP workspace access could not be updated.',
	errorUpdateGlobal: 'MCP could not be enabled or paused.',
	errorUpdateMemory: 'Codex session memory access could not be updated.',
	errorReveal: 'The MCP connection details could not be revealed.',
	errorRegenerate: 'The MCP credential could not be regenerated.',
	'error.mcp.start': 'The shared MCP server could not be started.',
	'error.mcp.update': 'The shared MCP server could not be updated.',
	'error.mcp.memory': 'Codex session memory access could not be updated.',
	'error.mcp.regenerate': 'The shared MCP credential could not be regenerated.',
	'error.mcp.workspace.not-recent': 'The workspace is not in the recent workspace list.',
	'error.mcp.credential.requires-included':
		'Include this workspace before regenerating the shared credential.',
	'error.mcp.connection.not-listening':
		'The shared MCP connection is not listening for this workspace.',
	'error.mcp.unavailable': 'The MCP server is shutting down.'
}

export const mcpSettingsTranslation = translation({
	en: english,
	'zh-cn': {
		generalEditionTitle: '通用版',
		generalEditionDescription:
			'面向研究、数据分析与咨询的通用知识检索，不绑定特定 AI 客户端。可通过 STDIO 或 HTTP 连接兼容的本地 MCP 客户端。本版本不读取 AI 客户端的历史对话。',
		codexEditionTitle: 'Codex 优化版',
		codexEditionDescription:
			'保留同样的开放 MCP 知识工具，增加可直接复制的 Codex 配置与项目范围内的 Codex 会话记忆。记忆需要手动开启，默认关闭；也支持其他兼容的 MCP 客户端。',
		eyebrow: '本地 MCP',
		overviewTitle: '单一连接，明确的工作区访问权限',
		overviewDescription: '选择本地 MCP 客户端可读取或编辑的知识工作区。',
		semanticTitle: '为已连接的 AI 提供本地语义搜索',
		semanticDescription:
			'按意思和关键词一起找资料，支持中英文跨语言检索。内置模型在本机运行，不收取 embedding API 费用。首次搜索建立私有缓存，之后复用未变化的段落。AI 阅读返回的片段仍会消耗其正常额度。',
		memoryTitle: 'Codex 会话记忆',
		memoryDescription:
			'允许已授权的 MCP 客户端检索已包含本地项目及子目录的用户/助手历史对话。检索在本机进行，返回的片段会交给客户端，并可能发送到其 AI 服务。排除其他项目。默认关闭，修改后请重新连接客户端。',
		workflowsTitle: '研究工作流',
		workflowsDescription:
			'在已连接的 MCP 客户端中选择提示词。每个流程都会核对来源、日期、假设与缺失证据。',
		researchTitle: '数据分析与研究',
		researchDescription: '把问题整理成有来源的研究简报，包含发现、反面证据与下一步。',
		quantTitle: '量化研究审查',
		quantDescription: '审查假设、数据来源、前视偏差、样本外证据与交易成本。',
		handoffTitle: '咨询项目交接',
		handoffDescription: '带着来源找回决策、交付物、负责人、依赖关系和未决事项。',
		memoryEnabled: '已启用',
		memoryDisabled: '已关闭',
		memoryToggleAria: '允许访问本机 Codex 会话记忆',
		statusOff: '已关闭',
		statusListening: '正在此设备上侦听',
		statusUnavailable: '不可用',
		statusStarting: '正在启动',
		globalEnabled: '开启',
		globalPaused: '已暂停',
		globalEnabledAria: '启用 MCP 连接',
		workspaceCount: (count: number): string => `${count} 个已包含的工作区`,
		workspaceStatusNotIncluded: '未包含',
		workspaceStatusListening: '已包含 | 正在侦听',
		workspaceStatusUnavailable: '已包含 | 不可用',
		workspaceStatusStarting: '已包含 | 正在启动',
		workspaceStatusPaused: '已包含 | 已暂停',
		workspaceAccess: '工作区访问权限',
		workspaceAccessManyDescription: '每个工作区都有独立的访问控制。',
		workspaceAccessSingleDescription: '无需前往其他设置页面即可控制此工作区的访问权限。',
		loadingWorkspaces: '正在加载已注册的工作区...',
		noWorkspaces: '请先打开工作区，再配置 MCP 访问权限。',
		accessOff: '关闭',
		accessRead: '读取',
		accessWrite: '读取和编辑',
		workspaceAccessAria: (label: string): string => `${label} 的 MCP 访问权限`,
		connection: '连接',
		connectionDescription: '凭据由已包含的工作区共享，并默认保持隐藏。',
		noWorkspaceAccess: '没有工作区访问权限',
		noWorkspaceAccessDescription: '包含一个工作区以启动本地连接。',
		connectionDetails: '连接详情',
		connectionAccessDescription: (workspaceCount: string): string =>
			`应用必须保持运行。此连接可访问 ${workspaceCount}。`,
		hideCredential: '隐藏凭据',
		revealConnection: '显示连接',
		credentialWarning:
			'这些详情可授予对所有已包含工作区的本地访问权限，包括已允许的编辑权限。请将其视为机密，仅与您信任的客户端共享。',
		transportAria: 'MCP 连接传输方式',
		commandStdio: '命令 (stdio)',
		codexSetup: 'Codex 接入',
		codexConfiguration: 'Codex 配置 (TOML)',
		codexConfigurationDescription:
			'将此服务器配置块加入 ~/.codex/config.toml，或可信项目的 .codex/config.toml。若已有 open_knowledge_codex 配置块，请替换该块，避免重复添加。',
		codexNote:
			'保持此应用运行，保存配置后重启 Codex 客户端。稳定的 STDIO 桥接器会读取私有连接文件，此片段不复制 Bearer 凭据。会话记忆需要在上方单独开启。',
		codexDocumentation: 'Codex MCP 官方文档',
		streamableHTTP: '流式 HTTP',
		commandConfiguration: '命令配置',
		commandConfigurationDescription: '将此对象粘贴到基于命令的 MCP 客户端中。',
		copy: '复制',
		stdioNote:
			'只需配置一次此命令。应用会自动刷新私有启动器和连接文件；访问权限更改后请重启客户端。',
		httpConfiguration: 'HTTP 配置',
		httpConfigurationDescription: '通过流式 HTTP 使用完整的 URL 和请求头。',
		httpNote:
			'URL 绑定到 127.0.0.1。托管或云端连接器无法访问该地址；请使用在此设备上运行的客户端。',
		regenerateCredential: '重新生成凭据',
		regenerateTitle: '重新生成共享 MCP 凭据？',
		regenerateDescription:
			'所有已连接的 MCP 客户端都将立即断开。已包含的工作区不会改变。之后请更新 HTTP 凭据或重启命令连接；已保存的命令无需更改。',
		regenerateConfirm: '重新生成',
		copied: (label: string): string => `已复制${label}。`,
		clipboardUnavailable: '剪贴板不可用。请手动选择配置。',
		errorLoad: '无法加载 MCP 设置。',
		errorUpdateAccess: '无法更新 MCP 工作区访问权限。',
		errorUpdateGlobal: '无法启用或暂停 MCP。',
		errorUpdateMemory: '无法更新 Codex 会话记忆访问权限。',
		errorReveal: '无法显示 MCP 连接详情。',
		errorRegenerate: '无法重新生成 MCP 凭据。',
		'error.mcp.start': '无法启动共享 MCP 服务器。',
		'error.mcp.update': '无法更新共享 MCP 服务器。',
		'error.mcp.memory': '无法更新 Codex 会话记忆权限。',
		'error.mcp.regenerate': '无法重新生成共享 MCP 凭据。',
		'error.mcp.workspace.not-recent': '此工作区不在最近使用的工作区列表中。',
		'error.mcp.credential.requires-included': '请先包含此工作区，再重新生成共享凭据。',
		'error.mcp.connection.not-listening': '共享 MCP 连接未侦听此工作区。',
		'error.mcp.unavailable': 'MCP 服务器正在关闭。'
	}
})
