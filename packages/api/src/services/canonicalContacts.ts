import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canManageCanonicalDirectoryRecords } from "../authz/authority.js";
import { createAuditLog } from "./audit.js";

// ── Reusable canonical Contact identity (Phase 4, Slice 2) ───────────────────
// A `contact` identity (migration 161) is the reusable person; an org-bound
// `organization_contact` row references it via `contact_id`, and the
// `organization_contact_relationship` (OCR) carries the per-organization role. The same
// identity can therefore be linked to a District (one role) and a School (another role).
// Nothing here relaxes a NOT-NULL column, deletes data, or merges people on name/email.

function requireManage(auth: AuthUser) {
  if (!canManageCanonicalDirectoryRecords(auth)) {
    throw new ApiError(403, "Managing canonical contacts requires directory management access.");
  }
}

function norm(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return v.length ? v : null;
}
function fullName(first: string | null, last: string | null, full: string | null): string {
  return (full ?? "").trim() || [first, last].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
}

export type CanonicalContactRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  preferred_contact_method: string | null;
  active_status: string;
  source: string;
  created_at: string;
  updated_at: string;
};

const CONTACT_COLUMNS = `id::text, first_name, last_name, full_name, display_name, email, phone, preferred_contact_method, active_status, source, created_at::text, updated_at::text`;

async function loadContact(client: PoolClient, tenantId: string, contactId: string): Promise<CanonicalContactRecord | null> {
  const { rows } = await client.query<CanonicalContactRecord>(`SELECT ${CONTACT_COLUMNS} FROM contact WHERE tenant_id=$1 AND id=$2`, [tenantId, contactId]);
  return rows[0] ?? null;
}

export type CreateCanonicalContactInput = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  preferred_contact_method?: string | null;
};

export async function createCanonicalContact(client: PoolClient, auth: AuthUser, input: CreateCanonicalContactInput): Promise<CanonicalContactRecord> {
  requireManage(auth);
  const full = fullName(input.first_name ?? null, input.last_name ?? null, input.full_name ?? null);
  if (!full && !norm(input.email)) throw new ApiError(400, "A contact needs at least a name or an email.");
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name, display_name, email, normalized_email, phone, preferred_contact_method, source, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$11,$11) RETURNING id::text`,
    [auth.tenantId, input.first_name ?? null, input.last_name ?? null, full || null, norm(full), input.display_name ?? null, input.email ?? null, norm(input.email), input.phone ?? null, input.preferred_contact_method ?? null, auth.id]
  );
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, action: "contact.identity_created", entityType: "contact", entityId: rows[0].id, metadata: { full_name: full } });
  return (await loadContact(client, auth.tenantId, rows[0].id))!;
}

// Link an existing canonical Contact identity to another Organization, with its own
// per-organization role. Creates the org-bound organization_contact row (pointing at the
// identity) + an OCR carrying the role — enabling true cross-org reuse with distinct roles.
export async function linkContactToOrganization(
  client: PoolClient,
  auth: AuthUser,
  contactId: string,
  organizationId: string,
  // relationship_role is the coarse directory_contact_relationship_role enum (general,
  // planning, billing, decision_maker, day_of, operations, other). client_roles is the
  // canonical rich, per-org role array (client_contact_role[]) the audit consolidates on.
  options: { relationship_role?: string; client_roles?: string[]; is_primary?: boolean } = {}
): Promise<{ organization_contact_id: string }> {
  requireManage(auth);
  const identity = await loadContact(client, auth.tenantId, contactId);
  if (!identity) throw new ApiError(404, "Contact not found");
  const org = await client.query(`SELECT 1 FROM organization WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, organizationId]);
  if (!org.rowCount) throw new ApiError(404, "Organization not found");
  const oc = (
    await client.query<{ id: string }>(
      `INSERT INTO organization_contact (tenant_id, organization_id, contact_id, first_name, last_name, full_name, normalized_full_name, email, phone, active_status, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10) RETURNING id::text`,
      // normalized_full_name is NOT NULL on organization_contact; fall back to the email or '' for email-only identities.
      [auth.tenantId, organizationId, contactId, identity.first_name, identity.last_name, identity.full_name, norm(identity.full_name) ?? norm(identity.email) ?? "", identity.email, identity.phone, auth.id]
    )
  ).rows[0];
  await client.query(
    `INSERT INTO organization_contact_relationship (tenant_id, organization_id, contact_id, relationship_role, client_roles, is_primary, is_current, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5::client_contact_role[],$6,true,$7,$7)`,
    [auth.tenantId, organizationId, oc.id, options.relationship_role ?? "general", options.client_roles ?? [], options.is_primary ?? false, auth.id]
  );
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, action: "contact.linked_to_organization", entityType: "contact", entityId: contactId, metadata: { organization_id: organizationId, organization_contact_id: oc.id, relationship_role: options.relationship_role ?? "general", client_roles: options.client_roles ?? [] } });
  return { organization_contact_id: oc.id };
}

