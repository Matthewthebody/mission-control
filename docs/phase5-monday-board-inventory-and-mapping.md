# Phase 5 — Monday.com Board Inventory & Canonical Mapping

**Date:** 2026-06-20 · **Branch:** `feature/work-spine-foundation-v1`
**Status:** discovery + mapping framework. **No production import. No 76-board clone. No source retired.**

This document inventories Monday.com boards and maps them to canonical Mission Control entities. It is
the discovery artifact for the Phase 5 importer framework (Part F) and cutover plan (Part G). The locked
principle: **Monday board structure is NOT product architecture** — boards map ONTO the existing canonical
model (Organizations / Contacts / Locations / service terms / Jobs / Shoots / workflows / reports), they
are not recreated as tables.

---

## 0. Source-data reality (read this first)

**There are no real Monday board exports committed in this repository.** An exhaustive sweep (Part E
research) found: zero `*.csv` / `*.xlsx` / `*.ndjson`, no `fixtures` / `exports` / `samples` directory,
and every Monday reference in code is either a hardcoded constant, a GraphQL query string, a TypeScript
type, or an operator-entered form field. The only board IDs that exist in the repo are two hardcoded
production board IDs in `locationMonday.ts` (below).

Consequently this inventory has two layers:
- **Known boards** — the two boards the codebase already integrates with (real IDs).
- **Class-based mapping** — for the remaining ~74 boards (Matthew's estimate of ~76 total), the inventory
  is organized by **board class** with the canonical mapping, dedupe key, and transformation defined per
  class. The per-board rows (workspace, owner, columns, sample values, automations, volume, etc.) must be
  filled from a real Monday export; the importer framework (Part F) consumes that export against these
  class mappings. A **Missing Source Data** register (§5) lists exactly what is needed.

This is the honest, safe shape: the mapping contract is complete and testable; the per-board facts are
pending the export. Nothing is invented as production data.

## 1. Existing Monday coexistence assets (do not rebuild)

The repo already has a working coexistence layer — the Phase 5 framework builds ON it, not beside it:

| Asset | What it is | Reuse in Phase 5 |
|---|---|---|
| `external_object_map` (migration 003; index 074) | `(tenant_id, provider, external_id, object_type) UNIQUE` → `object_id` + `payload` jsonb | **The idempotency backbone.** Every imported item keys on `(provider='monday', external_id=<itemId>, object_type)`. |
| `integration_sync_operation` (migration 019) | inbound/outbound sync ledger: `external_id`, `source_system`, `source_change_key`, `operation_type`, `status`, `conflict_payload` | The per-row audit + replay ledger. |
| `schoolsHubMonday.ts` (`importMondaySchoolSnapshot`) | snapshot-based, idempotent (3-tier match), conflict-guarded school importer | The proven import *pattern* (match → conflict-guard → write → map → ledger). |
| `locationMonday.ts` | live Monday GraphQL client; **Location board `7848036857`**, **Post-Shoot-Eval board `6159270943`**; mock fallback when no token | The two **known** boards + the live-fetch path for a real export. |
| `integrationGovernance.ts` (`buildMondayProviderSummary`) | declares Monday `sync_mode='manual_reconciliation'`, ownership `transitional`, "do not auto-overwrite legacy board state until ownership is explicitly retired" | The governance/source-of-truth policy the importer obeys. |
| `MondaySchoolAdminPanel.tsx` | manual "Monday Coexistence Controls" import form ("an import tool, not a live sync surface") | The operator entry point; extends to the new framework. |
| `source_system` / `source_reference` on `school_job`/`school_work_item` (enum incl. `'monday'`; convention `monday:item:<id>`) | per-record source attribution + the side-effect guard (`source_system != 'monday'` protects MC-owned rows) | The secondary dedupe key + the side-effect ownership guard. |

`tools/migrate/` is an orphaned 4-file stub (`mondayStub.ts` etc.) referenced nowhere — it is **not** the
framework and Part F does not depend on it.

## 2. Inventory fields (schema for the real export)

For every board, the importer's inventory record captures (this is the contract the Part F framework reads
and the register a real export must populate):

`workspace · board_id · board_name · owner · department · lifecycle(active|deprecated|archived) ·
business_purpose · source_groups[] · source_columns[{id,title,type}] · sample_values · automations[] ·
integrations[] · connected_boards[] · item_volume · history_range · attachments · updates_comments ·
subitems · formula_mirror_dependency_columns[] · authority(authoritative|derived|reporting_only) ·
target_entity · target_field · transformation · time_scope · dedupe_key · required|optional ·
merge_consolidation_candidate · migration_priority · open_issue`

## 3. Board classification

