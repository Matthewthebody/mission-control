# Staffing Publish + Acknowledgment Lifecycle — Slice 2 design

**Date:** 2026-06-18 · Branch `feature/work-spine-foundation-v1` · HEAD `8492da4`
**Builds on:** `docs/staffing-lifecycle-trace.md` (Phase 2 Step 1). This is the design to review **before** any migration.

**Principle:** extend the existing canonical models. **No parallel staffing-plan store** — `work_shift` and `shoot_staffing_requirement` remain the assignment/requirement source of truth; we add a per-shoot *published version* ledger and a *per-recipient acknowledgment* table, and reuse the existing outbox for notifications. The content-hash re-ack mechanism is cloned from the proven `shift_note_acknowledgement` pattern (migration 024).

---

## 1. Current canonical tables + services (no change to these)
- `work_shift` (`007`): the assignment record — `status` (draft|published|cancelled|completed), `assigned_user_id`, `satisfies_lead_coverage`, `published_at`, `published_by_user_id`, `cancelled_at`, `reassignment_history` jsonb.
- `shoot_staffing_requirement` (`061`): per-shoot role/slot requirements.
- `shoot`: `planned_staff_count`, `required_lead_count`, `minimum_staff_count`, times, date, location.
- Services: `scheduleStaffing.ts` (assign 2023, publish 2556, remove 2361, snapshot 1325), `scheduling.ts` (`publishShift` 1472, `createShift` 1199), `opsNotifications.ts` (`queueNotificationDispatch` 891), `outbox.ts` (`createAppEvent` dedupe), `urgentWatch.ts` (reconcile).
- Prior art: `shift_note_acknowledgement` (`024`) — `note_snapshot_hash` content hash; ack matches only while the hash matches; content change ⇒ re-prompt. **This is the template.**

## 2. Proposed additive schema (one migration, all additive)
- **`staffing_plan_version`** — the per-shoot published-version ledger (append-only):
  `id, tenant_id, shoot_id, version int, plan_hash text, published_at timestamptz, published_by_user_id, recipients jsonb`.
  `UNIQUE (tenant_id, shoot_id, version)`. `recipients` = the immutable snapshot of the published assignments: `[{ work_shift_id, employee_user_id, slot_key, staffing_role, satisfies_lead_coverage, starts_at, ends_at }]`.
- **`staffing_assignment_acknowledgement`** — per-recipient ack/decline:
  `id, tenant_id, shoot_id, plan_version int, work_shift_id, employee_user_id, status (acknowledged|declined), actor_user_id, created_at timestamptz, decline_reason text null, plan_hash text`.
  `UNIQUE (tenant_id, shoot_id, plan_version, employee_user_id)` (one record per employee per version; ack→decline updates in place).
- No columns added to `work_shift` are required for versioning (the version lives in the ledger); optionally a denormalized `current_plan_version` could be cached on `shoot` later, but is **not** needed for correctness in this slice.

## 3. Plan-version ownership + recipient identity
- **Ownership:** the **shoot** owns the plan version — a monotonically increasing integer per shoot (`max(version)` for the shoot = current). A published version is an immutable row in `staffing_plan_version` carrying the recipient snapshot and `plan_hash`.
- **Recipient identity:** each published assignment's `assigned_user_id` (the employee on a `work_shift` in the version's `recipients`). Acks are keyed by `(shoot, plan_version, employee_user_id)`.

## 4. Acknowledgment / decline records
Each ack/decline references: tenant · shoot · published `plan_version` · `employee_user_id` · `work_shift_id` (the slot/assignment) · `status` · `actor_user_id` · `created_at` · `decline_reason` (when declined) · `plan_hash` (content identity). **An acknowledgment of version N is stored against N and never satisfies N+1** (the current-version check looks for an ack at `max(version)`).

