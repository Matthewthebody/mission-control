# Prompt 1 Handoff: Canonical Organization, Contact, and Location Model

## Summary

Prompt 1 established the Phase 1 canonical directory foundation for:

- `Organization`
- `Contact`
- `Location`

The implementation is now search-first, permission-aware, and normalized for later linkage into `Shoot`, `Resource Library`, `Post-Shoot Evaluation`, and `Recurring Location Intelligence` workflows.

This pass intentionally avoids freeform client duplication by introducing:

- one canonical `Organization` record
- explicit `Organization` aliases
- canonical `Contact` records linked to an `Organization`
- canonical `Location` records stored on the existing location backbone and linked to an `Organization`

## What Changed

### Database and schema

- Added [028_canonical_organization_directory.sql](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\db\migrations\028_canonical_organization_directory.sql)
- New canonical tables:
  - `organization`
  - `organization_alias`
  - `organization_contact`
- Extended the existing `shoot_location` table so it can act as the Phase 1 canonical `Location` model with:
  - organization linkage
  - normalized address fields
  - maps-ready label
  - active status
  - creator/updater metadata

### Backend

- Added canonical types in [organizations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\types\organizations.ts)
- Added canonical directory service in [organizations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\organizations.ts)
- Added directory routes in [organizations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\organizations.ts)
- Mounted routes in [app.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts)
- Added office-role permission helper in [authority.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\authz\authority.ts)
- Updated shoot reference data in [shoots.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\shoots.ts) so canonical `Contact` records are available to later `Shoot` workflows

### Frontend

- Added directory page in [Organizations.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\pages\Organizations.tsx)
- Added directory API client in [organizationApi.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\services\organizationApi.ts)
- Added shared frontend types in [types.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\types.ts)
- Added frontend permission gating in [permissions.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\permissions.ts)
- Wired the directory page into the application shell in [app.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\app.tsx)

### Seed data

- Added canonical demo records and linking logic in [seed.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\scripts\seed.ts)

## Canonical Model

### Organization

Canonical record for the client or internal operating entity.

Key fields:

- `id`
- `canonical_name`
- `display_name`
- `account_type`
- `active_status`
- `notes`
- `created_by_user_id`
- `created_at`
- `updated_at`

Controlled `account_type` values:

- `schools_underclass_portraits`
- `schools_events`
- `sports`
- `events`
- `studio`
- `headshots`
- `commercial`
- `internal_jobs`

Duplicate resistance:

- alias table support
- normalized search matching before create
- likely existing matches shown in the create flow

### Contact

Canonical contact linked to one `Organization`.

Key fields:

- `id`
- `organization_id`
- `first_name`
- `last_name`
- `full_name`
- `title`
- `phone`
- `email`
- `photo_url`
- `active_status`
- `notes`
- `created_by_user_id`
- `created_at`
- `updated_at`

### Location

Canonical `Location` linked to one `Organization`.

Phase 1 intentionally uses the existing `shoot_location` table as the durable location backbone instead of creating a parallel location system.

Key fields:

- `id`
- `organization_id`
- `name`
- `address_line_1`
- `address_line_2`
- `city`
- `state`
- `zip`
- `maps_label`
- `maps_url`
- `notes`
- `active_status`
- `created_by_user_id`
- `updated_by_user_id`
- `created_at`
- `updated_at`

Phase 1 location map behavior:

- address display
- `Open In Maps`

No embedded map preview was added.

## Permissions

Can create `Organization`, `Contact`, and `Location`:

- `Leadership`
- `Schools department` office-role users
- `Sports department` office-role users
- `Customer service` office-role users

Can search, view, and select:

- all authenticated users

Cannot create:

- general field photographers and other non-authorized users unless they also hold one of the allowed office-role assignments

Current backend implementation maps this through authority tiers plus office-role profiles in [authority.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\authz\authority.ts).

## UX and Flow Behavior

### Search-first selection

The directory page is intentionally biased toward selection before creation:

- search query at the top
- filtered result list
- detail workspace for the selected record
- create flows show likely existing matches before submit

### Organization detail workspace

The detail workspace currently includes:

- `Organization Summary`
- `Contacts`
- `Locations`
- `Recent Shoots`
- `Resource Library`

`Recent Shoots` and `Resource Library` are scaffolded so later phases can plug into the canonical directory without renaming the object model again.

### Creation flows

Authorized users can:

- create an `Organization`
- create a `Contact` within an `Organization`
- create a `Location` within an `Organization`

All users can:

- search
- select
- view summary information
- view organization-linked contacts
- view organization-linked locations

## API Endpoints

- `GET /api/organizations`
- `POST /api/organizations`
- `GET /api/organizations/:id`
- `POST /api/organizations/:id/contacts`
- `POST /api/organizations/:id/locations`

## Validation

Ran successfully:

- `npm run db:migrate`
- `npm run db:seed`
- `npm run build -w packages/api`
- `npm run test -w packages/api`
- `npm run test -w packages/api -- tests/organizationsDirectory.test.ts`
- `npm run test -w packages/admin-web -- src/test/organizationsPage.test.tsx`
- `npm run test -w packages/admin-web`
- `npm run build -w packages/admin-web`

Validation result:

- API: `27 files / 129 tests` passing
- admin-web: passing

Known remaining warning:

- admin-web still reports the existing Vite chunk-size warning during build

## Reviewer Notes

What to validate manually:

- unauthorized users can search/view but cannot create
- office-role users can create all three canonical record types
- likely-match warnings appear before duplicate creation
- selecting an `Organization` shows linked `Contact` and `Location` data cleanly
- `Location` records open in maps correctly from the detail workspace
- shoot reference data now includes canonical `Contact` records for later `Shoot` assignment workflows

What this prompt deliberately did not solve:

- one-primary-contact-per-`Shoot` linkage
- `Resource Library` ingestion and organization
- `Best Reference`
- `Recurring Location Intelligence`
- editable `Shoot`-level contact assignment UX

Those are downstream features that now have a stable canonical directory to build on.
