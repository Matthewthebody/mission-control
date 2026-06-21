# Phase 4.1 — Canonical Directory Acceptance Gap Audit

**Date:** 2026-06-20 · **Branch:** `feature/work-spine-foundation-v1` · from HEAD `6a8c891`
**Scope:** factual acceptance audit of the seven canonical Directory user journeys against the
Phase 4 implementation. Read-only inspection; no code changed for this document.

**Headline:** Phase 4 delivered a correct canonical **backend** (migrations 160–162, services,
routes, RLS, permission matrix) plus several admin-web **panels** (ServiceTermsPanel,
ParentDistrictSelector, OrganizationHierarchyCard, JobIntakeCanonicalContext). But a number of
**user-facing journeys are Partial or Missing** — most importantly: there are **no full-page
detail routes**, the **reusable canonical Contact identity layer has zero UI wiring** (it is
entirely API-only), Create Organization is a **non-atomic single-primary-contact** flow with no
inline Location, and Job Intake has **no District→School cascade**. The Phase 4 completion report's
browser pass proved the panels *render*; it did not prove these workflows. This audit records the
truth per requirement and the smallest safe correction.

Status legend: **Complete+proven** · **Complete (test-only)** · **Partial** · **Missing** ·
**Deferred** (intentional).

---

## 1. Directory navigation (modes + URL state)

| Requirement | Status | Evidence |
|---|---|---|
| Organizations / Contacts / Locations as first-class modes | **Complete (test-only)** | One workspace, three query-param modes. Routes `#accounts`, `#directory/contacts`, `#directory/internal`, `#directory/locations` all render the same `Organizations` page with a different `entryView` (`navigation.ts:1066-1129`, `app.tsx:1309-1320`). Mode switch = `pushRoute({ view })` (`Organizations.tsx:778`). |
| URL preserves mode | **Complete** | `view` always written to the hash (`Organizations.tsx:564`), parsed by `parseOrganizationsHash` (`:1147-1182`). |
| URL preserves selected record | **Complete** | `?organization=/?contact=/?location=` written (`:566-568`), re-hydrated on `hashchange` (`:206-214`). |
| URL preserves active section/tab | **Complete** | `tab` written + parsed (`:565`, `:1168-1180`). |
| URL preserves **search** | **Missing** | `search` is `useState` only (`:158`), never serialized — resets on refresh / Back-Forward. |
| URL preserves **filters** | **Missing** | `accountType`, `activeStatus`, `contactStatus`, `roleCategory`, owner, audience toggle, etc. are all `useState` (`:159-173`), never in the URL. |
| Refresh + Back/Forward stable | **Partial** | View + selection + tab survive; search + filters reset. |

**Smallest safe correction:** serialize `search` + the active filter set into the hash query
string in `pushRoute`/`parseOrganizationsHash` (additive keys, ignored when absent). **Tests:**
extend `organizationsPage.test.tsx` to assert search/filter round-trip through the hash.

## 2. Full-page detail routes (District / School / Contact / Location)

| Requirement | Status | Evidence |
|---|---|---|
| Stable full-page route per District / School / Contact / Location | **Missing** | `ShellRouteRender` has no directory `*-detail` kind — only `{ kind: "directory" }` (`navigation.ts:72-126`). Records are addressed by query param on the shared workspace hash; jobs/tasks/sports *do* have real detail routes (`navigation.ts:80,82,111`), the Directory does not. Detail renders as inline panels/tabs in `DirectoryWorkspace` (`:237-1088`). |
| Direct stable link | **Partial** | `#directory/contacts?contact=<id>&tab=…` deep-links *into the workspace* (selects the record), not a dedicated page. |
| Back to Directory preserving context | **Partial** | Workspace selection is URL-backed, but there is no page→list "Back" affordance because there is no page. |
| Loading state | **Complete** | Suspense fallback (`app.tsx:1310-1319`) + workspace "Loading this Directory profile…" (`DirectoryWorkspace.tsx:206-208`). |
| Not-found state | **Missing** | No record-level 404 surface; an unresolved id yields a generic "We couldn't load this organization right now." (`Organizations.tsx:374-379`). Grep for `not.?found`/`404` in `components/directory` → none. |
| Denied state | **Missing** | RBAC denial **silently redirects** to a fallback route (`app.tsx:320-321,537-559`); no denied surface. Within the workspace, RBAC only hides management affordances via `canManage`. |
| Archived / read-only state | **Missing** | No locked read-only mode; archived rows are merely filtered by the `activeStatus` filter and shown with a status pill; edit buttons still render when `canManage`. |

**Smallest safe correction:** add deep-linkable full-page detail **view kinds** that reuse the
existing detail panels (a thin routed wrapper over the same `getOrganizationDetail` /
`getDirectoryContactDetail` reads) with explicit loading / not-found / denied / archived-read-only
states, and a "Back to Directory" that restores the prior list hash. This is the single largest
gap. **Tests:** route render tests for each of the four full-page kinds incl. not-found + denied +
archived.

## 3. Reusable Contact workflow (canonical identity)

