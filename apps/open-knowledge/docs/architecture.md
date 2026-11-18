# Architecture

These boundaries should remain stable; source code defines implementation details.

## Layers

- `src/` is a sandboxed SvelteKit renderer. UI code has no Node or Electron access.
- `electron/preload.ts` exposes the validated `OpenKnowledgeAPI`; raw IPC does not cross this boundary.
- `pkgs/knowledge-bundle` owns portable bundle contracts, paths, and Markdown format helpers.
- `pkgs/knowledge-bundle-filesystem` implements serialized local bundle access and change notifications.
- `pkgs/knowledge-bundle-mcp` implements transport-neutral MCP tools, resources, and prompts over injected bundle functions.
- `electron/` composes backends with windows, settings, IPC, MCP credentials, and HTTP/stdio transport.
- `WorkspaceSession` owns renderer-side document and tab state.

Renderer knowledge features depend on `KnowledgeAPI`, not Electron IPC.

## Navigation

SvelteKit paths represent shareable page state:

- `/workspaces`
- `/workspaces/[workspaceID]`
- `/workspaces/[workspaceID]/documents/[...documentPath]`
- `/settings`
- `/mcp`

Window-local UI state, such as tab order and editor mode, does not need to be encoded in the URL.

## Data integrity

Workspace files are authoritative. Mutations use canonical bundle paths. Updates compare file identity, revision, and content hash before atomic replacement. Creates require an existing parent and unused path. Conflicts never overwrite data.

Editor mode is a user choice. Rich editing may normalize ordinary Markdown syntax when the body changes; source mode edits exact text. Parseable frontmatter is edited separately and unrelated YAML is preserved. If frontmatter cannot be parsed, rich mode treats the whole file as ordinary Markdown and structured property controls remain unavailable.

Plain Markdown and generic YAML frontmatter remain format-neutral. Typing `@` in the rich editor offers files and folders from the current workspace as Markdown link targets. A folder-level `index.md` with a string `okf_version` enables Open Knowledge metadata and concept templates for that subtree. Strict conformance diagnostics never block opening, editing, or saving.

## Security

- Keep renderer sandboxing, context isolation, web security, and CSP enabled.
- Authorize IPC from the trusted main frame and its assigned window/workspace role.
- Reject traversal, symlink escapes and swaps, untrusted navigation, popups, and unrequested permissions. Keep MCP away from protected workspace-internal paths.
- Keep MCP disabled by default, loopback-only, authenticated, scoped to explicitly included workspaces, and free of absolute filesystem paths or internal workspace IDs.
