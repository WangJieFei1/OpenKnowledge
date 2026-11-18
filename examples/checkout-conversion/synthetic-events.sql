-- Synthetic checkout session events. Run in a fresh DuckDB session.
-- The duplicate and boundary events exercise the cohort rules without changing the expected counts.
SET TimeZone = 'UTC';

CREATE TEMP TABLE checkout_events (
  session_id VARCHAR,
  event_name VARCHAR,
  event_at TIMESTAMPTZ,
  is_internal BOOLEAN,
  is_test BOOLEAN
);

CREATE TEMP VIEW fixture_sessions AS
SELECT
  cohort || '-' || i AS session_id,
  week_start + CASE WHEN i = 1 THEN INTERVAL '0 hours'
                    WHEN i = 2 THEN INTERVAL '6 days 23 hours 30 minutes'
                    ELSE INTERVAL '1 hour' END AS started_at,
  i,
  paid_count
FROM (VALUES
  ('previous', TIMESTAMPTZ '2026-10-05 00:00:00+00', 350),
  ('current', TIMESTAMPTZ '2026-10-12 00:00:00+00', 420)
) AS cohorts(cohort, week_start, paid_count)
CROSS JOIN range(1, 10001) AS ordinal(i);

INSERT INTO checkout_events
SELECT session_id, 'checkout_started', started_at, FALSE, FALSE FROM fixture_sessions
UNION ALL
SELECT session_id, 'payment_succeeded', started_at + INTERVAL '1 hour', FALSE, FALSE
FROM fixture_sessions WHERE i <= paid_count
UNION ALL
SELECT session_id, 'checkout_started', started_at + INTERVAL '1 minute', FALSE, FALSE
FROM fixture_sessions WHERE i = 1
UNION ALL
SELECT session_id, 'payment_succeeded', started_at + INTERVAL '2 hours', FALSE, FALSE
FROM fixture_sessions WHERE i = 1
UNION ALL
SELECT session_id, 'payment_succeeded', started_at + INTERVAL '24 hours', FALSE, FALSE
FROM fixture_sessions WHERE i = 9999
UNION ALL
SELECT session_id, 'payment_succeeded', started_at - INTERVAL '1 second', FALSE, FALSE
FROM fixture_sessions WHERE i = 10000;

INSERT INTO checkout_events VALUES
  ('internal', 'checkout_started', TIMESTAMPTZ '2026-10-12 01:00:00+00', TRUE, FALSE),
  ('internal', 'payment_succeeded', TIMESTAMPTZ '2026-10-12 01:10:00+00', TRUE, FALSE),
  ('test', 'checkout_started', TIMESTAMPTZ '2026-10-12 01:00:00+00', FALSE, TRUE),
  ('test', 'payment_succeeded', TIMESTAMPTZ '2026-10-12 01:10:00+00', FALSE, TRUE),
  ('unknown', 'checkout_started', TIMESTAMPTZ '2026-10-12 01:00:00+00', NULL, FALSE),
  ('unknown', 'payment_succeeded', TIMESTAMPTZ '2026-10-12 01:10:00+00', NULL, FALSE),
  ('exclusive-window-end', 'checkout_started', TIMESTAMPTZ '2026-10-19 00:00:00+00', FALSE, FALSE),
  ('pre-window-retry', 'checkout_started', TIMESTAMPTZ '2026-10-04 23:59:00+00', FALSE, FALSE),
  ('pre-window-retry', 'checkout_started', TIMESTAMPTZ '2026-10-05 00:00:00+00', FALSE, FALSE),
  ('pre-window-retry', 'payment_succeeded', TIMESTAMPTZ '2026-10-05 00:10:00+00', FALSE, FALSE);

SET TimeZone = 'America/Los_Angeles';
