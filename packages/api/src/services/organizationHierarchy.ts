import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";

// ── Canonical Organization hierarchy (Phase 4, Slice 1) ──────────────────────
// Helpers for the District -> School hierarchy that migration 144 already added
// (organization.parent_organization_id / client_entity_kind). District = an
// Organization with client_entity_kind='parent_organization'; School = an
// Organization with client_entity_kind='account' whose parent_organization_id
// references its District. All checks are tenant-scoped and additive; nothing here
// deletes or merges. See docs/phase4-directory-schools-canonical-audit.md.

export type ClientEntityKind = "account" | "parent_organization";

export const CLIENT_ENTITY_KINDS: ClientEntityKind[] = ["account", "parent_organization"];

// Live-verified values of the client_organization_type enum (migration 144).
export const CLIENT_ORGANIZATION_TYPES = [
  "school_district",
  "elementary_school",
  "middle_school",
  "high_school",
  "school",
  "league",
  "sports_association",
  "company",
  "nonprofit",
  "studio_client",
  "corporate_client",
  "other"
] as const;
export type ClientOrganizationType = (typeof CLIENT_ORGANIZATION_TYPES)[number];

// Validate that `parentId` is a usable parent District for an Organization (`selfId`
// is null on create). Rejects: parent missing / cross-tenant, parent that is not a
// `parent_organization`, self-parent, and any hierarchy cycle (parent that is a
// descendant of self). Throws ApiError(400) with an actionable message.
export async function validateOrganizationParent(
  client: PoolClient,
  tenantId: string,
  parentId: string,
  selfId: string | null
): Promise<void> {
  if (selfId && parentId === selfId) {
    throw new ApiError(400, "An organization cannot be its own parent District.");
  }
  const parent = (
    await client.query<{ id: string; client_entity_kind: string | null }>(
      `SELECT id::text, client_entity_kind::text AS client_entity_kind FROM organization WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, parentId]
    )
  ).rows[0];
  if (!parent) {
    throw new ApiError(400, "Parent District not found in this tenant.");
  }
  if (parent.client_entity_kind !== "parent_organization") {
    throw new ApiError(400, "The selected parent is not a District (it must be a parent organization).");
  }
  // Cycle guard: walk up from the proposed parent; reaching self means a cycle.
  if (selfId) {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === selfId) {
        throw new ApiError(400, "Hierarchy cycle: the selected parent is a descendant of this organization.");
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor =
        (
          await client.query<{ parent_organization_id: string | null }>(
            `SELECT parent_organization_id::text AS parent_organization_id FROM organization WHERE tenant_id = $1 AND id = $2`,
            [tenantId, cursor]
          )
        ).rows[0]?.parent_organization_id ?? null;
    }
  }
}

// Read-only legacy fallback: the old Directory UI packed Website / Main Phone (and
// brand fields) into organization.notes as "Label: value" lines. New writes use
// canonical columns; on READ, when a canonical column is null we surface the parsed
// note value so existing records still display correctly. Never mutates notes.
export function parseLegacyOrganizationNotes(notes: string | null): { website: string | null; main_phone: string | null } {
  if (!notes) return { website: null, main_phone: null };
  const grab = (label: string): string | null => {
    const match = notes.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, "i"));
    const value = match?.[1]?.trim();
    return value && value.length > 0 ? value : null;
  };
  return { website: grab("Website"), main_phone: grab("Main Phone") };
}
