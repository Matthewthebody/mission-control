import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  approveKnowledgeVersion,
  createKnowledgeSource,
  submitKnowledgeVersionForReview
} from "../src/services/knowledge/knowledgeGovernance.js";
import { processQueuedIngestionJobs, queueIngestionJob } from "../src/services/knowledge/knowledgeIngestion.js";
import {
  acknowledgeLesson,
  addCohortMember,
  approveLessonVersion,
  assignLesson,
  createCohort,
  createLesson,
  createLessonRevision,
  getLessonDetail,
  getMyLesson,
  listLessons,
  listMyAssignments,
  recordSectionViewed,
  retireLessonVersion,
  setCohortState,
  submitLessonVersion,
  submitReadiness
} from "../src/services/training/trainingLessons.js";

// Ask Bailey H6 — Fall Field Coach governed training. Contracts under test:
//  * A lesson is a draft until approved; only an approved version can be assigned.
//  * Assignments PIN a version — retiring/revising never changes what an
//    in-flight assignment teaches.
//  * Employees see questions WITHOUT the correct-answer rubric; managers see it.
//  * Readiness scoring maps misses to review topics; completion needs pass +
//    acknowledgment; nothing here creates discipline.
//  * Pilot cohort gating: assigning through a disabled cohort or to a non-member
//    is refused. Authorization is enforced server-side.

const PREFIX = "h6-test-";
let tenantId = "";
let leadershipId = "";
let associateId = "";

const managerAuth = (): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "leadership",
    department: "executive",
    roles: ["leadership"],
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: [],
    status: "active"
  }) as unknown as AuthUser;

const employeeAuth = (): AuthUser =>
  ({
    id: associateId,
    tenantId,
    authorityTier: "standard_employee",
    department: "schools",
    roles: ["associate_photographer"],
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: [],
    status: "active"
  }) as unknown as AuthUser;

const tx = <T>(fn: (client: import("pg").PoolClient) => Promise<T>) => withClientTransaction(tenantId, leadershipId, fn);
const txEmp = <T>(fn: (client: import("pg").PoolClient) => Promise<T>) => withClientTransaction(tenantId, associateId, fn);

async function createApprovedSource(title: string, body: string) {
  return tx(async (client) => {
    const created = await createKnowledgeSource(client, managerAuth(), {
      title,
      sourceType: "written_sop",
      authorityClass: "approved_sop",
      inlineBody: body
    });
    await queueIngestionJob(client, tenantId, created.version_id, "document_extract", leadershipId);
    await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
    await submitKnowledgeVersionForReview(client, managerAuth(), created.version_id);
    await approveKnowledgeVersion(client, managerAuth(), created.version_id, "h6 test");
    const seg = await client.query<{ id: string }>(
      `SELECT id::text FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal LIMIT 1`,
      [tenantId, created.version_id]
    );
    return { ...created, segmentId: seg.rows[0]?.id ?? null };
  });
}

// A ready-to-assign lesson: draft -> submit -> approve, backed by one source.
async function createApprovedLesson(title: string, sourceVersionId: string, segmentId: string | null) {
  const created = await tx((client) =>
    createLesson(client, managerAuth(), {
      title,
      objective: "Recover a dropped tether feed without losing the line.",
      intended_role: "associate_photographer",
      intended_department: "schools",
      pass_threshold_percent: 50,
      sections: [
        { title: "Reset the feed", section_kind: "reading", body: "Reseat the cable and restart the capture app.", knowledge_source_version_id: sourceVersionId, knowledge_segment_id: segmentId },
        { title: "Escalate early", section_kind: "reading", body: "If two resets fail, escalate to the lead." }
      ],
      questions: [
        {
          prompt: "The tether feed drops mid-session. What is the first move?",
          choices: [
            { id: "a", label: "Reseat the cable and restart capture.", correct: true, explanation: "A calm reseat recovers most drops." },
            { id: "b", label: "Send the class away.", correct: false, explanation: "That is not the first move." }
          ],
          review_section_ordinal: 0
        }
      ]
    })
  );
  await tx((client) => submitLessonVersion(client, managerAuth(), created.version_id));
  await tx((client) => approveLessonVersion(client, managerAuth(), created.version_id, {}));
  return created;
}

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
  await cleanup();
});

afterAll(cleanup);

