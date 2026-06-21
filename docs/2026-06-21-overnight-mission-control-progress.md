# Overnight Mission Control Build — Progress Log (2026-06-21)

Branch `feature/work-spine-foundation-v1`. Autonomous overnight run continuing from HEAD
`0cc8384` (Phase 4.2 Part 1 full-page Directory routes). `stash@{0}` untouched; nothing pushed.
Migration head 162. Postgres + Redis up; API :4000 healthy.

Execution ladder: 4.2 Part 2 → 3 → 4 → 5 → 6 → 6A(views) → 6B(production) → hardening → final.

Each bounded commit is appended below: timestamp · hash · slice · files · behavior · data/migration ·
tests · browser · known limitation · next slice.

---

## Preflight (start)

- Branch `feature/work-spine-foundation-v1`, HEAD `0cc8384`, clean tree.
- Part 1 commits present (`4bed733`, `f791f04`, `0cc8384`). Stash intact. Migration head 162.
- Docker Postgres + Redis up (2 days); API :4000 → 200.
- Confirmed gap: the canonical contact-identity layer has a create/link/relationships/backfill API
  but **no list endpoint** and **no admin-web wrappers** — Part 2 starts there.

---

## Phase 4.2 Part 2 — Reusable Contact identity UI — DONE

- **Commit:** `5d7c2ce` `feat: add reusable contact identity experience`
- **Files:** api `canonicalContacts.ts` (+`listCanonicalContacts`), `routes/organizations.ts`
  (+`GET /contact-identities`), `canonicalContacts.test.ts`; web `types.ts`, `organizationApi.ts`
  (+4 wrappers), new `CanonicalContactSelector.tsx` + `CanonicalContactsPanel.tsx`,
  `DirectoryRecordDetailPage.tsx` (wire panel into org detail), `styles.css`,
  `canonicalContactExperience.test.tsx`, `directoryRecordRoutes.test.tsx` (mock).
- **Behavior:** first-class canonical contact list (search name/email/phone, linked-org count,
  role summary, pagination); one shared reusable selector (search identities, already-linked
  warning, inline create-and-use, never silently duplicates); panel expands a person to their
  full cross-org relationship rollup. Rendered on the Organization full-page detail.
- **Data/migration:** none (reuses migration 161 `contact` + the 189 backfilled identities).
- **Tests:** api `canonicalContacts` 9 (incl. 2 list); web `canonicalContactExperience` 5 +
  `directoryRecordRoutes` 6 green. admin-web `tsc` + `vite build` clean.
- **Browser:** not yet (batched into Part 6 closure scenario).
- **Known limitation:** the existing Contacts rail mode still renders org-bound rows; the
  canonical list + selector are the reusable foundation it migrates onto in a follow-up.
- **Next slice:** Phase 4.2 Part 3 (done below).

---

## Phase 4.2 Part 3 — Atomic canonical Create Organization — DONE

- **Commit:** `d136cae` `feat: make organization creation atomic and canonical`
- **Files:** api `organizationAtomicCreate.ts` (new), `organizations.ts` (export input types),
  `routes/organizations.ts` (`POST /atomic` + schema), `organizationAtomicCreate.test.ts`;
  web `organizationApi.ts` (+wrapper/types), `pages/Organizations.tsx` (create → atomic).
- **Behavior:** one transaction creates org + brand + first term + N contacts (existing
  identity by id or inline new) + N new locations; any failure rolls the whole thing back —
  no orphan org/contact/identity/relationship/location/brand/term. Create handler now makes
  one atomic call instead of 4 sequential ones.
- **Data/migration:** none.
- **Tests:** api `organizationAtomicCreate` 5 (success; forced-failure-no-orphans; duplicate
  no-partial; reuse-by-id; RBAC); web `organizationsPage` 33 unaffected. tsc + build clean.
- **Browser:** batched into Part 6 closure.
- **Known limitation:** the create FORM still collects one primary contact + no inline
  locations; the atomic endpoint accepts arrays, so the multi-contact/multi-location form UI
  is the remaining frontend piece.
- **Next slice:** Phase 4.2 Part 4 / Slice 5 (see below).

---

## Phase 4.2 Slice 5 — Directory URL-state convergence — DONE

- **Commit:** (this commit) `fix: converge canonical directory navigation and url state`
- **Files:** web `pages/Organizations.tsx` (RouteState + parse + pushRoute + sync/debounce
  effects; export parseOrganizationsHash), `test/directoryUrlState.test.ts`.
- **Behavior:** the URL is now authoritative for mode + selected record + tab AND **search +
  primary filters** (account type, active status, role). `parseOrganizationsHash` hydrates
  them on mount/refresh/Back-Forward; `pushRoute` carries them so record navigation and the
  full-page "return context" preserve them; a debounced effect writes filter changes to the
  hash (loop-guarded — only pushes when the URL differs). No sensitive data in the URL (ids
  stay in path/query as before; only search text + filter enums added).
- **Data/migration:** none.
- **Tests:** web `directoryUrlState` 4 (hydrate mode/record/search/filters; defaults; direct
  contact/location hash selects mode; role filter), `organizationsPage` 33 unaffected. tsc clean.
- **Browser:** batched into Part 6/Slice 6 closure scenario.
- **Known limitation:** only the four primary filters are URL-backed (search, account_type,
  status, role); the secondary contact filters (owner, importance, photo/logo flags) remain
  local — adequate for the acceptance scenario (refresh/Back-Forward restore the visible
  search + mode + record + primary filters).
