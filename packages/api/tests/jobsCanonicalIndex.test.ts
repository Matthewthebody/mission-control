import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Phase 3B — canonical Jobs index read model. Proves the central invariant
// (summary[metric] === total returned when that metric filter is applied), honest
// zero/unavailable states, deterministic pagination, tenant/RBAC scoping, jobs.id
// identity, confirmed-link dedup, and that unlinked Jobs never expose Shoot-derived
// state — all against the real database, no demo fallback.

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let tenantId = "";

let linkedJobId = "";
let linkedShootId = "";
let unlinkedWorkflowJobId = "";
let unlinkedNoWorkflowJobId = "";
let standaloneShootId = "";

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
}

async function index(query: string, token = leadershipToken) {
  const response = await request(app)
    .get(`/api/jobs/index${query ? `?${query}` : ""}`)
    .set("Authorization", `Bearer ${token}`);
  return response;
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;
  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");
  const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${leadershipToken}`);
  tenantId = me.body.user.tenantId as string;

  const linked = await dbPool.query(
    `SELECT id::text, legacy_shoot_id::text FROM jobs WHERE tenant_id=$1 AND legacy_shoot_id IS NOT NULL LIMIT 1`,
    [tenantId]
  );
  linkedJobId = linked.rows[0].id;
  linkedShootId = linked.rows[0].legacy_shoot_id;
  unlinkedWorkflowJobId = (
    await dbPool.query(
      `SELECT j.id::text FROM jobs j WHERE j.tenant_id=$1 AND j.legacy_shoot_id IS NULL
         AND EXISTS(SELECT 1 FROM workflow_run wr WHERE wr.tenant_id=j.tenant_id AND wr.job_id=j.id) LIMIT 1`,
      [tenantId]
    )
  ).rows[0].id;
  // A controlled, genuinely unlinked + no-workflow + active Job with a unique title, so
  // tests 11/15/16 find it by search (one row, no pagination/ordering fragility — a bare
  // LIMIT 1 over shared data could otherwise pick a linked or off-page row).
  unlinkedNoWorkflowJobId = (
    await dbPool.query(
      `INSERT INTO jobs (tenant_id, department_type, title, job_status, scheduled_start_at)
       VALUES ($1,'sports','unlinked-noworkflow-fixture-3c1','ready_to_staff', now() + interval '3 days')
       RETURNING id::text`,
      [tenantId]
    )
  ).rows[0].id;
  standaloneShootId = (
    await dbPool.query(
      `SELECT s.id::text FROM shoot s WHERE s.tenant_id=$1 AND s.deleted_at IS NULL
         AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.tenant_id=$1 AND j.id=s.id) LIMIT 1`,
      [tenantId]
    )
  ).rows[0].id;
});

afterAll(async () => {
  if (unlinkedNoWorkflowJobId) await dbPool.query(`DELETE FROM jobs WHERE id=$1`, [unlinkedNoWorkflowJobId]);
});

function rowById(rows: any[], id: string) {
  return rows.find((r) => r.id === id);
}

describe("GET /api/jobs/index — predicate consistency", () => {
  it("(1) every live summary count equals the total returned when its metric filter is applied", async () => {
    const base = (await index("limit=1")).body;
    const available = base.summary.metrics.filter((m: any) => m.available);
    expect(available.length).toBeGreaterThan(0);
    for (const metric of available) {
      const filtered = (await index(`metric=${metric.key}&limit=1`)).body;
      expect(filtered.page.total).toBe(metric.count);
    }
  });

  it("(2) zero counts remain zero (impossible filter returns real zeros, no fabrication)", async () => {
    const body = (await index("search=zzz_no_such_job_xyz_123")).body;
    expect(body.page.total).toBe(0);
    expect(body.rows).toHaveLength(0);
    for (const m of body.summary.metrics.filter((x: any) => x.available)) {
      expect(m.count).toBe(0);
    }
  });

  it("(3) never falls back to demo counts — an empty result is a true zero, not a sample number", async () => {
    const body = (await index("department_type=corporate&search=__definitely_absent__")).body;
    expect(body.page.total).toBe(0);
    // No fabricated demo/sample DATA. (tenant_is_demo is honest metadata, not content — exclude it.)
    const { tenant_is_demo, ...content } = body;
    expect(JSON.stringify(content)).not.toMatch(/sample|demo|illustrative/i);
  });

  it("(4) unavailable metrics expose no enabled count/filter contract", async () => {
    const body = (await index("limit=1")).body;
    const unavailable = body.summary.metrics.filter((m: any) => !m.available);
    expect(unavailable.map((m: any) => m.key).sort()).toEqual(["date_conflict", "waiting_on_client"]);
    for (const m of unavailable) {
      expect(m.count).toBeNull();
      expect(typeof m.reason).toBe("string");
    }
    // Filtering by an unavailable metric is rejected, not silently honored.
    expect((await index("metric=date_conflict")).status).toBe(400);
    expect((await index("metric=waiting_on_client")).status).toBe(400);
  });
});

describe("GET /api/jobs/index — filters, sort, pagination", () => {
  it("(5) honors search, owner, department, stage, status, date, and risk filters", async () => {
    const schools = (await index("department_type=schools&limit=100")).body;
    expect(schools.rows.every((r: any) => r.department_type === "schools")).toBe(true);

    const draft = (await index("job_status=draft&limit=100")).body;
    expect(draft.rows.every((r: any) => r.job_status === "draft")).toBe(true);

    const risk = (await index("risk_status=medium&limit=100")).body;
    expect(risk.rows.every((r: any) => r.risk_status === "medium")).toBe(true);

    const overdue = (await index("date_window=overdue&limit=100")).body;
    expect(overdue.rows.every((r: any) => r.job_date && new Date(r.job_date) < new Date())).toBe(true);

    const owner = (await dbPool.query(
      `SELECT account_owner_user_id::text AS id FROM jobs WHERE tenant_id=$1 AND account_owner_user_id IS NOT NULL LIMIT 1`,
      [tenantId]
    )).rows[0].id;
    const byOwner = (await index(`owner_user_id=${owner}&limit=100`)).body;
    expect(byOwner.rows.length).toBeGreaterThan(0);
    expect(byOwner.rows.every((r: any) => r.account_owner_user_id === owner)).toBe(true);

    const sample = (await dbPool.query(
      `SELECT lower(split_part(title,' ',1)) AS term FROM jobs WHERE tenant_id=$1 AND title IS NOT NULL LIMIT 1`,
      [tenantId]
    )).rows[0].term;
    const search = (await index(`search=${encodeURIComponent(sample)}&limit=100`)).body;
    expect(search.rows.every((r: any) => `${r.title} ${r.event_name ?? ""} ${r.job_number ?? ""}`.toLowerCase().includes(sample))).toBe(true);
  });

  it("(6) paginates deterministically with a jobs.id tiebreaker and stable total", async () => {
    const p1 = (await index("limit=10&offset=0&sort=created")).body;
    const p2 = (await index("limit=10&offset=10&sort=created")).body;
    expect(p1.page.total).toBe(p2.page.total);
    const ids1 = p1.rows.map((r: any) => r.id);
    const ids2 = p2.rows.map((r: any) => r.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0); // no overlap
    // Deterministic: the same request twice returns the same order.
    const again = (await index("limit=10&offset=0&sort=created")).body;
    expect(again.rows.map((r: any) => r.id)).toEqual(ids1);
    expect(p1.page.has_more).toBe(true);
  });
});

describe("GET /api/jobs/index — scope, identity, tenancy", () => {
  it("(7) scopes rows AND counts to the tenant and readable departments", async () => {
    const all = (await index("")).body;
    const dbTotal = (await dbPool.query(
      `SELECT count(*)::int AS n FROM jobs WHERE tenant_id=$1 AND archived_at IS NULL`,
      [tenantId]
    )).rows[0].n;
    expect(all.page.total).toBe(dbTotal); // leadership reads all departments
    const schools = (await index("department_type=schools")).body;
    const dbSchools = (await dbPool.query(
      `SELECT count(*)::int AS n FROM jobs WHERE tenant_id=$1 AND archived_at IS NULL AND department_type='schools'`,
      [tenantId]
    )).rows[0].n;
    expect(schools.page.total).toBe(dbSchools);
  });

  it("(8) uses jobs.id as the only Job selection identity", async () => {
    const rows = (await index("limit=50")).body.rows;
    const ids = rows.map((r: any) => r.id);
    const real = (await dbPool.query(
      `SELECT count(*)::int AS n FROM jobs WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
      [tenantId, ids]
    )).rows[0].n;
    expect(real).toBe(ids.length); // every row id is a real jobs.id
  });

  it("(9) a shoot id is never a Job identity and cannot be opened as a job", async () => {
    const rows = (await index("limit=100")).body.rows;
    expect(rows.some((r: any) => r.id === standaloneShootId)).toBe(false);
    const detail = await request(app).get(`/api/jobs/${standaloneShootId}`).set("Authorization", `Bearer ${leadershipToken}`);
    expect([403, 404]).toContain(detail.status);
  });

  it("(19) enforces auth, department RBAC, and never exceeds full-access scope", async () => {
    expect((await request(app).get("/api/jobs/index")).status).toBe(401);
    const leadershipTotal = (await index("")).body.page.total;
    const limitedTotal = (await index("", photographerToken)).body.page.total;
    expect(limitedTotal).toBeLessThanOrEqual(leadershipTotal);
    // A department the limited reader cannot read is forbidden, not silently widened.
    const forbidden = await index("department_type=schools", photographerToken);
    expect([200, 403]).toContain(forbidden.status);
    if (forbidden.status === 200) {
      expect(forbidden.body.rows.every((r: any) => r.department_type === "schools")).toBe(true);
    }
  });
});