async function cleanup() {
  await pool.query(`DELETE FROM training_lesson WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
  await pool.query(`DELETE FROM training_pilot_cohort WHERE tenant_id = $1 AND name LIKE '${PREFIX}%'`, [tenantId]);
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
}

describe("H6 governed lessons — the version rule", () => {
  it("a draft lesson cannot be assigned; only an approved version can", async () => {
    const source = await createApprovedSource(`${PREFIX}Tether SOP`, "# Tether\n\nReseat the cable and restart capture.");
    const draft = await tx((client) =>
      createLesson(client, managerAuth(), {
        title: `${PREFIX}Draft Only Lesson`,
        sections: [{ title: "Intro", body: "hello" }]
      })
    );
    // No approved version yet -> assignment refused.
    await expect(
      tx((client) => assignLesson(client, managerAuth(), { lesson_id: draft.lesson_id, user_id: associateId }))
    ).rejects.toMatchObject({ status: 409 });

    // Submit + approve, then assignment works and pins the approved version.
    await tx((client) => submitLessonVersion(client, managerAuth(), draft.version_id));
    await tx((client) => approveLessonVersion(client, managerAuth(), draft.version_id, {}));
    const assignment = await tx((client) => assignLesson(client, managerAuth(), { lesson_id: draft.lesson_id, user_id: associateId }));
    expect(assignment.lesson_version_id).toBe(draft.version_id);
    void source;
  });

  it("revising and retiring never changes what an already-assigned version teaches", async () => {
    const source = await createApprovedSource(`${PREFIX}Recovery SOP`, "# Recovery\n\nEscalate after two failed resets.");
    const lesson = await createApprovedLesson(`${PREFIX}Recovery Lesson`, source.version_id, source.segmentId);
    const assignment = await tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: associateId }));

    // A revision is a new draft; the assignment still points at the approved v1.
    const revision = await tx((client) => createLessonRevision(client, managerAuth(), lesson.lesson_id, { copyFromCurrent: true }));
    expect(revision.version_id).not.toBe(lesson.version_id);
    // Second concurrent revision refused.
    await expect(
      tx((client) => createLessonRevision(client, managerAuth(), lesson.lesson_id, {}))
    ).rejects.toMatchObject({ status: 409 });

    const myLesson = await txEmp((client) => getMyLesson(client, employeeAuth(), assignment.assignment_id));
    expect(myLesson.lesson.version_number).toBe(1); // still the pinned approved v1

    // Retire the approved v1: lesson has no current version, but the pinned
    // assignment still teaches v1.
    await tx((client) => retireLessonVersion(client, managerAuth(), lesson.version_id, "superseded by field change"));
    const stillTeaches = await txEmp((client) => getMyLesson(client, employeeAuth(), assignment.assignment_id));
    expect(stillTeaches.sections.length).toBeGreaterThan(0);
  });
});

describe("H6 employee experience + readiness", () => {
  it("employees never see the correct-answer rubric; managers do", async () => {
    const source = await createApprovedSource(`${PREFIX}Rubric SOP`, "# Rubric\n\nReseat and restart.");
    const lesson = await createApprovedLesson(`${PREFIX}Rubric Lesson`, source.version_id, source.segmentId);
    const assignment = await tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: associateId }));

    const managerView = await tx((client) => getLessonDetail(client, managerAuth(), lesson.lesson_id));
    const managerChoices = (managerView.questions[0].choices as Array<{ correct?: boolean }>);
    expect(managerChoices.some((c) => "correct" in c)).toBe(true);

    const employeeView = await txEmp((client) => getMyLesson(client, employeeAuth(), assignment.assignment_id));
    const empChoices = employeeView.questions[0].choices as Array<Record<string, unknown>>;
    expect(empChoices.every((c) => !("correct" in c) && !("explanation" in c))).toBe(true);
  });

  it("readiness scores against the rubric, maps misses to review topics, and completes only with pass + acknowledgment", async () => {
    const source = await createApprovedSource(`${PREFIX}Ready SOP`, "# Ready\n\nReseat and restart.");
    const lesson = await createApprovedLesson(`${PREFIX}Ready Lesson`, source.version_id, source.segmentId);
    const assignment = await tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: associateId }));
    const view = await txEmp((client) => getMyLesson(client, employeeAuth(), assignment.assignment_id));
    const qId = view.questions[0].id;

    // Wrong answer -> incorrect, coaching cites the review section, not passed.
    const failed = await txEmp((client) => submitReadiness(client, employeeAuth(), assignment.assignment_id, { [qId]: "b" }));
    expect(failed.passed).toBe(false);
    expect(failed.feedback[0].result).toBe("incorrect");
    expect(failed.feedback[0].review_topic).toBe("Reset the feed");

    // Correct answer but not acknowledged -> passed the check but assignment not complete.
    const passedNoAck = await txEmp((client) => submitReadiness(client, employeeAuth(), assignment.assignment_id, { [qId]: "a" }));
    expect(passedNoAck.passed).toBe(true);
    let status = await pool.query(`SELECT status FROM training_lesson_assignment WHERE tenant_id = $1 AND id = $2`, [tenantId, assignment.assignment_id]);
    expect(status.rows[0].status).not.toBe("completed");

    // Acknowledge + pass -> completed.
    await txEmp((client) => acknowledgeLesson(client, employeeAuth(), assignment.assignment_id));
    await txEmp((client) => submitReadiness(client, employeeAuth(), assignment.assignment_id, { [qId]: "a" }));
    status = await pool.query(`SELECT status FROM training_lesson_assignment WHERE tenant_id = $1 AND id = $2`, [tenantId, assignment.assignment_id]);
    expect(status.rows[0].status).toBe("completed");
  });

  it("recording a viewed section advances progress and flips assigned -> in_progress", async () => {
    const source = await createApprovedSource(`${PREFIX}Progress SOP`, "# Progress\n\nReseat and restart.");
    const lesson = await createApprovedLesson(`${PREFIX}Progress Lesson`, source.version_id, source.segmentId);
    const assignment = await tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: associateId }));
    const view = await txEmp((client) => getMyLesson(client, employeeAuth(), assignment.assignment_id));
    const first = await txEmp((client) => recordSectionViewed(client, employeeAuth(), assignment.assignment_id, view.sections[0].id));
    expect(first.progress_percent).toBe(50); // 1 of 2 sections
    const mine = await txEmp((client) => listMyAssignments(client, employeeAuth()));
    const row = mine.assignments.find((a: { id: string }) => a.id === assignment.assignment_id);
    expect(row.status).toBe("in_progress");
  });
});

describe("H6 authorization + pilot gating", () => {
  it("employees cannot author, assign, or list governed lessons", async () => {
    await expect(txEmp((client) => listLessons(client, employeeAuth(), {}))).rejects.toMatchObject({ status: 403 });
    await expect(
      txEmp((client) => createLesson(client, employeeAuth(), { title: `${PREFIX}nope`, sections: [{ title: "x", body: "y" }] }))
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      txEmp((client) => assignLesson(client, employeeAuth(), { lesson_id: leadershipId, user_id: associateId }))
    ).rejects.toMatchObject({ status: 403 });
  });

  it("an employee cannot open another employee's assignment", async () => {
    const source = await createApprovedSource(`${PREFIX}Private SOP`, "# Private\n\nReseat.");
    const lesson = await createApprovedLesson(`${PREFIX}Private Lesson`, source.version_id, source.segmentId);
    // Assign to leadership (a different user than the associate employeeAuth()).
    const assignment = await tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: leadershipId }));
    await expect(
      txEmp((client) => getMyLesson(client, employeeAuth(), assignment.assignment_id))
    ).rejects.toMatchObject({ status: 404 });
  });

  it("assigning through a disabled cohort or to a non-member is refused; enabling + membership allows it", async () => {
    const source = await createApprovedSource(`${PREFIX}Cohort SOP`, "# Cohort\n\nReseat.");
    const lesson = await createApprovedLesson(`${PREFIX}Cohort Lesson`, source.version_id, source.segmentId);
    const cohort = await tx((client) => createCohort(client, managerAuth(), { name: `${PREFIX}Fall Pilot`, is_demo: true }));

    // Disabled by default -> refused.
    await expect(
      tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: associateId, cohort_id: cohort.cohort_id }))
    ).rejects.toMatchObject({ status: 409 });

    await tx((client) => setCohortState(client, managerAuth(), cohort.cohort_id, { enabled: true, status: "active" }));
    // Enabled but not a member -> refused.
    await expect(
      tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: associateId, cohort_id: cohort.cohort_id }))
    ).rejects.toMatchObject({ status: 409 });

    await tx((client) => addCohortMember(client, managerAuth(), cohort.cohort_id, associateId));
    const assignment = await tx((client) => assignLesson(client, managerAuth(), { lesson_id: lesson.lesson_id, user_id: associateId, cohort_id: cohort.cohort_id }));
    expect(assignment.assignment_id).toBeTruthy();
  });
});

describe("H6 source-backed section integrity", () => {
  it("refuses a video clip range on a segment that has no real timestamps", async () => {
    const source = await createApprovedSource(`${PREFIX}NoTs SOP`, "# NoTs\n\nText only, no media.");
    await expect(
      tx((client) =>
        createLesson(client, managerAuth(), {
          title: `${PREFIX}Bad Clip Lesson`,
          sections: [
            { title: "Clip", section_kind: "video_clip", knowledge_segment_id: source.segmentId, media_start_seconds: 5, media_end_seconds: 10 }
          ]
        })
      )
    ).rejects.toMatchObject({ status: 400 });
  });
});
