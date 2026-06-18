# Mission Control — Production-Readiness Gap Audit (Release Gate A/B + Forward-Readiness)

**Date:** 2026-06-18 · **Branch:** `feature/work-spine-foundation-v1` · **HEAD:** `1510c32` · working tree clean
**Stash (untouched):** `stash@{0}` — TEMP debug capture
**Method:** Six parallel read-only domain sweeps over `packages/admin-web/src`, `packages/api/src`, `packages/worker/src`, `db/migrations`, plus direct re-verification of load-bearing claims. No production code changed. Builds on `docs/mission-control-actionability-audit.md` (Phase 0).
**Checks run:** admin-web `tsc --noEmit` clean · api `tsc --noEmit` clean · admin-web lint clean · admin-web vitest **412/412** green (at HEAD `1510c32`). **API runtime tests NOT run** — they require Postgres on `:5432`, which is currently down locally (`ECONNREFUSED`); this audit is code-inspection based and several backed-up slices will need the DB to verify.

---

## 0. Two corrections to the Phase 0 audit (read first)

The completeness sweep found two major systems the original prompt (and the Phase 0 audit) assumed were missing. **Do not rebuild them.**

1. **A persisted operational-issue lifecycle already exists** — `urgent_watch_item` / "Exception Center" (`db/migrations/078_urgent_watch_phase1.sql`, `services/urgentWatch.ts`, routes `/api/exceptions` + `/api/watch`, surfaced on Home via `homeDashboard.ts`). Phase 0 called the Urgent Window "not built"; the **backend is real** (dedup, auto-resolve, reopen, audit events). The demo `NeedsAttentionItem` array (`home/needsAttention.ts`) is a *separate* Home surface. The real gaps are reconciliation cadence, missing lifecycle states, and store fragmentation — not a greenfield build.

2. **A Concierge read layer already exists** — `services/concierge/*` (`conciergeSearchService.ts`, `conciergeIntelligence.ts`, `conciergeQueryParser.ts`, `conciergePermissions.ts`), permission-aware + provenance-aware + **deterministic (no LLM)**, with intent cards mapping directly to "what's on fire / at risk / waiting on X / unacked staffing / prior location problems." Forward-readiness item 6 is largely **already satisfied** as a read spine; no autonomous AI mutations exist (confirmed: no AI library in `package.json`).

---

## 1. Blocking set — required before rollout

The items below are status **Required = Yes**. Grouped by the execution-order slice that closes them.

