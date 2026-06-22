# Phase 4.2 — Canonical Directory Product Acceptance Closure Report

**Date:** 2026-06-21
**Branch:** `feature/work-spine-foundation-v1`
**Migration head:** 163 (this bundle adds migration 163; the dated-commitment snapshot)

Phase 4.2 closes the canonical Directory product across three prior acceptance bundles plus this
one: reusable Contact identity (`c8c6e42`), atomic Organization creation (`eaf3e3c`), and this
Schools Job Intake cascade + Directory URL-state + dated-commitment closure.

---

## 1. Commit ledger (this closure, on top of `eaf3e3c`)

| Commit | Summary |
|--------|---------|
| `2c8e8f3` | Intake room/area distinction + honest missing-Location/Contact states |
| `90d3c80` | Historical Job-truth foundation test (committed identity + relationship ids immutable across edits) |
| `c3f8a49` | Directory Organization/legacy roots select Organizations mode without an explicit `view=` |
| `e56e269` | Migration 163 + initial dated-commitment snapshot at publish |
| `5d569d6` | Lock the dated-commitment contract to an explicit **versioned** structure |
| _(this report)_ | `test: close canonical directory product acceptance` |

Diff vs `eaf3e3c` is Directory/Intake-only: migration 163, `QuickCreateJobDrawer`, `Organizations`
(URL parser), `centralJobIntake` (publish snapshot), and tests. **No mileage / payroll / unrelated
Jobs code touched.**

---

## 2. Complete Schools Job Intake cascade

District → School → Location → Contact → Service-Term, all by canonical id:

1. **District** selected by canonical Organization id (`listCanonicalDistricts` → `GET /api/organizations/districts`).
2. **School list scoped to the District** — `listOrganizations({ parentOrganizationId })` (proven: `jobIntakeQuickCreate` "scopes the school search to the selected District").
3. **School** selected by canonical Organization id; its detail loads locations + contacts.
4. **Approved Locations scoped to the School** (`organizationDetail.locations`), shown with name + address.
5. **School contextual Contacts scoped to the School** (`organizationDetail.contacts`), with title.
6. **Service-term context** displayed read-only (`JobIntakeCanonicalContext`: period label, type, confirmation state).
7. **Room/area** stored as dated free text, never a `shoot_location` (see §4).

Stored on the Job (canonical FKs): `organization_id`, `location_id`, `primary_contact_id`
(= the `organization_contact` relationship id; the canonical identity is reachable via
`organization_contact.contact_id`). The relationship id preserves *why* the contact was selected.

Non-School flows (Sports/Event/Graduation/Specialty) are untouched — the District cascade renders
only for the schools department (`jobIntakeQuickCreate` sports tests remain green).

---

## 3. Historical Job-truth — the live-reference vs dated-snapshot contract

**A canonical FK preserves record identity but a live join shows current details.** Phase 4.2
defines an explicit split:

### Live canonical references (show current truth when viewed today)
`organization_id`, `location_id`, `primary_contact_id` and their live-joined display
(organization display name, contact profile, location profile). Editing a person's name/role
updates these everywhere — the Job shows the *same committed record's current* truth. Proven by the
`(JOB-TRUTH)` test: a person rename + role change leave the org_contact id and its contact_id
unchanged (the commitment target is immutable; the display follows canonical truth).

### Dated commitment snapshot (frozen at confirmation)
Migration 163 adds **`shoot.dated_commitment jsonb`**, populated at publish and **never
auto-updated**. It is an explicit **versioned** structure (`schema_version: 1`):

```
{ schema_version: 1, captured_at, captured_by_user_id,
  organization: { organization_id, organization_name, parent_district_id, parent_district_name },
  contact:      { contact_identity_id, organization_contact_id, organization_id, contact_name,
                  contextual_role_code, contextual_role_label, title, responsibilities,
                  phone, email, preferred_contact_method },
  location:     { location_id, location_name, address, room_area },
  service_term: { service_term_id, period_type, period_label, status_at_capture,
                  selected_service_values, confirmation_state } }
```

The shoot row *already* snapshots `location_name` + `location_address` + the schedule + room/area
(`special_instructions`); this column adds the dated values the canonical model lets change later
(contextual role, contact phone/preferred, service-term id/values).

**Tested** (`centralJobIntake` "captures a dated-commitment snapshot at publish that stays stable"):
publish captures the versioned shape (schema_version 1, org/contact/location/term); a later
canonical person edit (name + phone) changes the **live** org_contact but the dated snapshot's
`contact.contact_name`, `contact.contextual_role_label`, and `contact.phone` are **unchanged**.
Controlled fixture, cleaned up (0 orphans).

---

## 4. Location / room distinction

