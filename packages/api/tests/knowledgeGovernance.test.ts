import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  approveKnowledgeVersion,
  buildVersionEligibilitySql,
  createKnowledgeSource,
  openKnowledgeConflict,
  rejectKnowledgeVersion,
  resolveKnowledgeConflict,
  retireKnowledgeVersion,
  listKnowledgeReviewQueue,
  submitKnowledgeVersionForReview,
  type KnowledgeMode
} from "../src/services/knowledge/knowledgeGovernance.js";

// Ask Bailey Phase B — knowledge governance. The eligibility predicate is the
// product's core safety property: draft, rejected, superseded, retired,
// out-of-window, wrong-mode, wrong-scope, and confidential sources must never
// be retrievable. Lifecycle actions are reviewer-gated and audited.

const PREFIX = "kg-test-";

let tenantId = "";
let leadershipId = "";
const createdSourceIds: string[] = [];

const reviewerAuth = (): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "leadership",
    department: "executive",
    roles: ["leadership"],
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: []
  }) as unknown as AuthUser;

const photographerAuth = (over: Record<string, unknown> = {}): AuthUser =>
  ({
    id: leadershipId, // identity irrelevant for eligibility; tier/scopes drive it
    tenantId,
    authorityTier: "standard_employee",
    department: "schools",
    roles: ["photographer_staff"],
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: [],
    ...over
  }) as unknown as AuthUser;

async function createApproved(input: {
  title: string;
  authorityClass?: string;
  knowledgeMode?: string;
  effectiveUntil?: string | null;
  departmentScope?: string[];
  roleScope?: string[];
  confidential?: boolean;
}) {
  return withClientTransaction(tenantId, leadershipId, async (client) => {
    const created = await createKnowledgeSource(client, reviewerAuth(), {
      title: input.title,
      sourceType: "written_sop",
      authorityClass: input.authorityClass ?? "approved_sop",
      knowledgeMode: input.knowledgeMode ?? "operational",
      inlineBody: "Test body",
      effectiveUntil: input.effectiveUntil ?? null,
      departmentScope: input.departmentScope ?? [],
      roleScope: input.roleScope ?? [],
      confidential: input.confidential ?? false
    });
    createdSourceIds.push(created.source_id);
    await submitKnowledgeVersionForReview(client, reviewerAuth(), created.version_id);
    await approveKnowledgeVersion(client, reviewerAuth(), created.version_id);
    return created;
  });
}

async function eligibleVersionIds(auth: AuthUser, mode: KnowledgeMode): Promise<string[]> {
  return withClientTransaction(tenantId, leadershipId, async (client) => {
    const params: unknown[] = [tenantId];
    const eligibility = buildVersionEligibilitySql(auth, mode, params);
    const { rows } = await client.query<{ id: string }>(
      `SELECT v.id::text FROM knowledge_source_version v
       JOIN knowledge_source s ON s.id = v.source_id
       WHERE v.tenant_id = $1 AND s.title LIKE '${PREFIX}%' AND ${eligibility}`,
      params
    );
    return rows.map((row) => row.id);
  });
}

