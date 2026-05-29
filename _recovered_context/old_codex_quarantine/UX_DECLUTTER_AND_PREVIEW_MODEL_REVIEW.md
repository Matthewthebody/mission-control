# UX Declutter And Preview Model Review

## Screens reviewed
- `packages/admin-web/src/pages/Dashboard.tsx`
- `packages/admin-web/src/pages/Scheduling.tsx`
- `packages/admin-web/src/pages/Approvals.tsx`
- `packages/admin-web/src/app.tsx`
- `packages/admin-web/src/components/OperationalDetailSection.tsx`
- `packages/admin-web/src/components/ShootDetailDrawer.tsx`

## Clutter problems found

### Dashboard
- Problem:
  - leadership readiness and staffing triage were competing with the home pulse on the same page.
- Fix:
  - moved them behind explicit detail sections under a secondary queue block.

### Scheduling
- Problem:
  - the screen was carrying scheduling, staffing, creation, trade review, and PTO review with too much equal weight.
- Fix:
  - creation and coverage review are now explicitly secondary to the board and staffing flow.

### Approvals
- Problem:
  - operational controls, sync failures, dangerous-action visibility, notifications, alerts, PTO, and trades were all trying to live at the same priority level.
- Fix:
  - risk/control content is now grouped behind a reveal and the always-open detail burden is reduced.

### Navigation
- Problem:
  - too many top-level tabs competed for primary attention.
- Fix:
  - split into primary and utility navigation, with a smaller employee-only top-level surface.

## Hierarchy problems found
- The app still tends to reward stacking more content instead of enforcing clear page budgets.
- Preview/detail was real in some areas, but not consistently enforced in the top screens.
- Some high-traffic screens still use "everything on one page" as the default tactic.

## Preview/detail inconsistencies found
- The model is now real in:
  - `Dashboard.tsx`
  - `Scheduling.tsx`
  - `Approvals.tsx`
- The reusable primitive is now more explicit in `OperationalDetailSection.tsx`.
- The regression test in `packages/admin-web/src/test/operationsPages.test.tsx` now proves collapsed detail state instead of relying on the old always-open dashboard.
- Still inconsistent:
  - `Attendance.tsx`
  - `Labor.tsx`
  - parts of `CustomerService.tsx`

## What changed

### `packages/admin-web/src/components/OperationalDetailSection.tsx`
- Added local open-state tracking and explicit `Expand` / `Collapse` affordance.
- This makes the preview/detail model visible, not implied.

### `packages/admin-web/src/pages/Dashboard.tsx`
- Home pulse stays primary.
- Secondary queues are now grouped and expandable.

### `packages/admin-web/src/pages/Scheduling.tsx`
- Board stays primary.
- creation and coverage queues are demoted to explicit reveals.

### `packages/admin-web/src/pages/Approvals.tsx`
- risk and control surfaces are grouped into one expandable unit.

### `packages/admin-web/src/app.tsx`
- Top-level nav is slimmer and clearer.

### `packages/admin-web/src/components/ShootDetailDrawer.tsx`
- Copy is less misleading about live vs fallback context.

## What still needs a later pass
- `Attendance.tsx` still exposes too much raw detail too early.
- `Labor.tsx` still reads more like an analytics page than a fast operations surface.
- `CustomerService.tsx` is useful but still dense.
- The app needs a clearer page-budget rule:
  - one primary workflow
  - one secondary queue block
  - everything else behind reveal or route split

## Overall UX verdict
- The product is less cluttered than it was before this pass.
- The preview/detail model is more real and more testable now.
- The app is not fully normalized yet, but the highest-traffic operational screens are materially cleaner.
