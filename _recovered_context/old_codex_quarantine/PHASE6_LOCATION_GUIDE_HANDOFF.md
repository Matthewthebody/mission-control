# Phase 6: Location Guide Refactor And Search-First Cleanup

## Summary

Phase 6 turns the Location Guide into a cleaner search-first operations tool instead of a long vertical stack with Monday coexistence noise mixed into the main workflow.

The guide now behaves like:

- search and filter on the left
- one active location detail workspace on the right
- structured detail panels instead of one long card stack
- legacy integration state hidden behind diagnostics instead of dominating the primary UX

## What Changed

### Search-First Guide Behavior

The left rail now works as a true result list:

- fast text filtering by location name, address, and saved setup context
- current filter count surfaced near the search controls
- visible result set stays aligned with the active detail panel
- if the current hash-selected location no longer matches the search, the detail panel follows the first visible result instead of showing stale detail

This fixes the prior mismatch where typing a location name could leave the right-hand detail panel anchored to the wrong record.

### Reduced Monday / Legacy Clutter

Legacy Monday state was removed from the main summary strip and from the primary result-card flags.

It now lives in a dedicated `Diagnostics` tab inside location detail, only for users who can see operational audit / review context.

The primary guide now focuses on:

- setup readiness
- access reliability
- field signal
- reference coverage
- notes, contacts, maps, and history

instead of migration messaging.

### Structured Detail Layout

Location detail no longer reads as one long scroll of cards.

The right-side workspace now uses explicit detail tabs:

- `Overview`
- `Setup`
- `History`
- `Updates`
- `Diagnostics` when legacy integration context exists and the user can review it

This keeps the guide useful under pressure while preserving the deeper detail when needed.

### Setup Readiness Containment

The setup/readiness area was tightened so summary cards and their chips wrap cleanly inside the location preview grid.

The detail surface now keeps readiness, photo coverage, and setup-area data in dedicated panels instead of letting those cards sprawl vertically.

## Files Changed

- `packages/admin-web/src/pages/ShootLocations.tsx`
  - refactored the guide into a search-first master/detail workspace
  - moved legacy integration detail into a diagnostics tab
  - added detail-tab structure for overview/setup/history/updates
  - fixed detail selection so it follows the visible search results
- `packages/admin-web/src/styles.css`
  - added search-summary styling
  - tightened location preview-card containment
  - added location detail tab layout support
- `packages/admin-web/src/test/operationsPages.test.tsx`
  - updated regression coverage for search-driven selection and diagnostics demotion

## Search And Detail Behavior

The main guide flow is now:

1. search or filter locations in the left rail
2. review the matching result list
3. click a result or let the first visible result stay active
4. use the right-hand workspace tabs to move between:
   - operational overview
   - setup reference
   - location history
   - new field updates
   - legacy diagnostics when needed

## Validation

Commands run:

- `npm run test -w packages/admin-web`
- `npm run build -w packages/admin-web`

Results:

- Admin-web tests passed: `5 files / 22 tests`
- Admin-web build passed

Known remaining warning:

- Vite still reports the existing chunk-size warning during `packages/admin-web` build

## Reviewer Summary

Phase 6 makes the Location Guide more honest and more useful. Search now actually drives the active detail view, the page is no longer led by migration messaging, and the detail surface now behaves like a real reference workspace instead of a long card stack that forces excessive scrolling.
