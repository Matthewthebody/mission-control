# Phase 4 — Canonical Directory & Schools: Progress Report (Slice 1 complete)

**Date:** 2026-06-20
**Branch:** `feature/work-spine-foundation-v1` · from Phase 4 audit HEAD `9e0289d`
**Status:** **Slice 1 (`67dbaac`, full) and Slice 4 backend (`a4dc9a0`) implemented, tested, committed** — the audit's two highest-value items (canonical hierarchy + the missing school-year/season service layer). Slices 2, 3, 5–9 are scoped below for continuation. No Monday import, no role dashboards, no Job↔Shoot link change, no hard deletion, no second Schools database — confirmed. `stash@{0}` untouched; nothing pushed.

This report is deliberately honest about what is done versus what remains. Slice 1 — the audit's recommended first bounded commit — is complete to the full standard (additive, backward-compatible, reversible, tested). Slices 2–9 each carry real migrations, backfills, UI rebuilds, a reconciliation framework, job-intake integration, and a 30-step browser pass; they are a multi-session program and are mapped precisely here so the next session resumes without re-discovery.

---

## 1. Confirmations (held this session)

- ✅ No Monday.com import. ✅ No role-specific Schools dashboards. ✅ No Phase 3D Job↔Shoot bridge change. ✅ No hard deletion. ✅ No fuzzy merge. ✅ No second Schools DB / `schools_v2`. ✅ No Vibe-app rebuild. ✅ No new structured values written to the `organization.notes` blob (Slice 1 removed Website/Main Phone from it). ✅ `stash@{0}` untouched; nothing pushed (ahead of origin). ✅ Preserved commits present (`9e0289d`, the Phase 3C.1 chain, the demo-curation batch + artifact).

## 2. Slice 1 — Canonical Organization hierarchy and core fields — DONE (`67dbaac`)

**Migration:** none — the audit confirmed migration 144 already added `parent_organization_id`, `client_entity_kind`, `client_organization_type`, `website`, `main_phone` (live-verified this session).

