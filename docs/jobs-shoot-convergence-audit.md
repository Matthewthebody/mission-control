# Phase 3A — Jobs / Shoot Convergence Audit

**Date:** 2026-06-19
**Branch:** `feature/work-spine-foundation-v1`
**Status:** Read-only audit. No migration, no broad UI. The only code change recommended here is the smallest honest Urgent Window **label** correction (§10) — never a destination change.
**Method:** Four parallel read-only code-mapping passes (canonical jobs; shoot/scheduling/staffing; workflow/production/urgent; counts/cross-links) plus direct, tenant-scoped Postgres population and candidate-matching queries against the Demo Studio tenant `223ee748-3dcd-4837-97a9-8eba7dbb11f2`. Every population number below is a live snapshot of a shared dev DB (so absolute counts drift slightly with test runs; the **ratios** are the load-bearing facts) and is paired with the exact query.

---

## 0. Headline

There are **two parallel "job-ish" lineages** in the schema that are almost entirely **unlinked in data**:

- the **legacy operational spine** — `shoot` (+ `work_shift`, `shoot_staffing_requirement`, staffing plans, `shoot_day`), which is what scheduling, staffing, attendance, and most urgent issues actually reference (**2,313 shoots**); and
- the **canonical package layer** — `jobs` (+ `job_days`, `job_staff_assignments`, `production_items`, workflow runs), the newer "shared job truth layer" (**301 jobs**).

Only **2 of 2,313 shoots** are linked to any job, and only **2 of 301 jobs** carry a `legacy_shoot_id`. A canonical link table (`job_shoot_links`) **already exists but is empty**. There is **no deterministic signal** to auto-match the rest. Workflow/tasks are the one operational domain that *is* canonically job-linked (63 jobs have workflow runs). **Recommendation:** treat Job as a package/engagement and Shoot as a dated operational occurrence in a **one-Job-to-many-Shoots** model, and build a **reviewed** `job_shoot_links` relationship (Option B) with provenance/status — **no automatic fuzzy backfill**. Until a confirmed link exists, Jobs must honestly show "no operational Shoot linked."

---

## 1. Current objects — purpose, ownership, lifecycle, source of truth

### 1.1 `jobs` — canonical package/engagement (NEW)
- **Purpose / source of truth for:** the client engagement record — department/category, organization, primary location/contact, account owner, title, schedule window, estimates, and the *derived* roll-up statuses.
- **Table:** `jobs` ([089_shared_job_truth_layer_phase1.sql:148](db/migrations/089_shared_job_truth_layer_phase1.sql:148)). Key FKs: `legacy_shoot_id → shoot(id)` UNIQUE ON DELETE SET NULL (:151), `organization_id → organization`, `primary_location_id → shoot_location`, `primary_contact_id → organization_contact`, `account_owner_user_id → app_user`. Status enums: `job_status` (13), `production_status` (~20), `staffing_status` (6), `readiness_status` (off_track|at_risk|on_track|ready), `risk_status` (5), `sync_status`, `priority_level`. Unique `jobs_tenant_job_number_uq (tenant_id, job_number)`.
- **Children (all `job_id → jobs(id)` ON DELETE CASCADE):** `job_days` (:270, canonical events; `legacy_shoot_day_id` UNIQUE→shoot_day), `job_staff_assignments` (:306; `legacy_work_shift_id`/`legacy_shoot_assignment_id`), `job_readiness_items` (:335), `production_items` (:361; `legacy_production_project_id` UNIQUE→production_project), `job_watch_flags` (:394), `school_job_profiles`/`sports_job_profiles` (1:1), `activity_log_entries` (:442), `job_attachment_links` (:420).
- **Services/selectors:** `packages/api/src/services/jobTruth/jobService.ts` — `listJobs` ([:3015](packages/api/src/services/jobTruth/jobService.ts:3015)), `getJobDetail` (:3804), `getJobStatusCounts` (:3296), `hasReadScope` (:1659). `jobStatusEngine.ts` `calculateJobStatusSnapshot` (:181). `dashboardQueryService.ts` `getDashboard` (:241).
- **Mutations:** `createDraftJob`/`updateDraftJob`/`publishJob`/`updatePublishedJob`/`cancelJob`/`postponeJob`/`archiveJob`, `assignJobStaff`, `add/updateJobDay`, `complete/updateReadinessItem`, `createOrUpdateProductionItem` + approvals/qa/deliverables/issues (all jobService.ts).
- **Routes:** `routes/jobs.ts` (router-level `requireAuth` at :616/:622). List `GET /` (:932→listJobs), detail `GET /:jobId` (:1080), `GET /status-counts` (:950), `GET /dashboard/{home,executive,today}` (:859-889), full CRUD + lifecycle (:1095-1577).
- **Permissions:** `job.read`/`create`/`update`/`publish`/`assign_staff`/`manage_readiness` (authz/authority.ts; `getPolicyReadScope`/`hasReadScope` in jobService.ts gate read scope to "all"|"own"|null by department).
- **Lifecycle:** `draft → pending_confirmation → confirmed → ready_to_staff → staffed → ready_to_execute → in_progress → execution_complete` (+ intake_blocked / postponed / weather_hold / cancelled / archived). Derived by `calculateJobStatusSnapshot`.
- **Tests:** `packages/api/tests/jobTruthLayer.test.ts`, `jobStatusCounts.test.ts`, `jobCloseoutV1.test.ts`; admin-web `sharedJobPages.test.tsx`.
- **admin-web:** `SharedJobsPage.tsx` (index), `SharedJobDetailPage.tsx` (detail), `SharedJobEditorPage.tsx`, `services/jobsApi.ts`.

