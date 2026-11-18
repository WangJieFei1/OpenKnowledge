# Metric definition: checkout conversion (v1)

## Canonical definition

Checkout conversion v1 = paid sessions divided by eligible checkout sessions. Count each session once, cohort it by its first eligible checkout start, and use Monday-to-Monday UTC weeks. Exclude internal/test traffic and unknown flags. An eligible session is paid only if it records a successful payment at or after the start and before start + 24 hours.
For a two-week report, express change in percentage points: current conversion percentage minus previous conversion percentage. See the [dataset contract](dataset.md), [SQL implementation](query.md), and [worked result](conclusion.md).

## Interpretation

This metric starts at checkout. It is not purchase conversion per site visitor, payment authorization rate, order completion per account, or the fraction of the day's payments attributed to that day. An unfinished checkout still belongs in the denominator. If a checkout has two payment attempts and both eventually succeed, it adds one paid session, not two. If a visitor starts two distinct sessions, each eligible session contributes separately.

Keep the numerator and denominator in any headline or handoff. An increase of 0.7 percentage points from 3.5% to 4.2% is not an increase of 0.7 percent relative. If a weekly cohort is empty, report no rate rather than inventing a zero or carrying forward the previous figure. Do not present a visually precise rate as evidence of an experiment when the source is an observational aggregate.

## Change control

Treat the attribution window, deduplication, cohort clock, and flags as part of the definition rather than presentation options. If the team approves a 48-hour payment window, save it under a new definition version; rerun both comparison weeks with that rule and label the results. Comparing one week under v1 with the other week under a revised version mixes populations. Likewise, avoid comparing rates produced from extracts with different known reporting gaps.

For segment breakdowns, reuse the eligible session grain. Add a segment only when its value is known before the outcome you are interpreting. A category first emitted at payment time will exist only for paid sessions and cannot define an unbiased checkout cohort without additional source data.
