# Prompt 3: Resource Library Handoff

## What changed

Mission Control now has a canonical `Resource Library` that lives inside the `Shoot` experience and is also visible from `Organization` and `Location`.

The library is structured for internal prep and operational readiness, not client delivery. It supports linked media, documents, historical prep references, and `Post-Shoot Evaluation` learnings with controlled metadata instead of loose attachments.

## Canonical model

New backend model:

- `resource_library_item`

Core fields:

- `organization_id`
- `location_id`
- `shoot_id`
- `uploader_user_id`
- `uploader_name`
- `resource_type`
- `category`
- `note`
- `issue_type`
- `approval_status`
- `visibility_scope`
- `is_best_reference`
- `file_name`
- `content_type`
- `file_size_bytes`
- `storage_key`
- `file_url`
- `captured_at`
- `source_record_type`
- `source_record_id`
- `created_at`
- `updated_at`

Controlled values:

- `resource_type`
  - `image`
  - `document`
  - `qr_code`
  - `video`
- `category`
  - `setup_photo`
  - `location_reference`
  - `prior_successful_example`
  - `product_example`
  - `issue_concern`
  - `equipment_setup_need`
  - `qr_code_job_document`
  - `misc_internal_reference`
- `approval_status`
  - `pending_review`
  - `approved`
  - `leadership_only`
- `visibility_scope`
  - `leadership_only`
  - `photographer_prep`

`Post-Shoot Evaluation` content is not stored as a fake file resource. It is surfaced in the same `Resource Library` experience as `Post-Shoot Learnings`.

## Linked behavior

The `Resource Library` now rolls up linked prep context by object:

- `Shoot`
  - direct `Shoot` resources
  - linked `Location` resources
  - linked `Organization` resources
- `Location`
  - direct `Location` resources
- `Organization`
  - direct `Organization` resources

This gives leadership and field staff one prep surface instead of forcing them to hop across disconnected attachments.

## Access rules

Leadership:

- can view all
- can download all
- can manage all visible library content
- sees all history indefinitely

Photographers / field users:

- see only approved prep materials
- do not get download access by default
- see the last 2 years of relevant materials
- still see `Best Reference` items even if older than 2 years

This is enforced in the API response shape:

- limited field view removes `download_url`
- field users only receive `approval_status = approved`
- field users only receive `visibility_scope = photographer_prep`

## Prep-first display behavior

The `Resource Library` is organized into:

- `Media`
- `Documents`
- `Historical References`
- `Post-Shoot Learnings`

The prep-first surface also exposes `prep_highlights`, which prioritizes:

1. `Best Reference`
2. prior successful examples
3. setup photos
4. product examples
5. QR/job documents
6. location references
7. equipment/setup needs
8. issue/concern items

That order is meant to answer: what does the team need before they leave for the job?

## Where it appears

Implemented surfaces:

- `Shoot` detail workspace
- `Organization` detail workspace
- `Location` detail workspace
- employee `My Work` shift detail

The employee view is intentionally narrower and prep-oriented.

## Source data and dual-write behavior

The library supports both direct library items and mirrored legacy operational uploads:

- `media_asset` attachments can mirror into `resource_library_item`
- `setup_photo_upload` now mirrors into `resource_library_item`
- seeded historical prep content is stored directly as `resource_library_item`

This keeps Phase 1 honest while preserving a clean canonical direction.

## Files changed

Primary backend:

- `db/migrations/030_resource_library_phase1.sql`
- `packages/api/src/types/resourceLibrary.ts`
- `packages/api/src/services/resourceLibrary.ts`
- `packages/api/src/services/uploads.ts`
- `packages/api/src/services/locations.ts`
- `packages/api/src/services/shoots.ts`
- `packages/api/src/services/organizations.ts`
- `packages/api/src/services/employeeExperience.ts`
- `packages/api/src/routes/media.ts`
- `packages/api/scripts/seed.ts`

Primary frontend:

- `packages/admin-web/src/types.ts`
- `packages/admin-web/src/components/ResourceLibraryPanel.tsx`
- `packages/admin-web/src/components/ShootDetailDrawer.tsx`
- `packages/admin-web/src/components/EmployeeShiftDetailPanel.tsx`
- `packages/admin-web/src/pages/Organizations.tsx`
- `packages/admin-web/src/pages/ShootLocations.tsx`
- `packages/admin-web/src/services/employeeExperience.ts`
- `packages/admin-web/src/styles.css`

Primary tests:

- `packages/api/tests/uploads.test.ts`
- `packages/api/tests/shootsCrud.test.ts`
- `packages/api/tests/organizationsDirectory.test.ts`
- `packages/api/tests/locations.test.ts`
- `packages/api/tests/employeeExperience.test.ts`
- `packages/admin-web/src/test/operationsPages.test.tsx`
- `packages/admin-web/src/test/organizationsPage.test.tsx`
- `packages/admin-web/src/test/myWorkPage.test.tsx`

## Validation

Validated in repo:

- `npm run build -w packages/api`
- `npm run test -w packages/api`
- `npm run test -w packages/admin-web`
- `npm run build -w packages/admin-web`

Current passing state:

- API: `27 files / 131 tests`
- admin-web: `6 files / 24 tests`

## Important follow-ups

Not built yet in Prompt 3:

- direct upload/manage UI inside the `Resource Library`
- approval workflow UI for pending prep materials
- `Best Reference` per-category cap enforcement UI
- `Recurring Location Intelligence` editor
- deeper document preview behavior
- short video upload UI

These now have a stable `Resource Library` model to build on.
