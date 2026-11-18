# Release 0.0.3: General and Codex editions / 通用版与 Codex 优化版

Two separately packaged applications share the same local knowledge and retrieval engine. Choose
General when you do not want a Codex-specific integration; choose Codex for optional project-scoped
Codex history and a ready-to-copy Codex connection configuration.

两个独立安装包共用同一套本地知识库与检索引擎。无需 Codex 专项集成时选通用版；需要可选的项目对话记忆和 Codex 连接配置时选优化版。优化版不是只能由 Codex 使用。

| Capability / 能力                                                                                                                               | Open Knowledge General                               | Open Knowledge Codex                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| Local multilingual embeddings, keyword/semantic/hybrid recall / 本地多语言 embedding 与混合检索                                                 | Included / 保留                                      | Included / 保留                          |
| Structured table rows, SQL/schema chunks, financial metadata filters and canonical guards / 表格结构化、SQL/schema 分块、财务口径过滤与冲突保护 | Included / 保留                                      | Included / 保留                          |
| Research, quantitative-review and consulting-handoff prompts / 研究、量化审查与咨询交接提示模板                                                 | Included / 保留                                      | Included / 保留                          |
| Standard MCP command (stdio) and loopback HTTP / 标准 MCP stdio 与本机 HTTP                                                                     | Supported / 支持                                     | Supported / 支持                         |
| Codex session history reader and related settings / Codex 历史读取器与对应设置                                                                  | Not bundled; enabling is rejected / 不打包，无法启用 | Bundled; off by default / 提供，默认关闭 |
| Extra Codex TOML copy tab / 额外 Codex TOML 复制页签                                                                                            | Not included / 不提供                                | Included / 提供                          |
| Application bundle ID / 应用标识                                                                                                                | `com.openknowledge.app.general`                      | `com.openknowledge.app.codex`            |

## Build and outputs / 构建与产物

Run in `apps/open-knowledge`:

```bash
bun run build:mac:general
bun run build:mac:codex
# Or build both sequentially / 或顺序构建两版
bun run build:mac:editions
```

General is the default when `OPEN_KNOWLEDGE_EDITION` is unset. The build accepts only `general` or
`codex` and bakes that choice into the renderer, preload and main process. This is not a runtime
toggle: changing an environment variable after packaging cannot enable Codex memory in General.
General replaces the memory provider at build time, so its main bundle omits the Codex history reader.

未设置 `OPEN_KNOWLEDGE_EDITION` 时默认构建通用版；只接受 `general` 或 `codex`。版本能力在构建时固化，安装后不能通过环境变量切换。通用版在构建时替换记忆 provider，主进程包不包含 Codex 历史读取器。

The named edition commands isolate artifacts under `out/general/` and `out/codex/`; building one edition preserves the
other edition's packaged outputs. Intermediate `build/` and `dist-electron/` directories are shared,
so build the editions sequentially, not concurrently. Packaging checks the edition and version
manifests to reject mixed build outputs.

产物分别位于 `out/general/` 与 `out/codex/`，构建另一版不会清除已生成的安装包。中间目录 `build/`、`dist-electron/` 共用，因此两版应顺序构建，不能并行。打包前会校验版本清单，防止混装。

Invoking Forge without `OPEN_KNOWLEDGE_EDITION` packages General into `out/`. The
[installer workflow example](build-desktop-installers.yml.example) builds General. A separate
[dual-edition example](build-desktop-installers.editions.yml.example) shows the two-edition matrix.
Neither example runs automatically in this repository.

未显式指定版本时，Forge 将通用版打包到 `out/`。通用版与双版本的 CI 配置均为示例，
不会在本仓库自动运行。

Validate each macOS ASAR with `bun run test:edition:electron '/absolute/path/to/app.asar'`.
The smoke harness runs the actual packaged main, preload and renderer in stock Electron with a
temporary profile and synthetic workspace, verifies MCP retrieval and memory capability gates,
and never calls a session-history tool. `test:semantic:electron` separately exercises the packaged
local model and native runtime (pass the ASAR's `dist-electron/semantic-runtime.mjs` path and set
`OPEN_KNOWLEDGE_SEMANTIC_EXPECT_ASAR=1`).

可用 `test:edition:electron` 验证两版实际 ASAR 的首次启动、界面、MCP 文档读取和记忆开关边界；测试只使用临时配置与合成工作区，不调用历史读取工具。`test:semantic:electron` 单独验证安装包里的本地模型和原生运行库。

