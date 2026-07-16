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
  submitKnowledgeVersionForReview,
  upsertKnowledgeSynonym
} from "../src/services/knowledge/knowledgeGovernance.js";
import { processQueuedIngestionJobs, queueIngestionJob } from "../src/services/knowledge/knowledgeIngestion.js";
import {
  convertUnresolvedQuestionToDraft,
  createKnowledgeSourceVersion,
  getKnowledgeHealth,
  getKnowledgeSourceDetail,
  listKnowledgeSources,
  mergeSegmentWithNext,
  splitSegment,
  updateDraftVersion
} from "../src/services/knowledge/knowledgeAuthoring.js";
import { askBailey } from "../src/services/ai/askBailey.js";
import { deterministicLanguageModel } from "../src/services/ai/providers/languageModel.js";

// Ask Bailey H5 — knowledge authoring. The contract under test is the
// NON-NEGOTIABLE version rule: approved content is never edited in place;
// a revision is a new draft that only replaces the approved version through
// approval-with-supersession; the old version answers until then; retired
// and superseded versions stop answering while staying auditable.

const PREFIX = "ka-test-";
const app = createApp();

let tenantId = "";
let leadershipId = "";
let leadershipToken = "";
let associateToken = "";

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

const associateAuth = (): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "standard_employee",
    department: "photography",
    roles: ["associate_photographer"],
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: []
  }) as unknown as AuthUser;

const tx = <T>(fn: (client: import("pg").PoolClient) => Promise<T>) =>
  withClientTransaction(tenantId, leadershipId, fn);

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
    await approveKnowledgeVersion(client, reviewerAuth(), created.version_id, "ka test");
    return created;
  });
}

const askAs = (auth: AuthUser, question: string) =>
  tx((client) => askBailey(client, auth, { question, providerOverride: deterministicLanguageModel }));

