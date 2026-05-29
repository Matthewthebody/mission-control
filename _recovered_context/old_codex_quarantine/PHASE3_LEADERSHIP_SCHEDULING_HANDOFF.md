# Phase 3 Leadership Scheduling And Staffing Handoff

## Summary

Phase 3 turns Scheduling into a real leadership shoot-planning workspace instead of a calendar plus sidecar forms.

Leadership can now:

- create a shoot with structured scheduling fields
- edit an existing shoot from the same workspace
- pull from saved locations and saved contact history
- generate staffing slots from required headcount
- transition into live staffing assignment once the shoot exists
- explicitly queue an Outlook push from the shoot workspace

## Where The Workflow Lives

- Primary page: `packages/admin-web/src/pages/Scheduling.tsx`
- Primary leadership workspace: `packages/admin-web/src/components/LeadershipShootWorkspace.tsx`
- Live staffing assignment: `packages/admin-web/src/components/ShootStaffingCommand.tsx`
- Shoot API client: `packages/admin-web/src/services/shootApi.ts`
- Backend shoot persistence: `packages/api/src/services/shoots.ts`
- Backend route surface: `packages/api/src/routes/shoots.ts`
- Schema migration: `db/migrations/027_phase3_leadership_scheduling.sql`

## What Changed

### Structured Shoot Create / Edit

The new workspace includes:

- shoot title / code
- category: Sports, Schools, Events, Studio
- date, showtime, start, end
- projected volume
- status
- saved location attach plus manual location fields
- primary and secondary contacts
- instructions, access, equipment, products, setup, and day-of notes
- priority
- big shoot override
- geofence radius

### Staffing Slot UI

Entering planned staff count and required lead coverage immediately creates slot previews.

- lead coverage slots are visually separated from standard photographer slots
- once the shoot is saved, the workspace swaps into the live `ShootStaffingCommand`
- staffing stays in the same operational rail instead of opening a disconnected tool

### Saved Structured Data

The workspace now loads:

- saved location catalog from `/api/locations`
- reusable contact presets from `/api/shoots/reference-data`

Contacts are derived from prior shoot contacts and location custodian records so leadership is not retyping the same people repeatedly.

### Outlook Sync

The workspace exposes sync state and an explicit `Queue Outlook Push` action after save.

Mission Control remains the operational source of truth. Outlook writeback is still explicit.

## Staffing Assignment Model

- Headcount drives the draft slot structure.
- Eligible staff remain photographer-designated roles such as associate photographers, senior photographers, lead photographers, and directors of photography.
- Live conflict / assignment handling still runs through the existing scheduling staffing service once a shoot record exists.
- Leadership can move from draft slot planning to actual assignment without leaving Scheduling.

## Classification And Color Coding

Shoot categories are now first-class scheduling inputs:

- `sports`
- `schools`
- `events`
- `studio`

Those categories now flow into schedule rendering and workspace styling so calendar / board surfaces can classify shoots more clearly.

Special logistics and equipment are also surfaced as operational flags in the workspace.

## Validation

Commands run:

- `npm run db:migrate`
- `npm run db:seed`
- `npm run build -w packages/api`
- `npm run build -w packages/admin-web`
- `npm run test -w packages/api -- tests/shootsCrud.test.ts`
- `npm run test -w packages/admin-web -- src/test/operationsPages.test.tsx`
- `npm run test -w packages/api`
- `npm run test -w packages/admin-web`

Results:

- API build passed
- Admin-web build passed
- Targeted shoot CRUD tests passed
- Targeted scheduling regression test passed
- Full API suite passed: `26 files / 125 tests`
- Full admin-web suite passed: `5 files / 21 tests`

## Validation Note

The API test runner now uses `--maxWorkers 1` in `packages/api/package.json`.

That change was intentional. The API suite uses a shared Postgres integration database and was not honestly parallel-safe under threaded execution. Serializing the suite removed false failures from deadlocks and made validation reproducible.
