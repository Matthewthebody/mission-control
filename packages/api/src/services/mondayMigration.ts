import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";

// ── Monday.com migration framework (Phase 5, Part F) ─────────────────────────
// A dry-run-by-default, idempotent, side-effect-suppressed IMPORT PLANNER. It reads a
// sanitized board export + a mapping config and produces a deterministic plan
// (create / update / skip / conflict / review_required) WITHOUT writing any entity, and
// WITHOUT triggering any notification, email, reminder, escalation, or workflow side effect.
//
// Idempotency backbone: external_object_map (provider='monday', external_id=<itemId>,
// object_type=<target>) — the same map the existing schoolsHubMonday importer uses. Candidate
// matching is by source item id / external map ONLY — never by fuzzy name. Source ids
// (workspace, board, item, column) are preserved on every planned row so an eventual approved
// apply can write them back into external_object_map.payload.
//
// This module plans only. It never imports — production import is a separate, approved step.

export type MondayColumn = { id: string; title: string; type: string };

export type MondayItem = {
  item_id: string;
  name: string;
  group_id?: string | null;
  group_title?: string | null;
  column_values: Record<string, string | number | boolean | null>;
  updated_at?: string | null;
  subitem_count?: number;
  update_count?: number;
  attachment_count?: number;
};

export type MondayBoardExport = {
  workspace?: string | null;
  board_id: string;
  board_name: string;
  columns: MondayColumn[];
  items: MondayItem[];
};

// Canonical target classes the importer understands (others → review_required).
export type MondayTargetEntity =
  | "organization"
  | "district_organization"
  | "contact"
  | "location"
  | "job"
  | "service_term"
  | "workflow_run"
  | "communication"
  | "report_view";

export type MondayMappingConfig = {
  target_entity: MondayTargetEntity;
  // external_object_map.object_type used as the idempotency key for this board.
  dedupe_object_type: string;
  // canonical field -> source column id
  column_map: Record<string, string>;
  // canonical fields that MUST be present (else the row is review_required)
  required_fields: string[];
  // column types we cannot import deterministically (formula/mirror/dependency) — reported, never invented.
  unsupported_column_types?: string[];
};

export type MigrationRowClassification = "create" | "update" | "skip" | "conflict" | "review_required";

export type MigrationPlanRow = {
  item_id: string;
  item_name: string;
  classification: MigrationRowClassification;
  target_entity: MondayTargetEntity;
  mapped_fields: Record<string, string | number | boolean | null>;
  missing_required: string[];
  unsupported_columns: string[];
  existing_object_id: string | null;
  conflict_reason: string | null;
  dedupe_key: string;
  source_ids: { workspace: string | null; board_id: string; item_id: string; group_id: string | null; column_ids: string[] };
};

export type MigrationPlan = {
  dry_run: boolean;
  side_effects_suppressed: true;
  provider: "monday";
  workspace: string | null;
  board_id: string;
  board_name: string;
  target_entity: MondayTargetEntity;
  total_items: number;
  counts: Record<MigrationRowClassification, number>;
  unsupported_column_ids: string[];
  rows: MigrationPlanRow[];
};

function normalizeValue(value: string | number | boolean | null | undefined): string | number | boolean | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value.trim();
  return value;
}

// Look up an existing canonical mapping for a Monday item (idempotency). Read-only.
async function loadExistingMap(
  client: PoolClient,
  tenantId: string,
  externalId: string
): Promise<{ object_id: string | null; object_type: string | null; last_synced_at: string | null } | null> {
  const { rows } = await client.query<{ object_id: string | null; object_type: string | null; last_synced_at: string | null }>(
    `SELECT object_id::text, object_type, (payload ->> 'last_synced_at') AS last_synced_at
       FROM external_object_map
      WHERE tenant_id = $1 AND provider = 'monday' AND external_id = $2
      ORDER BY object_type LIMIT 1`,
    [tenantId, externalId]
  );
  return rows[0] ?? null;
}

// Plan a Monday board import. DRY-RUN ONLY — never writes; never fires side effects.
export async function planMondayImport(
  client: PoolClient,
  auth: AuthUser,
  board: MondayBoardExport,
  mapping: MondayMappingConfig
): Promise<MigrationPlan> {
  const unsupportedTypes = new Set((mapping.unsupported_column_types ?? ["formula", "mirror", "dependency", "subtasks"]).map((t) => t.toLowerCase()));
  const unsupportedColumnIds = board.columns.filter((c) => unsupportedTypes.has(c.type.toLowerCase())).map((c) => c.id);
  const unsupportedSet = new Set(unsupportedColumnIds);

  // In Monday the item NAME is a special top-level field, not a regular column value — a
  // mapping that targets a name-type column resolves to item.name.
  const nameColumnIds = new Set(board.columns.filter((c) => c.type.toLowerCase() === "name").map((c) => c.id));

  const counts: Record<MigrationRowClassification, number> = { create: 0, update: 0, skip: 0, conflict: 0, review_required: 0 };
  const rows: MigrationPlanRow[] = [];

  for (const item of board.items) {
    const mapped: Record<string, string | number | boolean | null> = {};
    for (const [field, colId] of Object.entries(mapping.column_map)) {
      mapped[field] = nameColumnIds.has(colId) ? normalizeValue(item.name) : normalizeValue(item.column_values[colId]);
    }
    const missingRequired = mapping.required_fields.filter((f) => {
      const v = mapped[f];
      return v === null || v === "";
    });
    const itemUnsupported = Object.keys(item.column_values).filter((colId) => unsupportedSet.has(colId));

    const existing = await loadExistingMap(client, auth.tenantId, item.item_id);
    const dedupeKey = `monday:${mapping.dedupe_object_type}:${item.item_id}`;

    let classification: MigrationRowClassification;
    let conflictReason: string | null = null;
    if (existing && existing.object_type && existing.object_type !== mapping.dedupe_object_type) {
      // the same Monday item is already mapped to a DIFFERENT canonical object type
      classification = "conflict";
      conflictReason = `Monday item already mapped to object_type '${existing.object_type}', not '${mapping.dedupe_object_type}'`;
    } else if (missingRequired.length) {
      classification = "review_required";
    } else if (existing && existing.object_id) {
      // already imported — skip when unchanged since last sync, else update
      const itemUpdated = item.updated_at ?? null;
      const lastSynced = existing.last_synced_at ?? null;
      classification = itemUpdated && lastSynced && itemUpdated <= lastSynced ? "skip" : "update";
    } else {
      classification = "create";
    }
    counts[classification] += 1;

    rows.push({
      item_id: item.item_id,
      item_name: item.name,
      classification,
      target_entity: mapping.target_entity,
      mapped_fields: mapped,
      missing_required: missingRequired,
      unsupported_columns: itemUnsupported,
      existing_object_id: existing?.object_id ?? null,
      conflict_reason: conflictReason,
      dedupe_key: dedupeKey,
      source_ids: {
        workspace: board.workspace ?? null,
        board_id: board.board_id,
        item_id: item.item_id,
        group_id: item.group_id ?? null,
        column_ids: board.columns.map((c) => c.id)
      }
    });
  }

  return {
    dry_run: true,
    side_effects_suppressed: true,
    provider: "monday",
    workspace: board.workspace ?? null,
    board_id: board.board_id,
    board_name: board.board_name,
    target_entity: mapping.target_entity,
    total_items: board.items.length,
    counts,
    unsupported_column_ids: unsupportedColumnIds,
    rows
  };
}