| # | Blocking gap | Evidence | Slice |
|---|---|---|---|
| B1 | **Urgent issue list is never reconciled on a schedule** → resolved/canceled/deleted-source issues linger; new ones missed. `syncUrgentWatchItems` auto-resolves + reopens, but only via `POST /reconcile`, which no worker job and no read path calls | `urgentWatch.ts:619-677`; `worker/src/queue/bullmq.ts:113-123`; `homeDashboard.ts:747`; `pages/OperationsWatch.tsx:35-56` | 1 |
| B2 | **Issue lifecycle is 4 states** (`active/snoozed/handled/resolved`); missing Assigned, In Progress, Waiting, Dismissed-false-positive, Superseded; no ack actor/time distinct from "handled"; no dismissal-reason field | `078_urgent_watch_phase1.sql:3-10`; `urgentWatch.ts:186-300` | 1 |
| B3 | **Four overlapping issue stores** with incompatible vocabularies and no shared contract (`urgent_watch_item`, `ops_notification`, legacy `alert`, `operational_event`); legacy `alert.created` emits push but never lands in the Notification Center | migrations 078/063/003/115; `worker/src/jobs/alertEvaluator.ts:104-113` | 1 |
| B4 | **No time-based escalation** (assignee→supervisor→leadership on elapsed unack time). Tiering is decided once at emit by shoot importance; `refreshNotificationLifecycle` (the only code that persists `escalated`/bumps level/writes audit) is **dead — never called** | `opsNotifications.ts:310-359` (read-time only), `:658-728` (dead) | 2 |
| B5 | **Outbox has no max-attempts / dead-letter** (poison event retries forever); per-channel send failures are logged but don't throw → never retried | `worker/src/outbox/processor.ts:41-54`; `worker/src/handlers/appEventHandler.ts:351-395` | 2 |
| B6 | **Staffing publish is not version-aware and has no acknowledgment.** Republish after an ack is a no-op if already "published"; there is no plan version and no per-recipient ack to invalidate. Prior art to extend: `shift_note_acknowledgement.note_snapshot_hash` (024) | `scheduleStaffing.ts:2556-2667`; `domain/staffing/staffing-publication-service.ts:108-126`; no ack columns on `work_shift` | 3 |
| B7 | **Stale-write (optimistic concurrency) implemented on only 1 of 4 mutation families.** Workflow steps do `last_seen_updated_at !== updated_at → 409`; staffing assign/reassign/remove, job draft/date, and org/contact edits are blind last-writer-wins | OCC: `workflowEngine.ts:2558-2560`; missing: `scheduleStaffing.ts:2035`, `jobService.ts` + `routes/jobs.ts:1081,1177`, `organizations.ts:1712,2243` | 3 |
| B8 | **`SharedJobDetailPage` has no in-flight guard** — Publish + ~40 inline actions double-submit, and the backend job mutations have no idempotency to catch it | `pages/SharedJobDetailPage.tsx:1239` | 3 |
| B9 | **Timezone is wrong for scheduled-hours and workday boundaries.** pg pool sets no session TZ, so `starts_at::date` buckets in UTC; `anchorDate`/`getWeekBounds` compute in server-local, not America/Chicago. A correct tz helper (`utils/localDate.ts`) and the Chicago constant (`config.ts:142`) exist but aren't wired in | `db/pool.ts:249-251`; `scheduling.ts:851,893,909,174-200`; `routes/schedule.ts:121,149,311` | 4 |
| B10 | **Workflow permission codes missing from `super_admin` tier** → owner passes workflow-admin only via the route's tier-bypass; any direct `hasOperationalPermission(auth,"workflow.template.manage")` 403s the owner (latent form of the original bug). **No test asserts owner is allowed** | `authority.ts:374-390` vs `permissionRegistry.ts:93-97`; `tests/workflowTemplateBuilder.test.ts:299-310` (denial only) | 5 |
| B11 | **Staffing drawer fails core dialog a11y**: no `role=dialog`/`aria-modal`/`aria-labelledby`, no focus trap, no Escape, no focus restore, labels not associated, validation only as a disabled button | `components/ShootStaffingCommand.tsx:209-222,283-291,440-476` | 6 |
| B12 | **Focus indicator stripped without replacement** on the changed Jobs/Production table rows | `workspace.css ~:2325-2521` (`:focus-visible{outline:none}`) | 6 |
| B13 | **No admin visibility into failed notifications, stuck outbox, or stale counts** — the exact failure modes this program targets. Failures are written to the DB but only surfaced as a personal inbox; `syncHealthService` never queries them | `opsNotifications.ts` (recipient-bound); `services/diagnostics/syncHealthService.ts:43-109` | 7 |
| B14 | **PII can reach logs** — pino redaction is headers-only; bodies + full error object unredacted; stubs echo email/phone into persisted event metadata (violates `docs/background-jobs.md:62`) | `app.ts:153-161`; `error.ts:13`; `worker/.../emailStub.ts:8,10` | 7 |
| B15 | **No kill switches for the new features** (no notification kill switch, no import pause, no staffing/jobs flag); outbox can't be paused. All documented rollback toggles are Microsoft-only | `worker/src/outbox/processor.ts`; `docs/release-pilot-checklist.md:82-95` | 8 |
| B16 | **Monday import side-effect leak (live).** Importing an overdue/blocked/critical school work item dispatches a real `schools.work_item_risk` notification through the outbox; imported jobs feed automation + SLA sweeps. No `suppressNotifications` path exists (the test only stays quiet by deleting `app_event` rows in teardown) | `schoolsHub.ts:953,1145` → `opsNotifications.ts:891-915`; mutation opts `schoolsHub.ts:55-57` | 9 |

