# Mission Control — Scout A: Source-of-Truth & System-Coherence Audit

**Date:** 2026-07-08
**Scope:** Full-system audit — is Mission Control one connected operating system with one logical source of truth, or disconnected modules with duplicated records and competing truths?
**Repo:** `C:\Dev\Codex-integrated-baseline-clean`, branch `feature/work-spine-foundation-v1`, HEAD `fe5853e8`, clean tree.
**Method:** Read-only. Direct reads of `db/migrations` (166 migrations), `packages/api/src` (routes + services), `packages/admin-web/src`, prior audit docs; plus read-only queries against the local Postgres (`docker exec … psql`, database `pmc`). Four parallel code-mapping passes were used; every headline claim below was independently spot-verified by direct file read or live query. Claims not personally re-verified are tagged **[sub-audit pass]**. Unknowns are tagged **[unverified]**.

---

## 0. Executive summary

Mission Control is **two operating systems sharing one directory**.

- The **directory layer** (organization / school / district / contact / location) and the **labor layer** (time sessions → payroll periods → pay codes → QuickBooks scaffold) are genuinely canonical: single tables, real foreign keys, single write owners, honest snapshots.
- The **work layer** — the thing the company actually runs on — exists **twice**: the legacy operational spine (`shoot` + `work_shift` + staffing plans; **2,709 rows** live) and the canonical package layer (`jobs` + `job_days` + `production_items`; **93 rows** live), with the bridge tables **empty** (`job_shoot_links`: 0 rows, `job_legacy_mapping`: 0 rows; live counts, 2026-07-08). Scheduling, staffing, attendance, labor, leadership dashboards, and location intelligence all read the `shoot` spine; the Jobs workspace, job closeout, client command center, project tracking, and the Microsoft 365 integrations all read the `jobs` spine. These two halves of the product do not see each other.
- On top of that split: **three different job-status vocabularies live in the same database**, **two payroll review surfaces**, **three mileage models**, **three time-table writer services**, **three production-progress models**, **five independent alert registries**, and **two person tables** (`app_user`: 220 rows, `user_account`: 185 rows).

The June-19 convergence audit (`docs/jobs-shoot-convergence-audit.md`) diagnosed the central split precisely and recommended a reviewed `job_shoot_links` model. As of HEAD, **that recommendation is documented, not implemented**: the link table is still empty and both intake paths are still mounted.

---

## 1. Evidence base (what was checked)

- **Live DB counts (read-only, 2026-07-08, db `pmc`):** `shoot` 2,709 · `jobs` 93 · `job_shoot_links` 0 · `job_legacy_mapping` 0 · `app_user` 220 · `user_account` 185 · `organization` 64 · `school_profile` 17 · `contact` 196 · `organization_contact` 194 · `work_shift` 2,022 · `time_session` 389 · `mileage_claim` 0 · `mileage_reimbursement` 6 · `production_project` 11 · `production_items` 6 · `workflow_step` 70 · `alert_events` ~1,942 · `alert` 0 · `pay_code` 128 · `payroll_period` 1 · `school_job` 0 · `school_work_item` 128 · `post_shoot_evaluation` 31.
- **Live enum inspection (pg_enum):** three job-status vocabularies coexist —
  - `shoot.status` → enum `shoot_status`: `DRAFT, TENTATIVE, CONFIRMED, READY, LIVE, SHOOT_COMPLETE, POST_PRODUCTION, COMPLETE, ON_HOLD, CANCELLED`
  - `shoot.job_status` → enum `shoot_job_status`: `new, confirmed, scheduled, in_progress, in_production, complete, cancelled`
  - `jobs.job_status` → enum `job_status_type`: `draft, intake_blocked, pending_confirmation, confirmed, ready_to_staff, staffed, ready_to_execute, in_progress, execution_complete, postponed, weather_hold, cancelled, archived` (`db/migrations/089_shared_job_truth_layer_phase1.sql:27-44`)
- **API grep census:** 41 service/route files query `FROM shoot`, 30 query `FROM jobs`, 3 query `FROM school_job` (`src/services/schoolsHub.ts`, `schoolsHubAutomation.ts`, `schoolsHubMonday.ts`), 12 query `production_project`, 18 query `production_items`, 34 query `app_user`, 4 query `user_account` (`access.ts`, `auth.ts`, `microsoftEntra.ts`, `securitySession.ts`).
- **Route mounts:** `packages/api/src/app.ts:191-247` (57 mounts; five routers share the `/api/shoots` prefix — lines 193-197 — plus `/api/shoots/intake` at 192 and `/api/shoots/date-change-requests` at 219; `/api/jobs` at 234; three production mounts at 220/230/231).

---

## 2. SOURCE-OF-TRUTH MAP

Legend — **Risk:** LOW / MED / HIGH / CRITICAL. "Write owner" = service(s) that INSERT/UPDATE.

### 2.1 Organization / account
- **Canonical:** `organization` (`db/migrations/028_canonical_organization_directory.sql:24`), org layer extended by migration 144: `parent_organization_id` self-FK with self-reference CHECK (`144_client_command_center_v1.sql:139,157`), `client_entity_kind`, unique `(tenant_id, parent, normalized_canonical_name)` index (`144:286`).
- **Write owner:** `packages/api/src/routes/organizations.ts` → `services/organizations.ts`, `organizationAtomicCreate.ts`, `organizationHierarchy.ts` **[sub-audit pass]**.
- **Read consumers:** intake, jobs canonical index, schools hub, client command center, leadership.
- **Competitors:** none structural. `shoot.unresolved_organization_name` (text) exists as an honest fallback, gated at publish (`services/centralJobIntake.ts:562` — `organization_required`).
- **Risk: LOW.** Action: none; this is the model layer done right.