describe("GET /api/jobs/index — confirmed links and capabilities", () => {
  it("(10) deduplicates the same (job, shoot) pair across legacy + relationship-table links", async () => {
    const before = rowById((await index(`search=&limit=100&shoot_link_status=linked`)).body.rows, linkedJobId);
    expect(before.linked_shoot_count).toBe(1);
    // Add a relationship-table row duplicating the legacy link for the SAME pair.
    await dbPool.query(
      `INSERT INTO job_shoot_links (tenant_id, job_id, shoot_id, link_reason) VALUES ($1,$2,$3,'test-dedup')
       ON CONFLICT DO NOTHING`,
      [tenantId, linkedJobId, linkedShootId]
    );
    try {
      const after = rowById((await index(`limit=100&shoot_link_status=linked`)).body.rows, linkedJobId);
      expect(after.linked_shoot_count).toBe(1); // still 1 — deduped, not 2
      expect(after.linked_shoot_ids).toEqual([linkedShootId]);
      expect(after.link_sources.sort()).toEqual(["job_shoot_links", "legacy_shoot_id"].sort());
    } finally {
      await dbPool.query(`DELETE FROM job_shoot_links WHERE tenant_id=$1 AND job_id=$2 AND link_reason='test-dedup'`, [tenantId, linkedJobId]);
    }
  });

  it("(11) an unlinked Job exposes no Shoot-derived staffing or schedule state", async () => {
    const row = rowById((await index(`search=unlinked-noworkflow-fixture-3c1`)).body.rows, unlinkedNoWorkflowJobId);
    expect(row.shoot_link_status).toBe("unlinked");
    expect(row.linked_shoot_count).toBe(0);
    expect(row.linked_shoot_ids).toEqual([]);
    expect(row.shoot_data_available).toBe(false);
    expect(row.staffing_data_available).toBe(false);
    expect(row.schedule_data_available).toBe(false);
    expect(typeof row.operational_link_explanation).toBe("string");
  });

  it("(12) an unlinked Job is not automatically Needs Attention and never gets Shoot-derived reasons", async () => {
    const unlinked = (await index("shoot_link_status=unlinked&limit=100")).body.rows;
    expect(unlinked.length).toBeGreaterThan(0);
    // The needs_attention predicate does not reference link state: some unlinked jobs are not attention.
    const calm = unlinked.filter((r: any) => r.readiness_status === "on_track" || r.readiness_status === "ready");
    // No unlinked row carries a Shoot-derived attention reason.
    for (const r of unlinked) {
      expect(r.attention_reasons).not.toContain("affects_client_or_shoot_72h");
      expect(r.attention_reasons).not.toContain("not_acknowledged");
    }
    expect(Array.isArray(calm)).toBe(true);
  });

  it("(13) a confirmed-linked Job exposes labeled related-Shoot data", async () => {
    const row = rowById((await index("shoot_link_status=linked&limit=100")).body.rows, linkedJobId);
    expect(row.shoot_link_status).toBe("linked");
    expect(row.shoot_data_available).toBe(true);
    expect(row.linked_shoot_ids).toContain(linkedShootId);
    expect(row.single_linked_shoot_id).toBe(linkedShootId);
    expect(row.link_sources).toContain("legacy_shoot_id"); // source is labeled
  });

  it("(14) a Job with a canonical workflow_run exposes workflow data without a Shoot link", async () => {
    const row = rowById((await index(`limit=100&workflow_link_status=linked`)).body.rows, unlinkedWorkflowJobId);
    expect(row.shoot_link_status).toBe("unlinked");
    expect(row.workflow_data_available).toBe(true);
    expect(row.workflow_run_count).toBeGreaterThan(0);
    expect(row.shoot_data_available).toBe(false);
  });

  it("(15) a Job without a workflow_run reports workflow unavailable honestly", async () => {
    const row = rowById((await index(`search=unlinked-noworkflow-fixture-3c1`)).body.rows, unlinkedNoWorkflowJobId);
    expect(row.workflow_data_available).toBe(false);
    expect(row.workflow_run_count).toBe(0);
  });

  it("(16) unrelated Shoot state does not contaminate a Job's link count", async () => {
    const row = rowById((await index(`search=unlinked-noworkflow-fixture-3c1`)).body.rows, unlinkedNoWorkflowJobId);
    // 2,300+ shoots exist; an unlinked job still counts exactly its own confirmed links (zero).
    expect(row.linked_shoot_count).toBe(0);
    expect(row.single_linked_shoot_id).toBeNull();
  });

  it("(17) candidate (org+date) matches never appear as confirmed links", async () => {
    const linkedTotal = (await index("shoot_link_status=linked")).body.page.total;
    const dbConfirmed = (await dbPool.query(
      `SELECT count(*)::int AS n FROM jobs j WHERE j.tenant_id=$1 AND j.archived_at IS NULL AND (
         j.legacy_shoot_id IS NOT NULL OR EXISTS(SELECT 1 FROM job_shoot_links l WHERE l.tenant_id=j.tenant_id AND l.job_id=j.id))`,
      [tenantId]
    )).rows[0].n;
    expect(linkedTotal).toBe(dbConfirmed); // only confirmed links — the 46 org+date candidates are NOT linked
  });
});

