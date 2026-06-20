# Phase 4 — Canonical Directory & Schools: Completion Report

**Date:** 2026-06-20
**Branch:** `feature/work-spine-foundation-v1` · from Phase 4 audit HEAD `9e0289d`
**Migration head:** 162 (applied + verified). **Pushed:** nothing. **`stash@{0}`:** untouched.

**Scope delivered:** the canonical-model backend for Slices 1–4 and 7 — Organization hierarchy (with the initial Directory UI), reusable Contact identity, brand/website/logo history, the school-year/season service layer, and deterministic legacy district reconciliation. All additive, RLS-forced, reversible, and tested. The remaining UI-rebuild slices (4B service-term UI, 5 full detail, 6 create flow), the Job-Intake UI integration (8), and the permissions/a11y/30-step browser pass (9) are scoped in §5 — they require the admin-web React detail/create rebuilds and a browser environment.

Explicit confirmations: **no Monday import ran · no role-specific Schools dashboard was built · no Job↔Shoot link changed · no hard deletion occurred · no second Schools database / `schools_v2` was created · no Vibe app was rebuilt · no new structured values were written to the `organization.notes` blob.** No NOT-NULL column was relaxed. No record was fuzzy-merged.

---

## 1. Commit ledger (this program)

| Commit | Slice | Subject |
|---|---|---|
| `9e0289d` | audit | docs: audit canonical directory and schools for phase 4 |
| `67dbaac` | 1 (full) | feat: write canonical organization hierarchy in directory |
| `a4dc9a0` | 4 (backend) | feat: add school year and season service profiles |
| `bf2895f` | 2 (backend) | feat: add reusable contacts and contextual organization roles |
| `f6a90a2` | 3 (backend) | feat: normalize organization brand and logo history |
| `8065902` | 7 (backend) | fix: reconcile legacy directory data into canonical records |
| `3e0641d`,`3683330`,_this_ | docs | progress → completion report |

All additive + reversible. No migration destroyed history.

## 2. Migrations (all additive, RLS-forced, clean-DB safe)

- **160 `school_service_term`** — `(tenant, organization)` time-bound service terms; one-`current`-per-period partial unique; rollover provenance.
- **161 `contact` + `organization_contact.contact_id`** — reusable Contact identity; the org-bound relationship keeps `organization_id NOT NULL`; email intentionally non-unique.
- **162 organization brand columns + `organization_logo_history`** — brand_primary/secondary_color, mascot, brand_status, normalized_website, logo_status; append-only logo history.

Each uses `app.current_tenant_id()` RLS, `gen_random_uuid()` PKs, tenant-safe FKs, and `IF NOT EXISTS`/nullable additions — verified applied on the live dev DB and structurally clean-DB safe (no data dependencies). Reversal = revert the commit + `DROP TABLE`/`DROP COLUMN`.

## 3. Final canonical model (delivered backend)