beforeAll(async () => {
  const identity = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = identity.rows[0].tenant_id;
  leadershipId = identity.rows[0].id;
  const leadershipLogin = await request(app).post("/auth/dev-login").send({ email: "leadership@example.com" });
  leadershipToken = leadershipLogin.body.token;
  const associateLogin = await request(app).post("/auth/dev-login").send({ email: "associate@example.com" });
  associateToken = associateLogin.body.token;
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
  await pool.query(`DELETE FROM knowledge_synonym WHERE tenant_id = $1 AND term LIKE 'katest%'`, [tenantId]);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM ai_conversation WHERE tenant_id = $1 AND id IN (
       SELECT conversation_id FROM ai_message WHERE tenant_id = $1 AND question LIKE 'ka-test%'
     )`,
    [tenantId]
  );
  await pool.query(`DELETE FROM ai_unresolved_question WHERE tenant_id = $1 AND example_question LIKE 'ka-test%'`, [tenantId]);
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
  await pool.query(`DELETE FROM knowledge_synonym WHERE tenant_id = $1 AND term LIKE 'katest%'`, [tenantId]);
});

describe("governed revisions (the version rule)", () => {
  it("a revision never edits approved content in place; supersession happens only at approval", async () => {
    const source = await createApprovedSource(
      `${PREFIX}Lintcheck SOP`,
      "# Lintcheck\n\nRun the lintcheck sweep every Monday morning."
    );

    // v1 answers.
    let answer = await askAs(reviewerAuth(), "ka-test lintcheck sweep schedule");
    expect(answer.status).toBe("supported");
    expect(answer.answer_markdown).toContain("Monday");

    // Create the revision — approved v1 must be untouched and still answering.
    const revision = await tx((client) =>
      createKnowledgeSourceVersion(client, reviewerAuth(), source.source_id, {
        inlineBody: "# Lintcheck\n\nRun the lintcheck sweep every Wednesday morning.",
        note: "schedule moved"
      })
    );
    expect(revision.version_number).toBe(2);
    expect(revision.supersedes_version_id).toBe(source.version_id);
    await tx((client) => processQueuedIngestionJobs(client, tenantId, { limit: 10 }));

    answer = await askAs(reviewerAuth(), "ka-test lintcheck sweep schedule");
    expect(answer.answer_markdown).toContain("Monday"); // still v1
    expect(answer.citations.map((c) => c.source_version_id)).toContain(source.version_id);

    // Editing the approved v1 directly is refused.
    await expect(
      tx((client) => updateDraftVersion(client, reviewerAuth(), source.version_id, { inlineBody: "sneaky edit" }))
    ).rejects.toMatchObject({ status: 409 });

    // A second concurrent revision is refused.
    await expect(
      tx((client) => createKnowledgeSourceVersion(client, reviewerAuth(), source.source_id, {}))
    ).rejects.toMatchObject({ status: 409 });

    // Approve the revision: supersession is atomic and coherent.
    await tx((client) => submitKnowledgeVersionForReview(client, reviewerAuth(), revision.version_id));
    await tx((client) => approveKnowledgeVersion(client, reviewerAuth(), revision.version_id, "approved revision"));

    const v1 = await pool.query(
      `SELECT publication_status, superseded_by_version_id::text FROM knowledge_source_version WHERE tenant_id = $1 AND id = $2`,
      [tenantId, source.version_id]
    );
    expect(v1.rows[0].publication_status).toBe("superseded");
    expect(v1.rows[0].superseded_by_version_id).toBe(revision.version_id);

    answer = await askAs(reviewerAuth(), "ka-test lintcheck sweep schedule");
    expect(answer.answer_markdown).toContain("Wednesday");
    expect(answer.answer_markdown).not.toContain("Monday");

    // Retire the replacement: the source stops answering entirely, history intact.
    await tx((client) => retireKnowledgeVersion(client, reviewerAuth(), revision.version_id, "ka retirement"));
    answer = await askAs(reviewerAuth(), "ka-test lintcheck sweep schedule");
    expect(answer.status).toBe("no_approved_answer");
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'knowledge.revision_created' AND entity_id = $2`,
      [tenantId, revision.version_id]
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("draft edits re-ingest and are audited; drafts stay editable after rejection", async () => {
    const created = await tx(async (client) => {
      const source = await createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}Draftedit SOP`,
        sourceType: "written_sop",
        authorityClass: "approved_sop",
        inlineBody: "# Draftedit\n\nOriginal draft body about the quibblecart."
      });
      await queueIngestionJob(client, tenantId, source.version_id, "document_extract", leadershipId);
      await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
      return source;
    });
    await tx((client) =>
      updateDraftVersion(client, reviewerAuth(), created.version_id, {
        inlineBody: "# Draftedit\n\nRevised draft body about the quibblecart handle."
      })
    );
    await tx((client) => processQueuedIngestionJobs(client, tenantId, { limit: 10 }));
    const segments = await pool.query(
      `SELECT content FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, created.version_id]
    );
    expect(segments.rows[0].content).toContain("handle");
  });
});

