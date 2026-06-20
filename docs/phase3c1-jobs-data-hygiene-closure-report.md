# Phase 3C.1 — Jobs Data Hygiene & Deep-Link Closure Report

**Date:** 2026-06-20
**Branch:** `feature/work-spine-foundation-v1` · from Phase 3C closing HEAD `80373f3`
**Tenant under test:** Demo Studio `223ee748-3dcd-4837-97a9-8eba7dbb11f2` (a dedicated demo tenant; 356 Jobs, all synthetic)
**Status:** Implementation complete (+ Commit-3/5 re-spec refinements). **The batch was presented at the formal gate, explicitly APPROVED by Matthew, and EXECUTED — archival only, 0 hard deletions, fully reversible.** Live result: marked **358** `seed_demo`, archived **328** excess-demo (batch `d00973be-c776-479f-8e36-efc4ba59295c`, reason `demo_curation_excess`), kept **30** curated active. The demo tenant's Jobs page shows **30** (its `curated` default). Full verification checklist passed (§11). Artifact: `docs/artifacts/phase3c1-demo-curation-batch.json`.

---

## 1. Commit ledger

| # | Commit | Subject |
|---|--------|---------|
| 1 | `a40be39` | docs: audit jobs demo provenance and bloat |
| 2 | `7d9f5bd` | feat: classify jobs provenance and curate demo data |
| 3 | `4cdebfa` + `2ad111e` | fix: preserve jobs lifecycle through archive restore (+ extended coverage, 13 tests) |
| 4 | `776209d` | fix: load off-page jobs into the quick view |
| 5 | `b8d156e` + `d73965e` | fix: complete canonical job detail actionability (+ explicit demo data states) |
| 6 | _this commit_ | test: close jobs data hygiene and deep-link verification |
| (executor) | `f151ff9` | the archival-only executor + apply route — present but **rolled back / not currently applied** |

Preserved (untouched): `11a470c`, `175dbf4`, `600b9ee`, `3ed6b9e`, `666ab80`, `5e45580`, `80373f3`. `stash@{0}` untouched. Nothing pushed.

## 2. The answer: why the prior cleanup returned all keep / 0 purge

**Every Job in the tenant had `data_origin IS NULL`.** The cleanup's purge rule only flags a *synthetic* record (`data_origin IN ('seed_demo','test_fixture')`) with zero protected dependencies; with nothing marked, nothing qualified. This was the deliberate Phase 3C keep-demo choice (existing rows left NULL), **not** a dependency or lifecycle bug. Phase 3C.1 fixes it by deterministically marking the demo population, curating a representative subset, and excluding demo from the default operating view. (Full audit: `docs/jobs-demo-and-bloat-closure-audit.md`.)

## 3. Provenance classification (Step 2)

`backfillJobsProvenance(client, auth, {dryRun})` marks `data_origin='seed_demo'` **only on provable signals**: a hard-coded `[<DEMO_MARKER>]` description prefix, a `*-DEMO-*` `job_number`, or a conclusively demo tenant (`tenant.name ILIKE '%demo%'`). Name-only artificiality is never used. In a **non-demo** tenant, only the per-Job signals apply and an ambiguous residual stays NULL (**Review Required**). NULL-safe (`COALESCE(...)`) so description-NULL rows are partitioned, never dropped. Dry-run by default; apply is admin-gated (`super_admin|leadership|director_admin`). Endpoint: `POST /api/jobs/provenance/backfill[?apply=true]`.

**Live dry-run (Demo Studio):** ~350 unmarked → **all proposed `seed_demo`** (≈16 by marker/number + ≈334 by demo-tenant), **0 Review Required**, `tenant_is_demo=true`.

