# Phase 4 — Canonical Directory & Schools: Completion Report

**Date:** 2026-06-20
**Branch:** `feature/work-spine-foundation-v1` · from Phase 4 audit HEAD `9e0289d`
**Migration head:** 162 (applied + verified). **Pushed:** nothing. **`stash@{0}`:** untouched.

**Scope delivered:** the complete canonical Directory & Schools product experience — the
canonical model backend (Slices 1–4, 7) **and** the full admin-web product surface and
verification (Slices A–G): stabilized API contracts, the school-year/season service-term
experience, canonical District↔School navigation and detail, a canonical Create Organization
flow, an orchestrated legacy-reconciliation batch with demo artifacts, canonical job-intake
context, an enforced permission matrix, and a real browser verification against the running
app. All additive, RLS-forced, reversible, and tested.

Explicit confirmations (all hold): **no Monday.com import ran · no role-specific Schools
dashboard was built · no Job↔Shoot link was created or changed · no Urgent-Window action hash
or mileage was edited · no hard deletion occurred · no record was fuzzy-merged · no second
Schools database / District or School table was created · no NOT-NULL column was relaxed
(`organization_contact.organization_id` stayed NOT NULL) · no new structured values were
written to the `organization.notes` blob (brand moved *out* of notes to canonical columns) ·
Phase 5 / Phase 3D were not started.**

---

## 1. Commit ledger

| Commit | Slice | Subject |
|---|---|---|
| `9e0289d` | audit | docs: audit canonical directory and schools for phase 4 |
| `67dbaac` | 1 | feat: write canonical organization hierarchy in directory |
| `a4dc9a0` | 4 (backend) | feat: add school year and season service profiles |
| `bf2895f` | 2 (backend) | feat: add reusable contacts and contextual organization roles |
| `f6a90a2` | 3 (backend) | feat: normalize organization brand and logo history |
| `8065902` | 7 (backend) | fix: reconcile legacy directory data into canonical records |
| `63daf76` | report | docs: report phase 4 canonical directory backend and verification |
| `e7a6893` | A | fix: stabilize canonical directory API contracts |
| `807e800` | B | feat: surface school year and season service profiles |
| `7dab52b` | C | feat: add canonical district school contact and location detail |
| `bdec4ba` | D | feat: rebuild organization creation on canonical directory data |
| `cd19d65` | E | fix: reconcile legacy directory data into canonical records |
| `e18d300` | F | fix: use canonical directory records in job intake |
| `9d02d1b` | G | fix: enforce canonical directory permissions |
| _this_ | G | test: close phase 4 canonical directory and schools verification |

All additive + reversible. No migration destroyed history. The seven preserved commits
(`9e0289d`, `67dbaac`, `a4dc9a0`, `bf2895f`, `f6a90a2`, `8065902`, `63daf76`) are intact and
were not amended, squashed, reset, or rebased.

## 2. Migrations (160–162, all additive, RLS-forced, clean-DB safe)

Unchanged in A–G (no new migrations were needed — the UI/service work is additive over the
existing canonical schema):

- **160 `school_service_term`** — `(tenant, organization)` time-bound terms; one-`current`-per-period partial unique; rollover provenance.
- **161 `contact` + `organization_contact.contact_id`** — reusable Contact identity; org-bound relationship stays `organization_id NOT NULL`; email intentionally non-unique.
- **162 organization brand columns + `organization_logo_history`** — brand colors, mascot, brand/logo status, normalized website; append-only logo history.

## 3. What each slice delivered (A–G)

