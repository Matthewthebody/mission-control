import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { featureFlags } from "../src/featureFlags.js";

type ContractCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

const REQUIRED_USERS = [
  "admin@example.com",
  "leadership@example.com",
  "senior@example.com",
  "photo@example.com",
  "schools-office@example.com",
  "sports-office@example.com",
  "graphic@example.com"
];

async function scalarCount(sql: string, params: unknown[] = []) {
  const { rows } = await pool.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}

async function run() {
  const checks: ContractCheck[] = [];
  const app = createApp();

  const tenant = await pool.query<{ id: string }>("SELECT id::text FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  const tenantId = tenant.rows[0]?.id ?? "";
  checks.push({
    name: "reference tenant exists",
    ok: Boolean(tenantId),
    detail: tenantId ? "Demo Studio is present." : "Missing Demo Studio tenant. Run npm run db:seed."
  });

  if (tenantId) {
    const userCount = await scalarCount(
      "SELECT count(*) FROM app_user WHERE tenant_id = $1 AND lower(email) = ANY($2::text[])",
      [tenantId, REQUIRED_USERS]
    );
    checks.push({
      name: "dev-login users exist",
      ok: userCount === REQUIRED_USERS.length,
      detail: `${userCount}/${REQUIRED_USERS.length} required local users found.`
    });

    checks.push({
      name: "roles exist",
      ok: (await scalarCount("SELECT count(*) FROM role")) >= 5
    });
    checks.push({
      name: "permissions exist",
      ok: (await scalarCount("SELECT count(*) FROM permission")) >= 20
    });
    checks.push({
      name: "studio reference exists",
      ok: (await scalarCount("SELECT count(*) FROM studio WHERE tenant_id = $1", [tenantId])) >= 1
    });
    checks.push({
      name: "organization reference exists",
      ok: (await scalarCount("SELECT count(*) FROM organization WHERE tenant_id = $1", [tenantId])) >= 1
    });
    const workflowTemplateCount = await scalarCount("SELECT count(*) FROM workflow_template WHERE tenant_id = $1", [tenantId]);
    checks.push({
      name: "workflow template reference is optional for db:seed",
      ok: true,
      detail:
        workflowTemplateCount > 0
          ? `${workflowTemplateCount} workflow templates found.`
          : "No workflow templates found; run npm run seed:mission-control-demo when demo workflows are needed."
    });
  }

  const health = await request(app).get("/health");
  checks.push({
    name: "api health route responds",
    ok: health.status === 200 && health.body?.ok === true,
    detail: `status=${health.status}`
  });

  const login = await request(app).post("/auth/dev-login").send({ email: "leadership@example.com" });
  const token = login.body?.token as string | undefined;
  checks.push({
    name: "dev-login works for leadership",
    ok: login.status === 200 && Boolean(token),
    detail: `status=${login.status}`
  });

  if (token) {
    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    checks.push({
      name: "authenticated session resolves",
      ok: me.status === 200 && me.body?.user?.email === "leadership@example.com",
      detail: `status=${me.status}`
    });
  }

  checks.push({
    name: "core feature flags load",
    ok:
      typeof featureFlags.coreGlobalSearch === "boolean" &&
      typeof featureFlags.workflowTemplateBuilderV1 === "boolean" &&
      typeof featureFlags.jobCloseoutV1 === "boolean" &&
      typeof featureFlags.complianceWorkspaceV1 === "boolean"
  });

  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
