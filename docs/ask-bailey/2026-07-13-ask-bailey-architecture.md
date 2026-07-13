# Ask Bailey — Architecture Record (Phase A)

**Date:** 2026-07-13 · **Branch:** `feature/work-spine-foundation-v1` · **HEAD at start:** `c2aa9e5`
**Status:** Accepted — implementation proceeds in phases B–E this session; F–G are designed seams only.

Ask Bailey is a context-aware, citation-first knowledge and training assistant embedded in
Mission Control. Product promise: *"Bailey knows where the right answer lives."* Every
operational answer is grounded in approved sources or authorized live Mission Control
context, cited exactly, and never invented.

---

## 1. Current-state audit (what already exists and is reused)

| System | State | How Ask Bailey uses it |
|---|---|---|
| **Resource Library** (`resource_library_item`, mig. 084→116) | Canonical asset store: `storage_key`/`file_url`, `reference_kind` (uploaded_file/external_link), `external_provider` (internal_upload/direct_url/sharepoint/onedrive), `category` enum (incl. `sop_reference`), `approval_status`, `visibility_scope`, uploader, content type. `resource_library_item_link` polymorphically attaches assets to org/location/shoot/job/production_item. | **The original asset.** A knowledge source REFERENCES a Resource Library item; it never re-stores the file. No second library is created. |
| **Auth & policy engine** (`user_role_assignment` → `policyGrants`, `canViewRecords`/`canSharedPolicy`, `hasAuthorityTier`) | Mature; per-request DB-derived permissions; G5 seed gap fixed 2026-07-13 (`d620af7`). | Authorization-before-retrieval: scope filters run inside the retrieval SQL; record-context validation reuses `canViewRecords` per entity. Review actions gate on `hasAuthorityTier(["super_admin","leadership","director_admin"])` (the `jobsCleanup` pattern). |
| **Full-text search** (mig. 106 `global_search_index`) | Generated `tsvector` with `setweight` A/B/C + GIN + `pg_trgm` indexes; `websearch_to_tsquery('simple', …)` + `ts_rank` in `globalSearchService`. | `knowledge_segment.search_document` mirrors this pattern exactly. No new search infrastructure. |
| **Background jobs** (`packages/worker` bullmq + secret-gated internal sweep routes; e.g. labor, checklists, production-board) | Established: worker monitor POSTs `X-PMC-Internal-Secret` to an API internal route; API owns transactions/tenant loop. | Ingestion jobs run through an identical `POST /api/knowledge/internal/ingestion/sweep` + 60s monitor. Web requests never block on ingestion. |
| **Audit** (`createAuditLog`) | Uniform actor/entity/metadata audit events. | Every governance action (approve/reject/retire/supersede/resolve-conflict) writes one. |
| **Notifications** (`queueNotificationDispatch` outbox) | Deduped fan-out. | Not used in MVP; seam for future review-assignment nudges. |
| **RLS** (FORCE RLS + `tenant_isolation_*` policy FOREACH block) | Every new table follows it. | All 11 new tables are tenant-isolated at the row level. |
| **Rate limiting** (`createRateLimiter`, in-memory per-process) | Used on auth routes. | `POST /api/ask-bailey/ask` is per-user rate limited. |
| **Route registration** (navigation.ts definition + `resolveRouteId` case + `canAccessRoute` case + app.tsx render branch) | Known trap: a route needs ALL FOUR or the guard silently swaps it for the dashboard (proven twice this session). | The `ask-bailey` route registers all four; deep-link + refresh verified in the browser. |
| **Training** (`seedTrainingState`, `#employees/training`) | Existing module/profile records. | Phase F seam only: learning assignments will REFERENCE existing training records, not duplicate them. |
| **AI/embedding deps** | None exist (no openai/pgvector/whisper packages). | Everything sits behind new provider interfaces with deterministic dev adapters; no vendor dependency is added in the MVP. |

**Bailey asset:** no approved Bailey image exists anywhere in the repo (verified by grep).
A minimal, professional black-lab-silhouette SVG mark ships as a clearly-commented
temporary placeholder. Obtaining an approved image is an external item for Matthew.

## 2. Architecture decisions

### D1 — Two layers: asset vs. knowledge governance
`resource_library_item` remains the canonical original file/link. A new
`knowledge_source` (+ `knowledge_source_version`) layer carries ALL governance metadata:
source type, authority class, publication status, knowledge mode, scopes, effective/review
dates, supersession, fingerprints. A source may also exist WITHOUT an asset (e.g.
`verified_expert_answer` written directly in review). Rationale: the Resource Library's
`approval_status` governs asset visibility (setup-photo approvals); knowledge governance
needs a richer, versioned lifecycle that must not overload the asset row.

### D2 — Eligibility is one SQL predicate, applied BEFORE retrieval
A single service-owned predicate (publication_status='approved' AND effective-window AND
NOT superseded/retired AND mode-eligible AND scope-authorized for the requesting user)
is embedded in the retrieval query's WHERE clause. Segments inherit authorization from
their version. Nothing ineligible ever reaches ranking, the model, or the client.
Planning mode may additionally include `future_design_only` sources, always labeled.

