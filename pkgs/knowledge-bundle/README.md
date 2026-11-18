# Knowledge Bundle

Portable contracts and format helpers for Open Knowledge bundles. This package has no Electron or
filesystem dependency, so a local, remote, or embedded backend can implement the same API.

`KnowledgeBundleBackend` covers the editor's list, read, save, create, rename, and delete lifecycle.
`BoundedKnowledgeBundleBackend` adds size-limited and cancellable access for protocol adapters such
as MCP. Entry `id` and `revision` values are opaque backend tokens; callers must only compare and
return them. Bundle paths are canonical, `/`-separated paths relative to the bundle root.

Frontmatter-preserving Markdown helpers are available from
`@open-knowledge/knowledge-bundle/frontmatter`.

This is currently a private source-export workspace package for Bun, TypeScript, and Vite consumers.
Add compiled JavaScript exports before publishing it for direct use from plain Node.js.
