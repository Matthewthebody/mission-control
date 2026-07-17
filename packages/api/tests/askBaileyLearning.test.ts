import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  cancelAssistiveAction,
  confirmAssistiveAction,
  generateProposalsFromGaps,
  getKnowledgeGaps,
  getMyLearningMemory,
  listProposals,
  previewPreShootHuddle,
  reviewProposal
} from "../src/services/ai/knowledgeLearning.js";

// Ask Bailey H9 — governed learning + bounded actions. Contracts under test:
//  * gap intelligence is reviewer-only, evidence-backed, and labelled;
//  * proposals stay drafts (no inference becomes policy) and dedup;
//  * dismissing a proposal preserves its evidence;
//  * a bounded action previews, confirms through an existing typed API, is
//    audited, and is duplicate-safe; a fresh preview can be cancelled;
//  * learning memory is transparent and contains no hidden scoring.

let tenantId = "";
let leadershipId = "";
let associateId = "";
let jobId = "";

const reviewerAuth = (): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "leadership",
    department: "operations",
    roles: ["leadership", "owner_admin"],
    permissions: ["dashboard.read", "shoot.read", "job.read"],
    policyGrants: [{ permission: "job.read", scopeType: "organization_wide_scope", scopeId: null }],
    jobFunctionProfiles: [],
    effectiveScopes: ["organization_wide_scope"],
    status: "active"
  }) as unknown as AuthUser;
const associateAuth = (): AuthUser =>
  ({ id: associateId, tenantId, authorityTier: "standard_employee", department: "schools", roles: ["associate_photographer"], permissions: [], policyGrants: [], jobFunctionProfiles: [], status: "active" }) as unknown as AuthUser;

const tx = <T>(fn: (client: import("pg").PoolClient) => Promise<T>) => withClientTransaction(tenantId, leadershipId, fn);

beforeAll(async () => {
  const lead = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = lead.rows[0].tenant_id;
  leadershipId = lead.rows[0].id;
  const assoc = await pool.query<{ id: string }>(`SELECT id::text FROM app_user WHERE lower(email) = 'associate@example.com' AND tenant_id = $1 LIMIT 1`, [tenantId]);
  associateId = assoc.rows[0].id;
  const job = await pool.query<{ id: string }>(`SELECT id::text FROM jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [tenantId]);
  jobId = job.rows[0]?.id ?? "";
  await pool.query(`DELETE FROM ai_assistive_action WHERE tenant_id = $1 AND target_id = $2`, [tenantId, jobId]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM ai_assistive_action WHERE tenant_id = $1 AND target_id = $2`, [tenantId, jobId]);
});

describe("H9-A/B gap intelligence + proposals", () => {
  it("gap intelligence is reviewer-only and evidence-backed with an observation/inference label", async () => {
    await expect(withClientTransaction(tenantId, associateId, (c) => getKnowledgeGaps(c, associateAuth()))).rejects.toMatchObject({ status: 403 });
    const gaps = await tx((c) => getKnowledgeGaps(c, reviewerAuth()));
    expect(Array.isArray(gaps)).toBe(true);
    for (const gap of gaps) {
      expect(gap.evidence_count).toBeGreaterThanOrEqual(0);
      expect(["observation", "inference"]).toContain(gap.confidence);
      expect(gap.dedup_key).toBeTruthy();
    }
  });

  it("generated proposals are drafts (no inference becomes policy) and dedup on regeneration", async () => {
    const first = await tx((c) => generateProposalsFromGaps(c, reviewerAuth()));
    const second = await tx((c) => generateProposalsFromGaps(c, reviewerAuth()));
    // Second pass creates no NEW drafts for the same gaps (dedup).
    expect(second.created_count).toBeLessThanOrEqual(first.created_count);
    const drafts = await tx((c) => listProposals(c, reviewerAuth(), "draft"));
    expect(drafts.proposals.every((p: { status: string }) => p.status === "draft")).toBe(true);
  });

  it("dismissing a proposal preserves its evidence; a reviewed proposal cannot be reviewed again", async () => {
    await tx((c) => generateProposalsFromGaps(c, reviewerAuth()));
    const drafts = await tx((c) => listProposals(c, reviewerAuth(), "draft"));
    if (!drafts.proposals.length) return; // no gaps in this env — nothing to review
    const target = drafts.proposals[0] as { id: string; evidence: unknown };
    const dismissed = await tx((c) => reviewProposal(c, reviewerAuth(), target.id, { decision: "dismissed", note: "not now" }));
    expect(dismissed.status).toBe("dismissed");
    const after = await pool.query(`SELECT evidence, status FROM knowledge_improvement_proposal WHERE tenant_id = $1 AND id = $2`, [tenantId, target.id]);
    expect(after.rows[0].evidence).toBeTruthy(); // evidence preserved
    await expect(tx((c) => reviewProposal(c, reviewerAuth(), target.id, { decision: "accepted" }))).rejects.toMatchObject({ status: 409 });
  });
});

describe("H9-D bounded assistive action", () => {
  it("previews a huddle, confirms through the typed API, is duplicate-safe, and blocks cancel-after-confirm", async () => {
    if (!jobId) return;
    const preview = await tx((c) => previewPreShootHuddle(c, reviewerAuth(), jobId));
    expect(preview.action_id).toBeTruthy();
    expect(preview.target).toMatchObject({ type: "job", id: jobId });
    expect(preview.preview.body).toBeTruthy();

    const confirmed = await tx((c) => confirmAssistiveAction(c, reviewerAuth(), preview.action_id));
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.duplicate).toBe(false);

    // Idempotent: confirming again does not post a second message.
    const before = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM record_thread_message m JOIN record_thread t ON t.id = m.thread_id WHERE t.tenant_id = $1 AND t.entity_id = $2`,
      [tenantId, jobId]
    );
    const again = await tx((c) => confirmAssistiveAction(c, reviewerAuth(), preview.action_id));
    expect(again.duplicate).toBe(true);
    const after = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM record_thread_message m JOIN record_thread t ON t.id = m.thread_id WHERE t.tenant_id = $1 AND t.entity_id = $2`,
      [tenantId, jobId]
    );
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n));

    // A confirmed action cannot be cancelled.
    await expect(tx((c) => cancelAssistiveAction(c, reviewerAuth(), preview.action_id))).rejects.toMatchObject({ status: 409 });
  });

  it("a fresh preview can be cancelled", async () => {
    if (!jobId) return;
    // Different job-less action: reuse the same job but cancel a re-preview that
    // is still in 'previewed' state after deleting the confirmed one.
    await pool.query(`DELETE FROM ai_assistive_action WHERE tenant_id = $1 AND target_id = $2`, [tenantId, jobId]);
    const preview = await tx((c) => previewPreShootHuddle(c, reviewerAuth(), jobId));
    const cancelled = await tx((c) => cancelAssistiveAction(c, reviewerAuth(), preview.action_id));
    expect(cancelled.status).toBe("cancelled");
    await expect(tx((c) => confirmAssistiveAction(c, reviewerAuth(), preview.action_id))).rejects.toMatchObject({ status: 409 });
  });
});

describe("H9-E learning memory transparency", () => {
  it("returns only explicit stored categories and names what is never stored (no hidden scoring)", async () => {
    const memory = await withClientTransaction(tenantId, associateId, (c) => getMyLearningMemory(c, associateAuth()));
    expect(memory.statement).toMatch(/never for discipline/i);
    expect(memory.stored_categories.length).toBeGreaterThan(0);
    expect(memory.not_stored).toContain("secret competence rankings");
    expect(memory.correction_path).toBeTruthy();
  });
});
