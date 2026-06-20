import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { canManageCanonicalDirectoryRecords } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import { createAuditLog } from "./audit.js";
import { reconcileDistricts, type DistrictReconciliationReport } from "./directoryReconciliation.js";
import { backfillContactIdentities, type ContactBackfillReport } from "./canonicalContacts.js";
import { parseLegacyBrandFromNotes } from "./organizationBrand.js";

// ── Directory reconciliation batch (Phase 4, Slice 5/E) ──────────────────────
// One orchestrated, tenant-scoped, dry-run-by-default pass over the legacy Directory:
// districts (link Schools to canonical Districts on exact match), contacts (one-to-one
// canonical identity backfill), and brand/notes (legacy brand still packed in notes).
//
// Apply runs ONLY the surgical, deterministic, reversible districts domain (link a School
// to its canonical District on an exact normalized-name match, parentless only). Contact
// identity backfill and brand/notes are REPORTED here but never applied by the batch:
// backfill is a bulk create (one new identity per unlinked contact) better run as its own
// explicit, separately-gated step (POST /contact-identities/backfill), and brand/notes
// parsing is ambiguous (Review Required). The batch NEVER hard-deletes and NEVER
// fuzzy-merges; everything it applies is reversible via the report's rollback block.

export type BrandNotesCandidate = {
  organization_id: string;
  display_name: string;
  parsed: {
    website: string | null;
    main_phone: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    mascot: string | null;
    logo_status: string | null;
  };
};

export type DirectoryReconciliationBatchReport = {
  dry_run: boolean;
  batch_id: string | null;
  tenant_id: string;
  districts: DistrictReconciliationReport;
  contacts: ContactBackfillReport;
  brand_notes: {
    considered: number;
    review_required: number;
    candidates: BrandNotesCandidate[];
  };
  applied: { districts: number; contacts: number; brand_notes: number };
  rollback: {
    districts_applied_links: Array<{ organization_id: string; district_id: string }>;
    contacts_backfill_batch_id: string | null;
    instructions: string;
  };
};

function requireManage(auth: AuthUser) {
  if (!canManageCanonicalDirectoryRecords(auth)) {
    throw new ApiError(403, "Directory reconciliation requires directory management access.");
  }
}

// Brand/notes dry-run: legacy organizations whose notes still parse to brand/website
// tokens while the canonical brand/website columns are empty (Review Required candidates).
async function classifyBrandNotes(client: PoolClient, tenantId: string): Promise<BrandNotesCandidate[]> {
  const { rows } = await client.query<{ organization_id: string; display_name: string; notes: string | null }>(
    `SELECT id::text AS organization_id, display_name, notes
       FROM organization
       WHERE tenant_id = $1
         AND COALESCE(trim(notes), '') <> ''
         AND brand_primary_color IS NULL
         AND brand_secondary_color IS NULL
         AND mascot IS NULL
         AND normalized_website IS NULL`,
    [tenantId]
  );
  const candidates: BrandNotesCandidate[] = [];
  for (const row of rows) {
    const parsed = parseLegacyBrandFromNotes(row.notes);
    const hasSignal = Boolean(parsed.primary_color || parsed.secondary_color || parsed.mascot || parsed.website || parsed.logo_status);
    if (hasSignal) {
      candidates.push({ organization_id: row.organization_id, display_name: row.display_name, parsed });
    }
  }
  return candidates;
}

export async function reconcileDirectoryBatch(
  client: PoolClient,
  auth: AuthUser,
  options: { dryRun?: boolean } = {}
): Promise<DirectoryReconciliationBatchReport> {
  const dryRun = options.dryRun !== false;
  if (!dryRun) requireManage(auth);

  // Districts honor the requested mode (surgical exact-match links). Contacts + brand/notes
  // are always reported in dry-run only — the batch never bulk-creates identities or writes
  // parsed brand; those stay explicit, separately-gated decisions.
  const districts = await reconcileDistricts(client, auth, { dryRun });
  const contacts = await backfillContactIdentities(client, auth, { dryRun: true });
  const brandCandidates = await classifyBrandNotes(client, auth.tenantId);

  const batchId = dryRun ? null : (await client.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`)).rows[0].id;

  const report: DirectoryReconciliationBatchReport = {
    dry_run: dryRun,
    batch_id: batchId,
    tenant_id: auth.tenantId,
    districts,
    contacts,
    brand_notes: {
      considered: brandCandidates.length,
      review_required: brandCandidates.length,
      candidates: brandCandidates
    },
    applied: { districts: districts.applied, contacts: 0, brand_notes: 0 },
    rollback: {
      districts_applied_links: districts.applied_links,
      contacts_backfill_batch_id: null,
      instructions:
        "Reverse districts: UPDATE organization SET parent_organization_id = NULL for each rollback.districts_applied_links row. " +
        "Contacts and brand/notes are reported only by this batch (never applied), so there is nothing to reverse there — " +
        "run POST /contact-identities/backfill explicitly to apply the one-to-one identity backfill."
    }
  };

  if (!dryRun) {
    await createAuditLog(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      action: "directory.reconciliation_batch_applied",
      entityType: "organization",
      entityId: batchId!,
      metadata: { applied: report.applied, batch_id: batchId, contacts_backfill_batch_id: contacts.batch_id }
    });
  }
  return report;
}
