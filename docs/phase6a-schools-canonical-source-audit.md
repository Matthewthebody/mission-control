# Phase 6A — Schools Leadership & CSR Canonical Source Availability Audit

**Date:** 2026-06-21
**Purpose:** Before building the Schools Leadership and CSR operating views, map the **exact** canonical
source for every desired category. These views are **read models over canonical records** — never new
sources of truth. A category with no canonical source is marked **unavailable** (no fake count, no
enabled dead action); all other categories continue.

**Classification key:**
- **LIVE** — a canonical table is the direct source.
- **DERIVED** — computed from a confirmed canonical relationship (no dedicated table, but honest).
- **UNAVAILABLE** — no canonical source; render `{ available: false, count: null, reason }`.
- **DEMO-ONLY** — only demo/seed rows exist; not a durable canonical source.
- **FUTURE-INTEGRATION** — requires an integration not yet connected.

---

## 1. Category source map

| # | Category | Class | Canonical source (table → service → route) | Key columns / notes |
|---|----------|-------|--------------------------------------------|---------------------|
| 1 | Districts & Schools | **LIVE** | `organization` → `listOrganizations` / `listCanonicalDistricts` → `GET /api/organizations`, `GET /api/organizations/districts` | `client_entity_kind` (parent_organization\|account), `parent_organization_id`, `active_status` |
| 2 | Current service term | **LIVE** | `school_service_term` → `getCurrentSchoolServiceTerm` / `listSchoolServiceTerms` → `GET /api/organizations/:id/service-terms` | `status='current'` (one per org+period_type), `confirmation_state` |
| 3 | Future / next service term | **LIVE** | same table, `status='draft'` (or future `start_date`) | `copied_from_term_id` = rollover lineage |
| 4 | Inherited / unconfirmed service values | **LIVE** | `school_service_term.inherited_field_keys[]` + `confirmation_state='unconfirmed'` + `service_config` jsonb | never silently promoted |
| 5 | Jobs | **LIVE** | `shoot` → `centralJobIntake` / jobTruth `listJobs` → `GET /api/jobs/index`, `GET /api/shoots/intake/jobs/:id` | `record_state`, `job_status`, `department` |
| 6 | Confirmed linked Shoots only | **DERIVED** | `shoot` filtered `record_state='published'` (+ not cancelled/archived) | draft shoots excluded from leadership counts |
| 7 | Shoot dates / schedule | **LIVE** | `shoot.shoot_date` + `shoot_day` (per-day) | time-state derived (today / this week / next week) |
| 8 | Staffing readiness / coverage risk | **LIVE** | `shoot_staffing_requirement` + `shoot.staffing_required` + `shoot.readiness_status` | `required_for_ready`, `minimum_count` |
| 9 | Staffing acknowledgments | **DERIVED** | `shoot_assignment` (assignment presence) + readiness items; **no dedicated ack column** | "unacknowledged" = required-but-unassigned; a true ack lifecycle is FUTURE |
| 10 | Declined / replacement-required staffing | **DERIVED / FUTURE** | no canonical `declined`/`replacement` state column found | mark category unavailable until a staffing-response lifecycle exists |
| 11 | Approved Locations | **LIVE** | `shoot_location` `active_status='active'` (+ `organization.primary_location_id`) → `listDirectoryLocations` → `GET /api/organizations/:id/locations` | "approved" = active |
| 12 | Organization-contact relationships / missing contextual contacts | **LIVE** | `organization_contact` + `organization_contact_relationship` (`client_roles`, `relationship_role`, `is_current`) | "missing" = no current relationship of the required role |
| 13 | Rosters / required lists | **LIVE** | `shoot_school_detail.roster_status` + `roster_due_date` | text status (unknown/pending/received) |
| 14 | Workflow instances & steps / blockers | **LIVE** | `school_work_item` (status/stage/blocker_reason/waiting_on) → `listSchoolsHubWorkspace` → `GET /api/schools-hub`; plus `workflow_run`/`workflow_step` | extend, don't duplicate, SchoolsHub |
| 15 | Production / delivery state | **LIVE** | `production_project` + `production_project_task` (status/due_date/owner) | linked via `linked_shoot_id` / `linked_organization_id` |
| 16 | Urgent Window / Needs Attention | **LIVE (derived state)** | `shoot.readiness_status` + `shoot_readiness_item` + jobs queues (`listPrepReadinessQueue`, `listProductionUrgentWatch`) | "needs attention" is computed, not a table |
| 17 | Client-impacting work inside 72h | **DERIVED** | `shoot.shoot_date` within 72h AND a blocking readiness/staffing/detail gap | composed from LIVE sources |
| 18 | Schedule-change requests | **UNAVAILABLE** | no `schedule_change` / `change_request` / `reschedule` table exists | render `{ available:false, count:null, reason }` |
| 19 | Client communications / unresolved cases | **LIVE (partial)** | `directory_touchpoint` (`channel`,`outcome`,`follow_up_date`) + `directory_touchpoint_plan` | "unresolved case" lifecycle is partial → "open follow-ups" is the honest metric; a true case store is FUTURE |
| 20 | Gallery / portal milestones | **DERIVED / PARTIAL** | `microsoft_client_portal_*` links + production tasks; no first-class gallery entity | mark unavailable unless a confirmed portal link exists |
| 21 | Yearbook milestones | **DERIVED** | `shoot_school_detail.yearbook_required` + production tasks (no yearbook entity) | "yearbook flagged" is LIVE; milestone tracking is DERIVED |
| 22 | ID-service milestones | **DERIVED** | `shoot_school_detail.id_required` / `id_sort_method` + production tasks | "ID flagged" is LIVE; milestone tracking is DERIVED |
| 23 | Rebooking / next-season state | **DERIVED / PARTIAL** | `school_service_term.copied_from_term_id` (rollover) + `agreement.renewal_date` | "next term missing/awaiting" is LIVE; rebook forecast is DERIVED |
| 24 | Internal / CSR ownership | **LIVE** | `school_profile.primary_internal_owner_user_id` / `backup_internal_owner_user_id`; `shoot.account_owner_user_id`; `school_service_term.internal_owner_user_id` | "ownership gap" = null owner |