### 2.2 School
- **Canonical:** `organization` row + `school_profile` extension keyed 1:1 on `organization_id` PK (`071_school_foundation_phase1.sql:65-66`), backfilled from organizations in the same migration (071:145-172). Service term: `school_service_term` (`160_school_service_term.sql:9`).
- **Legacy competitors:** `school_job` (`072_schools_hub_work_engine_phase2.sql:121`; **0 rows** live but still queried by 3 services) and `school_work_item` (072:149; **128 rows live**) — the Schools Hub work engine predates the canonical jobs layer and holds its own work items to this day.
- **Risk: MED.** Action: fold `school_work_item` into the canonical task model (`work_task`, migration 103) or declare it a Schools-Hub-only cache; delete `school_job` reads.

### 2.3 District
- **Canonical:** `organization` with `parent_organization_id` (migration 144). School→district is parent-scoped in intake cascade. No competing district table found.
- **Risk: LOW.**

### 2.4 Contact
- **Canonical (two layered tables, both live):** `organization_contact` (`028:52`, 194 rows) = the org-scoped relationship record; `contact` (`161_canonical_contact_identity.sql:10`, 196 rows) = reusable person identity added 2026-06-21. Relationship history: `organization_contact_relationship` (`053:50`), `location_contact_link` (`053:64`).
- **Write owner:** `services/organizations.ts` + `services/canonicalContacts.ts` **[sub-audit pass]**.
- **Denormalized copies still on the spine:** `shoot.primary_contact_name / primary_contact_phone / primary_contact_email / secondary_contact_*` (text) coexist with `shoot.primary_contact_id` FK (live column list, table `shoot`). `jobs.contact_override_note` also exists (`089:…`, live column list, table `jobs`).
- **FK inconsistency:** `jobs.primary_contact_id → organization_contact` (089), `shoot_date_change_request.requested_by_contact_id → organization_contact` (`164:20`) — i.e., the new-in-161 `contact` identity table is NOT what work records point at. Identity vs relationship split is by convention, not schema-wide.
- **Risk: MED.** Action: declare `contact` the identity root, keep `organization_contact` as relationship edge, and migrate the text contact columns on `shoot` to read-only display cache.

### 2.5 Location & sub-location / free-text detail
- **Canonical:** `shoot_location` + `shoot_location_area` + `shoot_location_alias` + `shoot_location_link` (`013_shoot_locations.sql:1-52`, 43 rows), maps/attachments (153), communication-ready fields (152).
- **Denormalized copies:** `shoot.location_name`, `shoot.location_address` (text) coexist with `shoot.location_id` FK (live column list). `shoot.unresolved_location_name` is the honest-fallback column, publish-gated (`centralJobIntake.ts:618`, `MISSING_LOCATION`).
- **Sub-location:** room/area is deliberately dated free text (`155_add_school_profile_specific_area.sql`), captured in the dated commitment — this is a documented, intentional design (see 163 below). Correct.
- **Risk: LOW-MED.** Action: make `shoot.location_name/address` write-once display cache refreshed from `shoot_location`.

### 2.6 Job (package/engagement)
- **Canonical (intended):** `jobs` (`089_shared_job_truth_layer_phase1.sql:148`) with `legacy_shoot_id UNIQUE → shoot(id)`, derived statuses computed by ONE engine: `services/jobTruth/jobStatusEngine.ts:181` (`calculateJobStatusSnapshot`). Write owner `services/jobTruth/jobService.ts:2095` (`INSERT INTO jobs`); routes `routes/jobs.ts:1166` (`POST /drafts`), `:1202` (publish).
- **Actual dominant record:** `shoot` — migration 084 put job fields directly ON `shoot` (`job_number`, `job_status`, `job_owner_user_id`, `job_priority`, `merge_parent_job_id`, `record_state`; `084_central_job_intake_v1_phase1.sql:84-111` per convergence audit §1.2), and central job intake writes shoots: `services/centralJobIntake.ts:1940` (`INSERT INTO shoot`).
- **The linkage is empty:** `job_shoot_links` (`097_shared_production_board_foundation.sql:270`) — **0 rows**; `job_legacy_mapping` (`089:216`) — **0 rows**; only 2 of 2,313 shoots were linked at the June-19 audit and nothing has changed.
- **Naming collision made literal:** `shoot_date_change_request.job_id uuid REFERENCES shoot(id)` (`164_shoot_date_change_request.sql:15`) — a column named `job_id` whose FK target is `shoot`, with the comment "the canonical Job id where the shoot is a published central-intake job". In the intake world, "Job" *means* a published shoot row; in the jobTruth world, "Job" means a `jobs` row.
- **Risk: CRITICAL.** Action: adopt the convergence audit's Option B (Job = engagement, Shoot = dated occurrence, reviewed one-to-many `job_shoot_links` with provenance) and make one intake path the only creator.

### 2.7 Shoot (dated occurrence)
- **Canonical:** `shoot` (`003_phase_one_tables.sql:6`) + `shoot_day` (`084:265`) + `shoot_school_detail`/`shoot_sports_detail` (084:210/238) + `shoot_readiness_item` (084:394) + `shoot_activity_log` (084:470).
- **Dated commitment:** `shoot.dated_commitment jsonb` (migration 163) — versioned snapshot (schema_version:1) of org/contact/location/service-term captured at publish, written at `services/centralJobIntake.ts:3324` **[sub-audit pass]**; FKs stay live. This is the best historical-memory pattern in the codebase.
- **Duplicate concept:** `job_days` (`089:270`) mirrors `shoot_day` (64 vs 24 rows live, unlinked).
- **Statuses:** FOUR status-ish columns on one row — `status` (shoot_status), `job_status` (shoot_job_status), `readiness_status` (shoot_readiness_status), `record_state` (shoot_record_state) — verified via pg_attribute.
- **Risk: HIGH** (as the victim of 2.6). Audit trail: `shoot_activity_log`, `status_events` route, date-change event log (164) — good.