**Strengths to preserve (do not "fix"):** migrations are exemplary for rollout safety — **zero** destructive ops across 153 files, all `NOT NULL` adds defaulted, transactional per-file runner (`scripts/migrate.ts`). Audit-history layer is rich and admin-exposed (`audit_events` + `GET /api/admin/system/audit` + `/trace`). Worker double-processing is genuinely safe (`FOR UPDATE SKIP LOCKED`). Idempotency upstream is strong (`app_event` partial-unique `dedupe_key`). Server-side RBAC is real and tier-driven; deep-links do **not** bypass it. `HelpTooltip.tsx` is fully WCAG-compliant (reference pattern). The N+1s the prompt feared (org detail, staffing dashboard) are actually clean (batched `=ANY()`); the real N+1 is `locations.ts:1336` (catalog read per calendar event).

---

## 2. Release Gate A — area status

### A1 — Operational issue lifecycle · **Partial**
`urgent_watch_item` (078) is the canonical store: dedup via `UNIQUE(tenant,source_module,source_entity_type,source_entity_id,watch_type)` + `ON CONFLICT DO NOTHING` (`urgentWatch.ts:395`); auto-resolve/reopen (`:619-677,542-551`); audit via `urgent_watch_event`. **Gaps:** no scheduled reconcile (B1) → staleness; 4 states only (B2); ack actor + dismissal-reason missing; 4 overlapping stores (B3). Tests: `urgentWatch.test.ts`, `urgentWatchSummary.test.ts` (no cross-store / reconcile-on-read coverage).

### A2 — Notification & escalation contract · **Partial**
Outbox → `ops_notification` → ack pipeline is real and idempotent; recipient resolution is DB-driven (`notification_routing_rule`); quiet hours + urgent bypass exist (`opsNotifications.ts:236-245`, server-local tz only). `operational_event` (115) adds a throttled 4th path. **Gaps:** no time-based escalation, escalation persistence is dead code (B4); no max-attempts/dead-letter, per-channel failures not retried (B5); reminders are implicit (time-bucketed dedupe keys) and inconsistent; email/SMS/push are **stubs** (mark unavailable before promising SLAs); no service test for escalation derivation.

### A3 — Concurrency / idempotency / stale-write · **Partial**
Every mutation is transaction-wrapped (`db/tx.ts withClientTransaction`); workflow-step transition is the **reference OCC** (`last_seen_updated_at→409` + dedupe key); FE double-submit guards exist on staffing/job-editor/workflow/org. **Gaps:** staffing publish not versioned + no ack/decline (B6, headline); OCC missing on staffing/jobs/orgs (B7); `SharedJobDetailPage` Publish unguarded (B8); delivery-layer dedup is convention-only (no unique index on `ops_notification` insert) — safe only while channels are stubbed.

### A4 — Scheduled-hours definition + timezone · **Partial / Defect**
One shared hours calc (`scheduling.ts:883-915`, SUM of `work_shift` wall-clock). **Gaps:** timezone wrong for `::date` buckets + week/anchor (B9); semantics under-specified — excludes `schedule_event` meetings/training/travel (loaded for availability, never summed), double-counts overlaps, can't drop declined (no decline state); same number drives the `>8h/>40h` overtime gate; no DST/boundary test over the scheduling SQL (only `localDate.test.ts` for the helper).

### A5 — Security / authorization · **Pass with 1 defect**
Server-side enforcement is real (`requireAction`→`canPerformAction`, `authz/policy.ts:91-96`); tier+job-function-profile model; dept scope enforced server-side; deep-links don't bypass; dev-login fail-closed in prod; role/action matrix at `docs/security-rbac.md`. **Gaps:** B10 (workflow codes missing from super_admin + no owner-allowed test); `POST /attendance/operations/:id/actions` is service-guarded but lacks a **route-level** guard (auditability + regression risk — add guard + employee→403 test); Teams deep-link passes a **token in the query string** then 302-redirects (`integrations.ts:1590`) → log/history/Referer leak.

### A6 — Accessibility (WCAG 2.2 AA) · **Partial**
Good: global focus-visible ring; HomePill always pairs color with a text label; `HelpTooltip` fully compliant. **Gaps:** staffing drawer dialog a11y cluster (B11); focus stripped on Jobs/Production table rows (B12); form errors not tied to fields (`ShootStaffingCommand`, `DirectoryActionForms`) via `aria-describedby`/`aria-invalid`; ARIA-grid-on-divs instead of native tables; required fields not visually marked.

