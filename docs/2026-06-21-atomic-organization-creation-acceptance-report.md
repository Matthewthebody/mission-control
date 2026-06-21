# Atomic Organization Creation — Acceptance Closure Report

**Date:** 2026-06-21
**Branch:** `feature/work-spine-foundation-v1`
**Baseline:** `c8c6e42` (clean HEAD at start — the closed Reusable Contact Identity bundle)
**Migration head:** 162 (no new migrations — this bundle adds zero schema)

This bundle closes **Atomic Organization Creation**: one Create Organization submission that creates,
in a single database transaction, a District or School + canonical parent relationship + multiple
Contact relationships (existing identities or inline) + multiple Location relationships + brand +
logo reference + an optional initial service term. A failure at any stage leaves no partial records.

---

## 1. Commit ledger (on top of `c8c6e42`)

| Commit | Summary |
|--------|---------|
| `2e45d12` | feat: extend atomic create service/schema (rich contacts, location reuse, primary, rollback proofs) + 16 API tests |
| `745294c` | feat: multi-contact + multi-location Create Organization form on the atomic endpoint (+ CanonicalLocationSelector, deferred inline create) |
| `163f921` | feat: offer initial service term for District (schools) accounts + preview launch config |
| `44a3f3c` | test: districts with a schools account type offer an initial term |
| _(this report)_ | `test: close atomic organization creation acceptance` |

Full change set is bundle-only — **no jobs / mileage / migration / unrelated files** touched
(`git diff c8c6e42 --name-only`): the atomic service + route, the web form + two selectors +
api wrapper, and tests.

---

## 2. Final API contract

`POST /api/organizations/atomic` (manage-gated). One JSON payload:

```jsonc
{
  "organization": { canonical_name, display_name?, account_type, client_entity_kind?,
                    parent_organization_id?, website?, main_phone?, active_status?, aliases?, notes? },
  "contacts": [ { existing_contact_id? | (first_name,last_name,full_name,email,phone),
                  client_roles?, relationship_role?, is_primary?, title?, notes? } ],
  "locations": [ { existing_location_id? | (location_name, address_line_1, address_line_2?,
                   city, state, zip), notes?, is_primary? } ],
  "brand": { brand_primary_color?, brand_secondary_color?, mascot?, brand_status?, website?,
             logo_url?, logo_status?, logo_note?, logo_source? },
  "initial_service_term": { period_type?, period_label, start_date?, end_date? }
}
```

Result: `{ organization_id, created_contact_ids[], linked_contact_ids[], created_location_count, primary_location_id }`.

---

## 3. Transaction boundary

`createOrganizationAtomic` runs entirely inside the route's single `withClientTransaction`. Order:
**organization → brand (+ logo-history) → optional term → contacts (link + contextual title/notes)
→ locations (reuse/inline + primary) → set organization.primary_location_id.** Every step uses the
same `client`; any thrown `ApiError` rolls the whole transaction back. There is **no** chain of
independent post-create HTTP calls — the browser issues exactly one request (proven in §9).

---

## 4. Contact behavior

- **Existing** canonical identities are linked by `existing_contact_id` (no fuzzy match, no merge).
- **Inline** identities are created **inside the transaction** via `createCanonicalContact`, then
  linked — so a later failure rolls them back. The shared `CanonicalContactSelector` gained a
  deferred `onCreateDraft` mode for exactly this: in the atomic form the inline "Create & use"
  returns the validated draft instead of persisting immediately (no orphan identity on rollback).
- Per-organization **contextual fields** (`title`, `notes`, `client_roles`, `is_primary`) are set on
  the org-bound row / relationship — never on the shared person. Multiple roles, a primary
  designation, and distinct roles per organization are all supported and tested.
- The same identity linked to a District and a School holds **independent** roles (proven in §9).

---

## 5. Location behavior — model honesty

`shoot_location` is **Organization-owned** (`shoot_location.organization_id`); there is **no** shared
canonical-location + relationship table. This report does **not** claim Locations are reusable
across Organizations. Accordingly:

- **Inline** locations are created under the new Organization (room/access notes →
  `location_details`; exact normalized name+address duplicate within the org → **409**, whole create
  rolls back).
- **Existing-location "reuse"** (`existing_location_id`) **copies the selected Location's canonical
  address into a new Organization-owned row** — it never re-parents or silently reassigns another
  Organization's Location. A cross-tenant `existing_location_id` is rejected (400).