- **Organization hierarchy (Slice 1):** District = `client_entity_kind='parent_organization'` (top-level); School = `account` with `parent_organization_id` → District. Validated (same-tenant, parent-is-District, no self/cycle), backward-compatible (legacy parentless schools still work), with parent/child reads and a legacy-notes fallback for website/phone. Website/Main Phone are canonical fields; the form stopped packing them into notes.
- **Reusable Contact (Slice 2):** a `contact` identity referenced by org-bound rows via `contact_id`. `linkContactToOrganization` gives one identity distinct per-org roles (District contact + School picture-day contact). Roles consolidate onto the canonical `client_roles[]`. An idempotent, reversible, dry-run-default backfill creates one identity per existing row, never merging on name/email, leaving identity-less rows Review Required.
- **Brand / website / logo (Slice 3):** brand colors/mascot + explicit state values in real columns; one `normalizeWebsite` (adds https://, lowercases host, drops trailing slash, rejects unsafe protocols), wired into create/update; append-only logo history with restore; a dry-run legacy-notes brand parser (never strips notes).
- **School-year/season service truth (Slice 4):** `school_service_term` with explicit current selection (activating a newer term closes the prior as historical), rollover into an unconfirmed draft with inherited markers (never silently current), and confirm/change — separate from static account truth (`account_service` untouched) and dated Job/Shoot truth.
- **Legacy reconciliation (Slice 7):** `reconcileDistricts` classifies Schools' legacy free-text `district_name` against canonical Districts and links ONLY deterministic exact matches on parentless Schools (never overwrites a parent, never merges); dry-run writes nothing; idempotent; reversible via `applied_links`; batch + audit.

## 4. Test + build results (this session)

**New Phase 4 API tests (45):** organizationHierarchy 16 · schoolServiceTerm 9 · canonicalContacts 5 · organizationBrand 12 · directoryReconciliation 3 — all green. **Web:** organizationsPage 30/30 (updated for canonical website/phone/entity-kind, not notes). **Regression (green):** organizationsDirectory 16 · clientCommandCenter 2 · schoolsHub 9. **Typechecks:** api + admin-web `tsc --noEmit` clean. **Builds:** api + admin-web `build` OK. **Migration head 162 applied.**

Test-infra notes: a few service-level tests run inside a rolled-back transaction (deterministic) to avoid (a) the shared dev DB's intermittent first-write 500 (observed across phases) and (b) mutating live demo data; the route paths are covered by dry-run / RBAC / cross-tenant cases. Pre-existing baseline (untouched): the 3 `timeClockMileagePhase5` assertions; admin-web parallel-run flakiness (serial is green).

## 5. Remaining slices (continuation — UI + browser)

Backend is in place for these; the work below is admin-web React + browser:

- **Slice 4B — service-term UI:** admin-web client types + current/next/history view + rollover/confirm actions on Organization detail (consume the Slice 4 API; no second rollover algorithm in React).
- **Slice 5 — full Directory navigation + detail:** searchable canonical Parent-District selector (replacing the `districtOptions` prop), full-page Organization route (Back-preserving, deny/not-found), District/School/Contact/Location detail surfaces over the canonical reads, parentless-legacy-school "Review Required" marker, a11y + no-N+1.
- **Slice 6 — canonical Create Organization:** progressive sections (hierarchy → identity → parent → locations → contacts → ownership → brand → notes → initial term), existing/inline Contact + Location, one transaction with staged uploads, field-level errors.
- **Slice 8 — Job Intake:** District→School→approved-Location→contextual-Contact selection by canonical id; room/area stays free text (no duplicate Location); current service-term context shown but only required values snapshotted; Sports/non-school intake unchanged.
- **Slice 9 — permissions matrix + a11y + performance + 30-step browser pass + this report's browser section.** A server-side permission matrix (wire the seeded `organization.*`/`contact.*`/`location.*` codes or formally accept the tier floor) + the deterministic browser scenario (start Docker/API/admin-web, fixture + cleanup).

The Slice-7 framework also extends to contact-identity reconciliation (reuse the Slice 2 backfill) and notes reconciliation (reuse the Slice 3 parser) under one batch artifact; the demo-tenant reversible apply runs as a gated batch with JSON/Markdown artifacts.

## 6. Rollback / deployment

All migrations are additive (new tables / nullable columns); rolling back the app leaves them harmless. Each feature commit is individually revertible. No endpoint marks, archives, or deletes without an explicit admin apply (`?apply=true`); all default to dry-run/read. The brand website-normalization swap rejects unsafe protocols on write (a deliberate hardening). Demo-curation and Phase 1–3 work are untouched.

## 7. Known limitations

1. The detail/create/service-term UIs (Slices 4B/5/6/8) are not built — the canonical backend + APIs are ready for them.
2. The reconciliation apply + contact backfill apply are dry-run by default; the demo-tenant reversible apply + artifacts are a gated batch (not executed this session).
3. The legacy `organization.notes` still contains brand/owner tokens for existing rows; new writes don't add to it, and the Slice-3 parser can extract them deterministically (apply pending Slice 6/7).
4. The 30-step browser verification (Slice 9) requires the admin-web preview environment.