### 2.8 Task / assignment
- **Canonical task:** `work_task` (`103_shared_work_model_task_layer.sql:32`, `related_job_id → jobs`) — **0 rows live**; `workflow_run_task`/`workflow_step` (139/141) carry workflow tasks (70 workflow_step rows). Schools Hub still uses its own `school_work_item` (128 rows). Three task-ish registries.
- **Assignment:** `work_shift` (`007_scheduling_operations.sql:26`, 2,022 rows — the real assignment record) vs `job_staff_assignments` (`089:306`, 5 rows) vs legacy `shoot_assignment` (`003:28`, 0 rows). Assignment status enums duplicated across ≥4 files: `domain/staffing/staffing-assignment-status.ts:1`, `domain/jobTruth/index.ts:260/264`, `types/sports.ts:72`, inline lifecycle in `services/scheduleStaffing.ts:1287` (`mapShiftStatusToStaffingAssignmentLifecycle`) **[sub-audit pass, file names spot-confirmed]**.
- **Risk: HIGH.** Action: `work_shift` is the truth; make `job_staff_assignments` a projection or drop it.

### 2.9 Staff member / photographer / user
- **Two person tables, both populated:** `app_user` (`001_init.sql:55`, 220 rows) — the FK target for shoots, shifts, time sessions, labor, evaluations; `user_account` (`005_auth_access_model.sql:4`, 185 rows) — used by `services/auth.ts`, `access.ts`, `microsoftEntra.ts`, `securitySession.ts`. The auth identity and the operational person are different rows in different tables, related by convention. **[relationship mechanism unverified — no FK between them was located]**
- **Labor is anchored correctly:** every 165/166 table FKs `app_user` (`165_labor_command_center_phase1.sql:93,140,181,254`), so the new Labor Command Center did NOT invent a third staff concept. Pay identity: `employee_pay_profile` + `quickbooks_employee_mapping` (`165:251`).
- **Risk: MED.** Action: document/enforce the app_user↔user_account bridge or merge.

### 2.10 Schedule shift
- **Canonical:** `work_shift` + `shift_segment` + `shift_punch` (007). Write owners: `services/scheduling.ts` (sole writer of `shift_segment`, scheduling.ts:388) and `services/scheduleStaffing.ts` **[sub-audit pass]**. Staffing publish/ack truth: `staffing_plan_version`/`staffing_plan_recipient` keyed on `shoot_id` (migrations 156/157; `services/staffingPlanLifecycle.ts:325`).
- **Risk: LOW-MED** — coherent, but shoot-anchored only; invisible to the `jobs` spine.

### 2.11 Time session
- **Canonical:** `time_session` / `time_segment` / `clock_event` (`034_time_clock_labor_phase1.sql:137`; `employee_id → app_user` 034:140, `source_shift_id → work_shift` 034:142, `linked_shoot_id → shoot` 034:158, `linked_location_id → shoot_location` 034:159). Correctly threaded through the operational spine.
- **Competing writers:** `services/attendance.ts:1073` and `services/timeClockRuntime.ts:679` both `INSERT INTO time_session`; `clock_event` has THREE writers (`attendance.ts:1539`, `timeClockRuntime.ts:622`, `timeClockPayroll.ts:404`); `attendance.ts` ALSO dual-writes legacy `shift_punch` (:1712/:2233) and `time_entry` (:801) **[sub-audit pass]**.
- **Legacy still read by dashboards:** `services/dashboard.ts:155-192` computes worked hours from `shift_punch`/`time_entry`/`shift_segment` while payroll reads `time_session`/`time_segment` (`services/payrollSelfCheck.ts:177,239-242`) **[sub-audit pass]**. The ops dashboard and payroll can disagree about hours worked by construction.
- **Risk: HIGH.** Action: one clock service; port dashboard.ts to the canonical time tables; freeze `shift_punch`/`time_entry`.

### 2.12 Payroll segment / period
- **Canonical (new):** `payroll_period`, `payroll_period_event`, `overtime_policy/warning`, `payroll_self_check(_item)`, `payroll_export_batch`, QuickBooks tables (`165:15-318`), `payroll_calendar_config`, `pay_code` with 128 seeded codes and owner_review lifecycle (`166:20,61`; `owner_reviewed_by_user_id` 166:56). Routes `/api/labor` (`app.ts:206`; `routes/labor.ts:1-5` declares routes "a convenience layer only" with service-side access checks).
- **Legacy competitor still mounted:** `time_session_payroll_summary` + `payroll_export_aggregate_session` (`038_time_clock_payroll_phase6.sql:26,77`) served by `/api/attendance/payroll-review` — and the frontend keeps BOTH payroll surfaces: `admin-web/src/services/payrollReviewApi.ts:33` (`/api/attendance/payroll-review`) vs `laborCommandCenterApi.ts:251` (`/api/labor/command-center`).
- **Risk: HIGH.** Action: declare the 165/166 stack canonical; make `/api/attendance/payroll-review` a read-only adapter or retire it.

### 2.13 Mileage reimbursement
- **THREE models for one concept:**
  1. `mileage_claim` + first `mileage_zone` (`003:71,82`) — still written today: `POST /api/shoots/:id/mileage/submit` (`routes/mileage.ts:22`) → `services/mileage.ts:80` (`INSERT INTO mileage_claim`), miles computed by haversine studio→location (`mileage.ts:3,22`), while self-labeling `source_of_truth: "canonical_mileage_reimbursement"` (`mileage.ts:41,71,105`).
  2. `mileage_reimbursement` + `mileage_reimbursement_source` + recreated `mileage_zone` (`037_time_clock_mileage_phase5.sql:48,154,178`) — written by `services/timeClockMileage.ts` (:654 **[sub-audit pass]**), which declares `primary_model: "canonical_mileage_reimbursement"`, `legacy_compatibility_records: ["mileage_claim"]` (`timeClockMileage.ts:149-151`) and reads BOTH tables (:357, :412).
  3. `job_closeout_mileage_review` (`146_job_closeout_evals_reporting_v1.sql:240`) — written by `services/jobCloseoutV1.ts:939` **[sub-audit pass]**.
