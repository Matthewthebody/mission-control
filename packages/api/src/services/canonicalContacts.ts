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

export type ContactBackfillReport = {
  dry_run: boolean;
  batch_id: string | null;
  total_unlinked: number;
  one_to_one: number;
  invalid_no_identity: number;
  possible_duplicate: number;
  applied: number;
};

// Create one canonical identity per existing org-bound contact and link it (one-to-one).
// NEVER merges on name or email. Rows with no name AND no email are Review Required
// (skipped). Same-name+email rows are flagged possible_duplicate but still get their own
// identity (no merge). Idempotent (only rows where contact_id IS NULL). Reversible: each
// created identity is sourced 'backfill:<batch>'; rollback nulls the links + deletes them.
export async function backfillContactIdentities(client: PoolClient, auth: AuthUser, options: { dryRun?: boolean } = {}): Promise<ContactBackfillReport> {
  const dryRun = options.dryRun !== false;
  if (!dryRun) requireManage(auth);
  const rows = (
    await client.query<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null; phone: string | null }>(
      `SELECT id::text, first_name, last_name, full_name, email, phone
         FROM organization_contact WHERE tenant_id=$1 AND contact_id IS NULL`,
      [auth.tenantId]
    )
  ).rows;
  // possible-duplicate signal: same normalized (name,email) appearing more than once
  const keyCount = new Map<string, number>();
  for (const r of rows) {
    const key = `${norm(fullName(r.first_name, r.last_name, r.full_name))}|${norm(r.email)}`;
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
  }
  let oneToOne = 0, invalid = 0, possibleDup = 0;
  const valid: typeof rows = [];
  for (const r of rows) {
    const full = fullName(r.first_name, r.last_name, r.full_name);
    if (!full && !norm(r.email)) { invalid += 1; continue; }
    oneToOne += 1;
    const key = `${norm(full)}|${norm(r.email)}`;
    if ((keyCount.get(key) ?? 0) > 1) possibleDup += 1;
    valid.push(r);
  }
  const report: ContactBackfillReport = { dry_run: dryRun, batch_id: null, total_unlinked: rows.length, one_to_one: oneToOne, invalid_no_identity: invalid, possible_duplicate: possibleDup, applied: 0 };
  if (dryRun) return report;

  const batchId = (await client.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;
  report.batch_id = batchId;
  for (const r of valid) {
    const full = fullName(r.first_name, r.last_name, r.full_name);
    const identity = (
      await client.query<{ id: string }>(
        `INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name, email, normalized_email, phone, source, created_by_user_id, updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id::text`,
        [auth.tenantId, r.first_name, r.last_name, full || null, norm(full), r.email, norm(r.email), r.phone, `backfill:${batchId}`, auth.id]
      )
    ).rows[0];
    await client.query(`UPDATE organization_contact SET contact_id=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2 AND contact_id IS NULL`, [auth.tenantId, r.id, identity.id]);
    report.applied += 1;
  }
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, action: "contact.identity_backfill", entityType: "contact", entityId: batchId, metadata: { applied: report.applied, possible_duplicate: possibleDup, invalid: invalid } });
  return report;
}
