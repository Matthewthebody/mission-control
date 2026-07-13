import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  resolveUnresolvedQuestion,
  reviewAnswerReport
} from "../src/services/knowledge/knowledgeGovernance.js";

// Ask Bailey Phase E — the two review actions added for the knowledge-owner
// workflow: answer-report review and unresolved-question resolution. Both are
// reviewer-gated and audited.

const PREFIX = "kr-test-";

let tenantId = "";
let leadershipId = "";
let feedbackId = "";
let questionId = "";

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

const photographerAuth = (): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "standard_employee",
    department: "photography",
    roles: ["photographer"],
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

  const conversation = await pool.query<{ id: string }>(
    `INSERT INTO ai_conversation (tenant_id, user_id, title) VALUES ($1, $2, '${PREFIX}conversation') RETURNING id::text`,
    [tenantId, leadershipId]
  );
  const message = await pool.query<{ id: string }>(
    `INSERT INTO ai_message (tenant_id, conversation_id, user_id, question, status)
     VALUES ($1, $2, $3, '${PREFIX}question', 'supported') RETURNING id::text`,
    [tenantId, conversation.rows[0].id, leadershipId]
  );
  const feedback = await pool.query<{ id: string }>(
    `INSERT INTO ai_message_feedback (tenant_id, message_id, user_id, feedback_kind, note)
     VALUES ($1, $2, $3, 'report_incorrect', '${PREFIX}report') RETURNING id::text`,
    [tenantId, message.rows[0].id, leadershipId]
  );
  feedbackId = feedback.rows[0].id;

  const question = await pool.query<{ id: string }>(
    `INSERT INTO ai_unresolved_question (tenant_id, normalized_question, question_hash, example_question)
     VALUES ($1, '${PREFIX}normalized', '${PREFIX}hash', '${PREFIX}example') RETURNING id::text`,
    [tenantId]
  );
  questionId = question.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM ai_conversation WHERE tenant_id = $1 AND title = '${PREFIX}conversation'`, [tenantId]);
  await pool.query(`DELETE FROM ai_unresolved_question WHERE tenant_id = $1 AND question_hash = '${PREFIX}hash'`, [tenantId]);
});

describe("answer-report review", () => {
  it("rejects non-reviewers", async () => {
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        reviewAnswerReport(client, photographerAuth(), feedbackId, { resolution: "reviewed" })
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("marks an open report reviewed, records the actor, and audits", async () => {
    const result = await withClientTransaction(tenantId, leadershipId, (client) =>
      reviewAnswerReport(client, reviewerAuth(), feedbackId, { resolution: "reviewed" })
    );
    expect(result.review_status).toBe("reviewed");
    const stored = await pool.query(
      `SELECT review_status, reviewed_by_user_id::text FROM ai_message_feedback WHERE tenant_id = $1 AND id = $2`,
      [tenantId, feedbackId]
    );
    expect(stored.rows[0]).toMatchObject({ review_status: "reviewed", reviewed_by_user_id: leadershipId });
    const audit = await pool.query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'knowledge.answer_report_reviewed' AND entity_id = $2`,
      [tenantId, feedbackId]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("a report can only be reviewed once", async () => {
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        reviewAnswerReport(client, reviewerAuth(), feedbackId, { resolution: "dismissed" })
      )
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("unresolved-question resolution", () => {
  it("rejects non-reviewers", async () => {
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        resolveUnresolvedQuestion(client, photographerAuth(), questionId, { resolution: "answered" })
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("resolves an open question and audits the resolution note", async () => {
    const result = await withClientTransaction(tenantId, leadershipId, (client) =>
      resolveUnresolvedQuestion(client, reviewerAuth(), questionId, {
        resolution: "answered",
        note: "Documented in the tether SOP"
      })
    );
    expect(result.status).toBe("answered");
    const stored = await pool.query(
      `SELECT status, resolved_at FROM ai_unresolved_question WHERE tenant_id = $1 AND id = $2`,
      [tenantId, questionId]
    );
    expect(stored.rows[0].status).toBe("answered");
    expect(stored.rows[0].resolved_at).not.toBeNull();
    const audit = await pool.query(
      `SELECT metadata FROM audit_log WHERE tenant_id = $1 AND action = 'knowledge.unresolved_question_resolved' AND entity_id = $2`,
      [tenantId, questionId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({ resolution: "answered", note: "Documented in the tether SOP" });
  });

  it("an already-resolved question cannot be resolved again", async () => {
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        resolveUnresolvedQuestion(client, reviewerAuth(), questionId, { resolution: "dismissed" })
      )
    ).rejects.toMatchObject({ status: 404 });
  });
});
