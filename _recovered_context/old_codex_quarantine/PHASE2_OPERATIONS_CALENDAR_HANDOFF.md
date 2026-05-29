# Phase 2 Operations Calendar Handoff

## What Changed

Phase 2 refactored the Operations calendar surface into a more consistent leadership workspace instead of a mixed set of mode-specific behaviors.

The main changes are:

- `Today`, `3 Day`, `Week`, and `30 Day` now all use the same core interaction model:
  - preview-first day surfaces on the left
  - a `Day Briefing` workspace on the right
  - selected item detail inside the same briefing workspace
- `Today` no longer uses inline card expansion as a one-off behavior.
- `3 Day` now uses clearer day surfaces with compact summary metrics before the item list.
- `Week` now uses horizontal planning lanes with better use of width and less vertical page stacking.
- `30 Day` keeps the month grid, but its drill-in now uses the same `Day Briefing` model instead of a separate month-only detail pattern.
- right-side briefing panels now scroll intentionally inside the viewport instead of clipping awkwardly.

## How Each Mode Works Now

### Today

- one focused day surface for the active day
- summary-first header with shoot count, staffing watch count, and review flags
- item list stays on the left
- `Day Briefing` stays visible on the right
- clicking a shoot or event opens full detail in the briefing workspace instead of expanding inline

### 3 Day

- three clearly separated day surfaces
- each day surface shows:
  - day header
  - item count
  - compact summary metrics
  - compressed item list
- leadership can scan all three days quickly, then open the selected day and item in the briefing panel

### Week

- seven-day planning now favors width over stacked height
- the left side uses horizontally scrollable day lanes instead of trying to cram everything into narrow wrapped columns
- clicking a day or an item updates the same `Day Briefing` workspace

### 30 Day

- month grid remains the planning surface
- month cells now show count plus simple watch/review signals
- clicking a day opens the same `Day Briefing` pattern used elsewhere
- selected item detail stays inside that workspace, with better containment

## Standardized Day Briefing

`Day Briefing` is now the shared day-detail model for calendar views.

It includes:

- selected day header
- daily summary cards
- day queue
- selected shoot or event detail
- shoot integration detail when a shoot is selected

This is the main Phase 2 UX standardization.

## Files Changed

- `packages/admin-web/src/components/UnifiedScheduleSurface.tsx`
  - unified selection model across calendar modes
  - added day summaries
  - added shared `Day Briefing` behavior
  - removed `today` inline shoot expansion behavior
- `packages/admin-web/src/styles.css`
  - improved calendar mode layouts
  - added day surface styling
  - added day briefing queue and summary styling
  - fixed panel containment and internal scrolling
- `packages/admin-web/src/test/operationsPages.test.tsx`
  - added regression assertions for the new schedule surface language and day briefing presence

## Validation

- `npm run test -w packages/admin-web` ✅
- `npm run build -w packages/admin-web` ✅

Known remaining warning:

- Vite still reports the existing chunk-size warning during admin-web build.

## What This Phase Did Not Do

This phase did not change:

- staffing drawer business logic
- trade or PTO workflow structure
- Outlook sync rules
- schedule board grouping logic
- shoot detail drawer architecture

Those belong to later phases unless a bug forces earlier work.

## Reviewer Summary

Phase 2 made the Operations calendar more usable by eliminating the biggest mode inconsistency: `Today` no longer behaves differently from the rest of the calendar. The schedule surface now reads more like a real command workspace, with compact day previews on the left and one consistent `Day Briefing` workspace for drill-in on the right.
