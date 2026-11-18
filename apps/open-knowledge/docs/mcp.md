# MCP Connection

Open Knowledge exposes explicitly included local workspaces to trusted AI tools through one application-wide Model Context Protocol (MCP) connection. Access is disabled by default and read-only unless editing is enabled for a workspace.

**Open Knowledge General** and **Open Knowledge Codex** both support standard
MCP clients, local multilingual embeddings, hybrid recall and research prompts. General has no Codex
history reader or memory settings; Codex adds optional, default-off history and a Codex TOML copy tab.
See [editions, builds and migration](editions.md). Each edition has independent
settings, grants and connection credentials; neither automatically inherits the legacy app's access.

## Manage Workspace Access

Choose **MCP > MCP Settings...** in the application menubar. Each registered workspace has separate **Include** and **Edit** toggles; editing requires inclusion. With one registered workspace, these controls appear directly.

Workspace **Settings** provides the same toggles and a shortcut to the MCP window. Permission changes close active sessions but preserve the shared credential. Use **Regenerate credential** to rotate it. Disabling inclusion also clears edit permission.

## Connect A Client

With at least one workspace included, choose **Reveal connection** and copy either configuration:

- **Command (stdio):** preferred for local clients that can launch a command. It reads the owner-only runtime connection file, so client configuration does not contain the bearer token.
- **Streamable HTTP:** use the complete URL and `Authorization` header. The endpoint binds only to `127.0.0.1`; hosted connectors cannot reach it.
- **Codex TOML (Codex edition only):** copy the stdio configuration for Codex. The app does not edit
  Codex configuration automatically or include the HTTP bearer token in this snippet. The connection
  is still standard MCP, not a Codex-exclusive transport.

The command bridge does not launch Open Knowledge. Keep the app running and reconnect after membership or credential changes.

## Local Recall

`knowledge_recall` can search included native Markdown by keywords, meaning, or both:

- `hybrid` is the default and combines keyword ranking with local semantic similarity.
- `keyword` bypasses embeddings and is useful for exact identifiers and literal terms.
- `semantic` ranks by meaning only, including cross-language matches.

Open Knowledge bundles a q8 ONNX conversion of `paraphrase-multilingual-MiniLM-L12-v2`. It creates
384-dimensional embeddings on this device and does not call an embedding API. A bounded private
vector cache reuses unchanged passages; source text remains in the selected workspace. If the local
model is unavailable, fails, or times out, hybrid and semantic requests fall back to keyword results.
Check `retrieval.requested_mode`, `retrieval.used_mode`, `retrieval.complete`, and `retrieval.notice`
instead of assuming that semantic coverage was complete.

Recall results keep the source workspace reference, canonical path, stable ID, revision, source hash,
and original line or offset provenance. `max_bytes` bounds the returned UTF-8 JSON, not model tokens.
Also inspect `serialized_bytes`, `truncated`, `coverage.complete`, and excluded-document counts. A
missing result is not proof that a fact is absent, and semantic similarity is not factual confidence.

## Codex Session Memory (Codex Edition Only)

General omits the Codex history reader from its main bundle and rejects memory enable requests,
including when copied or edited settings claim memory is enabled. Install the Codex edition if you
want this optional integration; changing a packaged app's environment cannot switch editions.

In the Codex edition, session memory has a separate setting and is off by default. Enabling it never broadens normal
workspace access: for a selected `workspace_ref`, only local Codex sessions whose recorded working
directory is that workspace root or one of its descendants are eligible. The connection is read-only
and exposes only user and assistant message text. Tool calls, tool results, and hidden reasoning are
not exposed.

All clients authorized for the workspace can access enabled memory tools, not just Codex. History
reading and embeddings run locally, but the receiving client may forward returned excerpts to its
AI service. Only enable this for clients you trust.

The memory tools are:

- `knowledge_list_memory_sessions` lists eligible local sessions for a selected workspace.
- `knowledge_search_memory` searches byte-budgeted user/assistant history. Its default hybrid mode
  combines the same local semantic and keyword signals; keyword and semantic modes are explicit.
- `knowledge_get_memory_context` reads a bounded surrounding context and can reject a changed anchor
  using the result's `content_hash`.

Memory results preserve `session_id`, `turn_index`, role, timestamp when available, and the full
turn's `content_hash`. History reads and outputs are bounded. Inspect `coverage.complete` and
`coverage.warnings`, plus list/search truncation and context `window_complete`/`partial_text` fields.
Incomplete coverage means that older, oversized, missing, malformed, or unreadable history may not
have been searched or returned. Session memory uses a vector cache separate from workspace recall.
That cache is local and is cleared when session memory is disabled or the corresponding workspace
access is revoked.

To make these tools available to a client:

1. Enable MCP in Open Knowledge.
2. Include the workspace in MCP Settings.
3. Explicitly enable **Codex session memory**.
4. Refresh the client's MCP tool list or disconnect and reconnect it.