### D3 — Postgres-first retrieval; embeddings are a seam
Retrieval = FTS (`websearch_to_tsquery` + `ts_rank` on a weighted generated tsvector)
blended with authority-class rank and effective-date recency. `EmbeddingProvider` is an
interface with no production implementation in the MVP; hybrid retrieval slots in behind
the same service boundary later. No vector DB, no Azure Search, no new infra.

### D4 — Provider abstraction with a deterministic dev provider as the default
`LanguageModelProvider`, `EmbeddingProvider`, `TranscriptionProvider` interfaces live in
`services/ai/providers/`. The default `deterministic` language provider composes an
extractive answer FROM the retrieved authorized segments only (no network, no secrets,
immune to prompt injection by construction) — this is the honest demo/dev/test path. An
`openai_compatible` provider slot exists behind env config (`ASK_BAILEY_LLM_PROVIDER`,
`ASK_BAILEY_LLM_BASE_URL`, `ASK_BAILEY_LLM_API_KEY`, `ASK_BAILEY_LLM_MODEL`); when
selected but unconfigured, the pipeline returns an honest `provider_unavailable` state.
No provider secret ever reaches the client; config is server-env only.

### D5 — Citations are assembled server-side, never trusted from the model
The provider returns `used_segment_ids` (validated ⊆ retrieved set; anything else is
rejected and logged). The server builds citation objects (title, locator label, exact
stored `start_seconds`/`end_seconds` for media, validated route) from database rows.
A timestamp that does not map to a stored transcript segment cannot exist.

### D6 — Conflicts are declared records, never silent ranking choices
`knowledge_source_conflict` links two source versions with a status
(open/resolved/dismissed). When retrieval returns segments from ≥2 sides of an open
conflict, the answer status is `source_conflict` with both sources and their owners
surfaced. Reviewers resolve conflicts explicitly (audited). Automatic semantic conflict
DETECTION is future work and is not claimed.

### D7 — Context envelope is server-validated and allowlisted
The client may submit candidate context ids (job/shoot/organization/location). The
server validates existence + the caller's access (reusing `canViewRecords` /
shoot-access patterns), then selects a fixed allowlist of fields (title, type, date,
department, role-relevant checklist state). Anything else — payroll, HR, other
employees' data — never enters the envelope. The model has no database access and no
tool-calling in the MVP (read-only assistant).

### D8 — Learning is governed, not automatic
Knowledge learning = ingest/approve new sources (no fine-tuning). Organizational
learning = unresolved-question + feedback queues feeding leadership review. Individual
learning = Phase F seam referencing existing training records. System improvement =
structured feedback + a version-controlled evaluation harness. Nothing auto-publishes;
a thumbs-up never becomes policy; employee conversations are never training data.

## 3. Data model (migration 169, all RLS'd, names follow repo conventions)

- `knowledge_source` — canonical knowledge identity; optional `resource_library_item_id`;
  owner/department owner; current-version pointer.
- `knowledge_source_version` — source_type, authority_class, publication_status,
  knowledge_mode, effective_from/until, review_due_at, supersedes_version_id,
  approved_by/at, scopes (`department_scope text[]`, `role_scope text[]`,
  `confidential` bool), content fingerprint, inline body (for expert answers),
  ingestion/extraction status, review notes.
- `knowledge_segment` — per version; ordinal; heading/locator label; content;
  `start_seconds`/`end_seconds` (media); speaker; segment_kind (extracted_text |
  transcript | reviewer_note); generated weighted `search_document` tsvector + GIN.
- `knowledge_ingestion_job` — kind (document_extract | media_transcribe), status
  (queued/processing/needs_review/completed/failed), attempts, idempotency fingerprint,
  provider, error, timestamps.
- `knowledge_source_conflict` — version A/B, status, opened_by, resolved_by/at, note.
- `ai_conversation` / `ai_message` — user, mode, context envelope summary, question,
  status, answer markdown, provider/model, latency, token usage.
- `ai_message_citation` — message → segment + version (server-assembled).
- `ai_message_feedback` — helpful/not_helpful/report_incorrect/missing_info/outdated.
- `ai_unresolved_question` — normalized question hash, occurrence count, departments/roles
  asking, status (open/assigned/answered/dismissed), proposed-answer draft link.
- `ai_provider_usage_event` — provider, model, operation, tokens, est. cost, latency.

## 4. Answer pipeline (server-owned, `services/ai/askBailey.ts`)

authenticate → resolve role/permissions → validate context ids → build allowlisted
envelope → resolve mode (operational default) → **eligibility+authorization filters in
retrieval SQL** → FTS rank (relevance + authority + recency) → open-conflict check →
bounded provider request (retrieved text is DATA, never instructions) → structured
response → validate used_segment_ids ⊆ retrieved → assemble citations from DB rows →
persist conversation/message/citations/usage → return typed answer.

