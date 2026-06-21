import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canManageCanonicalDirectoryRecords } from "../authz/authority.js";
import { createAuditLog } from "./audit.js";

// ── Organization brand / website / logo history (Phase 4, Slice 3) ───────────
// Canonical brand truth in real columns (not the notes blob): brand colors, mascot,
// explicit brand/logo state values, a normalized website, and an append-only logo
// history with restore. Additive; safe; audited. See migration 162.

const UNSAFE_PROTOCOLS = /^\s*(javascript|data|file|vbscript|about):/i;
const BRAND_STATES = new Set(["known", "unknown", "not_available", "not_applicable"]);
const LOGO_STATES = new Set(["current", "outdated", "pending_review", "unavailable"]);

function requireManage(auth: AuthUser) {
  if (!canManageCanonicalDirectoryRecords(auth)) {
    throw new ApiError(403, "Managing organization brand requires directory management access.");
  }
}

// One server-side website normalizer: accepts example.org / www.example.org /
// https://example.org, adds https:// when no scheme, lowercases the host, drops a
// trailing slash, and REJECTS unsafe protocols. Returns a canonical safe URL or null.
export function normalizeWebsite(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (UNSAFE_PROTOCOLS.test(raw)) throw new ApiError(400, "That website protocol is not allowed.");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ApiError(400, "Enter a valid website.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError(400, "That website protocol is not allowed.");
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}

export type OrganizationBrandPatch = {
  brand_primary_color?: string | null;
  brand_secondary_color?: string | null;
  mascot?: string | null;
  brand_status?: string | null;
  website?: string | null;
  logo_url?: string | null;
  logo_status?: string | null;
  logo_note?: string | null;
  logo_source?: string | null;
};

async function recordLogoChange(client: PoolClient, auth: AuthUser, organizationId: string, logoUrl: string | null, status: string, source: string, note: string | null) {
  // clock_timestamp() (not now()) so multiple logo changes in one transaction still order
  // deterministically by created_at.
  await client.query(
    `INSERT INTO organization_logo_history (tenant_id, organization_id, logo_url, source, status, note, set_by_user_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, clock_timestamp())`,
    [auth.tenantId, organizationId, logoUrl, source, status, note, auth.id]
  );
}

export async function updateOrganizationBrand(client: PoolClient, auth: AuthUser, organizationId: string, patch: OrganizationBrandPatch) {
  requireManage(auth);
  const current = (
    await client.query<{ logo_url: string | null; brand_status: string | null }>(
      `SELECT logo_url, brand_status FROM organization WHERE tenant_id=$1 AND id=$2`,
      [auth.tenantId, organizationId]
    )
  ).rows[0];
  if (!current) throw new ApiError(404, "Organization not found");

  if (patch.brand_status != null && !BRAND_STATES.has(patch.brand_status)) throw new ApiError(400, "Invalid brand status.");
  if (patch.logo_status != null && !LOGO_STATES.has(patch.logo_status)) throw new ApiError(400, "Invalid logo status.");
  const normalizedWebsite = patch.website !== undefined ? normalizeWebsite(patch.website) : undefined;

  await client.query(
    `UPDATE organization SET
        brand_primary_color = COALESCE($3, brand_primary_color),
        brand_secondary_color = COALESCE($4, brand_secondary_color),
        mascot = COALESCE($5, mascot),
        brand_status = COALESCE($6, brand_status),
        website = CASE WHEN $7::boolean THEN $8 ELSE website END,
        normalized_website = CASE WHEN $7::boolean THEN $8 ELSE normalized_website END,
        logo_url = CASE WHEN $9::boolean THEN $10 ELSE logo_url END,
        logo_status = COALESCE($11, logo_status),
        updated_by_user_id = $12,
        updated_at = now()
       WHERE tenant_id=$1 AND id=$2`,
    [
      auth.tenantId,
      organizationId,
      patch.brand_primary_color ?? null,
      patch.brand_secondary_color ?? null,
      patch.mascot ?? null,
      patch.brand_status ?? null,
      normalizedWebsite !== undefined,
      normalizedWebsite ?? null,
      patch.logo_url !== undefined,
      patch.logo_url ?? null,
      patch.logo_status ?? null,
      auth.id
    ]
  );

  // Record a logo-history entry only when the logo actually changes.
  if (patch.logo_url !== undefined && (patch.logo_url ?? null) !== (current.logo_url ?? null)) {
    await recordLogoChange(client, auth, organizationId, patch.logo_url ?? null, patch.logo_status ?? "current", patch.logo_source ?? "manual", patch.logo_note ?? null);
  }
  await createAuditLog(client, { tenantId: auth.tenantId, actorUserId: auth.id, action: "organization.brand_updated", entityType: "organization", entityId: organizationId, metadata: { brand_status: patch.brand_status ?? null, logo_changed: patch.logo_url !== undefined } });
  return getLogoHistory(client, auth, organizationId);
}

export async function getLogoHistory(client: PoolClient, auth: AuthUser, organizationId: string) {
  // LEFT JOIN app_user so the UI can show WHO set each logo (actor name), not a raw id.
  const { rows } = await client.query(
    `SELECT h.id::text, h.logo_url, h.source, h.status, h.note, h.set_by_user_id::text, u.full_name AS set_by_user_name, h.created_at::text
       FROM organization_logo_history h
       LEFT JOIN app_user u ON u.id = h.set_by_user_id
       WHERE h.tenant_id=$1 AND h.organization_id=$2 ORDER BY h.created_at DESC LIMIT 100`,
    [auth.tenantId, organizationId]
  );
  return { logo_history: rows };
}

// Restore a prior logo from history as the current one (records a new history entry).
export async function restoreOrganizationLogo(client: PoolClient, auth: AuthUser, organizationId: string, historyId: string) {
  requireManage(auth);
  const entry = (
    await client.query<{ logo_url: string | null }>(
      `SELECT logo_url FROM organization_logo_history WHERE tenant_id=$1 AND organization_id=$2 AND id=$3`,
      [auth.tenantId, organizationId, historyId]
    )
  ).rows[0];
  if (!entry) throw new ApiError(404, "Logo history entry not found");
  await client.query(`UPDATE organization SET logo_url=$3, logo_status='current', updated_by_user_id=$4, updated_at=now() WHERE tenant_id=$1 AND id=$2`, [auth.tenantId, organizationId, entry.logo_url, auth.id]);
  await recordLogoChange(client, auth, organizationId, entry.logo_url, "current", "restore", `Restored from history ${historyId}`);
  return getLogoHistory(client, auth, organizationId);
}

// Dry-run parser: which structured brand/contact values are deterministically extractable
// from the legacy organization.notes block. Never writes; never strips notes.
export function parseLegacyBrandFromNotes(notes: string | null): {
  website: string | null;
  main_phone: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  mascot: string | null;
  logo_status: string | null;
} {
  const grab = (label: string): string | null => {
    if (!notes) return null;
    const m = notes.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]+)`, "i"));
    const v = m?.[1]?.trim();
    return v && v.length ? v : null;
  };
  return {
    website: grab("Website"),
    main_phone: grab("Main Phone"),
    primary_color: grab("Primary Color"),
    secondary_color: grab("Secondary Color"),
    mascot: grab("Mascot"),
    logo_status: grab("Logo Status")
  };
}
