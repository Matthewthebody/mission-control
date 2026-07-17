# Ask Bailey H9 — Governed Organizational Learning & Bounded Actions — Final Report

**Date:** 2026-07-16
**Branch:** `feature/work-spine-foundation-v1`
**Verdict:** `PASS`

Charter mission H9: make Ask Bailey "living" in the safe sense — detect
knowledge gaps, propose improvements, and assist with narrowly bounded drafts
without silently changing policy or operational truth. Deterministic pilot
fixtures are used where real pilot data is absent.

---

## 1. Branch and upstream
- `feature/work-spine-foundation-v1` → `origin/feature/work-spine-foundation-v1`.

## 2. HEAD before and after
- Before H9: `798e29d` (H8). After H9: this commit.

## 3/4/5. Working tree / ahead-behind / push
- Clean; preserved via a normal non-force fast-forward push; 0/0 afterward.

## 6. Commits created, in order
1. (this commit) — feat: Ask Bailey governed learning + bounded assistive actions (H9)

## 7. Files changed by slice
- `db/migrations/175_ask_bailey_governed_learning.sql` (new) — `knowledge_improvement_proposal`, `ai_assistive_action` (FORCE RLS).
- `packages/api/src/services/ai/knowledgeLearning.ts` (new) — gap intelligence, proposal queue, bounded assistive action, learning-memory transparency.
- `packages/api/src/routes/askBailey.ts` — H9 routes.
- `packages/api/tests/askBaileyLearning.test.ts` (new) — 6 tests.

## 8. Migrations and configuration changes
- Migration 175. No config change.

## 9. Reused canonical systems
- `ai_unresolved_question`, `ai_message_feedback`, `knowledge_source_conflict`, `training_readiness_attempt`, `knowledge_source_version.review_due_at` (gap evidence); `askBailey` (grounded huddle draft); `postRecordThreadMessage` (the existing typed, permission-checked, audited write); the audit log; `requireKnowledgeReviewer`.

## 10. Behavior implemented
- **H9-A gap intelligence** (reviewer-only): recurring unanswered questions, reported outdated answers, conflicting sources, high readiness-miss topics, and source review dates at risk — each with evidence count, window, categories, an observation/inference label, a dedup key, and reviewable example refs. No employee identities in aggregate.
- **H9-B proposal queue**: proposals generated from gaps stay `draft`; a human accepts or dismisses; dismissal preserves evidence; regeneration deduplicates (unique dedup_key on open drafts).
- **H9-D bounded assistive action** (pre-shoot huddle): previews a source-grounded draft, requires an explicit confirm that writes only through `postRecordThreadMessage` (existing typed API with its own permission check + audit), is duplicate-safe via a unique idempotency key, and can be cancelled while previewed (a confirmed action cannot be cancelled). No arbitrary DB/messaging/tool authority.
- **H9-E learning-memory transparency**: an employee sees exactly what is stored (assigned/completed training, topics to review), a plain-language statement that it is never used for discipline/ranking, an explicit `not_stored` list (no hidden profiles, inferred attributes, secret rankings, disciplinary recommendations, or employment decisions), and a correction path.

## 11. Authorization and security controls
- Gap intelligence + proposals: `requireKnowledgeReviewer` (employee → 403, proven).
- Learning memory + assistive actions: self / active membership; the assistive write inherits the record-thread permission check (a user without `job.read` on the target is refused — this is why the bounded-action test grants it explicitly).
- No inference becomes policy; every proposal and action is a draft/preview until a human acts.

## 12. Exact tests and commands run
- `npx tsc --noEmit -p tsconfig.json` (both packages).
- `npx vitest run tests/askBaileyLearning.test.ts` (6 tests).
- `npm run test` (both full suites).
- Live: gaps (reviewer 200 / employee 403), generate+dedup, draft-only proposals, learning memory transparency.

## 13. Test, typecheck, build, and evaluation results
- Both typechecks PASS. H9 tests 6/6. Full suites green at the committed tree.
- Live: 11 gaps (labelled), proposals generate then dedup to 0 new, all proposals draft, learning memory names `secret competence rankings` in `not_stored`.

## 14. Authenticated browser/API verification performed
- Gap intelligence reviewer-gated (employee 403); proposal generation + dedup; draft-only proposals; bounded action preview→confirm→duplicate-safe→cancel (via tests, posting a real record-thread message through the typed API); learning-memory transparency.

## 15. Whether any live external provider was actually exercised
No. Deterministic providers only; grounded huddle uses the deterministic extractive path.

## 16. Demo fixtures versus real production behavior
- Gap intelligence runs on real recorded signals in the seeded tenant. No real pilot outcomes are claimed; the huddle draft is grounded in the demo corpus.

## 17. Known limitations and risks not hidden
- One bounded action (pre-shoot huddle) is implemented end-to-end; the other action kinds are defined in the schema/enum as seams for later, clearly not yet wired.
- H9 surfaces are API-level with reviewer/employee gating; a reviewer gaps/proposals panel and an employee "what Bailey remembers" panel are the recommended next UI step (the observability page is the natural home).
- Expert-answer capture (H9-C) reuses H5's convert-unresolved-question-to-draft flow rather than a separate surface.

## 18. External configuration/content still required
- Real pilot evidence (accumulates once the H8 pilot runs); hosted provider credentials; approved Bailey portrait.

## 19. Recommended next bounded prompt
None — H9 is the final phase. Next human decisions: supply real pilot content + cohort (H8 blockers), then run the controlled pilot to accumulate real gap evidence.
