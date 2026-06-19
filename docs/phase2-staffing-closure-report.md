# Phase 2 — Staffing Publication & Acknowledgment Closure Report

**Date:** 2026-06-19
**Branch:** `feature/work-spine-foundation-v1`
**Closing HEAD:** `74ec2a6` (`test: close phase 2 staffing verification`) — the Phase 2 closing commit; this hash was filled in by the immediately-following documentation commit.
**Scope:** Staffing capacity correctness, per-recipient publication delivery, decline notifications, acknowledgment reminders, Staff Assignment Board cleanup, and end-to-end verification. No Jobs, Directory, Schools, Monday migration, payroll, or notification-center redesign work was started.

---

## 1. Phase 2 commit ledger

Phase 2 builds on two preserved baseline commits and adds six closure commits.

| # | Commit | Subject |
|---|--------|---------|
| baseline | `eea5698` | feat: add canonical staffing capacity read model |
| baseline | `f46eb4b` | feat: add staffing capacity planning views |
| 1 | `1602deb` | fix: bound staffing capacity intervals to the selected window |
| 2 | `cd0c2bb` | feat: deliver staffing publication notifications per recipient |
| 3 | `35f5943` | feat: notify staffing managers of assignment declines |
| 4 | `62b3dca` | feat: add staffing acknowledgment reminder action |
| 5 | `3fda506` | fix: complete staffing control cleanup |
| 6 | `74ec2a6` | test: close phase 2 staffing verification |

Part 4 (scheduled exception-reconcile worker observation) was a **verification-only** step — it ran the real worker + scheduler and observed an end-to-end scheduled reconcile cycle. It produced no code commit by design.

---

## 2. Assignment lifecycle

`work_shift` + `shoot_staffing_requirement` remain the **single source of truth** for who is assigned. The Phase 2 tables (migration 156) are an additive ledger of *what was published, to whom, and each employee's confirmation state* — there is no parallel staffing store.

- **Assign / remove** — managers assign or remove staff against a shoot's requirement slots (existing `scheduleStaffing` service). This mutates `work_shift` only.
- **Publish** — `recordStaffingPlanPublication` snapshots the current assignment set into an immutable `staffing_plan_version` row (monotonic `version`, `plan_hash`, `plan_snapshot`) and writes/refreshes one `staffing_plan_recipient` row per assigned employee.
- **Acknowledge / decline** — employees act on their own current recipient row from My Work; managers never acknowledge on an employee's behalf.
- **Supersede** — re-publishing a materially-changed plan creates a new version, carries forward unchanged recipients (preserving their acknowledgment), and stamps `superseded_at` on the prior recipient rows that are replaced.

## 3. Publication & version behavior

- A published version is **immutable**. Editing assignments after publish produces *draft changes*; the lifecycle read model reports `republish_required` / `draft_comparison` rather than silently mutating the published snapshot.
- `plan_hash` carries a `hash_version`; `plan_snapshot` carries a `snapshot_schema_version`. Hash equality is only meaningful within a matching `hash_version`, so a future normalization or snapshot upgrade re-reads historical plans under their own rules instead of making them look "newly changed".
- **Re-publication carries forward unchanged recipients.** `recordStaffingPlanPublication` emits `staffing.plan.recipient_published` **only for newly-pending or materially-changed recipients** — a carried-forward recipient whose package is unchanged emits no event and keeps its prior acknowledgment. This emit-side precision is what makes the per-recipient notification consumer correct (Part 1).

## 4. Acknowledgment & decline behavior

- Each current recipient is `pending` → `acknowledged` | `declined` | `canceled`. Only the **current** (non-superseded) recipient row for the **latest** version is actionable.
- **Decline** sets `response_status = 'declined'` and emits `staffing.plan.recipient_declined` **only on a real status transition** (`status != 'declined'`), keyed on the recipient id with dedupe `staffing-response:${recipientId}:declined`. An `acknowledged → declined` flip is one transition and produces exactly one new event.
- Declined recipients are surfaced as **"Declined — Replacement Required"** in the manager lifecycle panel, with the decline reason when one was authorized. The system never claims to have removed the assignment — replacement is a manager decision.

## 5. Urgent-watch behavior

