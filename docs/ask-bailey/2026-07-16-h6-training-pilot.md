# Ask Bailey H6 — Fall Field Coach Training Pilot — Final Report

**Date:** 2026-07-16
**Branch:** `feature/work-spine-foundation-v1`
**Verdict:** `PASS`

Charter mission H6: build the first Ask Bailey teaching experience — a governed,
source-backed Fall Field Coach training system for a small controlled pilot
cohort. AI-drafted content stays a draft until approved; training results support
coaching and content improvement, never discipline or hidden ranking.

---

## 1. Branch and upstream
- Branch `feature/work-spine-foundation-v1`; upstream `origin/feature/work-spine-foundation-v1`.

## 2. HEAD before and after
- Before H6: `340b083` (H5 report, the preserved H5 baseline).
- After H6: the H6 frontend + report commit on top of `96c4f53` (H6 backend).

## 3. Working-tree state before and after
- Before: clean at `340b083`. After the H6 commits: clean (verification scripts were scratch files, never staged, and removed).

## 4. Ahead/behind state
- H6 preserved via a normal non-force fast-forward push after the phase passed its gate; ahead/behind 0/0 versus the remote afterward.

## 5. Push status
- Pushed with a normal non-force push under the autopilot phase-boundary authorization.

## 6. Commits created, in order
1. `96c4f53` — feat: governed Fall Field Coach training backend (H6)
2. (this commit) — feat: Fall Field Coach training UI + H6 report (H6)

## 7. Files changed by slice

### Backend (`96c4f53`)
- `db/migrations/173_ask_bailey_training_pilot.sql` (new) — governed training schema.
- `packages/api/src/services/training/trainingLessons.ts` (new) — lesson governance, cohort, assignment, employee experience, readiness scoring, metrics.
- `packages/api/src/routes/training.ts` — H6 routes under `/api/training`.
- `packages/api/tests/trainingLessons.test.ts` (new) — 9 integration tests.

### Frontend (this commit)
- `packages/admin-web/src/services/trainingPilotApi.ts` (new) — typed client.
- `packages/admin-web/src/pages/MyTraining.tsx` (new) — employee learning experience.
- `packages/admin-web/src/pages/TrainingLessons.tsx` (new) — manager/owner desk.
- `packages/admin-web/src/navigation.ts`, `permissions.ts`, `app.tsx` — four-point registration for `#my-work/training` (employee) and `#training/lessons` (manager).
- `packages/admin-web/src/test/trainingPilotPages.test.tsx` (new) — 4 page tests.

## 8. Migrations and configuration changes
- Migration `173_ask_bailey_training_pilot.sql`: `training_lesson`, `training_lesson_version`, `training_lesson_section`, `training_lesson_question`, `training_pilot_cohort`, `training_pilot_cohort_member`, `training_lesson_assignment`, `training_lesson_progress`, `training_readiness_attempt`. All tenant FORCE RLS. No config change.

## 9. Reused canonical systems
- Ask Bailey knowledge governance (approved `knowledge_source_version` + `knowledge_segment` for source-backed sections; `buildProtectedMediaUrl` for timestamped clips), the migration-012 training-state authority model (`super_admin/leadership/director_admin` manage; employees self-only), `withClientTransaction`/`connectGuardedClient`, the shared audit log, and the four-point admin-web route convention.

## 10. Behavior implemented
Governed lesson authoring (draft → pending_review → approved → superseded/retired), source-backed sections with in-range video timestamps, readiness questions with a visible rubric, pilot cohorts (disabled by default, explicit membership), version-pinned assignments, the calm employee experience (read, acknowledge, readiness check with source-cited coaching), manager visibility, and aggregate pilot metrics.

## 11. Authorization and security controls
- Every authoring/assignment/metrics path is `requireTrainingManager`-gated in the service layer.
- Employees act only on their own assignments (cross-employee access → opaque 404).
- Employee lesson payloads never include the correct-answer rubric or explanations.
- Assignments pin an exact approved version; retiring/revising never changes an in-flight assignment.
- Pilot cohort gating: assigning through a disabled cohort or to a non-member is refused.
- Video-clip timestamps must sit inside the segment's real range (never invented).
- Every mutation is audited.

## 12. Exact tests and commands run
- `npx tsc --noEmit -p tsconfig.json` (both packages).
- `npx vitest run tests/trainingLessons.test.ts` (API, 9 tests).
- `npx vitest run src/test/trainingPilotPages.test.tsx` (admin-web, 4 tests).
- `npm run test` (both full suites).
- Live authenticated HTTP verification against the seeded `pmc` DB on a private port-4100 instance.

## 13. Test, typecheck, build, and evaluation results
- Both typechecks: PASS.
- H6 API tests: 9/9. H6 page tests: 4/4.
- Full suites green at the committed tree (see §14 push-time run).

## 14. Authenticated browser/API verification performed
Live end-to-end (manager `leadership@example.com`, employee `associate@example.com`):
1. Owner creates a draft lesson from an approved knowledge source version → 201.
2. Assign before approval → **409**.
3. Employee attempts to author → **403**.
4. Submit + approve → 200 (sets current version).
5. Assign approved lesson to the employee → 201.
6. Employee sees it in my-assignments.
7. Employee lesson payload questions carry **no correct flags**.
8. View section + acknowledge.
9. Wrong readiness answer → not passed; coaching cites review topic “Reset the feed”.
10. Correct answer → passed 100%; assignment status → completed (pass + acknowledgment).
11. Employee blocked from manager lessons and pilot metrics → **403/403**.
12. Assigning through a disabled cohort → **409**.
Demo verification records were removed afterward.

## 15. Whether any live external provider was actually exercised
No. Deterministic providers only; no hosted LLM/embedding/transcription call.

## 16. Demo fixtures versus real production behavior
All lessons/cohorts created here carry `is_demo = true` and a `[DEMO]` title; no real approved training content was authored. The real-content pilot corpus is H8 scope.

## 17. Known limitations and risks not hidden
- The manager create-lesson form supports one source-backed section and one readiness question inline; richer multi-section authoring uses the same API and is a UI expansion, not a backend gap.
- The AI-draft path is represented by the `ai_drafted` provenance flag (draft-only, human approval required); a hosted-LLM lesson drafter is deferred to the real-provider work.
- Full end-to-end was verified over the real authenticated API; the admin-web pages are covered by route/render/gate tests rather than a scripted full-shell click-through.

## 18. External configuration/content still required
- Approved real training content and videos, an approved Bailey portrait, and hosted provider credentials remain outstanding (H8 / provider work).

## 19. Recommended next bounded prompt
H7 — Production hardening (the strict continuation gate).
