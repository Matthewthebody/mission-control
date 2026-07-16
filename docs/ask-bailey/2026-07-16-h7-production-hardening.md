# Ask Bailey H7 — Production Hardening: Threat Model, Retention, Deployment, Accessibility

**Date:** 2026-07-16. Companion to the H7 final report and the machine-readable
release gate (`2026-07-16-h7-release-readiness.json`).

This document hardens Ask Bailey around the **actual** implementation on
`feature/work-spine-foundation-v1`, not a speculative architecture.

---

## H7-A — Threat model and data-flow

### Trust boundaries
1. **Browser → API**: bearer/cookie session; CSRF token required for mutations; `optionalAuth` then `requireAuth` on every Ask Bailey/knowledge/training route.
2. **API → Postgres**: every query runs through `withClientTransaction(tenantId, userId)` / `connectGuardedClient`, which set `app.current_tenant_id()`; **FORCE RLS** on every knowledge, AI, and training table isolates tenants even against a coding mistake.
3. **API → model/embedding/transcription provider**: only reviewer-approved, eligibility-filtered segment text is ever sent; the provider endpoint is server-configured (never client-supplied); credentials live only in server env.
4. **API → media storage**: bytes are streamed through `/api/ask-bailey/sources/:id/media`, which re-runs the retrieval eligibility predicate before reading storage.