// The identity + each Organization relationship it holds (with its per-org role).
export async function getContactRelationships(client: PoolClient, auth: AuthUser, contactId: string) {
  const identity = await loadContact(client, auth.tenantId, contactId);
  if (!identity) return null;
  const { rows } = await client.query(
    `SELECT oc.organization_id::text, o.display_name AS organization_name, oc.id::text AS organization_contact_id,
            ocr.relationship_role, COALESCE(ocr.client_roles, '{}')::text[] AS client_roles, ocr.is_primary
       FROM organization_contact oc
       JOIN organization o ON o.tenant_id = oc.tenant_id AND o.id = oc.organization_id
       LEFT JOIN organization_contact_relationship ocr ON ocr.tenant_id = oc.tenant_id AND ocr.contact_id = oc.id AND ocr.is_current = true
       WHERE oc.tenant_id = $1 AND oc.contact_id = $2
       ORDER BY lower(o.display_name)`,
    [auth.tenantId, contactId]
  );
  return { identity, relationships: rows };
}

export type ContactBackfillClassification = "safe_one_to_one" | "possible_duplicate" | "invalid_no_identity";

export type ContactBackfillDetail = {
  organization_contact_id: string;
  organization_id: string;
  organization_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  existing_contact_id: string | null;
  classification: ContactBackfillClassification;
  duplicate_key: string;
  duplicate_count: number;
  proposed_action: "create_identity" | "review_required";
  created_contact_id: string | null;
};

export type ContactBackfillReport = {
  dry_run: boolean;
  // safe_only = apply ONLY unique-key one-to-one rows; leave possible_duplicate + invalid as Review Required.
  safe_only: boolean;
  batch_id: string | null;
  total_unlinked: number;
  one_to_one: number;
  invalid_no_identity: number;
  possible_duplicate: number;
  applied: number;
  details: ContactBackfillDetail[];
};

