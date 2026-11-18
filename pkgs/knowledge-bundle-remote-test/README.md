# Knowledge Bundle Remote Test

Private Bun service exposing a shared, editable in-memory knowledge bundle through Cap'n Web and
Hono. Its initial Markdown documents describe the test bundle, and all edits remain available to
later HTTP sessions for the lifetime of the process.

The editable Cap'n Web target implements the required native `patchFile` operation. It applies the
shared exact-text algorithm server-side, enforces revision/hash and output-size preconditions, and
mutates stored content only after every edit succeeds.

From the repository root, run:

```sh
bun run --filter @open-knowledge/knowledge-bundle-remote-test start
```

Connect with:

```text
okb://127.0.0.1:8787/bundle?insecure=true
```

The service binds only to loopback. Its contents are reset whenever the process restarts.
It intentionally omits the `SubscribableKnowledgeBundle` extension, so clients exercise explicit
refreshes.