### 1.2 `shoot` — legacy operational occurrence (the real spine)
- **Purpose / source of truth for:** a dated operational shoot occurrence and (historically) the "job" itself — it still carries `job_number`, `job_status`, `job_owner_user_id`, `job_priority`, `merge_parent_job_id`. This is the convergence tension: **migration 084 ("central job intake v1") put job fields ON `shoot`**, *then* migration 089 created the separate `jobs` table.
- **Table:** `shoot` (created [003_phase_one_tables.sql:6](db/migrations/003_phase_one_tables.sql:6); job/intake fields added in [084_central_job_intake_v1_phase1.sql:84-111](db/migrations/084_central_job_intake_v1_phase1.sql:84)). Date columns: `shoot_date` (date), `start_time` (timestamptz), `delivery_due_date`. Status: `status` (legacy enum), `record_state` (draft|published|cancelled|archived), `job_status` (shoot_job_status), `readiness_status`. Source/provenance: `source_reference`, `raw_source_text`, `request_source`. FKs: `organization_id`, `location_id → shoot_location`, `primary_contact_id → organization_contact`, `account_owner_user_id`/`job_owner_user_id → app_user`. Unique `(tenant_id, job_number)`.
- **Children:** `shoot_day` ([084:265](db/migrations/084_central_job_intake_v1_phase1.sql:265)), `work_shift` (`shoot_id` FK, [007:29](db/migrations/007_scheduling_operations.sql:29)), `shoot_staffing_requirement` (`shoot_id` NOT NULL, [061:39](db/migrations/061_staffing_requirements_phase1.sql:39)), `staffing_plan_version`/`staffing_plan_recipient` (`shoot_id` NOT NULL, migration 156).
- **Lifecycle:** `record_state` draft → published → cancelled/archived; soft-delete via `deleted_at`. **Canceling/deleting a shoot does NOT cascade to a job**; `jobs.legacy_shoot_id` is set NULL (ON DELETE SET NULL).
- **Permissions:** `schedule.read`/`schedule.manage`/`schedule.publish` (migration 008; enforced on `routes/schedule.ts`).
- **Tests:** `schedule.test.ts`, `shootLifecyclePhase*.test.ts`, `staffingCapacity*.test.ts`.

