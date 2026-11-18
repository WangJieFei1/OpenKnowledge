# Checkout conversion: token-count example

Open the [workspace](workspace) in Open Knowledge to follow four linked Markdown notes from the [dataset contract](workspace/dataset.md), through the [metric](workspace/metric.md) and [SQL](workspace/query.md), to the [finding](workspace/conclusion.md). These files and counts are synthetic. The benchmark reads the notes; it does not run the SQL or submit model requests.

## Reproduce the count

From the repository root, install the workspace dependencies and use a Python environment with `tiktoken`:

```sh
bun install --frozen-lockfile
bench_venv="$(mktemp -d)"
python3 -m venv "$bench_venv"
"$bench_venv/bin/python" -m pip install tiktoken==0.12.0

bun pkgs/knowledge-bundle-mcp/scripts/checkout-token-benchmark.ts \
  | "$bench_venv/bin/python" examples/checkout-conversion/count_tokens.py
```

The first tokenizer run may download the public `o200k_base` vocabulary. The selected text is tokenized locally; no note content is sent to a remote service.

## What is counted

Each variant counts the same question once. The benchmark then adds one of the following:

- **Pasted:** the four complete Markdown files, with path labels.
- **Full MCP:** four real `knowledge_get_document` calls. This counts each tool name and argument object, the returned Markdown, and its structured metadata.
- **Bounded:** four real `knowledge_get_excerpt` calls, including each tool name and argument object and all of the compact JSON returned by the server. Each response retains the source path, line range and content hash. The script checks that the expected text is present verbatim and was not truncated.

The excerpt ranges are selected in advance. This measures the token cost of handing known evidence to a model, not the cost or quality of finding that evidence. The `evidenceOnlyNotes` run repeats the comparison with the same four files reduced to just their relevant passages, so the overhead of MCP is visible for short notes.

Counts sum `o200k_base` tokens across the supplied text parts. They do not include system messages, tool schemas, discovery calls, message framing, or the model's answer. Actual model usage depends on the tokenizer and how the client forwards tool metadata. The `max_bytes` parameter limits UTF-8 response bytes, not tokens.

## Measured results

| Notes supplied | Paste Markdown | Full-file MCP | Bounded excerpt MCP |
| --- | ---: | ---: | ---: |
| Four complete notes | 2,134 | 2,718 | 1,509 |
| The same notes trimmed to the required evidence | 795 | 1,365 | 1,501 |

With the complete notes, excerpts used **29.3% fewer tokens than pasting** and **44.5% fewer than full-file MCP**. With evidence-only notes, pasting was cheaper. Call arguments and source metadata cost tokens, so fetching excerpts is most useful when it lets you leave enough unrelated text behind.

## Reproduce the SQL result

With DuckDB installed, run this from the repository root. It creates a temporary table with synthetic events; no warehouse or customer data is needed.

```sh
example=examples/checkout-conversion
{
  cat "$example/synthetic-events.sql"
  awk '/^```sql$/{show=1;next} /^```$/{if(show)exit} show' "$example/workspace/query.md"
} | duckdb -batch -csv
```

```csv
week_utc,eligible_sessions,paid_sessions,conversion_pct
2026-10-05 00:00:00+00,10000,350,3.5
2026-10-12 00:00:00+00,10000,420,4.2
```