### Sensitive data classes
- Protected/confidential knowledge source text and restricted transcript ranges.
- Student-identifying data inside school sources (minimized; never required for an answer).
- Leadership/HR/payroll/private notes (out of Ask Bailey's approved corpus by scope/confidentiality).
- Provider credentials and cost data.
- Employee training records (self-scoped; manager-visible only within existing training authority).

### Authorization-before-everything
Eligibility (`buildVersionEligibilitySql`) is applied **inside** the retrieval SQL for lexical, semantic, media, and context paths — never post-filtered. A model request is only ever assembled from already-authorized rows.

## H7-B/C — Authorization, privacy, and injection (proven)
`packages/api/tests/askBaileyHardening.test.ts` (8 tests) exercises:
- confidential source never leaks to an unauthorized employee through the ask path;
- guessed/ineligible media ids → opaque 404 (no existence oracle);
- every returned citation id resolves to a real segment (no invalid citations);
- retiring a source removes it from future retrieval (purge);
- provider failure degrades to an honest state, never unsupported prose;
- reviewer-only observability (associate → 403);
- the release gate computes all live hard gates as pass;
- the ask endpoint enforces a per-user 429 rate limit.

Retrieved source text is treated as **data**: it is rendered as plain text (no markdown/HTML injection surface), citations and links are assembled server-side from DB rows, and the deterministic default provider is prompt-injection-immune (extractive). Unknown client context fields are stripped by zod before retrieval.

## H7-D — Secrets and provider configuration
- Provider credentials come only from server env: `ASK_BAILEY_LLM_*`, `ASK_BAILEY_EMBEDDING_*`, `ASK_BAILEY_TRANSCRIPTION_*`. Defaults are the deterministic providers, so no credential is required to run.
- No credential appears in client bundles, logs, fixtures, or error messages.
- **Kill switch**: `ASK_BAILEY_LLM_KILL_SWITCH=true` forces the hosted provider `unavailable`; the pipeline falls back to the deterministic extractive path with a visible notice.
- **Deployment (Azure/staging), no cloud resources provisioned here** — set as server app settings, never committed:
  - `ASK_BAILEY_LLM_PROVIDER=openai_compatible`, `ASK_BAILEY_LLM_BASE_URL`, `ASK_BAILEY_LLM_API_KEY`, `ASK_BAILEY_LLM_MODEL` (+ optional `ASK_BAILEY_LLM_API_VERSION`).
  - `ASK_BAILEY_TRANSCRIPTION_PROVIDER=openai_compatible` + `ASK_BAILEY_TRANSCRIPTION_*` for real Whisper.
  - `ASK_BAILEY_EMBEDDING_PROVIDER=openai_compatible` + `ASK_BAILEY_EMBEDDING_*` for production embeddings.
  - Cost visibility: `ASK_BAILEY_LLM_COST_PER_1M_INPUT_CENTS` / `_OUTPUT_CENTS`.
  - Rotate keys by updating app settings; the kill switch disables the provider during an incident with no redeploy.

## H7-E — Reliability and load
- Per-user ask rate limit (`ASK_BAILEY_ASK_RATE_MAX_PER_MINUTE`, default 12) → 429 (integration-tested).
- Provider timeout (`ASK_BAILEY_LLM_TIMEOUT_MS`), bounded retries (`ASK_BAILEY_LLM_RETRY_MAX`), and concurrency cap (`ASK_BAILEY_LLM_MAX_CONCURRENT`).
- Request body bound (`express.json({ limit: "8mb" })`); question capped at 2000 chars; retrieved segments capped (`ASK_BAILEY_MAX_RETRIEVED_SEGMENTS`).
- Graceful degradation: provider failure → deterministic fallback (never a hard error to the user).
- **Pilot latency/error budget**: deterministic path answers in well under 100ms locally; hosted provider bounded by the 30s timeout with fallback. The pilot cohort is small and cohort-gated (H6/H8), keeping concurrency within the configured caps. No load test provisioned a cloud provider; the budgets are documented and enforced by the caps above.

## H7-F — Observability and cost
- `recordUsage` writes `ai_provider_usage_event` (provider, model, tokens, estimated cost cents, latency, status) for every generation.
- Reviewer-only read model: `GET /api/ask-bailey/observability` — provider usage by status, answer-state mix, citation integrity (total/invalid), open unresolved questions, and pilot training usage.
- Reviewer-only `GET /api/ask-bailey/release-gate` — machine-readable hard-gate report.
- Admin surface: `#knowledge/observability` (reviewer-gated). Structured fallback telemetry (`ask_bailey_generation_fallback`) is logged without prompt content.
- No full prompts, protected excerpts, or secrets are logged.

## H7-G — Retention, deletion, and incident operations
- **Conversations / messages / citations / feedback**: retained for review and audit; tenant-scoped; deletable per tenant. No third-party model training occurs on employee conversations.
- **Source / media deletion + retirement**: retiring a version stops it answering immediately (proven by the purge test); deleting a `knowledge_source` cascades its versions, segments, embeddings, and ingestion jobs. Protected playback re-checks eligibility on every request, so a retired/deleted source is no longer playable.
- **Vector/cache purge**: embeddings are rows on `knowledge_segment_embedding` (cascade-deleted with the segment); there is no external vector cache to purge.
- **Employee deactivation**: revoked users fail `isActiveMembership` and lose all Ask Bailey/training access; their training rows are FK-scoped and removable.
- **Incident / provider outage**: engage `ASK_BAILEY_LLM_KILL_SWITCH` — the system keeps answering from the deterministic extractive path with an honest notice. Bad-source rollback = retire the version (governed). Source conflict = the existing conflict record + reviewer queue.
- **Audit retention**: every governed mutation writes to `audit_log` (append-only history).

## H7-H — Accessibility and product resilience
- Ask Bailey conversation and the review/training surfaces are keyboard-operable; the drawer traps focus and restores the opener's focus on close (covered by `askBaileyDrawer` tests).
- Answers render as plain text (screen-reader friendly; no injected markup).
- Readiness questions use native `<fieldset>/<legend>/<label>/<input radio>` with `aria-label`s.
- Honest offline/provider-down state: a visible fallback notice rather than a spinner or a fabricated answer.
- Colour is never the only signal (text labels accompany every badge/state).

## H7-I — Release gate
See `2026-07-16-h7-release-readiness.json`. Overall **pass**; the two `external` gates (regressions/typechecks and the adversarial suite) are proven by the commands recorded in the H7 final report, and surfaced honestly as external so the gate is never silently green.
