# Phase 4 — Canonical Directory & Schools Account Experience: Audit

**Date:** 2026-06-20
**Branch:** `feature/work-spine-foundation-v1`
**Scope:** Read-only audit (no code changed). Verified against `db/migrations/*.sql`, `packages/api/src`, `packages/admin-web/src`, and the live dev DB (`docker exec codex-integrated-baseline-clean-postgres-1 psql -U postgres -d pmc`). Demo tenant = Demo Studio `223ee748-3dcd-4837-97a9-8eba7dbb11f2`.
**Method:** five parallel domain sweeps (organization/hierarchy/brand, contact/roles, location/intelligence, three-layers-of-truth, directory-UI/overlaps), each citing file:line + migration + live-DB counts.

---

## 0. Headline findings

1. **Two organization stacks share one `organization` table.** The **production-wired** canonical Directory (`services/organizations.ts` + `components/directory/DirectoryWorkspace.tsx`) is **hierarchy-blind**: it never reads/writes `parent_organization_id`, stores the district as **free-text `school_profile.district_name`**, and **packs Website / Main Phone / Primary+Secondary Color / Mascot / Logo status into the single free-text `organization.notes` field** (`DirectoryActionForms.tsx:367-404` `buildOrganizationNotes`). The **Client Command Center stack** (`services/clientCommandCenter.ts`, migration 144) holds the *real* `District(parent_organization) → School(account)` model but is reachable in live data **only through the demo seed**.
2. **District is modeled four ways (three live).** `organization.parent_organization_id` (canonical, demo-only) · `school_profile.district_name` text (live, 3 rows) · `school_job_profiles.district_id` FK (live, per-job, 6 rows) · `shoot.unresolved_organization_name` text.
3. **The middle "school-year/season service" layer does not exist.** No table is keyed by `(organization_id, school_year)` or `(organization_id, season)`. Per-year scope lives only on **job-scoped** `school_job_profiles`/`sports_job_profiles` (re-entered every job), plus a static, un-yeared `account_service` and a single overwrite `school_profile.school_year_label`.
4. **Contacts are not reusable across orgs today.** `organization_contact.organization_id` is `NOT NULL`; live DB shows **0 contacts linked to >1 organization**. Roles are fragmented across **four** vocabularies.
5. **No data forks elsewhere.** CCC, Sports Contacts/Accounts, SchoolsHub, Sales Pipeline, and `Contacts.tsx` all read the canonical tables. The risks are **parallel presentations + governance fragmentation**, CCC's **demo-only satellite tables**, and a **split location-contact link table**.
6. **"Jessica's Vibe" prototype does not exist in the repo** (0 matches). The in-repo IA reference is `_recovered_context/old_codex_quarantine/PROMPT1_CANONICAL_DIRECTORY_HANDOFF.md` + `IA_ROUTE_MAP.md`.

---

## 1. Canonical model inventory

