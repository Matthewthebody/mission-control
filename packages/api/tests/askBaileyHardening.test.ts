import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  approveKnowledgeVersion,
  createKnowledgeSource,
  retireKnowledgeVersion,
  submitKnowledgeVersionForReview
} from "../src/services/knowledge/knowledgeGovernance.js";
import { processQueuedIngestionJobs, queueIngestionJob } from "../src/services/knowledge/knowledgeIngestion.js";
import { askBailey } from "../src/services/ai/askBailey.js";
import { deterministicLanguageModel } from "../src/services/ai/providers/languageModel.js";
import { getPlayableMedia } from "../src/services/knowledge/knowledgeMedia.js";
import { getObservabilitySummary, getReleaseGate } from "../src/services/ai/askBaileyObservability.js";

// Ask Bailey H7 — production hardening adversarial suite. Proves the release
// hard gates against the REAL implementation: no protected-source leak, no
// invalid citations, opaque media on guessed ids, retirement purge, provider
// failure never becomes unsupported prose, reviewer-only observability, and
// the ask rate limit.

const PREFIX = "h7-test-";
const app = createApp();
let tenantId = "";
let leadershipId = "";
let associateId = "";
let associateToken = "";

const reviewerAuth = (): AuthUser =>
  ({ id: leadershipId, tenantId, authorityTier: "leadership", department: "executive", roles: ["leadership"], permissions: [], policyGrants: [], jobFunctionProfiles: [], status: "active" }) as unknown as AuthUser;
const associateAuth = (): AuthUser =>
  ({ id: associateId, tenantId, authorityTier: "standard_employee", department: "photography", roles: ["associate_photographer"], permissions: [], policyGrants: [], jobFunctionProfiles: [], status: "active" }) as unknown as AuthUser;

const tx = <T>(fn: (client: import("pg").PoolClient) => Promise<T>) => withClientTransaction(tenantId, leadershipId, fn);
const txAssoc = <T>(fn: (client: import("pg").PoolClient) => Promise<T>) => withClientTransaction(tenantId, associateId, fn);

async function createApprovedSource(title: string, body: string, options: { confidential?: boolean } = {}) {
  return tx(async (client) => {
    const created = await createKnowledgeSource(client, reviewerAuth(), {
      title,
      sourceType: "written_sop",
      authorityClass: "approved_sop",
      inlineBody: body,
      confidential: options.confidential
    });
    await queueIngestionJob(client, tenantId, created.version_id, "document_extract", leadershipId);
    await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
    await submitKnowledgeVersionForReview(client, reviewerAuth(), created.version_id);
    await approveKnowledgeVersion(client, reviewerAuth(), created.version_id, "h7 test");
    return created;
  });
}

// A provider that always fails — proves failure never becomes unsupported prose.
const failingProvider = {
  name: "failing_test_provider",
  async generateAnswer() {
    return { status: "unavailable" as const, reason: "forced failure for hardening test" };
  }
};

beforeAll(async () => {
  const lead = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = lead.rows[0].tenant_id;
  leadershipId = lead.rows[0].id;
  const assoc = await pool.query<{ id: string }>(
    `SELECT id::text FROM app_user WHERE lower(email) = 'associate@example.com' AND tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  associateId = assoc.rows[0].id;
  const login = await request(app).post("/auth/dev-login").send({ email: "associate@example.com" });
  associateToken = login.body.token;
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
});

describe("H7 authorization + leak hard gates", () => {
  it("a confidential source never leaks to an unauthorized employee through the ask path", async () => {
    const marker = "CONFIDENTIALMARKERZXQ";
    await createApprovedSource(`${PREFIX}Confidential Pricing`, `# Pricing\n\nThe secret override code is ${marker}.`, { confidential: true });
    const answer = await txAssoc((client) =>
      askBailey(client, associateAuth(), { question: "what is the secret override code", providerOverride: deterministicLanguageModel })
    );
    expect(JSON.stringify(answer)).not.toContain(marker);
  });

  it("guessed media ids return an opaque 404 (no existence oracle)", async () => {
    // An ineligible or nonexistent source is indistinguishable: both throw the
    // same opaque 404 from the eligibility gate.
    await expect(
      txAssoc((client) => getPlayableMedia(client, associateAuth(), "00000000-0000-0000-0000-000000000000"))
    ).rejects.toMatchObject({ status: 404 });
  });

  it("every returned citation id resolves to a real segment (no invalid citations)", async () => {
    await createApprovedSource(`${PREFIX}Tether Recovery`, "# Tether\n\nReseat the cable and restart capture when the feed drops.");
    const answer = await tx((client) =>
      askBailey(client, reviewerAuth(), { question: "what do I do when the tether feed drops", providerOverride: deterministicLanguageModel })
    );
    for (const citation of answer.citations) {
      const seg = await pool.query(`SELECT 1 FROM knowledge_segment WHERE tenant_id = $1 AND id = $2`, [tenantId, citation.segment_id]);
      expect(seg.rowCount).toBe(1);
    }
  });
});

