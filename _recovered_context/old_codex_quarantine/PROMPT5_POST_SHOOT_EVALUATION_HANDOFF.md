# Prompt 5 Handoff: Post-Shoot Evaluation, Reminder Flow, and Leadership Notification Logic

## What changed

- Added the Phase 1 `Post-Shoot Evaluation` schema in [032_post_shoot_evaluation_compliance_phase1.sql](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\db\migrations\032_post_shoot_evaluation_compliance_phase1.sql).
- Built a dedicated closeout compliance service in [postShootEvaluations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\postShootEvaluations.ts).
- Added employee submission endpoint in [employee.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\employee.ts).
- Extended clock-out handling in [attendance.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\attendance.ts) so missing closeout items warn but do not block the punch.
- Resolved missing-setup-photo alerts automatically when a setup photo is uploaded through the mobile `Resource Library` flow in [resourceLibraryUploads.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\resourceLibraryUploads.ts).
- Exposed closeout compliance state in employee and shift detail payloads through [employeeExperience.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\employeeExperience.ts) and [scheduling.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\scheduling.ts).
- Built the mobile `Post-Shoot Evaluation` workflow in [PostShootEvaluationModal.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\mobile\src\components\PostShootEvaluationModal.tsx), [postShootEvaluations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\mobile\src\postShootEvaluations.ts), and [Shoot.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\mobile\src\screens\Shoot.tsx).
- Added notification routing seed coverage for leadership closeout events in [seed.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\scripts\seed.ts).
- Added regression coverage in [postShootEvaluationCloseout.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\postShootEvaluationCloseout.test.ts).

## Implemented behavior

### Post-Shoot Evaluation model

- Every `Post-Shoot Evaluation` links to:
  - `Shoot`
  - `Organization`
  - `Location`
  - submitting user
  - `shift_id`
  - `submitted_at`
  - `evaluation_year`
- Mobile form captures:
  - `overall shoot status`
  - `what went well`
  - `what should be remembered next time`
  - `issue / concern flag`
  - `open comment`

### No edit after submit

- Standard users cannot edit or re-submit after the first submission.
- Enforcement is backend-owned:
  - unique per `tenant_id + shift_id + photographer_user_id`
  - service rejects second submit with `409`

### During-shoot reminder behavior

- Senior coverage shifts compute a `setup_photo_reminder_due` signal once the shift is clocked in and passes the `30 minute` threshold without a setup photo.
- That reminder is surfaced in the mobile shift detail and `Post-Shoot Evaluation` context.
- Current scope is an in-app reminder state, not a background reminder job.

### Clock-out behavior

- Missing setup photo and/or `Post-Shoot Evaluation`:
  - warns the user
  - allows clock-out anyway
  - logs the incomplete closeout in audit
  - opens operational alerts
  - queues leadership notifications

### Leadership notification hooks

- Missing setup photo at clock-out queues:
  - `shoot.closeout_missing_setup_photo`
- Missing `Post-Shoot Evaluation` at clock-out queues:
  - `shoot.closeout_missing_post_shoot_evaluation`
- Seed routing now includes leadership recipients for both codes.

## Validation

- `npm run db:migrate` ✅
- `npm run db:seed` ✅
- `npm run build -w packages/api` ✅
- `npm run test -w packages/api -- tests/postShootEvaluationCloseout.test.ts` ✅
- `npm run test -w packages/api` ✅ `29 files / 137 tests`
- `npm run test -w packages/admin-web` ✅ `6 files / 24 tests`
- `npm run build -w packages/admin-web` ✅
- `npx tsc -p packages/mobile/tsconfig.json --noEmit` ✅

## Reviewer focus

- Verify that standard users cannot edit a submitted `Post-Shoot Evaluation`.
- Verify the mobile closeout section clearly distinguishes:
  - setup photo missing
  - `Post-Shoot Evaluation` missing
  - reminder due
- Verify clock-out is not blocked when closeout is incomplete.
- Verify alerts and notification outbox events are created for leadership review.
- Verify uploaded setup photos resolve the missing-setup-photo alert path.

## Honest follow-up

- The reminder flow is currently strongest in the mobile workflow itself. There is not yet a separate background reminder/push scheduler that proactively nags the assigned senior photographer at the 30-minute threshold without them opening the app.
