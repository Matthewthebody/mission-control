# Reusable Contact Identity — Acceptance Closure Report

**Date:** 2026-06-21
**Branch:** `feature/work-spine-foundation-v1`
**Baseline:** `d7bd0f6` (clean HEAD at start)
**Migration head:** 162 (no new migrations — this bundle adds zero schema)

This report closes the **Reusable Contact Identity** acceptance bundle: one canonical person
identity, reused across organizations with independent per-organization relationships, with a
first-class Directory Contacts mode, a stable full-page Contact route, archive/read-only, the
shared selector wired in, a deterministic end-to-end fixture with real mutations, the enumerated
automated tests, and the verification gates below.

---

## 1. Commit ledger (on top of `d7bd0f6`)

| Commit | Summary |
|--------|---------|
| `cf2328d` | feat: canonical contact relationship editing + first-class Contacts mode |
| `55e898e` | feat: URL-backed Contacts mode, canonical Contact route, archive/restore |
| `f137721` | feat: wire shared `CanonicalContactSelector` into org detail + contacts mode |
| `1ddea61` | test: deterministic end-to-end canonical contact workflow (real mutations) |
| `b9bd17d` | test: close enumerated coverage gaps |
| _(this report)_ | `test: close reusable contact identity acceptance` |

Full change set vs baseline is contact-bundle only (no jobs / mileage / migration / unrelated
files touched):

```
docs/2026-06-21-overnight-mission-control-progress.md
docs/2026-06-21-reusable-contact-identity-acceptance-report.md
packages/admin-web/src/components/directory/CanonicalContactSelector.tsx
packages/admin-web/src/components/directory/CanonicalContactsPanel.tsx
packages/admin-web/src/pages/DirectoryRecordDetailPage.tsx
packages/admin-web/src/pages/Organizations.tsx
packages/admin-web/src/services/organizationApi.ts
packages/admin-web/src/test/canonicalContactExperience.test.tsx
packages/admin-web/src/test/directoryRecordRoutes.test.tsx
packages/admin-web/src/test/organizationsPage.test.tsx
packages/api/src/routes/organizations.ts
packages/api/src/services/canonicalContacts.ts
packages/api/tests/canonicalContacts.test.ts
packages/api/tests/directoryPermissionsMatrix.test.ts
```

---

## 2. List behavior (first-class Contacts mode)

The Directory **Contacts** mode renders **one row per canonical Contact identity** (the reusable
`contact` table), not one row per organization relationship. Each row shows the person's name,
email/phone, **linked-organization count**, and a **role summary** (the distinct rich roles the
person holds across all current relationships). Clicking a row's **Open** affordance navigates to
the stable canonical Contact route; expanding a row shows the cross-organization relationship
rollup. The list never merges on name or email — two people with the same name remain two rows
(test `(SAME-NAME)`).

The same `CanonicalContactsPanel` is reused in three modes:

- **default** — embedded in an organization detail page (org-scoped list + relationship mgmt);
- **urlBacked** — the Directory Contacts mode (URL-authoritative filters/pagination/selection);
- **focusContactId** — the single-identity full-page experience (Contact route).

---

## 3. URL / filter contract (refresh + Back/Forward stable)

In `urlBacked` mode every list control is URL-authoritative under the `#directory/contacts` (or
`#directory/internal`) hash, preserving any parent params and managing only the `c*` keys:

| Control | URL key | Default |
|---|---|---|
| Search (name / email / phone) | `cq` | empty |
| Organization filter | `corg` | none |
| Role filter (rich `client_contact_role`) | `crole` | all |
| Active / archive filter | `cstatus` | `active` |
| Pagination (0-based page) | `cpage` | 0 |
| Selected / expanded contact | `cselected` | none |

Refresh re-seeds state from the URL; Back/Forward re-syncs via `hashchange` (the panel ignores the
echo of its own writes to avoid loops). Page size is 25; pagination requests the next `offset`.
Server-side search matches normalized full name, normalized email, and phone; the role filter
narrows to identities holding that role on a **current** relationship.

---

## 4. Person-vs-relationship field ownership (separate mutations)

Person and relationship fields are **never** combined into one ambiguous mutation:

- **Person identity** (`contact`): first/last/full name, email, phone, preferred method,
  active_status. Edited once via `PATCH /contact-identities/:id`; the person fields **propagate**
  to every linked `organization_contact` row, so all organization views show the new info
  (tests `(EDIT)` + E2E step 7 confirm the new phone in **both** org records).
- **Relationship** (per `organization_contact` / `organization_contact_relationship`): relationship
  role, rich `client_roles[]`, primary flag, contextual title, notes. Edited via
  `PATCH /contact-identities/:contactId/links/:organizationContactId`, scoped to **one** org-bound
  row — never touching the person or any other relationship.