- A pending/at-risk acknowledgment state drives an `urgent_watch_item` upsert keyed on `(tenant, source_module, source_entity_type, source_entity_id, watch_type)`, so repeated sweeps are idempotent (no duplicate issues).
- The scheduled `exception-reconcile` worker (`exception-reconcile-repeat`, every 60 s) calls the internal reconcile-sweep endpoint, which re-syncs urgent-watch items per tenant. **Part 4** observed this end-to-end: a seeded source created an issue on a *scheduled* cycle (no manual endpoint call), a second cycle produced no duplicate issue or notification, resolving the source cleared the issue on the next scheduled cycle, and a second tenant's items were untouched (tenant isolation).

## 6. Capacity calculation contract (Part 0)

Capacity is computed in `America/Chicago`, Monday-anchored weeks, DST-correct.

- **Window clipping.** Every assignment interval is intersected with the requested operating window **before** any raw / unique / overlap / daily / weekly / monthly figure is computed. Canonical `starts_at` / `ends_at` are retained for display; an interval fully outside the window contributes **0**; a partially-overlapping interval contributes **only its intersecting portion**. `work_shift` is never mutated, truncated, canceled, or deleted.
- **Data quality.** Each assignment carries `timing_quality` (`valid | incomplete | suspicious`), `source_duration_minutes`, `clipped_duration_minutes`, and `timing_warning_reason`. The suspicious threshold is centralized and configurable via `CAPACITY_SUSPICIOUS_SHIFT_MINUTES` (default 24 h). Employee rows and the summary expose `suspicious_timing_count`.
- **Server-authoritative.** The React capacity view renders the API result and surfaces a suspicious badge; it does **not** independently clip or recompute durations.

## 7. Notification delivery design

Phase 2 replaced the legacy **aggregate** publication notification with **per-recipient** delivery, reusing the existing worker `notification.dispatch` pipeline rather than duplicating channel logic.

- **Mechanism (two-stage outbox).** Lifecycle/decline/reminder emit a domain `app_event`; the worker outbox processor consumes it, and the per-recipient handler emits a second deduped `notification.dispatch` `app_event`, which the same processor turns into an `ops_notification` + channel delivery. Typical end-to-end latency ≈ a few seconds.
- **Publication (Part 1).** `handleStaffingRecipientPublished` queues exactly one employee notification per newly-pending/materially-changed recipient, deep-linked to that employee's exact current My Work assignment (`#my-work?focus_shoot=<id>`), containing job/shoot name, date, role, and a request to review + acknowledge. It contains no internal notes and no other employees' details. Dedupe key: `staffing-recipient-publish:${shootId}:${version}:${employeeUserId}:${recipientHash}`.
- **Decline (Part 2).** `handleStaffingRecipientDeclined` queues one manager notification (smallest appropriate recipient set) with employee / shoot / date / role / reason (when authorized) / "replacement required" and a deep link to the staffing drawer (`#operations/staffing?...&shoot=<id>`). Dedupe key: `staffing-decline:${recipientId}:${manager}`. An ownership gap retains the urgent issue + logs rather than notifying everyone.
- **Honest delivery states.** In-app delivery is real (via realtime publish); push is real when FCM creds exist; SMS/email are stubs. UI copy says **"notification queued through the current staffing notification flow"** and reminder UI says **"Reminder queued"** — nothing is described as "delivered" unless the channel actually confirms it.

## 8. Reminder policy (Part 3)

- A manager-authorized **Resend Reminder** action targets the **current pending** recipient of the **latest** version. Server-side validation requires: matching tenant + shoot, current latest version, current (non-superseded) recipient, manager scope (`schedule.manage` / department authority), status `pending` (not acknowledged / declined / canceled / superseded), and the employee still in the plan.
- **Cooldown** is centralized + configurable: `STAFFING_REMINDER_COOLDOWN_MINUTES` (default 60 → one reminder per recipient per hour), serialized via `SELECT … FOR UPDATE OF r` and tracked with `last_reminder_at` / `reminder_count` (migration 157).
- A reminder is a **distinct event** (`staffing.plan.recipient_reminder`, dedupe `staffing-reminder:${recipientId}:${windowBucket}`) — it never re-publishes the plan. A second request inside the cooldown is an **honest no-op** that returns the existing `last`/`next` timing. The response reports `status` (queued / cooldown), `recipient_state`, `reminder_count`, `last_reminder_at`, `next_reminder_allowed_at`, `cooldown_minutes`. The manager UI shows the button only for a current pending recipient with manage permission, and displays last/next timing.