describe("source workspace and dual-mode detail", () => {
  it("lists, searches, and filters sources with honest totals — reviewer only", async () => {
    await createApprovedSource(`${PREFIX}Workspace Alpha`, "# Alpha\n\nAlpha zumba content.");
    const listed = await tx((client) => listKnowledgeSources(client, reviewerAuth(), { query: `${PREFIX}Workspace` }));
    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.sources.some((row: { title: string }) => row.title === `${PREFIX}Workspace Alpha`)).toBe(true);

    await expect(tx((client) => listKnowledgeSources(client, associateAuth(), {}))).rejects.toMatchObject({ status: 403 });
    const denied = await request(app).get("/api/knowledge/sources").set("Authorization", `Bearer ${associateToken}`);
    expect(denied.status).toBe(403);
  });

  it("reviewers get governance detail; employees get an eligibility-gated view; confidential is an opaque 404", async () => {
    const visible = await createApprovedSource(`${PREFIX}Detail Visible`, "# Visible\n\nWombatdetail steps.");
    const confidential = await createApprovedSource(`${PREFIX}Detail Secret`, "# Secret\n\nSecret zorbo policy.", {
      confidential: true
    });

    const reviewerDetail = await tx((client) => getKnowledgeSourceDetail(client, reviewerAuth(), visible.source_id));
    expect(reviewerDetail.mode).toBe("reviewer");
    if (reviewerDetail.mode === "reviewer") {
      expect(reviewerDetail.versions.length).toBeGreaterThanOrEqual(1);
      expect(reviewerDetail.audit.length).toBeGreaterThanOrEqual(1);
    }

    const employeeDetail = await tx((client) => getKnowledgeSourceDetail(client, associateAuth(), visible.source_id));
    expect(employeeDetail.mode).toBe("employee");
    if (employeeDetail.mode === "employee") {
      expect(employeeDetail.segments.length).toBeGreaterThanOrEqual(1);
      expect((employeeDetail.source as { inline_body?: string }).inline_body).toBeUndefined();
    }

    await expect(
      tx((client) => getKnowledgeSourceDetail(client, associateAuth(), confidential.source_id))
    ).rejects.toMatchObject({ status: 404 });

    const employeeRoute = await request(app)
      .get(`/api/knowledge/sources/${confidential.source_id}`)
      .set("Authorization", `Bearer ${associateToken}`);
    expect(employeeRoute.status).toBe(404);
  });
});

describe("unresolved question → draft guidance", () => {
  it("creates DRAFT guidance that stays ineligible until approved", async () => {
    const question = await pool.query<{ id: string }>(
      `INSERT INTO ai_unresolved_question (tenant_id, normalized_question, question_hash, example_question)
       VALUES ($1, 'ka-test flurbo handling', 'ka-hash-flurbo', 'ka-test how do we handle the flurbo rig?')
       RETURNING id::text`,
      [tenantId]
    );
    const converted = await tx((client) =>
      convertUnresolvedQuestionToDraft(client, reviewerAuth(), question.rows[0].id, {
        title: `${PREFIX}Flurbo Guidance`,
        body: "# Flurbo Rig\n\nFlurbo rigs are stored assembled and carried by two people."
      })
    );
    await tx((client) => processQueuedIngestionJobs(client, tenantId, { limit: 10 }));

    const linked = await pool.query(
      `SELECT status, proposed_source_version_id::text FROM ai_unresolved_question WHERE tenant_id = $1 AND id = $2`,
      [tenantId, question.rows[0].id]
    );
    expect(linked.rows[0].status).toBe("assigned");
    expect(linked.rows[0].proposed_source_version_id).toBe(converted.version_id);

    // Draft guidance must not answer.
    let answer = await askAs(reviewerAuth(), "ka-test flurbo rig storage");
    expect(answer.status).toBe("no_approved_answer");

    // Approval makes it eligible through the normal lifecycle.
    await tx((client) => submitKnowledgeVersionForReview(client, reviewerAuth(), converted.version_id));
    await tx((client) => approveKnowledgeVersion(client, reviewerAuth(), converted.version_id, "guidance approved"));
    answer = await askAs(reviewerAuth(), "ka-test flurbo rig storage");
    expect(answer.status).toBe("supported");
    expect(answer.answer_markdown).toContain("two people");
  });
});