### 1.1 Organization
- **Table `organization`** — created **028** (`028_canonical_organization_directory.sql:24-38`). Extended: **056** `logo_url`; **089** `primary_location_id`, `primary_contact_id`, `account_owner_user_id`; **113** standard-audit trigger; **144** `external_code, parent_organization_id, client_entity_kind, client_organization_type, client_lifecycle_status, main_phone, office_phone, website, client_demo_key` (`144_client_command_center_v1.sql:137-146`). Live: 35 orgs (29 real, 6 `client_demo_key`).
- **Type columns (three):** `account_type` (`organization_account_type`, NOT NULL — *line-of-business*: schools_underclass_portraits/schools_events/sports/events/studio/headshots/commercial/internal — **no District/School**); `client_entity_kind` (`parent_organization|account`, default `account` — the District/School axis); `client_organization_type` (nullable — `school_district, high_school, school, league, …`).
- **Hierarchy:** `parent_organization_id` self-FK (migration **144 only**), `ON DELETE SET NULL`. Constraint `organization_parent_not_self` (1-level self only; **no multi-level cycle guard, no type-pair enforcement**). Indexes `organization_client_parent_idx`, partial unique `…account_parent_active_name_unique_idx`. Live: 3 parents / 3 children, all demo.
- **Ownership (fractured, three homes):** scalar `organization.account_owner_user_id` (089, **never written by the Directory create path**); multi-owner `client_internal_owner` table (144); `school_profile.primary/backup_internal_owner_user_id` (071).
- **Brand:** only `logo_url` (056) + `website` (144). **No** logo-history table, brand-color columns, mascot column, or website normalization. The Directory form serializes color/mascot/website/phone/logo-status into `organization.notes`.
- **Services/routes/components:** `services/organizations.ts` (`createOrganization:1337` writes only name/logo_url/account_type/status/notes — **no** parent/website/owner); `routes/organizations.ts` (`POST / :846`, `PATCH /:id :927`, `GET /:id :1301`); `DirectoryActionForms.tsx OrganizationEditorForm:109-365`, `DirectoryWorkspace.tsx`. CCC parallel: `clientCommandCenter.ts createClientOrganization:993 / createClientAccount:1056`, `routes/clientCommandCenter.ts:265/277`.
- **Tests:** `organizationsDirectory.test.ts` (free-text `district_name`), `clientCommandCenter.test.ts` (asserts `parent_organization`, `account_service`, `client_roles`).

### 1.2 Contact
- **Table `organization_contact`** (there is **no** `contact` table) — created **028:52-70**; `organization_id uuid NOT NULL REFERENCES organization` (binds to one org). Extended **066** (`role_category`, enrichment), **144** (`display_name`, `client_demo_key`), **151** (consent flags `allow_email/allow_sms/do_not_contact/sms_consent_*`).
- **Org↔contact relationship `organization_contact_relationship` (OCR)** — created **053:50-62**; UNIQUE on the **triple** (so many-to-many *structurally*). Extended **058** (history `start_date/end_date/is_current`), **144** (`client_roles[]` + 7 `receives_*_emails`), **071** (`school_contact_categories[]`).
- **FOUR role vocabularies** (the known "three" + a hidden fourth):

  | | Column | On | Migration | Note |
  |---|---|---|---|---|
  | A | `relationship_role` | OCR | 053 | 7 values; **hardcoded to `general`** by both writers — degenerate |
  | B | `client_roles[]` | OCR | 144 (+151) | richest (principal/AD/billing/picture_day/…); drives comms |
  | C | `school_contact_categories[]` | OCR | 071 | schools subset of B, different spelling |
  | D | `role_category` | **contact** | 066 | global role; the one the **Create-Contact UI** actually sets |
  Migration `071:175-193` already encodes a D→C translation — proving they are the same vocabulary.
- **Reuse status:** `organization_id NOT NULL` + create path always binds to the home org ⇒ **0 cross-org contacts** live. Only `directoryImports.ts link_existing:483` makes a second-org OCR.
- **Components:** `ContactEditorForm` (`DirectoryActionForms.tsx:~410`, sets **D** only); `OrganizationContactLinkForm:826` (link existing — separate drawer, not in create-org); `SchoolContactCategoriesForm` (**C**); client roles (**B**) only in `ClientCommandCenter.tsx`.

### 1.3 Location
- **Table `shoot_location`** (there is **no** `location` table) — created **013_shoot_locations.sql:1-23**; org link via single nullable FK `shoot_location.organization_id` (**028:73**, one-to-many). Address (028), lat/long + `navigation_url` (013). **No timezone on location** (TZ lives on job/shoot). Reusable across jobs/shoots — proven: one location referenced by **1,963 shoots**.
- **Room/area & approved:** `shoot_location_area` (013:25, named sub-areas); the **152** note columns (`setup_area, parking_instructions, entrance_instructions, accessibility_notes, …`); `operational_note` location-memory (025); `location_reference_attachment` (153, maps/photos). **No explicit "approved" flag** — "approved" = org-attached + `active_status='active'`. Job/shoot point via `jobs.primary_location_id`, `job_days.location_id`, `shoot.location_id`, `shoot_day.location_id`, `school_profile.primary_location_id` (single pointers).
- **Location Intelligence (real, ~80%):** `services/locations.ts getShootLocationIntelligence:1228` + `buildHistoricalContext:759` over `post_shoot_evaluation`, `setup_photo_upload`, `operational_note`, `shoot_location_area`. **Wired into intake** (`SharedJobEditorPage.tsx:930/1099` `LocationHistorySurface variant=preview`) **and detail** (`SharedJobDetailPage.tsx:836` → `HistoricalContextPanel`). Monday **mock** (`locationMonday.ts buildMockHistoricalEvaluations`) fills only zero-eval locations; real history shadows it (`locations.ts:374-384`).

