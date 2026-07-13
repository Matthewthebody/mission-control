import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import { createKnowledgeSource } from "../src/services/knowledge/knowledgeGovernance.js";
import {
  processQueuedIngestionJobs,
  queueIngestionJob,
  retryIngestionJob,
  segmentDocumentText
} from "../src/services/knowledge/knowledgeIngestion.js";
import { parseTimedScript } from "../src/services/ai/providers/transcription.js";

// Ask Bailey Phase C — ingestion. Idempotency and honest failure states are
// the contract: retries never duplicate segments, timestamps always trace to
// stored input, and unprocessable content reports failure instead of faking.

const PREFIX = "ki-test-";
const app = createApp();

let tenantId = "";
let leadershipId = "";

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

beforeAll(async () => {
  const identity = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = identity.rows[0].tenant_id;
  leadershipId = identity.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
});

describe("document segmenter (deterministic)", () => {
  it("splits by markdown headings with stable ordinals and locators", () => {
    const text = "# Tethering\n\nConnect the cable first.\n\n## Recovery\n\nIf the feed drops, reseat the cable.";
    const segments = segmentDocumentText(text);
    expect(segments.map((segment) => segment.locatorLabel)).toEqual([
      "Section: Tethering",
      "Section: Recovery"
    ]);
    expect(segments.map((segment) => segment.ordinal)).toEqual([0, 1]);
    // Re-running on identical input yields identical output.
    expect(segmentDocumentText(text)).toEqual(segments);
  });

  it("packs long sections into bounded parts", () => {
    const paragraph = "A sentence that repeats to force chunking. ".repeat(40);
    const segments = segmentDocumentText(`# Long\n\n${paragraph}\n\n${paragraph}`);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[1].locatorLabel).toContain("part 2");
    for (const segment of segments) {
      expect(segment.content.length).toBeLessThanOrEqual(1000);
    }
  });
});

describe("timed-script parser (deterministic transcription)", () => {
  it("preserves explicit timestamps exactly", () => {
    const script = "[06:42-07:31] Check the tether cable seating.\n[07:31-08:02] Restart Smart Shooter if the feed stays dark.";
    const segments = parseTimedScript(script);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startSeconds: 402, endSeconds: 451 });
    expect(segments[1]).toMatchObject({ startSeconds: 451, endSeconds: 482 });
  });

  it("assigns deterministic sequential windows when no timestamps exist", () => {
    const segments = parseTimedScript("First line.\nSecond line.");
    expect(segments[0]).toMatchObject({ startSeconds: 0, endSeconds: 30 });
    expect(segments[1]).toMatchObject({ startSeconds: 30, endSeconds: 60 });
  });
});

describe("ingestion job lifecycle", () => {
  it("extracts a document, is idempotent per fingerprint, and never duplicates segments on reprocess", async () => {
    const created = await withClientTransaction(tenantId, leadershipId, (client) =>
      createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}doc`,
        sourceType: "written_sop",
        authorityClass: "approved_sop",
        inlineBody: "# Setup\n\nMount the camera.\n\n# Teardown\n\nPack the tether kit last."
      })
    );

    const first = await withClientTransaction(tenantId, leadershipId, (client) =>
      queueIngestionJob(client, tenantId, created.version_id, "document_extract", leadershipId)
    );
    expect(first.created).toBe(true);
    const duplicate = await withClientTransaction(tenantId, leadershipId, (client) =>
      queueIngestionJob(client, tenantId, created.version_id, "document_extract", leadershipId)
    );
    expect(duplicate.created).toBe(false);
    expect(duplicate.job_id).toBe(first.job_id);

    const outcome = await withClientTransaction(tenantId, leadershipId, (client) =>
      processQueuedIngestionJobs(client, tenantId, { limit: 10 })
    );
    expect(outcome.completed).toBeGreaterThanOrEqual(1);

    const segments = await pool.query(
      `SELECT ordinal, heading, locator_label FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, created.version_id]
    );
    expect(segments.rows).toHaveLength(2);
    expect(segments.rows[0].heading).toBe("Setup");

    // Reprocess (e.g. after a retry): segment count must not grow.
    await pool.query(
      `UPDATE knowledge_ingestion_job SET status = 'queued' WHERE tenant_id = $1 AND id = $2`,
      [tenantId, first.job_id]
    );
    await withClientTransaction(tenantId, leadershipId, (client) =>
      processQueuedIngestionJobs(client, tenantId, { limit: 10 })
    );
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, created.version_id]
    );
    expect(after.rows[0].n).toBe(2);
  });

  it("transcribes a timed script into transcript segments with EXACT stored timestamps", async () => {
    const created = await withClientTransaction(tenantId, leadershipId, (client) =>
      createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}video`,
        sourceType: "training_video",
        authorityClass: "approved_training",
        inlineBody: "[00:10-00:45] Seat the tether cable fully.\n[00:45-01:20] Confirm Smart Shooter shows a live feed."
      })
    );
    await withClientTransaction(tenantId, leadershipId, (client) =>
      queueIngestionJob(client, tenantId, created.version_id, "media_transcribe", leadershipId)
    );
    await withClientTransaction(tenantId, leadershipId, (client) =>
      processQueuedIngestionJobs(client, tenantId, { limit: 10 })
    );
    const segments = await pool.query(
      `SELECT segment_kind, locator_label, start_seconds::float, end_seconds::float
       FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, created.version_id]
    );
    expect(segments.rows).toHaveLength(2);
    expect(segments.rows[0]).toMatchObject({ segment_kind: "transcript", start_seconds: 10, end_seconds: 45, locator_label: "00:10–00:45" });
    expect(segments.rows[1]).toMatchObject({ start_seconds: 45, end_seconds: 80 });
  });

  it("reports an honest failure for unprocessable media and supports reviewer retry", async () => {
    const created = await withClientTransaction(tenantId, leadershipId, (client) =>
      createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}no-script`,
        sourceType: "training_video",
        authorityClass: "approved_training"
        // no inline body, no asset note — nothing to transcribe from
      })
    );
    const queued = await withClientTransaction(tenantId, leadershipId, (client) =>
      queueIngestionJob(client, tenantId, created.version_id, "media_transcribe", leadershipId)
    );
    await withClientTransaction(tenantId, leadershipId, (client) =>
      processQueuedIngestionJobs(client, tenantId, { limit: 10 })
    );
    const job = await pool.query(
      `SELECT status, error_message FROM knowledge_ingestion_job WHERE tenant_id = $1 AND id = $2`,
      [tenantId, queued.job_id]
    );
    expect(job.rows[0].status).toBe("failed");
    expect(job.rows[0].error_message).toMatch(/cannot transcribe/i);

    const retried = await withClientTransaction(tenantId, leadershipId, (client) =>
      retryIngestionJob(client, reviewerAuth(), queued.job_id)
    );
    expect(retried.id).toBe(queued.job_id);
    const requeued = await pool.query(
      `SELECT status FROM knowledge_ingestion_job WHERE tenant_id = $1 AND id = $2`,
      [tenantId, queued.job_id]
    );
    expect(requeued.rows[0].status).toBe("queued");
  });

  it("the internal sweep route is secret-gated", async () => {
    const denied = await request(app).post("/api/knowledge/internal/ingestion/sweep").send({});
    expect(denied.status).toBe(403);
  });
});
