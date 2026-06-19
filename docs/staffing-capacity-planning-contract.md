# Staffing Capacity Planning — calculation contract (Step 1)

**Date:** 2026-06-19 · Branch `feature/work-spine-foundation-v1`. Scheduled capacity planning, **not** payroll/actual-hours. Written before implementation per the slice's Step 1.

## Audit findings (canonical sources — do not invent beyond these)
- **Interval:** `work_shift.starts_at` / `ends_at` (timestamptz, `CHECK (ends_at > starts_at)`) are the **only** canonical interval. There is **no separate call/setup/report-time column on `work_shift`** — `starts_at` IS the employee's required report time. `shoot.arrival_time` (call) and `shoot_staffing_requirement.call_offset_minutes` exist but are **not wired** into `work_shift.starts_at` (`scheduling.ts` `createShift`/`updateShift` never read them). → **Use `starts_at`/`ends_at`; do not derive or invent call time.**
- **Existing hours calc** (`listScheduleMembers`, `scheduling.ts`): blindly `SUM(ends_at - starts_at)` (double-counts overlaps), buckets by `::date` in the **server** timezone (the pool sets no session TZ). We are replacing this with a correct, overlap-aware, Chicago-bucketed calc.
- **Lifecycle status:** `work_shift.status` ∈ `draft|published|cancelled|completed`; the **current** acknowledgment state is `staffing_plan_recipient.response_status` (`pending|acknowledged|declined|canceled`) joined by `(tenant_id, shoot_id, employee_user_id)` with `superseded_at IS NULL`. `work_shift.shoot_id` is nullable (studio/office/training shifts have no recipient → LEFT JOIN).
- **Availability:** **block-list only** — `pto_request`, `employee_availability_rule`, `staffing_blocked_date` (via `loadAvailabilityWindowsForUsersOnDate` → `AvailabilityWindow[]`). There is **no positive "available" record**; absence of a window ≠ confirmed availability. Outlook busy windows (`listOutlookBusyWindowsForUsers`) are a **stub returning empty** — no real calendar-conflict data today.
- **Targets/overtime:** **no canonical per-employee weekly target / max-hours / OT threshold** exists (`employee_pay_profile.overtime_eligible` is a boolean only). The only signal is a hardcoded **8h-day / 40h-week** heuristic repeated in three files.
- **Timezone / week:** America/Chicago is configured (`OUTLOOK_CALENDAR_TIMEZONE`, `JOB_CLOSEOUT_TIMEZONE`); `utils/localDate.ts` `getLocalDayBounds(value, {timeZone})` is DST-correct. Week = **Monday–Sunday** (`getWeekBounds`, `scheduling.ts`; "Monday 06:00" closeout).

## Calculation contract (one shared calc; America/Chicago throughout)
- **Operating date / week:** map each instant to its **America/Chicago** wall-clock date (DST-correct via `getLocalDayBounds` with `timeZone`). Planning week is **Monday–Sunday** in Chicago.
- **Per-employee minute quantities** (a shift is excluded entirely if `cancelled_at IS NOT NULL` or `status = 'cancelled'`):
  - `raw_assigned_minutes` — simple **sum** of all current (non-cancelled) assignment durations, **including drafts**. Diagnostic.
  - `unique_scheduled_minutes` — **union** of overlapping intervals (primary "Scheduled capacity"). `raw − union = overlap_minutes`.
  - `overlap_minutes`, `overlap_assignment_count` — surfaced as conflicts; never inflate the primary total.
  - `published_minutes` — shifts with `status IN (published, completed)`.
  - `coverage_eligible_minutes` — published/current **and not declined** (pending counts here; a pending ack is coverage-eligible but **not confirmed**).
  - `confirmed_minutes` — current recipient `acknowledged`.
  - `pending_confirmation_minutes` — current recipient `pending` (published).
  - `declined_minutes` — current recipient `declined` (kept visible, but **removed from coverage-eligible**).
  - `incomplete_timing_count` / minutes — shifts with missing/invalid interval: **excluded from all minute totals**, counted + exposed, **no invented duration**.
- **Labels:** primary user-facing label is **"Scheduled capacity"**. Never "Hours worked / Payroll / Actual / Paid" (those would require the timekeeping/payroll system).
- **Targets:** only compute utilization / under-/over-capacity when a **real canonical target** exists. None does → show scheduled minutes **without a denominator**. The 8h/40h heuristic is exposed **only as a warning** (`overtime_watch`), labeled as a heuristic, never as the dominant metric or a fabricated %.
- **Availability states (honest):** because availability is **block-list only** (no positive "available" record exists), the residual when no block overlaps is **`availability_not_recorded`** — *never* `available` (which would falsely imply a confirmed positive record). States: `availability_not_recorded` (we hold no signal — the default), `available_with_warning` (soft/pending block overlaps), `unavailable` (hard block overlaps). `available` is reserved for a future positive availability source. Schedule-overlap (`schedule_conflict_count` / per-assignment `has_overlap`) is tracked as a **separate field** from availability — the two never collapse into one another.
- **Calendar source (honest):** Outlook/calendar busy data is a **stub** (`listOutlookBusyWindowsForUsers` returns empty / not wired). The plan exposes `calendar_source: "calendar_not_connected"` — missing calendar data is **never** rendered as "no conflict". (`calendar_unavailable` is reserved for a connected-but-erroring integration.)

