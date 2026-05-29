# Prompt 4: Mobile Operational Upload Flow Handoff

## What changed

Mission Control now has a mobile-only upload workflow for operational prep media.

This flow is designed for:

- setup photos
- location reference material
- QR/job documents
- other internal prep assets tied to a `Shoot`, `Location`, or `Organization`

It does **not** add a general desktop upload manager in Phase 1.

## Product behavior

Mobile users can now upload from the field through the mobile app:

- `Upload Photo to Job`
- `Upload to Location`
- `Upload to Organization`

Supported in this pass:

- camera capture
- photo library / camera roll
- document picker for PDF and image files

Supported file types:

- JPEG / JPG
- PNG
- HEIC
- PDF

Optional short video support was intentionally not added in this pass.

## Access rules

Allowed uploaders:

- photographers
- senior photographers
- leadership

Leadership uploads:

- are approved immediately
- remain fully visible in the `Resource Library`

Field uploads:

- are accepted from mobile
- default to `pending_review`
- stay in `photographer_prep` visibility scope
- are available to leadership immediately
- are not automatically visible back to photographers until approved

Senior coverage shifts now surface a clear requirement reminder in the mobile UI:

- setup photo context is expected
- missing uploads do not block clock-out
- this pass only handles capture and submission, not enforcement at clock-out

## Canonical API changes

New route:

- `POST /api/resource-library/items`

This writes directly into canonical `resource_library_item` records instead of creating another attachment system.

Request supports:

- `target_type`
  - `shoot`
  - `location`
  - `organization`
- `target_id`
- `linked_shoot_id`
- `storage_key`
- `file_name`
- `content_type`
- `file_size_bytes`
- `captured_at`
- `category`
- `note`
- `issue_type`
- `important_for_next_year`
- `upload_source`
- `gps_lat`
- `gps_lng`
- `url`

## Metadata now stored

`resource_library_item` now stores:

- `upload_source`
  - `mobile_camera`
  - `mobile_library`
  - `mobile_document`
  - `web_upload`
  - `system_migration`
- `gps_lat`
- `gps_lng`

`file_name` continues to represent the original user-facing filename when available.

## Linked-record integrity rules

`Shoot` uploads:

- use the selected `Shoot` as the primary anchor
- inherit linked `Organization` and `Location`

`Location` uploads:

- leadership can upload directly
- field users must keep the upload tied to an accessible `Shoot`
- the linked `Shoot` must actually belong to that `Location`

`Organization` uploads:

- leadership can upload directly
- field users must keep the upload tied to an accessible `Shoot`
- the linked `Shoot` must actually belong to that `Organization`

This prevents field users from uploading prep material into unrelated records.

## Mobile UX behavior

The mobile flow lives in the field `Shoot` screen.

For each published shift tied to a `Shoot`, the mobile UI now exposes:

- `Upload Photo to Job`
- `Upload to Location`
- `Upload to Organization`

The upload composer:

- loads linked `Shoot` / `Location` / `Organization` context
- shows recent prep highlights from the `Resource Library`
- lets the user choose:
  - camera
  - photo library
  - document picker
- requires category tagging
- supports:
  - optional note
  - optional issue flag
  - optional `important for next year`

The interaction is intentionally compact and mobile-first.

## Default tagging behavior

Default category selection is biased toward the likely field use:

- `Shoot` image upload → `Setup Photo`
- `Location` image upload → `Location Reference`
- document upload → `QR Code / Job Document`

Users can still override the category before submit.

## Best Reference behavior

`important for next year` maps to `Best Reference`.

This pass enforces the current Phase 1 rule:

- max `3` `Best Reference` images per category per selected record context

If the cap is already reached, the API rejects the upload instead of silently overfilling the category.

## Storage behavior

The mobile client now:

1. requests a managed upload presign from `/api/uploads/presign`
2. uploads the file to managed storage
3. creates the canonical `Resource Library` record through `/api/resource-library/items`

The presign response now also includes `object_url` so the uploaded item remains visible in the `Resource Library` without inventing a second storage contract.

## Employee shift detail changes

The employee `My Work` shift detail now includes linked record context:

- `Shoot`
- `Location`
- `Organization`

That gives the mobile upload flow a clean canonical anchor without hardcoding guesswork.

## Files changed

Backend:

- `db/migrations/031_resource_library_mobile_upload_metadata.sql`
- `packages/api/src/app.ts`
- `packages/api/src/routes/resourceLibrary.ts`
- `packages/api/src/services/resourceLibrary.ts`
- `packages/api/src/services/resourceLibraryUploads.ts`
- `packages/api/src/services/s3.ts`
- `packages/api/src/services/uploads.ts`
- `packages/api/src/services/locations.ts`
- `packages/api/src/services/employeeExperience.ts`
- `packages/api/src/types/resourceLibrary.ts`
- `packages/api/tests/resourceLibraryUploads.test.ts`

Mobile:

- `packages/mobile/package.json`
- `packages/mobile/src/components/OperationalUploadModal.tsx`
- `packages/mobile/src/resourceUploads.ts`
- `packages/mobile/src/screens/Shoot.tsx`

## Validation

Validated in repo:

- `npm run db:migrate`
- `npm run build -w packages/api`
- `npm run test -w packages/api`
- `npm run test -w packages/admin-web`
- `npm run build -w packages/admin-web`
- `npx tsc -p packages/mobile/tsconfig.json --noEmit`

Passing state after this prompt:

- API: `28 files / 134 tests`
- admin-web: `6 files / 24 tests`
- mobile TypeScript: passing

## Intentional Phase 1 limits

Not built in this pass:

- desktop upload authoring UI
- short video capture/upload
- offline binary upload queueing
- approval review UI for pending mobile uploads
- richer mobile browsing of the full `Resource Library`

Those remain later passes. This prompt establishes the canonical mobile capture path first.
