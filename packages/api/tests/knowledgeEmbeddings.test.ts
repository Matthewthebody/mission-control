import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { processPendingEmbeddings } from "../src/services/knowledge/knowledgeEmbeddings.js";
import { deterministicEmbed, cosineSimilarity } from "../src/services/ai/providers/embedding.js";
import { retrieveSegmentsHybrid } from "../src/services/ai/retrieval.js";
import type { EmbeddingProvider } from "../src/services/ai/providers/types.js";

// Ask Bailey H1-C — embedding lifecycle. The contract: idempotent per
// (segment, provider, model, fingerprint); content changes re-embed; segment
// replacement CASCADE-deletes vectors; provider outage is an honest state
// that consumes nothing; and the semantic path can never resurrect retired
// content because eligibility is joined into the vector query itself.

const PREFIX = "ke-test-";

let tenantId = "";
let leadershipId = "";
let versionId = "";

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

async function drainEmbeddings(provider?: EmbeddingProvider) {
  let total = 0;
  for (let round = 0; round < 10; round += 1) {
    const outcome = await withClientTransaction(tenantId, leadershipId, (client) =>
      processPendingEmbeddings(client, tenantId, { limit: 32, provider })
    );
    total += outcome.embedded;
    if (outcome.embedded === 0) return { total, last: outcome };
  }
  return { total, last: null };
}

async function embeddingRows() {
  const { rows } = await pool.query<{ status: string; content_fingerprint: string; dims: number }>(
    `SELECT e.status, e.content_fingerprint, cardinality(e.embedding) AS dims
     FROM knowledge_segment_embedding e
     WHERE e.tenant_id = $1 AND e.source_version_id = $2
     ORDER BY e.created_at`,
    [tenantId, versionId]
  );
  return rows;
}

beforeAll(async () => {
  const identity = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = identity.rows[0].tenant_id;
  leadershipId = identity.rows[0].id;

  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);

  await withClientTransaction(tenantId, leadershipId, async (client) => {
    const created = await createKnowledgeSource(client, reviewerAuth(), {
      title: `${PREFIX}Skylight Rig SOP`,
      sourceType: "written_sop",
      authorityClass: "approved_sop",
      inlineBody: "# Skylight Rig\n\nAim the skylight rig at the north wall before noon sessions."
    });
    versionId = created.version_id;
    await queueIngestionJob(client, tenantId, versionId, "document_extract", leadershipId);
    await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
    await submitKnowledgeVersionForReview(client, reviewerAuth(), versionId);
    await approveKnowledgeVersion(client, reviewerAuth(), versionId, "test");
  });
});

afterAll(async () => {
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
});

describe("deterministic embedding adapter", () => {
  it("is deterministic and similarity-meaningful for word-form variation", () => {
    const a = deterministicEmbed("the image dropped during transfer");
    const b = deterministicEmbed("the image dropped during transfer");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    const typo = deterministicEmbed("the image droped during transfer");
    const unrelated = deterministicEmbed("payroll compensation band January review");
    expect(cosineSimilarity(a, typo)).toBeGreaterThan(0.8);
    expect(cosineSimilarity(a, unrelated)).toBeLessThan(0.35);
  });
});