## 9. Final board behavior (Part 5)

Staff Assignment Board cleanup applied only the residual items shown in the recordings (no redesign): a single Leadership context with one "Back to Company Command", one "Close" per drawer, no duplicate navigation, no dead controls, a coverage summary at top, roles + slots with the lead listed separately, the published version visible, an acknowledgment summary with recipient labels, declines shown as "replacement required" (separate from override), overlap shown separately from override, a direct Capacity Planning link (`#operations/staffing/capacity?view=week`), a Publish/Republish control, and no unsupported delivery language. The board also opens the staffing drawer directly from a `?shoot=` deep link (the target of decline/publication notifications).

## 10. RBAC matrix

| Action | Route | Required | Verified |
|--------|-------|----------|----------|
| Read capacity | `GET /shoots/staffing/capacity` | `schedule.read` (route scope) | Manager 200; employee token **403** |
| Assign / remove / publish | existing `scheduleStaffing` routes | `schedule.manage` | manager-only |
| Resend reminder | `POST /shoots/:id/staffing/recipients/:recipientId/remind` | `schedule.manage` + department authority | Manager queues; employee token **403** |
| Acknowledge / decline own assignment | employee self-scoped routes | self (own current recipient) | employee-only, own row |
| Tenant isolation | all of the above | RLS on `staffing_plan_version` / `staffing_plan_recipient` (FORCE) | cross-tenant rows invisible |

## 11. Migrations

- **156 — `156_staffing_plan_versions_and_recipients.sql`** (baseline Slice 2): creates `staffing_plan_version` (immutable published-version ledger; `UNIQUE (tenant_id, shoot_id, version)`; composite `UNIQUE (id, tenant_id)` for tenant-consistent FK) and `staffing_plan_recipient` (per-recipient state; `response_status` check; carry-forward self-FK; `superseded_at`; current/pending partial indexes). RLS ENABLE + FORCE + tenant-isolation policy on both.
- **157 — `157_staffing_recipient_reminders.sql`** (Part 3): `ALTER TABLE staffing_plan_recipient ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz, ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;` — additive, idempotent, no backfill required.

Both migrations are forward-only and additive; no Phase 2 migration drops or rewrites existing columns.

## 12. Browser verification

Verified against the local stack (API on :4000, admin-web preview, Demo Studio tenant) during Parts 1–5:

- Employee My Work renders the published assignment, scrolls/highlights the focused shoot from a `#my-work?focus_shoot=<id>` deep link, and exposes Acknowledge / Decline on the employee's own current assignment.
- Manager Staff Assignment Board opens the staffing drawer directly from a `?shoot=` deep link, shows the lifecycle panel (coverage, version, ack summary, declined-replacement-required), exposes Resend Reminder for a current pending recipient, and links to Capacity Planning.
- The capacity view renders server-clipped durations and the suspicious-timing badge without client-side recomputation.

(CORS/port notes from the session: the API must run with `ADMIN_WEB_URL` matching the preview origin; `INTERNAL_SOCKET_SECRET` is required with no default.)

## 13. Worker verification (Part 4)

The real BullMQ worker + scheduler were started against Redis and observed executing the scheduled `exception-reconcile-repeat` job end-to-end (not merely the direct endpoint). Recorded: worker start, scheduler registration of the repeat job, scheduled execution with `failed_tenant_count = 0`, idempotent re-execution (no duplicate issue, no duplicate notification), scheduled resolution after the source was cleared, and second-tenant isolation. Because the upsert is idempotent (no `updated_at` bump) and the worker has no per-cycle log line, the **scheduled state transition** (issue resolving on a later cycle with no manual call) was used as proof of repeated scheduled execution.

## 14. Full test results

_Run on closing HEAD; one Postgres-backed file per process for the API suite._