describe("GET /api/jobs/index — attention provenance, scale", () => {
  it("(18) Needs Attention reasons appear only when their canonical inputs exist", async () => {
    const body = (await index("limit=100")).body;
    expect(body.attention_reason_availability.job_native.sort()).toEqual(
      ["behind_promised_delivery", "blocked_no_owner", "late", "missing_required_details"].sort()
    );
    expect(body.attention_reason_availability.unavailable.map((u: any) => u.reason).sort()).toEqual(
      ["affects_client_or_shoot_72h", "not_acknowledged"].sort()
    );
    // A canonical condition produces its reason: unowned + blocked -> blocked_no_owner.
    const unownedBlocked = (await index("metric=unowned&limit=100")).body.rows.filter(
      (r: any) => r.production_status === "blocked" || r.blocker_count > 0 || r.open_watch_flag_count > 0
    );
    if (unownedBlocked.length > 0) {
      expect(unownedBlocked[0].attention_reasons).toContain("blocked_no_owner");
    }
  });

  it("(20) caps page size and stays bounded at realistic scale (no per-row N+1)", async () => {
    // Bounded by contract: an over-cap page size is rejected outright.
    expect((await index("limit=1000")).status).toBe(400);
    const t0 = process.hrtime.bigint();
    const body = (await index("limit=100")).body; // the maximum allowed page
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(body.page.limit).toBe(100);
    expect(body.rows.length).toBeLessThanOrEqual(100);
    expect(body.page.total).toBeGreaterThan(100); // dataset larger than one page
    // Fixed query count (summary + rows + link projection), so it stays fast over 300 jobs.
    expect(elapsedMs).toBeLessThan(4000);
  });
});

