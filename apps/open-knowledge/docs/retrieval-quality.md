# Retrieval quality for analysis and consulting

## Objective

Optimize source-grounded retrieval, not inference throughput. CPU-only laptops are a deployment
constraint; no fine-tuning is introduced. High candidate recall and low final-context contamination
are separate objectives. Recall@5 alone cannot detect a correct number returned beside four wrong
numbers: also measure false retrieval rate, unanswerable abstention and source coverage.

Irrelevant context can harm reasoning ([GSM-IC](https://arxiv.org/abs/2302.00093)), and evidence placement
can matter ([Lost in the Middle](https://arxiv.org/abs/2307.03172)). These results motivate conservative
context selection, not a universal precision-over-recall rule for every task or newer model.

## Implemented in 0.0.2

- Local multilingual embedding + keyword hybrid retrieval with source hashes and exact line ranges.
- Explicit `filters`: `entity`, `period`, `metric`, `basis`, `definition_version`. Fields come from
  scalar frontmatter or well-formed table rows. Missing, ambiguous or mismatched fields are rejected
  **before embedding**. Matching trims whitespace and folds case/Unicode; it never guesses FY24 =
  calendar 2024 or GAAP = adjusted. These filters do not remove the source-scan limits below.
- Table hits carry `structured_record.fields` as JSON string values, `header_line`, and exact original
  data-row text/line/hash. No whole-table flattening, numeric coercion or unit conversion. Row fields
  override document scope for comparative tables. Malformed tables fall back to source text; wide
  year-as-column tables are not automatically pivoted or assigned an inferred period.
- Closed fenced SQL/schema blocks stay together when they fit. Nothing executes SQL.
- `canonical_only=true` requires all five dimensions plus `value`, `unit` and valid `as_of` metadata.
  Identical declared values for the same dimensions/unit are deduplicated within the scanned
  workspace; competing active values are withheld, not resolved by recency. Incomplete metadata is
  withheld. Units are case-sensitive and values remain strings. The MCP tool withholds canonical
  results when source coverage is incomplete. This checks consistency, **not factual truth or external
  authority**. Check the canonical counters, coverage and underlying source evidence.
- When all five dimensions are explicitly filtered and `canonical_only` is enabled, retrieval uses
  exact metadata lookup (`retrieval.used_mode: metadata`, `match_basis: metadata`). Similarity is not
  allowed to veto a fully identified, consistent record. Natural-language research still uses hybrid.
- `status: superseded` stays excluded by default. Source files are never automatically rewritten to
  mark a value superseded. Historical review is explicit and cannot be combined with `canonical_only`.
- Serialized JSON has a hard `max_bytes` limit, including provenance and metadata. Structured rows
  remain atomic under the budget: oversized rows are omitted, not partially relabeled.
- Research prompts put verified key figures with entity/period/basis/unit near the beginning of the
  answer. Source quotations are never reordered or rewritten.

Example long-form metric table:

```markdown
| entity | period | metric  | basis | definition_version | value | unit        | as_of      | status     |
| ------ | ------ | ------- | ----- | ------------------ | ----- | ----------- | ---------- | ---------- |
| ACME   | FY24   | revenue | GAAP  | v2                 | 125   | USD million | 2025-05-01 | active     |
| ACME   | FY24   | revenue | GAAP  | v2                 | 120   | USD million | 2025-03-01 | superseded |
```

Example `knowledge_recall` arguments (add `workspace_ref` when needed):

```json
{
	"query": "What revenue was reported?",
	"filters": {
		"entity": "ACME",
		"period": "FY24",
		"metric": "revenue",
		"basis": "GAAP",
		"definition_version": "v2"
	},
	"canonical_only": true,
	"max_results": 5,
	"max_bytes": 4000
}
```

## Verification and remaining work

`financial-retrieval.test.ts` includes wrong entities, fiscal periods, accounting bases, definition
versions, metrics, superseded records, missing/duplicate fields, conflicts and an unanswerable slice.
These deterministic guardrail tests are not a claim of production model quality. `bun run test:semantic`
also runs a small synthetic Chinese/English financial integration set using the real offline model,
reporting Recall@5, false retrieval rate and abstention.

The integration report distinguishes the embedding baseline from exact metadata lookup. A small
synthetic set is a regression check, not sufficient evidence to tune thresholds or advertise a
general business-domain recall score. Keep held-out company data separate from development fixtures.

Not yet implemented:

1. A learned cross-encoder reranker. The hybrid scorer is not one. Evaluate a CPU-capable multilingual
   reranker on a held-out business corpus before bundling it; compare recall, false retrieval,
   abstention and resource cost. Rerank a bounded shortlist, never bypass metadata filters or restore
   superseded records. See [Sentence Transformers](https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html).
2. Tokenizer-specific `budget_tokens`. Bytes are not model tokens, and MCP clients use different models.
   Clients must cap the entire injected context with their actual tokenizer, including envelopes and
   other context. An estimate must not be advertised as an exact universal cap.
3. A persistent full-corpus index for tens of thousands of records. Current per-call coverage is
   200 documents / 16 MiB / 1,000 entries; semantic scoring is bounded at 512 passages. Narrow `path`
   and check coverage. The next stage needs incremental hashes, schema-aware chunks, authorization
   generations and deletion/revocation invalidation before a large-corpus recall claim is justified.
