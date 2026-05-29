# Repo Honesty And Cleanup Review

## Executive read
- This pass improved repo honesty in code, not just in docs.
- The API suite is now fully green again after fixing real backend query-pattern issues in training and earlier validation issues in seed/test setup.
- The top operational screens are less stacked and more preview-first, but the app is not fully decluttered yet.
- Training is on a cleaner source-of-truth path now, but it is still not a fully mature enablement system.
- Hybrid and fallback logic still exists in high-trust areas and is now labeled more honestly instead of being allowed to read as "fully live."

## What was actually fixed

### Reproducibility and truthfulness
- Fixed repeated demo-tenant duplication during reseed in `packages/api/scripts/seed.ts`.
- Fixed API test-state drift in:
  - `packages/api/tests/shootsCrud.test.ts`
  - `packages/api/tests/alerts.test.ts`
  - `packages/api/tests/outlookIntegration.test.ts`
  - `packages/api/tests/schedule.test.ts`
  - `packages/api/tests/schedulingAttendance.test.ts`
  - `packages/api/tests/routePermissions.test.ts`
- Fixed same-client concurrent query usage in:
  - `packages/api/src/services/zendesk.ts`
  - `packages/api/src/services/training.ts`
- Result: API build and full API suite now run cleanly in a seeded repo state.

### Mock/demo leakage removed or isolated
- Removed the frontend Training page dependency on `packages/admin-web/src/services/mockTrainingServices.ts`.
- Added a backend-owned training catalog path:
  - `packages/api/src/services/training.ts`
  - `packages/api/src/routes/training.ts`
  - `packages/admin-web/src/services/trainingApi.ts`
- Reworded misleading mock language in `packages/admin-web/src/components/ShootDetailDrawer.tsx`.
- Removed demo shoot-code branching from `packages/api/src/services/homeDashboard.ts` weather/travel logic.

### UX cleanup and declutter
- Tightened the preview/detail primitive in `packages/admin-web/src/components/OperationalDetailSection.tsx`.
- Decluttered the top-level nav in `packages/admin-web/src/app.tsx`.
- Made the dashboard more preview-first in `packages/admin-web/src/pages/Dashboard.tsx`.
- Pushed schedule-side creation and coverage review behind explicit reveals in `packages/admin-web/src/pages/Scheduling.tsx`.
- Wrapped approval risk/control noise behind explicit reveal in `packages/admin-web/src/pages/Approvals.tsx`.
- Updated the main operations regression test to prove the collapsed-detail model instead of relying on old always-open screen behavior:
  - `packages/admin-web/src/test/operationsPages.test.tsx`

## Repo/reproducibility issues found

### Fixed in this pass
- `db:seed` was not honestly idempotent because duplicate "Demo Studio" tenants could accumulate. This is fixed in `packages/api/scripts/seed.ts`.
- The full API suite was not honestly green because training used concurrent queries on one PostgreSQL client, which produced timeouts under full-suite pressure. This is fixed in `packages/api/src/services/training.ts`.
- The admin-web Training page was presenting richer content through a deleted mock service. That source split is reduced by moving the page to the backend-owned training catalog API.

### Still present after this pass
- The API suite still emits `pg` deprecation warnings about concurrent queries somewhere else in the codebase.
- The current likely remaining sources are in:
  - `packages/api/src/services/approvalRouting.ts`
  - `packages/api/src/services/schedule.ts`
  - `packages/api/src/services/scheduleStaffing.ts`
  - `packages/api/src/services/scheduling.ts`
  - `packages/api/src/services/securityApprovals.ts`
- Browser auth is still hybrid. Cookie/CSRF support exists, but the frontend still carries token/local storage behavior in `packages/admin-web/src/app.tsx` and related auth flow.

## Test-state issues found
- Earlier "green" states were too easy to over-credit because they were sensitive to seed drift and same-client query timing.
- The honest fixes in this pass were:
  - make seed reuse the same demo tenant
  - remove single-client `Promise.all` query patterns where they were directly breaking validation
  - adjust tests only where the product behavior changed legitimately

## Mock/demo leakage removed or isolated
- Training no longer reads its core catalog from a frontend mock service.
- Shoot detail now says "local fallback data until the live feeds are connected" instead of pretending fully live external context.
- Home dashboard weather/travel no longer keys off hardcoded demo shoot codes.

## Screens decluttered

### Dashboard
- File: `packages/admin-web/src/pages/Dashboard.tsx`
- Change:
  - Home pulse remains primary.
  - leadership readiness and staffing command are now secondary queues inside explicit expandable sections.
- Effect:
  - less vertical sprawl
  - clearer above-the-fold priority

### Scheduling
- File: `packages/admin-web/src/pages/Scheduling.tsx`
- Change:
  - "Create Records" and "Coverage Requests" are now explicit detail sections.
  - the board and staffing remain the center of gravity.
- Effect:
  - less mixed workflow burden on the main schedule surface

### Approvals
- File: `packages/admin-web/src/pages/Approvals.tsx`
- Change:
  - risk/control noise is grouped under "Operational Risk And Controls"
  - some always-open detail sections were closed by default
- Effect:
  - approval actions stay primary
  - sync/audit/control noise stops competing with core approval work

### Navigation
- File: `packages/admin-web/src/app.tsx`
- Change:
  - primary vs utility nav split
  - employee-limited mode gets a smaller top-level surface
- Effect:
  - less top-level clutter
  - clearer operational IA

## Preview/detail improvements implemented
- Primitive tightened in `packages/admin-web/src/components/OperationalDetailSection.tsx`.
- Verified in regression coverage through `packages/admin-web/src/test/operationsPages.test.tsx`.
- Applied materially on:
  - `packages/admin-web/src/pages/Dashboard.tsx`
  - `packages/admin-web/src/pages/Scheduling.tsx`
  - `packages/admin-web/src/pages/Approvals.tsx`

## Training source-of-truth issues that remain
- Backend now owns workbook/catalog shape, but the catalog is still thin relative to the page ambition.
- Training is still not strong enough in:
  - SOP depth
  - playbook depth
  - role-specific enablement paths
  - acknowledgements/sign-offs as real operational gates
  - job/location-specific prep
- The page is more honest now, but still ahead of its durable content model.

## What still needs a later pass
- Finish removing remaining same-client concurrent-query patterns causing `pg` warnings.
- Decide the real browser auth target and stop carrying hybrid token/session ambiguity.
- Continue decluttering:
  - `packages/admin-web/src/pages/Attendance.tsx`
  - `packages/admin-web/src/pages/Labor.tsx`
  - possibly `packages/admin-web/src/pages/CustomerService.tsx`
- Replace remaining high-trust fallback adapters in `packages/admin-web/src/components/ShootDetailDrawer.tsx`.
- Mature the backend-owned Training catalog into a real enablement system instead of a cleaner quiz/readiness shell.
