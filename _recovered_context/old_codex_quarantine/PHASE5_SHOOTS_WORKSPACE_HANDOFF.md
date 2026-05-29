# Phase 5: Shoots Workspace And Drill-In Repair

## Summary

Phase 5 turns the `Shoots` tab into a real leadership management queue instead of a flat table with weak drill-in behavior.

Leadership now gets:

- a queue-based shoot workspace organized by action needed
- meaningful status and next-action labeling on every shoot card
- a large shoot workspace overlay instead of a narrow or dead-end drawer
- one drill-in that keeps schedule, staffing, contacts, instructions, readiness, profitability, and travel context together

## Queue Structure

The `Shoots` page is now organized into five operational buckets:

- `Needs Staffing`
- `Needs Review`
- `Unscheduled`
- `Scheduled`
- `Completed / Archived`

Each queue section shows:

- section purpose
- item count
- compact operational cards
- empty state when no shoots fall into that bucket

Each shoot card now shows:

- category / department context
- status label
- timing and location summary
- owner / lead or contact context
- staffing and sync state chips
- warnings such as missing lead, sync review, attendance issues, staffing gaps, or profitability watch
- a clear `Next` action

## Drill-In Behavior

Clicking a shoot now opens a large workspace overlay instead of a dead-end card interaction.

The shoot workspace includes:

- summary header with queue state, category, status, priority, profitability, and sync context
- schedule overview
- staffing summary
- readiness watch
- embedded weather and travel context
- contact and location context
- instructions, products, equipment, and day-of notes through the shared briefing surface
- timeline and published staffing activity
- direct jump back to Scheduling

This replaces the old pattern where the Shoots surface felt like a shallow table and drill-in behavior depended on a narrower, more mock-like drawer.

## Dead-End Interaction Cleanup

- Removed the `Tap for the full shoot story` language from the legacy table component.
- Replaced the old flat shoot-list interaction with queue cards that always open a useful workspace.
- Removed the older mock-heavy shoot drill-in implementation in favor of the shared operational briefing/workspace model.

## Files Changed

- `packages/admin-web/src/pages/LiveShoots.tsx`
  - rebuilt the page into a queue-based operational workspace
- `packages/admin-web/src/components/ShootDetailDrawer.tsx`
  - replaced the old drill-in with a large workspace overlay
- `packages/admin-web/src/components/ShootsTable.tsx`
  - removed dead-end copy from the older table surface
- `packages/admin-web/src/styles.css`
  - added queue grid containment and reused the workspace overlay shell
- `packages/admin-web/src/test/operationsPages.test.tsx`
  - added regression coverage for the queue and workspace behavior

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

Phase 5 makes the `Shoots` tab honest and useful. The page now behaves like a leadership queue for scheduling follow-through instead of a placeholder list, and the drill-in pattern now feels like entering a real operational workspace with enough context to act.