// Create one canonical identity per existing org-bound contact and link it (one-to-one).
// NEVER merges on name or email. Rows with no name AND no email are Review Required
// (skipped). Same-name+email rows are flagged possible_duplicate; with safeOnly they are
// left as Review Required (not applied). Idempotent (only rows where contact_id IS NULL).
// Reversible: each created identity is sourced 'backfill:<batch>'; rollback nulls the links
// + deletes them (rollbackContactIdentityBackfill).
export async function backfillContactIdentities(
  client: PoolClient,
  auth: AuthUser,
  options: { dryRun?: boolean; safeOnly?: boolean } = {}
): Promise<ContactBackfillReport> {
  const dryRun = options.dryRun !== false;
  const safeOnly = options.safeOnly === true;
  if (!dryRun) requireManage(auth);
  const rows = (
    await client.query<{ id: string; organization_id: string; organization_name: string | null; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null; phone: string | null }>(
      `SELECT oc.id::text, oc.organization_id::text, o.display_name AS organization_name,
              oc.first_name, oc.last_name, oc.full_name, oc.email, oc.phone
         FROM organization_contact oc
         LEFT JOIN organization o ON o.tenant_id = oc.tenant_id AND o.id = oc.organization_id
        WHERE oc.tenant_id=$1 AND oc.contact_id IS NULL`,
      [auth.tenantId]
    )
  ).rows;
  // possible-duplicate signal: same normalized (name,email) appearing more than once
  const keyCount = new Map<string, number>();
  for (const r of rows) {
    const key = `${norm(fullName(r.first_name, r.last_name, r.full_name))}|${norm(r.email)}`;
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
  }
  const rowById = new Map(rows.map((r) => [r.id, r]));
  let oneToOne = 0, invalid = 0, possibleDup = 0;
  const details: ContactBackfillDetail[] = [];
  for (const r of rows) {
    const full = fullName(r.first_name, r.last_name, r.full_name);
    const key = `${norm(full)}|${norm(r.email)}`;
    const dupCount = keyCount.get(key) ?? 1;
    let classification: ContactBackfillClassification;
    if (!full && !norm(r.email)) {
      classification = "invalid_no_identity";
      invalid += 1;
    } else if (dupCount > 1) {
      classification = "possible_duplicate";
      oneToOne += 1;
      possibleDup += 1;
    } else {
      classification = "safe_one_to_one";
      oneToOne += 1;
    }
    // With safeOnly we apply ONLY safe_one_to_one; otherwise every valid row (incl. possible
    // duplicates, each getting its own identity — never merged).
    const willApply = classification === "safe_one_to_one" || (!safeOnly && classification === "possible_duplicate");
    details.push({
      organization_contact_id: r.id,
      organization_id: r.organization_id,
      organization_name: r.organization_name,
      full_name: full,
      email: r.email,
      phone: r.phone,
      source: null,
      existing_contact_id: null,
      classification,
      duplicate_key: key,
      duplicate_count: dupCount,
      proposed_action: willApply ? "create_identity" : "review_required",
      created_contact_id: null
    });
  }
  const report: ContactBackfillReport = { dry_run: dryRun, safe_only: safeOnly, batch_id: null, total_unlinked: rows.length, one_to_one: oneToOne, invalid_no_identity: invalid, possible_duplicate: possibleDup, applied: 0, details };
  if (dryRun) return report;

  const batchId = (await client.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;
  report.batch_id = batchId;
  for (const detail of details) {
    if (detail.proposed_action !== "create_identity") continue;
    const r = rowById.get(detail.organization_contact_id)!;
    const identity = (
      await client.query<{ id: string }>(
        `INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name, email, normalized_email, phone, source, created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id::text`,
        [auth.tenantId, r.first_name, r.last_name, detail.full_name || null, norm(detail.full_name), r.email, norm(r.email), r.phone, `backfill:${batchId}`, auth.id]
      )
    ).rows[0];
    const updated = await client.query(`UPDATE organization_contact SET contact_id=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND contact_id IS NULL`, [auth.tenantId, detail.organization_contact_id, identity.id]);
    if (updated.rowCount) {
      detail.created_contact_id = identity.id;
      report.applied += 1;
    }
  }
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, action: "contact.identity_backfill", entityType: "contact", entityId: batchId, metadata: { applied: report.applied, safe_only: safeOnly, possible_duplicate: possibleDup, invalid } });
  return report;
}

// Reverse a backfill batch: null the org-bound links, then delete the created identities.
// Hard-deletes ONLY the identities this batch created (source = 'backfill:<batch>'); never
// touches org-bound contacts or any identity from another source. Returns the counts undone.
export async function rollbackContactIdentityBackfill(client: PoolClient, auth: AuthUser, batchId: string): Promise<{ unlinked: number; deleted: number }> {
  requireManage(auth);
  const source = `backfill:${batchId}`;
  const unlinked = await client.query(
    `UPDATE organization_contact SET contact_id = NULL, updated_at = now()
       WHERE tenant_id = $1 AND contact_id IN (SELECT id FROM contact WHERE tenant_id = $1 AND source = $2)`,
    [auth.tenantId, source]
  );
  const deleted = await client.query(`DELETE FROM contact WHERE tenant_id = $1 AND source = $2`, [auth.tenantId, source]);
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, action: "contact.identity_backfill_rolled_back", entityType: "contact", entityId: batchId, metadata: { unlinked: unlinked.rowCount ?? 0, deleted: deleted.rowCount ?? 0 } });
  return { unlinked: unlinked.rowCount ?? 0, deleted: deleted.rowCount ?? 0 };
}