### A7 — Performance / scale · **Partial**
Good: trigram search indexes (105); org-detail + staffing-dashboard are **not** N+1 (batched). **Gaps:** jobs (all dept indexes) load whole list + filter/sort/paginate client-side, ~16 cards recomputed in memory (`SharedJobsPage.tsx:620,645`); **no cursor pagination anywhere** (only hard caps: jobs 200, contacts/locations 120 → overflow invisible); no virtualization; no `AbortController` (a `cancelled` boolean guards setState only); real N+1 at `locations.ts:1336`; two unbounded history reads (`organizations.ts:4180`, `operationalNotes.ts:822`).

### A8 — Observability / diagnostics · **Partial**
Good: pino-http + `X-Request-Id` (`requestContext.ts`); rich audit tables + admin audit/trace routes. **Gaps:** no admin view of failed notifications/stuck outbox/stale counts (B13); PII reaches logs (B14); no worker health/heartbeat (no port, no run timestamp); no stale-derived-count detection (only profitability snapshots have `stale_marked_at`, and its scan handler is unimplemented); request-ID not propagated into `app_event`/worker; no metrics/Sentry/OTel.

### A9 — Safe rollout / rollback · **Partial**
Good: migrations exemplary (additive, defaulted, transactional, idempotent runner); release gate + pilot smoke + dirty-worktree fail-fast + Linux-CI-as-truth are real. **Gaps:** no kill switches for new features (B15); none of the Gate-A features have a feature flag / rollback toggle (all toggles are Microsoft-only); feature flags are env-only (client baked at build, no runtime/DB toggle, no endpoint exposing effective state); forward-only migrations (no DOWN scripts) — document the recovery procedure.

---

## 3. Release Gate B — Monday migration readiness · **Mostly Missing**

A real **single-record coexistence importer** exists (`schoolsHubMonday.ts`: `importMondaySchoolSnapshot/Job/WorkItem`, route `POST /api/schools-hub/monday/import`) with `external_object_map` provenance, `integration_sync_operation` audit, stable `source_reference = monday:item:<id>`, idempotent re-import, and source-ownership conflict guards. It is a **seed/on-ramp, not the bulk migration.** (`locationMonday.ts` is live eval sync, not a migration; `tools/migrate` is a stub.)

| Requirement | Status | Note |
|---|---|---|
| Side-effect suppression | **Missing — live leak (B16)** | Import dispatches real risk notifications; feeds automation + SLA sweeps. **Blocking before any import touches live data.** |
| Staging dry-run + create/update/skip/conflict counts | Missing | Commits straight to live tables; conflict throws 409, not tallied |
| Source board/item IDs preserved | Partial | Item+board+group preserved; **subitem + column IDs not modeled** |
| Attachments / comments / dependencies / mirror-formula / automation inventories | Missing | None enumerated |
| Field transformation ruleset | Partial | Manual per-record form mapping; no declarative ruleset |
| Golden-record review / batch checkpoints / reversible batch markers / delta import / reconciliation | Missing | Per-record audit exists; no batch unit, no delta cursor, no reconcile (generic replay **excludes** Monday — `integrationSync.ts:423`) |
| Cutover strategy (10 stages) | Mostly Missing | Only coexistence ownership/immutability modeled; no runbook doc |

Reusable foundation for the eventual build: `external_object_map` (003) + `integration_sync_operation` (019) + `integrationSync.ts` lifecycle + the source-ownership/immutability model. The Phase 0 framing ("Monday = inventory + dry-run pilot only, no production import") holds.

---

## 4. Forward-readiness — area status

