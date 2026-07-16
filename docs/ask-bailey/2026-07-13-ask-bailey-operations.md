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
| `ASK_BAILEY_LLM_PROVIDER` | `deterministic` | `deterministic` \| `openai_compatible`. Hosted failures fall back to the deterministic extract with a visible notice. |
| `ASK_BAILEY_LLM_BASE_URL` | `""` | Hosted chat-completions base URL. https only (http allowed for loopback stubs/local models). Never client-supplied. |
| `ASK_BAILEY_LLM_API_KEY` | `""` | Hosted-provider key (secret manager only; sent as both Bearer and `api-key` for Azure compatibility). |
| `ASK_BAILEY_LLM_MODEL` | `""` | Hosted model/deployment name. |
| `ASK_BAILEY_LLM_API_VERSION` | `""` | Optional `api-version` query param (Azure). |
| `ASK_BAILEY_LLM_TIMEOUT_MS` | `30000` | Per-request timeout (abort). |
| `ASK_BAILEY_LLM_MAX_OUTPUT_TOKENS` | `1024` | Response bound. |
| `ASK_BAILEY_LLM_MAX_SEGMENT_CHARS` | `2000` | Per-segment prompt bound. |
| `ASK_BAILEY_LLM_RETRY_MAX` | `2` | Bounded retries for 429/transient 5xx/connection failures. |
| `ASK_BAILEY_LLM_MAX_CONCURRENT` | `4` | Hosted-call concurrency cap. |
| `ASK_BAILEY_LLM_KILL_SWITCH` | `false` | Force-disable hosted generation (deterministic fallback answers). |
| `ASK_BAILEY_LLM_COST_PER_1M_INPUT_CENTS` / `_OUTPUT_CENTS` | `0` | Pricing for cost estimation; zero = record no cost (never fabricated). |
| `ASK_BAILEY_TRANSCRIPTION_PROVIDER` | `deterministic` | Timed-script parser today; hosted transcription slots in behind the same interface. |
| `ASK_BAILEY_MAX_RETRIEVED_SEGMENTS` | `8` | Retrieval bound per ask. |
| `ASK_BAILEY_MAX_ANSWER_CHARS` | `4000` | Answer size bound. |
| `ASK_BAILEY_ASK_RATE_MAX_PER_MINUTE` | `12` | Per-user ask rate limit (config schema caps at 120). |
| `ASK_BAILEY_EMBEDDING_PROVIDER` | `deterministic` | `deterministic` (char-trigram hash, no credentials) \| `openai_compatible`. |
| `ASK_BAILEY_EMBEDDING_BASE_URL` / `_API_KEY` / `_MODEL` | `""` | Hosted embeddings endpoint (OpenAI-compatible `/embeddings`). |
| `ASK_BAILEY_SEMANTIC_TOP_K` | `8` | Semantic candidates per ask. |
| `ASK_BAILEY_SEMANTIC_MIN_SIMILARITY` | `0.45` | Gate for semantic-only candidates. Effective gate = max(this, the adapter's `semanticGateFloor`: deterministic 0.75, hosted 0) — char-trigram cosines run hot on long unrelated texts. |
| `ASK_BAILEY_MIN_MATCHED_CONCEPTS` | `2` | Lexical concept guard (multi-term questions). |
| `ASK_BAILEY_TYPO_SIMILARITY` | `0.5` | Trigram word-similarity credit threshold. |
| `ASK_BAILEY_MIN_EVIDENCE_SCORE` | `0.12` | Below this combined score → honest no-answer. |
| `ASK_BAILEY_MAX_SEGMENTS_PER_SOURCE` | `3` | Source-diversity cap. |

**H2 grounded generation:** the `openai_compatible` chat client is fully
implemented (real transport, verified against a local HTTP stub — no live
provider has been exercised without credentials). The server owns the entire
prompt envelope; source text travels as fenced untrusted data; the model must
return strict JSON claim blocks (`kind`/`text`/`segment_ids`), and the
pipeline validates every block's segment ids against the authorized retrieved
set: unsupported blocks are removed (→ `partially_supported`), and a fully
ungroundable or failed hosted response falls back to the deterministic
extractive provider with a visible notice — never model memory. Answers
persist and render as validated blocks (migration 171); the UI shows staged
safe progress states and supports cancellation; nothing streams unvalidated.

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

- **H1 hybrid retrieval** (`services/ai/retrieval.ts`): english-stemmed FTS (migration 170) + pg_trgm typo credit + company-owned synonym expansion (`knowledge_synonym`, reviewer-managed via `/api/knowledge/synonyms`, audited) + semantic similarity over governed vectors (`knowledge_segment_embedding`, RLS, eligibility joined into the vector query). Signals: lexical rank, matched-concept ratio, semantic cosine, exact phrase, heading match, authority, freshness. Guards: ≥2 matched concepts or the semantic gate, minimum evidence score, per-source cap, lexical-only fallback on embedding outage, no cross-auth caching. Reviewer-only retrieval trace via `trace: true` on `/ask` (ids + reason codes for ineligible matches; no protected text).
- **Evaluation harness**: `npm run ask-bailey:eval -- --label <name>` (22 cases through the real pipeline; results in `packages/api/eval/results/`). Recorded baseline 19/22 · recall 0.769; H1 hybrid 22/22 · recall 1.0 · 0 false-supported · 0 leaks.
- **pgvector**: not available in the current Postgres image, so vectors live in `double precision[]` and similarity is computed at pilot scale over eligibility-filtered rows. Production-scale blocker: adopt a pgvector-enabled image, then one migration adds a typed vector column + ANN index (lifecycle unchanged).
- The deterministic embedding adapter captures word-form similarity (inflections/typos), not true paraphrase semantics — those gains land when `openai_compatible` embeddings are configured.
- The demo video's media URL is a placeholder path — timestamp anchors are real, the file is not.
- The contextual drawer on operational pages is not built; context ids are supported end-to-end in the API, and the dedicated page is the entry point today.
- `partially_supported` currently triggers only on stripped citations; `access_limited` is reserved (context denials return 403 instead).

## 6. Next bounded slices (Phase F/G seams)

1. **Hosted provider**: implement the `openai_compatible` HTTP client + streaming + usage capture behind the existing interface; keep the deterministic provider as fallback and for tests.
2. **Contextual drawer**: an Ask Bailey panel on shoot/job detail pages passing the already-supported context envelope.
3. **Embeddings/hybrid retrieval**: implement `EmbeddingProvider`, add a pgvector column to `knowledge_segment`, blend with FTS.
4. **Training foundation**: learning assignments/progress tables per the architecture record §Phase F — reuse `knowledge_source` for lesson content; generated quizzes stay drafts until approved.
5. **Safe actions (Phase G)**: preview + explicit confirmation + audit, through existing Mission Control APIs only.
