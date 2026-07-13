import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import { listChecklistAttention } from "../src/services/jobTruth/checklistService.js";

// MC-AUDIT-008 / audit prompt 9: the dashboard checklist-attention read used to
// call loadInstanceDetailInternal PER CANDIDATE (~14 queries each — ~1,350
// queries per home-dashboard render at the live limit of 96). The batched
// loader must issue a FIXED number of queries regardless of candidate count.
// Query counting uses the same client-Proxy pattern as staffingCapacity #33.

const FIXTURE_TITLE_PREFIX = "attention-budget-fixture-";
const FIXTURE_COUNT = 40;

let tenantId = "";
let leadershipId = "";
let fixtureJobId = "";

const leadershipAuth = (): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "leadership",
    department: "executive",
    jobFunctionProfiles: [],
    permissions: ["job.read", "production.read"],
    roles: []
  }) as unknown as AuthUser;

beforeAll(async () => {
  const identity = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = identity.rows[0].tenant_id;
  leadershipId = identity.rows[0].id;

  // One fixture job to scope every instance at (multiple checklists per job is
  // a legitimate state), plus N instances against a REAL published template
  // version with items so progress computation exercises the full path.
  fixtureJobId = (
    await pool.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, department_type, title, job_status, scheduled_start_at, data_origin)
       VALUES ($1, 'schools', '${FIXTURE_TITLE_PREFIX}job', 'confirmed', now() + interval '2 days', 'test_fixture')
       RETURNING id::text`,
      [tenantId]
    )
  ).rows[0].id;

  const version = await pool.query<{ id: string; template_id: string }>(
    `SELECT v.id::text, v.template_id::text
     FROM checklist_template_versions v
     JOIN checklist_items i ON i.template_version_id = v.id
     WHERE v.tenant_id = $1
     GROUP BY v.id, v.template_id
     ORDER BY count(i.id) DESC
     LIMIT 1`,
    [tenantId]
  );
  const templateVersionId = version.rows[0].id;
  const templateId = version.rows[0].template_id;

  await pool.query(
    `INSERT INTO checklist_instances
       (tenant_id, template_id, template_version_id, scope_type, job_id, department_type, title, status, blocking_level, due_at)
     SELECT $1, $2, $3, 'job', $4, 'schools', '${FIXTURE_TITLE_PREFIX}' || g, 'in_progress', 'soft_block', now() + interval '1 day'
     FROM generate_series(1, ${FIXTURE_COUNT}) g`,
    [tenantId, templateId, templateVersionId, fixtureJobId]
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM checklist_instances WHERE tenant_id = $1 AND title LIKE '${FIXTURE_TITLE_PREFIX}%'`, [tenantId]);
  await pool.query(`DELETE FROM jobs WHERE tenant_id = $1 AND id = $2`, [tenantId, fixtureJobId]);
});

describe("checklist attention query budget", () => {
  it("serves the whole candidate set with a fixed query budget — no per-instance N+1", async () => {
    let queryCount = 0;
    const result = await withClientTransaction(tenantId, leadershipId, async (client) => {
      const counting = new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "query") {
            return (...args: unknown[]) => {
              queryCount += 1;
              return (target.query as (...a: unknown[]) => unknown)(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        }
      });
      return listChecklistAttention(counting, leadershipAuth(), { limit: 250 });
    });

    // eslint-disable-next-line no-console
    console.log(`[attention budget] queries=${queryCount} candidates=${result.items.length}`);

    // The fixtures guarantee a large candidate set even on a sparse database
    // (they may be outranked past the 250 cap by overdue/hard-block work on a
    // busy one — which only makes the budget assertion stronger).
    expect(result.items.length).toBeGreaterThanOrEqual(FIXTURE_COUNT);
    // Fixed budget: 1 candidates + 1 templates + 1 versions + 3 template shape
    // + 3 responses/attachments/approvals + <=4 scope contexts = <=13. The old
    // path would have burned ~14 queries PER candidate (500+ on this dataset).
    expect(queryCount).toBeLessThanOrEqual(13);
    expect(queryCount).toBeLessThan(result.items.length);
  });
});
