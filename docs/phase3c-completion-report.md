# Phase 3C — Jobs Data Refresh, Archival/Purge, Compact Index & Quick View: Completion Report

**Date:** 2026-06-19
**Branch:** `feature/work-spine-foundation-v1`
**Closing HEAD:** the `fix: complete jobs lifecycle and actionability` commit (this commit)
**Scope:** make Jobs a dense, current, actionable operating surface — lifecycle/archival, a safe cleanup dry-run, the compact canonical index, and an actionable quick-view drawer — built on the Phase 3B read model. No Shoot↔Job bridge migration, no fuzzy linking, no Urgent Window `action_hash` change, no shoot-id-as-job-id, no second Jobs store, no mileage/payroll edits.

---

## 1. Commit ledger

| # | Commit | Subject |
|---|--------|---------|
| 1 | `175dbf4` | docs: audit jobs lifecycle and cleanup candidates |
| 2 | `600b9ee` | feat: add jobs lifecycle reconciliation and archival |
| 3 | `3ed6b9e` | feat: add safe jobs cleanup dry run |
| 4 | `666ab80` | feat: compact and clean the canonical jobs index |
| 5 | `5e45580` | feat: add actionable canonical job quick view |
| 6 | _this commit_ | fix: complete jobs lifecycle and actionability |

Built on (preserved): Phase 2 `74ec2a6`, Phase 3A `0eb44a8`/`897e691`, Phase 3B `11a470c`.

## 2. Jobs population (before → after)

The Demo Studio tenant is entirely fresh synthetic seed data (see `docs/jobs-data-lifecycle-and-cleanup-audit.md`). **No hard deletion was performed and no destructive change occurred** — the population is unchanged except for reversible archival, of which the deterministic policy archived **0** in this data (nothing is outside the recent-completion window).

| | Before | After |
|---|---|---|
| total Jobs | 303 (audit snapshot) | ~311 (live; includes test-created rows) |
| archived | 0 | 0 (0 auto-archived; nothing eligible) |
| canceled | 0 | 0 |
| completed | 3 | 3 |
| hard-purged | — | **0 (none executed)** |

## 3. Default operating-view rules

The canonical index defaults to `lifecycle_scope=active`, which **excludes** archived (`archived_at IS NOT NULL`), canceled, demo/test-fixture-marked (`data_origin IN (seed_demo,test_fixture)`), and historical-completed (complete AND `COALESCE(completed_at,updated_at) < now() - 30d`), while **keeping recently-completed** work visible. Centralized window: `JOBS_RECENT_COMPLETION_DAYS = 30`. Other scopes: `needs_attention | upcoming | waiting | recently_completed | completed | archived | canceled | demo_test | review_required | all`.

## 4. Lifecycle reconciliation rules (`reconcileJobsLifecycle`)

Tenant-scoped, idempotent, **dry-run by default** (apply requires `super_admin|leadership|director_admin`), audited to the activity log, and unable to create Shoot links. One canonical `last_meaningful_activity_at = GREATEST(job, activity-log, workflow, production)`. `classifyJobLifecycle` (pure) → active | upcoming | needs_attention | waiting | recently_completed | historical_completed | canceled | archived | review_required. **A complete-looking Job with open blockers/workflow/production is `review_required` — never auto-archived; age alone never archives.** Safe applies: backfill `completed_at` on a canonically-complete Job lacking it; auto-archive completed/canceled Jobs with zero open work outside the recent window. **Live dry-run: 311 jobs, 0 review_required, 0 auto-archive (all recent).**

## 5. Archival rules & archive/restore behavior

Archive candidate = (complete OR canceled) AND no open workflow AND no open blocker AND no undelivered production AND no active attention AND outside the recent window. `archiveJobLifecycle`/`restoreJobLifecycle`: manage-access RBAC, records `archived_by_user_id` / `archive_reason` (and `restored_at` / `restored_by_user_id`), preserves the legacy `job_status='archived'`, is restorable (restore → `pending_confirmation`), idempotent, audited. An archived Job keeps its `jobs.id` and all history, remains retrievable by direct link, and is excluded from the default active view/counts. The drawer's archive/restore refreshes the index without a reload.