- **admin-web** (`npm run test`, vitest jsdom, maxWorkers 1): **91 files / 479 tests passed**. The previously-flaky `organizationsPage.test.tsx` passed in this run.
- **worker** (`npm run test`, vitest threads): **69 tests passed** (includes the new publication / decline / reminder consumer suites in `appEventHandler.test.ts`). Worker source is unchanged since commit 4 (`62b3dca`).
- **API** (`node scripts/run-vitest-chunks.mjs`, one Postgres-backed process per file, 166 files): **165 of 166 files green; 1 file pre-existing-failing.** The new `tests/phase2StaffingClosure.test.ts` E2E passed (1/1). The chunk runner is **fail-fast** (it `process.exit`s on the first non-zero file), so the single canonical command halts at the alphabetically-ordered file 149/166, `tests/timeClockMileagePhase5.test.ts` (3 pre-existing failures — see below). Files 1–148 each passed in their own process before the halt; the 17 files alphabetically after it (150–166, including `urgentWatch.test.ts` and `urgentWatchSummary.test.ts`) were then run individually, one process each, and **all passed (exit 0)**. Net: every API test file passes except the 3 pre-existing `timeClockMileagePhase5` assertions.
- **Typechecks** (`tsc --noEmit`): **api / worker / admin-web / mobile all exit 0**.
- **Builds** (`npm run build`): **api (`tsc`) exit 0, worker (`tsc`) exit 0, admin-web (`tsc --noEmit && vite build`) exit 0** (the admin-web "chunks larger than 500 kB" note is a pre-existing bundle-size advisory, not a Phase 2 regression).
- **Lint** (`npm run lint`, root → `--workspaces --if-present`): exit 0 — no workspace defines a `lint` script, so there is no configured ESLint gate to violate.

### Pre-existing issues (reported separately, not introduced by Phase 2)

- **`packages/api/tests/timeClockMileagePhase5.test.ts` — 3 failing tests.** Confirmed pre-existing on baseline `f46eb4b` (reproduced by checking out the three time-clock source files at `f46eb4b`; failures are unrelated to staffing/capacity). They were masked at earlier gates because the chunk runner can report exit 0 while individual files fail. **Not addressed in Phase 2** — out of scope.
- **`organizationsPage.test.tsx` — non-deterministic flake.** Passes in isolation and passed in this closure run; unrelated to Phase 2 changes.

## 15. Remaining intentional limitations

1. **SMS / email channels are stubs.** Only in-app (and push with FCM creds) is real delivery. Copy is deliberately "queued", never "delivered", for stubbed channels.
2. **Two-stage outbox latency.** Per-recipient notifications appear a few seconds after the triggering action (domain event → worker → dispatch event → worker), by design — delivery is decoupled from the request.
3. **Decline reason visibility is authorization-gated.** When a reason is not authorized for the recipient set, the notification omits it rather than leaking it.
4. **Reminder cooldown is per-recipient, time-bucketed.** A second reminder inside the window is a no-op; there is no priority override to force an immediate re-send.
5. **The 3 pre-existing `timeClockMileagePhase5` failures remain** — explicitly out of Phase 2 scope.

## 16. Rollback & deployment considerations

- **Migrations are additive and forward-only.** 156 creates new tables (no impact on `work_shift`); 157 adds two nullable/defaulted columns. Rolling the application back to a pre-Phase-2 build leaves these objects in place harmlessly — no down-migration is required to restore prior behavior.
- **Config (new, all defaulted — safe to deploy without env changes):** `CAPACITY_SUSPICIOUS_SHIFT_MINUTES` (default 1440), `STAFFING_REMINDER_COOLDOWN_MINUTES` (default 60). `INTERNAL_SOCKET_SECRET` remains required (no default) and `ADMIN_WEB_URL` must match the web origin for CORS — both unchanged from before Phase 2.
- **Worker must be deployed with the API.** The new `app_event` types (`staffing.plan.recipient_published` / `_declined` / `_reminder`) are consumed by the updated worker; deploying the API without the matching worker would leave those events unprocessed in the outbox (they are retry-safe and would drain once the worker ships). The legacy aggregate publication notification was **removed**, so an API-ahead-of-worker window would mean publications are not notified until the worker catches up.
- **Idempotency is dedupe-key based**, so re-delivery, worker restarts, and retried outbox rows do not double-notify.
- **Reversibility:** all six closure commits are isolated and individually revertible; reverting commit 2 would restore per-recipient delivery removal but would also need the aggregate path restored if notifications are still desired.
