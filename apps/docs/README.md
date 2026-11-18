# Open Knowledge documentation

The static documentation site is built with Fumadocs UI, Fumadocs MDX, React Router, and Vite.
It was initialized with the official CLI:

```bash
bunx create-fumadocs-app@latest apps/docs --template react-router-spa --pm bun --linter oxlint --search orama --install --no-git
```

English source is stored in `content/docs/en`. Simplified Chinese source is stored in
`content/docs/zh`. Both sets are required; locale fallback is disabled.

## Commands

```bash
bun run dev
bun run lint
bun run types:check
bun run build
bun run preview
```

`bun run build` prerenders every locale, document, search index, and LLM text endpoint into
`build/client`. No application server is required for deployment.