### 1.4 The three layers of truth
- **(i) Static account truth (SEPARATE ✓):** `organization`, `school_profile` (PK `organization_id`, 071), `account_service` (UNIQUE `(tenant, account_id, service_type)` — **no year**), `client_internal_owner`. School-year proxy = single overwrite `school_profile.school_year_label`.
- **(ii) School-year/season SERVICE config (MISSING ✗):** no `(organization_id, school_year)` / `(organization_id, season)` table exists. Lives only on **job-scoped** `school_job_profiles` (PK `job_id`; `school_year`, `id_cards_required`, `yearbook_required`, `composite_required`, `roster_source`, `grade_scope`, `submission_deadline`, …) and `sports_job_profiles` (PK `job_id`; `season`, `league_name`, `division`, revenue-share, banner/specialty flags). Re-entered every job.
- **(iii) Dated Job/Shoot truth (SEPARATE ✓):** `jobs` (`organization_id` FK, 358/351 with org), legacy `shoot` (`organization_id`, 2496/2140), `job_days`, `school_job_profiles.specific_area` (155, job-scoped). Note: migration 155's filename says `school_profile` but it alters `school_job_profiles`.

### 1.5 Directory UI, history domains, permissions
- **Routes** (`navigation.ts` → `app.tsx`): `#accounts` (directory/organizations), `#directory/contacts`, `#directory/internal`, `#directory/locations`, `#directory`→redirect `#accounts`, plus `#contacts`/`#organizations` aliases. One component: `DirectoryWorkspace.tsx` via `pages/Organizations.tsx`; `pages/Contacts.tsx` is an 11-line wrapper.
- **Communication history (bifurcated):** Teams feed (`communicationHistory.ts`, untyped `object_type/object_id`, **no FK**, all `teams_communication_*` = 0 rows) vs canonical-FK layer (`directory_touchpoint`=3, `client_context_link`=2 demo, `sales_email_communication`=0). **No "comms by organization/contact" endpoint.**
- **Post-shoot evals (real):** one table `post_shoot_evaluation` (~100 cols; FKs incl. `organization_id`, `location_id`); two engines — V2 shift (`postShootEvaluations.ts`) + V1 job (`jobCloseoutV1.ts`); feeds location-memory promotion (`promoteOperationalNoteToLocationMemory`). 31 rows, all demo/test.
- **Client surveys:** **ABSENT** — 0 survey tables; only placeholders (`jobCloseoutV1.ts:652 "not_connected"`, demo KPI tile).
- **Permissions/audit:** Directory **reads = any authenticated user** (`directoryAccess.ts:5-11`, no gate); **writes = tier floor `director_admin`** or client-success/CSR job functions (`canManageCanonicalDirectoryRecords`, `authority.ts:920`). Seeded granular `organization.*`/`contact.*`/`location.*` permission codes (093/114) are **dead on the Directory**. **Audit is real** (`audit.ts` dual-writes `audit_log` 47,948 + `audit_events` 44,917; 21 directory sites; soft-archive, **no hard delete**; reads not audited).
- **Overlaps (no data forks):** CCC / SportsContacts+Accounts / SchoolsHub / SalesPipeline all read canonical `organization`/`organization_contact`. CCC's satellites (`client_internal_owner`=2, `account_service`=6, `client_context_link`=2) are demo-only. Split link tables: `shoot_contact_link`=1855 (used) vs `location_contact_link`=0 (unused).

---

