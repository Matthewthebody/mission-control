# Phase 3C · Part 1 — Jobs Data Lifecycle & Cleanup Audit

**Date:** 2026-06-19
**Branch:** `feature/work-spine-foundation-v1`
**Tenant audited:** Demo Studio `223ee748-3dcd-4837-97a9-8eba7dbb11f2`
**Status:** Read-only audit (Commit 1 of Phase 3C). No data was written. Every count is a live snapshot of a shared dev DB (so absolute numbers drift slightly with test runs; ratios are the load-bearing facts) and is paired with the exact SQL.

---

## 0. Headline

**The entire Demo Studio Jobs population is freshly-seeded synthetic demo data.** All 303 Jobs were created in June 2026, every Job's last meaningful activity falls inside a ~2-week window (`2026-06-04 … 2026-06-19`), and **0 Jobs are stale (>30 days), 0 archived, 0 canceled, and only 3 are complete.** There is therefore **no genuine historical/completed bloat to archive in this tenant** — the "too many Jobs in the operating view" symptom here is that the whole population is demo seed data, not accumulated client history.

Consequences for Phase 3C:
- The **lifecycle reconciliation + archival + purge-dry-run framework** (Commits 2–3) must be built for **correctness and future real tenants**, and proven with **deterministic fixtures** — because this tenant has almost nothing for it to archive.
- The honest near-term wins are already partly in place: the Phase 3B canonical index **already excludes `archived_at IS NOT NULL`** from the default view; Phase 3C adds a **recent-completion window** for completed work and **lifecycle scope filters**.
- **Purge** in this tenant falls under the spec's *disposable demo tenant* exception (the whole population is synthetic). Even so, **no hard deletion happens without an approved candidate batch** (Commit 3 produces the dry-run; the actual executor is gated).

---

## 1. Population report (tenant-scoped; SQL inline)

`\set tid '223ee748-3dcd-4837-97a9-8eba7dbb11f2'`

| Metric | Count | Predicate |
|---|---|---|
| total Jobs | **303** | `jobs WHERE tenant_id=:tid` |
| active (`archived_at IS NULL`) | **303** | + `archived_at IS NULL` |
| archived | **0** | `archived_at IS NOT NULL` |
| draft | **63** | `job_status='draft'` |
| pending_confirmation | **0** | `job_status='pending_confirmation'` |
| in_progress | **6** | `job_status='in_progress'` |
| execution_complete | **3** | `job_status='execution_complete'` |
| canceled | **0** | `job_status='cancelled' OR cancelled_at IS NOT NULL` |
| `completed_at` set | **3** | `completed_at IS NOT NULL` |
| no owner | **287** | `account_owner_user_id IS NULL` |
| no organization | **7** | `organization_id IS NULL` |
| with workflow_run | **65** | `EXISTS workflow_run wr WHERE wr.job_id=j.id` |
| no workflow_run | **238** | `NOT EXISTS …` |
| with production_items | **230** | `EXISTS production_items p WHERE p.job_id=j.id` |
| with confirmed Shoot link | **2** | `legacy_shoot_id IS NOT NULL OR EXISTS job_shoot_links` |
| with open blockers | **225** | `EXISTS job_readiness_items r WHERE r.is_blocker AND NOT r.is_complete` |
| with open watch flags | **226** | `EXISTS job_watch_flags w WHERE w.status IN ('open','acknowledged','snoozed')` |
| with urgent-watch ref (source_entity_id=jobs.id) | **2** | `EXISTS urgent_watch_item u WHERE u.source_entity_id=j.id::text` |
| with activity_log_entries | **285** | `EXISTS activity_log_entries a WHERE a.job_id=j.id` |
| **by department** | sports **232**, schools **71** | `GROUP BY department_type` |
| **by creation year** | 2026 **303** | `extract(year FROM created_at)` |
| **by scheduled year** | 2026 **301**, none **2** | `extract(year FROM scheduled_start_at)` |
| readiness (from §3B) | at_risk 284, on_track 11, ready 2 | `GROUP BY readiness_status` |
| production (from §3B) | queued 154, not_created 67, …, blocked 7 | `GROUP BY production_status` |
| risk / staffing (from §3B) | medium 224 / none 73 · unassigned 289 / staffed 7 | — |
| **stale: no activity >30/90/180/365d** | **0 / 0 / 0 / 0** | see §2 (LMA range = `2026-06-04 … 2026-06-19`) |
| deterministic duplicate `job_number`s | **0** | unique constraint `jobs_tenant_job_number_uq` |
| (org, sched-date, category, dept) groups >1 | 11 groups / 263 extra rows | likely legitimate multi-session sports — see §5 |

---

