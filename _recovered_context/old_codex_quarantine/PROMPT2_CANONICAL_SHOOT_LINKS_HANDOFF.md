# Prompt 2: Canonical Shoot Links Handoff

## Summary

Prompt 2 connected `Shoot` records to the canonical `Organization`, `Location`, and `Contact` directory so the scheduling system no longer relies on isolated freeform job context.

Each `Shoot` now supports:

- exactly one `Organization`
- exactly one `Location`
- exactly one primary `Contact`
- zero or more additional `Contact` records
- controlled `shoot_type` values aligned to the canonical account taxonomy

This prompt also updated the leadership scheduling workflow and the `Shoot` detail workspace so linked records are selected and rendered as first-class operational data instead of loose text fields.

## What Changed

### Schema and data model

- Added [029_canonical_shoot_directory_links.sql](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\db\migrations\029_canonical_shoot_directory_links.sql)
- Extended `shoot` with:
  - `organization_id`
  - `location_id`
  - `primary_contact_id`
  - `shoot_type`
  - `shoot_subtype`
  - `internal_notes`
  - `special_equipment_flag`
  - `additional_products_flag`
- Added `shoot_contact_link` with `primary` and `additional` contact roles
- Backfilled legacy demo data into canonical links where possible

### API and backend behavior

- Updated [shoots.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\shoots.ts)
  - validates canonical `Organization` / `Location` / `Contact` coherence on create and update
  - enforces a required primary `Contact`
  - syncs additional contacts through `shoot_contact_link`
  - keeps legacy mirrored display fields in sync for compatibility
  - returns enriched `Shoot` summaries with linked organization and contact data
- Updated [shoots.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\shoots.ts)
  - create/edit schema now accepts canonical linked ids and controlled `shoot_type`
- Updated [seed.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\scripts\seed.ts)
  - demo shoots now carry canonical `Organization`, `Location`, and `Contact` links

### Admin-web workflow and display

- Rebuilt [LeadershipShootWorkspace.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\components\LeadershipShootWorkspace.tsx)
  - search-first `Organization` selection
  - `Location` and `Contact` selection from the chosen `Organization`
  - required primary `Contact`
  - optional additional `Contact` selection
  - canonical `shoot_type` and linked-record save flow
- Updated [ShootDetailDrawer.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\components\ShootDetailDrawer.tsx)
  - shows `Organization`
  - shows `Location`
  - shows primary and additional `Contact` records
  - includes `Operational Notes`
  - scaffolds `Resource Library` and `Post-Shoot Evaluation` placeholders
- Updated [LiveShoots.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\pages\LiveShoots.tsx)
  - queue display/search now uses canonical organization/contact context
- Updated [shootHotSheet.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\services\shootHotSheet.ts)
  - canonical additional contacts now flow into the briefing model

## Canonical Behavior Now

### Create / edit flow

When leadership creates or edits a `Shoot`, the workflow now expects:

1. select `Organization`
2. select `Location` from that `Organization`
3. select one primary `Contact`
4. optionally add more `Contact` records
5. set `shoot_type`, timing, and notes

Freeform organization/location/contact typing is no longer the primary contract.

### Display behavior

`Shoot` records now read more like operational records tied to real entities:

- `Organization`
- `Location`
- `Primary Contact`
- `Additional Contacts`
- timing and notes

This is visible in both the leadership workspace and the `Shoot` drill-in.

## Validation

Commands run:

- `npm run db:migrate`
- `npm run db:seed`
- `npm run build -w packages/api`
- `npm run build -w packages/admin-web`
- `npm run test -w packages/api -- tests/shootsCrud.test.ts`
- `npm run test -w packages/admin-web -- src/test/operationsPages.test.tsx`
- `npm run test -w packages/api -- tests/schedule.test.ts`
- `npm run test -w packages/api -- tests/routePermissions.test.ts`
- `npm run test -w packages/api`
- `npm run test -w packages/admin-web`

Results:

- API build: passed
- Admin-web build: passed
- API tests: `27 files / 129 tests` passed
- Admin-web tests: `6 files / 24 tests` passed

## Real fixes made during validation

- Fixed the `Shoot` update path so `additional_contact_ids` is no longer incorrectly written to the `shoot` table directly. Additional contacts now remain a join-table concern in [shoots.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\shoots.ts).
- Updated older schedule and route-permission tests to create canonical linked `Shoot` records instead of relying on the removed freeform contract.
- Updated admin regression tests to assert the new canonical contact rendering inside the `Shoot` workspace.

## Known follow-ups

- `Resource Library` and `Post-Shoot Evaluation` are still placeholders inside the `Shoot` workspace in this prompt. They now have a stable place to attach later.
- The API suite still emits the existing `pg` concurrent-query deprecation warning during some tests. It does not block the suite, but it is still technical debt worth cleaning up.
- Admin-web still emits the existing Vite chunk-size warning during build.

## Reviewer focus

Validate these first:

- creating a `Shoot` now requires canonical `Organization`, `Location`, and primary `Contact`
- additional contacts save and render correctly
- schedule/workspace surfaces show canonical organization/contact context
- department-scoped shoot creation still respects role boundaries with the new canonical payload
- old dead-end freeform org/location/contact behavior is no longer the main path
