# Ask Bailey H5 — Knowledge Operations and Authoring — Final Report

**Date:** 2026-07-16
**Branch:** `feature/work-spine-foundation-v1`
**Verdict:** `H5 PASS`

Charter mission H5: build the governed human workflow so authorized knowledge
owners can create, upload, inspect, classify, revise, approve, supersede,
retire, search, and resolve company knowledge through the UI without direct DB
manipulation — while preserving every prior-phase trust control. The
non-negotiable version rule (approved content is never edited in place; a
material change is a governed new version; the existing approved version keeps
answering until the replacement is approved and supersedes it) is the spine of
this phase.

---

## 1. Branch and upstream
- Branch: `feature/work-spine-foundation-v1`
- Upstream: `origin/feature/work-spine-foundation-v1`

## 2. HEAD before and after
- Before H5: `55c3545` (H4 docs commit)
- After H5: `875bdc0` (H5 frontend), on top of `f36a125` (H5 backend)

## 3. Working-tree state before and after
- Before: clean at `55c3545`.
- After the two H5 commits: clean (verification scripts were scratch files,
  never staged, and removed).

## 4. Ahead/behind state
- Immediately before preservation: ahead 3, behind 0 versus
  `origin/feature/work-spine-foundation-v1` (`55c3545`).
- The three ahead commits are exactly the H5 backend, frontend, and this report.

## 5. Push status
- All three H5 commits were preserved together via a single normal non-force
  fast-forward push during the H6–H9 autopilot starting gate. Remote advanced
  from `55c3545` (the H4 baseline) to this report commit; no history was
  rewritten.

## 6. Commits created, in order
1. `f36a125` — feat: knowledge authoring backend — governed revisions, workspace, health (H5)
2. `875bdc0` — feat: knowledge operations desk — workspace, dual-mode source detail, governed authoring UI (H5)
3. `519e0bd` — docs: H5 knowledge operations final report (PASS)

## 7. Files changed by slice

### Slice 1 — Backend (committed `f36a125`)
- `packages/api/src/services/knowledge/knowledgeAuthoring.ts` (new) — the H5
  service surface: `createKnowledgeSourceVersion` (governed revision; refuses a
  second in-flight revision with 409; supersession deferred to approval),
  `updateDraftVersion` (edits draft/rejected only; 409 on approved),
  `updateKnowledgeSourceMeta`, `listKnowledgeSources` (reviewer-only,
  search/status/authority/mode filters, honest total),
  `getKnowledgeSourceDetail` (dual-mode: reviewer governance record vs
  eligibility-gated employee view; confidential/ineligible → opaque 404),
  `convertUnresolvedQuestionToDraft`, `splitSegment` / `mergeSegmentWithNext`
  (never invent timestamps; ordinal repair), `getKnowledgeHealth`.
- `packages/api/src/services/knowledge/knowledgeGovernance.ts` — synonym cycle
  guard in `upsertKnowledgeSynonym` (self-expansion + one-level circular → 400).
- `packages/api/src/routes/knowledge.ts` — H5 routes (all reviewer-gated in the
  service layer): `GET/PATCH /sources`, `GET /sources/:id`,
  `POST /sources/:id/versions`, `PATCH /versions/:id`,
  `POST /unresolved-questions/:id/convert`, `POST /segments/:id/split`,
  `POST /segments/:id/merge-next`, `GET /health`, `GET /synonyms/preview`.
- `packages/api/tests/knowledgeAuthoring.test.ts` (new) — 8 tests.

### Slice 2 — Frontend (committed `875bdc0`)
- `packages/admin-web/src/services/knowledgeAuthoringApi.ts` (new) — typed client;
  `SourceDetail = ReviewerSourceDetail | EmployeeSourceDetail` discriminated by `mode`.
- `packages/admin-web/src/pages/KnowledgeSources.tsx` (new) — reviewer workspace:
  health strip, filterable/paginated source list, inline draft creator, health
  details, embedded synonym manager (duplicate detection + normalization preview).
- `packages/admin-web/src/pages/KnowledgeSourceDetail.tsx` (new) — dual-mode
  detail page: employee read-only view; reviewer governance with versions,
  supersession, transcript segments (classify/split/merge), ingestion/embedding
  health, conflicts, reports, approvals, audit. Approved versions have no editor.
- `packages/admin-web/src/components/askBailey/AskBaileyConversation.tsx` — source
  cards now link to `#knowledge/sources/:id`.
- `packages/admin-web/src/pages/KnowledgeReview.tsx` — convert-unresolved-question
  → draft guidance action.
- `packages/admin-web/src/navigation.ts`, `permissions.ts`, `app.tsx` — four-point
  registration for `#knowledge/sources` (reviewer-gated) and
  `#knowledge/sources/:id` (open route; server enforces eligibility).
