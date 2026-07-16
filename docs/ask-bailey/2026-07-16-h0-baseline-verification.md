# Ask Bailey — H0 Baseline Verification and Handoff (2026-07-16)

Charter mission H0: prove the actual current state, preserve the foundation, reconfirm regression signals, and hand off to H1. Verification-only — no feature work was performed in this run. `PUSH AUTHORIZED: NO` — nothing was pushed.

## Verified repository state

- Branch: `feature/work-spine-foundation-v1`, upstream `origin/feature/work-spine-foundation-v1`, **ahead 7 / behind 0**, worktree clean.
- HEAD: `1a97a1d` — identical to the reported baseline; no drift, no post-169 migrations, no concurrent/untracked files to classify.
- All seven Ask Bailey commits reachable in order, unrebased, unsquashed: `a2c0923`, `5e13631`, `52588db`, `09f6e48`, `cfa55b3`, `d627c10`, `1a97a1d`.
- Remote ref still at `c2aa9e5` → the seven commits remain **local-only** (plus the backup bundle below).

## Preservation

- Backup bundle created and verified complete: `C:\Dev\backups\ask-bailey-baseline-1a97a1d-2026-07-16.bundle` (full history to `1a97a1d`; restore via `git fetch <bundle> feature/work-spine-foundation-v1`).
- Recommended durable action: push the branch in a run where the prompt's first line is explicitly `PUSH AUTHORIZED: YES` (no force push; plain `git push origin feature/work-spine-foundation-v1`).

## Schema and architecture verification (from code + live DB)

- Migration head is `169_ask_bailey_knowledge_foundation.sql`, recorded applied in `app_migration`; `npm run migrate` reports nothing pending; no duplicate/replacement migration exists.
- All 11 knowledge/ai tables have **FORCE RLS** (verified via `pg_class.relforcerowsecurity`).
- Invariants confirmed present in current code: `buildVersionEligibilitySql` + `SEGMENT_ELIGIBILITY_SQL` composed inside the retrieval SQL (authorization-before-retrieval); citation validation against the retrieved set (`askBailey.ts` — invented ids stripped); `TranscriptionProvider` / `LanguageModelProvider` / `EmbeddingProvider` interfaces; `/api/knowledge` + `/api/ask-bailey` mounted; `#ask-bailey` and `#knowledge/review` registered in navigation, permissions, and app render.
- Resource Library remains the canonical asset store (`knowledge_source.resource_library_item_id`); no duplicate spine exists.
- Demo state: 7 `[DEMO]` sources, 12 segments, 1 open conflict. `npm run ask-bailey:seed-demo` re-run proved idempotency (0 created / 7 skipped / segments unchanged / no duplicate conflict).

## Test and runtime baseline (all run 2026-07-16 at `1a97a1d`)

| Check | Command | Result |
| --- | --- | --- |
| Narrow API | `npm run test -- askBailey.test.ts knowledgeGovernance.test.ts knowledgeIngestion.test.ts knowledgeReview.test.ts` | 47/47 |
| Narrow admin-web | `npx vitest run src/test/askBaileyPage.test.tsx src/test/knowledgeReviewPage.test.tsx --maxWorkers 1` | 17/17 |
| Typecheck api | `npx tsc --noEmit` | clean |
| Typecheck admin-web | `npx tsc --noEmit` | clean |
| Migrations | `npm run migrate` | nothing pending |
| Demo seed idempotency | `npm run ask-bailey:seed-demo` | 0 created / 7 skipped |
| Full API (official runner) | `npm run test` (run-vitest-chunks, serial) | 200/200 files PASS |
| Full admin-web (official runner) | `npm run test` (vitest --maxWorkers 1) | 645/645 tests, 114 files |

Authenticated verification against the live API (:4000) and browser (:5174), all nine trust paths re-proven: supported answer with citations; every citation maps to a stored segment; **exact timestamp** (`start_seconds=402` → `…mp4#t=402`); source-conflict state with owners; honest no-answer (+ unresolved-question row); restricted-source exclusion (associate `no_approved_answer` / leadership supported with the confidential citation); planning-mode future-design disclaimer; feedback stored (201); reviewer gating (associate 403 / leadership 200, and the browser route guard bounces non-leadership from `#knowledge/review`). Browser leg: real login page → dev-login → `#ask-bailey` deep link renders after refresh → supported answer with source cards.

## Provider modes (current)

- Language model: `deterministic` extractive (default). `openai_compatible` selection reports an honest `provider_unavailable` — the HTTP client is **not implemented**; no live external provider was exercised.
- Transcription: `deterministic` timed-script parser. No hosted transcription connected.
- Embeddings: interface seam only.

## Drift observations (recorded, not "fixed" — H0 makes no design changes)

1. **Retrieval recall note:** the broad demo question "What do I do if the tether feed drops during a session?" now cites only the two SOP sections; the training-video intro segment is filtered by the ≥2-matched-terms precision guard (added in `cfa55b3`). A video-targeted phrasing ("tether cable seating check from the training video") retrieves the video with the exact stored timestamp. Precision guard behaving as designed; recall on paraphrase is exactly the H1 problem.
2. Environmental only: Docker Desktop had stopped between sessions (restarted; containers healthy); the dev preview server needed a fresh start. No repository impact.

## Known gaps (unchanged from the Phase A–E report)

Hosted `openai_compatible` client; embeddings/semantic retrieval; real transcription; contextual drawer; transcript-classification editing UI; approved Bailey image; real production training content; `access_limited` status reserved but unused.

## Demo instructions

`cd packages/api && npm run ask-bailey:seed-demo`, then `#ask-bailey` — full script in `2026-07-13-ask-bailey-operations.md` §3.

## Safe starting point for H1

Start from `1a97a1d` on `feature/work-spine-foundation-v1` (or its pushed equivalent once authorized). The retrieval entry point to extend is `retrieveSegments` + `questionToSearchQuery` in `packages/api/src/services/ai/askBailey.ts`; the eligibility predicate in `knowledgeGovernance.ts` must remain inside every retrieval path (lexical, vector, or hybrid). The drift observation above is the first evaluation case H1 should encode.
