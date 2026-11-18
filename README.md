# Open Knowledge

Open Knowledge 是一个本地 Markdown 工作台。把笔记、研究资料和项目文档放进普通文件夹，就能在桌面上编辑和全文搜索。通过 MCP 连接的工具还可以按关键词、语义或两者结合检索；检索片段保留原文件和行号，方便回头核对。

- **文件留在原处。** Markdown 可以直接编辑，也能用其他编辑器打开。支持转换的其他文档格式可作为只读资料查看。
- **语义检索在本机运行。** 第一次从源码启动时需要准备模型文件，此后生成向量不调用云端接口。
- **连接按工作区授权。** 默认不向 MCP 客户端开放任何工作区；开放后默认只读，写入需单独授权。接收检索片段的客户端如何处理数据，取决于该客户端。

默认构建**通用版**。**Codex 版**另外支持按项目检索本机 Codex 会话，这个功能默认关闭。两版的设置和连接授权互不继承；详见[版本说明](apps/open-knowledge/docs/editions.md)。

## 从源码启动

需要 Bun 1.4.0 和 Node.js 22.17 或更高版本。macOS 上安装原生构建依赖需要 Xcode 命令行工具。在仓库根目录安装依赖：

```sh
bun install --frozen-lockfile
cd apps/open-knowledge
bun run dev
```

启动后，选择一个已有的笔记文件夹即可开始。需要打包时，请看[开发指南](apps/open-knowledge/docs/development.md)；本仓库提供源代码，不包含预编译安装包。

在仓库根目录运行 `bun test apps/open-knowledge pkgs` 执行测试，运行 `bun run check` 检查类型。

## 文档

[工作区与文件格式](apps/open-knowledge/docs/open-knowledge-format.md) · [MCP 连接](apps/open-knowledge/docs/mcp.md) · [检索行为](apps/open-knowledge/docs/retrieval-quality.md) · [打包与签名](apps/open-knowledge/docs/release-security.md)

## 许可证

按 [MIT 许可证](LICENSE)发布，保留 OpenKnowledgeApp 的原始版权声明。
