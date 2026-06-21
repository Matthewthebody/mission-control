# Phase 5 — Monday.com Migration Discovery & Pilot Report

**Date:** 2026-06-20 · **Branch:** `feature/work-spine-foundation-v1`
**Status:** discovery + dry-run pilot complete. **No production import occurred.**

This closes the Phase 5 discovery + pilot. It summarizes the board inventory + mapping, the
importer framework, the dry-run pilot results, and the cutover/approval plan. It is paired with
`docs/phase5-monday-board-inventory-and-mapping.md` (inventory + mapping) and the artifacts under
`docs/artifacts/monday/`.

## 1. Inventory summary

There are **no real Monday board exports in the repository** (exhaustive sweep: zero CSV/XLSX/NDJSON,
no fixtures/exports directory; every Monday reference is a hardcoded constant, GraphQL string, type, or
operator-entered field). Two boards are integrated in code today: **Locations** (`7848036857`) and
**Post-Shoot Evaluations** (`6159270943`), via `locationMonday.ts`. The remaining ~74 of Matthew's
~76-board estimate are pending a real export and are mapped by **class**, not per-board. The mapping
contract is complete; the per-board facts come from the export (see the Missing Source Data register).

## 2. Board classifications

Each board maps to exactly one class → canonical target: **canonical master data** (Schools/Districts/
Contacts/Locations) → Organizations+hierarchy+Contacts+Locations+service terms; **Jobs/Shoots** (Initial
Process, Photoshoot history) → `jobs`/`shoot`+workflow; **workflow/process** (Yearbook/Gallery/Portal/
Code Return) → service enrollment + workflow runs; **service config** → `school_service_term`;
**reference** → resources; **communications** → communication history; **reporting** → views (no tables);
**duplicate/redundant** → consolidate; **archived** → skip; **Review Required** → human classification.
Full taxonomy + per-class mapping in the inventory doc §3–§4.

## 3. Canonical mappings (locked)

All Schools → Organizations + parent District + Contacts + Locations + service terms · District
Information → District organization truth · Contacts → canonical identities + contextual relationships
(never merge on shared email) · Initial Process → Jobs/Shoots + workflow · Yearbook/Gallery/Portal/Code
Return → service enrollment + workflow · Photoshoot history → Jobs/Shoots · communications → history ·
reporting → views · redundant → consolidate. **Idempotent match key:** `external_object_map(provider=
'monday', external_id=<itemId>, object_type)` primary; `source_system='monday' AND source_reference=
'monday:item:<itemId>'` secondary. Matching never relies on fuzzy names.

## 4. Redundant-board recommendations

Per-board redundancy cannot be finalized without the export, but the mapping forces consolidation by
design: any board whose items resolve (by external id) to an already-canonical Organization/Contact/
Location/Job is a **consolidation candidate**, not a new table. Reporting/view boards are rebuilt as
views over canonical data, never imported as rows. The register flags each board's
`merge_consolidation_candidate` for human confirmation before import.

## 5. Pilot input + dry-run results

Because no real export exists, the pilot ran against **three sanitized sample fixtures**
(`packages/api/tests/fixtures/monday/`): All Schools, Initial Process, Code Return.

| Board (sample) | items | create | update | skip | conflict | review_required | deterministic |
|---|---|---|---|---|---|---|---|
| All Schools | 3 | 2 | 0 | 0 | 0 | 1 | yes |
| Initial Process | 2 | 2 | 0 | 0 | 0 | 0 | yes |
| Code Return | 2 | 2 | 0 | 0 | 0 | 0 | yes |

Artifacts: `docs/artifacts/monday/<board>.dry-run.{json,md}`, `conflicts-and-review.csv`,
`MISSING-SOURCE-DATA.md`.

## 6. Conflicts

The pilot's clean samples produced 1 `review_required` (a blank-name school row missing the required
canonical name) and 0 conflicts. The framework test additionally proves conflict handling: an item id
already mapped to a *different* `object_type` is classified **conflict** (never silently re-pointed), and
a mapped item newer than its last sync is **update** (not a blind re-create). Conflicts + review rows are
exported to `conflicts-and-review.csv` for human resolution.