### 1.3 "Job packages" / staffing / scheduling
- **Scheduling:** `routes/schedule.ts` (`/calendar`, `/board`, `/staffing-dashboard`, `/capacity`, `/shoots/:id/staffing*`) — all **shoot-scoped**. Services: `scheduleStaffing.ts`, `staffingCapacity.ts`.
- **Staffing publish/ack (Phase 2):** `staffingPlanLifecycle.ts` — `staffing_plan_version` + `staffing_plan_recipient`, **keyed on `shoot_id`** (migration 156/157). Source of truth for who was published + each employee's ack/decline.
- **Three-layer staffing model:** requirements (`shoot_staffing_requirement`) → assignments (`work_shift`) → publication (`staffing_plan_version`/`_recipient`). All anchored on **shoot**, not job.

### 1.4 Workflow instances & tasks — **canonically job-linked**
- **`workflow_run`** (migration 139_shared_workflow_backbone_phase1) carries `job_id NOT NULL → jobs(id)` (UNIQUE per tenant/job/family). **`work_task.related_job_id → jobs(id)`.** Service: `services/projectTracking/workflowEngine.ts` (`listProjectWorkflowCommandCenter`, `healthForJob`, `summarizeProjectWorkflowJobRows`); `services/jobTruth/workTaskService.ts`. Routes: `routes/workflows.ts`, `routes/tasks.ts`.
- **Source of truth:** workflow/task progress for a **job**. This is the one operational domain natively tied to canonical jobs (no shoot involvement).

### 1.5 Production records
- **Canonical job production:** `production_items` (`job_id → jobs`, migration 089/091) — the job's deliverable pipeline; `legacy_production_project_id → production_project`.
- **Legacy project tracking:** `production_project` (used by `services/productionProjects.ts` + the Urgent Window "production" candidates + Project Tracking command center). Linked to jobs **only** via `production_items.legacy_production_project_id`.
- Two production concepts coexist: the job's `production_items` (canonical) and `production_project` (legacy project-tracking).

### 1.6 Delivery records
- `deliverable_items` (`job_id`/`production_item_id`, migration 091/092) — canonical, job-anchored. Managed via `createOrUpdateDeliverableItem` (jobService.ts).

### 1.7 `urgent_watch_item` — the operational exception registry
- **Table** (migration 078; `services/urgentWatch.ts`): `tenant_id, source_module, source_entity_type, source_entity_id (text), watch_type, action_hash, severity, status, owner_user_id, source_snapshot (jsonb), …`. Upsert key `(tenant, source_module, source_entity_type, source_entity_id, watch_type)`.
- **`action_hash` is computed at candidate time and persisted** per row; the Urgent Window reads it back as the exact destination. The candidate map is in §5/§10.
- **Source of truth:** cross-domain "needs attention" issues; **polymorphic** — `source_entity_id` points at shoots, approvals, tasks, production projects, or (rarely) jobs depending on module.

### 1.8 Jobs dashboard summaries
- `dashboardQueryService.getDashboard` summary (jobs_today, jobs_next_7_days, blocked_production_count, delivery_risk_count, blocked_job_count, staffing_gap_count, critical/high_watch_count, …) and `getJobStatusCounts`. Audited in §4.

### 1.9 Job Truth Snapshot
- `calculateJobStatusSnapshot` ([jobStatusEngine.ts:181](packages/api/src/services/jobTruth/jobStatusEngine.ts:181)) derives `{readiness_percent, job_status, production_status, staffing_status, readiness_status, risk_status, blocker_count, open_watch_flag_count}` from the job + its days, readiness items, staff assignments, production items, approvals, QA, deliverables, issues, and watch flags. **Pure derivation over canonical job children — no shoot inputs.**

---

## 2. Intended domain semantics (recommended answers)

