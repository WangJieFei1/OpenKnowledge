# Engineering Guidelines

Use these defaults unless a change is clearer or safer. Update durable documentation when an architectural boundary changes.

## Code

- Organize by domain and ownership; extract abstractions only when they serve a real boundary or repeated use.
- Keep strict TypeScript clean. Validate IPC, filesystem, YAML, JSON, and remote data at their boundaries.
- Follow the repository formatter and established naming patterns.
- Prefer the smallest change that solves the problem; do not add speculative compatibility layers.

## UI

- Use Svelte 5 patterns and existing UI primitives where they fit.
- Keep workflow state outside presentational components.
- Preserve route-addressable workspace, document, and settings state.
- Use native or Bits UI semantics rather than rebuilding keyboard and focus behavior.
- Keep the desktop UI accessible and usable at `960 x 640`.

## Knowledge

- Treat workspace files as the source of truth.
- Preserve unknown metadata, YAML shapes, comments, ordering, and unsupported Markdown whenever the user did not edit them.
- Treat schemas, inferred types, and templates as suggestions rather than gates.
- Keep source mode available when rich editing cannot preserve a document.

## Safety

- Keep Node and Electron capabilities out of the renderer.
- Validate IPC senders, roles, workspace assignments, and all bundle-relative paths.
- Revalidate file identity and revision inside the serialized mutation immediately before an atomic write.
- Keep external access authenticated, scoped, and free of absolute filesystem details.

## Verification

Run checks proportional to the change. The normal completion baseline is:

```bash
bun run lint
bun run check
bun run build
```

Use targeted tests during development. Exercise affected Electron workflows for changes involving windows, routes, filesystem behavior, editor round-tripping, or IPC.
