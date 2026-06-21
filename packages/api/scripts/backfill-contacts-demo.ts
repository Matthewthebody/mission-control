import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import { backfillContactIdentities, type ContactBackfillReport } from "../src/services/canonicalContacts.js";
import type { AuthUser } from "../src/types/auth.js";

// Phase 4.1 Part C — Demo Studio reusable-Contact identity backfill.
// Fresh CONTACT-ONLY dry run by default; --apply applies ONLY the safe one-to-one rows
// (unique normalized name+email), leaving possible duplicates + identity-less rows as
// Review Required. NEVER merges names or shared emails; preserves every org relationship;
// hard-deletes nothing. Reversible via the artifact's batch id (rollbackContactIdentityBackfill).
//
//   npm --workspace packages/api run -s backfill:contacts-demo            (dry-run)
//   npm --workspace packages/api run -s backfill:contacts-demo -- --apply (apply, safe-only)

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function arg(name: string, fallback: string): string {
  const hit = process.argv.find((value) => value.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

const ARTIFACT_DIR = fileURLToPath(new URL("../../../docs/artifacts/", import.meta.url));

async function linkedCounts(tenantId: string): Promise<{ total: number; linked: number; unlinked: number; identities: number }> {
  const r = (
    await pool.query<{ total: string; linked: string; unlinked: string; identities: string }>(
      `SELECT
         (SELECT count(*) FROM organization_contact WHERE tenant_id=$1) AS total,
         (SELECT count(*) FROM organization_contact WHERE tenant_id=$1 AND contact_id IS NOT NULL) AS linked,
         (SELECT count(*) FROM organization_contact WHERE tenant_id=$1 AND contact_id IS NULL) AS unlinked,
         (SELECT count(*) FROM contact WHERE tenant_id=$1) AS identities`,
      [tenantId]
    )
  ).rows[0];
  return { total: Number(r.total), linked: Number(r.linked), unlinked: Number(r.unlinked), identities: Number(r.identities) };
}

function byClass(report: ContactBackfillReport) {
  const counts: Record<string, number> = { safe_one_to_one: 0, possible_duplicate: 0, invalid_no_identity: 0 };
  for (const d of report.details) counts[d.classification] += 1;
  return counts;
}

function markdown(report: ContactBackfillReport, before: any, after: any, adminEmail: string, stampedAt: string): string {
  const c = byClass(report);
  const lines = [
    `# Phase 4.1 — Demo Contact Identity Backfill (${report.dry_run ? "Dry Run" : "Applied, safe-only"})`,
    "",
    `- **Admin context:** ${adminEmail}`,
    `- **Generated:** ${stampedAt}`,
    `- **Mode:** ${report.dry_run ? "dry-run (nothing written)" : "applied (safe one-to-one only)"}`,
    `- **safe_only:** ${report.safe_only}`,
    `- **Batch id:** ${report.batch_id ?? "(dry-run — no batch)"}`,
    "",
    "## Classification",
    "",
    `- Total unlinked org-bound contacts considered: **${report.total_unlinked}**`,
    `- safe_one_to_one (applied when --apply): **${c.safe_one_to_one}**`,
    `- possible_duplicate (Review Required — never merged, not applied in safe-only): **${c.possible_duplicate}**`,
    `- invalid_no_identity (Review Required — no name and no email): **${c.invalid_no_identity}**`,
    `- **Applied this run:** ${report.applied}`,
    "",
    "## Before / after (organization_contact link coverage)",
    "",
    "| Metric | Before | After |",
    "|---|---|---|",
    `| org-bound contacts | ${before.total} | ${after.total} |`,
    `| linked (contact_id set) | ${before.linked} | ${after.linked} |`,
    `| unlinked | ${before.unlinked} | ${after.unlinked} |`,
    `| canonical identities | ${before.identities} | ${after.identities} |`,
    "",
    "## Reversal",
    "",
    report.batch_id
      ? `This batch is reversible: \`rollbackContactIdentityBackfill(client, auth, "${report.batch_id}")\` nulls the org-bound links it set and deletes ONLY the identities it created (source = 'backfill:${report.batch_id}'). No org-bound contact and no other-source identity is touched; nothing is hard-deleted beyond this batch's own identities.`
      : "Dry run — nothing to reverse.",
    "",
    "> Names are never merged. Shared emails are never merged (each relationship gets its own identity). Possible duplicates and identity-less rows are left as Review Required.",
    ""
  ];
  return lines.join("\n");
}

async function main() {
  const apply = flag("--apply");
  const adminEmail = arg("--email", "schools-office@example.com");
  const admin = (await pool.query<{ id: string; tenant_id: string }>(`SELECT id::text, tenant_id::text FROM app_user WHERE email = $1 LIMIT 1`, [adminEmail])).rows[0];
  if (!admin) throw new Error(`No app_user found for ${adminEmail}.`);
  const auth: AuthUser = { authorityTier: "leadership", tenantId: admin.tenant_id, id: admin.id } as AuthUser;

  const before = await linkedCounts(admin.tenant_id);
  const report = await withClientTransaction(admin.tenant_id, admin.id, (client) => backfillContactIdentities(client, auth, { dryRun: !apply, safeOnly: true }));
  const after = apply ? await linkedCounts(admin.tenant_id) : before;

  const stampedAt = new Date().toISOString();
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const slug = apply ? `applied-${report.batch_id}` : "dry-run";
  const jsonPath = `${ARTIFACT_DIR}phase4-1-contact-identity-backfill-${slug}.json`;
  const mdPath = `${ARTIFACT_DIR}phase4-1-contact-identity-backfill-${slug}.md`;
  await writeFile(jsonPath, `${JSON.stringify({ stamped_at: stampedAt, admin_email: adminEmail, before, after, ...report }, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdown(report, before, after, adminEmail, stampedAt), "utf8");

  const c = byClass(report);
  process.stdout.write(
    [
      `Contact identity backfill ${apply ? "APPLIED (safe-only)" : "dry-run"} for tenant ${admin.tenant_id}`,
      `  total_unlinked=${report.total_unlinked} safe_one_to_one=${c.safe_one_to_one} possible_duplicate=${c.possible_duplicate} invalid=${c.invalid_no_identity}`,
      `  applied=${report.applied} batch_id=${report.batch_id ?? "(dry-run)"}`,
      `  link coverage: before linked=${before.linked}/${before.total} → after linked=${after.linked}/${after.total}`,
      `  artifacts: ${jsonPath}`,
      `             ${mdPath}`,
      ""
    ].join("\n")
  );
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    await pool.end().catch(() => undefined);
  });