| Question | Recommended answer (for review) |
|---|---|
| Is **Job** a package/engagement? | **Yes.** It owns the client commitment, billing/service package, and the derived roll-up. |
| Is **Shoot** a dated operational occurrence? | **Yes.** It owns the schedule, staffing, attendance, and on-the-day execution. |
| One Job → many Shoots? | **Yes** — must be supported (school year = many picture/makeup/retake days; sports = many sessions). The 2,313:301 shoot:job ratio makes 1:1 untenable. |
| One Shoot → many Jobs? | **Generally no** (a shoot belongs to one engagement), but allow the link table to *represent* it rather than a hard FK, to avoid a premature constraint. |
| Retakes / makeup / alt dates / multi-day / sports sessions / yearbook / production-only | Each is a **Shoot (occurrence)** (or a `job_day`/production_item for production-only) under **one Job**, distinguished by a `relationship_type` on the link. |
| Deleting/canceling a Shoot affects the Job? | **No cascade.** Today `legacy_shoot_id`→NULL; the Job persists. A Job's operational readiness should *derive* from its currently-linked, non-canceled Shoots. |
| Job before its first Shoot? | **Yes** — a Job can exist unscheduled (intake/draft) with zero Shoots. |
| Shoot without a Job? | **Yes, legitimately** — 2,311 shoots exist with no Job today; the model must tolerate unlinked Shoots indefinitely. |
| Who owns… | **client commitment, billing/service package, promised delivery, communications → Job.** **schedule, staffing, workflow-of-execution, on-day production → Shoot** (workflow-of-package → Job, via `workflow_run.job_id`). |

**Do not lock a 1:1 model** on the strength of `legacy_shoot_id` (UNIQUE) — that column encodes a *backfill* assumption, not the domain. The data (many shoots per engagement) and the existing `job_shoot_links` table both point to one-to-many.

---

## 3. Population report (tenant `223ee748…`, `CURRENT_DATE = 2026-06-19`)

| Metric | Count |
|---|---|
| total canonical Jobs | **301** |
| active Jobs (`archived_at IS NULL`) | **301** (0 archived) |
| total Shoots (`deleted_at IS NULL`) | **2,313** |
| upcoming Shoots (`shoot_date >= today`) | **1,987** |
| Jobs with `legacy_shoot_id` | **2** |
| `job_shoot_links` rows | **0** |
| `job_legacy_mapping` rows (legacy_table='shoot') | **2** |
| Shoots linked to a Job by **any** path | **2** |
| Jobs with **0** linked Shoots | **299** |
| Jobs with **1** linked Shoot | **2** |
| Jobs with **multiple** linked Shoots | **0** |
| urgent_watch rows (total) | **2,238** |
| urgent rows whose `action_hash` points at `#jobs` | **0** |
| urgent rows whose `source_entity_id` is a real `jobs.id` | **3** (0.13%) |
| urgent rows whose `source_entity_id` is a real `shoot.id` | **1,674** |
| Jobs (301) with a `workflow_run` (canonical job↔workflow) | **63** (all 63 reference real jobs) |

**urgent_watch by source_module / entity type:** `scheduling`/shoot **1,722** · `production`/production_project **254** · `attendance`/shift_attendance_runtime **160** · `workflow`/workflow_acknowledgement **66** · `approvals`/operational_approval_request **36**.

**Reproducible queries** (run via `docker exec … psql -U postgres -d pmc`, `\set tid '223ee748-3dcd-4837-97a9-8eba7dbb11f2'`):

