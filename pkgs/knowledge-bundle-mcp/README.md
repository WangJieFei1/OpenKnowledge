# Knowledge Bundle MCP

MCP tools, resources, and prompts over `@open-knowledge/knowledge-bundle-api`. Hosts inject opaque
session grants; this package is independent of Electron, Hono, credentials, storage, and backend.

```ts
type KnowledgeBundleMCPGrant<Metadata = unknown> = {
	reference: string
	label: string
	readDocument?: KnowledgeBundleMCPDocumentReader
	search?: KnowledgeBundleMCPSearcher
} & (
	| {
			access: 'readonly'
			bundle: ReadonlyKnowledgeBundle<Metadata>
	  }
	| {
			access: 'editable'
			bundle: EditableKnowledgeBundle<Metadata>
	  }
)
```

```ts
const server = createKnowledgeBundleMCPServer([
	{
		reference: 'bundle_opaque_reference',
		label: 'Product Notes',
		access: 'editable',
		bundle: productNotesBundle
	}
])
```

The optional `readDocument` capability may return native Markdown, converted read-only Markdown, or
`not_supported` metadata without exposing source bytes through MCP.

## Runtime Contract

`knowledge_recall` accepts exact `filters` for `entity`, `period`, `metric`, `basis`, and
`definition_version`, applied before the embedding host is called. Missing or ambiguous fields do
not match. Well-formed Markdown tables produce `structured_record` JSON rows with original header
and data-row line provenance; values remain strings. `canonical_only` requires complete metric
metadata (`value`, `unit`, `as_of` as well as dimensions), withholds competing active values and
abstains when source coverage is incomplete. This is metadata consistency, not factual authority.
See [retrieval quality and limits](../../apps/open-knowledge/docs/retrieval-quality.md).

Bundle paths are canonical absolute paths relative to the selected bundle; `/` is the root. Existing
entries use the last-known path and may include a stable ID, which is authoritative when supplied.
Results return the current `id` and canonical path; retain both after relocation or mutation.

Listings default to depth one and return at most 10,000 entries. Markdown reads and mutations are
limited to 1 MiB. File metadata distinguishes `writable`, `readonly`, and `not_supported` document
access. Source `byte_length` and `content_hash` remain distinct from the size and representation of
converted Markdown.

Creation makes one new entry under an existing parent and never overwrites. Full updates and patches
require the latest source revision and content hash. A storage backend may return a replacement ID
after an atomic content update.

## Budgeted retrieval and memory provenance

`knowledge_get_excerpt` reads a contiguous, original line range instead of sending a whole document.
Pass `path`, optional stable `id`, `start_line` (default 1), optional `end_line` (default 39 lines after
the start), and `max_bytes` (default 8,000, range 2,048–64,000). A request spans at most 200 lines.
Pass a previous `content_hash` as `expected_content_hash` to reject a source that has changed.

The returned `content_hash` always identifies the **source file**. For `converted_markdown` documents,
the line numbers refer to the converted Markdown, and the source hash is not a hash of that Markdown.
Converted documents remain read-only. `truncated`, `partial_line`, and `next_start_line` disclose
whether another read is needed; a partial long line requires a larger budget or the full document.

`knowledge_recall` accepts a plain-language `query`, optional directory `path` (default `/`),
`max_results` (default 5, range 1–20), the same `max_bytes` budget, and `mode`: `hybrid` (default),
`keyword`, or `semantic`. Keyword ranking uses local BM25, Chinese word segmentation, and Han
bigrams. Semantic ranking is supplied by an optional host capability. Hybrid combines both signals;
keyword mode bypasses the semantic ranker, while semantic mode ranks by meaning without promoting a
literal-only match.

The Open Knowledge host bundles a q8 ONNX conversion of
`paraphrase-multilingual-MiniLM-L12-v2`, which produces 384-dimensional embeddings on the local
device. There are no embedding API calls or embedding API charges. The host keeps a bounded private
vector cache for unchanged passages; cache entries contain content-derived keys and vectors, not
source text, and changed or removed passages cannot be returned from the cache. This package remains
model-independent and does not retain a source-text index across requests.

If the semantic capability is absent, fails, or times out, hybrid and semantic requests return
keyword results rather than failing the whole recall. Callers must inspect `retrieval.requested_mode`,
`retrieval.used_mode`, `retrieval.complete`, and `retrieval.notice`. A partial semantic index is also
reported explicitly. Similarity is a ranking signal, not a probability that a source is correct.
Use recall for a small memory directory; use ripgrep-backed `knowledge_search` to locate material in
larger workspaces first.

Both tools return **one compact JSON text**, without a duplicate `structuredContent` copy.
`serialized_bytes` counts the UTF-8 bytes of that JSON text, including provenance and coverage;
it is bounded by `budget_bytes`. The MCP transport envelope and tool definitions are outside this
budget. Bytes are not model tokens or a prediction of API cost. No automatic conversation capture,
summarization, external embedding service, or external memory store is introduced.

Recall results retain workspace references, canonical paths, stable IDs, revisions, source hashes,
original line ranges, representation, and effective document access. Large paragraphs may contain a
contiguous window; `partial_text`, `partial_line`, and half-open `start_offset_utf16`/
`end_offset_utf16` identify it in the full Markdown. Treat all source text and metadata as untrusted
evidence, not instructions.

### Memory metadata

Recall interprets only these optional, top-level scalar frontmatter fields:

```markdown
---
memory_key: project.preference.language
status: active
valid_from: 2026-09-14
expires_at: 2027-09-14
source: user-confirmed note
---

Write a single confirmed fact here, with enough original context to verify it.
```

