import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canManageSchoolFoundation } from "../authz/authority.js";
import { createAuditLog } from "./audit.js";

// ── School-year / season service terms (Phase 4, Slice 4) ────────────────────
// The canonical, time-bound middle layer: per-(Organization x school-year/season)
// service configuration, separate from static account truth and dated Job/Shoot truth.
// Prior terms stay historical; a new term may copy a prior one into a DRAFT, but
// inherited values are never silently confirmed as current truth. See migration 160
// and docs/phase4-directory-schools-canonical-audit.md.

export type SchoolServiceTermPeriodType = "school_year" | "season" | "custom";
export type SchoolServiceTermStatus = "draft" | "current" | "closed";

export type SchoolServiceTermRecord = {
  id: string;
  organization_id: string;
  period_type: SchoolServiceTermPeriodType;
  period_label: string;
  start_date: string | null;
  end_date: string | null;
  status: SchoolServiceTermStatus;
  confirmation_state: "unconfirmed" | "confirmed";
  internal_owner_user_id: string | null;
  source: string;
  service_config: Record<string, unknown>;
  copied_from_term_id: string | null;
  inherited_field_keys: string[];
  confirmed_by_user_id: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLUMNS = `
  id::text, organization_id::text, period_type, period_label, start_date::text, end_date::text,
  status, confirmation_state, internal_owner_user_id::text, source, service_config,
  copied_from_term_id::text, inherited_field_keys, confirmed_by_user_id::text, confirmed_at::text,
  notes, created_at::text, updated_at::text`;

function requireManage(auth: AuthUser) {
  if (!canManageSchoolFoundation(auth)) {
    throw new ApiError(403, "Managing school-year service terms requires school foundation access.");
  }
}

async function assertOrganizationInTenant(client: PoolClient, tenantId: string, organizationId: string) {
  const found = await client.query(`SELECT 1 FROM organization WHERE tenant_id = $1 AND id = $2`, [tenantId, organizationId]);
  if (!found.rowCount) throw new ApiError(404, "Organization not found");
}

async function loadTerm(client: PoolClient, tenantId: string, termId: string): Promise<SchoolServiceTermRecord | null> {
  const { rows } = await client.query<SchoolServiceTermRecord>(
    `SELECT ${SELECT_COLUMNS} FROM school_service_term WHERE tenant_id = $1 AND id = $2`,
    [tenantId, termId]
  );
  return rows[0] ?? null;
}

export async function listSchoolServiceTerms(client: PoolClient, auth: AuthUser, organizationId: string): Promise<SchoolServiceTermRecord[]> {
  await assertOrganizationInTenant(client, auth.tenantId, organizationId);
  const { rows } = await client.query<SchoolServiceTermRecord>(
    `SELECT ${SELECT_COLUMNS} FROM school_service_term
       WHERE tenant_id = $1 AND organization_id = $2
       ORDER BY (status = 'current') DESC, period_label DESC, created_at DESC`,
    [auth.tenantId, organizationId]
  );
  return rows;
}

export async function getCurrentSchoolServiceTerm(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  periodType: SchoolServiceTermPeriodType = "school_year"
): Promise<SchoolServiceTermRecord | null> {
  const { rows } = await client.query<SchoolServiceTermRecord>(
    `SELECT ${SELECT_COLUMNS} FROM school_service_term
       WHERE tenant_id = $1 AND organization_id = $2 AND period_type = $3 AND status = 'current' LIMIT 1`,
    [auth.tenantId, organizationId, periodType]
  );
  return rows[0] ?? null;
}

export type CreateSchoolServiceTermInput = {
  period_type?: SchoolServiceTermPeriodType;
  period_label: string;
  start_date?: string | null;
  end_date?: string | null;
  internal_owner_user_id?: string | null;
  service_config?: Record<string, unknown>;
  notes?: string | null;
};

export async function createSchoolServiceTerm(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateSchoolServiceTermInput
): Promise<SchoolServiceTermRecord> {
  requireManage(auth);
  await assertOrganizationInTenant(client, auth.tenantId, organizationId);
  const periodType = input.period_type ?? "school_year";
  const label = input.period_label.trim();
  if (!label) throw new ApiError(400, "A period label is required.");
  const existing = await client.query(
    `SELECT 1 FROM school_service_term WHERE tenant_id = $1 AND organization_id = $2 AND period_type = $3 AND period_label = $4`,
    [auth.tenantId, organizationId, periodType, label]
  );
  if (existing.rowCount) throw new ApiError(409, `A ${periodType} term '${label}' already exists for this organization.`);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO school_service_term
       (tenant_id, organization_id, period_type, period_label, start_date, end_date, internal_owner_user_id, service_config, notes, source, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'manual',$10,$10) RETURNING id::text`,
    [
      auth.tenantId,
      organizationId,
      periodType,
      label,
      input.start_date ?? null,
      input.end_date ?? null,
      input.internal_owner_user_id ?? null,
      JSON.stringify(input.service_config ?? {}),
      input.notes ?? null,
      auth.id
    ]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school_service_term.created",
    entityType: "school_service_term",
    entityId: rows[0].id,
    metadata: { organization_id: organizationId, period_type: periodType, period_label: label }
  });
  return (await loadTerm(client, auth.tenantId, rows[0].id))!;
}

// Activate a term as the current one for its (organization, period_type); the prior
// current term becomes 'closed' (historical, still readable). The partial unique index
// guarantees at most one 'current'.
export async function setCurrentSchoolServiceTerm(client: PoolClient, auth: AuthUser, termId: string): Promise<SchoolServiceTermRecord> {
  requireManage(auth);
  const term = await loadTerm(client, auth.tenantId, termId);
  if (!term) throw new ApiError(404, "Service term not found");
  if (term.status === "current") return term;
  await client.query(
    `UPDATE school_service_term SET status = 'closed', updated_by_user_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND organization_id = $2 AND period_type = $4 AND status = 'current'`,
    [auth.tenantId, term.organization_id, auth.id, term.period_type]
  );
  await client.query(
    `UPDATE school_service_term SET status = 'current', updated_by_user_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [auth.tenantId, termId, auth.id]
  );
  return (await loadTerm(client, auth.tenantId, termId))!;
}