**API** (`packages/api/src`):
- New `services/organizationHierarchy.ts`: `validateOrganizationParent` (parent exists + same tenant + is a `parent_organization` + not self + no cycle, via an upward walk) and `parseLegacyOrganizationNotes` (read-only fallback parsing Website/Main Phone from the legacy notes block).
- `services/organizations.ts`: `createOrganization`/`updateOrganization` persist the five canonical fields. A **District** = `client_entity_kind='parent_organization'` (top-level); a **School** = `account` with `parent_organization_id` → its District. **Backward-compatible**: the parent-District requirement fires only when the caller opts into the canonical account flow (`client_entity_kind` set) on create, and on update only blocks *removing* an existing parent — so legacy parentless schools keep working (the existing directory suite stays green). `loadOrganizationSummary` returns the hierarchy fields + parent display name + child count; `getOrganizationDetail` returns `child_organizations` (a District's Schools). Website/main_phone fall back to parsed notes when the canonical column is null.
- `routes/organizations.ts`: create/update schema + handlers thread the new fields (enum values pinned to the live schema).

**Web** (`packages/admin-web/src`): the org form sends Website / Main Phone / Entity Kind / Parent District as canonical payload fields and **no longer packs Website/Main Phone into notes**; adds an Entity Kind selector + a Parent District selector (`districtOptions`); edit pre-fills the canonical fields so editing preserves them.

**Tests:** `organizationHierarchy.test.ts` (16): District/School create, parent validation, cross-tenant parent denial, self-parent + cycle guard, canonical columns (not notes), legacy-notes fallback, child listing, parent identification, exact-only duplicate (no fuzzy merge), RBAC (non-manager 403), and Directory == Client-Command hierarchy. `organizationsPage.test.tsx` updated to assert canonical website/phone/entity-kind (not notes). No regressions (directory 16, CCC 2, schoolsHub 9). api + web `tsc` clean.

**Reversal:** revert `67dbaac`; the canonical columns simply go unused again (no data migrated).

**Known limitations:** the parent-District selector consumes a `districtOptions` prop (the searchable wiring + full District/School *detail* rendering are Slice 5–6); a bare-mount standalone form test hit a jsdom state-flush quirk, so the form's canonical-field behavior is verified through the proven page test.

## 2b. Slice 4 — School-year/season service truth — DONE (backend) (`a4dc9a0`)

**The audit's #1 gap, closed at the model + API layer.** Purely additive, RLS-forced, reversible (`DROP TABLE`); no existing reader affected; `account_service` (the permanent catalog) unchanged.

- **Migration 160** `school_service_term`: tenant-safe FKs, RLS forced via `app.current_tenant_id()`, `gen_random_uuid()` PK. `period_type` (school_year|season|custom) + `period_label`; `status` (draft|current|closed) with a **partial unique index guaranteeing at most one `current`** per (org, period_type); `confirmation_state`; `service_config jsonb`; rollover provenance (`copied_from_term_id`, `inherited_field_keys`, `confirmed_by/at`); CHECK constraints; `UNIQUE (tenant, org, period_type, period_label)`. Applied via the migrate runner (additive — verified on the live dev DB; structurally clean-DB safe, no data dependencies).
- **`services/schoolServiceTerm.ts`**: create / list / getCurrent / setCurrent (activating a newer term **closes** the prior current — history preserved, never deleted) / **rollover** (copies a prior term into an **unconfirmed draft** with `inherited_field_keys` + `copied_from_term_id` — inherited values never silently become confirmed current truth) / update (confirm + change). School-foundation manage RBAC; audited.
- **Routes** (organizations router): `GET/POST /:id/service-terms`, `POST /service-terms/:termId/rollover`, `/activate`, `PATCH /service-terms/:termId`.
- **Tests** `schoolServiceTerm.test.ts` (9): create school-year + season; explicit current selection with the prior preserved as historical (one current enforced); rollover → unconfirmed draft with inherited markers; confirm + change a copied value without touching the source year; duplicate 409; static org data unaffected; RBAC 403; tenant isolation 404.

**Reversal:** revert `a4dc9a0` and `DROP TABLE school_service_term` (additive, no data migrated).
**Remaining for full Slice 4:** the Organization-detail term view + rollover UI (lands with the detail/create rebuild, Slices 5–6).

## 3. Slices 2, 3, 5–9 — continuation map (not yet implemented)

Each is its own bounded commit with tests + (where data moves) a dry-run and a stop-for-review gate, mirroring the Phase 3C/3C.1 discipline. Concrete targets from the audit (`docs/phase4-directory-schools-canonical-audit.md`):

**Slice 2 — Reusable canonical Contacts + contextual roles** (`feat: add reusable contacts and contextual organization roles`). Additive migration: add nullable `organization_contact.contact_id` (or a canonical `contact` identity table) + backfill one identity per existing org-bound contact (idempotent, no name/email merge — duplicates → Review Required). Consolidate the four role vocabularies (`relationship_role`/`client_roles[]`/`school_contact_categories[]`/`role_category`) onto one relationship-scoped role array with backward-compatible mapping. **Risk (high):** relaxing the heavily-read `organization_contact.organization_id NOT NULL` is broad-blast — stage with a compatibility shim; keep the NOT-NULL relaxation behind a dry-run + review gate. Tests: cross-org reuse, distinct per-relationship roles, person-vs-relationship edit isolation, shared-email-not-merged, backfill idempotency, archive/unlink preserves history, RLS.

**Slice 3 — Canonical brand + logo history + website normalization** (`feat: normalize organization brand and logo history`). Additive migration: `brand_primary_color`, `brand_secondary_color`, `mascot`, `brand_status` columns + an `organization_logo_history` table (or reuse the Resource Library). A website-normalization helper (accept `example.org` / `www…` / `https://…`, reject unsafe protocols). A dry-run legacy-notes parser for brand tokens (deterministic extraction only; never strips notes). Explicit known/unknown/not-available/not-applicable states. Tests: normalization cases, logo history + restore, brand states, dry-run extraction, no notes destruction.

**Slice 4 — School-year/season service truth — DONE (backend), `a4dc9a0`.** See §2b. Remaining: the org-detail term UI + rollover UI (lands with Slices 5–6).

**Slice 5 — Canonical Directory navigation + full Organization detail** (`feat: add canonical district and school organization detail`). Full-page Organization route (Back-preserving, deep-linkable, permission-safe); District detail (child-school list, service-term overview, addresses/locations, contacts) and School detail (parent District, approved Locations + room/area notes, contextual contacts + roles, current/next term, Jobs/Shoots via canonical relation, Location Intelligence, comms, evals). Reads canonical sources only; no copying onto Organization. Bounded sections, no N+1, a11y. Tests: navigation, full route, child/parent rendering, honest unavailable sections, loading/empty/error/denied, performance.

**Slice 6 — Canonical Create Organization flow** (`feat: rebuild organization creation on canonical directory data`). Progressive sections (hierarchy → identity → parent → Locations → Contacts → ownership → brand → notes); existing-Contact picker + inline create + multiple contextual contacts; existing/inline Locations; one transaction with staged file uploads; field-level errors + input preservation. Tests: 20 (district/school create, contact reuse across district+school, location selection/inline, transaction rollback, upload cleanup, RBAC, validation).

**Slice 7 — Legacy reconciliation + deterministic backfill** (`fix: reconcile legacy directory data into canonical records`) — backend-heavy, in the Phase 3C.1 mold. One tenant-scoped, dry-run, idempotent, batch-identified, auditable, reversible framework. District reconciliation (`school_profile.district_name` + `school_job_profiles.district_id` → `parent_organization_id`, deterministic-only, human review for ambiguous, never overwrite an existing parent). Notes reconciliation (Slice 3 parser). Contact backfill (Slice 2). Demo-tenant: reversible apply after dry-run + artifact + batch id; operational tenants: only unquestionable additive links, rest Review Required. JSON + Markdown artifacts. Tests: dry-run writes nothing, stable, deterministic-only, no overwrite, cross-tenant impossible, idempotent, no hard delete, no Job/Shoot links.

**Slice 8 — Job Intake integration** (`fix: use canonical directory records in job intake`). District→School→approved-Location→contextual-Contact selection by canonical id (room/area stays free text, no duplicate Location per phrase); current service-term context shown but only required values snapshotted onto the Job. Tests: scoping, no duplicate org/location, job stays historical when term changes later, RBAC, non-school intake unaffected.

**Slice 9 — Permissions, hardening, browser verification, report** (`test: close phase 4 canonical directory and schools verification`). A documented Directory permission matrix (wire the seeded `organization.*`/`contact.*`/`location.*` codes or formally accept the tier floor); WCAG 2.2 AA pass; performance at realistic scale; the 30-step deterministic browser scenario; full suites + typechecks + builds; the final completion report (apply states, before/after counts, baseline failures incl. the 3 pre-existing `timeClockMileagePhase5`).

## 4. Recommended next action

Resume at **Slice 3** (brand + logo history + website normalization — additive, continues the "no structured values in notes" cleanup) or **Slice 7** (reconciliation — read-only dry-run first, maximally safe; links the legacy free-text `school_profile.district_name` to canonical `parent_organization_id`). Defer **Slice 2** (contact reuse) until its NOT-NULL relaxation can be gated behind a dry-run + review. The UI-heavy detail/create rebuilds (Slices 5–6) + the 30-step browser pass are best done in a focused session with the preview launcher available.

## 5. Test + build state (this session)

`organizationHierarchy` 16/16 · `schoolServiceTerm` 9/9 · `organizationsPage` 30/30 · `organizationsDirectory` 16/16 · `clientCommandCenter` 2/2 · `schoolsHub` 9/9 · api `tsc` clean · web `tsc` clean. **Migration head 160 applied** (additive, RLS-forced). Pre-existing baseline (untouched): the 3 `timeClockMileagePhase5` assertions; admin-web parallel-run flakiness (serial is green).

## 6. Commit ledger (this session)

| Commit | Subject |
|---|---|
| `67dbaac` | feat: write canonical organization hierarchy in directory (Slice 1, full) |
| `a4dc9a0` | feat: add school year and season service profiles (Slice 4 backend) |
| _this_ | docs: report (updated for Slice 4) |

All additive + reversible. No migration destroyed history. No hard deletion. No Monday import. No Job↔Shoot link change. No second Schools DB. `stash@{0}` untouched. Nothing pushed.