- **Risk: HIGH.** Action: single pipeline on `mileage_reimbursement`; the shoot-submit route becomes a thin writer of canonical rows; closeout review references, never re-stores, amounts.

### 2.14 Post-shoot evaluation
- **Canonical:** `post_shoot_evaluation` (`013_shoot_locations.sql:70`, 31 rows) + attachments/check-in/late-staff (146:174-221).
- **THREE writer services:** `services/postShootEvaluations.ts:1176`, `services/jobCloseoutV1.ts:1001`, and `services/locations.ts:1446` **[sub-audit pass]**. Obligations computed separately in `postShootEvaluationObligations.ts`.
- **Risk: MED-HIGH.** Action: one evaluation service; the other two call it.

### 2.15 Production order / handoff
- **THREE progress models + one asset layer, all mounted:**
  1. `production_items` (job-anchored canonical, `089:361`; handoffs/QA/deliverables in 091) — written by `jobService.ts` (INSERTs at 2384/5017/5558 **[sub-audit pass]**), status derived by `jobStatusEngine.deriveProductionStatus` (`jobStatusEngine.ts:39-72`), served under `/api/jobs/:jobId/production-items` (`routes/jobs.ts:1321+`). This is Production Tracker Slice 1's spine.
  2. `production_project` (+tasks/blockers/reviews, `054:92`, 11 rows) — summarized TWO DIFFERENT WAYS: `services/productionOperations.ts:71-103` (bespoke SQL: `unowned`, `missing_inputs`, `delivery_risk`; `/api/production`) vs `services/productionProjects.ts:915,967-986` (JS-filtered: `stale_active`, `corrections_needed`, `waiting_to_send`; `/api/projects`) **[sub-audit pass]**.
  3. `workflow_run`/`workflow_step`/`workflow_handoff` (139/141, `workflow_run.job_id NOT NULL → jobs` per convergence audit §1.4) — SLA/health via `services/projectTracking/workflowEngine.ts`; `/api/workflows`, `/api/tasks`. Has a real audit log (`workflow_step_audit_log`, `141:228`).
  4. `production_asset_preset/_version` (`134`) via `/api/production-assets`.
- Bridge between old and new: `production_items.legacy_production_project_id` and `production_item_shoot_links` (`097:286`) — link-table population **[unverified]**, likely near-zero given job_shoot_links is empty.
- **Risk: CRITICAL** (for "what state is production in?"). Action: `production_items` + workflow backbone become the only model; `production_project` frozen read-only and migrated.

### 2.16 Gallery
- **No canonical gallery object found.** Evidence: no `CREATE TABLE` matching gallery in any migration (grep across `db/migrations/*.sql`); `jobs.gallery_type` column exists (live column list) and `deliverable_items` (091:195) covers deliverables. Gallery status as a concept lives only inside production/deliverable statuses.
- **Risk: MED** (concept without a home). Action: decide whether gallery = deliverable_item kind; don't create a fourth production model.

### 2.17 Resource / prep material
- **Two surfaces:** `resource_library_item` (`030`, links in `116:93`) via `/api/resource-library` vs `services/recordResources.ts` via `/api/record-resources` (`app.ts:228-229`) **[sub-audit pass]**.
- **Risk: MED.**

### 2.18 Client issue
- **Fragmented:** `production_project_exception`/`production_project_review` (productionProjects.ts:1041/1066 **[sub-audit pass]**), `production_issue_records` (`091:218`), `production_items` issues (jobService), Zendesk cache (`014:54`) for external tickets. No single client-issue registry.
- **Risk: HIGH.**

### 2.19 Compliance incident
- **Canonical-ish:** `services/complianceWorkspace.ts` behind `/api/compliance` (`app.ts:208`), also imported by `routes/attendance.ts:29` (shared service — acceptable pattern) **[sub-audit pass]**. Time-clock flags separate: `time_clock_compliance_flag` (`039:34`). G1 audit previously confirmed the workspace exists and should be extended, not rebuilt.
- **Risk: MED.**

### 2.20 Needs-attention / leadership alert
- **FIVE independent registries, no shared engine [sub-audit pass, mount points spot-verified]:**
  1. `alert` (`003:115`, 0 rows live) — written by `services/locations.ts:2092` and `postShootEvaluations.ts:643`; `/api/alerts` reads ONLY this table (`services/alerts.ts:15`).
  2. `urgent_watch_item` — `services/urgentWatch.ts:421`; `/api/exceptions`, `/api/watch`.
  3. `job_watch_flags` (`089:394`) — FIVE writers (`jobService.ts:4272/6863/6950`, `watchFlagEngine.ts:633`, `checklistService.ts:816`, `jobCloseoutV1.ts:802`).
  4. `attendance_exception` — TWO writers (`attendance.ts:886`, `timeClockPayroll.ts:1972`).
  5. `staffing_issue` (`079:38`) — `staffingIssues.ts:229`.
  Plus `alert_events` (`092:62`, ~1,942 rows), `operational_alert_route/delivery` (110), `operational_event` (115), `gear_alert` (044), `sales_pipeline_alert` (049).
- **And a sixth, client-side:** `admin-web/src/home/needsAttention.ts:3-5` — "Centralized Needs Attention logic… intentionally strict and easy to replace later with real backend signals" — Home computes needs-attention in the browser, disconnected from all five backend registries.
- **Risk: CRITICAL** for alert trust.

### 2.21 Account health signal
- Rolled up independently by `services/leadershipReports.ts`, `services/schoolsLeadershipOperations.ts`, `services/homeDashboard.ts`, `services/jobTruth/operationalHealthService.ts` **[sub-audit pass]**. `shoot` carries scoring columns (`revenue_potential_score`, `account_growth_importance_score`, `customer_history_risk_score`, `future_profitability_manual` — live column list); `school_profile.relationship_health_state` (071:85) is a separate health field.
- **Risk: MED-HIGH** — multiple independent roll-ups of "account health."

