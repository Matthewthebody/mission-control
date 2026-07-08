# G2 Canonical Labor/Mileage Audit & First-Slice Plan

**Date:** 2026-07-08 · **HEAD at audit:** `045a7ff` · read-only audit (no code changed by this doc).
**Inputs:** fresh full-repo sweep + the committed scout audits (`docs/audits/mission-control-scout-a-source-of-truth.md`, `mission-control-full-system-audit.md` — written at `fe5853e8`, one batch behind; drift reconciled below).

## 0. Headline decision memo

**Canonical direction CONFIRMED, already established and enforced in the payroll stack:**
- **Labor:** `time_session`/`time_segment`/`clock_event` (034) + `time_session_payroll_summary` (038, single-writer `timeClockPayroll.ts:810`).
- **Mileage:** `mileage_reimbursement` (037) via the idempotent `recalculateMileageForEmployeeDate` derivation.

**G2 is a read-consolidation + shadow-retirement effort, NOT a model rebuild or data migration.** The remaining divergence is: one legacy read fork (`getOperationsDashboard` → `time_entry`) inherited by six surfaces, two write shadows (`time_entry`, `mileage_claim`), and one orphan store (`job_closeout_mileage_review`).

**Ratified sub-decisions:**
1. **`shift_punch` is canonical input (bridge), NOT legacy** — the canonical stack (Labor Command Center, laborSweep, payrollPeriods, payrollSelfCheck) counts punches for approval gating. Never freeze it. Only `time_entry` and `mileage_claim` are shadows.
2. `mileage_reimbursement.{approved,exported}` are **dead enum states with no writer** — decide writer-or-remove in G3 before anything gates on them. (The SSA-3 endpoint now guards against overwriting them if they ever gain a writer — `945fdf6`.)

## 1. Labor truth map (evidence-cited)

| Surface | Class | Notes |
|---|---|---|
| `time_session`/`time_segment`/`clock_event` | **canonical** | dual session writers (attendance.ts:1073 AND timeClockRuntime.ts:679) — reconciliation tests must seed via the production path |
| `time_session_payroll_summary` | **canonical, single-writer** | writer timeClockPayroll.ts:810; readers payrollSelfCheck.ts:241,583 + complianceWorkspace.ts:2032 |
| `shift_punch` (007) | **bridge/canonical input** | writers attendance.ts:1712,2233 + worker attendanceMonitor.ts:1108; read by BOTH stacks |
| `time_entry` (003/015) | **legacy shadow — freeze target** | writes attendance.ts:801/729/844/3853; reads dashboard.ts:153-313 (the fork), scheduling.ts, clock.ts (intentional compat projection), timeClockPayroll.ts:347 (intentional comparison) |
| `getOperationsDashboard` (dashboard.ts:122) | **THE legacy read fork** | `actual_hours` from SUM(time_entry.minutes_worked) w/ shift_punch fallback; never reads time_session. Consumers inheriting legacy hours: `/api/dashboard/operations` (+CSV), Home labor band (homeDashboard.ts:712), leadershipReports.ts ×7, profitabilityWorkspace.ts:163 |
| `getPayrollSummary` (timeClockPayroll.ts:2101) | **canonical** | payroll-review route, manager cockpit, self-check; carries built-in `transition` legacy comparison (:2249-2263) |

**Concrete disagreement by construction:** the Home manager-cockpit tile (canonical hours) and the Home labor band / Operations dashboard (legacy hours) render from two truths on one screen; leadership reports read legacy, payroll reads canonical.

**Beware:** TWO `getPayrollSummary` functions exist — legacy `attendance.ts:4067` vs canonical `timeClockPayroll.ts:2101`; routes import the canonical one. New callers must import from `timeClockPayroll`.

## 2. Mileage truth map

| Surface | Class | Notes |
|---|---|---|
| `mileage_reimbursement` | **canonical** | sole writer = `upsertReimbursement` via the recalc (timeClockMileage.ts:757); payroll reads only this |
| `mileage_claim` (003) | **legacy shadow — safest eventual drop** | writer mileage.ts:80 (immediately syncs canonical at :87); readers = its own idempotency check + the intentional `legacy_comparison` join (timeClockMileage.ts:412). Zero canonical/payroll/dashboard readers. |
| `job_closeout_mileage_review` (146) | **parallel/orphan** | writer jobCloseoutV1.ts:939, own status enum, NEVER feeds canonical; payroll is blind to it. Must become a *reference* to canonical, never a fourth writer — precondition for wiring Job Closeout V1 to the SSA-3 prompt. |
| SSA-3 `POST /api/post-shoot/mileage-eligibility` | **canonical writer** (via eval + recalc) | now guards approved/exported (945fdf6) |

