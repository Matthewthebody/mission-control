# Background Jobs and Outbox

This document captures current background, scheduled, and future-ready job behavior. It is intentionally honest: not every planned automation is wired as a scheduler yet.

## Current Patterns

### App events

App events are used as internal operational signals. They should be idempotent where possible through dedupe keys and tenant scoping.

Expected use:

- workflow state events
- job closeout events
- client command center notes/readiness events
- alert and exception signals

### Outbox

Outbox-style delivery is used for future-ready integration delivery. A queued event is not the same as a delivered Teams or Outlook message.

Rules:

- Do not claim Teams/Outlook delivery is live unless the provider flag and credentials are configured.
- Failed dispatch should be visible and retryable.
- Deduplication keys should prevent repeated alerts for the same operational fact.

### Release/runtime smoke

`npm run verify:release:runtime` starts built API, worker, and admin-web preview processes and proves core runtime surfaces respond.

## Known Scheduled or Candidate Jobs

| Area | Status | Expected cadence | Notes |
| --- | --- | --- | --- |
| Job Closeout daily report | scaffolded/foundation | 6:00 a.m. America/Chicago when scheduler is wired | Snapshot tables exist; scheduler wiring should be verified before demo claims. |
| Job Closeout weekly report | scaffolded/foundation | Monday 6:00 a.m. America/Chicago when scheduler is wired | Same caveat as daily report. |
| Missing post-shoot evaluation reminders | partial/app-event ready | event-driven or scheduled candidate | Should avoid duplicate alerts. |
| Shoot check-in missed flags | foundation implemented | time-window driven | Should be idempotent and tenant-scoped. |
| Urgent watch reconciliation | implemented through service paths | request/reconcile driven today | Avoid unchanged-row churn. |
| App event/outbox dispatch | implemented as worker-facing foundation | worker loop / dispatch candidate | Provider delivery depends on flags and credentials. |
| Teams operational alerts | future-ready | outbox/provider dependent | Not live by default. |
| Outlook sync | feature-flagged integration | provider dependent | Not live by default. |

## Idempotency Expectations

- Scheduled jobs must tolerate reruns for the same tenant and time window.
- Delivery jobs must use dedupe keys or provider message ids when available.
- Report jobs must key snapshots by tenant, report type, and period.
- Reminder jobs should update existing open reminders instead of creating duplicates.

## Failure Visibility

Failures should include:

- tenant id
- job type
- correlation id or dedupe key
- retry count
- clear provider/status code where applicable

Failures must not log secrets, tokens, raw student PII, or full provider payloads unless redacted.

## Follow-Up

- Add a Platform Health view for DB, Redis, outbox lag, search index freshness, and scheduler status.
- Add operator docs for replaying failed outbox messages.
- Add report scheduler attestation once daily/weekly report scheduling is wired end to end.