- `packages/admin-web/src/test/knowledgeAuthoringPages.test.tsx` (new) — 9 tests.

## 8. Migrations and configuration changes
- None. H5 reused the existing Ask Bailey schema (migrations ≤ 172). No new
  migration and no config change were required.

## 9. Reused canonical systems
- Resource Library asset linkage, `knowledge_source`/`_version`/`_segment`,
  `ai_unresolved_question`, `knowledge_synonym`, the existing review workflow
  (`approveKnowledgeVersion`, `rejectVersion`, `retireVersion`,
  `getVersionTranscript`, `correctSegment`), `withClientTransaction` /
  `connectGuardedClient`, `requireKnowledgeReviewer`, the four-point admin-web
  route/permission convention, and the shared audit table.

## 10. Behavior implemented
Governed authoring desk: create/inspect/classify/revise/approve/supersede/
retire/search/resolve knowledge through the UI. The version rule is enforced in
SQL and proven live. Dual-mode source detail sits behind Ask Bailey source
cards. Unresolved questions convert to draft guidance. Synonyms have a cycle
guard, duplicate detection, and a normalization preview. Segment split/merge
never fabricates timestamps. Knowledge-health is a descriptive read model.

## 11. Authorization and security controls
- Every H5 read/write path is reviewer-gated in the service layer
  (`requireKnowledgeReviewer`), never by hiding UI.
- The dual-mode detail route is deliberately open on the client; the **server**
  decides employee vs reviewer and answers an **opaque 404** for confidential
  or ineligible sources — proven live for an associate against the confidential
  pricing source.
- Employee mode never returns `inline_body` — proven live.
- Reviewer-only endpoints (list, health, synonym preview) return 403 to a
  standard employee — proven live.

## 12. Exact tests and commands run
- `npx tsc --noEmit -p tsconfig.json` in both packages.
- `npx vitest run src/test/knowledgeAuthoringPages.test.tsx` (admin-web).
- `npm run test` (admin-web full), `npm run test` (api full).
- Authenticated live API verification via dev-login on a private port-4100
  instance against the seeded `pmc` database (reviewer `leadership@example.com`,
  employee `associate@example.com`).

## 13. Test, typecheck, build, and evaluation results
- API typecheck: PASS. Admin-web typecheck: PASS.
- API full suite: **204 files passing, 0 failed** (includes
  `knowledgeAuthoring.test.ts`, 8 tests).
- Admin-web full suite: **665 tests passing across 116 files** (includes the 9
  new H5 page tests).

## 14. Authenticated browser/API verification performed
Live, authenticated, against real seeded data:
1. Reviewer source list → 200, total 7, confidential source visible to reviewer.
2. Employee source list → **403** (reviewer-only).
3. Reviewer confidential detail → 200, reviewer mode with versions.
4. Employee confidential detail → **opaque 404** (core invariant).
5. Employee approved-SOP detail → 200, employee mode, 3 segments, **no
   `inline_body` leak**.
6. Reviewer health → 200 with counts (6 approved, 1 conflict, 2 open questions).
7. Employee health → **403**.
8. Synonym preview (reviewer) → 200.
9. Employee synonym preview → **403**.
Version rule (write paths):
- A. Approved v1 is current.
- B. Employee create-revision → **403**.
- C. Reviewer create-revision → 201, new **draft v2**.
- D. Approved v1 unchanged; current still approved; draft supersedes approved.
- E. Second concurrent revision → **409**.
- F. Edit approved version in place → **409**.
- G. Edit draft → 200.
- H. Ask Bailey still answers (200) and does **not** cite the draft
  (approval-before-instruction holds).
The verification draft was removed afterward to keep the demo baseline pristine.

## 15. Whether any live external provider was actually exercised
No. Verification used the deterministic providers through the real application
path. No hosted LLM/embedding/transcription provider was called.

## 16. Demo fixtures versus real production behavior
Verification ran against the `[DEMO]`-labelled seed corpus in `pmc`. All demo
sources carry the `[DEMO]` prefix; none were mutated permanently. No real
company content was ingested in this phase.

## 17. Known limitations and risks not hidden
- Live verification exercised the API vertical and the admin-web route/render/
  gate logic via component tests; a full end-to-end click-through in the
  authenticated Mission Control shell was not scripted (dev-login + full shell
  auth is heavy). The route resolution, access gate, and page rendering are
  covered by `knowledgeAuthoringPages.test.tsx`.
- Synonym preview normalization currently returns lowercased terms without an
  applied synonym expansion when no matching synonym exists (0 synonyms seeded);
  the expansion path is covered by the backend test.

## 18. External configuration/content still required
- Approved real training/SOP content, an approved Bailey portrait, and hosted
  provider credentials remain outstanding (carried from prior phases).

## 19. Recommended next bounded prompt
H6 — Fall Field Coach role-based training pilot (per the H6–H9 autopilot).