**Status semantics (precise):** declined with worked shifts ⇒ `ineligible`/`submit_declined` (fallback chain :574-580); **no worked shifts ⇒ `cancelled`/`submit_declined` (:471)** — cite the right branch when writing the G3 semantics migration. "Answer pending" is unrepresentable (`submit_for_mileage` defaults false) — an explicit tri-state/`answer_pending` is migration work (option C), gated behind a flag with backfill, **after** the read side is trustworthy.

## 3. Dual-write / dual-read maps

**Dual-write:** clock-in/out → `time_session`+`clock_event` AND `time_entry` AND `shift_punch` in one attendance.ts flow (no sync guarantee between time_entry and time_session); mileage submit → `mileage_claim` AND canonical (bridged synchronously); closeout mileage → `job_closeout_mileage_review` only (NOT bridged).
**Dual-read:** the `getOperationsDashboard` fork (above) is the only *unintentional* one; `getPayrollSummary.transition` and `listMileageReimbursements.legacy_comparison` read legacy *deliberately* as comparison views.

## 4. Slice selection — why D (additive canonical dashboard hours)

- **A (labor comparison endpoint) ALREADY EXISTS:** `getPayrollSummary.transition` (timeClockPayroll.ts:2249-2263) emits per-employee `legacy_comparison` + mismatch counts on `/api/attendance/payroll-review`.
- **B (mileage comparison endpoint) ALREADY EXISTS:** `listMileageReimbursements.transition` (timeClockMileage.ts:175-185).
- **C (answer-pending semantics)** = enum/backfill migration with UX ramifications — after D.
- **E (wrap legacy mileage submit)** = nearly inert already (synchronous canonical sync, zero canonical readers).
- **D** is the one unshipped, zero-migration, high-leverage move that makes "dashboard hours ≠ payroll hours" measurable and then killable.

## 5. G2 first implementation prompt (next slice)

> Implement G2 Slice D — additive canonical hours on the operations dashboard. Repo `C:\Dev\Codex-integrated-baseline-clean`. In `getOperationsDashboard` (services/dashboard.ts:153-174, 234-255, 291-313) add a PARALLEL canonical derivation summing `time_segment` payable minutes joined `work_shift.id = time_session.source_shift_id` (copy the proven join from payrollSelfCheck.ts:239-242). Do NOT change `actual_hours` — emit `actual_hours_canonical` + `hours_source_delta` per row and a top-level `hours_reconciliation { legacy_total, canonical_total, delta, mismatch_shift_count }` (mirror the payroll `transition.comparison` shape). Zero blast radius: leadership/home/profitability consumers opt in later, one PR each. Tests: (1) divergent seed (time_session+segment AND different time_entry) → legacy≠canonical + mismatch_shift_count 1; (2) matching seed → delta 0; (3) canonical-only seed → canonical populated, legacy 0, surfaces in reconciliation; (4) admin-web operationsPages.test.tsx existing `actual_hours` assertions unchanged. Seed sessions through the production writer path (two `time_session` writers exist). Never freeze `shift_punch`; import payroll functions from `timeClockPayroll`, not `attendance`. Browser: `/api/dashboard/operations` payload shows both totals + delta; Operations page renders unchanged legacy numbers.

## 6. Retirement sequencing (after D)

1. Consumers opt into canonical hours one-by-one (Home band → leadership → profitability), each behind its own tests.
2. Read-cutover flag for `getOperationsDashboard` default → canonical.
3. Stop the `attendance.ts:801` `time_entry` insert (compat projection `clock.ts` stays until product retires it).
4. Mileage: G3 decides approved/exported writer-or-remove + answer-pending semantics (option C) + Job Closeout V1 re-pointing at canonical; only then wire the closeout to the SSA-3 prompt.
5. `mileage_claim` drop candidate once the legacy submit route is retired.

## 7. Do-not-screw-this-up list

1. `shift_punch` is NOT legacy — never freeze it (canonical stack counts punches for approvals).
2. Never swap `actual_hours` in place — six consumers + `operationsPages.test.tsx` pin it; go additive.
3. Don't build new comparison endpoints — both already exist (`transition` blocks); a third comparison surface is the anti-pattern this audit exists to kill.
4. `approved`/`exported` mileage states have no writer — dead logic until G3 decides; the SSA-3 guard (945fdf6) protects the boundary meanwhile.
5. `job_closeout_mileage_review` must never become a fourth mileage writer — reference canonical instead; precondition for the closeout prompt wiring.
6. Declined ⇒ `cancelled/submit_declined` (no shifts) vs `ineligible/submit_declined` (worked shifts) — branch-specific; cite correctly in migration C.
7. Two `getPayrollSummary`s and two `time_session` writers exist — import canonical, seed via production paths.
8. MC-AUDIT-002 is FIXED at `045a7ff` — preserve `restrictPayrollListToSelf` / `scopedEmployeeId` own-scope defaults in any touched code; don't re-cite it as open.