- The shared `CanonicalLocationSelector` searches existing Locations and, on an **exact
  normalized-address match**, warns and offers the existing Location instead of a duplicate.
- **Room/access phrases stay in notes.** "gym", "auditorium", etc. are entered as the location's
  notes — they never create a separate Location. Verified in the browser (§9): one Location carried
  "Use the east gym and auditorium entrance" as its `location_details`.
- A location may be marked **primary** → sets `organization.primary_location_id`.

**Limitation (documented, not invented):** because Locations are Organization-owned, "reuse"
duplicates the canonical address into the new Org rather than sharing one canonical Location row. A
true shared-Location model would need a separate canonical-location + org↔location relationship
table (out of scope here).

---

## 6. Brand / logo / resource honesty

- Brand fields (colors, mascot, `brand_status` ∈ known|unknown|not_available|not_applicable) and the
  **logo reference** persist to canonical columns via `updateOrganizationBrand`, inside the
  transaction; a logo-URL change also writes an `organization_logo_history` row (proven by test
  `(21/22)` and in the browser).
- **This flow stores a logo URL / resource reference — it does not upload a file inside the database
  transaction.** File upload is a separate step (`uploadOrganizationLogoFile`) performed *before*
  submission that returns a URL; the atomic create then references that URL. We therefore claim
  **reference atomicity** (the URL + history write roll back with the transaction) and **do not**
  claim upload atomicity. No local filesystem paths are exposed; the URL is only treated as saved
  after the transaction commits.

---

## 7. Hierarchy rules (server-enforced)

`createOrganization` + `validateOrganizationParent` reject: a School with no District (400), a
cross-tenant District (400, "not found in this tenant"), a non-District parent (400), a District
with a parent (400), self-parent and cycles (400, on the update path). Exact organization
name/alias duplicates → 409. All inside the atomic transaction (tests `(2)`–`(5)`, `(17)`, dup).

---

## 8. Rollback proofs

Forced failures, each proving **zero** orphan org / contact / identity / relationship / location /
term / logo-history:

| Stage forced to fail | Test | Result |
|---|---|---|
| after organization insert (invalid later contact) | `(25)` | no organization persisted |
| after contact / brand / term / first location (duplicate-address last location → 409) | `(26/27/28/29/30/31)` | counts unchanged; no org/contact/location/term; logo-history count unchanged |
| duplicate organization name | dup test | 409; no location persisted |
| exact-address duplicate locations | `(17)` | 409; no org, no location |
| unsafe website protocol | `(20)` | 400; no organization |

**Resource finalization:** since the logo is a URL reference (not an in-transaction upload, §6),
its write lives in the same transaction and rolls back with everything else — there is no separate
stage→commit→finalize file step to clean up in this flow.

---

## 9. Browser scenario (proven live, port 5174 against the running API)

Driven through the real Create Organization UI; verified in Postgres:

1. Opened Create Organization (leadership session; the rail's "New organization" renders only for
   directory managers — read-only users never see it).
2–5. Built a **District**: Entity Kind = District, Website `browseratomic.example.org` (no scheme),
   Main Phone, mascot **Falcons**, logo URL + status **Current**, an initial **2026-2027** draft term.
