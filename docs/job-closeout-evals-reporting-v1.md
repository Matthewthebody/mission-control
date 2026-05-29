# Job Closeout / Evaluations / Reporting V1

This branch adds the V1 foundation for turning completed jobs into operational intelligence. It reuses the existing canonical job truth layer, organization/account/location records, staff assignments, `job_watch_flags`, RBAC, mileage zones, and reporting patterns.

## Feature Flag

- API flag: `JOB_CLOSEOUT_V1_ENABLED`
- Admin web flag: `VITE_JOB_CLOSEOUT_V1_ENABLED`
- Default API behavior: enabled outside production when unset.
- Default admin-web behavior: disabled unless `VITE_JOB_CLOSEOUT_V1_ENABLED` is truthy.

Related configurable defaults live in `packages/api/src/config.ts`:

- `JOB_CLOSEOUT_CHECK_IN_OFFSET_MINUTES`: defaults to `30`
- `JOB_CLOSEOUT_MISSED_CHECK_IN_GRACE_MINUTES`: defaults to `15`
- `JOB_CLOSEOUT_LATENESS_THRESHOLD_MINUTES`: defaults to `10`
- `JOB_CLOSEOUT_REQUIRE_SENIOR_EVALUATION`: defaults to `true`
- `JOB_CLOSEOUT_REQUIRE_ASSOCIATE_EVALUATION`: defaults to `false`
- `JOB_CLOSEOUT_DAILY_REPORT_TIME`: defaults to `06:00`
- `JOB_CLOSEOUT_WEEKLY_REPORT_TIME`: defaults to `Monday 06:00`
- `JOB_CLOSEOUT_TIMEZONE`: defaults to `America/Chicago`
- `JOB_CLOSEOUT_PHOTO_SOFT_REMINDER_ENABLED`: defaults to `true`

## Persistence

Migration `146_job_closeout_evals_reporting_v1.sql` extends the existing `post_shoot_evaluation` table rather than creating a competing evaluation store. New supporting tables are:

- `shoot_check_in_request`
- `post_shoot_late_staff_entry`
- `post_shoot_evaluation_attachment`
- `job_closeout_mileage_review`
- `operations_report_snapshot`

Daily and weekly reports are persisted snapshots so leadership can review the same report later even if evaluations or flags change afterward.

## API Surface

Routes are mounted under `/api/job-closeout`:

- `GET /config`
- `GET /jobs/:jobId`
- `POST /jobs/:jobId/evaluations`
- `POST /jobs/:jobId/check-ins`
- `POST /jobs/:jobId/check-ins/:checkInId/respond`
- `POST /check-ins/sweep`
- `GET /evaluations`
- `GET /mileage-review`
- `GET /reports/:type`
- `POST /reports/:type/generate`

The API writes auto-flags through the canonical `job_watch_flags` table and dedupes active flags with `auto_key`.

## Admin Web

The route `#job-closeout` opens the reporting overview. The route `#job-closeout/jobs/:jobId` opens a job-specific mobile-first closeout workspace with:

- Shoot check-in request/response controls.
- Senior / shoot lead post-shoot closeout form.
- Associate lightweight closeout form.
- Optional setup/location photo reference.
- Mileage qualification as yes/no only.
- Pre-shoot brief panel from prior closeout notes and data issues.
- Active closeout flags and mileage review status.

The shared job detail page can link into this workspace in a follow-up pass; the route is ready now.

## Permissions

The migration seeds these permission keys:

- `job_closeout.read`
- `job_closeout.submit`
- `job_closeout.manage`
- `job_closeout.reporting.read`
- `job_closeout.reporting.sensitive`
- `job_closeout.mileage.manage`

Leadership/super-admin/director-admin authority tiers can see and manage closeout reporting. Sensitive personnel and payroll surfaces stay hidden from users without sensitive reporting or mileage permissions.

## Known V1 Limits

- Report generation is endpoint-driven. Scheduler wiring for the 6:00 a.m. daily and Monday weekly run is intentionally not added in this pass.
- The admin-web photo input captures a storage/file URL reference. Native upload UI can be layered onto the attachment endpoint later.
- Demo seed data for the full closeout scenario is not added yet; existing demo data is preserved.
- Post-production evaluation is model-compatible through `evaluation_type = post_production`, but the post-production form is not built.
- Monday.com import is model-compatible through import fields, but import mapping is intentionally deferred.