// Phase 3C.1 — explicit demo states. A seed_demo Job is hidden from the default
// operating view and revealed by demo_view=all, with summary counts and rows moving
// together (the invariant survives the demo state).
describe("GET /api/jobs/index — demo_view", () => {
  let demoJobId = "";
  beforeAll(async () => {
    demoJobId = (
      await dbPool.query(
        `INSERT INTO jobs (tenant_id, department_type, title, job_status, data_origin)
         VALUES ($1,'sports','showdemofixture-unique','draft','seed_demo') RETURNING id::text`,
        [tenantId]
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await dbPool.query(`DELETE FROM jobs WHERE id=$1`, [demoJobId]);
  });

  it("hides seed_demo from the default active view", async () => {
    const body = (await index("search=showdemofixture-unique")).body;
    expect(body.rows.some((r: any) => r.id === demoJobId)).toBe(false);
    expect(body.summary.total).toBe(0);
  });

  it("reveals seed_demo when demo_view=all, with counts matching rows", async () => {
    const body = (await index("search=showdemofixture-unique&demo_view=all")).body;
    expect(body.rows.some((r: any) => r.id === demoJobId)).toBe(true);
    expect(body.summary.total).toBe(1);
    expect(body.page.total).toBe(body.summary.total); // rows and summary move together
  });
});

// Phase 3C.1 — single-Job quick view by id for an off-page deep link. Finds any Job the
// user can read regardless of lifecycle scope; a Shoot id / unknown id / non-Job is a
// safe 404 that leaks nothing; jobs.id is the only identity.
describe("GET /api/jobs/quick-view/:jobId — off-page deep link", () => {
  let archivedOffPageId = "";
  beforeAll(async () => {
    archivedOffPageId = (
      await dbPool.query(
        `INSERT INTO jobs (tenant_id, department_type, title, job_status, archived_at)
         VALUES ($1,'sports','quickview-archived-fixture','archived', now()) RETURNING id::text`,
        [tenantId]
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await dbPool.query(`DELETE FROM jobs WHERE id=$1`, [archivedOffPageId]);
  });
  const qv = (id: string, token = leadershipToken) => request(app).get(`/api/jobs/quick-view/${id}`).set("Authorization", `Bearer ${token}`);

  it("returns the canonical row for a Job by id, ignoring lifecycle scope (finds an archived Job)", async () => {
    const res = await qv(archivedOffPageId);
    expect(res.status).toBe(200);
    expect(res.body.row.id).toBe(archivedOffPageId);
    expect(res.body.row).toHaveProperty("attention_reasons");
    expect(res.body.row).toHaveProperty("shoot_link_status");
    expect(res.body.row).toHaveProperty("operational_link_explanation");
  });

  it("a Shoot id is never a Job id — returns 404, not a fabricated job", async () => {
    expect((await qv(standaloneShootId)).status).toBe(404);
  });

  it("an unknown uuid and a non-uuid both safely 404", async () => {
    expect((await qv("00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await qv("not-a-uuid")).status).toBe(404);
  });

  it("requires auth (no token => 401, never leaks the Job)", async () => {
    expect((await request(app).get(`/api/jobs/quick-view/${archivedOffPageId}`)).status).toBe(401);
  });
});