---

## 5. Relationship editing, link, unlink (isolation proven)

- **Link** — `POST /contact-identities/:id/links` attaches the identity to another organization
  with its own role (creates the org-bound row + a current relationship).
- **Edit one relationship** — change only the School role (e.g. `picture_day_contact` →
  `yearbook_contact`) while the District relationship and the person identity are unchanged
  (tests `(REL-EDIT)` + E2E steps 8–9).
- **Unlink one relationship** — soft by design: the current relationship ends
  (`is_current=false`) and the org-bound row is archived (`active_status='inactive'`). The identity
  and every other relationship are preserved; the inactive row stays readable as history
  (tests `(UNLINK)` + E2E steps 11–12).

---

## 6. Archive / read-only / restore

Archiving a canonical identity sets `contact.active_status='inactive'` — the **same** soft-archive
convention used elsewhere (no hard delete, **no second archive system**; the `contact` table only
permits `active`|`inactive`). Routes: `POST /contact-identities/:id/archive` `{archived}` with
manage RBAC. While archived, the identity, every relationship, and the history remain fully
readable; the UI hides all mutation controls and offers only **Restore** to managers. Tenancy and
RBAC are server-enforced (tests `(ARCHIVE)` + matrix + E2E steps 15–17 + live smoke).

---

## 7. Shared `CanonicalContactSelector` integration

The one committed selector is now wired into both named surfaces:

- **Organization detail** — an "Add a person to this organization" panel uses the selector
  (organization in context) to link an existing identity; it shows the **already-linked** warning,
  never creates a duplicate silently, surfaces loading/empty/error states, and preserves the page
  (a nonce remounts the contacts panel so the new link appears). Inline identity creation uses the
  same canonical create endpoint.
- **Contacts mode** — a "Find a person" selector opens the canonical Contact route directly.

The selector no longer fires an on-mount empty search (cleaner, and removes an embed-time async
fetch).

---

## 8. Permission matrix (server-enforced)

| Capability | Read (any authed) | Manage (`canManageCanonicalDirectoryRecords`) | Unauth |
|---|---|---|---|
| `GET /contact-identities` (+ filters) | 200 | 200 | 401 |
| `GET /contact-identities/:id/relationships` | 200 | 200 | 401 |
| `POST /contact-identities` | 403 | 201 | 401 |
| `PATCH /contact-identities/:id` (person) | 403 | 200 | 401 |
| `POST /contact-identities/:id/links` (link) | 403 | 201 | 401 |
| `PATCH /…/links/:ocId` (relationship) | 403 | 200 | 401 |
| `DELETE /…/links/:ocId` (unlink) | 403 | 200 | 401 |
| `POST /contact-identities/:id/archive` | 403 | 200 | 401 |

Tenant isolation: a manager cannot link an identity to another tenant's organization (→ 404);
RLS scopes every read/write to `app.current_tenant_id()`. Covered by
`directoryPermissionsMatrix.test.ts`, the `(17)` cross-tenant test, and E2E steps 13–14.

---

## 9. Deterministic end-to-end fixture (real mutations + cleanup)

`canonicalContacts.test.ts › (E2E)` drives the exact HTTP sequence the browser issues, with REAL
(committed) mutations against a **controlled fixture identity** (no demo record touched):

1. create identity → 2. link District (`district_contact`) → 3. link School
(`picture_day_contact`) → 4. relationships show distinct roles → 5. role filter finds it →
6. edit person phone → 7. **new phone present in BOTH org records** → 8. edit **only** School role →
9. School changed, **District + identity unchanged** → 10. fresh re-read (refresh persists) →
11. unlink School → 12. identity + District remain, School row soft-archived → 13. **read-only user
blocked (403 × 4)** → 14. **cross-tenant link denied (404)** → 15. archive (soft) → 16. archived
record still readable → 17. restore → 18. **delete every fixture row**.

A `finally` block deletes the fixture's relationships, org-bound rows, and identity; a post-run DB
query confirmed **0** `e2e-…@persona.example.com` rows remain.

**Live-server smoke** (against the running API on :4000, not the test app): dev-login →
`GET …?role=district_contact` returned real data → created a throwaway identity →
`archive` 200 → `restore` 200 → read-only user `archive` **403** → fixture deleted via DB
(`remaining: 0`).

No Playwright/browser-driver harness exists in this repo (see limitations); the deterministic
fixture therefore runs at the HTTP/route boundary — route → service → RLS → Postgres, identical to
what the browser calls — and the UI layer is covered by the admin-web component/page suite.

---

## 10. Tests