**The entire canonical `contact`-identity layer is API-only with zero admin-web wiring.** A repo-wide
grep of `packages/admin-web/src` for `contact-identities` / `createCanonicalContact` /
`/relationships` / `/backfill` returns no matches; none of the four Phase-4 endpoints has a function
in `organizationApi.ts`. The UI's "Link existing contact" uses the **older** `POST /:id/contact-links`
(`attachContactToOrganization`, org-bound `organization_contact` + OCR), not the canonical identity.

| Requirement | Status | Evidence |
|---|---|---|
| Create canonical Contact from UI | **Missing** | `createCanonicalContact` route `organizations.ts:1478` has no UI caller; "New contact" creates an org-bound `organization_contact` via `POST /:id/contacts`. |
| Search/select existing canonical Contact (reuse) | **Missing** | `OrganizationContactLinkForm` (`DirectoryActionForms.tsx:960-1032`) is a `<select>` over org-bound directory contacts → `attachContactToOrganizationRecord`; not a search over the canonical `contact` registry, does not call `linkContactToOrganization`. |
| Link same Contact to District + School with distinct roles | **Missing (API-only)** | Exactly what `POST /contact-identities/:id/links` does; no UI invokes it. |
| Edit person once → reflects in both orgs | **Missing** | UI edits a single `organization_contact` via `PATCH /organizations/contacts/:id`; the shared `contact` identity has no UI editor. |
| Edit one relationship role in isolation | **Partial** | Per-org `relationship_role` is editable (`DirectoryActionForms.tsx:1003-1015`), but only on independently-created org contacts — the multi-org identity scenario can't be set up in the UI. |
| Unlink one relationship (keep Contact + other links) | **Missing** | No org-level unlink affordance (only archive status-flip); detach exists only for **locations** (`DirectoryWorkspace.tsx:927-930`). |
| View a Contact's full cross-org relationships | **Partial** | `DirectoryRelationshipHistory` shows current/previous orgs, but it is keyed by the per-org `organization_contact` id, **not** the canonical identity rollup (`getContactRelationships` is API-only). |

**Smallest safe correction:** add `organizationApi` wrappers for the four `/contact-identities*`
endpoints; add a "Use existing person" search + "link to this organization with role" path in the
contact drawer (calling `createCanonicalContact` / `linkContactToOrganization`); add a contact
relationships view backed by `GET /contact-identities/:id/relationships`; add org-level unlink.
**Tests:** UI tests for create-identity, reuse-across-two-orgs-with-distinct-roles, person-edit
propagation, isolated relationship edit, unlink-keeps-identity.

## 4. Create Organization

| Requirement | Status | Evidence |
|---|---|---|
| Account Type first | **Complete** | `account_type` select required (`DirectoryActionForms.tsx:247-256`). |
| School requires canonical parent District | **Missing (optional only)** | `parent_organization_id` set only if chosen; no School→District enforcement; submit gated only on `canonical_name` (`:454`). |
| Searchable District selection | **Complete+proven** | `ParentDistrictSelector` over `/districts` (browser-verified in Phase 4). |
| Exact duplicate-name warning | **Missing** | No client dup check; only whatever the backend POST returns. |
| Select existing reusable Contact | **Missing** | Primary-contact fieldset is free text; no picker. |
| Inline new Contact creation | **Partial** | Exactly one primary contact, applied post-create via `createOrganizationContactRecord`; dropped if no name. |
| Multiple Contacts | **Missing** | Single primary-contact field set only. |
| Contextual role/responsibilities per contact | **Partial** | Free-text title only; `role_category` hard-coded `"other"` on create (`Organizations.tsx:953`). |
| Select existing Location | **Missing** | No location picker in create. |
| Inline canonical Location creation | **Missing** | Location creation requires the org to already exist (`Organizations.tsx:976` guard); create-org never calls `createOrganizationLocationRecord`. |
| Multiple Locations | **Missing** | n/a in create. |
| Room/area/access notes | **Missing** | No location section in create. |
| Website without scheme | **Partial** | Backend `normalizeWebsite` adds scheme on write, but the form passes raw and uses browser `type="url"` which **rejects** scheme-less input before submit — UX gap. |
| Canonical brand state | **Complete** | Brand draft → `PATCH /:id/brand` post-create. |
| Logo preview / history | **Missing** | Upload works but there is no `<img>` preview and no history in the form. |
| Optional initial service term | **Complete** | School-only first-term section → `POST /:id/service-terms`. |
| Field-level errors | **Partial** | Single error banner; inputs preserved on failure, but no per-field mapping. |
| Transaction safety | **Missing** | onSubmit runs **4 sequential independent** API calls (org → brand → term → contact, `Organizations.tsx:935-958`); a later failure leaves the org (and earlier sub-calls) persisted, and the created id is not retained → retry duplicates the org. |

**Smallest safe correction:** (a) accept scheme-less Website in the form (drop `type="url"`,
normalize client-side to match the server); (b) enforce School→parent-District at submit; (c) add a
client duplicate-name pre-check via the existing list search; (d) retain the created org id so a
post-create sub-call failure resumes instead of duplicating; (e) optionally a backend composite
create endpoint for true atomicity (larger — Deferred unless required). **Tests:** website
normalization in-form, School-without-district rejected, dup-name warning, resume-after-partial.