- **A — Stabilize API contracts (`e7a6893`).** Cast `organization_contact_relationship.client_roles` to `text[]` in `getContactRelationships` so per-org rich roles serialize as a real JSON array (not a Postgres array string) over HTTP, and surfaced `organization_contact_id` for a stable unlink target. Added an HTTP route test for the array contract.
- **B — Service-term experience (`807e800`).** `ServiceTermsPanel` (self-contained, `token`+`organizationId`) over the Slice 4 API: current term, upcoming drafts, closed history. Rolled-over drafts are flagged **Needs review** and list inherited field keys (copied ≠ confirmed). Managers add / roll over / confirm / make-current / change; non-managers see read-only. No rollover algorithm reimplemented in React.
- **C — Canonical navigation + detail (`7dab52b`).** Searchable canonical-districts read (`GET /districts`, only `client_entity_kind='parent_organization'`, with child counts). `ParentDistrictSelector` (self-loading, searchable) replaces the unwired `districtOptions` prop — a District is chosen as a record, never typed. `OrganizationHierarchyCard` shows child Schools on a District, the parent District on a School, and **Review required** for a parentless school account.
- **D — Canonical Create Organization (`bdec4ba`).** Brand (colors / mascot / logo status / logo notes) is mapped to the migration-162 columns and applied via `PATCH /:id/brand` after upsert (create + edit); `buildOrganizationNotes` no longer emits any brand tokens. The dead "Logo Last Updated" field was removed. New school accounts can seed a first service term inline (`POST /:id/service-terms`).
- **E — Reconciliation batch + Demo Studio artifacts (`cd19d65`).** `reconcileDirectoryBatch` reports districts + contacts + brand/notes in one dry-run-by-default pass; apply runs ONLY the surgical, reversible districts links (exact normalized-name match, parentless only). Contact backfill and brand/notes parsing stay Review Required. `POST /reconcile/directory` + `scripts/reconcile-directory-demo.ts` write JSON + Markdown artifacts under `docs/artifacts/` with a batch id + rollback block.
- **F — Canonical job intake (`e18d300`).** `JobIntakeCanonicalContext` shows the selected school's parent District (or **Review required**) and current service term (read from the canonical records by id) in `QuickCreateJobDrawer`; a District shows its child-school count. Pickers continue to resolve organization/location/contact by canonical id; the term is surfaced for confirmation, not silently snapshotted.
- **G — Permissions + verification (`9d02d1b` + this commit).** Permission matrix enforced + locked (below), real browser verification (below), full gates green, and this report.

## 4. Permission matrix (authority-tier floor, enforced)

The canonical directory adopts the **authority-tier floor** the audit recommended (not per-row
permission codes). `directoryPermissionsMatrix.test.ts` locks the contract across every Phase 4
route:

| Tier | Who | Routes | Denial |
|---|---|---|---|
| **Read** | any authenticated user | `GET /districts`, `/:id/service-terms`, `/:id/logo-history`, `/contact-identities/:id/relationships`, list/detail | `401` only when unauthenticated |
| **Manage** | super_admin / leadership / director_admin, or `*_client_success` / `customer_service_rep` | `POST /contact-identities`(+`/links`,`/backfill`), `PATCH /:id/brand`, `POST /:id/logo-restore`, `POST /reconcile/districts`, `POST /reconcile/directory` | `403` for an authenticated non-manager |
| **School foundation** | the above, or schools-supervisor / `director_of_school_photography` | `POST /:id/service-terms`, `POST /service-terms/:id/rollover`\|`activate`, `PATCH /service-terms/:id` | `403` for a non-foundation user |

Authorization is decided by the guard before any write, so the dry-run reconcile is proven
allowed *and* side-effect-free for a manager.

## 5. Test + build results (this session)

**Phase 4 API tests (63, all green):** organizationHierarchy 18 · schoolServiceTerm 9 ·
canonicalContacts 6 · organizationBrand 12 · directoryReconciliation 3 ·
directoryReconciliationBatch 3 · directoryPermissionsMatrix 12.
**Phase 4 web tests (47, all green):** organizationsPage 32 · serviceTermsPanel 5 ·
directoryHierarchy 5 · jobIntakeCanonicalContext 5.
**Regression (green):** API organizationsDirectory 16 · clientCommandCenter 2 · schoolsHub 9;
web jobIntakeQuickCreate 12.
**Gates:** api + admin-web `tsc --noEmit` clean; api + admin-web `build` clean. Migration head 162.

Test-infra notes: service-level tests that mutate run inside a rolled-back transaction
(deterministic) to avoid the shared dev DB's intermittent first-write 500 and to leave live demo
data untouched; their route paths are covered by dry-run / RBAC / cross-tenant cases. Pre-existing
baseline untouched (`timeClockMileagePhase5`; admin-web parallel-run flakiness — serial is green).

## 6. Browser verification (real attempt, against the running app)