This integration is a clean-room design informed by general concepts demonstrated by
[Trellis](https://github.com/mindfold-ai/trellis). Open Knowledge does not bundle or copy Trellis
AGPL code.

## Workflow Prompts

The connection also provides bounded, evidence-first MCP prompt templates:

- `research_brief` takes `workspace_ref` and `question` to prepare a data-analysis brief with scope,
  evidence, uncertainties, and citations.
- `quant_research_review` takes `workspace_ref` and `hypothesis` to review quantitative research,
  including assumptions, data quality,
  leakage, costs, validation, and limitations. It does not place trades or perform live execution.
- `consulting_handoff` takes `workspace_ref` and `engagement` to create a consulting handoff with
  findings, decisions, open questions, cited evidence, and next steps.

Prompts do not grant additional access. They can use only the workspaces and optional session memory
already authorized for that connection.

## Protocol Scope

- `knowledge_list_workspaces` returns an opaque `workspace_ref`, label, and `editable` permission. Other tools use the reference for bundle information, listings, search, and document reads.
- `knowledge_search` searches native Markdown with bounded previews, regex or literal matching, case controls, directory scope, and exclusion globs. It does not index projects or search converted and unsupported files. `.git`, `.open-knowledge`, and `node_modules` are always excluded.
- `knowledge_recall` returns budgeted, provenance-preserving Markdown excerpts. Its default hybrid
  mode uses bundled offline embeddings plus keyword ranking; explicit keyword and semantic modes are
  also available.
- Listings report `document_access` as `writable`, `readonly`, or `not_supported`. Local Markdown is returned as source Markdown; supported non-Markdown files are converted to read-only Markdown; unsupported files expose metadata only.
- `knowledge_get_document` returns Markdown and source-file metadata. `representation` identifies `source_markdown` or `converted_markdown`; `markdown_byte_length` describes the returned Markdown, while `byte_length` and `content_hash` describe the source bytes.
- `knowledge_create_directory` and `knowledge_create_document` require an editable workspace, an existing immediate parent, and an unused canonical bundle path. They do not create ancestors or replace entries.
- `knowledge_patch_document` applies ordered exact-text replacements to writable `.md` files. The source revision and content hash are conflict preconditions, and each `old_text` must match exactly once. Use `knowledge_update_document` for full Markdown replacement. Converted Markdown cannot be modified.

MCP does not expose internal workspace IDs, absolute filesystem roots, protected metadata and dependency directories, source binary bytes, deletion, file pickers, or shell operations.

## Credential Safety

- Reveal connection details only for a trusted local client.
- Treat HTTP bearer tokens and runtime connection files as secrets.
- Do not place connection details in source control, screenshots, issue reports, or shared logs.
- Use **Regenerate credential** if a credential may have been exposed; all shared-connection sessions close immediately.

The gateway is loopback-only, rejects browser-origin requests, authenticates requests, and bounds request and session sizes. Secrets use owner-only application-data files.

## Verification for local builds

Financial recall supports explicit metadata filters before embeddings, JSON table rows, and
`canonical_only` conflict/coverage guards. See [retrieval quality](retrieval-quality.md) for schema
examples, evaluation scope and remaining work.

`bun run test:semantic` builds and checks multilingual retrieval with network calls blocked, then
exercises the production process queue, active-inference cancellation, cache clearing and restart.
Native inference runs in an isolated Electron utility process (a child process in Node tests), so
cancelling an ONNX request cannot crash the main application through a native worker callback.
`bun run test:semantic:electron` tests the real Electron main/utility-process path with temporary
settings and synthetic inputs, without loading user workspaces or Codex history. After packaging,
pass the `app.asar/dist-electron/semantic-runtime.mjs` path as its argument and set
`OPEN_KNOWLEDGE_SEMANTIC_EXPECT_ASAR=1` to verify the packaged code and unpacked native binding.

## Troubleshooting

- **The command cannot start:** Start Open Knowledge and confirm at least one workspace is included and Listening.
- **HTTP cannot connect:** Confirm the client runs on this device and sends the current bearer `Authorization` header.
- **A connection stopped after membership changed:** Reconnect the client. The credential stays the
  same unless it was explicitly regenerated; if regenerated, copy the new HTTP token.
- **A workspace is missing:** Open that workspace once, include it in the dedicated MCP window, then reconnect the client.
- **Memory tools are missing:** They are intentionally unavailable in General. In the Codex edition,
  confirm MCP is enabled, include the workspace, explicitly enable Codex session memory, then refresh
  or reconnect the client.
- **Settings or workspaces are missing after installing an edition:** Edition data is intentionally
  independent. Open the workspace again and grant access explicitly; do not copy old credentials.

The gateway implements MCP `2025-11-25` Streamable HTTP.

- [MCP versioning](https://modelcontextprotocol.io/docs/learn/versioning)
- [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP TypeScript SDK schema libraries](https://ts.sdk.modelcontextprotocol.io/v2/advanced/schema-libraries.html)
- [MCP security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