### 2.22 Location intelligence
- **Single implementation, correctly shared:** `getShootLocationIntelligence` defined once in `services/locations.ts`, imported by `routes/locations.ts:11,161` and `services/employeeExperience.ts:7`; reads canonical history (`shoot_location_link` locations.ts:2003/2021, `shoot` :2038/2052, `post_shoot_evaluation` :566/1724).
- **Risk: LOW.** The one intelligence feature that is genuinely one system — but it is **shoot-anchored**, so the `jobs` spine cannot see it.

---

## 3. DUPLICATION-OF-EFFORT MAP

| # | What is duplicated | Where (citations) | Who feels the pain | Failure mode | Root cause | Fix |
|---|---|---|---|---|---|---|
| 1 | The work record itself (job vs shoot) | `centralJobIntake.ts:1940` vs `jobService.ts:2095`; `job_shoot_links` 0 rows | Everyone | Same picture day exists twice with different statuses; downstream picks one at random | Data model (migration 084 vs 089 never converged) | One intake; reviewed job↔shoot links (convergence audit Option B) |
| 2 | Job status | 3 live enums (`shoot_status`, `shoot_job_status`, `job_status_type`; pg_enum verified) + frontend copies (`admin-web/src/shootLifecycle.ts:10-65`, `types.ts:2718` vs `jobTruthTypes.ts`, `jobCalendarReadiness.ts`, `sportsTypes.ts`) | Ops + leadership | "Confirmed" means three different things; UI transition map (`shootLifecycle.ts:64-65`) can drift from server rules | Data model + frontend re-declaration | One vocabulary + one server-side status engine (jobStatusEngine already exists — extend it) |
| 3 | Worked hours | `dashboard.ts:155-192` (legacy `shift_punch`/`time_entry`) vs `payrollSelfCheck.ts:239-242` (`time_session`/`time_segment`) | Payroll owner + leadership | Dashboard hours ≠ payroll hours in the same week | Migration (034 layered, 007 never retired) | Port dashboard to canonical time tables |
| 4 | Clock-in writes | `attendance.ts:1073` + `timeClockRuntime.ts:679` (both INSERT time_session); `clock_event` ×3 writers | Employees, payroll | Double sessions / divergent validation | Workflow (two entry surfaces) | One clock service |
| 5 | Mileage | `mileage.ts:80` (haversine → `mileage_claim`) vs `timeClockMileage.ts:654` (shift+eval → `mileage_reimbursement`) vs `jobCloseoutV1.ts:939` | Photographers + payroll | Two different reimbursement amounts for the same drive | Data model + workflow | Single canonical pipeline (`mileage_reimbursement`) |
| 6 | Payroll review | `/api/attendance/payroll-review` (`payrollReviewApi.ts:33`) vs `/api/labor/*` (`laborCommandCenterApi.ts:251`) | Owner | Review done in one surface, other still shows pending | Migration (165/166 new, 038 not retired) | Labor CC canonical; old surface read-only |
| 7 | Contact info | `shoot.primary_contact_name/phone/email` text alongside `primary_contact_id` FK (live columns); `jobs.contact_override_note` | CSRs | Edit the contact, shoots keep stale text | Data model (denormalized copy) | Display-cache pattern with refresh, or drop text columns |
| 8 | Location info | `shoot.location_name/location_address` text + `location_id` FK | Ops | Address fixed in directory, shoot prints old one | Data model | Same as above |
| 9 | Production status | `jobStatusEngine.ts:39-72` (production_items) vs `productionOperations.ts:71-103` vs `productionProjects.ts:967-986` (same `production_project` table, two different summaries!) | Production lead | Three answers to "how far along?" | Data model + duplicated logic | One model (production_items+workflow), one summarizer |
| 10 | Evaluations | 3 writers of `post_shoot_evaluation` (2.14) | Photographers | Duplicate/competing eval rows for one shoot | Workflow | One writer service |
| 11 | Needs-attention | 5 backend registries + client-side `home/needsAttention.ts` | Leadership | Fixing an item in one registry doesn't clear the others | UX + data model | Unified alert registry with resolution semantics |
| 12 | Tasks | `work_task` (0 rows) vs `school_work_item` (128 rows) vs workflow tasks | Schools team | Schools work invisible to company task views | Migration | Converge on work_task/workflow tasks |
| 13 | Person | `app_user` (220) vs `user_account` (185) | Admin | Deactivate one, the other stays live | Data model | Formalize identity bridge |
| 14 | Resources | `/api/resource-library` vs `/api/record-resources` | Ops | Prep material uploaded twice | Workflow | Merge surfaces |
| 15 | Shoot dates | `shoot.shoot_date` + `shoot_day` + `job_days` (64 job_days vs 24 shoot_day rows, unlinked) | Scheduling | Date changed on one spine, other spine unaware — mitigated ONLY on the shoot spine by 164's request workflow | Data model | Jobs spine reads dates through links, never stores its own |

| 16 | Staffing coverage reads | Five endpoints, no shared cache: `/api/schedule/staffing-dashboard`, `/api/schedule/shoots`, `/api/shoots`, `/api/schedule/capacity`, `/api/dashboard/operations/control-room` — admin-web has no react-query/store (`package.json`: react, react-dom, socket.io-client only; single `apiFetch` wrapper `src/api.ts:17`, ~70 per-domain `services/*Api.ts`, per-view useEffect fetches) | Ops | Dashboard tile disagrees with the board it links to | UX architecture | One coverage endpoint/read model consumed everywhere |

**Data re-entry burden:** intake itself does NOT force re-entry (canonical cascade with pickers; publish blocks on unresolved org/location/contact — `centralJobIntake.ts:556-592`; `admin-web/src/components/jobIntake/JobIntakeCanonicalContext.tsx` provides canonical context). The re-entry tax appears at the **spine boundary**: anything created via `/api/shoots/intake` must be *re-created* in `/api/jobs` to exist for closeout/production/client-command-center, and vice versa.

---

## 4. WORKFLOW INTERCONNECTION AUDIT

