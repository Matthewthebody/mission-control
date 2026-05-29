# Client Operations Core Phase G8 Handoff

## Scope

Phase G8 turns structured operational data into proactive leadership signals without inventing a second rules engine.

Implemented areas:
- stronger background compliance follow-up automation
- unresolved end-of-day escalation
- recurring compliance digest hook
- tighter notification dedupe behavior
- operational intelligence reporting across labor, compliance, locations, accounts, gear, and upcoming shoots

## Source of truth

This phase stays anchored to existing canonical records:
- compliance flags: `time_clock_compliance_flag`
- presence incidents: `time_clock_presence_incident`
- labor exceptions: `attendance_exception`
- prep/resources: `resource_library_item`
- evaluations: `post_shoot_evaluation`
- gear issues and readiness: `gear_service_repair_record`, `gear_pre_shoot_verification`, `gear_alert`
- agreements: canonical `agreement` lifecycle and organization agreement coverage
- CRM pressure: `sales_pipeline_alert`
- support pressure: `zendesk_ticket_cache`
- shoot readiness: canonical `shoot` + staffing + agreement warning projections

## Background automation behavior

Worker automation additions live in:
- `packages/worker/src/jobs/attendanceMonitor.ts`

Added behaviors:
- `attendance.closeout_follow_up`
  - fires for open `missing_setup_photo`, `missing_post_shoot_evaluation`, and `mileage_blocked_missing_post_shoot_evaluation`
  - waits until the item has been open for at least 2 hours
  - dedupes once per compliance flag per day
- `attendance.end_of_day_confirmation_escalation`
  - fires for open `unresolved_end_of_day_confirmation`
  - waits until the item has been open for at least 90 minutes
  - targets leadership plus the affected employee
  - dedupes in 6-hour buckets
- `attendance.compliance_digest`
  - fires for leadership when unresolved compliance/presence volume crosses the digest threshold
  - uses tenant-aware daily dedupe

Shared helper added:
- `runAttendanceAutomationForTenant(...)`

That helper is now called from the main attendance monitor loop, so the automation path is explicit and testable without duplicating business logic.

## Operational intelligence report

New leadership report:
- `operational_intelligence_report`

Core implementation:
- `packages/api/src/services/leadershipReports.ts`
- `packages/api/src/routes/dashboard.ts`

Sections now included:
- Repeated Missed Clock-Ins By Employee
- Repeated Location Issues
- Repeated Gear Issues / Missing Kit Contents
- Account Health Signals
- Shoot Readiness Signals

The account-health section now combines:
- agreement posture
- open support issue pressure
- recent shoots
- upcoming shoots
- CRM alerts
- unresolved operational issues

The shoot-readiness section combines:
- agreement warning severity
- staffing gap
- lead gap
- prep-material gaps
- gear alerts / verification issues
- prior location issue context
- compliance risk count

## UI surface

This phase uses the existing leadership `Reports` workspace instead of creating another dashboard silo.

Frontend touchpoints:
- `packages/admin-web/src/types.ts`
- `packages/admin-web/src/test/operationsPages.test.tsx`

The report now appears in the report catalog as:
- `Operational Intelligence Report`

## Validation

Passed:
- `npm run build -w packages/api`
- `npm run build -w packages/worker`
- `npm run build -w packages/admin-web`
- `npm run test -w packages/api -- tests/operationalIntelligencePhaseG8.test.ts`
- `npm run test -w packages/admin-web -- src/test/operationsPages.test.tsx`

Additional direct probe:
- executed the new worker helper path against the real database (`runAttendanceAutomationForTenant`) and confirmed it produced:
  - closeout follow-up notifications
  - end-of-day escalation notifications
  - tenant-scoped daily digest dedupe behavior for compliance review notifications

Honest caveat:
- the existing full worker attendance suite remains unstable under the current harness, so this phase does not claim a clean full-suite worker pass

## Review focus

Review these files first:
- `packages/worker/src/jobs/attendanceMonitor.ts`
- `packages/api/src/services/leadershipReports.ts`
- `packages/api/src/routes/dashboard.ts`
- `packages/api/tests/operationalIntelligencePhaseG8.test.ts`
- `packages/admin-web/src/test/operationsPages.test.tsx`

## Follow-up suggestions

Best next steps after G8:
- add a dedicated intelligence drill-in page if leadership wants action queues outside Reports
- add per-organization support-to-account matching hardening beyond organization-name matching
- stabilize the worker attendance suite so the new tenant automation helper can be covered in-package
