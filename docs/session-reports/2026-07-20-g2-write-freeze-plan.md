# G2 — time_entry Write-Freeze Plan (2026-07-20)

**Goal:** stop the legacy `time_entry` dual-write (`services/attendance.ts:801` insert; updates :729/:844/:3853) safely. A freeze is safe only when nothing product-facing depends on NEW time_entry rows. This doc records the verified reader map and the remaining preconditions.

## Landed this session (readers now canonical-capable)
| Surface | State |
|---|---|
| Operations dashboard display (per-shift, summary, dept/shoot rollups) | **Canonical-preferred by DEFAULT** (`OPS_DASHBOARD_HOURS_SOURCE`, owner-ratified; legacy = rollback env value) |
| Home labor band / leadership weekly labor / profitability workspace | Opted into canonical via the reconciliation block, source disclosed |
| `listShifts` / `getShiftById` (`/api/shifts`) | Additive `payroll_summary_canonical` (+ `canonical_sessions` on detail) |
| Ops payroll report (`reporting.payroll`) | Additive `reporting.payroll_canonical` companion |

## Remaining preconditions (ordered)
1. **Attendance page lateral** — `services/attendance.ts:2846-2862` (`listAttendanceExceptions`) projects `time_entry.attendance_state` + `time_record_*` to `Attendance.tsx:496-508`. A `time_session` join is already in the projection; swap the lateral to session/payroll-summary and update the page fields. MIGRATE.
2. **Punch result attach** — `attendance.ts:543` (`buildPunchResult`) returns the time_entry row on every clock-in/out response. Replace with the canonical session snapshot (mobile/web punch UIs read this envelope). MIGRATE.
3. **Second legacy writer** — `worker/src/jobs/attendanceMonitor.ts:1068` auto clock-out UPDATEs time_entry. Must be frozen in the SAME slice as the attendance.ts writer or auto-closed shifts fork the truths. FREEZE TOGETHER.
4. **Deprecated shoot projection** — `routes/clock.ts:86-97` (`legacy_time_entry_projection`, `X-PMC-Deprecated-Route`). Zero product consumers (admin-web + mobile grepped clean; only `tests/timeEntries.test.ts`). Retire the route (owner sign-off) or re-point at canonical. DECIDE (recommend: retire).
5. **Orphaned legacy `getPayrollSummary`** — `attendance.ts:4067-4099`. No src caller (routes import the canonical `timeClockPayroll.ts:2101`). Confirm dead → delete. DECIDE (recommend: delete).
6. **Deliberate comparison reads** — `timeClockPayroll.ts:325-359` transition block + dashboard legacy `actual_hours` expressions: KEEP until the freeze lands, then the comparison naturally reports `legacy_time_entry_missing` for new sessions; retire the comparison one season later.
7. **Freeze slice** — stop the insert/updates behind a config flag (`TIME_ENTRY_DUAL_WRITE=off` default on until 1–5 land), keep historical rows forever (no destructive migration), leave `mileage_claim` for the G3 mileage decisions.

## Non-issues (verified)
- Migration `089:602` time_entry JOIN is a one-time backfill CTE (historical `checked_in_count` write into `jobs`), not a live view. Immutable; nothing reads it live.
- `time_entry.read` permission strings stay until the routes above migrate/retire.
- Tests/seeds writing time_entry fixtures are out of product scope.

*Scout evidence in the 2026-07-20 session; verdicts spot-checked against the tree at `2b9783b`.*
