# Ask Bailey — Operations, Configuration, and Demo Guide

Status: Phases A–E shipped 2026-07-13 (architecture record: `2026-07-13-ask-bailey-architecture.md`).
This document covers how to run, demo, configure, and extend the system.

## 1. What exists

| Layer | Where | Notes |
| --- | --- | --- |
| Governance schema | `db/migrations/169_ask_bailey_knowledge_foundation.sql` | 11 tables, FORCE RLS on all |
| Governance service | `packages/api/src/services/knowledge/knowledgeGovernance.ts` | eligibility SQL, lifecycle, conflicts, review queue |
| Ingestion | `packages/api/src/services/knowledge/knowledgeIngestion.ts` + worker `knowledgeIngestionMonitor` | idempotent jobs, deterministic segmenter/transcriber |
| Providers | `packages/api/src/services/ai/providers/` | transcription + language model interfaces, deterministic adapters |
| Answer pipeline | `packages/api/src/services/ai/askBailey.ts` | authorization-before-retrieval, citation validation |
| Ask API | `packages/api/src/routes/askBailey.ts` (`/api/ask-bailey/*`) | rate-limited ask, conversations, feedback |
| Review API | `packages/api/src/routes/knowledge.ts` (`/api/knowledge/*`) | reviewer-gated lifecycle + queues |
| Employee UI | `packages/admin-web/src/pages/AskBailey.tsx` → `#ask-bailey` | all-employee route |
| Owner UI | `packages/admin-web/src/pages/KnowledgeReview.tsx` → `#knowledge/review` | leadership-tier route |

## 2. Environment variables

All server-side only. None are required for development — every default is the
deterministic dev adapter. **Never put provider secrets in client code, source
control, logs, or test fixtures.**

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASK_BAILEY_LLM_PROVIDER` | `deterministic` | `deterministic` \| `openai_compatible`. Unknown values yield an honest `provider_unavailable`. |
| `ASK_BAILEY_LLM_BASE_URL` | `""` | Hosted-provider base URL (openai_compatible). |
| `ASK_BAILEY_LLM_API_KEY` | `""` | Hosted-provider key (secret manager only). |
| `ASK_BAILEY_LLM_MODEL` | `""` | Hosted model name. |
| `ASK_BAILEY_TRANSCRIPTION_PROVIDER` | `deterministic` | Timed-script parser today; hosted transcription slots in behind the same interface. |
| `ASK_BAILEY_MAX_RETRIEVED_SEGMENTS` | `8` | Retrieval bound per ask. |
| `ASK_BAILEY_MAX_ANSWER_CHARS` | `4000` | Answer size bound. |
| `ASK_BAILEY_ASK_RATE_MAX_PER_MINUTE` | `12` | Per-user ask rate limit (config schema caps at 120). |

The `openai_compatible` HTTP client is **not implemented yet**: selecting it
reports an honest unavailable state (configured or not). Implementing it means
one new function behind `LanguageModelProvider` — nothing else changes.

## 3. Demo (no credentials required)

```bash
# one-time: seed clearly-marked demo sources through the REAL lifecycle
cd packages/api && npm run ask-bailey:seed-demo
```

Creates 7 `[DEMO]`-prefixed sources (idempotent, dev-only, blocked in
production, requires `--allow-demo-data`): approved tether SOP, timed-script
training video with a placeholder Resource Library media item, an SD-card
conflict pair with an OPEN conflict, a confidential pricing policy, a
future-design culling concept, and a draft that must never answer.

Demo script (any authenticated employee, `#ask-bailey`):

1. “What do I do if the tether feed drops during a session?” → **supported**, SOP + video citations, “Watch from 00:12”.
2. “When should I format an SD card?” → **sources disagree**, both owners shown, no silent pick.
3. “How do I request parental leave?” → **honest no-answer**, question logged for review.
4. Switch mode to *Future plans & designs*, ask about “automated culling workflow” → supported **with the future-design disclaimer**; the same ask in operational mode finds nothing.
5. As a non-leadership user, pricing-floor questions never surface the confidential policy.
6. Leadership at `#knowledge/review`: approve/reject/retire pending versions, resolve the SD conflict, resolve the logged question, review reports, retry failed ingestion.

## 4. Security posture (enforced, tested)

- Eligibility + role/department/confidential scoping are **inside the retrieval SQL** — ineligible text never reaches ranking, the provider, or the client (`buildVersionEligibilitySql`).
- Context ids (`job_id`/`shoot_id`/`organization_id`) are validated server-side against `canViewRecords`/`assertShootAccess`; only `{kind,id,label}` survive.
- Provider `used_segment_ids` are validated against the retrieved set; invented ids are stripped (status downgrades to `partially_supported`, or `error` if nothing real remains).
- Citations, locators, timestamps, and media URLs are assembled from database rows only. Timestamps exist only if a stored transcript segment has them.
- Retrieved source text is data: the deterministic provider is extractive, and prompt-injection strings are quoted, never executed (tested).
- Answers render as plain text in the UI — no HTML/markdown interpretation (tested with an `<img onerror>` payload).
- Per-user rate limit on `/ask`; ingestion sweep is secret-gated; RLS on all 11 tables.

## 5. Retrieval notes and limitations

- FTS uses the repo's `simple`-config tsvector pattern: **no stemming** (“drops” ≠ “drop”) and OR-of-content-terms queries. A multi-term question requires ≥2 distinct matching terms so one incidental shared word cannot fake a supported answer. Precision improves when a real embedding provider lands behind `EmbeddingProvider` (seam only today).
- The demo video's media URL is a placeholder path — timestamp anchors are real, the file is not.
- The contextual drawer on operational pages is not built; context ids are supported end-to-end in the API, and the dedicated page is the entry point today.
- `partially_supported` currently triggers only on stripped citations; `access_limited` is reserved (context denials return 403 instead).

## 6. Next bounded slices (Phase F/G seams)

1. **Hosted provider**: implement the `openai_compatible` HTTP client + streaming + usage capture behind the existing interface; keep the deterministic provider as fallback and for tests.
2. **Contextual drawer**: an Ask Bailey panel on shoot/job detail pages passing the already-supported context envelope.
3. **Embeddings/hybrid retrieval**: implement `EmbeddingProvider`, add a pgvector column to `knowledge_segment`, blend with FTS.
4. **Training foundation**: learning assignments/progress tables per the architecture record §Phase F — reuse `knowledge_source` for lesson content; generated quizzes stay drafts until approved.
5. **Safe actions (Phase G)**: preview + explicit confirmation + audit, through existing Mission Control APIs only.
