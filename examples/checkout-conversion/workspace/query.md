# SQL: weekly checkout conversion

This DuckDB query uses [checkout event notes](dataset.md) and implements [checkout conversion v1](metric.md). The result is recorded in the [weekly finding](conclusion.md). Run it against the frozen input snapshot, not a live export that may still be collecting payment events.

## Query

```sql
SET TimeZone = 'UTC';
WITH starts AS (
    SELECT session_id, MIN(event_at) AS started_at
    FROM checkout_events
    WHERE event_name = 'checkout_started'
      AND session_id IS NOT NULL AND session_id <> ''
      AND is_internal IS FALSE AND is_test IS FALSE
    GROUP BY session_id
),
cohorts AS (
    SELECT session_id, started_at
    FROM starts
    WHERE started_at >= TIMESTAMPTZ '2026-10-05 00:00:00+00'
      AND started_at <  TIMESTAMPTZ '2026-10-19 00:00:00+00'
),
outcomes AS (
    SELECT c.started_at, EXISTS (
        SELECT 1
        FROM checkout_events p
        WHERE p.session_id = c.session_id
          AND p.event_name = 'payment_succeeded'
          AND p.is_internal IS FALSE AND p.is_test IS FALSE
          AND p.event_at >= c.started_at
          AND p.event_at < c.started_at + INTERVAL '24 hours'
    ) AS paid
    FROM cohorts c
)
SELECT date_trunc('week', started_at) AS week_utc,
       COUNT(*) AS eligible_sessions,
       COUNT(*) FILTER (WHERE paid) AS paid_sessions,
       100.0 * COUNT(*) FILTER (WHERE paid) / COUNT(*) AS conversion_pct
FROM outcomes
GROUP BY 1
ORDER BY 1;
```

## Review before reuse

The earliest checkout start is calculated before the cohort filter. Moving the date filter into the first stage will recount sessions that originally started before the window. The correlated existence check deliberately returns one Boolean per eligible session, so duplicate success events do not inflate the paid count. Do not replace it with a direct event join and then count rows unless you establish session grain again.

Validate a few boundary cases when porting this query: a checkout just before midnight on Sunday stays in its original cohort; a success exactly 24 hours after a start falls outside the attribution window; an otherwise eligible session with no payment remains in the denominator. If a checkout timestamp is missing, that event cannot supply a valid start. A payment for a session with no eligible checkout start does not create a session.

Save both raw counts and the displayed rate in the weekly note. The ratio can be recomputed from counts without rerunning the warehouse query, and the counts make inverted numerator/denominator bugs easier to spot. On a larger event table, profile this separately with the warehouse's query plan rather than treating the example as an optimized production job.