```sql
-- core population
SELECT count(*) FROM jobs WHERE tenant_id=:'tid';                                   -- 301
SELECT count(*) FROM jobs WHERE tenant_id=:'tid' AND archived_at IS NULL;           -- 301
SELECT count(*) FROM shoot WHERE tenant_id=:'tid' AND deleted_at IS NULL;           -- 2313
SELECT count(*) FROM shoot WHERE tenant_id=:'tid' AND deleted_at IS NULL AND shoot_date >= CURRENT_DATE; -- 1987
SELECT count(*) FROM jobs WHERE tenant_id=:'tid' AND legacy_shoot_id IS NOT NULL;   -- 2
SELECT count(*) FROM job_shoot_links WHERE tenant_id=:'tid';                        -- 0
-- shoots linked by any path
SELECT count(DISTINCT s.id) FROM shoot s WHERE s.tenant_id=:'tid' AND s.deleted_at IS NULL AND (
  EXISTS(SELECT 1 FROM jobs j WHERE j.tenant_id=:'tid' AND j.legacy_shoot_id=s.id)
  OR EXISTS(SELECT 1 FROM job_shoot_links l WHERE l.tenant_id=:'tid' AND l.shoot_id=s.id)
  OR EXISTS(SELECT 1 FROM job_legacy_mapping m WHERE m.tenant_id=:'tid' AND m.legacy_table='shoot' AND m.legacy_record_id=s.id)); -- 2
-- urgent breakdown
SELECT source_module, source_entity_type, count(*) FROM urgent_watch_item WHERE tenant_id=:'tid' GROUP BY 1,2 ORDER BY 3 DESC;
SELECT count(*) FROM urgent_watch_item u WHERE u.tenant_id=:'tid' AND EXISTS(SELECT 1 FROM jobs j WHERE j.tenant_id=:'tid' AND j.id::text=u.source_entity_id);   -- 3
SELECT count(*) FROM urgent_watch_item u WHERE u.tenant_id=:'tid' AND EXISTS(SELECT 1 FROM shoot s WHERE s.tenant_id=:'tid' AND s.id::text=u.source_entity_id);  -- 1674
SELECT count(*) FROM workflow_run WHERE tenant_id=:'tid' AND job_id IS NOT NULL;    -- 63
```

---

## 4. Audit of current Jobs summaries

