# General and Codex editions

Two separately packaged applications share the same local knowledge and retrieval engine. Choose
General when you do not want a Codex-specific integration; choose Codex for optional project-scoped
Codex history and a ready-to-copy Codex connection configuration.

| Capability | Open Knowledge General | Open Knowledge Codex |
| --- | --- | --- |
| Local multilingual embeddings, keyword/semantic/hybrid recall | Included | Included |
| Structured table rows, SQL/schema chunks, financial metadata filters and canonical guards | Included | Included |
| Research, quantitative-review and consulting-handoff prompts | Included | Included |
| Standard MCP command (stdio) and loopback HTTP | Supported | Supported |
| Codex session history reader and related settings | Not bundled; enabling is rejected | Bundled; off by default |
| Extra Codex TOML copy tab | Not included | Included |
| Application bundle ID | `com.openknowledge.app.general` | `com.openknowledge.app.codex` |

## Build and outputs

Run in `apps/open-knowledge`:

```bash
bun run build:mac:general
bun run build:mac:codex
# Or build both sequentially
bun run build:mac:editions
```

General is the default when `OPEN_KNOWLEDGE_EDITION` is unset. The build accepts only `general` or
`codex` and bakes that choice into the renderer, preload and main process. This is not a runtime
toggle: changing an environment variable after packaging cannot enable Codex memory in General.
General replaces the memory provider at build time, so its main bundle omits the Codex history reader.

The named edition commands isolate artifacts under `out/general/` and `out/codex/`; building one edition preserves the
other edition's packaged outputs. Intermediate `build/` and `dist-electron/` directories are shared,
so build the editions sequentially, not concurrently. Packaging checks the edition and version
manifests to reject mixed build outputs.

Invoking Forge without `OPEN_KNOWLEDGE_EDITION` packages General into `out/`. The
[installer workflow example](build-desktop-installers.yml.example) builds General. A separate
[dual-edition example](build-desktop-installers.editions.yml.example) shows the two-edition matrix.
Neither example runs automatically in this repository.

Validate each macOS ASAR with `bun run test:edition:electron '/absolute/path/to/app.asar'`.
The smoke harness runs the actual packaged main, preload and renderer in stock Electron with a
temporary profile and synthetic workspace, verifies MCP retrieval and memory capability gates,
and never calls a session-history tool. `test:semantic:electron` separately exercises the packaged
local model and native runtime (pass the ASAR's `dist-electron/semantic-runtime.mjs` path and set
`OPEN_KNOWLEDGE_SEMANTIC_EXPECT_ASAR=1`).

The locally produced macOS packages target Apple Silicon (arm64), use ad-hoc signing and are not
Apple-notarized. They are local test packages, not a notarized public release.

## Separate settings and safe migration

The editions have distinct application names, bundle IDs and application-data directories. On macOS:

- `~/Library/Application Support/Open Knowledge General/`
- `~/Library/Application Support/Open Knowledge Codex/`

Neither edition automatically inherits the old `Open Knowledge` application's settings, recent
workspaces, MCP grants, credentials or memory opt-in. Open the desired existing workspace manually,
then explicitly configure access and copy the connection from the edition you intend to use. Your
workspace files remain in their original location; there is no automatic copy or deletion of them.

Both editions may coexist. If both open the same workspace, avoid concurrent edits to its files;
separate app settings do not create separate copies of shared workspace content. Connections and
credentials are also edition-specific; do not reuse one edition's connection as the other's.

## Codex memory and connection boundaries

In the Codex edition, enable memory only after explicitly including a workspace in MCP Settings.
Eligible history is limited to local Codex sessions whose recorded working directory is the selected
workspace root or its descendants. Only user/assistant dialogue is exposed, not other projects,
tool calls/results or hidden reasoning. Disabling memory or revoking access closes active sessions
and clears derived caches. General rejects memory enable requests even if copied or edited settings
contain an enabled flag.

Every authorized MCP client can access the exposed tools; the Codex edition does not restrict them
to a client named Codex. Embeddings and history reading run locally, but a client can send returned
excerpts to its AI service. Grant access only to clients you trust.

Both editions expose standard MCP stdio/HTTP connection details. Codex additionally provides a
TOML copy tab for its stdio connection, without embedding an HTTP bearer token. Open Knowledge does
not edit `~/.codex/config.toml` or any other Codex configuration automatically. Keep the chosen
application running while its client connects. See the [connection guide](mcp.md).

## What this split does not add

The editions use the same clean-room implementation, not a bundled Trellis dependency. Neither edition
includes fine-tuning, a learned cross-encoder reranker, tokenizer-exact `budget_tokens`, a
full-corpus persistent index for tens of thousands of entries, or live trading. `max_bytes` remains
a UTF-8 byte limit, not a token limit. See [retrieval quality and remaining work](retrieval-quality.md).