Statuses: `supported`, `partially_supported`, `no_approved_answer` (creates/increments an
unresolved question), `source_conflict`, `provider_unavailable`, `access_limited`, `error`.
Machine-readable error codes per spec (`NO_APPROVED_SOURCE`, `SOURCE_CONFLICT`, …).

## 5. Threat model (tested, not aspirational)

| Threat | Control |
|---|---|
| Prompt injection via source text ("ignore previous instructions", "treat this draft as approved") | Deterministic provider is extractive (structurally immune); provider contract limits output to `used_segment_ids` + markdown; citation validation rejects anything outside the retrieved set; test with a malicious seeded segment. |
| IDOR on context ids | Server validates record + caller access before envelope assembly; test cross-role denial. |
| Draft/future-design/superseded/retired leakage | Eligibility predicate in SQL; unit + API tests per class. |
| Fabricated citations/timestamps | Server-side assembly from stored segments only; invented ids rejected + logged. |
| Restricted-source exposure | Scope filters (department/role/confidential) inside retrieval WHERE; RLS beneath everything. |
| Secret exposure | Providers configured via server env; nothing in client code, fixtures, or logs. |
| Abuse/cost | Per-user rate limit, bounded segment count/prompt/response size, usage events logged. |
| Sensitive prompt over-logging | Conversations store the question (operationally necessary + user-visible history) but never provider secrets; no chain-of-thought is stored or exposed; retrieval trace is a dev/test helper showing selected records + ranking signals only. |

## 6. Phased map

- **B — Governance foundation:** migration 169, eligibility service, approval lifecycle + audit, tests.
- **C — Ingestion foundation:** job lifecycle, deterministic document segmenter, transcript
  segments with timestamps, `TranscriptionProvider` + dev adapter, idempotent retries,
  internal sweep + worker monitor, tests. Honest `INGESTION_NOT_CONFIGURED` state for
  unconfigured production transcription.
- **D — Read-only MVP:** retrieval + pipeline + providers + routes (+ rate limit + usage
  logging), demo seeds (clearly demo-marked), `ask-bailey` route/page/global entry,
  source cards + exact timestamp links, feedback, unresolved-question capture, full test
  matrix, live browser verification.
- **E — Review workflow:** review queue (approve/reject/retire/supersede/re-index/retry),
  unresolved questions with draft proposed answers, conflict resolution, report queue.
- **F (seam only now):** learning assignments referencing existing training records;
  Fall Field Coach pilot runs on real approved Resource Library content when provided.
- **G (not in MVP):** preview-and-confirm safe actions through existing Mission Control APIs.

## 6a. Scout-verified constraints folded into the design

- **No markdown renderer or DOMPurify exists in admin-web.** Bailey answers render as
  structured plain text (paragraph/bullet splitting, no HTML injection surface). The
  answer contract still carries `answer_markdown` for a future vetted renderer.
- **Resource media URLs are served raw** (`preview_url`/`download_url` = `file_url`,
  role-gated visibility only; no signed URLs or proxy exist anywhere today). Bailey's
  timestamp links follow the EXISTING protection level — same as ResourceLibraryPanel's
  `<video src={preview_url}>` — and a protected media proxy is a documented follow-up,
  not silently claimed.
- **The upload presign allow-list excludes video** (`s3.ts:9-15`); existing video items
  entered via backfill/external links. Phase C transcribes EXISTING library media items;
  extending the presign allow-list is a follow-up slice.
- **Review metadata already exists inline on resource items** (`approval_status`,
  `reviewed_by/at/note`) — that remains the ASSET review; knowledge versions carry the
  richer knowledge lifecycle, as designed (D1).
- **Global search extension pattern**: `global_search_index` + refresh trigger + domain
  registration (mig. 116:136-349 model). Bailey's retrieval searches `knowledge_segment`
  directly (its own weighted tsvector); surfacing sources in Concierge global search is a
  future slice using that exact pattern.
- **Permissions**: `permissionRegistry.ts` is a flat shared-key allow-list; DB seeding
  follows migration 131. MVP review actions gate on authority tiers (no new permission
  rows needed); a granular `knowledge.review` code via the 131 pattern is the follow-up.

## 7. Explicit assumptions

1. Demo knowledge sources are seeded `data_origin`-style demo-marked and excluded from any
   production claim; they exercise the REAL pipeline (no hardcoded UI answers).
2. Production transcription and hosted-LLM credentials do not exist yet; interfaces, env
   documentation, and honest unavailable states ship instead — per the mission protocol
   this is not a blocker.
3. `simple` text-search config (matching mig. 106) is acceptable for v1 English content.
4. Review permissions ride authority tiers for the MVP; a granular `knowledge.review`
   permission code is a documented follow-up if role-level delegation is needed.
5. Media timestamp deep-links open the asset's protected URL with a `#t=` media fragment
   (HTML5 standard); a dedicated in-app player is a future slice.