## 2. The ten audit questions

**Q1 — Can the schema represent District → School cleanly?** **PARTIAL.** Columns exist (`parent_organization_id` + `client_entity_kind`/`client_organization_type`, 144) and the demo proves it. Not clean because: no constraint enforces parent kind=`parent_organization` / child=`account`; only 1-level self-cycle guard; the NOT-NULL `account_type` enum (the column the app filters on) has no school/district notion; and live data still carries free-text `school_profile.district_name` + per-job `school_job_profiles.district_id`.

**Q2 — Can one Contact have different roles at a District and a School?** **Effectively NO (schema PARTIAL).** Roles A/B/C are on the OCR (so distinct rows per org could differ), but `organization_contact.organization_id NOT NULL` + the create path bind each contact to one org; **0 contacts are multi-org** live. Only the CSV importer reuses a contact across orgs, and only for role A.

**Q3 — Can one School have multiple approved Locations and room/area notes?** **YES.** `shoot_location.organization_id` is one-to-many (live orgs own 2–3 locations); room/area lives in `shoot_location_area` + the 152 note columns + `operational_note`. Nuance: only a single `primary_location_id` pointer per org/job, and "approved" is implicit (org-attached + active), not a flag.

**Q4 — Where should school-year service configuration live?** Today: **nowhere dedicated** — job-scoped (`school_job_profiles`/`sports_job_profiles`), a static un-yeared `account_service`, and a single `school_year_label`. **Recommend a new time-bound table** `school_service_term` keyed `(tenant_id, organization_id, school_year[/season])` carrying the per-year scope currently duplicated on every job; jobs then *reference/snapshot* it. **Do not** add `school_year` to `account_service` (its `(account_id, service_type)` uniqueness intentionally means "does this account ever buy this").

**Q5 — Monday "All Schools" column classification** (mapped to existing canonical fields):

| Bucket | Fields |
|---|---|
| (i) Permanent account truth | `organization.{canonical_name, display_name, external_code, client_organization_type, parent_organization_id, client_entity_kind, main_phone, office_phone, website, logo_url}`; `school_profile.{district_name, school_type, primary_location_id, tags}`; `account_service.{service_type, status}`; ownership (`client_internal_owner`, `account_owner_user_id`); contacts + `client_roles[]` |
| (ii) School-year/season config | `school_profile.school_year_label` (label only); **mis-located on the Job:** `school_job_profiles.{school_year, grade_scope, roster_source, id_cards_required, yearbook_required, composite_required, admin_portal_required, data_import_mode, advisor/homeroom_sorting_required}`; `sports_job_profiles.{season, sport_type, league_name, division, revenue_share_*, proof/banner/specialty/buddy/sponsor flags}` |
| (iii) Dated Job/Shoot truth | `school_job_profiles.{specific_area, submission_deadline, special_instructions, district_id}`; `jobs.{scheduled_start_at/end_at, estimated/actual_subject_count, client/production_deadline_at}`; `job_days.*` |
| (iv) Workflow state | `jobs.{job_status, production_status, staffing_status, readiness_status, sync_status, risk_status, priority_level, published_at, archived_at}`; `school_profile.relationship_health_state`; `school_activity_log` |
| (v) Reporting-only/derived | `profitability_*.season_id`, `production_project_template.season_key`, growth/flagship scores |

The classification itself proves the violation: bucket (ii) fields physically live in bucket (iii) tables.

**Q6 — Does Create Organization support…?** parent District selector **ABSENT**; existing-Contact selection **ABSENT in create-org** (separate post-create drawer); inline Contact creation **PARTIAL** (one primary, no role, no dedup); multiple contextual Contacts **ABSENT**; approved Locations **ABSENT at create** (separate `POST /:id/locations`); website normalization **ABSENT**; logo preview/history **PARTIAL/cosmetic** (rendered, stored in `notes`, no upload/history); brand fields **PARTIAL/non-canonical** (color/mascot serialized into `notes`).

