# Prompt 6: Time Clock And Labor-State Phase 1 Handoff

## What Changed
- Added the Phase 1 canonical labor-state schema in [db/migrations/034_time_clock_labor_phase1.sql](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\db\migrations\034_time_clock_labor_phase1.sql).
- Added typed backend model contracts in [packages/api/src/types/timeClock.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\types\timeClock.ts).
- Extended the generic audit service so audit rows can carry `previous_values`, `new_values`, and `reason_comment` in [packages/api/src/services/audit.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\audit.ts).
- Added direct schema validation coverage in [packages/api/tests/timeClockLaborSchema.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\timeClockLaborSchema.test.ts).

## Canonical Phase 1 Model
- `Employee Pay Profile` stores office and photography rates, overtime eligibility, mileage eligibility, and effective dating.
- `Time Session` is the employee/day container and the anchor for later payroll export.
- `Time Segment` stores explicit paid work-state segments inside a session.
- `Clock Event` is the immutable event stream that reconstructs how sessions and segments changed.
- `Exception Request` captures employee- or leadership-submitted time/labor corrections.
- `Approval Record` stores approval decisions separately instead of mutating request history in place.
- `Audit Log` now supports before/after values and reason comments for payroll-grade traceability.

## Important Rules Enforced In Schema
- Only one active `Employee Pay Profile` per employee at a time.
- Only one open `Time Session` per employee per work date.
- `Time Segment.duration_minutes` is generated from start/end timestamps so totals stay reconstructable.
- `Clock Event`, `Exception Request`, and `Approval Record` are relationally linked to sessions/segments/shoots instead of being opaque blobs.

## Not Built Yet
- No UI or API workflow for this model yet.
- No payroll export formatting yet.
- No automatic lunch-deduction engine migration into the new model yet.
- No overtime/blended-rate calculation service yet.
- No geofence-triggered segment transition logic yet.

## Reviewer Focus
- Validate the enum set in the migration matches the intended long-term language.
- Validate the uniqueness constraints on active pay profiles and open sessions.
- Validate that the audit extension is sufficient for future payroll review tooling.
- Validate whether `Exception Request` needs additional fields before Phase 2 workflow wiring.
