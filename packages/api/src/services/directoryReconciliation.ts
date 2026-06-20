import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canManageCanonicalDirectoryRecords } from "../authz/authority.js";
import { createAuditLog } from "./audit.js";

// ── Legacy Directory reconciliation (Phase 4, Slice 7) ───────────────────────
// One safe framework (Phase 3C.1 mold): tenant-scoped, dry-run capable, idempotent,
// batch-identified, auditable, reversible where applied. It NEVER hard-deletes and
// NEVER fuzzy-merges. District reconciliation links a School's legacy free-text
// school_profile.district_name to the canonical District organization
// (parent_organization_id) ONLY on a deterministic exact normalized-name match, never
// overwriting an existing parent; everything else is Review Required.

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function requireManage(auth: AuthUser) {
  if (!canManageCanonicalDirectoryRecords(auth)) {
    throw new ApiError(403, "Directory reconciliation requires directory management access.");
  }
}

export type DistrictReconciliationClass =
  | "already_canonical"
  | "exact_match"
  | "multiple_candidates"
  | "no_candidate"
  | "conflicting_parent";

export type DistrictReconciliationRow = {
  organization_id: string;
  display_name: string;
  district_name: string;
  current_parent_id: string | null;
  classification: DistrictReconciliationClass;
  matched_district_id: string | null;
};

export type DistrictReconciliationReport = {
  dry_run: boolean;
  batch_id: string | null;
  tenant_id: string;
  total_considered: number;
  by_class: Record<DistrictReconciliationClass, number>;
  applied: number;
  applied_links: Array<{ organization_id: string; district_id: string }>;
  candidates: DistrictReconciliationRow[];
};

async function classifyDistricts(client: PoolClient, tenantId: string): Promise<DistrictReconciliationRow[]> {
  // Schools with a legacy free-text district_name.
  const schools = (
    await client.query<{ organization_id: string; display_name: string; district_name: string; current_parent_id: string | null }>(
      `SELECT o.id::text AS organization_id, o.display_name, sp.district_name, o.parent_organization_id::text AS current_parent_id
         FROM organization o
         JOIN school_profile sp ON sp.tenant_id = o.tenant_id AND sp.organization_id = o.id
         WHERE o.tenant_id = $1 AND COALESCE(trim(sp.district_name), '') <> ''`,
      [tenantId]
    )
  ).rows;
  // Canonical District organizations (parent_organization kind), normalized name -> ids.
  const districts = (
    await client.query<{ id: string; normalized_canonical_name: string }>(
      `SELECT id::text, normalized_canonical_name FROM organization WHERE tenant_id = $1 AND client_entity_kind = 'parent_organization'`,
      [tenantId]
    )
  ).rows;
  const byName = new Map<string, string[]>();
  for (const d of districts) {
    const k = normalize(d.normalized_canonical_name);
    byName.set(k, [...(byName.get(k) ?? []), d.id]);
  }
  return schools.map((s) => {
    const matches = byName.get(normalize(s.district_name)) ?? [];
    let classification: DistrictReconciliationClass;
    let matched: string | null = null;
    if (s.current_parent_id) {
      // Already has a parent: canonical unless the name points at a different district.
      classification = matches.length === 1 && matches[0] !== s.current_parent_id ? "conflicting_parent" : "already_canonical";
    } else if (matches.length === 1) {
      classification = "exact_match";
      matched = matches[0];
    } else if (matches.length > 1) {
      classification = "multiple_candidates";
    } else {
      classification = "no_candidate";
    }
    return { organization_id: s.organization_id, display_name: s.display_name, district_name: s.district_name, current_parent_id: s.current_parent_id, classification, matched_district_id: matched };
  });
}

// District reconciliation. Dry-run reports the classification + writes nothing. Apply links
// ONLY exact_match rows (deterministic, parentless) — never overwrites a parent, never
// touches ambiguous/conflicting rows. Idempotent (re-run links nothing new). Reversible:
// the report's applied_links scope the exact set to undo (set parent_organization_id NULL).
export async function reconcileDistricts(client: PoolClient, auth: AuthUser, options: { dryRun?: boolean } = {}): Promise<DistrictReconciliationReport> {
  const dryRun = options.dryRun !== false;
  if (!dryRun) requireManage(auth);
  const rows = await classifyDistricts(client, auth.tenantId);
  const byClass: Record<DistrictReconciliationClass, number> = {
    already_canonical: 0,
    exact_match: 0,
    multiple_candidates: 0,
    no_candidate: 0,
    conflicting_parent: 0
  };
  for (const r of rows) byClass[r.classification] += 1;

  const report: DistrictReconciliationReport = {
    dry_run: dryRun,
    batch_id: null,
    tenant_id: auth.tenantId,
    total_considered: rows.length,
    by_class: byClass,
    applied: 0,
    applied_links: [],
    candidates: rows
  };
  if (dryRun) return report;

  const batchId = (await client.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;
  report.batch_id = batchId;
  for (const r of rows) {
    if (r.classification !== "exact_match" || !r.matched_district_id) continue;
    // Re-check parent is still null (idempotent + race-safe) before linking.
    const res = await client.query(
      `UPDATE organization SET parent_organization_id = $3, client_entity_kind = 'account', updated_by_user_id = $4, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND parent_organization_id IS NULL`,
      [auth.tenantId, r.organization_id, r.matched_district_id, auth.id]
    );
    if (res.rowCount) {
      report.applied += 1;
      report.applied_links.push({ organization_id: r.organization_id, district_id: r.matched_district_id });
    }
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "directory.districts_reconciled",
    entityType: "organization",
    entityId: batchId,
    metadata: { applied: report.applied, by_class: byClass, batch_id: batchId }
  });
  return report;
}