The locally produced macOS packages target Apple Silicon (arm64), use ad-hoc signing and are not
Apple-notarized. They are local test packages, not a notarized public release.

此次本机 macOS 安装包面向 Apple Silicon（arm64），使用本地 ad-hoc 签名，未做 Apple 公证，不等同于已公证的公开发行包。

## Separate settings and safe migration / 独立设置与迁移

The editions have distinct application names, bundle IDs and application-data directories. On macOS:

- `~/Library/Application Support/Open Knowledge General/`
- `~/Library/Application Support/Open Knowledge Codex/`

Neither edition automatically inherits the old `Open Knowledge` application's settings, recent
workspaces, MCP grants, credentials or memory opt-in. Open the desired existing workspace manually,
then explicitly configure access and copy the connection from the edition you intend to use. Your
workspace files remain in their original location; there is no automatic copy or deletion of them.

两版的应用名、应用标识和用户数据目录彼此独立。不会自动继承旧版的设置、最近工作区、MCP 授权、凭据或记忆开关。请手动打开原工作区，重新授权，并复制所选版本的连接配置；不会自动复制或删除原工作区文件。

Both editions may coexist. If both open the same workspace, avoid concurrent edits to its files;
separate app settings do not create separate copies of shared workspace content. Connections and
credentials are also edition-specific; do not reuse one edition's connection as the other's.

两版可以共存，但同时打开同一工作区时应避免并发写入；应用设置隔离不代表工作区内容有独立副本。连接与凭据也各自独立，不应混用。

## Codex memory and connection boundaries / 记忆与连接边界

In the Codex edition, enable memory only after explicitly including a workspace in MCP Settings.
Eligible history is limited to local Codex sessions whose recorded working directory is the selected
workspace root or its descendants. Only user/assistant dialogue is exposed, not other projects,
tool calls/results or hidden reasoning. Disabling memory or revoking access closes active sessions
and clears derived caches. General rejects memory enable requests even if copied or edited settings
contain an enabled flag.

优化版的记忆默认关闭，须先授权工作区再手动开启。只读取工作目录属于该项目及子目录的本机 Codex 用户/助手对话，不包含其他项目、工具调用及结果或隐藏推理。关闭记忆或撤销授权会关闭活动会话并清理派生缓存。通用版即使遇到复制或手改的开启配置，也会拒绝启用记忆。

Every authorized MCP client can access the exposed tools; the Codex edition does not restrict them
to a client named Codex. Embeddings and history reading run locally, but a client can send returned
excerpts to its AI service. Grant access only to clients you trust.

获授权的 MCP 客户端都可使用已开放工具，并非只有名为 Codex 的客户端可以访问。embedding 与历史读取在本机进行，但客户端可能将返回片段发给其 AI 服务，因此只应向可信客户端授权。

Both editions expose standard MCP stdio/HTTP connection details. Codex additionally provides a
TOML copy tab for its stdio connection, without embedding an HTTP bearer token. Open Knowledge does
not edit `~/.codex/config.toml` or any other Codex configuration automatically. Keep the chosen
application running while its client connects. See the [connection guide](mcp.md).

两版均提供标准 MCP stdio/HTTP 配置；优化版额外提供 Codex stdio 的 TOML 复制页签，不嵌入 HTTP bearer token。不会自动修改 `~/.codex/config.toml` 或其他 Codex 配置。客户端连接期间须保持对应应用运行。详见 [MCP 连接说明](mcp.md)。

## What this split does not add / 此次拆分未新增的能力

The editions use the same clean-room implementation, not a bundled Trellis dependency. This release
does not add fine-tuning, a learned cross-encoder reranker, tokenizer-exact `budget_tokens`, a
full-corpus persistent index for tens of thousands of entries, or live trading. `max_bytes` remains
a UTF-8 byte limit, not a token limit. See [retrieval quality and remaining work](retrieval-quality.md).

两版继续使用独立实现，没有引入 Trellis 依赖。此次拆分未增加模型微调、独立神经 reranker、按目标 tokenizer 精确计算的 `budget_tokens`、几万条规模的全量持久索引或实盘交易。`max_bytes` 仍是 UTF-8 字节上限，不是 token 上限。详见 [检索质量与剩余工作](retrieval-quality.md)。