### 4a. School picture day chain
`organization → school_profile → shoot_location → organization_contact → [intake draft] → shoot (+shoot_day, shoot_school_detail, dated_commitment) → shoot_staffing_requirement → work_shift → staffing_plan_version/_recipient → time_session → post_shoot_evaluation → ??? → production → gallery → client issue → intelligence → leadership`

- **Directory→intake→publish:** connected, ID-linked, publish-gated (`centralJobIntake.ts:556-592`), snapshotted (`dated_commitment`, migration 163). **No manual re-entry.** GOOD.
- **Staffing:** three-layer model (requirement → work_shift → plan publish/ack, migrations 061/007/156-157) all keyed on `shoot_id`. Deep links carry IDs: `JobsIndexPage.tsx:498` (`#operations/staffing?area=staffing&shoot=${sid}`), `StaffAssignmentBoard.tsx:182` honors `&shoot=<id>` deep-links. GOOD (this was the Phase 6A fix — verified present).
- **Shoot-day/time:** `time_session.linked_shoot_id → shoot` (034:158). Connected.
- **Evaluation:** `post_shoot_evaluation.shoot_id`-anchored; 3 writers (risk of duplicates) but same table.
- **BREAK — production handoff:** the shoot spine has no native production model. Production lives on `production_items` (requires a `jobs` row) or legacy `production_project`. With `job_shoot_links` empty, a school shoot's production is connected **only if someone separately created/linked a job**. Live data: 2,709 shoots, 93 jobs, 6 production_items. **The chain breaks here for the overwhelming majority of real work.**
- **Gallery:** no object (2.16) — chain ends in a concept gap.
- **Client issue:** fragmented registries (2.18); no FK path from a school shoot to a client-issue record on the canonical spine.
- **Intelligence & leadership:** `getShootLocationIntelligence` reads real shoot history (GOOD); leadership reads the shoot spine — `schoolsLeadershipOperations.ts`, `homeDashboard.ts`, `leadershipReports.ts` all query `FROM shoot` and **never** `FROM jobs` (grep verified: 1/1/5 shoot hits, 0 jobs hits). So leadership sees operational truth but is blind to everything living on the jobs spine (closeout, production items, watch flags).
- **Does leadership see the same reality as department owners?** No — the Jobs dashboards (`routes/jobs.ts:859-889` per convergence audit §1.1, `jobTruth/dashboardQueryService.ts`) read `jobs`/`job_watch_flags` while company home/leadership read `shoot` + legacy time tables. Two realities.

### 4b. Sports chain
`organization (team) → contact → shoot (shoot_sports_detail, 084:238) → sports_team_unit/sports_proof_cycle/sports_financial_summary (088:47-148) → staffing → time_session → mileage → evaluation → production follow-up → rebooking`

- Sports has its own workspace tables (088) layered on the shoot spine plus its own staffing status type (`types/sports.ts:72` **[sub-audit pass]**) and demo data (`admin-web/src/home/sportsDemoData.ts`).
- **Mileage:** the chain forks — a photographer's drive can produce a `mileage_claim` (via shoot submit) or a `mileage_reimbursement` (via attendance/eval flow) or a closeout review row; amounts computed differently (haversine vs shift+eligibility). **Manual reconciliation required.**
- **Rebooking / account health:** `shoot` scoring columns + `school_profile.relationship_health_state` + leadership roll-ups are independent; no single account-health record. Season model for sports **[unverified — no season table located]**.

### 4c. Labor chain
`app_user → work_shift → clock-in (clock_event/time_session/time_segment) → payroll summary → exceptions → compliance review → mileage dependency → payroll review/export`

- **Schema-level: the best chain in the system.** Labor CC (165/166) FKs the real spine: `app_user` (165:93,140,181), `time_session` (165:203), `exception_request` (165:206); self-check joins `work_shift ws ON ws.id = ts.source_shift_id` (`payrollSelfCheck.ts:239-242`). Pay codes seeded with policy semantics (166:87, e.g. `travel_pre_session` "Not payable for part-time staff without a manager/payroll override"). Owner review lifecycle on pay codes (166:56).
- **Weaknesses:** dual clock writers (attendance vs timeClockRuntime), triple `clock_event` writers, legacy `shift_punch`/`time_entry` still dual-written by `attendance.ts` and still read by the ops dashboard; TWO payroll review surfaces (038 vs 165) both live; mileage feeds payroll from a forked pipeline (2.13). Worker monitors (`packages/worker/src/jobs/laborMonitor.ts`, `attendanceMonitor.ts`, `exceptionReconcileMonitor.ts`) add async writers on the same registries **[sub-audit pass]**.
- **Employee scoping:** labor routes are a "convenience layer"; services re-verify access (`routes/labor.ts:1-5`); self-check is per-employee (`/api/labor/self-check/current`, `laborCommandCenterApi.ts:255`). Scoping appears correct **[not exhaustively verified]**.

---

## 5. FAKE INTEGRATION AUDIT