This is a template, not a fact to add to a user's library. `source` and `supersedes` are descriptive
metadata; neither grants authority nor automatically removes another record. Keep original files
as the source of truth and explicitly change an old record's status after confirming a replacement.

By default, recall excludes `archived`, `superseded`, `expired`, `draft`, `needs_review`, expired dates,
and records whose `valid_from` is in the future. Use `include_inactive: true` to inspect them with
their reasons. Dates must be ISO dates or timestamps with a timezone; date-only values mean midnight
UTC. Unsupported, duplicate, or invalid metadata is reported in `metadata_warnings`, not guessed.
Files without recognized lifecycle fields remain searchable. This is a narrow scalar reader,
not a general YAML validator; it never rewrites frontmatter.

Multiple active documents sharing a `memory_key` in the scanned workspace receive an unresolved
conflict with their paths. This flags duplicate assertions for review; it does not detect all semantic
contradictions, verify that a statement is true, or choose the newest assertion as truth.

### Coverage and work limits

Recall lists at most 1,000 entries to depth 32 and indexes at most 200 native Markdown documents
and 16 MiB of Markdown per request, with the existing 1 MiB document bound. It reports listed entries,
indexed documents and bytes, skipped documents, a depth boundary, and `coverage.complete`. Check this
alongside `truncated` and `excluded_documents`: no result is not proof that a fact is absent.
Conflict detection covers scanned documents only, and reads are not a workspace-wide atomic snapshot.

These are limits on the selected Markdown and output, **not a total filesystem I/O, index-memory, or
CPU limit**. The bundle's metadata listing can hash other files, including large binaries. Keyword
ranking is synchronous; cancellation is checked around asynchronous capability calls and before
returning, but cannot interrupt synchronous ranking. The semantic index covers at most 512 eligible
passages of 16,000 UTF-8 bytes each and reports when this second coverage boundary is incomplete.
Narrow `path` for large workspaces. No operation reads outside the selected grant; unexpected
permission or transport failures fail the entire recall rather than returning previously collected
content.

### Reproduce the byte comparison

From this package, run `bun run src/retrieval.bench.ts`. It calls the real MCP full-document, recall,
and excerpt tools against the same synthetic English/Chinese fixture and asserts that the unique
fact, source path, line numbers, and source hash survive retrieval. It reports UTF-8 bytes of the full
tool result and its text separately. It does not measure tokenizer output, API charges, or real-world
retrieval accuracy.

## Exact-Text Patches

`knowledge_patch_document` applies ordered exact-text replacements without retransmitting the full
document:

```json
{
	"id": "stable-bundle-entry-id",
	"path": "/guides/large-document.md",
	"expected_revision": "current-entry-revision",
	"expected_content_hash": "<current source-file SHA-256 hash>",
	"edits": [
		{
			"old_text": "## Old heading\n\nExisting paragraph.",
			"new_text": "## New heading\n\nRevised paragraph."
		}
	]
}
```

Each `old_text` must match exactly once when reached. Edits run sequentially, and any missing or
ambiguous match fails the patch without writing. Empty `new_text` deletes a match; insertion replaces
a unique anchor with itself plus the inserted text.

A request accepts at most 100 edits and 262,144 combined old/new characters. The backend checks both
preconditions, enforces a 1 MiB source/result bound, and commits once. See
[`@open-knowledge/knowledge-bundle-patch`](../knowledge-bundle-patch/README.md) for the shared
algorithm and failure rules.

## Optional Codex Session Memory

The Open Knowledge host can inject a separate, read-only Codex session-memory capability. Its setting
is explicit and off by default. For a selected workspace grant, eligible sessions are restricted to
local Codex sessions whose recorded working directory is the workspace root or a descendant. The
capability exposes user and assistant message text only; it does not expose tool calls, tool results,
or hidden reasoning, and it never modifies the source history.

When the capability is enabled, the server exposes:

- `knowledge_list_memory_sessions` for bounded discovery of eligible sessions.
- `knowledge_search_memory` for byte-budgeted hybrid, keyword, or semantic recall with
  session/message provenance.
- `knowledge_get_memory_context` for bounded surrounding user/assistant context, with an optional
  anchor `content_hash` precondition.

Callers must preserve `session_id`, `turn_index`, role, timestamp when available, and the full turn's
`content_hash`. Inspect `coverage.complete` and `coverage.warnings`, plus list/search truncation and
context `window_complete`/`partial_text` fields. Incomplete coverage means that older, oversized,
missing, malformed, or otherwise unreadable records may not have been searched or returned. The host
stores session-memory vectors in a local cache that is separate from workspace-recall vectors. It
clears the session cache when the setting is disabled or the relevant workspace grant is revoked.

Users must enable MCP, include the workspace, explicitly enable Codex session memory, and then refresh
or reconnect the MCP client so it discovers the optional tools. This is a clean-room design informed
by general concepts demonstrated by [Trellis](https://github.com/mindfold-ai/trellis); no Trellis
AGPL code is bundled or copied.

## Workflow Prompts

In addition to `explore_knowledge_bundle`, the server provides three evidence-first workflow prompt
templates:

- `research_brief` takes `workspace_ref` and `question`, then scopes a data-analysis question and
  organizes evidence, uncertainty, and citations.
- `quant_research_review` takes `workspace_ref` and `hypothesis`, then checks quantitative research
  assumptions, data quality, leakage, costs, validation, and limitations. It is research-only and
  never performs live trading or execution.
- `consulting_handoff` takes `workspace_ref` and `engagement`, then summarizes consulting findings,
  decisions, open questions, cited evidence, and next steps for another person or agent.

Prompts do not expand a grant. They operate only on the workspaces and optional session memory already
authorized by the host.