---

## 2. Permissions model (Schools Leadership vs CSR)

`packages/api/src/authz/authority.ts` already provides the needed split — **no new role store**:

- **Leadership / admin** → `getSchoolsHubAccessScope(auth) === "all"` (super_admin / leadership / director_admin); `canManageSchoolsHub`.
- **CSR / client success** → `schools_client_success`, `sports_client_success`, `customer_service_rep` → scope `"own"` (department/own-records).
- **No access** → scope `null`.

The read model will gate on `getSchoolsHubAccessScope(auth)`: `"all"` sees every District/School; `"own"`
is scoped to the CSR's owned organizations. Middleware: `requireSchoolsHubReadAccess`.

---

## 3. Decisions for the read model

1. **One server-side read model** (`GET /api/schools/leadership/operations`) computes every count; React never re-totals. Each enabled metric guarantees `displayed_count === filtered_result_count` (the array length IS the count).
2. **Confirmed-Shoot rule:** leadership counts use `record_state='published'` shoots only; drafts are excluded (they are intake-in-progress, not commitments).
3. **Unavailable categories** (schedule-change requests #18; declined/replacement staffing #10; first-class gallery #20; communication *cases* #19) return explicit `{ available:false, count:null, reason }` — **no fake count, no enabled dead action**.
4. **Ownership** resolves from `school_profile.primary_internal_owner_user_id` first, then `shoot.account_owner_user_id`; a null owner is surfaced as an explicit **ownership gap**, not hidden.
5. **Reuse, not duplicate:** workflow/blocker rows derive from `school_work_item` (the SchoolsHub engine) rather than a new store; production/delivery from `production_project`.
6. **Destinations** are canonical hashes the views already serve (`#directory/organizations/<id>`, `#directory/contacts/<id>`, `#directory/locations/<id>`, `#schools/jobs/detail`, `#schools`), with a focus reason — never a dead link.

---

## 4. Normalized issue contract (every enabled row)

```
issue_id, section, category, source_type, source_id,
district_id, district_name, school_id, school_name,
owner_user_id, owner_name, internal_owner (CSR),
reason, severity, status, date_deadline, time_state,
exact_destination_hash, focus_reason, can_act, primary_action,
source_availability, provenance
```

No decorative counts: a count is shown only when its row list is materialized and equal in length.

---

_End of audit._