**Q7 — What prevents Organization detail from being the complete account SoT?** No hierarchy shown; website/main-phone live only in `notes` (not columns/queryable); `account_service` not surfaced; ownership fractured across three homes; brand/logo text-encoded in `notes` (lossy, no history); role data split (B vs C vs D); two services back one table so detail reads a strict subset.

**Q8 — Which legacy Directory / Client Command paths overlap the canonical model?** All read canonical tables — **no second org/contact store**. Overlaps are *presentations*: CCC (own dashboard API + the only place hierarchy/ownership/services surface; satellites demo-only), Sports Contacts/Accounts (own read API + types over canonical rows), SchoolsHub (1:1 `school_profile` extension + own activity log), Sales Pipeline (opportunity overlay, 0 rows), `Contacts.tsx` alias. Structural debt: two location→contact link tables (`shoot_contact_link` used vs `location_contact_link` empty); dead granular permission codes.

**Q9 — Which fields/relationships need additive migrations?** New: brand columns (`brand_primary_color`, `brand_secondary_color`, `mascot`); `organization_logo_history` (or versioned `logo_url`); `normalized_website`/`website_host` (+ backfill); hierarchy-integrity constraint (parent kind=`parent_organization`, child=`account`; optional cycle guard); the `school_service_term` `(organization_id, school_year)` table (Q4); a year/season reference from `jobs`; relax `organization_contact.organization_id` to nullable (contact reuse); a unified canonical role column. Already exist: the OCR join, per-relationship roles, relationship history (058), consent (151), `account_service`/`client_internal_owner`, hierarchy columns (144), room/area + location-memory.

**Q10 — Which changes need no schema change?** Surface `account_service` with a real editor (status/seasonal/notes/remove); build the "All Schools" board by joining existing `organization`+`school_profile`+`account_service`+latest `school_job_profiles`; render `school_profile`/hierarchy fields; **write the existing `parent_organization_id`/`client_entity_kind`/`client_organization_type`/`website`/`main_phone` columns from the Directory create/detail (stop using `notes`)**; consolidate the two intake stacks; normalize demo data (season vocabulary).

---

## 3. Locked-architecture verification

| Locked decision | Verdict | Evidence |
|---|---|---|
| District is a canonical Organization | **PARTIAL** | Columns exist (144) + demo proves; but production path uses free-text `school_profile.district_name`; no integrity constraint |
| School is a canonical Organization linked to its parent District | **PARTIAL** | `parent_organization_id` works in demo; Directory create/detail never writes/reads it |
| Contacts remain reusable canonical Contacts | **FALSE today** | `organization_contact.organization_id NOT NULL`; 0 cross-org contacts; only CSV import reuses |
| Contact roles belong to the org-contact relationship | **MOSTLY (violated)** | A/B/C on OCR ✓; but `role_category` (D) on the contact is what the create UI sets, and A is degenerate |
| Locations remain canonical and reusable | **CONFIRMED** (1 caveat) | Reuse proven (1 location→1963 shoots); but single `organization_id` FK ⇒ no cross-org venue sharing |
| Static account truth separate from school-year/season service truth | **VIOLATED** | School-year service is job-scoped only; no `(org, year)` layer |
| Dated Job/Shoot truth separate from both | **CONFIRMED** | `jobs`/`shoot` distinct from account/service tables, FK-linked |

---

## 4. Recommended canonical model

- **Organization = the account root.** A **District** is `organization` with `client_entity_kind='parent_organization'` + `client_organization_type='school_district'`; a **School** is `organization` with `client_entity_kind='account'` + `parent_organization_id → district`. Retire `school_profile.district_name` (free text) and reconcile `school_job_profiles.district_id` onto `parent_organization_id`. Add a hierarchy-integrity constraint. Keep `account_type` (line-of-business) orthogonal.
- **Promote brand/website/phone to real columns** (today in `notes`); add a logo-history table; add website normalization. The Directory create/detail becomes the account SoT.
- **Contact = reusable canonical person.** Relax `organization_contact.organization_id` to nullable (or split identity from the org link); standardize on **one** relationship-scoped role array (absorb C + D into B); reduce `relationship_role` to a true relationship *type*. A contact can then carry distinct roles at District vs School.
- **Location stays canonical/reusable**; optionally add an explicit `approved` status and an ordered `organization_approved_location` set; optionally a location `timezone`.
- **Add the missing middle layer `school_service_term` `(tenant, organization_id, school_year[/season])`** for per-year service scope; jobs reference/snapshot it. Keep `account_service` as the permanent "does this account buy this" catalog.
- **One Directory surface; lenses, not forks.** CCC/Sports/Schools become governed *views* over the canonical tables; converge the two job-intake stacks; consolidate the two location-contact link tables.

