# Staff Assignment Board — Phase 2 lifecycle trace (Step 1)

**Date:** 2026-06-18 · Branch `feature/work-spine-foundation-v1` · HEAD `61a5da9`
**Method:** four read-only sweeps over `packages/admin-web/src`, `packages/api/src`, `packages/worker/src`, `db/migrations`, verified against the working tree. No code changed. Builds on `docs/mission-control-production-readiness-gap-audit.md`.

This is the required Step‑1 documentation of the exact current staffing path, the root cause of the recorded "assigned but the board still shows No lead" defect, and the gaps Phase 2 must close. No parallel staffing records are needed — canonical `work_shift` / `shoot_staffing_requirement` models exist.

---

## 0. Root cause of "assigned but board still shows No lead" — **corrected**

The prior hypothesis (draft shifts aren't counted, so you must publish to clear "No lead") is **refuted at the SQL level.** The Staff Assignment Board coverage query **does** count drafts:

- `assigned_staff_count` — `scheduleStaffing.ts:2892` — `COUNT(DISTINCT ws.assigned_user_id) … WHERE ws.cancelled_at IS NULL AND ws.status IN ('draft','published','completed')`
- `lead_coverage_count` — `scheduleStaffing.ts:2902` — same filter `+ AND ws.satisfies_lead_coverage = true`
- assign writes a **`draft`** shift (`createShift` omits `status` → `work_shift.status DEFAULT 'draft'`, `db/migrations/007_scheduling_operations.sql:36`), so a draft lead **does** increment `lead_coverage_count` and clears `missing_lead` on the next refetch. Publish is **not** required for the board.

**The defect is two compounding factors, both fixable in Phase 2:**

1. **Primary — the board discards the mutation's authoritative snapshot and re-fetches.** `assignShootStaffingSlot` returns the fully-recomputed `ShootStaffingSnapshot` (with `missing_lead=false`), and the drawer merges it correctly (`ShootStaffingCommand.tsx:109` `applyStaffingMutationResult` → name renders at `:410`). But the board throws that snapshot away: `StaffAssignmentBoard.tsx:292-297` — `onUpdated={() => void load(anchorDate)}` and `onNotice={() => { … void load(anchorDate); }}` ignore the snapshot argument and issue a fresh `getStaffingDashboard` GET. During that second round-trip the prior `payload` (with `missing_lead=true`) stays on screen, so the drawer shows the assigned person while the board behind it still reads "No lead." After the refetch the card can also drop out of coverage while `selectedShootId` is unchanged → an orphaned drawer (`:100-103`). *Fix: merge the returned snapshot into `payload` in place; keep the selected card visible.*

2. **Secondary — no board signal for "a body was added vs the lead requirement is still open."** `lead_coverage_count` only increments when the assigned shift has `satisfies_lead_coverage=true`, which is true only for a **lead-eligible/required slot** (`scheduleStaffing.ts:1191` → `:2169` → `scheduling.ts:1234`). Assigning a person into a **non-lead** slot increments `assigned_staff_count` but not `lead_coverage_count`, so "No lead" correctly persists — but the board has no affordance distinguishing the two, so it reads as a bug. *Fix: surface lead-vs-non-lead slot state on the card/drawer.*

**Coherence asymmetry to resolve (board vs urgent-watch).** The board counts drafts as coverage, but the urgent‑watch candidate SQL counts **only published/completed**: `listSchedulingUrgentWatchCandidates` — `scheduleStaffing.ts:3068` (`assigned_staff_count … status IN ('published','completed')`) and `:3076` (`lead_coverage_count … + satisfies_lead_coverage`). So after a **draft** lead assignment the board says "lead covered" while the Exception Center still flags "missing lead coverage" until publish. Phase 2 should make these two surfaces tell one coherent story (and the urgent-watch domain test below pins the resolve rule).

---

## 1. The lifecycle path (exact file:line)

| Step | Where | Notes |
|---|---|---|
| 1. Open requirement | Board card → drawer `ShootStaffingCommand.tsx`; requirements at `:339-394`, slots `:396-554` | requirements/slots render mid-drawer; readiness summary "Warnings and Publish State" is near the **bottom** `:556-617` |
| 2. Select employee | `<select>` `ShootStaffingCommand.tsx:440-476`; bucketed candidate options (best_available/warning/conflicted_override/unavailable) from `buildStaffingSnapshot` `scheduleStaffing.ts:1369-1611` | rich sorted **picker** (role/qualification/overlap/availability/conflict/overtime); **no one-click auto-assign** exists |
| 3. Assign | `handleAssign` `ShootStaffingCommand.tsx:117` → svc `scheduleStaffing.ts:24` → `POST /api/schedule/shoots/:id/staffing/assign` | override-required options route to an approval card `:452-462` |
| 4. Persist | route `schedule.ts:332` (`requireAction("schedule.manage")`) → backend `assignShootStaffingSlot` `scheduleStaffing.ts:2023` → `createShift` `scheduling.ts:1199` | writes `work_shift` `status='draft'`, `satisfies_lead_coverage`, `reassignment_history` event (`:2148/2156`); returns rebuilt snapshot |
| 5. Recalc readiness | snapshot `buildStaffingSnapshot` `scheduleStaffing.ts:1325`; board summary `getStaffingDashboardOverview` `:2957` | **two independent count paths** (see §2) |
| 6. Publish | `handlePublish` → `POST …/staffing/publish` `schedule.ts:361` (`requireAction("schedule.publish")`) → `publishShootStaffing` `scheduleStaffing.ts:2556` → `publishShift` `scheduling.ts:1472` | flips `draft→published`, `published_at`/`published_by`; gated by blockers/warnings/approval |
| 7. Notify | `sendStaffingNotification` `scheduleStaffing.ts:1890` → `queueNotificationDispatch` `opsNotifications.ts:891` → `app_event` → worker | idempotent via `app_event` dedupe (`003:146`), but key is coarse (`staffing-publish:<shoot>:<pub#>:<draft#>`) |
| 8. Acknowledge / decline | **none** | no staffing ack/decline route or column exists (see §4) |
| 9. Reassign / remove | assign overwrite `:2148`; `removeShootStaffingAssignment` `:2361` (sets `status='cancelled'` + `{action:"removed"}` jsonb) | history in `reassignment_history` jsonb (`061:68`), actor/time retained; not a queryable status |
| 10. Urgent-watch reconcile | `syncUrgentWatchItems` `urgentWatch.ts:384` + `resolveClearedUrgentWatchItems` `:673`; candidates `scheduleStaffing.ts:3039` | resolve requires **published** coverage; reconcile is the scheduled sweep from commit `44aee1a` |

---

## 2. Counts — two independent computations (the coherence gap)

| Metric | Dashboard (board) | Snapshot (drawer) | Divergence |
|---|---|---|---|
| `assigned_staff_count` | `COUNT(DISTINCT assigned_user_id)` SQL `scheduleStaffing.ts:2894` | `assignments.length` = **filled-slot count** `:1643` | one user in two slots → board counts 1, drawer counts 2 |
| `lead_coverage_count` | SQL `+ satisfies_lead_coverage` `:2902` | `validation.leadCoverage.assignedLeadCount` `:1644` | usually agree |
| `conflict_warning_count` | **time-overlap** of a user's shifts (SQL `tstzrange &&`) `:2925` | **slots whose option `requires_override`** (qualification/lead/commitment/Outlook) `:1649` | same name, different meaning → routinely differ |
| summary tiles | `mappedCoverage`/`openCoverage` reduce `:3020-3032` (`shoots_missing_lead`, `open_staffing_slots`, `understaffed_shoots`, `conflict_warnings`, `available_staff_today`) | per-shoot snapshot fields `:1757-1780` | board re-derives independently of the snapshot the mutation returned |

**Phase 2 direction:** one canonical derivation. The mutation already returns an authoritative per-shoot snapshot; the board should merge it and the two `conflict_warning_count` semantics should be reconciled (rename or unify).

---

## 3. Lifecycle states — gap table

`work_shift.status` enum = `draft | published | cancelled | completed` (`007:2`). No `requires_acknowledgement`, `plan_version`, `acknowledged_at`, or `declined_at` column exists (verified across all 153 migrations).

| Required state | First-class today? | Backed by |
|---|---|---|
| Open / Unfilled | No (derived health) | slot has no `assigned_shift_id`; `open_slot_count` |
| Assigned Draft | Partial | `status='draft'` + filled slot |
| Published / **Awaiting Acknowledgment** | "published" yes, **awaiting-ack MISSING** | `status='published'`; nothing requires ack |
| **Acknowledged** | **MISSING** | no per-assignment ack anywhere |
| **Declined** | **MISSING** | only shift-*trade* decline exists (unrelated) |
| Reassigned | No (jsonb event) | `reassignment_history` `{action:"reassigned"}` |
| Removed | No (folds into `cancelled`) | `status='cancelled'` + `{action:"removed"}` |
| Canceled | Yes | `status='cancelled'`, `cancelled_at` |

---

## 4. Publish + acknowledgment + versioning gaps

- `publishShootStaffing` (`scheduleStaffing.ts:2556`) flips each draft slot's shift to `published` via `publishShift`. It **never sets `requiresAcknowledgement`** (`:2721-2731`).
- `publish_state` is **inferred at read time** (`buildStaffingSnapshot:1731` → `draft|ready_to_publish|published`), **not stored**. There is **no staffing-plan version** (no `plan_version` column/code anywhere).
- **No ack/decline** for a staffing assignment (no route, no column). Republish of an unchanged plan is a near no-op (skip-already-published loop `:2663`); a republish that changes counts re-sends notifications to everyone via a coarse count-keyed dedupe.
- **Prior art to extend (the template):** `shift_note_acknowledgement.note_snapshot_hash` (`db/migrations/024`; `employeeExperience.ts:378,580,1459`) — a content-hash re-ack: when content changes the hash changes, prior acks no longer match, and the UI re-prompts. Phase 2 should mint a stored staffing-plan version on publish and clone this re-ack mechanism keyed to that version, so an old acknowledgment never counts as acknowledgment of a changed plan.

---

## 5. Scheduled-hours definition + timezone + capacity view

One calc: `listScheduleMembers` `scheduling.ts:883/899` → `scheduled_hours_today/_week = SUM(EXTRACT(EPOCH FROM (ends_at - starts_at))/3600)` over `work_shift` `status IN ('draft','published','completed') AND cancelled_at IS NULL`.

| Item | In/Out |
|---|---|
| shift wall-clock span (`ends_at−starts_at`) | **IN** (the only thing summed) |
| setup/teardown | IN only if inside `starts_at`/`ends_at` (requirement `call_offset`/`end_offset` not added) |
| draft / published(ack or not) / completed | **IN** |
| cancelled | OUT |
| declined / no-show | cannot be excluded (no state) |
| travel buffer | OUT (conflict-detection input only) |
| paid breaks | not modeled (counted gross) |
| meetings / training (`schedule_event`) | **OUT** (loaded for availability only, never summed) |
| split shifts | IN, additive |
| **overlapping assignments** | **DOUBLE-COUNTED** (no overlap dedup) |
| multi-day shift touching the day | full span counted, not clipped |

- **No capacity view** in admin-web: `scheduled_hours_today/_week` have **zero** occurrences in `packages/admin-web/src`; only the `overtime_watch` flag (≥8h/day or ≥40h/week) surfaces. `Labor.tsx`/`PayrollReview.tsx` are retrospective, not a forward per-employee grid.
- **Timezone (B9):** `db/pool.ts:249` sets **no session TZ**, so `::date` buckets in UTC; `anchorDate`/`getWeekBounds` (`scheduling.ts:174-200`, `routes/schedule.ts:121`) compute in **server-local**, not America/Chicago. `utils/localDate.ts` (tz-aware) and a Chicago constant (`config.ts:142`) exist but are unwired. Must be threaded for correct weekly boundaries + the include/exclude decisions above documented as the shared calc.

These are scheduled **capacity**, not payroll hours worked — label them as such.

---

## 6. Urgent-watch staffing integration + the resolve recipe

Candidate SQL `listSchedulingUrgentWatchCandidates:3039` (window: published, future <30d, not complete/cancelled): `staffing_gap` iff `planned_staff_count > assigned_staff_count`; `critical_role_gap` iff `lead_coverage_count < required_lead_count` — both counting **only `published`/`completed`** shifts. So **assigning a draft lead does NOT resolve the urgent-watch issue; publish is required.**

**Domain test recipe (the real integration test):**
1. Create a published, future (<30d) shoot, `required_lead_count=1`, `planned_staff_count=N`, contact info present.
2. Reconcile → assert `urgent_watch_item` rows for `critical_role_gap` (and `staffing_gap`), `status='active'`.
3. Assign the required lead (lead-eligible slot, qualified+available user).
4. Reconcile → **assert still active** (draft doesn't resolve — load-bearing assertion).
5. Publish (manager actor; supply `approval_reason` if the gate requires it).
6. Reconcile → assert `critical_role_gap` `status='resolved'` (and `staffing_gap` resolved once `assigned ≥ planned`); item leaves the active workspace. *Do not resolve by moving the shoot out of the 30-day window.*

---

## 7. Permissions

- assign/remove → `requireAction("schedule.manage")` (`schedule.ts:335/391`); publish → `requireAction("schedule.publish")` (`:361`). `canPerformAction` checks the materialized permission set server-side (`authz/policy.ts:91`); deep-links do not bypass.
- Granted to super_admin/leadership/director_admin + schools/sports client-success (**department-scoped** via `canManageShootDepartment` → `canCreateOrEditCalendarDepartment` `authority.ts:1089`). Field photographers/associates get `schedule.read` only → **403** on assign/publish.
- Override/lead-slot/publish-warning paths additionally require `hasManagerApprovalAuthority` (`approvalRights.ts:71`), else a **202 approval-required** envelope.
- Employee ack scope: **no staffing ack route exists** (Phase 2 must add one, employee-scoped, that cannot edit requirements or assign others).

---

## 8. Test gaps (vs Phase 2 required tests)

Present: conflict-override 409→200 + publish-override (`schedule.test.ts:349-432`); domain math (`staffingPhase1A–4A`); employee redaction. Board page test **mocks services** and asserts static text only — **no recalc-after-assign assertion**.

Missing/partial: counts recalc after a real assign; ack + plan-version invalidation; decline + manager-view update; stale-ack-not-current; weekly scheduled-hours match + tz/DST; **urgent-watch resolve-after-fill** (current test resolves by rescheduling, not assign+publish); RBAC denial (employee 403 on assign/publish).

---

## 9. Proposed bounded slices (each its own commit + report)

1. **Staffing mutation/count coherence** *(frontend-led; lowest-risk, fixes the recorded defect)* — board merges the mutation's returned snapshot into `payload` in place instead of `load(anchorDate)`; keep the selected card visible; surface lead-vs-non-lead slot state; add the "assign immediately updates slot/counts without reload" tests. Reconcile the two `conflict_warning_count` semantics. *No migration.*
2. **Publish + acknowledgment lifecycle** *(backend + schema)* — stored staffing-plan version bumped on publish; per-recipient ack/decline (employee-scoped route) keyed to that version (clone the `note_snapshot_hash` re-ack pattern); `requiresAcknowledgement` on publish; first-class Awaiting-Ack/Acknowledged/Declined surfaced; idempotent publish + per-recipient notification dedupe; the urgent-watch resolve-after-fill domain test. *Additive migration.*
3. **Capacity planning view** *(frontend + shared calc)* — surface one shared scheduled-hours calc (documented include/exclude, America/Chicago weekly boundaries, overlap-dedup decision) in compact day/week/month per-employee views with the required filters; label as scheduled capacity. *Thread tz; possibly no migration.*
4. **Board/drawer cleanup + full verification** — remove duplicate Close/Leadership framing, one Back-to-Company-Command, move required-roles/slots/names/warnings/ack/readiness to the top of the drawer; full RBAC + responsive checks + browser smoke.

**Tracked, not in this phase:** normalizing explicit workflow permission codes for super_admin (amendment B10); observing one full scheduled `exception-reconcile` worker execution.
