import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import { planMondayImport, type MigrationPlan, type MondayBoardExport, type MondayMappingConfig } from "../src/services/mondayMigration.js";
import type { AuthUser } from "../src/types/auth.js";

// Phase 5 Part F — Monday migration dry-run PILOT.
// Runs the import planner against sanitized sample fixtures for representative boards
// (All Schools, Initial Process, Code Return) and writes deterministic JSON + Markdown +
// conflict-CSV artifacts. PLAN ONLY — no import, no entity writes, no side effects. Real
// board exports are absent (see the Missing Source Data report); replace the fixtures with
// docs/artifacts/monday/<board>.json when an export is available.
//
//   npm --workspace packages/api run -s monday:migration-pilot

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((value) => value.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

const FIXTURE_DIR = fileURLToPath(new URL("../tests/fixtures/monday/", import.meta.url));
const ARTIFACT_DIR = fileURLToPath(new URL("../../../docs/artifacts/monday/", import.meta.url));
const PILOT_FILES = ["all-schools.sample.json", "initial-process.sample.json", "code-return.sample.json"];

type Fixture = { board: MondayBoardExport; mapping: MondayMappingConfig };

function planMarkdown(plan: MigrationPlan, sourceFile: string): string {
  const c = plan.counts;
  const lines = [
    `# Phase 5 — Monday Migration Dry Run: ${plan.board_name}`,
    "",
    `- **Source:** \`${sourceFile}\` (SANITIZED SAMPLE — not real Monday data)`,
    `- **Provider/board:** monday / \`${plan.board_id}\` (workspace: ${plan.workspace ?? "—"})`,
    `- **Target entity:** ${plan.target_entity}`,
    `- **Mode:** dry-run · side effects suppressed: ${plan.side_effects_suppressed}`,
    "",
    "## Counts",
    "",
    `- total items: **${plan.total_items}**`,
    `- create: ${c.create} · update: ${c.update} · skip: ${c.skip} · conflict: ${c.conflict} · review_required: ${c.review_required}`,
    `- unsupported columns (formula/mirror/dependency — never invented): ${plan.unsupported_column_ids.join(", ") || "none"}`,
    "",
    "## Rows",
    "",
    "| item_id | classification | dedupe_key | missing_required | unsupported | name |",
    "|---|---|---|---|---|---|",
    ...plan.rows.map(
      (r) => `| ${r.item_id} | ${r.classification} | ${r.dedupe_key} | ${r.missing_required.join(",") || "—"} | ${r.unsupported_columns.join(",") || "—"} | ${r.item_name || "(blank)"} |`
    ),
    "",
    "> Candidate matching is by Monday item id / external_object_map only — never fuzzy names.",
    "> No entity was written and no notification / email / reminder / escalation / workflow side effect fired.",
    ""
  ];
  return lines.join("\n");
}

function conflictCsv(plans: MigrationPlan[]): string {
  const header = "board_id,item_id,classification,reason,dedupe_key";
  const lines = plans.flatMap((p) =>
    p.rows
      .filter((r) => r.classification === "conflict" || r.classification === "review_required")
      .map((r) => [p.board_id, r.item_id, r.classification, JSON.stringify(r.conflict_reason ?? r.missing_required.join(";")), r.dedupe_key].join(","))
  );
  return [header, ...lines].join("\n");
}

async function main() {
  const adminEmail = arg("--email", "schools-office@example.com");
  const admin = (await pool.query<{ id: string; tenant_id: string }>(`SELECT id::text, tenant_id::text FROM app_user WHERE email = $1 LIMIT 1`, [adminEmail])).rows[0];
  if (!admin) throw new Error(`No app_user found for ${adminEmail}.`);
  const auth: AuthUser = { authorityTier: "leadership", tenantId: admin.tenant_id, id: admin.id } as AuthUser;

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const stampedAt = new Date().toISOString();
  const plans: MigrationPlan[] = [];

  for (const file of PILOT_FILES) {
    const fixture = JSON.parse(await readFile(`${FIXTURE_DIR}${file}`, "utf8")) as Fixture;
    // The planner only READS external_object_map (idempotency); run twice to prove determinism.
    const plan1 = await withClientTransaction(admin.tenant_id, admin.id, (client) => planMondayImport(client, auth, fixture.board, fixture.mapping));
    const plan2 = await withClientTransaction(admin.tenant_id, admin.id, (client) => planMondayImport(client, auth, fixture.board, fixture.mapping));
    const deterministic = JSON.stringify(plan1.counts) === JSON.stringify(plan2.counts) && JSON.stringify(plan1.rows) === JSON.stringify(plan2.rows);
    plans.push(plan1);

    const slug = fixture.board.board_id;
    await writeFile(`${ARTIFACT_DIR}${slug}.dry-run.json`, `${JSON.stringify({ stamped_at: stampedAt, source_file: file, deterministic, ...plan1 }, null, 2)}\n`, "utf8");
    await writeFile(`${ARTIFACT_DIR}${slug}.dry-run.md`, planMarkdown(plan1, file), "utf8");
    process.stdout.write(`  ${fixture.board.board_name}: create=${plan1.counts.create} update=${plan1.counts.update} skip=${plan1.counts.skip} conflict=${plan1.counts.conflict} review=${plan1.counts.review_required} deterministic=${deterministic}\n`);
  }

  await writeFile(`${ARTIFACT_DIR}conflicts-and-review.csv`, conflictCsv(plans), "utf8");

  const missing = [
    "# Phase 5 — Missing Source Data",
    "",
    `Generated: ${stampedAt}`,
    "",
    "The pilot ran against SANITIZED SAMPLE fixtures because no real Monday board export exists in the repo.",
    "To run a real dry run, provide the following under docs/artifacts/monday/ and re-point the pilot:",
    "",
    "1. A board-list export (workspace, board_id, board_name, owner, department, lifecycle) for all boards (~76).",
    "2. Per pilot board: a structure export (groups + columns with ids/types) and a representative, sanitized item export (column values, subitems, updates, attachment references).",
    "3. Board-level automations / integrations to confirm the side-effect scope to suppress.",
    "",
    "Until provided, no production rows are invented and no import is possible.",
    ""
  ].join("\n");
  await writeFile(`${ARTIFACT_DIR}MISSING-SOURCE-DATA.md`, missing, "utf8");

  process.stdout.write(`Monday migration pilot (dry-run) complete. Artifacts in ${ARTIFACT_DIR}\n`);
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    await pool.end().catch(() => undefined);
  });