---

## 5. Exact schema changes (all additive)

1. **`organization`**: `ADD COLUMN brand_primary_color text, brand_secondary_color text, mascot text, normalized_website text` (nullable).
2. **`organization_logo_history`** (new): `(id, tenant_id, organization_id FK, logo_url, set_by_user_id, set_at, note)`.
3. **Hierarchy integrity**: a deferred CHECK/trigger — a row with `parent_organization_id` set must have `client_entity_kind='account'`, its parent `parent_organization`; optional recursive cycle guard.
4. **`school_service_term`** (new): `(id, tenant_id, organization_id FK, school_year text, season text NULL, <service scope columns lifted from school_job_profiles/sports_job_profiles>, status, notes, audit)`, UNIQUE `(tenant_id, organization_id, school_year, COALESCE(season,''))`. Optional `jobs.school_service_term_id` FK.
5. **`organization_contact.organization_id` → nullable** (contact reuse) — or a new `contact` identity table; data-migration-heavy, gated to a later slice.
6. **Unified role**: standardize on `organization_contact_relationship.client_roles[]`; migrate `school_contact_categories[]` (C) + `role_category` (D) into it (the 071 mapping already exists); later drop the redundant enums/column.
7. *(Optional)* `shoot_location.timezone`, explicit `approval_status`, `organization_approved_location` link table.

Every change uses `ADD COLUMN [IF NOT EXISTS]` / new nullable table (the safe 144/155 pattern); existing rows stay valid.

---

## 6. Implementation slices (proposed, gated one at a time)

- **Slice 1 (CODE-ONLY, no migration) — canonical hierarchy in the Directory.** Extend `organizations.ts` create/update + the Directory form/detail to **write and read the existing `parent_organization_id`, `client_entity_kind`, `client_organization_type`, `website`, `main_phone` columns** (stop packing them into `notes`); add a **parent-District selector** and surface the hierarchy in Organization detail. Converges the two stacks; reversible; no backfill.
- **Slice 2 (additive migration) — structured brand identity.** Brand color/mascot/normalized_website columns + logo-history table + website normalization fn; migrate the `notes`-encoded values forward (best-effort parse), keep `notes` for free text.
- **Slice 3 (additive migration) — school-year service layer.** `school_service_term`; read/write UI on Organization detail ("This year's services"); jobs reference it (snapshot at intake). No change to existing job profiles initially.
- **Slice 4 — hierarchy integrity + district reconciliation.** Add the integrity constraint; backfill `parent_organization_id` from `school_profile.district_name`/`school_job_profiles.district_id` (with a review queue for ambiguous names); deprecate `district_name`.
- **Slice 5 — contact reuse + role unification.** Relax the contact↔org binding; migrate C/D → B; rewire readers; existing-contact picker + multi-contextual contacts in create-org.
- **Slice 6 — governance consolidation.** Lenses over one dataset; consolidate location-contact link tables; wire the dead granular permission codes (or formally retire them).

Each slice = its own bounded commit with tests, dry-run where data moves, and a stop-for-review gate before any backfill — mirroring the Phase 3C/3C.1 discipline.

---

## 7. Migration risks