Each board is classified into exactly one class; the class determines the canonical target:

| Class | Canonical target | Import action |
|---|---|---|
| **canonical master data** (Schools, Districts, Contacts, Locations) | Organizations + hierarchy + Contacts + Locations + service terms | upsert canonical records (idempotent on external id) |
| **Jobs / Shoots** (Initial Process, Photoshoot history) | canonical `jobs` / `shoot` + workflow instances | create Jobs/Shoots; never force non-job records through Jobs |
| **workflow / process state** (Yearbook, Gallery, Portal, Code Return progress) | service enrollment + workflow runs/tasks | create service-term/workflow state, not a new board table |
| **school-year / season service config** | `school_service_term` (migration 160) | upsert the term + `service_config` |
| **reference / resources** | resource library / record resources | attach as resources |
| **communications / history** | communication history | append-only history where appropriate |
| **reporting / view only** | reports/views (no new tables) | **do not import as data** — rebuild as a view |
| **duplicate / redundant** | consolidate into the canonical record | merge into target; flag for human confirm |
| **archived / deprecated** | none | skip; record in register |
| **Review Required** | none (yet) | human classification before import |

## 4. Locked canonical mapping (by class)

These mappings are fixed (per the Phase 5 brief) regardless of board layout:

- **All Schools** → `organization` (account, school type) + parent **District** hierarchy
  (`parent_organization_id`) + **Contacts** (canonical identities + contextual `organization_contact`) +
  **Locations** (`shoot_location`) + **service terms** (`school_service_term`).
  Dedupe: `external_object_map(monday, <schoolItemId>, 'organization')`; secondary exact normalized name.
- **District Information** → the **District** `organization` (`client_entity_kind='parent_organization'`)
  canonical truth (name, website, main phone, external code). Dedupe on district item id.
- **Contacts** → canonical `contact` identity + per-org `organization_contact` relationship with role.
  **Never merge on shared email** (the Part C rule); one identity per distinct person, reused across orgs.
- **Initial Process** → canonical **Jobs/Shoots** + the workflow instance for intake. Dedupe on the
  process item id; link to the School org by canonical id (never fuzzy name).
- **Yearbook / Gallery / Portal / Code Return** → **service enrollment** (a `school_service_term`
  `service_config` flag/section) **plus** the corresponding **workflow** run — not a per-board table.
- **Photoshoot history** → canonical **Jobs/Shoots** (historical, side-effect-suppressed — §Part F).
- **Communications** → communication history records where a canonical target exists.
- **Reporting boards** → **reports/views over canonical data**, never new tables.
- **Redundant boards** → consolidated into the canonical record; the redundancy is recorded, the board is
  not cloned.

**Idempotent match key (all classes):** primary `external_object_map(provider='monday',
external_id=<itemId>, object_type=<target>)`; secondary `source_system='monday' AND
source_reference='monday:item:<itemId>'`. Matching **never** relies on fuzzy names alone.

## 5. Known boards (real IDs in the codebase)

| board_id | board_name (inferred) | class | canonical target | integration today |
|---|---|---|---|---|
| `7848036857` | Locations | canonical master data → Locations | `shoot_location` + Location Intelligence | live read via `locationMonday.ts` (mock without token) |
| `6159270943` | Post-Shoot Evaluations | communications/history → evaluations | `post_shoot_evaluation` (`monday_item_id`) | live read/write via `locationMonday.ts`; column-id map at `locationMonday.ts:44-58` |

Every other board (~74) is **Review Required / pending export** — see the register.

## 6. Missing Source Data register

To complete the per-board inventory and run a real pilot, the following must be provided (none are in the
repo today). Until then the importer runs against **sanitized sample fixtures** (Part F) and the per-board
rows below stay empty:

1. A Monday **board list** export (workspace, board_id, board_name, owner, department, lifecycle) for all
   ~76 boards.
2. For each pilot board (All Schools, one Initial Process, one of Yearbook/Gallery/Code Return): a
   **structure export** (groups + columns with ids/types) and a **representative item export** (column
   values, subitems, updates, attachments references) — sanitized.
3. Owner/department metadata and any board-level automations/integrations to confirm side-effect scope.

Provide these as `docs/artifacts/monday/<board>.json` (or CSV); the Part F framework reads them directly.

## 7. What this is NOT

No board was imported. No board structure was recreated as product architecture. No board was declared
retired. No fuzzy auto-merge was performed. The ~76-board count is Matthew's estimate, not a discovered
inventory — the real count + per-board facts come from the export. This document fixes the **mapping
contract**; Part F builds the **idempotent dry-run importer**; Part G is the cutover plan + approval gate.
EOF