| Suite | Count | Notes |
|---|---:|---|
| `packages/api/tests/canonicalContacts.test.ts` | 21 | list/search (name/email/phone), filters, role filter, person-edit + propagation, link, rel-edit isolation, unlink isolation + preservation, same-name distinct, shared-email no-merge, archive/restore + RBAC, cross-tenant, **18-step E2E**, fixture cleanup |
| `packages/api/tests/directoryPermissionsMatrix.test.ts` | 13 | RBAC tiers incl. create + archive + backfill denial |
| `packages/admin-web/src/test/canonicalContactExperience.test.tsx` | 16 | list/expand, empty, person-edit, link, rel-edit, unlink, archive, full-page focus read-only, urlBacked Open + filters, loading, pagination offset, Back/Forward re-sync, keyboard/focus |
| `packages/admin-web/src/test/directoryRecordRoutes.test.tsx` | 8 | stable route id, not-found/denied/archived states, org-detail selector link, canonical Contact route |
| `packages/admin-web/src/test/organizationsPage.test.tsx` | 33 | Contacts entry point + directory regression |

The ≥32 enumerated behaviors are covered: canonical list; search by name / email / phone; org /
role / active filters; pagination; stable route; person update + propagation to two orgs; link
District + School; distinct roles; relationship-edit isolation; unlink isolation + preservation;
same-name distinct; shared-email no-merge; already-linked warning; archive / read-only; restore;
RBAC; cross-tenant; loading / empty / error / denied; keyboard / focus; refresh + Back/Forward;
fixture cleanup.

---

## 11. Verification gates

| Gate | Result |
|---|---|
| Full admin-web suite (serial, `--no-file-parallelism`) | **555 / 555 passed** (100 files) |
| API — `canonicalContacts` | **21 / 21** |
| API — `directoryPermissionsMatrix` | **13 / 13** |
| API — `organizationAtomicCreate` (isolation) | **5 / 5** |
| API — directory suites (import, reconciliation, organizationsDirectory, hierarchy, schoolServiceTerm) | passed |
| TypeScript — `packages/api` `tsc --noEmit` | clean |
| TypeScript — `packages/admin-web` `tsc --noEmit` | clean |
| Build — `packages/api` (`tsc -p`) | clean |
| Build — `packages/admin-web` (`vite build`) | clean |
| Lint | no ESLint configured in this repo; `tsc --noEmit` is the static gate (clean both packages) |

**Flakiness note (honest):** the authoritative gate is the **serial** admin-web run (`vitest run
--no-file-parallelism`) → **555/555**. Under parallelism, and occasionally even when a single heavy
file runs alone, a few timing-sensitive **unrelated** tests intermittently flake and then pass on
retry — observed: `appAuth`, `productionProjectsPage`, `organizationAtomicCreate`, and within
`organizationsPage` a rotating single test (logo-status / Teams-actions / empty-state). These are
never Contact tests, vary run-to-run, and pass in isolation/serial — i.e. pre-existing within-file
async-ordering + CPU/DB contention, not regressions from this bundle. The Contact suites
themselves (`canonicalContacts` 21, `directoryPermissionsMatrix` 13, `canonicalContactExperience`
16, `directoryRecordRoutes` 8) are deterministically green across repeated runs.

---

## 12. Pre-existing baselines reported separately (NOT touched)

Per instruction, mileage code was not modified and unrelated failures are reported separately. My
diff vs `d7bd0f6` contains **zero** jobs / mileage / migration changes (verified with
`git diff d7bd0f6 --name-only`), so these run identical code to baseline:

- **`timeClockMileagePhase5.test.ts` — 3 failed / 1 passed** (the documented pre-existing mileage
  baseline). Untouched.
- **`jobsCanonicalIndex.test.ts` — 7 failed / 19 passed**, consistent in isolation. The failures
  are data/seed preconditions (e.g. `byOwner.rows.length > 0` → 0) on the shared dev DB, in jobs
  code this bundle never touched. Pre-existing / environmental; out of scope here.

---

## 13. Known limitations

- **No browser-driver harness.** The repo has no Playwright/Cypress setup, so the deterministic
  end-to-end fixture runs at the HTTP/route boundary (the exact API sequence the browser drives)
  plus a live-server smoke; UI-layer behavior is covered by the admin-web component/page suite. A
  future Playwright pass over the rendered admin-web would add literal pixel-level coverage.
- **Org filter input in Contacts mode takes an organization id** (`corg`) rather than a typeahead;
  the richer org typeahead used elsewhere can replace it later. The shared selector (typeahead) is
  already wired for the linking flows.
- **Legacy org-bound contact links** (`#directory/contacts/<organization_contact_id>` from older
  surfaces) fall back to the read-only relationship view via a 404-probe; new navigation always
  uses canonical identity ids.
- **`jobsCanonicalIndex` / mileage** pre-existing failures (section 12) remain open and are out of
  scope for this Contact bundle.

---

_End of report._