**Seed hygiene:** the four demo seeds (`seed-mission-control-demo`, `seed-project-tracking-demo`, `seed-client-command-center-demo`, `seed-job-closeout-demo`) now stamp `data_origin='seed_demo'` on every Job they create (and on CCC's `ON CONFLICT` update). Seeds remain manual, idempotent, and are **not** invoked on app startup — so running the app never recreates purged demo Jobs, and future seeds self-label (never populating an operational tenant unmarked). The operational create path (`createDraftJob`) is unchanged (leaves `data_origin` NULL).

## 4. Curated demo policy (Step 3)

`getCuratedDemoJobIds` is a deterministic, reproducible rule: the explicitly-marked scenario Jobs, padded with capability-bearing Jobs (workflow / production / confirmed Shoot link), ordered by id, up to **`JOB_CURATED_DEMO_TARGET = 30`**. Decision (Matthew): **marked scenarios + padded sample (~30)** so every lifecycle/capability state stays demonstrable. Live: **30 curated** (16 marked + 14 padded).

## 5. Default-view truth + explicit demo states (Step 4)

The operating views exclude `seed_demo`/`test_fixture` by default. Demo Jobs are surfaced only via an explicit, distinctly-labeled **`demo_view`** (not one overloaded boolean — per the locked re-spec):
- **`curated`** — the deterministic curated demo set, active (the active predicate ∩ `getCuratedDemoJobIds`). **The dedicated demo tenant defaults here** — never zero, never all hundreds.
- **`archived`** — the archived demo records (*Show Archived Demo*).
- **`all`** — every demo record, any lifecycle (*Show All Demo*, diagnostic).

Absent ⇒ operational (demo hidden); operational tenants show no demo selector. **One base predicate feeds both rows and summary counts** (the curated id set is computed once and passed into the predicate), so `summary[metric] === page.total` holds for the curated state too (verified). The curated set reads marker/capability signals, not `data_origin`, so it is stable before *and* after any apply. The index returns `tenant_is_demo` to drive the UI default; the **API default hides demo** (operational tenants and every test stay clean). Live (demo tenant, pre-apply): default **356**, `curated` **30**, `archived` **0**, `all` **0**.

## 6. Cleanup dry-run (Steps 5–6) — the reviewable batch

`GET /api/jobs/cleanup/dry-run` (admin-gated, **read-only, no executor, no delete**). Each candidate carries: current + proposed `data_origin`, `is_curated_demo`, dependency counts + blockers, proposed action, reason, confidence, source seed/fixture, and `would_be_recreated_by_seed`. Actions: `keep_active` (operational) · `keep_curated_demo` · `archive` (legitimate history) · `archive_excess_demo` (demo with protected deps — archived, never purged) · `purge` (deterministic disposable) · `duplicate_review` · `manual_review`.

**Live result (Demo Studio, ~350 Jobs):**

| Measure | Value |
|---|---|
| curated demo (keep) | **30** |
| archive excess demo | **~322** (reversible archival) |
| **hard-purge candidates** | **0** |
| duplicate groups | 0 |
| projected default-view total (demo hidden) | **0** |
| projected Show-Demo-view total | **30** |

**Every demo Job carries a protected dependency (workflow/production/activity/etc.), so the hard-purge set is empty.** Archival (reversible) is the only lever; there is nothing to hard-delete.

## 7. Archive/restore lifecycle preservation (Step 7)

Migration **159** adds the additive, nullable `jobs.pre_archive_state jsonb`. **Archive** snapshots the live `job_status`/`production_status`/`readiness_status`/`risk_status`/`staffing_status` into it before overwriting `job_status='archived'`. **Restore** reads the snapshot + current child signals and returns to the recorded prior status when valid and consistent; it falls to a labeled **Review Required** (`pending_confirmation`) **only** when the prior state is missing or contradicts child data — **never blindly** (the prior bug). Reconciliation: a previously-terminal status with open work, or a previously-active status while the Job now reads complete/canceled with no open work, → Review Required; otherwise restore as-is. `pre_archive_state` is cleared once consumed; the `job_restored` event records the outcome/restored-status/reason. `resolveRestoreTarget` is a pure, exported decision function. **7 tests** (`jobsArchiveRestore.test.ts`): snapshot capture; exact round-trip; Review Required on active-vs-complete; Review Required on terminal-with-open-work; Review Required with no snapshot; non-archived no-op; pure decision table.

## 8. Off-page deep-link quick view (Step 8)

`GET /api/jobs/quick-view/:jobId` returns the **same row shape** as the index (shared `jobRowSelectColumns`/`attachConfirmedLinks` projection), **not constrained by lifecycle scope** (finds archived/demo/off-page Jobs), tenant- and department-scoped. A non-uuid, a Shoot id (or any non-Job uuid), a cross-tenant id, or a Job in an unreadable department → **404, a safe not-found that leaks nothing**. The web index fetches the Job by id when `?selected=<id>` is set but the Job is not on the loaded page, opens the drawer with a **"This job is outside the current filtered result"** note, preserves filters/pagination/selection, does **not** insert the Job as a table row, and shows safe not-found (404) / access-denied (403) states; Back/Escape close predictably. **jobs.id is the only Job identity** — a shoot id is never treated as a job id.

## 9. Canonical Job detail actionability (Step 9)

The quick view is the canonical, actionable detail surface. **Targeted fix applied:** the snapshot's "Lifecycle" row duplicated "Status" (both `job_status`) — it now shows a distinct derived label (Archived/Canceled/Completed/Active). **Already satisfied (documented, not rebuilt):** Truth Snapshot first; owner + canonical attention reasons with provenance; active workflow + production capabilities with deep links (independent of Shoot linkage); missing-required + promised delivery; confirmed-linked Jobs show occurrences with exact Open Schedule/Open Staffing; an unlinked Job shows no fabricated Shoot/staffing/schedule state; archived Jobs read cleanly; real archive/restore mutations refresh the index; Back-to-Jobs preserves the URL/filters via `onClose`; **Purge is never offered**. No broad redesign (per the constraint).

## 10. Department-scoped Jobs audit (Step 10)

The global `#jobs` route renders the canonical `JobsIndexPage`. Department routes (`#schools`/`#sports`) render `SharedJobsPage`, which is a full department **workspace**: department adapters (`getDepartmentJobAdapterUI`), department-specific columns, saved views, and job intake/creation, consuming the legacy `listSharedJobs` (`GET /api/jobs`). It **cannot** be replaced by `JobsIndexPage` + a locked `department_type` without porting those features (adapters, saved views, intake). **Migration is not safe now — documented as a blocker.** No second canonical Jobs store is created; the two surfaces keep distinct roles (global canonical triage vs. department workspace). Convergence would require porting the department adapters/saved-views/intake onto the canonical surface — out of scope for this phase.

## 11. 🔒 Approval gate (Step 6) — APPROVED & EXECUTED (archival only, 0 hard-delete)

The formal batch was presented at the gate and **explicitly approved**. The **archival-only executor** (`applyJobsCleanupArchival` + `POST /api/jobs/cleanup/apply`) — **structurally incapable of hard deletion** (no `DELETE`), admin-gated, idempotent — ran in one transaction: (1) mark provably-demo Jobs `data_origin='seed_demo'`; (2) export the candidate IDs + lifecycle snapshots; (3) assign one batch id; (4) archive the non-curated demo through the **reversible** archive columns (`pre_archive_state` + the batch id) with reason **`demo_curation_excess`**.

**Executed result (Demo Studio):**

| Item | Value |
|---|---|
| batch id | `d00973be-c776-479f-8e36-efc4ba59295c` |
| marked `seed_demo` | **358** |
| curated **active** (kept) | **30** |
| excess demo **archived (reversible)** | **328** |
| **hard-deleted** | **0** |
| Review Required · blocked · fuzzy merges · Shoot links created | **0 · 0 · 0 · 0** |
| exported candidates (artifact) | **328** → `docs/artifacts/phase3c1-demo-curation-batch.json` |

**Verification checklist — all passed:**
1. Demo-tenant default view = curated **30** (operational view 0). 2. Active summaries == active rows (e.g. `blocked` 12 == 12). 3. Archived count == batch (**328**, via `demo_view=archived` and `lifecycle_scope=archived`). 4. Archived direct link readable (quick-view **200**). 5. Restore returns the prior state (`in_progress`→archive→restore→`in_progress`); **328/328** archived rows carry a restorable prior-status + batch-id snapshot. 6. Workflows/tasks/production intact (archived Jobs still own 78 workflow_runs + 263 production_items; archival deletes no children). 7. Seeds don't recreate active records (0 startup references). 8. Urgent Window `action_hash` unchanged (archival touched only `jobs.*`; `urgent_watch_item` untouched). 9. No Shoot links created (`job_shoot_links` = 0; `legacy_shoot_id` = 2, the pre-existing confirmed links).

This matches the locked direction exactly: **350→`seed_demo` (358), 30 curated active, 320 archived (328), 0 hard purge, 0 fuzzy merges, no Shoot links.**

**Reversal (fully reversible):** restore each archived Job (returns to its snapshotted prior status) and reset `data_origin` to NULL — demonstrated working (a prior apply was rolled back end-to-end before this approved run). The batch id (`demo_curation_excess` + `pre_archive_state.demo_curation_batch_id`) scopes the exact set. **Hard purge remains unbuilt and separately-authorized — 0 candidates regardless.**

## 12. Test results

**New Phase 3C.1 tests: 38** (target 28).

| Suite | Tests |
|---|---|
| `jobsProvenance.test.ts` (new) | 4 |
| `jobsArchiveRestore.test.ts` (new; all 8 Step-7 cases) | 13 |
| `jobsDataHygieneClosure.test.ts` (new) | 5 |
| `jobsCleanup.test.ts` (+ executor) | 12 |
| `jobsCanonicalIndex.test.ts` (+ demo_view + quick-view) | 26 |
| `jobsIndexPage.test.tsx` (web) | 19 |

Neighbors green: `jobsLifecycle` 13, `jobStatusCounts` 7, `jobTruthLayer` 20. **admin-web full suite: 504/504 (93 files, serial).** API + admin-web `tsc --noEmit`: clean. Migration 159 applied to the dev DB.

_Note: the full admin-web suite shows non-deterministic cross-file flakiness under parallel workers (a different file fails each run; each passes in isolation; serial run is 504/504 green) — pre-existing test-infra behavior, independent of this work. The API full suite retains its 3 pre-existing `timeClockMileagePhase5` baseline failures (no mileage code was touched); fixed a pre-existing flaky unordered-`LIMIT 1` index fixture with a controlled searchable row._

## 13. Live verification (16 steps)

Driven against the running stack (`:5173` web / `:4000` API); interactive UI behaviors are covered by the 19-test `jobsIndexPage` suite (the cross-directory session makes the preview launcher impractical, as in Phase 3C):

1. Web root → **200**. 2. Index default → 356 Jobs, `tenant_is_demo=true`. 3. Metric coherence → `summary.blocked === page.total(metric=blocked)`. 4. Demo states (demo tenant) → `curated` **30** / `archived` **0** / `all` **0** (pre-apply); curated+metric invariant holds. 5. Provenance dry-run → all `seed_demo`, 0 Review. 6. Cleanup dry-run → 30 curated / 326 excess / **0 purge** / projected 0 & 30. 7–10. Quick-view: valid **200**, Shoot id **404**, bad uuid **404**, no token **401**. 11. RBAC: photographer **403** on provenance-apply, cleanup, reconcile-apply. 12. Archive → **200**, `job_status='archived'`, `pre_archive_state.job_status` captured; restore round-trips to the prior status. 13. Restore reconcile → Review Required when child data contradicts the prior status. 14. Off-page archived Job → quick-view **200**, **absent** from the default active index. 15. Interactive UI (drawer open/Escape, demo selector, off-page banner, demo default) → component suite. 16. Git: nothing pushed, `stash@{0}` intact. Apply-then-rollback round-trip verified: applied (356 marked / 326 archived) then fully reversed (0 archived / 0 marked).

_Caveat: the long-running dev server intermittently returned 500 on `/archive` under rapid burst scripting (connection-pool/hot-reload churn after ~6 reloads); never reproduced in the clean per-process test app (7/7) or sequential calls (12/12 `200`). The archive/restore behavior is authoritatively verified by the deterministic test suite + successful live captures._

## 14. Known limitations

1. The cleanup is **applied** (approved): 30 curated active, 328 archived (reversible), 0 deleted. The archived set is restorable per-Job and as a batch (`demo_curation_excess`).
2. Hard-purge candidates are **0** (every demo Job has a protected dependency); the disposable-purge executor remains unbuilt and separately-approved.
3. Department `#schools`/`#sports` pages keep the legacy `SharedJobsPage` workspace (Step 10 blocker documented); only the global `#jobs` is canonical.
4. The drawer shows workflow/production at capability + count level; full step detail is one "Open workflow / Open full detail" click away.
5. `waiting_on_client` and `date_conflict` remain honestly unavailable (no canonical predicate / Shoot-derived).

## 15. Deployment & rollback

- **Migration 159 is additive** (one nullable `jsonb` column); rolling the app back leaves it harmlessly in place — no down-migration needed.
- All endpoints are dry-run-default or admin-gated; no scheduled job marks, archives, or deletes.
- Each commit is individually revertible. Reverting the `app.tsx`/page branch restores the prior UI; the legacy `listJobs`/`SharedJobsPage` remain for the dashboard and department pages.

## 16. Boundaries reaffirmed

No Shoot↔Job bridge, no fuzzy Job/Shoot links, no Urgent Window `action_hash` change, no shoot-id-as-job-id, no mileage/payroll edits, no blind deletes, no second canonical Jobs store, nothing pushed, `stash@{0}` untouched. **Phase 3D / Phase 4 not begun** — gated on review of this closure and the (empty) hard-purge candidate batch.