## 2. `last_meaningful_activity_at` (one canonical derivation)

There is no single reliable "last touched" column, so define LMA as the **GREATEST** of the canonical activity signals that exist today:

```sql
GREATEST(
  j.updated_at,
  j.created_at,
  COALESCE((SELECT max(a.created_at) FROM activity_log_entries a WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id), 'epoch'),
  COALESCE((SELECT max(wr.updated_at) FROM workflow_run    wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id), 'epoch'),
  COALESCE((SELECT max(p.updated_at)  FROM production_items p WHERE p.tenant_id=j.tenant_id AND p.job_id=j.id), 'epoch')
) AS last_meaningful_activity_at
```

This composes Job update + canonical activity log + workflow + production activity. (Future extensions when those records carry job_id: confirmed-Shoot-link activity, delivery activity, communications, operational-issue activity, audit history.) **Result for this tenant: every Job's LMA is within the last ~2 weeks → 0 stale Jobs at any horizon.** Commit 2 implements this in the reconciliation service and persists/reads it consistently.

---

## 3. Data-source classification (lifecycle buckets)

Canonical rules (a Job may also carry data-quality flags in addition to its lifecycle class):

| Class | Deterministic rule (canonical only) |
|---|---|
| **Archived** | `archived_at IS NOT NULL` |
| **Canceled** | `job_status='cancelled' OR cancelled_at IS NOT NULL` |
| **Historical Completed** | completed (`job_status='execution_complete' OR production_status IN ('delivered','complete') OR completed_at IS NOT NULL`) AND `LMA < now() - recent_window` |
| **Recently Completed** | completed AND `LMA >= now() - recent_window` (default window 30d) |
| **Needs Attention** | not completed/canceled AND (`readiness ∈ (at_risk,off_track) OR risk ∈ (high,critical) OR open blockers OR open watch flags OR unowned`) |
| **Waiting / On Hold** | `job_status='weather_hold' OR 'postponed'` (or an explicit hold) and not otherwise attention |
| **Upcoming** | not completed AND `scheduled_start_at > now()` and no attention |
| **Active** | not completed/canceled/archived and otherwise in-flight (`draft, pending_confirmation, confirmed, ready_to_staff, staffed, ready_to_execute, in_progress`) |
| **Demo / Test** *(data-quality flag)* | tenant is a seeded demo tenant OR an explicit demo marker (see §4) |
| **Duplicate Candidate** *(flag)* | see §5 (deterministic only) |
| **Orphaned / Invalid** *(flag)* | `organization_id IS NULL AND no workflow AND no production AND no confirmed link AND no activity_log` (no canonical value) |
| **Review Required** | canonical records conflict OR a safe state cannot be determined (e.g., marked complete but open blockers/workflow remain) |

**This tenant** maps to: ~0 Archived/Canceled, 3 Historical/Recently-Completed (all within window → Recently Completed), the rest Active/Needs-Attention, and **all 303 carry the Demo/Test data-quality flag** (see §4).

---

## 4. Demo/test source audit

Synthetic Jobs in this tenant come from the repository's **demo seed scripts**, not from client activity:

- `packages/api/scripts/seed-mission-control-demo.ts`, `seed.ts`, `seed-project-tracking-demo.ts`, `seed-client-command-center-demo.ts`, `seed-job-closeout-demo.ts`, `reset-local-demo-db.ts`.
- Evidence: 100% created in June 2026; LMA entirely within ~2 weeks; the tenant is named **Demo Studio**.

**There is no explicit per-Job demo/test marker column** on `jobs` today (checked: no `is_demo`/`data_origin`/`source` column). Deleting rows alone is insufficient — `reset-local-demo-db.ts` / the seed path will recreate them.

**Recommended smallest safe prevention (implemented incrementally in Commits 2–3, not here):**
1. Keep demo population **tenant-scoped to the dedicated Demo Studio tenant** (already true) — never seed demo Jobs into a real operating tenant.
2. Add an **additive, nullable `data_origin` marker** (e.g. `seed_demo | test_fixture | import | manual`) so demo/test records are explicitly labeled and excludable from active counts *regardless of tenant*, and so the purge dry-run can target them deterministically. (Smallest additive column; no behavior change for existing rows where it is NULL.)
3. Make the **test/fixture creation repeatable and self-cleaning** (Commits 2–3 fixtures create + tear down their own rows).

---

## 5. Duplicate analysis

**Deterministic signals only** (no title-similarity):