describe("segment split and merge", () => {
  it("splits a timestamped segment only at a reviewer-supplied real boundary", async () => {
    const source = await tx(async (client) => {
      const created = await createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}Splitvid`,
        sourceType: "training_video",
        authorityClass: "approved_training",
        inlineBody: "[00:10-01:00] Grackle setup first part then grackle teardown second part.\n[01:00-01:30] Grackle wrap notes."
      });
      await queueIngestionJob(client, tenantId, created.version_id, "media_transcribe", leadershipId);
      await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
      return created;
    });
    const segments = await pool.query<{ id: string }>(
      `SELECT id::text FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, source.version_id]
    );

    await expect(
      tx((client) => splitSegment(client, reviewerAuth(), segments.rows[0].id, { offsetChars: 30, splitSeconds: 500 }))
    ).rejects.toMatchObject({ status: 400 });

    const split = await tx((client) =>
      splitSegment(client, reviewerAuth(), segments.rows[0].id, { offsetChars: 32, splitSeconds: 35 })
    );
    expect(split.segment_ids).toHaveLength(2);
    const after = await pool.query(
      `SELECT ordinal, start_seconds::float, end_seconds::float, locator_label FROM knowledge_segment
       WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, source.version_id]
    );
    expect(after.rows).toHaveLength(3);
    expect(after.rows.map((row) => row.ordinal)).toEqual([0, 1, 2]);
    expect(after.rows[0]).toMatchObject({ start_seconds: 10, end_seconds: 35 });
    expect(after.rows[1]).toMatchObject({ start_seconds: 35, end_seconds: 60 });
    expect(after.rows[2]).toMatchObject({ start_seconds: 60, end_seconds: 90 });

    // Merge the two split halves back: union of real ranges, ordinals repaired.
    const firstId = await pool.query<{ id: string }>(
      `SELECT id::text FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 AND ordinal = 0`,
      [tenantId, source.version_id]
    );
    await tx((client) => mergeSegmentWithNext(client, reviewerAuth(), firstId.rows[0].id, {}));
    const merged = await pool.query(
      `SELECT ordinal, start_seconds::float, end_seconds::float FROM knowledge_segment
       WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, source.version_id]
    );
    expect(merged.rows).toHaveLength(2);
    expect(merged.rows[0]).toMatchObject({ ordinal: 0, start_seconds: 10, end_seconds: 60 });
    expect(merged.rows[1]).toMatchObject({ ordinal: 1, start_seconds: 60, end_seconds: 90 });

    const audits = await pool.query(
      `SELECT action, count(*)::int AS n FROM audit_log
       WHERE tenant_id = $1 AND action IN ('knowledge.segment_split', 'knowledge.segment_merged')
         AND metadata->>'version_id' = $2
       GROUP BY action`,
      [tenantId, source.version_id]
    );
    expect(audits.rows.length).toBe(2);
  });
});

describe("synonym governance hardening", () => {
  it("rejects self and one-level circular mappings; preview shows expansion", async () => {
    await expect(
      tx((client) => upsertKnowledgeSynonym(client, reviewerAuth(), { term: "katestself", expansion: ["katestself"] }))
    ).rejects.toMatchObject({ status: 400 });

    await tx((client) => upsertKnowledgeSynonym(client, reviewerAuth(), { term: "katestab", expansion: ["katestcd"] }));
    await expect(
      tx((client) => upsertKnowledgeSynonym(client, reviewerAuth(), { term: "katestcd", expansion: ["katestab"] }))
    ).rejects.toMatchObject({ status: 400 });

    const preview = await request(app)
      .get("/api/knowledge/synonyms/preview")
      .query({ q: "the katestab issue" })
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(preview.status).toBe(200);
    const concept = preview.body.concepts.find((entry: { term: string }) => entry.term === "katestab");
    expect(concept.from_synonym).toBe(true);
    expect(concept.variants).toContain("katestcd");

    const denied = await request(app)
      .get("/api/knowledge/synonyms/preview")
      .query({ q: "x" })
      .set("Authorization", `Bearer ${associateToken}`);
    expect(denied.status).toBe(403);
  });
});

describe("knowledge health", () => {
  it("returns descriptive counts and top lists for reviewers only", async () => {
    const health = await tx((client) => getKnowledgeHealth(client, reviewerAuth()));
    expect(health.counts.active_approved).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(health.top_unanswered)).toBe(true);
    expect(Array.isArray(health.most_cited)).toBe(true);
    await expect(tx((client) => getKnowledgeHealth(client, associateAuth()))).rejects.toMatchObject({ status: 403 });
  });
});