## 6. Purge eligibility & dry-run results

`GET /api/jobs/cleanup/dry-run` (admin-gated, read-only, **no executor/delete**). Purge-eligible **only** if synthetic (`data_origin` seed_demo/test_fixture) AND zero protected dependencies (`workflow_runs, tasks, production_items, staff_assignments, readiness_items, watch_flags, activity_log, job_days, confirmed_shoot_links`). Any protected dependency or age **blocks** purge; duplicates are never merged on title (groups are exact `job_number` only). **Live result: 311 jobs, all `keep_active`, 0 hard-purge candidates, 0 blocked, 0 duplicate groups.**

### 🔒 Hard purge: **NOT executed.** Candidate batch is empty (demo kept, per decision). No production-like data was deleted; the executor is intentionally absent and remains a separately-approved, transactional, backed-up, batch-recorded step.

## 7. Seed/demo prevention

Additive nullable `jobs.data_origin` marker (`seed_demo|test_fixture|import|manual`, CHECK-constrained). Existing rows are left NULL so the Demo Studio operating view stays populated; future seed/test-fixture creation marks rows so they are excluded by default and targetable by the dry-run. Tenant isolation (demo lives only in the Demo Studio tenant) remains the primary guard.

## 8. Canonical metric definitions (Phase 3B, surfaced in the index)

Live: `needs_review` (job_status∈draft,pending_confirmation), `intake_review` (pending_confirmation), `needs_attention` (readiness at_risk/off_track OR risk high/critical), `blocked` (production=blocked OR blocker_count>0 OR open_watch_flag_count>0), `missing_required_details` (incomplete_required>0), `behind_promised_delivery` (deadline past + not delivered), `unowned` (no owner), `active_this_week`, `recently_completed`. **Unavailable** (count null, no CTA): `waiting_on_client`, `date_conflict`. Invariant proven live: **`summary[blocked]=227 === total(?metric=blocked)=227`.**

## 9. Jobs URL/filter contract

URL-backed: `lifecycle_scope, search, department_type, metric, sort, direction, job_status, owner_user_id, shoot_link_status, workflow_link_status, offset, selected, focus`. Refresh, shared links, and Back/Forward restore the view; no sensitive data in URLs.

## 10. Quick-view behavior

