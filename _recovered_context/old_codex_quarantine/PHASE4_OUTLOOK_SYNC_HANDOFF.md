# Phase 4: Outlook Sync Simplification and Trust Layer

## What Changed

- Mission Control calendar remains the primary scheduling workspace.
- Outlook is no longer presented as a peer calendar destination inside Operations.
- Scheduling now surfaces tenant-level Outlook sync trust directly in the main calendar experience.
- The standalone Outlook page was repositioned as a deeper integrity and repair surface instead of a second calendar product.

## Information Architecture Change

- `Calendar Sync` moved out of the `Operations` sub-navigation.
- `Calendar Sync` now lives under `Account`.
- Existing `#outlook` navigation remains valid for backward compatibility.

This keeps daily planning, staffing, and day review inside `Calendar`, while preserving access to deeper sync controls when leadership needs to verify or repair the Outlook link.

## How Sync Trust Is Surfaced In Calendar

The main Scheduling page now includes a `Calendar Sync Integrity` section above the calendar workspace. It shows:

- connection state
- health state
- connected account
- last successful sync
- last failed sync
- visible linked source calendars
- primary linked source calendar
- pending sync work
- failed or conflicted operations needing review

Leadership can also:

- run a manual sync from Scheduling
- jump directly into the deeper `Calendar Sync` page

## Deeper Outlook Surface

The standalone Outlook page still exists, but its role is narrower now:

- verify connection state
- manage linked calendar visibility
- review read-only preview data
- inspect sync runs and sync operations
- replay failed sync operations

Its copy was updated to make that purpose explicit. It is now an integrity/settings page, not a competing calendar workspace.

## Files Changed

- `packages/admin-web/src/app.tsx`
  - moved `outlook` out of Operations and into Account
  - renamed the visible label to `Calendar Sync`
- `packages/admin-web/src/pages/Scheduling.tsx`
  - added integrated Outlook trust/integrity loading
  - added manual sync action
  - added the `Calendar Sync Integrity` section
- `packages/admin-web/src/pages/OutlookIntegration.tsx`
  - renamed and reframed the page as a sync integrity surface
- `packages/admin-web/src/styles.css`
  - added shared layout styles for the new integrity section
- `packages/admin-web/src/test/operationsPages.test.tsx`
  - updated regression coverage for the new scheduling trust surface and renamed Outlook copy

## Validation

- `npm run test -w packages/admin-web` ✅
- `npm run build -w packages/admin-web` ✅

## Intentional Limits

- Outlook was not removed entirely, because leadership still needs a place to manage visibility, inspect sync operations, and recover failures.
- This pass did not broaden Outlook writeback behavior or create a new sync model. It only clarified where trust is surfaced and reduced IA redundancy.

## Reviewer Summary

Phase 4 makes the product more honest: there is now one primary calendar workspace, and Outlook is represented as a linked sync/integrity layer around it. Leadership can verify trust directly from Scheduling, while deeper Outlook controls remain available without competing for primary navigation weight.
