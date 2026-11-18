# Dataset notes: checkout events

This is a synthetic analytics workspace. The counts in the companion notes are illustrative, not customer or production data.

## Dataset contract

Use the `checkout_events` snapshot through 2026-10-20 00:00 UTC. The event table has `session_id`, `event_name`, `event_at` (TIMESTAMPTZ), `is_internal`, and `is_test`. A session can emit several `checkout_started` or `payment_succeeded` events. The traffic flags are session-level values stamped on every event; exclude internal/test traffic and sessions with unknown flags.
The analysis cohort is based on the first eligible checkout start. Compare weeks beginning 2026-10-05 and 2026-10-12 in UTC. See the [metric definition](metric.md), [SQL](query.md), and [weekly finding](conclusion.md).

## Grain and ingestion

A row is an event, not a session, an order, or a user. A reload can emit a second checkout start; a retry can emit a second success notification. Payment providers can deliver an older notification after a newer one. Do not filter a session on whether its first physical row in the extract happens to be a checkout start. Order events by their business timestamp and count paid sessions, not success notifications.

The event timestamp records when the event happened, not when the warehouse received it. The snapshot watermark is the latest event time through which the export is complete, not the time a report was downloaded. Replay the previous comparison against the same frozen snapshot if you need byte-for-byte reproducibility. Changing which snapshot you use may legitimately change a result if a backfill is made.

## Extraction checks

- Check that session IDs are non-empty and stable across the checkout and payment producers. Do not join a payment by user ID, email, or order number. A single user can open several sessions, and retries are expected.
- Monitor the share of events with unknown traffic flags separately; those sessions are out of this cohort rather than counted as public traffic. If a check finds conflicting flag values within a session, stop and reconcile the source labels.
- Report the timestamp zone when exporting a sample. A wall-clock value without the zone cannot establish the UTC week of a session near midnight.
- For a preview, inspect both checkout and payment events around the weekly boundary. A Sunday checkout can have a Monday payment without becoming a Monday checkout.

## Scope for later work

The table does not describe impressions before checkout, changes to basket value, refunds, or user retention. It cannot establish whether the same people visited both weeks. For a separate refund analysis, tie settlements to orders and document that grain in a different dataset note. For a funnel analysis outside checkout, start from the appropriate event population rather than changing this report's denominator silently.