## 5. Lifecycle states (derived, not new enums)
| State | Derivation |
|---|---|
| Draft | `work_shift` draft, no `staffing_plan_version` ≥ the current draft content |
| Published / Awaiting Acknowledgment | current version published, recipient has no ack at `max(version)` |
| Acknowledged | recipient has `status='acknowledged'` at `max(version)` |
| Partially Acknowledged | multi-recipient version, some (not all) acked at `max(version)` |
| Declined | recipient `status='declined'` at `max(version)` |
| Changed Since Acknowledgment | recipient acked version N, current = N+1 (their ack is historical; they're Awaiting N+1) |
| Reassigned / Removed | existing `reassignment_history` jsonb + `cancelled` (unchanged) |
| Canceled | `work_shift.status='cancelled'` (unchanged) |

## 6. Material-change rules — version increment + ack invalidation
`plan_hash` = SHA-256 over the **sorted material fields** of the published assignments:
`[{ slot_key, employee_user_id, staffing_role, satisfies_lead_coverage, starts_at, ends_at, shoot_date, location_key, material_instructions }]`.

| Change | New version on publish? | Invalidates prior ack? |
|---|---|---|
| Employee reassignment | **Yes** | Yes |
| Role / slot change | **Yes** | Yes |
| Start / end time change | **Yes** | Yes |
| Shoot date change | **Yes** | Yes |
| Meaningful location change | **Yes** | Yes |
| Employee added or removed | **Yes** | Yes (added → new Awaiting; removed → no longer pending) |
| Assignment cancellation | **Yes** | Yes |
| Material assignment instructions | **Yes** | Yes |
| Non-material internal notes / metadata | **No** | No |
| Harmless reads | **No** | No |

The hash is computed **only** over material fields, so a non-material edit yields the same hash ⇒ no new version ⇒ acks stand. A material edit changes the hash ⇒ publishing creates version N+1 ⇒ recipients are Awaiting N+1 (prior N acks remain in history but don't satisfy N+1). **Versions never increment on reads or unrelated metadata.**

## 7. Publishing behavior
On `publish`:
1. Compute `plan_hash` from the shoot's current assignments (material fields).
2. If a current version exists with the **same** `plan_hash` → **safe no-op** (documented republish rule: no new version, no new notifications; return the current published state). This makes double-click/repeat-publish-of-unchanged safe.
3. Else create version `N+1` in `staffing_plan_version` with the recipient snapshot, flip draft slots → `published` (existing `publishShift`), record actor + time.
4. Mark each recipient **Awaiting Acknowledgment** for `N+1` (they have no ack at N+1).
5. Queue **one** notification per recipient via the outbox, `requiresAcknowledgement = true`, dedupe key `staffing-publish:<shoot>:<N+1>:<employee>` (stable per version+recipient).

## 8. Acknowledgment + decline behavior (employee-scoped)
- New employee routes (mirroring `routes/employee.ts` ack pattern): `POST /api/employee/staffing/:shootId/acknowledge` and `.../decline`. Guarded so an employee may act **only on their own current published assignment** (their `assigned_user_id` appears in `max(version).recipients`); they cannot assign/publish/override/edit requirements.
- **Acknowledge:** references the current `max(version)`; records actor + timestamp; **idempotent** (UNIQUE constraint, ON CONFLICT update); updates the manager view immediately.
- **Decline:** requires a `decline_reason` where policy requires; references current version; records reason; **reactivates the staffing issue** (urgent-watch) for that coverage; preserves the declined assignment + history; never grants config edit rights.
- A **removed** employee's outstanding request is no longer pending — they are absent from `N+1.recipients`, so they don't count as Awaiting for the current plan.

## 9. Notification idempotency
Reuse `app_event` partial-unique `dedupe_key` (`003:146`) + `createAppEvent ON CONFLICT DO NOTHING`. Replace the trace's coarse count-keyed dedupe with `staffing-publish:<shoot>:<version>:<employee>`:
- double-click / request retry / worker retry → same key → **no duplicate**.
- a new version → new key → **one** new notification per recipient.
- resolve/cancel → mark the pending `ops_notification` resolved (the existing acknowledge/resolve path), making reminders obsolete.
- email/SMS/push remain stubs → kept hidden/clearly-unavailable (no change; in-app + queue are real).

## 10. Urgent-watch integration
Coverage-based candidates (`listSchedulingUrgentWatchCandidates`, counts **published** coverage) are unchanged. The resolve-after-fill loop: understaffed → reconcile (active) → assign lead (draft) → reconcile (**still active**) → publish → reconcile (**resolved**). A **decline** drops published coverage for that slot → reconcile reactivates the staffing issue. A material change that requires renewed acknowledgment keeps coverage satisfied (still published), so the coverage-watch stays resolved; surfacing an *Awaiting-Ack* operational signal is **policy-dependent** — if required, a dedicated `unacknowledged_assignment` watch type can be added, but is out of this slice's coverage rule unless a test proves the current rule wrong.

## 11. Audit / history
- `staffing_plan_version` is append-only → full publish history (every version, actor, time, recipient snapshot).
- `staffing_assignment_acknowledgement` retains every ack/decline per version → full ack history (prior-version acks preserved).
- One `audit_events` entry per publish and per ack/decline (actor, old/new). `reassignment_history` jsonb continues for assignment changes.

## 12. Permissions
- Publish/assign/reassign/override → `schedule.publish` / `schedule.manage` (owner, leadership, director_admin, dept-scoped client-success). Department scope via `canManageShootDepartment`.
- Employee ack/decline → a new employee-scoped guard: actor is the assignment's `assigned_user_id` for the **current** version, on a `schedule.read`-class permission; **cannot** publish/assign/reassign/override/edit requirements.
- Deep links cannot bypass — every mutation hits a guarded route (the hash router carries no authority).

## 13. Implementation sub-slices (bounded commits)
1. **Additive schema + services** — the two tables + `recordStaffingPlanVersion` / `getCurrentStaffingPlan` / `plan_hash` helpers; publish writes the version; snapshot exposes version + per-recipient ack state. Migration tests.
2. **Publish / version behavior** — material-change hash, safe-no-op republish, `requiresAcknowledgement`, per-recipient dedupe key. Publish/idempotency tests + the changed-after-ack (v1→v2) test.
3. **Employee acknowledgment / decline UI + routes** — employee-scoped ack/decline; manager view shows Awaiting/Acknowledged/Declined/Partially. RBAC tests.
4. **Urgent-watch + notification integration** — decline reactivates the issue; the resolve-after-fill domain test; notification idempotency (double-click/retry).
5. **Verification** — full admin-web + worker + API suites, browser smoke (publish v1 → ack → change → publish v2 → prior ack historical → ack v2).
