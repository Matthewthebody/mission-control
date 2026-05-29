# Prompt 6 Handoff: Resource Library Approval, Curation, and Recurring Prep Memory

## What is real now

Mission Control now has a real leadership review workflow on top of the shared `Resource Library`, instead of only storing approval metadata in the backend.

This pass added:

- a leadership-only `Resource Library` review endpoint
- admin-web approval and reclassification controls inside the shared `ResourceLibraryPanel`
- `Best Reference` curation controls with category selection
- explicit retention and visibility messaging in the UI
- a curation fix so `Rejected / Not Useful` items no longer surface in recurring prep-memory lanes

## Core reviewer path

1. Upload a `Setup Photo` or other operational media from the field.
2. Open the `Resource Library` from an `Organization` or `Location`.
3. Use `Approval Workflow` to set:
   - `Pending Review`
   - `Approved for Future Reference`
   - `Leadership Only`
   - `Rejected / Not Useful`
4. Optionally mark the item as:
   - `Best Reference Candidate`
   - `Best Reference`
   - one of the supported `Best Reference` categories
5. Confirm the item moves cleanly into recurring prep memory or out of it, depending on the review decision.

## Important behavior

- Leadership retains full history.
- Photographers still only see approved prep content from the last 2 years, plus older `Best Reference` items.
- Photographer download access remains off by default.
- `Rejected / Not Useful` items stay retained for leadership review history but are removed from prep-memory surfaces.
- `Best Reference` still enforces the existing cap of up to 3 curated items per category in the current prep scope.

## Highest-value files

- `packages/api/src/routes/resourceLibrary.ts`
- `packages/api/src/services/resourceLibrary.ts`
- `packages/api/tests/resourceLibraryCuration.test.ts`
- `packages/admin-web/src/components/ResourceLibraryPanel.tsx`
- `packages/admin-web/src/services/resourceLibraryApi.ts`
- `packages/admin-web/src/test/resourceLibraryPanel.test.tsx`

## Validation

- `npm run build -w packages/api`
- `npm run test -w packages/api -- tests/resourceLibraryCuration.test.ts tests/resourceLibraryUploads.test.ts`
- `npm run test -w packages/admin-web -- src/test/resourceLibraryPanel.test.tsx src/test/organizationsPage.test.tsx`
- `npm run build -w packages/admin-web`

## Honest remaining gaps

- Leadership review actions are wired in the shared admin-web `Organization` and `Location` resource-library surfaces, but not yet in every possible read-only `Shoot` drawer.
- There is still no separate curation command board; the workflow currently lives inside the shared `Resource Library` surface itself.
- Download prevention remains intentionally practical, not absolute. The system removes easy download paths for photographers and keeps access contextual, but it does not pretend to stop screenshots.