1. **Dashboard cards without object IDs:** `admin-web/src/home/homeShared.tsx:41-43` — `RelatedJobLink` renders `href="#jobs"` with only a `jobName` string; the comment (lines 38-39) admits it: "Demo jobs are not real records, so a related-job affordance links to the real Jobs database rather than a dead per-job hash." Honest, but it means the company Home's related-job affordances are **name-only, no identity**.
2. **Demo data presented on the company Home:** `home/homeDemoData.ts` + `home/sportsDemoData.ts` consumed by `CompanyCommandHome.tsx`, `CompanyNeedsAttention.tsx`, `AttendanceRiskPanel.tsx`, `LeadershipReportsStrip.tsx`, `MyWorkspaceHome.tsx`, `OperatingAreaPulse.tsx` (grep verified). Leadership widgets partially narrate demo objects while real registries exist.
3. **Same status computed differently:** production summarized three ways (§3 row 9); worked hours two ways (§3 row 3); needs-attention six ways (§2.20). Job detail's "Staffing readiness" nav (`SharedJobDetailPage.tsx:163`) links to `#operations/staffing?area=staffing&date=…` — **carries a date but not the shoot/job id**; `CentralJobDetailPanel.tsx:322` links to the staffing queue with no id.
4. **Alerts that name a problem but can't fix it:** `/api/alerts` reads only the near-empty `alert` table (`services/alerts.ts:15`; 0 rows live) while the real signals sit in `urgent_watch_item`, `job_watch_flags`, `attendance_exception`, `staffing_issue`, and ~1,942 `alert_events`. Home's needs-attention is computed client-side (`home/needsAttention.ts`) — resolving the underlying record does not flow through one registry.
5. **"Complete" upstream, incomplete downstream:** a shoot can reach `SHOOT_COMPLETE`/`COMPLETE` (shoot_status) while the jobs spine — where closeout, production items, and deliverables live — has no linked job at all (2/2,313 linked; convergence audit §0, link tables still 0 rows today). Downstream literally cannot know.
6. **Payroll/mileage reading legacy while dashboards read canonical — and vice versa:** the ops dashboard reads legacy time tables while payroll reads canonical ones (§3 row 3); mileage's "legacy" submit path still writes `mileage_claim` while labeling itself canonical (`mileage.ts:41,80`).
7. **Contacts/locations as text:** spine rows carry `primary_contact_name/phone/email` and `location_name/address` text beside their FKs (§2.4/2.5) — any view rendering the text columns shows a copy, not the linked truth.
8. **The default landing page is a demo role-preview.** `#home`/`#dashboard` → `components/home/HomeCommandSurface.tsx:107` picks one of four surfaces by a **localStorage demo role** (`pmc-home-demo-role`, `HomeCommandSurface.tsx:26`, via `RolePreviewSwitcher`) — not the real session role. `SportsCommandCenter.tsx:22` and `SamSportsWorkspace` render **100% demo data**; `CompanyCommandHome` fabricates tile numbers — `home/homeDemoData.ts:209-298` `buildCompanyCommandCards` hardcodes "Shoots Today = 18" (:227), "Staffing Risk = 3" (:236), "Late/Not Clocked In = 2" (:246) with `dataSource: "sample"`; only 3 of 8 command cards are live (`CompanyCommandHome.tsx:34,60,110`).
9. **Frontend status enums have already drifted from the API unions.** `components/jobs/DepartmentJobAdapterUIRegistry.tsx:291,307` re-declares job/production statuses as untyped `string[]` — `JOB_STATUS_OPTIONS` is missing `intake_blocked` (present in `jobTruthTypes.ts:5` and emitted by the API), and `PRODUCTION_STATUS_OPTIONS` has 13 of 20 values (missing `not_created`, `ingest_complete`, `awaiting_internal_review`, `approved_for_final`, `in_final_production`, `ordered_or_sent`, `cancelled` vs `jobTruthTypes.ts:18-38`). Users cannot filter by statuses the system actually produces.
10. **"Under-staffed" is computed four different ways from three different fields:** `pages/staffingBoardState.ts:69` re-derives `planned_staff_count > assigned_staff_count` client-side; `SharedJobOperations.tsx:1400,1493` uses `assigned_staff_count < estimated_staff_count` (a *different* field); `DashboardStaffingSurface.tsx:123` trusts server booleans; `UnifiedScheduleSurface.tsx:1712,2303` has its own risk pill. The dashboard tile and the staffing board can disagree about the same shoot.
11. **Readiness computed in parallel to the server:** `jobCalendarReadiness.ts:70` builds its own 8-state readiness ladder from raw fields even though the API already sends `readiness_status` (`jobTruthTypes.ts:241`); two more independent readiness tone functions at `PrepReadinessQueuePage.tsx:67` and `DashboardLeadershipSurface.tsx:223`. One overloaded `statusTone(status: string)` (`components/sports/SportsPrimitives.tsx:67`) is fed job/production/staffing/readiness statuses alike (`DepartmentJobAdapterUIRegistry.tsx:715-718`) — colors collide across dimensions and unknown values silently default.
12. **No shared route/query parser:** `navigation.ts:2052` (`resolveRouteId`) discards the query string entirely; ~19 files re-implement `hash.split("?")`/`URLSearchParams` (e.g. `StaffAssignmentBoard.tsx:32,46`, `DirectoryRecordDetailPage.tsx:49`, `home/actionTargets.ts:79`). The deep-link contract `home/actionTargets.ts:61-71` only upgrades `job`/`project_tracking`/`client_case` sources to record links — `staffing`, `production`, `attendance`, `schedule`, `urgent_window` alerts always fall back to a list view even when a `sourceId` exists.
13. **Counter-examples (real integration, worth protecting):** `jobsCanonicalIndex.ts:266,371` — one filtered CTE feeds rows AND summary counts, and refuses to fabricate operational fields for unlinked jobs ("operational_data_available") **[sub-audit pass]**; `CompanyCommandHome`'s three live cards deliberately reuse the SAME endpoints as their detail views (`useUnresolvedUrgentCount` → `/api/exceptions`, `useProductionBlockedCount` → `/api/production/operations`, `useJobStatusCounts` → `/api/jobs`; `CompanyCommandHome.tsx:34,60,110`); intake's canonical pickers with clearly-labeled `unresolved_*` fallbacks (`QuickCreateJobDrawer.tsx:634-703`, room/area documented as dated free text at :670-673); the time clock reads shift context instead of re-entering it (`GlobalPunchControl.tsx:355,65`); migration 164's date-change workflow (immutable booked date, append-only events, "creating a request NEVER mutates the shoot", `164:1-8`); migration 163's dated_commitment; `getShootLocationIntelligence` single-sourced; staffing deep-links carrying shoot ids.

---

## 6. PRIOR-AUDIT VERIFICATION (fixed vs merely documented)