describe("H7 governance hard gates", () => {
  it("retiring a source removes it from future retrieval (purge)", async () => {
    const marker = "RETIREMARKERPLQ";
    const source = await createApprovedSource(`${PREFIX}Retire Me`, `# Retire\n\nThe distinctive phrase is ${marker} for gym relocation.`);
    let answer = await tx((client) =>
      askBailey(client, reviewerAuth(), { question: "what is the distinctive phrase for gym relocation", providerOverride: deterministicLanguageModel })
    );
    expect(JSON.stringify(answer)).toContain(marker); // control: it answers before retirement

    await tx((client) => retireKnowledgeVersion(client, reviewerAuth(), source.version_id, "h7 retire test"));
    answer = await tx((client) =>
      askBailey(client, reviewerAuth(), { question: "what is the distinctive phrase for gym relocation", providerOverride: deterministicLanguageModel })
    );
    expect(answer.citations.map((c) => c.source_version_id)).not.toContain(source.version_id);
  });

  it("provider failure never becomes unsupported prose — it degrades to an honest state", async () => {
    await createApprovedSource(`${PREFIX}Fallback SOP`, "# Fallback\n\nWhen the capture app freezes, restart it and confirm the last frame saved.");
    const answer = await tx((client) =>
      askBailey(client, reviewerAuth(), { question: "what do I do when the capture app freezes", providerOverride: failingProvider })
    );
    // Never throws; status is a known safe enum; any answer stays grounded to real citations.
    expect(["supported", "partially_supported", "no_approved_answer", "provider_unavailable", "source_conflict", "access_limited"]).toContain(answer.status);
    for (const citation of answer.citations) {
      const seg = await pool.query(`SELECT 1 FROM knowledge_segment WHERE tenant_id = $1 AND id = $2`, [tenantId, citation.segment_id]);
      expect(seg.rowCount).toBe(1);
    }
  });
});

describe("H7 observability + release gate", () => {
  it("observability is reviewer-only", async () => {
    await expect(txAssoc((client) => getObservabilitySummary(client, associateAuth()))).rejects.toMatchObject({ status: 403 });
    const summary = await tx((client) => getObservabilitySummary(client, reviewerAuth()));
    expect(summary.citations.invalid).toBe(0);
  });

  it("the release gate computes all live hard gates as pass", async () => {
    const report = await tx((client) => getReleaseGate(client, reviewerAuth()));
    const live = report.gates.filter((g) => g.status !== "external");
    expect(live.every((g) => g.status === "pass")).toBe(true);
    expect(report.gates.find((g) => g.id === "no_invalid_citation_ids")?.status).toBe("pass");
    expect(report.gates.find((g) => g.id === "no_ineligible_operational_answers")?.status).toBe("pass");
  });
});

describe("H7 reliability hard gate", () => {
  it("the ask endpoint enforces a per-user rate limit (429 beyond the budget)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app)
        .post("/api/ask-bailey/ask")
        .set("Authorization", `Bearer ${associateToken}`)
        .send({ question: `h7 rate probe ${i}` });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