Locations are Organization-owned (`shoot_location.organization_id`). The Intake distinguishes the
**approved physical Location** (`location_id`, selected from the School's canonical locations) from
the **room/area within it** (gym, auditorium, cafeteria, loading dock). Room/area is dated free text
(the unresolved placeholder / `special_instructions`) and **never creates a `shoot_location`**. The
Location field's helper makes this explicit ("…note it in the placeholder below or special
instructions; it never creates a new canonical Location"). Verified by `jobIntakeQuickCreate`
"shows honest missing-Location and missing-Contact states + the room/area distinction".

---

## 5. Service-term behavior

The current term is displayed read-only at intake (label, type, confirmation state). The Job does
**not** copy the full term; the dated snapshot captures only `service_term_id`, period type/label,
`status_at_capture`, `selected_service_values`, and `confirmation_state` (§3). Later term changes do
not rewrite the snapshot.

---

## 6. Missing-state corrective actions

When the selected School has no approved Locations or no Contacts, the Intake shows a **specific,
actionable** message (e.g. "This organization has no approved Locations yet. Open it in Directory to
add or link a canonical Location — your intake entries here are preserved…") — never a generic
"Failed to fetch", and Intake form state is preserved. Verified by `jobIntakeQuickCreate`.

---

## 7. Directory URL-state contract

The URL is authoritative for mode + selected record + search + filters (`parseOrganizationsHash`):

- **Direct routes select the correct mode without a redundant `view=`** — fixed this bundle:
  organization/accounts roots → Organizations; contact roots → Contacts; location roots → Locations
  (`directoryUrlState` "a direct organization hash selects Organizations mode").
- search / account-type / status / role / selected record hydrate from the hash; defaults applied
  when absent.
- **Legacy roots** (`accounts`, `contacts`, `locations`, `directory/internal`) parse compatibly.
- **No sensitive data** in URLs — only ids, filter tokens, and the operator's search term
  (`directoryUrlState` "carries only non-sensitive identifiers/filters").
- Full-page routes (`directoryRecordRoutes`): stale id → **Not Found**, unauthorized → **Denied**,
  archived → **read-only banner (still readable)**, context-preserving **Back** (sessionStorage
  return-hash), refresh + Back/Forward re-hydrate from the hash.

**Not Applicable:** the Directory list surfaces use a single workspace per mode; there is no
multi-tab detail or server pagination on the canonical list beyond the Contacts-mode pager — marked
N/A where no such UI exists, per the directive.

---

## 8. Permissions

Server-enforced throughout: directory reads = any authed; manage = `requireCanonicalDirectory*`
guards; intake = `"shoot.create"`. Read-only users cannot create (403); cross-tenant ids rejected;
RLS scopes every read/write to `app.current_tenant_id()`. (Proven across `directoryPermissionsMatrix`,
`canonicalContacts`, `organizationAtomicCreate` RBAC + tenant tests.)

---

## 9. Browser verification

The preview app (port 5174, live API) was driven this session:
- Auth works; the canonical Directory + atomic Create Organization journeys were fully driven live
  in the prior bundles (one atomic request, role isolation, cleanup — see the atomic closure report).
- The **Schools Job Intake surface renders live** at `#schools/jobs/new`: canonical organization
  search, Location field, and the canonical context panel are present and the app runs.
- The detailed cascade interactions (District→School scoping firing the parent-scoped request,
  location/contact scoping, the room/area helper, honest missing states) are verified by the 14
  `jobIntakeQuickCreate` component tests, which render the **actual** `QuickCreateJobDrawer` in a
  real DOM and assert each behavior deterministically.
- The dated-commitment snapshot is a backend `jsonb` proven by the controlled publish→edit→stability
  API test (not meaningfully observable in the browser).

**Honest limitation:** a single end-to-end *live* publish-then-edit journey through the SchoolsHub
launcher was not separately driven in the browser this bundle; the equivalent behavior is covered by
the component tests (real-DOM cascade) + the controlled API publish/snapshot/stability test. A
pre-existing, unrelated duplicate-React-key warning ("Trade Replacement Photographer") appears on the
Schools dashboard photographer-trade list — outside Phase 4.2 scope and not introduced here.

---

## 10. Fixture cleanup

The dated-commitment API test creates a controlled contact + org_contact + relationship + published
Job and deletes all of them in a `finally` block. Final sweep: **0** `dated-…@commit.example.com`
contacts, **0** `Browser Atomic %` orgs. No uncontrolled demo records mutated.

---

## 11. Tests

| Suite | Result | Coverage |
|---|---|---|
| `jobIntakeQuickCreate` (web) | 14 | District→School cascade, location/contact scoping, room/area distinction, honest missing states, sports regression, publish |
| `jobIntakeCanonicalContext` (web) | 4 | hierarchy + service-term context display |
| `centralJobIntake` (api) | 35 | full intake + **dated-commitment versioned snapshot + stability** |
| `canonicalContacts` (api) | 23 | identity/relationship CRUD + **(JOB-TRUTH) committed-id immutability** |
| `directoryUrlState` (web) | 9 | mode/search/filter hydration, **direct org root**, legacy roots, no-sensitive-data |
| `directoryRecordRoutes` (web) | 8 | direct routes, not-found / denied / archived, context Back |
| Full admin-web (serial) | **566 / 566** | |
| API directory/intake suites (serial) | **148 / 148** (8 files) | intake, contacts, atomic, permissions, hierarchy, brand, service-term, directory |
| api + admin-web `tsc` + builds | clean | |
| Lint | no ESLint configured; `tsc --noEmit` is the static gate (clean) | |

---

## 12. Known baseline failures (reported separately, NOT modified)

Diff vs `eaf3e3c` has **zero** mileage/payroll/migration-unrelated changes, so these run identical
to baseline:
- `timeClockMileagePhase5.test.ts` — **3 failed / 1 passed** (documented mileage baseline).
- `jobsCanonicalIndex.test.ts` — pre-existing seed/env failures in jobs code this bundle never touched.

---

## 13. Remaining limitations

- **District-level contact picker**: the Intake surfaces the School's contacts; an explicit
  District-contact sub-picker (with the District role list) is contextual today via the canonical
  Contact relationships — a richer dedicated picker is a future enhancement.
- **Locations are Organization-owned**: reuse copies the canonical address (no shared-Location
  table); documented in the atomic closure report.
- **dated_commitment API exposure**: the snapshot is stored + tested at the DB layer; surfacing it on
  the Job detail read/UI is a small follow-up (the contract + capture are complete).
- **Live publish browser journey**: covered by component + API tests rather than a single scripted
  live publish (see §9).

---

_End of report._