| Signal | Result | Verdict |
|---|---|---|
| exact `job_number` | **0** duplicate job_numbers (unique constraint) | none |
| exact `legacy_shoot_id` | unique constraint | none |
| exact external/source id | **jobs carry no external/source column** (audit §6, convergence audit) | n/a |
| exact `job_legacy_mapping (legacy_table, legacy_record_id)` | unique constraint | none |
| (organization, scheduled date, job_category, department) | **11 groups / 263 extra rows** | **probable, NOT actionable** — almost certainly legitimate multi-session **sports** work (232 of 303 Jobs are sports; many same-org same-day sessions are expected), classified *probable / human-review*, **never auto-merged** |

**Conclusion: 0 deterministic duplicates.** The org+date+category clusters are a sports multi-session pattern, not duplication. No merge is proposed in Phase 3C. Any deterministic merge (a future, explicitly-approved action) selects one survivor, re-associates permitted canonical children transactionally, preserves source ids/aliases/audit + a merge record, and never invents Shoot links.

---

## 6. Archive rules (Commit 2 implements; tested)

A legitimate Job is an **archive candidate** only when ALL hold (canonical):
- completed or canceled (`job_status='execution_complete' OR production_status IN ('delivered','complete') OR completed_at IS NOT NULL OR job_status='cancelled' OR cancelled_at IS NOT NULL`),
- **no open workflow step** (no `workflow_run` in a non-terminal state for the Job),
- **no open blocker** (`incomplete blocker readiness items = 0`),
- **no undelivered production obligation** (`no production_items in a non-terminal status`),
- **no active Needs-Attention reason**,
- outside the recent-completion window (`LMA < now() - recent_window`),
- not violating a retention policy.

Anything completed-looking but with open workflow/blockers/production ⇒ **Review Required**, never auto-archived. **Age alone never archives.** Archival sets `archived_at` (+ the additive `archived_by_user_id` / `archive_reason` from Commit 2), preserves `jobs.id` and all history, and is **restorable**. Default operating view excludes archived (already true in the canonical index).

---

## 7. Hard-purge eligibility (Commit 3 dry-run; executor gated)

**Eligible only when proven disposable:** synthetic demo fixtures, automated-test records in a production-like tenant, abandoned dev records, failed-import orphans, exact deterministic duplicates (after a survivor is chosen), invalid records with **no** operational/financial/client/workflow/production/file/communication/audit value.

**Blocked from hard purge** (any one blocks, absent explicit retention policy + separate approval): confirmed Shoot links, workflow_runs, tasks, production_items, delivery records, files/resources, client communications, financial references, staffing history, audit history, evaluations/surveys, operational issues, legal/tax/retention relevance.

For **this** tenant: the population is synthetic demo (the *disposable demo tenant* exception), but **65 Jobs have workflow_runs, 230 have production_items, 2 have confirmed Shoot links, 285 have activity_log** — i.e. most carry canonical child records that the blocking rules protect. So even under the disposable-tenant exception, a hard purge must be a **recorded, backed-up, batch-approved** operation, not a blind delete.

---

## 8. Dry-run report design (Commit 3)

Machine- + human-readable. Writes **no production data**; stable on re-run against unchanged data. Per candidate: `tenant, job_id, job_number, title, organization, created_at, scheduled_start_at, lifecycle_status, production/readiness/risk_status, owner, last_meaningful_activity_at, proposed_action (keep_active|mark_completed|archive|restore|purge|duplicate_review|manual_review), classification_reason, related_record_counts {workflow_runs, tasks, production_items, files, activity, confirmed_links}, blocking_dependencies, confidence, warnings, stable_source_ids, survivor_job_id (for deterministic dup)`. Plus a roll-up: totals by proposed action, every hard-purge candidate, duplicate groups, blocked candidates, dependency counts, estimated effect.

---

## 9. Acceptance / approval gate

- **Commits 2–3 (reconciliation, archival, dry-run) are safe and proceed in this phase.** They add no destructive behavior; archival is reversible; the dry-run writes nothing.
- **No hard deletion of production-like data occurs without an explicitly approved candidate batch.** The disposable-demo-tenant exception is *available* for Demo Studio, but the executor still requires a dry-run + backup/export + batch record + confirmation that no legitimate client data exists — reported for approval before any deletion.
- **Reaffirmed boundaries:** no Shoot↔Job bridge migration; no fuzzy/auto Job↔Shoot linking; no change to Urgent Window `action_hash`; no shoot-id-as-job-id; no second Jobs store; no mileage/payroll edits.

### Open business questions (need Matthew)
1. Confirm the **recent-completion window** (default 30d) for the operating view.
2. Approve adding the additive **`data_origin`** marker (vs. relying solely on tenant isolation) for demo/test labeling.
3. For Demo Studio specifically: do you want the eventual purge to treat the whole synthetic population as disposable (after dry-run + export), or keep it as a working demo dataset? (Default: keep — build the framework, don't purge the demo.)