describe("embedding lifecycle", () => {
  it("embeds approved segments idempotently by fingerprint", async () => {
    const first = await drainEmbeddings();
    expect(first.total).toBeGreaterThanOrEqual(1);
    const rows = await embeddingRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.status === "completed" && row.dims === 256)).toBe(true);

    // Re-running the sweep with unchanged content embeds nothing new.
    const second = await drainEmbeddings();
    expect(second.total).toBe(0);
  });

  it("re-embeds when the content fingerprint changes", async () => {
    const before = await embeddingRows();
    await pool.query(
      `UPDATE knowledge_segment SET content = content || ' Updated wording.', updated_at = now()
       WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, versionId]
    );
    const sweep = await drainEmbeddings();
    expect(sweep.total).toBeGreaterThanOrEqual(1);
    const after = await embeddingRows();
    expect(after.every((row) => row.status === "completed")).toBe(true);
    expect(after.map((row) => row.content_fingerprint)).not.toEqual(before.map((row) => row.content_fingerprint));
  });

  it("reports an honest not_configured state without consuming rows", async () => {
    await pool.query(
      `UPDATE knowledge_segment SET content = content || ' Another change.', updated_at = now()
       WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, versionId]
    );
    const unconfigured: EmbeddingProvider = {
      name: "openai_compatible",
      model: "unset",
      async embed() {
        return { status: "not_configured", reason: "missing credentials" };
      }
    };
    const outcome = await withClientTransaction(tenantId, leadershipId, (client) =>
      processPendingEmbeddings(client, tenantId, { limit: 32, provider: unconfigured })
    );
    expect(outcome.not_configured).toBe(true);
    expect(outcome.embedded).toBe(0);
    const pendingForProvider = await pool.query(
      `SELECT count(*)::int AS n FROM knowledge_segment_embedding
       WHERE tenant_id = $1 AND provider = 'openai_compatible' AND status = 'pending'`,
      [tenantId]
    );
    expect(pendingForProvider.rows[0].n).toBeGreaterThanOrEqual(1);
    await pool.query(
      `DELETE FROM knowledge_segment_embedding WHERE tenant_id = $1 AND provider = 'openai_compatible'`,
      [tenantId]
    );
    // Restore the deterministic rows for the changed content.
    await drainEmbeddings();
  });

  it("records failures with attempts and retries later", async () => {
    await pool.query(
      `UPDATE knowledge_segment SET content = content || ' Yet another change.', updated_at = now()
       WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, versionId]
    );
    const failing: EmbeddingProvider = {
      name: "deterministic",
      model: "char-trigram-hash-v1",
      async embed() {
        return { status: "failed", reason: "simulated outage" };
      }
    };
    const outcome = await withClientTransaction(tenantId, leadershipId, (client) =>
      processPendingEmbeddings(client, tenantId, { limit: 32, provider: failing })
    );
    expect(outcome.failed).toBeGreaterThanOrEqual(1);
    const failedRows = await pool.query(
      `SELECT attempts, error_message FROM knowledge_segment_embedding
       WHERE tenant_id = $1 AND source_version_id = $2 AND status = 'failed'`,
      [tenantId, versionId]
    );
    expect(failedRows.rows.length).toBeGreaterThanOrEqual(1);
    expect(failedRows.rows[0].error_message).toContain("simulated outage");

    // The real provider retries the failed rows on the next sweep.
    const recovery = await drainEmbeddings();
    expect(recovery.total).toBeGreaterThanOrEqual(1);
    const statuses = await embeddingRows();
    expect(statuses.every((row) => row.status === "completed")).toBe(true);
  });

  it("segment replacement (re-ingestion) cascades vectors away", async () => {
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM knowledge_segment_embedding WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, versionId]
    );
    expect(before.rows[0].n).toBeGreaterThanOrEqual(1);
    await withClientTransaction(tenantId, leadershipId, async (client) => {
      await client.query(
        `UPDATE knowledge_source_version SET inline_body = '# Skylight Rig\n\nCompletely rewritten rig guidance.', updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, versionId]
      );
      await queueIngestionJob(client, tenantId, versionId, "document_extract", leadershipId);
      await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
    });
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM knowledge_segment_embedding WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, versionId]
    );
    expect(after.rows[0].n).toBe(0);
  });

  it("a retired version's vectors can never answer (eligibility joined into the vector path)", async () => {
    await drainEmbeddings();
    const beforeRetire = await withClientTransaction(tenantId, leadershipId, (client) =>
      retrieveSegmentsHybrid(client, reviewerAuth(), "operational", "skylight rig north wall", null)
    );
    expect(beforeRetire.rows.length).toBeGreaterThanOrEqual(1);

    await withClientTransaction(tenantId, leadershipId, (client) =>
      retireKnowledgeVersion(client, reviewerAuth(), versionId, "test retirement")
    );
    const stillStored = await pool.query(
      `SELECT count(*)::int AS n FROM knowledge_segment_embedding WHERE tenant_id = $1 AND source_version_id = $2 AND status = 'completed'`,
      [tenantId, versionId]
    );
    expect(stillStored.rows[0].n).toBeGreaterThanOrEqual(1);

    const afterRetire = await withClientTransaction(tenantId, leadershipId, (client) =>
      retrieveSegmentsHybrid(client, reviewerAuth(), "operational", "skylight rig north wall", null)
    );
    expect(afterRetire.rows).toHaveLength(0);
  });
});
