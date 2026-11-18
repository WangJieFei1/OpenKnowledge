# Weekly finding: checkout conversion

## Recorded result

| Week starting (UTC) | Paid sessions | Eligible checkout sessions | Conversion |
| --- | ---: | ---: | ---: |
| 2026-10-05 | 350 | 10,000 | 3.5% |
| 2026-10-12 | 420 | 10,000 | 4.2% |

Checkout conversion rose by **0.7 percentage points**, from 3.5% to 4.2%. Both weeks use [checkout conversion v1](metric.md) and the same [SQL](query.md) over the [synthetic frozen snapshot](dataset.md). This is an observational comparison, not evidence that a particular change caused the increase.

## Follow-up for the analysis

The denominator was the same, so the difference in the reported rate reflects the 70 additional paid sessions in this example. The cohort definitions are aligned, but aggregate counts alone cannot show which traffic mix changed, whether tracking lost events, or which checkout step accounts for the difference. Keep the operational and causal questions separate in the handoff.

A next pass could compare checkout-start volume and conversion by a segment known at the start of the session, such as platform, using the same frozen input and metric version. Before interpreting a shift, inspect whether the missing-flag rate changed and whether the payment-event ingestion check found a backlog. Segment totals should reconcile to the overall eligible cohort, with unknown segment values shown explicitly.

If a product team wants to estimate the effect of a rollout, get the rollout assignments and exposure timing in a separate source. Check those against an appropriate experimental or controlled comparison. This note establishes a baseline and documents how to get back to the number; it does not recommend action based on the headline alone.

## Handoff

Keep this finding with the source pointers. If a later backfill changes the counts, create a dated follow-up that names the replacement snapshot and metric version. Do not alter the original finding without recording why. In a presentation, cite this note alongside the metric definition so that someone can tell exactly which eligible population the chart represents.
