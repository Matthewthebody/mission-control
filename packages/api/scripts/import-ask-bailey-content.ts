import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  contentManifestSchema,
  importManifestEntry,
  planContentImport,
  validateContentManifest
} from "../src/services/knowledge/contentManifest.js";

// Ask Bailey H8 — real-content manifest import tool.
//
//   npx tsx scripts/import-ask-bailey-content.ts <manifest.json> [--allow-import] [--auto-approve]
//
// Without --allow-import it only VALIDATES and prints the plan (dry run).
// Import creates governed sources through the same reviewed workflow; it never
// fabricates content — entries without real content are reported, not invented.

async function run() {
  const [, , manifestPath, ...flags] = process.argv;
  if (!manifestPath) {
    console.error("Usage: import-ask-bailey-content <manifest.json> [--allow-import] [--auto-approve]");
    process.exit(1);
  }
  const allowImport = flags.includes("--allow-import");
  const autoApprove = flags.includes("--auto-approve");

  const raw = JSON.parse(await readFile(resolve(process.cwd(), manifestPath), "utf8"));
  const validation = validateContentManifest(raw);
  console.log("Manifest validation:", JSON.stringify(validation, null, 2));
  if (!validation.valid) {
    console.error("Manifest is structurally invalid. Fix schema errors before importing.");
    process.exit(1);
  }

  const manifest = contentManifestSchema.parse(raw);
  const plan = planContentImport(manifest);
  console.log("Import plan:", JSON.stringify(plan, null, 2));
  if (validation.missing_content.length) {
    console.warn(
      `LAUNCH BLOCKER: ${validation.missing_content.length} manifest entrie(s) have no real content and will be skipped: ${validation.missing_content.join(", ")}`
    );
  }

  if (!allowImport) {
    console.log("Dry run complete. Re-run with --allow-import to create sources.");
    await pool.end();
    return;
  }

  // Owner identity: first entry owner_email, else fall back to a required admin.
  const ownerEmail = manifest.entries.find((e) => e.owner_email)?.owner_email;
  if (!ownerEmail) {
    console.error("At least one entry must specify owner_email to attribute the import.");
    process.exit(1);
  }
  const owner = await pool.query<{ id: string; tenant_id: string }>(
    `SELECT id::text, tenant_id::text FROM app_user WHERE lower(email) = lower($1) LIMIT 1`,
    [ownerEmail]
  );
  if (!owner.rows[0]) {
    console.error(`Owner ${ownerEmail} not found.`);
    process.exit(1);
  }
  const auth = {
    id: owner.rows[0].id,
    tenantId: owner.rows[0].tenant_id,
    authorityTier: "leadership",
    roles: ["leadership"],
    department: "operations",
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: [],
    status: "active"
  } as unknown as AuthUser;

  for (const entry of manifest.entries) {
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      importManifestEntry(client, auth, manifest, entry, { autoApprove })
    );
    console.log("Imported:", JSON.stringify(result));
  }
  await pool.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