6. Added an **existing** Contact (Andre Cole → `district_contact`, primary) and an **inline** Contact
   (Briar Quinn → `billing_contact`); added two Locations (Falcon Field House with "east gym /
   auditorium" notes + primary, Falcon Annex).
7. Submitted once → **Network showed exactly one `POST /api/organizations/atomic`** and no chained
   post-create mutations.
8. DB verified: website normalized to `https://browseratomic.example.org`; brand_status `known`;
   `primary_location_id` set; Andre `{district_contact}` primary, Briar `{billing_contact}`; two
   locations with the room phrases in `location_details`; the term created.
9. Created a **School under that District**, reusing **Andre** as `picture_day_contact`. DB verified
   role isolation: Andre = `{district_contact}` at the District and `{picture_day_contact}` at the
   School, from **one** canonical identity (no duplicate). One atomic POST again.
10. A premature submit before selecting the parent surfaced a **field-specific** error
    ("A School requires a canonical parent District.") with **all form state preserved** (name +
    contact rows intact) — not collapsed into "Failed to fetch".
11. **Read-only** user → `POST /atomic` **403**; **cross-tenant** parent District → **400**
    (server-enforced).
12. Cleaned every fixture; proved **zero** orphan organizations / contacts / relationships /
    locations / terms; the **demo identity (Andre) was preserved** (only its fixture relationships
    removed); the inline identity (Briar) deleted; no orphan relationships remain.

---

## 10. Permissions

Server-enforced manage gate (`requireCanonicalDirectoryManageAccess`): owner/leadership/manager
create (201); read-only photographer → **403** (test + live). Inline Contact/Location creation runs
under the same transaction + permissions. Cross-tenant Contact (`existing_contact_id`), District
(`parent_organization_id`), and Location (`existing_location_id`) ids are rejected (400). RLS scopes
every read/write to `app.current_tenant_id()`.

---

## 11. Tests

| Suite | Count | Notes |
|---|---:|---|
| `packages/api/tests/organizationAtomicCreate.test.ts` | 22 | District/School atomic, hierarchy rejections, multi existing+inline contacts (distinct roles, title/notes, primary), existing+inline locations + primary, address-dup rollback, website normalization + unsafe-protocol, brand states + logo history, term + overlap, **rollback proofs**, cross-tenant contact/location, single-endpoint shape, **consolidated JOURNEY** (District→School reuse, role isolation) |
| `packages/admin-web/src/test/createOrganizationAtomicForm.test.tsx` | 7 | sections render, existing + inline + one-atomic-payload, deferred inline (no immediate persistence), remove-row form-state preservation, location selector search/exact-address warning, District term offer |
| `packages/admin-web/src/test/organizationsPage.test.tsx` | 33 | Create form regression incl. District-term behavior |

The ≥38 enumerated behaviors are covered across these suites + the live browser scenario (§9):
atomic District/School; School-without-District; cross-tenant District; invalid parent type;
duplicate warning; multiple existing + inline contacts; multiple roles; primary/secondary;
already-linked/duplicate awareness (selector); multiple existing + inline locations; primary
location; exact normalized-address warning; room-note-no-location; website normalization; unsafe
protocol denied; brand states; logo integration/history; optional term; term overlap; rollback after
org/contact/brand/term/location; no orphans; field-level error mapping; form-state preservation;
RBAC; tenant isolation; keyboard/focus (native controls); one atomic endpoint from the browser.

---

## 12. Verification gates

| Gate | Result |
|---|---|
| Full admin-web suite (serial) | **562 / 562 passed** (101 files) |
| API — `organizationAtomicCreate` | **22 / 22** |
| API — directory/atomic suites serial (atomic, canonicalContacts, permissionsMatrix, organizationsDirectory, hierarchy, brand, schoolServiceTerm, contactImport, reconciliation) | **116 / 116** (9 files) |
| TypeScript — api + admin-web `tsc --noEmit` | clean |
| Build — api (`tsc -p`) + admin-web (`vite build`) | clean |
| Lint | no ESLint configured in this repo; `tsc --noEmit` is the static gate (clean both packages) |
| Browser scenario (live, port 5174) | full 12-step journey, 0 orphans (§9) |

---

## 13. Pre-existing baselines reported separately (NOT touched)

My diff vs `c8c6e42` contains **zero** jobs / mileage / migration changes, so these run identical
code to baseline:

- **`timeClockMileagePhase5.test.ts` — 3 failed / 1 passed** (documented mileage baseline). Untouched.
- **`jobsCanonicalIndex.test.ts` — 7 failed / 19 passed**, data/seed preconditions on the shared dev
  DB in jobs code this bundle never touched. Pre-existing / environmental.

---

## 14. Known limitations

- **Locations are Organization-owned** (`shoot_location.organization_id`); "reuse" copies the
  canonical address into the new Org rather than sharing one canonical Location row (§5). A shared
  canonical-Location model would need a new relationship table — out of scope.
- **Logo is a URL/resource reference**, not an upload inside the DB transaction (§6); reference
  atomicity is guaranteed, upload atomicity is not claimed.
- The **Parent District** selector requires an explicit pick; submitting before selecting yields a
  clear field-level error with preserved form state (this is the recoverable-error path, §9.10).
- The legacy single "Primary Contact" free-text section is retained alongside the canonical Contacts
  repeater for backward compatibility; both feed the one atomic payload.

---

_End of report._
