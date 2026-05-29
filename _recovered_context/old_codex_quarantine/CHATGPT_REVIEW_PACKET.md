## Executive Summary

This pass did not broaden Mission Control. It tightened it.

The real work was:
- make the repo more reproducible
- get the API suite honestly green
- remove misleading mock/demo leakage from critical surfaces
- declutter the highest-traffic operational screens
- make the preview/detail interaction model more explicit and more testable
- move Training onto a cleaner backend-owned source-of-truth path

The main truth shift is that the repo is now easier to trust. Not perfect, but more honest.

## What Was Really Implemented

### Backend
- Fixed reseed stability in `packages/api/scripts/seed.ts` so repeated seed runs stop drifting into duplicate demo-tenant state.
- Fixed same-client concurrent query issues in:
  - `packages/api/src/services/zendesk.ts`
  - `packages/api/src/services/training.ts`
- Added a backend-owned training catalog endpoint in:
  - `packages/api/src/services/training.ts`
  - `packages/api/src/routes/training.ts`
- Removed demo shoot-code branching from `packages/api/src/services/homeDashboard.ts` weather/travel logic.

### Frontend
- Tightened preview/detail behavior in `packages/admin-web/src/components/OperationalDetailSection.tsx`.
- Decluttered navigation in `packages/admin-web/src/app.tsx`.
- Made the dashboard more preview-first in `packages/admin-web/src/pages/Dashboard.tsx`.
- Demoted secondary creation/review work in `packages/admin-web/src/pages/Scheduling.tsx`.
- Grouped risk/control noise behind explicit reveal in `packages/admin-web/src/pages/Approvals.tsx`.
- Moved Training off the deleted mock service and onto backend-owned catalog data in:
  - `packages/admin-web/src/services/trainingApi.ts`
  - `packages/admin-web/src/pages/Training.tsx`
- Reworded misleading external-context copy in `packages/admin-web/src/components/ShootDetailDrawer.tsx`.

### Tests
- Updated `packages/admin-web/src/test/operationsPages.test.tsx` so it validates the new collapsed-detail dashboard behavior instead of assuming the old always-open layout.
- API validation now passes end-to-end after the training service fix.

## What Was Cleaned Up

### Repo honesty
- Seed behavior is now stable and reviewable.
- The API test state is now real, not dependent on a lucky dirty database.
- Training no longer uses a rich frontend mock service that overstates backend maturity.

### UX clutter
- Dashboard secondary queues are explicit drill-downs now.
- Scheduling is more centered on the board and staffing.
- Approvals is less noisy at the top level.
- Top-level nav is slimmer and clearer.

### Mock/demo leakage
- Removed `packages/admin-web/src/services/mockTrainingServices.ts`.
- Cleaned up misleading "mocked service surfaces" language in the shoot drawer.
- Removed hardcoded `DEMO-001` / `DEMO-002` dependency from home dashboard weather/travel behavior.

## What Remains Hybrid Or Incomplete

- Browser auth is still hybrid. The app still carries token/local-storage behavior alongside newer server-session work.
- `packages/admin-web/src/components/ShootDetailDrawer.tsx` still depends on fallback/mock-backed adapters under the hood even though the copy is now more honest.
- Training catalog ownership is cleaner, but the content model is still thinner than the UI ambition.
- The API suite still emits `pg` deprecation warnings, which means more same-client concurrent query patterns remain elsewhere.
- Some screens are still too dense:
  - `packages/admin-web/src/pages/Attendance.tsx`
  - `packages/admin-web/src/pages/Labor.tsx`
  - parts of `packages/admin-web/src/pages/CustomerService.tsx`

## Validation Results

Commands run:
- `npm run db:seed`
- `npm run build -w packages/api`
- `npm run test -w packages/api -- tests/training.test.ts`
- `npm run test -w packages/api`
- `npm run build -w packages/admin-web`
- `npm run test -w packages/admin-web`

Results:
- API build: passed
- API tests: passed `26 files / 124 tests`
- Admin-web build: passed
- Admin-web tests: passed `5 files / 20 tests`

Warnings still present:
- Vite chunk-size warning in admin-web build
- `pg` concurrent-query deprecation warnings still emitted during API tests

## Top Files Changed In This Cleanup Pass

### Reproducibility and backend stability
- `packages/api/scripts/seed.ts`
- `packages/api/src/services/zendesk.ts`
- `packages/api/src/services/training.ts`
- `packages/api/tests/shootsCrud.test.ts`
- `packages/api/tests/alerts.test.ts`
- `packages/api/tests/outlookIntegration.test.ts`
- `packages/api/tests/schedule.test.ts`
- `packages/api/tests/schedulingAttendance.test.ts`
- `packages/api/tests/routePermissions.test.ts`

### UX cleanup and preview/detail
- `packages/admin-web/src/components/OperationalDetailSection.tsx`
- `packages/admin-web/src/pages/Dashboard.tsx`
- `packages/admin-web/src/pages/Scheduling.tsx`
- `packages/admin-web/src/pages/Approvals.tsx`
- `packages/admin-web/src/app.tsx`
- `packages/admin-web/src/test/operationsPages.test.tsx`

### Training source of truth
- `packages/api/src/routes/training.ts`
- `packages/api/src/services/training.ts`
- `packages/admin-web/src/services/trainingApi.ts`
- `packages/admin-web/src/pages/Training.tsx`
- `packages/admin-web/src/types.ts`
- deleted: `packages/admin-web/src/services/mockTrainingServices.ts`

### Mock/demo honesty cleanup
- `packages/admin-web/src/components/ShootDetailDrawer.tsx`
- `packages/api/src/services/homeDashboard.ts`

## What Still Needs The Next Pass

1. Remove the remaining same-client concurrent query patterns that still produce `pg` deprecation warnings.
2. Finish clarifying the browser auth/session target instead of carrying long-term hybrid behavior.
3. Continue decluttering Attendance and Labor so the preview/detail model is more consistent.
4. Replace remaining high-trust fallback adapters in the shoot detail experience.
5. Deepen the backend-owned Training catalog with real SOP/playbook content so the page no longer outpaces its durable content model.