- **Next slice:** Phase 4.2 Part 4 (below).

---

## Phase 4.2 Part 4 — Job Intake canonical cascade — VERIFIED (scoping built in Phase 4.1)

- **Commit:** (this commit) `fix: complete canonical directory scoping in job intake`
- **Files:** web `test/jobIntakeQuickCreate.test.tsx` (overridable districts mock + cascade test).
- **Behavior:** the District→School→Location→Contact cascade was wired in Phase 4.1
  (`QuickCreateJobDrawer`: District selector scopes the school search by `parentOrganizationId`;
  selecting a school scopes location/contact options from `organizationDetail`; room/area stays
  free text; current service-term context shown). This commit adds the frontend proof that
  selecting a District scopes the school search to its children by canonical id, complementing
  the backend parent-filter test (`organizationHierarchy` (20)).
- **Data/migration:** none.
- **Tests:** web `jobIntakeQuickCreate` 13 (incl. the new cascade case); backend
  `organizationHierarchy` (20) parent-scope already green.
- **Browser:** batched into Slice 6 closure.
- **Known limitation:** District-level contacts are not yet merged into the school intake
  contact picker (it shows the school org's contacts); adding the parent-District's contacts is
  a bounded follow-up. Sports / non-school intake unchanged.
- **Next slice:** Phase 4.2 Slice A continuation (below).

---

## Phase 4.2 Slice A — canonical contact relationship UNLINK (with isolation) — DONE

- **Commit:** (this commit) `feat: add canonical contact relationship unlink with isolation`
- **Files:** api `canonicalContacts.ts` (+`unlinkContactFromOrganization`),
  `routes/organizations.ts` (`DELETE /contact-identities/:contactId/links/:organizationContactId`),
  `canonicalContacts.test.ts`; web `organizationApi.ts` (+wrapper),
  `CanonicalContactsPanel.tsx` (Unlink button, canManage), `DirectoryRecordDetailPage.tsx`,
  `styles.css`, `canonicalContactExperience.test.tsx`.
- **Behavior:** unlink ONE organization relationship from a canonical contact without deleting
  the identity or any other relationship. Soft by design (no hard delete): the current
  relationship ends (is_current=false) and the org-bound row is archived (active_status=inactive)
  so history stays readable. Wired into the contacts panel's per-person relationship list
  (manager-only Unlink, then the list reloads).
- **Data/migration:** none.
- **Tests:** api `canonicalContacts` 11 (link 2 orgs → unlink 1 → identity + other relationship
  preserved, unlinked row archived + relationship ended; RBAC 403; 404 mismatch); web
  `canonicalContactExperience` 6 (unlink via DELETE keeps the other). tsc + build clean.
- **Browser:** batched into Slice E closure.
- **Known limitation (Slice A remaining, acceptance-incomplete):** the Directory Contacts RAIL
  mode still renders org-bound rows (canonical-identity Contacts mode + pagination + filters not
  migrated); person-identity editing and link-to-another-org-via-selector UI not yet wired (the
  link API + selector exist; unlink now added). These are the next Slice A steps before closure.
- **Next slice:** Bundle 1 relationship management (below).

---

## Phase 4.2 Bundle 1 — canonical contact person-edit + link (relationship management) — DONE

- **Commit:** (this commit) `feat: add canonical contact person-edit and link relationship management`
- **Files:** api `canonicalContacts.ts` (+`updateCanonicalContact` w/ propagation),
  `routes/organizations.ts` (`PATCH /contact-identities/:id`), `canonicalContacts.test.ts`;
  web `organizationApi.ts` (+wrapper), `CanonicalContactsPanel.tsx` (person-edit + link-to-org
  forms), `styles.css`, `canonicalContactExperience.test.tsx`.
- **Behavior:** the canonical contacts panel is now a full relationship manager on canonical
  identities — search/list (Part 2) + expand to the cross-org relationship rollup + **edit the
  person once** (name/email/phone, which PROPAGATES to every linked org-bound row so all
  organization views update) + **link to another organization** (org search + role) +
  **unlink** (prior commit). Manager-gated.
- **Data/migration:** none.
- **Tests:** api `canonicalContacts` 13 (person-edit propagates phone+email to both org rows;
  PATCH RBAC 403; plus prior unlink/link/list); web `canonicalContactExperience` 8 (person-edit
  PATCH, link POST, unlink DELETE-keeps-other). tsc + build clean.
- **Browser (live, API restarted):** logged in; `GET /contact-identities` returns 197 identities;
  opened a school full-page detail (`#directory/organizations/<id>`); the contacts panel renders;
  expanding a contact shows **Edit person / Link to organization / Unlink**; the Edit-person form
  opens with fields + the "updates every organization view" propagation note; PATCH/link/unlink
  routes confirmed live (401 unauth). No real demo data mutated (mutations proven by tests).
- **Known limitation (Bundle 1 still acceptance-incomplete):** the Directory Contacts RAIL mode
  still lists org-bound rows (canonical-identity first-class mode + its URL pagination/filters
  not migrated); the full-page Contact ROUTE shows org-bound relationship_history rather than the
  canonical relationship manager. The relationship-management JOURNEY (edit/link/unlink with
  isolation + propagation) is complete and reachable via the org detail's canonical contacts panel.
- **Next slice:** migrate the Contacts rail/mode to canonical identities (reuse
  CanonicalContactsPanel as the Contacts surface) so the first-class Contacts mode + Contact route
  use identities; then Bundle 2 (multi-contact/location atomic create form), Bundle 3, Bundle 4 closure.

---