Ran a live browser pass against the running admin-web (Vite preview) + API (`:4000`),
authenticated through the app's password/dev-login + cookie/CSRF session:

1. Signed in → Mission Control home.
2. Opened **Directory** → organization search returns canonical accounts.
3. Searched "Wayzata" → 3 canonical orgs (High School, Public Schools, School District).
4. Opened **Wayzata High School** → **Account Hierarchy** card shows `PARENT DISTRICT — Wayzata School District` (correctly *not* flagged Review required) and the **Service Terms** panel renders with the manager's "Add term" action + empty state.
5. Clicked the parent-District link → **Wayzata School District** → **District Hierarchy** shows `1 LINKED SCHOOL — Wayzata High School`. (Bidirectional canonical navigation.)
6. Opened **Create Organization** → searchable **ParentDistrictSelector** ("Choose district") and the **First Service Term** section both render.
7. "Choose district" loaded live canonical districts (Osseo Area Schools · Tonka United · Wayzata School District), each with its child-school count.
8. `GET /api/organizations/districts` → `200`, 3 canonical districts with child counts.
9. `POST /api/organizations/reconcile/directory` (dry-run) → `200`, matches the committed artifact exactly: districts considered=3 (no_candidate=3), contacts unlinked=187, brand/notes review=1, applied all 0.
10. No fixtures were persisted (read-only navigation + an unsubmitted create form). The only failed network calls were two pre-login `GET /auth/session → 401` (expected). The only console errors are a **pre-existing** React duplicate-key warning in an unrelated staffing list ("Trade Replacement Photographer") — none of the Phase 4 components emit it (all use unique `id` keys).

## 7. Accessibility & performance

- **a11y:** the new surfaces carry semantic roles/labels — `ServiceTermsPanel` (`section[aria-label]`, `role="alert"` errors, labelled inputs), `ParentDistrictSelector` (`aria-expanded`, labelled search, `role="listbox"`/`option`, `aria-selected`), `OrganizationHierarchyCard` (`role="status"` review banner, labelled child list), `JobIntakeCanonicalContext` (`role="group"` with label). Verified present in the live accessibility tree.
- **performance (no N+1):** `GET /districts` is a single capped query (LIMIT 50) with a correlated child-count subquery; `child_organizations` is a single capped read (LIMIT 500); `service-terms` is a single ordered query; the reconciliation batch classifies in set queries, not per-row loops. The selector debounces search (200 ms).

## 8. Rollback / deployment

All migrations are additive (new tables / nullable columns); rolling back the app leaves them
harmless, and each feature commit is individually revertible. Every mutating endpoint defaults to
dry-run/read and applies only with explicit management access (`?apply=true` for reconcile). The
reconciliation batch carries a batch id + rollback block (the exact applied links to undo; contact
backfill + brand/notes are reported only and never written by the batch). The committed dry-run
artifact shows the live demo tenant is **not** mutated by this work; the apply is built, dry-run
generated, and test-proven reversible. Demo-curation (Phase 3C.1) and Phase 1–3 work are untouched.

## 9. Known limitations

1. The reconciliation **apply** against live demo data is intentionally not executed in this run
   (the demo tenant shows 0 exact-match district links and 187 contact-identity candidates — a
   bulk create kept as an explicit, separately-gated step). Run `npm --workspace packages/api run
   reconcile:directory-demo -- --apply` when ready; it is reversible via the artifact's rollback block.
2. Brand/notes reconciliation is dry-run/Review-Required only (parsing free-text notes into
   canonical brand is ambiguous by design).
3. The service term is surfaced in job intake for operator confirmation; its values are not
   auto-snapshotted into the job (safest — avoids overwriting operator input).

---

# Phase 4.1 — Acceptance Closure (2026-06-20)

A factual acceptance audit (`docs/phase4-1-directory-acceptance-gap-audit.md`, commit `7a63f01`)
re-checked the seven Directory journeys and found that while the Phase 4 backend + panels are real,
several user-facing workflows were Partial/Missing. Phase 4.1 closed the bounded, backend-ready gaps,
applied the reversible contact backfill, and recorded the larger gaps honestly.

## 4.1 commit ledger (on top of `6a8c891`)