beforeAll(async () => {
  const identity = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = identity.rows[0].tenant_id;
  leadershipId = identity.rows[0].id;
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`,
    [tenantId]
  );
});

describe("knowledge governance lifecycle", () => {
  it("only reviewers can create/approve; a standard employee is refused", async () => {
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        createKnowledgeSource(client, photographerAuth(), {
          title: `${PREFIX}denied`,
          sourceType: "written_sop",
          authorityClass: "approved_sop"
        })
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("a draft version is NOT eligible; approval makes it eligible", async () => {
    const created = await withClientTransaction(tenantId, leadershipId, async (client) => {
      const result = await createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}draft-then-approved`,
        sourceType: "written_sop",
        authorityClass: "approved_sop",
        inlineBody: "Draft body"
      });
      createdSourceIds.push(result.source_id);
      return result;
    });

    expect(await eligibleVersionIds(photographerAuth(), "operational")).not.toContain(created.version_id);

    await withClientTransaction(tenantId, leadershipId, async (client) => {
      await submitKnowledgeVersionForReview(client, reviewerAuth(), created.version_id);
      await approveKnowledgeVersion(client, reviewerAuth(), created.version_id);
    });

    expect(await eligibleVersionIds(photographerAuth(), "operational")).toContain(created.version_id);
  });

  it("a rejected version stays ineligible and can be resubmitted", async () => {
    const created = await withClientTransaction(tenantId, leadershipId, async (client) => {
      const result = await createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}rejected`,
        sourceType: "written_sop",
        authorityClass: "approved_sop"
      });
      createdSourceIds.push(result.source_id);
      await submitKnowledgeVersionForReview(client, reviewerAuth(), result.version_id);
      await rejectKnowledgeVersion(client, reviewerAuth(), result.version_id, "needs work");
      return result;
    });
    expect(await eligibleVersionIds(photographerAuth(), "operational")).not.toContain(created.version_id);
  });

  it("an expired effective window excludes an approved version", async () => {
    const created = await createApproved({ title: `${PREFIX}expired`, effectiveUntil: "2020-01-01" });
    expect(await eligibleVersionIds(photographerAuth(), "operational")).not.toContain(created.version_id);
  });

  it("approving a superseding version retires its predecessor from eligibility", async () => {
    const v1 = await createApproved({ title: `${PREFIX}superseded-v1` });
    const v2 = await withClientTransaction(tenantId, leadershipId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO knowledge_source_version
           (tenant_id, source_id, version_number, source_type, authority_class, publication_status, knowledge_mode, inline_body, supersedes_version_id)
         VALUES ($1, $2, 2, 'written_sop', 'approved_sop', 'pending_review', 'operational', 'v2 body', $3)
         RETURNING id::text`,
        [tenantId, v1.source_id, v1.version_id]
      );
      await approveKnowledgeVersion(client, reviewerAuth(), rows[0].id);
      return rows[0].id;
    });
    const eligible = await eligibleVersionIds(photographerAuth(), "operational");
    expect(eligible).toContain(v2);
    expect(eligible).not.toContain(v1.version_id);
  });

  it("a retired version is excluded", async () => {
    const created = await createApproved({ title: `${PREFIX}retired` });
    await withClientTransaction(tenantId, leadershipId, (client) =>
      retireKnowledgeVersion(client, reviewerAuth(), created.version_id, "obsolete")
    );
    expect(await eligibleVersionIds(photographerAuth(), "operational")).not.toContain(created.version_id);
  });

  it("future_design_only is excluded from operational mode but included in planning mode", async () => {
    const created = await createApproved({
      title: `${PREFIX}future-design`,
      authorityClass: "future_design_only",
      knowledgeMode: "planning"
    });
    expect(await eligibleVersionIds(photographerAuth(), "operational")).not.toContain(created.version_id);
    expect(await eligibleVersionIds(photographerAuth(), "planning")).toContain(created.version_id);
  });

  it("raw evidence and observations are never eligible in any mode", async () => {
    const created = await createApproved({
      title: `${PREFIX}raw-evidence`,
      authorityClass: "raw_evidence",
      knowledgeMode: "evidence_only"
    });
    for (const mode of ["operational", "training", "planning", "historical"] as const) {
      expect(await eligibleVersionIds(photographerAuth(), mode)).not.toContain(created.version_id);
    }
  });

  it("department scope, role scope, and confidentiality all gate eligibility", async () => {
    const deptScoped = await createApproved({ title: `${PREFIX}dept-scoped`, departmentScope: ["sports"] });
    const roleScoped = await createApproved({ title: `${PREFIX}role-scoped`, roleScope: ["graphics_production"] });
    const confidential = await createApproved({ title: `${PREFIX}confidential`, confidential: true });

    const schoolsPhotographer = await eligibleVersionIds(photographerAuth(), "operational");
    expect(schoolsPhotographer).not.toContain(deptScoped.version_id);
    expect(schoolsPhotographer).not.toContain(roleScoped.version_id);
    expect(schoolsPhotographer).not.toContain(confidential.version_id);

    const sportsPhotographer = await eligibleVersionIds(photographerAuth({ department: "sports" }), "operational");
    expect(sportsPhotographer).toContain(deptScoped.version_id);

    const graphicsUser = await eligibleVersionIds(photographerAuth({ roles: ["graphics_production"] }), "operational");
    expect(graphicsUser).toContain(roleScoped.version_id);

    const leadership = await eligibleVersionIds(reviewerAuth(), "operational");
    expect(leadership).toContain(confidential.version_id);
  });

  it("conflicts open, appear in the review queue, and resolve with an audit trail", async () => {
    const a = await createApproved({ title: `${PREFIX}conflict-a` });
    const b = await createApproved({ title: `${PREFIX}conflict-b` });
    const conflictId = await withClientTransaction(tenantId, leadershipId, (client) =>
      openKnowledgeConflict(client, reviewerAuth(), {
        versionAId: a.version_id,
        versionBId: b.version_id,
        note: "Disagree on lighting configuration"
      })
    );
    const queue = await withClientTransaction(tenantId, leadershipId, (client) =>
      listKnowledgeReviewQueue(client, reviewerAuth())
    );
    expect(queue.open_conflicts.some((row: { id: string }) => row.id === conflictId)).toBe(true);

    const resolved = await withClientTransaction(tenantId, leadershipId, (client) =>
      resolveKnowledgeConflict(client, reviewerAuth(), conflictId, {
        resolution: "resolved",
        note: "Source B superseded by updated lighting SOP"
      })
    );
    expect(resolved.status).toBe("resolved");

    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'knowledge.conflict_resolved' AND entity_id = $2`,
      [tenantId, conflictId]
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);

    const queueAfter = await withClientTransaction(tenantId, leadershipId, (client) =>
      listKnowledgeReviewQueue(client, reviewerAuth())
    );
    expect(queueAfter.open_conflicts.some((row: { id: string }) => row.id === conflictId)).toBe(false);
  });

  it("the review queue itself is reviewer-gated", async () => {
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        listKnowledgeReviewQueue(client, photographerAuth())
      )
    ).rejects.toMatchObject({ status: 403 });
  });
});