## 5. Job Intake scoping

| Requirement | Status | Evidence |
|---|---|---|
| District selection | **Missing** | No District selector; only an org typeahead (`JobIntakeFields.tsx:301`). District is read-only context (`JobIntakeCanonicalContext.tsx:38-47`). |
| School list scoped to District | **Missing** | Org search is flat across all matching schools regardless of district. |
| Location list scoped to School | **Complete** | `locationOptions = organizationDetail?.locations` (`QuickCreateJobDrawer.tsx:104`). |
| Contact list scoped to District/School | **Complete** | `contactOptions = organizationDetail?.contacts` (`:105`). |
| Room/area open text (no Location created) | **Complete+proven** | `unresolved_location_name` free-text placeholder; no create-location path (`JobIntakeFields.tsx:523-533`). |
| Current service-term context | **Complete+proven** | `loadCurrentServiceTerm` → current term, read-only (`QuickCreateJobDrawer.tsx:307-322`). |
| Final flow uses canonical IDs | **Complete** | `organization_id`/`location_id`/`primary_contact_id` are canonical ids. |

**Smallest safe correction:** add an optional **District selector** to school intake that scopes the
organization (school) search to that District's children, keeping the flat org typeahead as a
fallback; surface contextual District contacts. **Tests:** District scopes the school list; School
scopes locations/contacts; room text creates no Location; Sports/non-school intake unchanged.

## 6. Brand / logo experience

| Requirement | Status | Evidence |
|---|---|---|
| Current logo + immediate preview | **Partial** | Upload + URL paste work; **no `<img>` preview**. |
| Logo source / actor / timestamp | **Missing (UI)** | Backend `organization_logo_history` records source + actor + `clock_timestamp()`; no UI surfaces it. |
| Logo status | **Complete** | Status enum select in the form. |
| Prior-logo history | **Missing (UI)** | `GET /:id/logo-history` exists (`organizations.ts:1425`); no UI caller. |
| Restore prior logo | **Missing (UI)** | `POST /:id/logo-restore` exists (`:1435`); no UI caller. |
| Authorization | **Complete** | Routes are manage-gated (permission matrix). |
| Safe URL handling / no FS path exposure | **Complete** | `normalizeWebsite` rejects unsafe protocols; uploads go through presign → object URL. |

**Smallest safe correction:** add a logo-history panel (list with source/actor/timestamp/preview +
Restore, manage-gated) backed by the existing endpoints; add an `<img>` preview in the editor.
**Tests:** history renders, restore calls the endpoint + refreshes, read-only for non-managers.

## 7. Service-term experience

| Requirement | Status | Evidence |
|---|---|---|
| Current / next / prior terms | **Complete+proven** | `ServiceTermsPanel` groups current/drafts/closed (browser-verified). |
| Rollover | **Complete (test-only)** | Roll-over → unconfirmed draft. |
| Inherited markers | **Complete (test-only)** | Inherited field keys + "Needs review". |
| Confirmation required | **Complete (test-only)** | Confirm action sets `confirmation_state`. |
| Confirm / change inherited value | **Partial** | Confirm exists; "change dates/notes" exists; per-field inherited-value editing is coarse. |
| Prior term unchanged by rollover | **Complete (test-only)** | Backend copies into a new draft; source untouched. |

**Smallest safe correction:** none required for acceptance (the panel is the proven Phase 4
deliverable); optionally a browser pass on rollover/confirm to upgrade test-only → proven.

---

## 8. Prioritized gap closure plan (feeds Part B)

Ordered by value × safety × boundedness:

1. **Logo-history + restore UI** (§6) — backend ready, bounded, high value. → `feat: complete organization logo-history experience`.
2. **Job Intake District→School scoping** (§5) — bounded, real cascade. → `fix: scope school job intake to canonical directory records`.
3. **Reusable Contact identity UI** (§3) — wire the four endpoints: create identity, reuse search, link-with-role across orgs, relationships view, org-level unlink. Largest *workflow* gap. → `feat: complete canonical organization relationship creation` (contact portion).
4. **Create Organization hardening** (§4) — website-in-form normalization, School→District enforcement, dup-name warning, created-id retention (resume-not-duplicate). → folded into the relationship-creation commit or its own.
5. **Full-page detail routes + URL search/filter persistence** (§1–2) — largest UI build (4 entity pages + not-found/denied/archived). → `feat: complete canonical directory full-detail routes`.

Items 1–2 are the cleanest wins; 3–4 are substantial but backend-ready; 5 is the biggest. Each is a
bounded commit with focused tests; anything that cannot be completed to a proven bar in this pass is
recorded honestly in the Phase 4.1 closure section of the completion report rather than claimed done.

**Non-goals reaffirmed:** no Shoot↔Job bridge, no role dashboards, no hard delete, no fuzzy merge,
no second canonical model — every correction reuses the existing Phase 4 schema, services, and routes.