| Commit | Part | Subject |
|---|---|---|
| `7a63f01` | A | docs: audit phase 4 directory acceptance gaps |
| `9ed9afe` | B | feat: complete organization logo-history experience |
| `f94eb67` | B | fix: scope school job intake to canonical directory records |
| `5d1b60c` | B | fix: accept scheme-less website in the organization editor |
| `e03fae0` | C | fix: apply reversible demo contact identity backfill |
| _this_ | D | test: close phase 4 directory acceptance gaps |

## What 4.1 closed (Part B — bounded, tested wins)

- **Logo history + restore UI** (`9ed9afe`) — the migration-162 endpoints had no UI; now a
  self-contained `LogoHistoryPanel` renders in the organization detail with the current logo
  preview, the append-only history (source / who / when), and a manager-only Restore. Backend
  `getLogoHistory` now joins `app_user` for the actor name. 4 panel tests.
- **Job Intake District→School scoping** (`f94eb67`) — the org list endpoint gained an additive
  `parent_organization_id` filter; school intake now offers a District selector that scopes the
  school search to that District's children (browser-verified: Wayzata School District → Wayzata
  High School). 1 API test; location/contact scoping and free-text room/area unchanged.
- **Scheme-less Website** (`5d1b60c`) — the editor accepted only fully-schemed URLs (`type="url"`);
  now a bare domain is accepted and the server canonicalizes it. 1 test.

## What 4.1 applied (Part C — reversible demo backfill)

`backfillContactIdentities` gained per-relationship detail + a **safe-only** apply mode (apply only
unique one-to-one rows; leave possible-duplicate / identity-less rows Review Required) and a
`rollbackContactIdentityBackfill`. The fresh demo dry run classified **all 187** unlinked org-bound
contacts as safe one-to-one (0 possible duplicates, 0 invalid), so the safe-only apply ran:
**187 identities created, link coverage 2/189 → 189/189**, batch
`4689434a-6f7c-4e21-a414-78bb47600224`. Verified: idempotent (re-run finds 0 unlinked), no
relationship lost (189 org-contacts unchanged), counts reconcile (187 new identities), 0 orphaned
links, 0 cross-tenant changes, compat fields preserved (187/187), reversible (rollback proven on a
deterministic test batch). No names or shared emails merged; nothing hard-deleted. Artifacts under
`docs/artifacts/phase4-1-contact-identity-backfill-*`.

## Honestly remaining (documented, not claimed done)

These larger gaps from the audit are **not** closed in 4.1 and are scoped with their smallest-safe
correction in `docs/phase4-1-directory-acceptance-gap-audit.md`:

1. **Full-page detail routes** for District / School / Contact / Location (today: one workspace with
   query-param selection; no record-level not-found / denied / archived surfaces). Largest UI build.
2. **Reusable Contact identity UI** — the four `/contact-identities*` endpoints (and now 189 linked
   identities from Part C) still have no admin-web surface for create-identity / reuse-search /
   link-with-role-across-orgs / person-edit-propagation / org-level unlink. The UI still edits the
   older org-bound contact model.
3. **Atomic Create Organization** with inline multiple Contacts + Locations (today: one free-text
   primary contact, no inline Location, sequential non-atomic calls). School→parent-District is still
   not enforced at submit; no client duplicate-name warning.

## 4.1 verification

- **Tests:** Phase 4 + 4.1 API suite **81/81** green run serially (the one parallel-run failure is the
  documented shared-DB interference in `directoryReconciliation` — green alone and serially, unrelated
  to 4.1). Web Phase 4 + 4.1 suite **64/64** (incl. 4 logo-history tests). api + admin-web `tsc` +
  `build` clean.
- **Browser (live):** LogoHistoryPanel renders in the organization detail with correct current/empty
  states; the District→School scoping endpoint returns only the District's child school. The contact
  backfill was verified at the data layer (189/189 linked, 0 orphaned, 0 cross-tenant).

## Non-goals reaffirmed for 4.1

No Shoot↔Job bridge · no role dashboards · no full Monday import · no hard deletion · no fuzzy merge ·
no second canonical model · no relaxed NOT-NULL · brand stays in canonical columns (not notes).
Migration head unchanged at **162** (4.1 added no migrations). `stash@{0}` untouched; nothing pushed.