In-viewport drawer (`role=dialog`, `aria-modal`), opened from a row (preserves filters/scope/sort/pagination/scroll). Sections: Truth Snapshot; canonical Job-native attention reasons with provenance (unlinked Jobs told which reasons aren't shown); workflow + production capabilities (independent of Shoot link); Operational Shoot (confirmed links → occurrences + exact Open Schedule/Open Staffing; else honest "No Shoot linked"). Safe actions only — Open full detail, Archive/Restore (managers, server-enforced). **Purge is never offered.** Close control focused on open, Escape closes, alert-origin `?focus` scrolls the section, status conveyed as text not color.

## 11. Full-detail changes (Part 8)

Per "do not broadly redesign," the legacy full-detail page (`SharedJobDetailPage`, reached via "Open full detail") is intentionally **left intact** — the canonical index + drawer are the new actionable surface. It remains readable for archived and unlinked Jobs (the index/drawer changes don't alter it). The only cleanup applied was removing a now-dead `archiveJob` import superseded in Commit 2. No dead enabled controls were introduced.

## 12. Permissions

Per-department read scope (`hasReadScope`) applies to **rows and counts**; archive/restore require manage access; reconcile-apply and the cleanup dry-run require an administrative tier; deep-linked `jobs.id` can't bypass access; confirmed Shoot links never expose unauthorized Shoot/staffing data; cross-tenant counts/links/archive/restore/purge are impossible. **Live RBAC: a photographer is 403 on reconcile-apply and cleanup dry-run.** The owner workflow-admin regression remains green.

## 13. Performance

Canonical index: **~34 ms cold / ~21 ms warm, ~124 KB for a 100-row page over 301 jobs.** Fixed query count (summary + filtered-total + rows + one batched link-projection) — no per-row N+1; page size capped at 100; deterministic sort with a `jobs.id` tiebreaker; archived/lifecycle filtering in SQL. Cleanup dry-run over 311 jobs returns in well under a second.

## 14. Browser / live verification

The dev stack ran on `:5173` (web) / `:4000` (API). Verified against the live stack: the default operating view (active=311, archived=0, completed=3), **metric coherence (blocked 227 == filtered total 227)**, reconcile + cleanup dry-runs (0 auto-archive, 0 purge candidates), and RBAC (photographer 403 on admin endpoints); the web root serves HTTP 200. Interactive UI behaviors (drawer open in-viewport, metric/lifecycle filtering, archive/restore refresh, unlinked honesty, accessibility/Escape) are covered by the component suite. _(A full click-through via the preview launcher was constrained by this session's cross-directory setup — the stack was driven via the API + component tests instead.)_

## 15. Test results

- **admin-web:** full suite **499/499 green** (93 files), incl. `jobsIndexPage.test.tsx` (14: index + drawer) and the updated `appAuth` Jobs-route test.
- **API (new/relevant):** `jobsCanonicalIndex` (20), `jobsLifecycle` (13), `jobsCleanup` (7), `jobStatusCounts` (7), `jobTruthLayer` (20) — all green. **Full API suite: 169 of 170 files green.** Files 1–152 ran one-per-process before the fail-fast halt at `timeClockMileagePhase5` (file 153); the 17 tail files (154–170) were then run individually and all passed. The only failures are the **3 pre-existing `timeClockMileagePhase5` assertions** (baseline; no mileage code touched). `urgentWatch` + `urgentWatchSummary` green (no `action_hash` regression); `workflowStateEngine` + `workflowTemplateBuilder` green.
- **Typechecks:** api / worker / admin-web / mobile — exit 0. **Builds:** api / worker / admin-web — exit 0. **Lint:** exit 0 (no workspace lint configured).
- **Pre-existing baseline (untouched, reported separately):** the 3 `timeClockMileagePhase5.test.ts` assertions remain failing on baseline; no mileage code was modified.

## 16. Known limitations

1. The drawer's workflow/production sections show canonical capability + counts + deep links; full step-level detail is one "Open workflow / Open full detail" click away.
2. Department-scoped Jobs lists keep the legacy `SharedJobsPage` shell (by design); only the global `#jobs` route is migrated.
3. An off-page deep-linked `?selected=<id>` not present on the current page is not pre-fetched (row-click selection is the common path).
4. `waiting_on_client` and `date_conflict` remain unavailable (no canonical predicate / Shoot-derived).
5. The demo population is intentionally kept (no purge); the executor is deferred to a separately-approved step.

## 17. Deployment & rollback

- **Migration 158 is additive** (5 nullable columns + 2 indexes); rolling the app back leaves them harmlessly in place — no down-migration needed.
- The global `#jobs` route now renders the canonical index; reverting the `app.tsx` branch restores the legacy page. Legacy `listJobs`/`getJobStatusCounts`/`SharedJobsPage` are retained for the dashboard and department pages.
- Reconcile and cleanup are opt-in endpoints (dry-run default; apply admin-gated); no scheduled job auto-archives or deletes.
- All six commits are individually revertible.

## 18. Phase 3D bridge status

**Not started.** The reviewed Shoot↔Job bridge migration/backfill remains gated on **separate explicit approval**. Runtime Shoot-link state stays `linked|unlinked` only; `proposed/ambiguous/conflict/rejected` await that approved review workflow.