| Area | Status | Key finding |
|---|---|---|
| 1. Generic org relationships | **Partial** | Architecture is generic (`parent_organization_id` self-FK, no school constraint; `client_organization_type` already has league/sports_association/company/nonprofit). Gap is **vocabulary**: missing `team`, `program`, `vendor`, `partner` enum values + first-class event-org. Plus Conflict A (adopt 144 layer — locked). |
| 2. School-year rollover | **Missing (greenfield)** | No rollover, no `(organization_id, school_year)` table, no per-field value-states (Unknown/Not-collected/N-A/Declined/Confirmed/Copied-awaiting-review), no field provenance/last-confirmed, no closed-year immutability. = Phase 0 Conflict B made concrete; net-new schema. |
| 3. Location intelligence | **Partial (strong core, 1 safety gap)** | Evals + dated authored observations + durable-vs-temporary (`operational_note_permanence`) exist and render on Job Detail; single incident needs ≥2 to form a pattern; freshness *labels* (`aging`>180d, `needs_refresh`>365d). **Gaps:** no per-note `review_by/expires_at` (stale incidents shown flagged, not auto-suppressed); no client-survey capture; upcoming-shoots-at-location not surfaced. |
| 4. Team Schedule | **Mostly complete** | 9/11 present (My/Team, 7-day weekends, multi-job days, week/day/month, Jump-to-Date, My/All toggle, all four filters, back/forward). Soft gaps: deep links land on workspace not the staffing-requirements view; **scheduled-hours not via the shared selector** (dual-count risk); filters not preserved on refresh. |
| 5. Success measures / UAT | **Missing (doc deliverable)** | No analytics SDK / `trackEvent`; raw ack/resolution timestamps exist so measures are computable but uncomputed; only high-level acceptance docs. Author a UAT + success-measures doc. |
| 6. Concierge / AI readiness | **Present (exceeds)** | Full deterministic, permission-aware, provenance-aware read spine (`services/concierge/*`) answering the brief's questions; **no AI mutation surface** (confirmed). Future Concierge = UI + narration over an existing safe read layer. "Waiting-on" + "what changed since last year" are approximated until staffing-ack (A3) and year-profile (area 2) land. |

---

## 5. Proposed bounded slice plan (refined from the execution order)

Each is a separate commit with its own tests + report. Slices 1–5, 7(part), 8, 9 are backend and need Postgres up to verify; **slice 6 is frontend and fully verifiable now while the DB is down.**

1. **Issue lifecycle + stale/dedup** — schedule reconciliation (worker job + reconcile-on-read guard); extend states (assigned/in_progress/waiting/dismissed-false-positive/superseded) + ack actor + dismissal reason; bridge/own the overlapping stores (start: route `alert.created` into the canonical store; document ownership). *(B1–B3)*
2. **Notification & escalation reliability** — time-based escalation on `due_at` breach (assignee→supervisor→leadership); call/own `refreshNotificationLifecycle`; outbox max-attempts→dead-letter + per-channel retry decision; mark stub channels unavailable. *(B4–B5)*
3. **Mutation idempotency / concurrency / versioned staffing publish** — staffing plan version + per-recipient ack keyed to version (extend `shift_note_acknowledgement` pattern); OCC (`expected_updated_at`→409) on staffing assign + job draft/date; `SharedJobDetailPage` in-flight guard; delivery-layer dedup index. *(B6–B8)*
4. **Scheduled-hours + timezone** — thread `America/Chicago` (pool session TZ + `getLocalDateString`/`getWeekBounds`/dashboard window); define hours include/exclude (meetings/training/travel/overlap/declined); DST + boundary tests. *(B9)*
5. **Security / RBAC regression** — add workflow codes to `super_admin` (and leadership/director_admin); owner-allowed workflow-admin test; route guard + employee→403 test on attendance actions; move Teams token out of the query string. *(B10)*
6. **Accessibility & interaction-state** *(frontend, do-now)* — staffing drawer dialog a11y (role/aria-modal/focus-trap/Escape/labels/validation); restore focus on Jobs/Production table rows; tie form errors to fields. *(B11–B12)*
7. **Performance & observability** — server-side jobs filtering + cursor pagination at the shared shell; admin failed-notification/outbox/stale-count panel; PII log redaction; worker heartbeat. *(B13–B14)*
8. **Deployment controls** — feature flag + rollback toggle per new surface; notification + import kill switches; outbox pause. *(B15)*
9. **Monday cutover readiness** — global quiet-load/side-effect-suppression switch (blocking); migration design doc + dry-run/staging/inventories/reconciliation; cutover runbook. *(B16)*
10. **Forward-readiness docs + smallest schema** — generic-org enum additions; school-year-profile schema design + value-states/provenance; location `review_by`/expiry; team-schedule shared-hours + filter persistence; success-measures/UAT doc; Concierge index-coverage check.

**Deferred (explicit backlog, not pre-rollout):** real email/SMS/push providers; list virtualization; external error tracking (Sentry/OTel) + metrics; full Monday bulk pipeline beyond pilot; org-to-org non-hierarchical relationships; client-survey capture; analytics instrumentation for success measures.