| Prior finding | Status at HEAD fe5853e8 |
|---|---|
| Jobs/shoot convergence needed; build reviewed `job_shoot_links` (docs/jobs-shoot-convergence-audit.md §0) | **NOT implemented** — `job_shoot_links` 0 rows, `job_legacy_mapping` 0 rows, both intakes mounted (`app.ts:192,234`) |
| Migration 144 org layer adopted by schools | **VERIFIED** — `school_profile.organization_id` PK→organization (071:66); parent scoping live (144:139) |
| 163 dated_commitment = snapshot at publish, FKs live | **VERIFIED** — column present on `shoot`; writer in centralJobIntake; design comment matches |
| Phase 6A staffing deep-links fixed | **VERIFIED** — `StaffAssignmentBoard.tsx:182`, `JobsIndexPage.tsx:498` carry shoot ids |
| Production Tracker rebuild Slice 1 only | **CONSISTENT** — production_items spine present; production_project still live with two competing summaries |
| Labor CC may have its own staff/pay concepts | **REFUTED (good news)** — 165/166 FK `app_user`/`time_session`/`exception_request`; no new staff table. QB transport scaffold-only (`quickbooks_sync_log`, `payroll_export_batch` present; transport unverified) |
| Compliance Workspace already exists (G1) | **VERIFIED** — `services/complianceWorkspace.ts`, `/api/compliance` (app.ts:208) |

---

## 7. SCORES (1–5)

| Dimension | Score | Justification |
|---|---|---|
| Canonical identity | **2** | Directory objects are truly canonical, but the core work object exists as two unlinked spines with three status vocabularies |
| Relationship integrity | **3** | New layers FK properly (labor, 163, directory); but the job↔shoot bridge tables are empty and text copies ride beside FKs |
| Workflow continuity | **2** | Intake→staffing→time flows without re-entry; the chain snaps at the production/closeout boundary for ~97% of real records |
| Dashboard trust | **2** | Ops dashboard reads retired time tables; company Home mixes demo data; leadership and Jobs dashboards read different spines |
| Alert trust | **2** | Five backend registries + client-side rules; `/api/alerts` sees a 0-row table; no cross-registry resolution |
| Historical memory | **4** | dated_commitment, append-only date-change events, activity logs, workflow_step_audit_log, location intelligence from real history |
| Role clarity | **3** | Owner columns everywhere (job_owner, account_owner, readiness_owner, client_internal_owner) but per-spine and un-reconciled; two person tables |
| Duplicate prevention | **3** | Intake enforces duplicate-check + unique job_number (084/089); nothing prevents the same event living on both spines |
| Legacy cleanup | **1** | Nothing is ever retired: mileage_claim, shift_punch/time_entry, school_work_item, alert, production_project, payroll 038 stack — all still written and/or read |
| Reporting readiness | **2** | Every report must first pick a spine; counts disagree by construction (2,709 shoots vs 93 jobs) |

---

## 8. BLUNT CONCLUSION

**Verdict: disconnected modules with shared branding at the work layer, wrapped around a genuinely excellent canonical directory and a well-anchored new labor layer.** Mission Control is not one OS; it is two — the Shoot OS (where the company actually operates) and the Jobs OS (where closeout, production, and client health were built) — plus a graveyard of never-retired predecessors. The connective tissue (link tables, one status language, one alert registry) was designed, documented, and never populated.

### Top 10 changes to make it feel like one system
1. **Decide the Job/Shoot semantic NOW** (Job = engagement, Shoot = dated occurrence, one-to-many) and **populate `job_shoot_links`** with reviewed provenance — the convergence audit's Option B, unimplemented for 3 weeks.
2. **One intake.** `/api/shoots/intake` remains the creator; job records become projections/links, or vice versa — but never two creation paths (`app.ts:192` vs `routes/jobs.ts:1166`).
3. **One status language.** Retire `shoot.job_status` (shoot_job_status) and map `shoot_status` ↔ `job_status_type` in exactly one server-side engine; delete the frontend transition map (`shootLifecycle.ts:64`).
4. **One clock.** Merge `attendance.ts`/`timeClockRuntime.ts` writers; stop dual-writing `shift_punch`/`time_entry`; port `dashboard.ts:155` to `time_session`.
5. **One payroll surface.** Labor CC (165/166) canonical; `/api/attendance/payroll-review` becomes read-only adapter, then dies.
6. **One mileage pipeline** on `mileage_reimbursement`; the shoot submit route writes canonical rows; drop `mileage_claim`.
7. **One alert registry** with resolution semantics; `/api/alerts`, exceptions, watch flags, staffing issues, and Home's client-side rules all become views over it.
8. **One production model:** `production_items` + workflow backbone; freeze `production_project` read-only and migrate its 11 rows.
9. **One evaluation writer**; closeout and locations call it.
10. **Kill demo data on the company Home**; every card carries a real object id (fix `RelatedJobLink`).

### Consolidate BEFORE adding features
Items 1–3 are prerequisites for everything. Every feature added today must choose a spine, and every choice deepens the fork. The Production Tracker rebuild and School Season Autopilot should not proceed past their current slices until the job↔shoot decision is executed.

### Duplicated work to eliminate first
Payroll review done twice (surfaces 038 vs 165), mileage reconciled by hand across three tables, and needs-attention triage repeated across six lists — these are the places a human is currently doing the join that the database refuses to.

### Canonical model decisions needed immediately
(a) Job vs Shoot semantics + link policy; (b) one job-status vocabulary; (c) `contact` vs `organization_contact` roles (identity vs edge) applied to work-record FKs; (d) `app_user` vs `user_account` bridge; (e) alert registry ownership; (f) whether "gallery" is a deliverable kind or a new object (do not let it become a fourth production model).

---

### Known limitations of this audit
- packages/mobile and packages/timeclock-core were not inspected **[unverified]**.
- QuickBooks transport depth, sports season model, `production_item_shoot_links` population, and the exact app_user↔user_account bridge mechanism remain **[unverified]**.
- Row counts are a live snapshot of the shared dev DB (2026-07-08); ratios, not absolutes, are the load-bearing facts.
