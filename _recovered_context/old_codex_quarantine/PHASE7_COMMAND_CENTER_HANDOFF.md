# Phase 7: Home / Operations Urgency Surfaces And Final Command-Center Polish

## What Changed

- Strengthened the home dashboard's `Today / 24-Hour Risk` layer so it no longer focuses only on shoots plus one weather item.
- Promoted same-day support, location, and labor risk into the `What's Happening Today` section using existing home dashboard data.
- Standardized those priority rows so every item now opens a meaningful drill-in surface.
- Tightened the supporting widget footprint so `Customer Service`, `Location Watchlist`, and `Today's Labor` read as compact operational signals instead of oversized secondary cards.
- Refined the shoot workspace top strip and actions so it feels more connected to the Operations area.

## Files Changed

- `packages/admin-web/src/components/HomePulseSurface.tsx`
  - Added a broader `Today / 24-Hour Risk` model.
  - Made same-day priority rows actionable for shoots, support, location, weather, and labor.
  - Added stronger Operations-facing actions from the shoot workspace.
  - Refined the profitability/travel labels in the shoot workspace.
- `packages/admin-web/src/styles.css`
  - Tightened supporting-card spacing and footprint.
  - Made the Heads Up and Business Pulse grids more adaptive to width.
  - Reduced vertical dominance of Business Pulse tiles.
  - Kept today's shoot list constrained to viewport height more cleanly.
- `packages/admin-web/src/test/operationsPages.test.tsx`
  - Added regression coverage for the new `Today / 24-Hour Risk` label.
  - Proved that a non-shoot same-day priority row opens a real detail surface.
  - Proved the shoot workspace now exposes explicit links back to `Shoots` and `Calendar`.

## Resulting Home Hierarchy

1. `Heads Up`
2. `Week at a Glance`
3. `What's Happening Today`
4. `Today's Shoots`
5. `Business Pulse`
6. Supporting widgets

This hierarchy already existed directionally. Phase 7 made it behave more honestly by pushing buried support and location risk into the same-day awareness layer instead of leaving them as lower-page summary cards.

## Drill-In Pattern

- `Heads Up` items open detail overlays or the shoot workspace.
- `What's Happening Today` rows now follow the same rule.
- `Today's Shoots` still opens the large shoot workspace.
- Weather and travel remain embedded in the shoot workspace through the shared briefing model instead of competing as a separate full-detail dashboard surface.

## Terminology / Presentation Cleanup

- `Today` was reframed to `Today / 24-Hour Risk` to make the purpose explicit.
- `Profitability` in the shoot workspace was clarified to `Profitability / Complexity`.
- `Travel Watch` in the workspace strip was clarified to `Weather / Travel`.

## What Improved

- Leadership can scan the first screen more quickly for what could break today.
- Customer service and location risk now appear in the same urgency layer as shoot execution instead of reading like disconnected mid-page widgets.
- The shoot workspace is more clearly tied back to the two real leadership tools: `Shoots` and `Operations Calendar`.
- Supporting widgets take less space while preserving drill-in access.

## What This Phase Did Not Pretend To Solve

- This did not add new backend urgency models.
- This did not redesign the Operations calendar again.
- This did not change routing or add new pages.
- This did not solve the existing Vite bundle-size warning.

## Validation

- `npm run test -w packages/admin-web` ✅
- `npm run build -w packages/admin-web` ✅

Known remaining warning:

- Vite still reports the existing chunk-size warning during admin-web build.
