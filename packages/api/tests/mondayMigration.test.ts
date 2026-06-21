import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";
import { planMondayImport, type MondayBoardExport, type MondayMappingConfig } from "../src/services/mondayMigration.js";

// Phase 5 Part F — the Monday migration framework is a dry-run, idempotent,
// side-effect-suppressed PLANNER. It writes nothing and matches by item id only.

const app = createApp();
let tenantId = "";
let adminUserId = "";
const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/monday/", import.meta.url));

async function loadFixture(name: string): Promise<{ board: MondayBoardExport; mapping: MondayMappingConfig }> {
  return JSON.parse(await readFile(`${FIXTURE_DIR}${name}`, "utf8"));
}
const auth = () => ({ authorityTier: "leadership", tenantId, id: adminUserId } as any);

beforeAll(async () => {
  const token = (await devLogin(app, "schools-office@example.com")).body.token;
  tenantId = (await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body.user.tenantId;
  adminUserId = (await pool.query(`SELECT id::text FROM app_user WHERE email='schools-office@example.com'`)).rows[0].id;
});
afterAll(async () => undefined);

describe("Phase 5 — Monday migration framework (dry-run planner)", () => {
  it("classifies create / review_required and flags unsupported columns; preserves source ids", async () => {
    const { board, mapping } = await loadFixture("all-schools.sample.json");
    const client = await pool.connect();
    try {
      const plan = await planMondayImport(client as any, auth(), board, mapping);
      expect(plan.dry_run).toBe(true);
      expect(plan.side_effects_suppressed).toBe(true);
      expect(plan.counts.create).toBe(2); // the two named schools
      expect(plan.counts.review_required).toBe(1); // the blank-name row (missing required canonical_name)
      expect(plan.unsupported_column_ids).toContain("formula_health"); // formula column never invented
      // source ids preserved on every row
      const row = plan.rows.find((r) => r.item_id === "sch_1001")!;
      expect(row.source_ids.board_id).toBe("sample_all_schools");
      expect(row.source_ids.item_id).toBe("sch_1001");
      expect(row.dedupe_key).toBe("monday:organization:sch_1001");
      expect(row.mapped_fields.canonical_name).toBe("Sample Maple High School"); // name column resolved from item.name
    } finally {
      client.release();
    }
  });

  it("is deterministic / idempotent on re-run and writes nothing (side-effect suppressed)", async () => {
    const { board, mapping } = await loadFixture("initial-process.sample.json");
    const client = await pool.connect();
    try {
      const before = (await client.query(`SELECT count(*)::int n FROM external_object_map WHERE tenant_id=$1 AND provider='monday'`, [tenantId])).rows[0].n;
      const plan1 = await planMondayImport(client as any, auth(), board, mapping);
      const plan2 = await planMondayImport(client as any, auth(), board, mapping);
      const after = (await client.query(`SELECT count(*)::int n FROM external_object_map WHERE tenant_id=$1 AND provider='monday'`, [tenantId])).rows[0].n;
      expect(after).toBe(before); // the planner never writes
      expect(JSON.stringify(plan1.rows)).toBe(JSON.stringify(plan2.rows)); // deterministic
    } finally {
      client.release();
    }
  });

  it("matches by external item id (never fuzzy name): an existing map → update, a different object_type → conflict (rolled back)", async () => {
    const { board, mapping } = await loadFixture("all-schools.sample.json");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // seed an external_object_map for sch_1001 → an organization, last synced in the past
      const orgId = (await client.query(`INSERT INTO organization (tenant_id, canonical_name, normalized_canonical_name, display_name, account_type, active_status) VALUES ($1,'mm seed','mm seed','mm seed','studio','active') RETURNING id::text`, [tenantId])).rows[0].id;
      await client.query(
        `INSERT INTO external_object_map (tenant_id, provider, external_id, object_type, object_id, payload) VALUES ($1,'monday','sch_1001','organization',$2,$3::jsonb)`,
        [tenantId, orgId, JSON.stringify({ last_synced_at: "2020-01-01T00:00:00.000Z" })]
      );
      const updatePlan = await planMondayImport(client as any, auth(), board, mapping);
      const updRow = updatePlan.rows.find((r) => r.item_id === "sch_1001")!;
      expect(updRow.classification).toBe("update"); // already mapped + item newer than last sync
      expect(updRow.existing_object_id).toBe(orgId);

      // now the SAME item id mapped to a DIFFERENT object_type (job) → conflict
      const conflictMapping = { ...mapping, dedupe_object_type: "job", target_entity: "job" as const };
      const conflictPlan = await planMondayImport(client as any, auth(), board, conflictMapping);
      const confRow = conflictPlan.rows.find((r) => r.item_id === "sch_1001")!;
      expect(confRow.classification).toBe("conflict");
      expect(confRow.conflict_reason).toMatch(/already mapped/i);
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("classifies a service board with no missing required as create", async () => {
    const { board, mapping } = await loadFixture("code-return.sample.json");
    const client = await pool.connect();
    try {
      const plan = await planMondayImport(client as any, auth(), board, mapping);
      expect(plan.counts.create).toBe(2);
      expect(plan.counts.review_required).toBe(0);
      expect(plan.unsupported_column_ids).toContain("dependency_prev");
    } finally {
      client.release();
    }
  });
});