- **Hierarchy constraint vs dirty data:** the integrity constraint (Slice 4) will reject existing rows if any school has a non-account parent or a cycle — must run a dry-run + cleanup first; deploy as `NOT VALID` then `VALIDATE`.
- **`organization_contact.organization_id` nullable (Slice 5):** every reader assumes a home org (the detail API flattens one relationship onto the contact). Relaxing it is broad-blast; needs a compatibility shim and staged reader migration.
- **Enum deprecation:** dropping `school_contact_category`/`directory_contact_role_category` must follow data migration; never drop in the same migration that backfills.
- **Two intake stacks:** changing a school/sports profile field touches both `jobsApi`/`DepartmentJobAdapterUIRegistry` and `centralJobIntakeApi`/`JobIntakeFields` — pick one before schema work.

## 8. Data-backfill risks

- **District name → org match (Slice 4):** `school_profile.district_name` is free text; matching to a canonical district org is fuzzy (same class of ambiguity as the Phase-3A Shoot↔Job audit — org+date gave 0 exact / 46 ambiguous). **Require a human review queue; never auto-merge.**
- **`notes`-encoded brand/website parse (Slice 2):** `buildOrganizationNotes` is a known format, but hand-edited `notes` may not round-trip — parse best-effort, preserve original `notes`, flag misses.
- **Season vocabulary:** `sports_job_profiles.season` is inconsistent (`winter` vs `Spring 2026`); normalize before keying a term table.
- **`account_service` is sparse demo data** (6 rows) — a year layer must not assume completeness.

## 9. Permissions matrix (target)

| Action | Today | Target |
|---|---|---|
| Read directory (org/contact/location) | any authenticated (no gate) | read scope (e.g. `organization.read`) — wire the seeded codes or formally accept open-read |
| Create/update org, contact, location | tier `director_admin`+ OR client-success/CSR | unchanged, but enforced via `organization.create/update` etc. codes for least-privilege |
| Manage hierarchy (set parent District) | n/a | same as org-update (`director_admin`+ / client-success) |
| Manage school-year service term | n/a | school-foundation managers (`canManageSchoolFoundation`) |
| Manage brand/logo | within org-update | same |
| Read account audit history | not surfaced | leadership/director_admin |
| Cross-tenant | impossible (RLS) | unchanged |

## 10. Acceptance criteria (Phase 4 overall)

- Organization detail is the **single account source of truth**: hierarchy, brand, website/phone, owners, services-this-year, contacts-with-roles, locations, and history all visible from one place, all backed by **columns** (not `notes`).
- A School shows its parent District (and a District shows its Schools); no free-text district remains as the source of truth.
- A school's **service config for a given year** is queryable independent of any Job.
- A Contact can hold **different roles at District vs School**; one canonical role vocabulary.
- No second org/contact/location store; CCC/Sports/Schools are lenses over the canonical tables.
- Every mutation audited; reversible; RLS/tenant-safe; demo data clearly seamed (`client_demo_key`).

## 11. Explicit non-goals (this phase)

- **No Monday.com data import.** **No** role-specific Schools dashboards. **No** change to Job/Shoot linking (Phase 3D stays gated; no fuzzy bridge). **No** recreation of any "Vibe" prototype as a separate app (IA reference only). **No** hard deletes. **No** second Schools database. **No** survey engine build (absent; out of scope).

## 12. Recommended first bounded implementation commit

**`feat: write and surface the canonical organization hierarchy in the Directory` (Slice 1 — code-only, no migration).**

Make the production Directory use the hierarchy columns that already exist (migration 144): in `services/organizations.ts` `createOrganization`/`updateOrganization`, persist `parent_organization_id`, `client_entity_kind`, `client_organization_type`, `website`, `main_phone` from the form instead of the `notes` blob; add a **parent-District selector** (search existing `parent_organization` orgs) to `OrganizationEditorForm`; render the District→School relationship + website/phone in `DirectoryWorkspace` Organization detail. Additive, reversible, no schema change, no backfill — it directly advances "District is a canonical Organization; School links to its parent District," converges the Directory and CCC stacks onto one hierarchy, and is independently testable (extend `organizationsDirectory.test.ts` to assert a written/read parent link). Subsequent slices (brand columns, the school-year service term, district reconciliation) follow as their own gated commits.

---

*Audit complete. No code changed. Awaiting review before any Phase 4 implementation.*
