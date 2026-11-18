# Open Knowledge

**Your knowledge should outlive your tools.**

Open Knowledge is an open-source, local-first desktop workspace for managing knowledge and project memory. Give it a folder of Markdown files and it becomes a place to write, organize research, keep track of decisions, and find the passage you need months later. The files stay yours: open them in any editor, back them up however you like, or take the whole folder with you.

## Built for day-to-day data analysis

I use Open Knowledge in my day-to-day data analysis. It is where I keep dataset notes, SQL snippets, metric definitions, assumptions, and findings so I can see how I got an answer and pick up the work later.

When I need to revisit a number, I can search for the passage that explains it instead of opening a dozen files. For structured notes, [metadata filters](apps/open-knowledge/docs/retrieval-quality.md) can narrow results by entity, reporting period, or metric definition. Open Knowledge keeps the context around the analysis; I still run queries and calculations in my usual tools.

## Find the evidence, not just the filename

- **Manage a knowledge base without a proprietary format.** Edit notes in rich-text or Markdown source mode, search across a workspace, and open supported non-Markdown documents in a read-only view.
- **Find what you meant, not just what you typed.** Through the Model Context Protocol (MCP), connected tools can search by keyword, meaning, or both. Multilingual semantic search runs on-device, and results point back to the source file and line range.
- **Pick up where a project left off.** The optional Codex edition can search local conversations from a selected project. That makes past decisions and context retrievable without turning your entire conversation history into a shared workspace.

The **General edition** is the default. Neither edition exposes a workspace through MCP until you explicitly share it. Shared workspaces are read-only unless you grant write access separately. Project memory is an additional opt-in in the **Codex edition**. See [editions and access controls](apps/open-knowledge/docs/editions.md).

## Run from source

You need Bun 1.4.0 and Node.js 22.17 or newer. On macOS, install the Xcode Command Line Tools for native build dependencies. From the repository root:

```sh
bun install --frozen-lockfile
cd apps/open-knowledge
bun run dev
```

Open an existing Markdown folder to get started. The first build downloads the semantic model; subsequent inference runs locally without an embedding API. This release includes source code, not prebuilt installers.

Run `bun test apps/open-knowledge pkgs` for tests and `bun run check` for type checks from the repository root.

## Documentation

[Development and packaging](apps/open-knowledge/docs/development.md) · [Workspace format](apps/open-knowledge/docs/open-knowledge-format.md) · [MCP setup](apps/open-knowledge/docs/mcp.md) · [Retrieval behavior](apps/open-knowledge/docs/retrieval-quality.md)

## License

Open Knowledge is available under the [MIT License](LICENSE).
