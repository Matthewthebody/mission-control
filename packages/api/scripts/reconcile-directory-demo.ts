import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import { reconcileDirectoryBatch, type DirectoryReconciliationBatchReport } from "../src/services/directoryReconciliationBatch.js";
import type { AuthUser } from "../src/types/auth.js";

// Phase 4 Slice E — Demo Studio directory reconciliation.
// Runs the combined dry-run by default and writes deterministic JSON + Markdown artifacts
// to docs/artifacts/. Pass --apply to apply the deterministic, additive, reversible domains
// (districts links + contact identities); brand/notes always stay Review Required.
//
//   npm --workspace packages/api run -s reconcile:directory-demo            (dry-run)
//   npm --workspace packages/api run -s reconcile:directory-demo -- --apply (apply)
//
// Admin context defaults to the seeded demo admin (schools-office@example.com); override
// with --email=<address>. Apply is reversible via the artifact's rollback block.

function flag(name: string): boolean {
  return process.argv.includes(name);
}
function arg(name: string, fallback: string): string {
  const hit = process.argv.find((value) => value.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

const ARTIFACT_DIR = fileURLToPath(new URL("../../../docs/artifacts/", import.meta.url));

function markdownReport(report: DirectoryReconciliationBatchReport, adminEmail: string, stampedAt: string): string {
  const d = report.districts;
  const c = report.contacts;
  const b = report.brand_notes;
  const lines = [
    `# Phase 4 — Directory Reconciliation Batch (${report.dry_run ? "Dry Run" : "Applied"})`,
    "",
    `- **Tenant:** \`${report.tenant_id}\``,
    `- **Admin context:** ${adminEmail}`,
    `- **Generated:** ${stampedAt}`,
    `- **Mode:** ${report.dry_run ? "dry-run (nothing written)" : "applied"}`,
    `- **Batch id:** ${report.batch_id ?? "(dry-run — no batch)"}`,
    "",
    "## Districts (link Schools to canonical Districts on exact name match)",
    "",
    `- Considered: **${d.total_considered}**`,
    `- already_canonical: ${d.by_class.already_canonical}`,
    `- exact_match: ${d.by_class.exact_match}`,
    `- multiple_candidates (Review Required): ${d.by_class.multiple_candidates}`,
    `- no_candidate (Review Required): ${d.by_class.no_candidate}`,
    `- conflicting_parent (Review Required): ${d.by_class.conflicting_parent}`,
    `- **Applied links:** ${d.applied}`,
    "",
    "## Contacts (one-to-one canonical identity backfill — never merges)",
    "",
    `- Total unlinked org-bound contacts: **${c.total_unlinked}**`,
    `- one_to_one (eligible): ${c.one_to_one}`,
    `- invalid_no_identity (Review Required): ${c.invalid_no_identity}`,
    `- possible_duplicate (own identity, not merged): ${c.possible_duplicate}`,
    `- **Applied identities:** ${c.applied}`,
    "",
    "## Brand / notes (legacy brand still packed in notes)",
    "",
    `- Review Required candidates: **${b.review_required}** (reported only — never auto-applied)`,
    "",
    "## Reversal",
    "",
    `- Districts applied links: ${report.rollback.districts_applied_links.length}`,
    `- Contacts backfill batch id: ${report.rollback.contacts_backfill_batch_id ?? "(none)"}`,
    "",
    `> ${report.rollback.instructions}`,
    ""
  ];
  return lines.join("\n");
}

async function main() {
  const apply = flag("--apply");
  const adminEmail = arg("--email", "schools-office@example.com");

  const admin = (await pool.query<{ id: string; tenant_id: string }>(`SELECT id::text, tenant_id::text FROM app_user WHERE email = $1 LIMIT 1`, [adminEmail])).rows[0];
  if (!admin) {
    throw new Error(`No app_user found for ${adminEmail}; pass --email=<seeded admin address>.`);
  }
  const auth: AuthUser = { authorityTier: "leadership", tenantId: admin.tenant_id, id: admin.id } as AuthUser;

  const report = await withClientTransaction(admin.tenant_id, admin.id, (client) => reconcileDirectoryBatch(client, auth, { dryRun: !apply }));

  // A stable timestamp for the artifact body (the file names stay deterministic so the
  // dry-run artifact is diff-friendly; applied artifacts are keyed by their batch id).
  const stampedAt = new Date().toISOString();
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const slug = apply ? `applied-${report.batch_id}` : "dry-run";
  const jsonPath = `${ARTIFACT_DIR}phase4-directory-reconciliation-${slug}.json`;
  const mdPath = `${ARTIFACT_DIR}phase4-directory-reconciliation-${slug}.md`;
  await writeFile(jsonPath, `${JSON.stringify({ stamped_at: stampedAt, admin_email: adminEmail, ...report }, null, 2)}\n`, "utf8");
  await writeFile(mdPath, markdownReport(report, adminEmail, stampedAt), "utf8");

  process.stdout.write(
    [
      `Directory reconciliation ${apply ? "APPLIED" : "dry-run"} for tenant ${admin.tenant_id}`,
      `  districts: considered=${report.districts.total_considered} exact_match=${report.districts.by_class.exact_match} applied=${report.districts.applied}`,
      `  contacts:  unlinked=${report.contacts.total_unlinked} one_to_one=${report.contacts.one_to_one} applied=${report.contacts.applied}`,
      `  brand/notes review_required=${report.brand_notes.review_required}`,
      `  batch_id=${report.batch_id ?? "(dry-run)"}`,
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