## 7. Unsupported columns / features

Formula, mirror, dependency, and subtask columns are **flagged unsupported and never invented** — the
planner records their column ids per board and leaves the values out of `mapped_fields`. The pilot
detected `formula_health` (All Schools), `mirror_owner` (Initial Process), and `dependency_prev` (Code
Return). A real export will surface the real set; these require explicit human mapping or omission.

## 8. Attachment / comment / subitem strategy

The planner counts (does not import) `attachment_count`, `update_count` (comments), and `subitem_count`
per item and preserves the source item id. Recommended cutover handling: **attachments** → re-host into
the canonical resource library keyed by `external_object_map`; **comments/updates** → import into
communication history only where a canonical target exists, append-only; **subitems** → map to child
canonical records (e.g. Job tasks) under the parent's canonical id, never as a flattened blob. None of
these are imported in discovery — they are scoped for the approved cutover.

## 9. Idempotency proof

The planner is deterministic: the pilot runs each board **twice** and asserts identical row output
(`deterministic=true`), and the framework test asserts `JSON.stringify(plan1.rows) === plan2.rows`. On a
real apply, idempotency is enforced by the `external_object_map` UNIQUE `(tenant_id, provider,
external_id, object_type)` — a re-imported item resolves to its existing canonical id (update/skip), never
a duplicate.

## 10. Side-effect suppression proof

The planner **writes nothing** — the framework test asserts the `external_object_map` row count is
unchanged before/after planning, and every plan carries `side_effects_suppressed: true`. By construction
it triggers no notification, email, staffing reminder, overdue/workflow escalation, or Urgent-Window
issue. The approved-apply design (below) preserves this: historical/closed work is imported with
suppression flags so no employee/client message and no escalation fires for past records.

## 11. Rollback design

Every applied import batch will carry a batch id and write `external_object_map` + `integration_sync_operation`
rows. Rollback = delete the batch's `external_object_map` rows and revert the canonical records it created
(those whose `source_system='monday'` and `source_reference='monday:item:<id>'` and whose creating batch
matches), mirroring the Part C contact-backfill rollback (null the links, delete only batch-created rows).
Nothing is hard-deleted beyond the batch's own creations; MC-owned records (`source_system != 'monday'`)
are never touched.

## 12. Delta-import design

Re-running against a newer export classifies each item via `external_object_map`: unchanged → skip
(item `updated_at <= last_synced_at`), changed → update, new → create. Deltas never duplicate (UNIQUE
external map) and never fuzzy-match. A scheduled delta importer would reuse the same planner + an approved
apply, with side-effect suppression for back-dated changes.

## 13. Source freeze / coexistence recommendation

Per `integrationGovernance.ts` (`sync_mode='manual_reconciliation'`, ownership `transitional`): keep
Monday as the **coexistence source of record per domain until that domain's ownership is explicitly
retired**. Recommended sequence: (1) import canonical master data (Schools/Districts/Contacts/Locations)
under approval; (2) verify in the canonical Directory; (3) freeze the corresponding Monday boards to
read-only; (4) migrate Jobs/Shoots + service/workflow boards; (5) retire a board only after its canonical
domain is verified and signed off. No board is auto-retired by this work.

## 14. Final approval gate

A production import requires explicit approval and, per board class, a real sanitized export. The
framework, mappings, pilot, idempotency, side-effect suppression, and rollback design are in place;
**the apply executor is intentionally not built/enabled** pending (a) real exports and (b) Matthew's
go-ahead per board class.

## 15. Explicit confirmations

- **No full import occurred.**
- **No ~76-board internal clone was created** — boards map onto the canonical model; no board structure
  became product architecture.
- **No fuzzy auto-merge occurred** — matching is by Monday item id / external_object_map only.
- **No Monday source was declared retired.**
- **No client or employee messages were generated**, and no staffing/workflow/Urgent-Window side effect
  fired — the planner writes nothing.

`stash@{0}` untouched · nothing pushed · migration head unchanged at **162** · Phase 6 role-specific
dashboards not started.