## Window contract + server-side bounds
The window is always **derived** from `(window, anchorDate)` — there is **no caller-supplied free-form range**, so the endpoint can never be used to pull all staffing history in one response.
- **`day`** → exactly the one anchor operating date. `range_start = range_end = anchorDate`. Dense (assignment-only) — see roster note.
- **`week`** → the Monday–Sunday Chicago week **containing** the anchor. `range_start` = that Monday, `range_end` = that Sunday (7 days).
- **`month`** → the **complete** Monday-anchored weeks that the anchor's **calendar month** touches (so each weekly rollup is whole). `month_start`/`month_end` carry the calendar month; `range_start`/`range_end` carry the padded full-week span (≤ 6 weeks / 42 days). Compact weekly rollup, **not** a 31-day grid.
- **Validation:** unsupported `window` → **400**; malformed/invalid `anchorDate` (bad format or non-real date like `2027-13-99`) → **400**; a span exceeding `MAX_OPERATING_DATES` (45) → **400** (a backstop that a legitimate window can never hit).

## Roster / zero-assignment inclusion
The **week** and **month** results include **every employee inside the authorized staffing scope** (active `app_user` in scope), even with **zero** current `work_shift` rows: such an employee appears with `raw_assigned_minutes = unique_scheduled_minutes = assignment_count = shoot_count = 0`, preserving `department` (roles/qualifications and availability are only enriched where a real signal exists). One roster query (no per-employee fan-out). They are **not** called underutilized (no canonical target). The roster respects the same department/employee scope and filters as the shift query; **shift-attribute filters** (role / assignment-state / acknowledgment-state / warning) suppress the zero-hour fill because a zero-hour person matches none of them. **`day`** view is intentionally **assignment-only** (it must not list the whole workforce). Unauthorized-department employees are always excluded.

## Lifecycle → capacity mapping (current version only)
draft → raw only. published → published + coverage_eligible. published+pending → +pending_confirmation. acknowledged → +confirmed (moves minutes pending→confirmed, total scheduled unchanged). declined → raw kept, **removed** from coverage_eligible. reassigned → minutes move to the replacement (old shift cancelled). cancelled/removed → excluded. superseded historical versions → never counted (recipient join uses `superseded_at IS NULL`; minutes come from `work_shift`, status-current).

## Read model + perf
One canonical service `getStaffingCapacityPlan(client, auth, {window: day|week|month, anchorDate, filters})` → normalized employee-level + per-day + per-week + assignment-level response serving all three windows. Day/week/month totals reconcile to the **same** canonical intervals (month = weekly rollups of the same per-day numbers).

**Query shape (no per-employee or per-day N+1 path):**
- **1** `work_shift` range query for the whole window — `tenant_id = $ AND starts_at < $ AND ends_at > $` (no `::date` cast, so it uses `work_shift_tenant_starts_at_idx (tenant_id, starts_at)` / `work_shift_home_dashboard_published_window_idx (tenant_id, status, starts_at, ends_at) WHERE cancelled_at IS NULL`), with the LEFT JOINs to `app_user` / `shoot` / `organization` / `staffing_plan_recipient (superseded_at IS NULL)`. All per-employee, per-day and per-week aggregation happens **in memory** from this one result set.
- **1** roster query (`app_user` active-in-scope) — week/month only; suppressed by shift-attribute filters and on day view.
- Availability: **3 sub-queries × distinct assignment dates**, batched across **all** employees on that date — `O(distinct assignment dates)`, **not** per-employee. Bounded by the window: **≤1** date for day, **≤7** for week. **Month skips** per-assignment availability (rollup; surfaced on drill-down), so month never incurs the per-day availability load.
- Per-request query count: **day** = 1 + (≤1×3); **week** = 1 + 1 + (≤7×3); **month** = 1 + 1. Measured fixture timing + counts are recorded in the commit report.
- All date-window filtering is **server-side** from **UTC instants** computed off America/Chicago day boundaries (`getLocalDayBounds(..., {timeZone})`); the service never uses server-local `::date`, `CURRENT_DATE`, or implicit DB-timezone bucketing for capacity grouping.

## Permissions
`schedule.manage` (owner/leadership/director_admin org-wide; department-scoped managers limited to their departments via the existing scope helpers). Read-only roles cannot mutate from this view (read-only endpoint). Employees cannot use the manager capacity endpoint to inspect coworkers (separate `/api/employee/*` surface). Deep links hit the guarded route.

## Explicitly NOT invented
Travel time, paid breaks, training/meeting hours, availability limits, overtime thresholds beyond the existing 8/40 heuristic, a 40h denominator per employee, or any Outlook data (stub). Missing end times produce **no** duration.
