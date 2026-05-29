# Phase 1 Shell Stability And UX Cleanup Foundations

## What Was Stabilized

- The top Mission Control shell now uses hysteresis-based collapse logic instead of a single live threshold.
- Collapse and expand states are now intentionally separated so the header does not thrash near the scroll boundary.
- Brand copy in the shell now transitions out cleanly instead of disappearing abruptly.

## What Was Standardized

- Shared containment rules were tightened for:
  - metric pills and meta pills
  - preview cards
  - detail panels
  - business pulse tiles
  - heads-up cards
  - week and today rows
  - request, exception, and notification cards
  - schedule day and board columns
  - shoot briefing panels and metric rows
  - location stats/meta rows
  - drawer and overlay content
- Scheduling and Shoot Locations now both use the same compact `page intro + toolbar + summary strip + workspace` framing.

## Labels Cleaned Up

- No `PO` / `P0` label remains on the home dashboard surface.
- The test suite explicitly guards against that leakage.

## Key Files Changed

- `packages/admin-web/src/app.tsx`
- `packages/admin-web/src/styles.css`
- `packages/admin-web/src/test/appAuth.test.tsx`

## Validation

- `npm run test -w packages/admin-web`
  - Passed: `5 files / 21 tests`
- `npm run build -w packages/admin-web`
  - Passed
- Existing warning still present:
  - Vite chunk size warning during production build

## What This Phase Did Not Do

- It did not redesign schedule workflows.
- It did not change staffing logic.
- It did not broaden the product surface.
- It did not replace existing drill-in models beyond stabilizing the shared shell and containment behavior.

## Next-Phase Dependency

Phase 2 should inherit this shell as the stable baseline and focus on Operations information architecture and calendar usability, not re-open header behavior or broad containment fixes unless a newly introduced surface breaks them.