// Copy a prior term into a NEW draft for the next period. Inherited values are flagged
// (inherited_field_keys) and the draft is 'unconfirmed' — never silently current truth.
export async function rolloverSchoolServiceTerm(
  client: PoolClient,
  auth: AuthUser,
  sourceTermId: string,
  newPeriodLabel: string
): Promise<SchoolServiceTermRecord> {
  requireManage(auth);
  const source = await loadTerm(client, auth.tenantId, sourceTermId);
  if (!source) throw new ApiError(404, "Source service term not found");
  const label = newPeriodLabel.trim();
  if (!label) throw new ApiError(400, "A new period label is required.");
  if (label === source.period_label) throw new ApiError(400, "The new period must differ from the source period.");
  const existing = await client.query(
    `SELECT 1 FROM school_service_term WHERE tenant_id = $1 AND organization_id = $2 AND period_type = $3 AND period_label = $4`,
    [auth.tenantId, source.organization_id, source.period_type, label]
  );
  if (existing.rowCount) throw new ApiError(409, `A ${source.period_type} term '${label}' already exists.`);
  const inheritedKeys = Object.keys(source.service_config ?? {});
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO school_service_term
       (tenant_id, organization_id, period_type, period_label, internal_owner_user_id, service_config, source, status,
        confirmation_state, copied_from_term_id, inherited_field_keys, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,'rollover','draft','unconfirmed',$7,$8::text[],$9,$9) RETURNING id::text`,
    [
      auth.tenantId,
      source.organization_id,
      source.period_type,
      label,
      source.internal_owner_user_id,
      JSON.stringify(source.service_config ?? {}),
      sourceTermId,
      inheritedKeys,
      auth.id
    ]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school_service_term.rolled_over",
    entityType: "school_service_term",
    entityId: rows[0].id,
    metadata: { copied_from_term_id: sourceTermId, period_label: label, inherited_field_keys: inheritedKeys }
  });
  return (await loadTerm(client, auth.tenantId, rows[0].id))!;
}

export type UpdateSchoolServiceTermInput = {
  start_date?: string | null;
  end_date?: string | null;
  internal_owner_user_id?: string | null;
  service_config?: Record<string, unknown>;
  notes?: string | null;
  // Setting confirm=true marks the term confirmed (inherited values reviewed).
  confirm?: boolean;
};

export async function updateSchoolServiceTerm(
  client: PoolClient,
  auth: AuthUser,
  termId: string,
  patch: UpdateSchoolServiceTermInput
): Promise<SchoolServiceTermRecord> {
  requireManage(auth);
  const term = await loadTerm(client, auth.tenantId, termId);
  if (!term) throw new ApiError(404, "Service term not found");
  const serviceConfig = patch.service_config !== undefined ? patch.service_config : term.service_config;
  const confirm = patch.confirm === true;
  await client.query(
    `UPDATE school_service_term SET
        start_date = $3,
        end_date = $4,
        internal_owner_user_id = $5,
        service_config = $6::jsonb,
        notes = $7,
        confirmation_state = CASE WHEN $8 THEN 'confirmed' ELSE confirmation_state END,
        confirmed_by_user_id = CASE WHEN $8 THEN $9 ELSE confirmed_by_user_id END,
        confirmed_at = CASE WHEN $8 THEN now() ELSE confirmed_at END,
        updated_by_user_id = $9,
        updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
    [
      auth.tenantId,
      termId,
      patch.start_date !== undefined ? patch.start_date : term.start_date,
      patch.end_date !== undefined ? patch.end_date : term.end_date,
      patch.internal_owner_user_id !== undefined ? patch.internal_owner_user_id : term.internal_owner_user_id,
      JSON.stringify(serviceConfig ?? {}),
      patch.notes !== undefined ? patch.notes : term.notes,
      confirm,
      auth.id
    ]
  );
  return (await loadTerm(client, auth.tenantId, termId))!;
}