| Label | Source (file) | Predicate | Jobs-only? | State |
|---|---|---|---|---|
| `getJobStatusCounts.total_active` | jobService.ts:3296 | `jobs WHERE archived_at IS NULL AND department ∈ readable` | **Yes** | live |
| `.behind` / `.at_risk` | :3318/:3319 | `readiness_status = 'off_track'` / `'at_risk'` | **Yes** | live |
| `.blocked_production` | :3320 | `production_status = 'blocked'` | **Yes** | live |
| `.high_risk` / `.staffing_gap` | :3321/:3322 | `risk_status IN (high,critical)` / `staffing_status='gap_flagged'` | **Yes** | live |
| `getDashboard.jobs_today` | dashboardQueryService.ts:248 | `listJobs(day_date=today)` | **Yes** | live |
| `.jobs_next_7_days` | :292 | `jobs JOIN job_days date∈[today,+7]` | Yes (jobs+job_days) | live |
| `.blocked_production_count` | :296 | production queue `blocked` | mostly jobs | live |
| `.delivery_risk_count` | :298 | deliverable/approval risk | **mixed** (production+approval items, not distinct jobs) | live |
| `.overdue_approval_count` | :297 | approval queue overdue | mixed | live |
| `.blocked_job_count` | :304 | distinct `job_id` from blocked checklist items | Yes (distinct jobs) | live |
| `.critical/high_watch_count`, `.staffing_gap_count`, `.missing_ready_confirmation_count` | :294-300 | `job_watch_flags` filters | watch-flag derived (job-anchored) | live |
| Company Command **On Fire** | homeDemoData.ts:209 | `/api/exceptions` open count | **mixed** (urgent_watch, mostly shoots) | live |
| **Jobs Behind** / **Production Load** | homeDemoData.ts:254/273 | `getJobStatusCounts.behind` / `.blocked_production` | **Yes** | live (Phase 3 Slice 1) |
| Shoots Today / Staffing Risk / Late | homeDemoData.ts:224-251 | static | n/a | **sample** (badged) |
| Weather Watch / Client Issues | homeDemoData.ts:263/283 | none | n/a | **unavailable** (badged) |
| SharedJobsPage `buildJobManagementStats` / `attentionCount` / intake queue | SharedJobsPage.tsx:507-532,685 | client-side over the fetched jobs list | Yes (jobs) | live (subject to the page's 200-row window — see phase3-jobs-actionability-audit.md) |
| ProjectTracking `total_blocked` / `total_running_late` | workflowEngine.ts:4352-4353 | `workflow job_rows` health | **workflow-scoped jobs** | live |
| Urgent Window **"Jobs / Workflow"** category | urgentWindow.ts:30,115-122 | `source_module ∈ {approvals, workflow}` + scheduling-non-staffing | **mixed → mislabeled (see §10)** | live |

**No clearly-fake job count requires disabling.** The "Jobs Behind"/"Production Load" cards are honest canonical-jobs counts; sample/unavailable cards are badged. The one **mislabeled** surface is the Urgent Window category (§10).

---

## 5. Cross-link audit

| Link path | Join column / FK | Classification |
|---|---|---|
| **Job → Shoot** | `jobs.legacy_shoot_id → shoot(id)` UNIQUE (089:151) | **legacy/compatibility** (1:1 backfill bridge; 2 rows) |
| **Job → Shoot** (alt) | `job_legacy_mapping(legacy_table='shoot', legacy_record_id)` (089:216) | **legacy** (mirror of the above; 2 rows) |
| **Job ↔ Shoot** (intended) | `job_shoot_links(job_id, shoot_id, link_reason)` (097:270) | **canonical-but-unused** (table exists, **0 rows**; minimal — lacks type/status/provenance) |
| **Shoot → Job** | `shoot.merge_parent_job_id` | **ambiguous** — column name says "job" but references **shoot(id)** (shoot-merge, not a job link); no true `shoot.job_id` exists |
| **Job → Workflow** / **Workflow → Job** | `workflow_run.job_id → jobs(id)` NOT NULL (139) | **canonical** (63 runs, all real) |
| **Shoot → Workflow** | none direct | **missing** (only via legacy `shoot → jobs.legacy_shoot_id → workflow_run`, 2 shoots) |
| **Job → Production** | `production_items.job_id → jobs(id)` (089:361) | **canonical** |
| **Shoot → Production** | none direct; `production_items.legacy_production_project_id → production_project`; shoot carries only `production_required`/`delivery_type` | **legacy/inferred** |
| **Urgent → Job** | `urgent_watch_item.source_entity_id` (polymorphic; workflow rows resolve a job via `workflow_run.job_id` in source_snapshot) | **inferred/ambiguous** (no FK; 3/2,238 rows match a real jobs.id) |
| **Urgent → Shoot / task / approval / production** | `source_entity_id` per `source_entity_type` | **polymorphic, no FK** (1,674 rows match a real shoot.id) |

---

## 6. Candidate-matching dry-run (read-only; **no data written**)

Goal: could the 299 unlinked Jobs be auto-matched to Shoots? **Finding: there is no reliable deterministic signal in this data.**

| Signal | Result | Verdict |
|---|---|---|
| Explicit legacy id (`legacy_shoot_id` / `job_legacy_mapping`) | 2 Jobs already linked | **exact deterministic** — but only 2 |
| Shared `job_number` namespace | 240 Jobs have a job_number, 144 Shoots have one, **0** Jobs' job_number matches **any** Shoot's; **0** shared distinct job_numbers | **no candidate** — disjoint namespaces (jobs `SCH-YYYY-NNNNN`; shoots use the 084-era numbering) |
| Stable external/source id | **Jobs have NO external/source column**; shoots have `source_reference`/`raw_source_text`/`request_source` | **no candidate** — no shared key |
| organization_id + date (`scheduled_start_at::date = shoot_date`) | of 292 scoped Jobs: **0 exact-one**, **46 ambiguous (multiple shoots)**, **246 no candidate** (9 excluded: missing org/date) | **0 deterministic, 46 ambiguous, 246 none** |
| Normalized title / fuzzy name | not run as an auto-linker | **forbidden as sole signal** (false-positive risk) |

**Candidate queries** (illustrative):
```sql
SELECT count(DISTINCT j.id) FROM jobs j WHERE j.tenant_id=:'tid' AND j.job_number IS NOT NULL
  AND EXISTS(SELECT 1 FROM shoot s WHERE s.tenant_id=:'tid' AND s.deleted_at IS NULL AND s.job_number=j.job_number);  -- 0
WITH cand AS (SELECT j.id, count(DISTINCT s.id) n FROM jobs j
  LEFT JOIN shoot s ON s.tenant_id=j.tenant_id AND s.deleted_at IS NULL
    AND s.organization_id=j.organization_id AND s.shoot_date = j.scheduled_start_at::date
  WHERE j.tenant_id=:'tid' AND j.archived_at IS NULL AND j.organization_id IS NOT NULL AND j.scheduled_start_at IS NOT NULL
  GROUP BY j.id)
SELECT count(*) FILTER (WHERE n=1) one, count(*) FILTER (WHERE n>1) ambiguous, count(*) FILTER (WHERE n=0) none FROM cand; -- 0 / 46 / 246
```

**Candidate classification for a future bridge:** *exact deterministic* = explicit legacy id only (2). *high-confidence, human review* = org + exact date + matching department + single shoot (none in this tenant today). *ambiguous* = org + date with multiple shoots (46). *conflict* = same shoot matching multiple jobs (none). *no candidate* = 246+. **False-positive risks:** org+date alone collides for recurring/large districts (46 ambiguous prove this); title/name fuzzy matching across a 2,313-shoot population would generate large false-positive volume. **Auto-linking is not safe; every link must be human-confirmed.**

---

## 7. Relationship design recommendation

**Recommend Option B — a reviewed `job_shoot_links` relationship table — and do NOT adopt a 1:1 `job_id`-on-shoot model.**

- **Option A (`shoot.job_id`)** is appropriate only if every Shoot belongs to at most one Job and the relationship is simple. The data contradict the simplicity assumption (2,313 shoots, multi-occurrence engagements, 46 ambiguous matches) and a hard FK would force premature, possibly-wrong links and offers no provenance/review state. **Reject.**
- **Option B (`job_shoot_links`)** is preferred: Jobs contain multiple Shoots, legacy links need provenance, and review states are required. **The table already exists** ([097:270](db/migrations/097_shared_production_board_foundation.sql:270)) but is minimal (`job_id, shoot_id, link_reason, created_at`) and empty. Phase 3D (not now) should **extend** it (or add a successor) with: `relationship_type` (primary | makeup | retake | additional_day | production_only | …), `source` (legacy_backfill | manual | suggested), `status` (proposed | confirmed | rejected), `confidence`/`reason`, `linked_by`, `linked_at`, legacy source identifiers, and audit history — and enforce uniqueness appropriate to the confirmed cardinality.

**No implementation in Phase 3A.** This is a recommendation pending approval (§11).

---

## 8. Source-of-truth boundary (recommended)

- **Canonical on Job:** client commitment, organization/contact, service/billing package, promised delivery, communications, package-level workflow (`workflow_run.job_id`), the derived Job Truth Snapshot.
- **Canonical on Shoot:** the dated occurrence, schedule, staffing requirements/assignments/publication+ack, attendance, on-the-day readiness and execution.
- **Job derives from linked Shoots** (only when a **confirmed** link exists): scheduled date(s), staffing coverage/at-risk, shoot readiness, on-day alerts.
- **Shoot derives from Job:** the owning engagement/account context and package metadata.
- **Never copy between them:** staffing assignments, attendance, ack state, schedule times (reference by link; do not duplicate). Status enums must not be blindly mirrored (the 084 job-fields-on-shoot duplication is the anti-pattern to retire, not extend).
- **Stale/conflict detection:** a derived value must record the `job_shoot_links.id` + a snapshot/asof it derived from; mismatch vs the live Shoot ⇒ flagged stale, never silently shown.
- **Quick-view before a link exists:** Job package facts only (org, package, promised delivery, package workflow) + an explicit "no operational Shoot linked" state — **no** staffing/schedule/shoot-readiness cards.

---

## 9. Honest interim product behavior (until a confirmed link exists)

- Jobs must **not** display staffing, schedule, Shoot readiness, or Shoot-derived alerts as if connected.
- The Job drawer shows **"No operational Shoot linked"** / **"Operational relationship not yet established."**
- A Shoot must **not** show an "Open Job" action without a confirmed Job link.
- **Urgent Window destinations remain their current exact operational destinations** (`#scheduling`, `#production`, `#tasks/<id>`, `#people-ops/approvals`, `#operations/attendance`); **no `action_hash` is rewritten to a generic Jobs link.**

---

## 10. Urgent Window category truth

The Urgent Window **"Jobs / Workflow"** category ([urgentWindow.ts:30](packages/admin-web/src/home/urgentWindow.ts:30)) is fed by `source_module ∈ {approvals, workflow}` plus scheduling rows that aren't staffing-typed ([:115-122](packages/admin-web/src/home/urgentWindow.ts:115)). In the live data that is **~36 approvals + 66 workflow + the remaining scheduling/shoot rows** — i.e. overwhelmingly **shoot, approval, and workflow** records, with **~0 canonical jobs** (0 of these rows point at `#jobs`). The label **"Jobs / Workflow" overclaims "Jobs."**

**Decision (smallest honest correction):** rename the **display label** only — `"Jobs / Workflow" → "Operational Work / Workflow"` — keeping the internal key `jobs_workflow`, all destinations, the `deriveUrgentWindowCategory` mapping, and the filter URLs unchanged. This is a single string; no test asserts the label (the tests assert the *key*), so blast radius is nil. A fuller split (Jobs / Scheduling-Shoots / Workflow-Tasks / Approvals / Production) is deferred — it would change the category key, the filter vocabulary, and tests, which exceeds "smallest honest correction." Implemented in a separate tiny commit alongside this audit.

---

## 11. Acceptance gate

- **Recommended domain relationship:** Job = package/engagement; Shoot = dated operational occurrence; **one Job → many Shoots**; Shoot may exist without a Job; Job may exist without a Shoot.
- **Schema recommendation:** extend the existing `job_shoot_links` (Option B) with relationship_type / source / status(proposed|confirmed|rejected) / confidence / linked_by / linked_at / legacy ids / audit. **No `shoot.job_id`.**
- **Migration/backfill recommendation:** a future, additive migration to extend `job_shoot_links`; **backfill only the 2 deterministic legacy links automatically**; everything else enters as `proposed` for human confirmation. **No fuzzy auto-linking.**
- **Pilot scope (Phase 3D, approval-gated):** a reviewed bridge UI that proposes candidates (org + exact date + department, single-shoot only) and requires explicit human confirm/reject; start with one department.
- **Unresolved business questions (need Matthew):** (a) Is one-Job-to-many-Shoots correct for schools/sports as modeled? (b) Should the legacy `shoot.job_number`/`job_status` fields be formally retired, or kept as read-only legacy? (c) For production-only work, is the unit a Job with `production_items` (no Shoot), or a Shoot? (d) Do we ever need Shoot→multiple Jobs?
- **Explicit approval gate:** **Phase 3B (canonical Jobs read model) may proceed after this commit. Phase 3D (the Shoot↔Job bridge migration/backfill) must NOT begin without separate explicit approval.**

### Proposed Phase 3B contract (for the next slice)
A canonical-jobs-only read model where **every summary count equals its filtered Jobs result set**, with URL-backed search/filter/sort, real zero/error/loading states, no demo fallback, stable `jobs.id` selection, department/RBAC scoping, a realistic-scale test, and explicit operational-link state fields: `operational_link_status` (linked | unlinked | ambiguous | proposed), `linked_shoot_count`, `primary_linked_shoot_id` (only when confirmed), `operational_data_available`, `operational_link_explanation`. **No Shoot-derived data is fabricated for unlinked Jobs.** Commit: `feat: make canonical jobs summaries and filters truthful`.
