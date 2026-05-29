import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seedTrainingState } from "../src/services/training.js";
import { passwordLogin } from "./helpers.js";

const app = createApp();

let tenantId = "";
let leadershipToken = "";
let photoToken = "";
let officeToken = "";
let leadershipUserId = "";
let photoUserId = "";

beforeAll(async () => {
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  photoToken = (await passwordLogin(app, "photo@example.com")).body.token;
  officeToken = (await passwordLogin(app, "office@example.com")).body.token;

  const tenantRow = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenantRow.rows[0].id as string;

  const people = await pool.query(
    `
      SELECT id, email
      FROM app_user
      WHERE tenant_id = $1
        AND lower(email) IN (lower('leadership@example.com'), lower('photo@example.com'))
    `,
    [tenantId]
  );

  leadershipUserId = people.rows.find((row) => row.email === "leadership@example.com")?.id as string;
  photoUserId = people.rows.find((row) => row.email === "photo@example.com")?.id as string;
});

beforeEach(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM training_quiz_attempt WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM training_checkpoint_result WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM training_acknowledgement_state WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM training_module_progress WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM training_profile_state WHERE tenant_id = $1", [tenantId]);
    await seedTrainingState(client, tenantId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}, 30000);

describe("training API", () => {
  it("lets leadership view org training while field users only see their own profile", async () => {
    const [leadershipProfiles, leadershipDashboard, photoProfiles, officeProfiles] = await Promise.all([
      request(app).get("/api/training/profiles").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/training/dashboard").set("Authorization", `Bearer ${leadershipToken}`),
      request(app).get("/api/training/profiles").set("Authorization", `Bearer ${photoToken}`),
      request(app).get("/api/training/profiles").set("Authorization", `Bearer ${officeToken}`)
    ]);

    expect(leadershipProfiles.status).toBe(200);
    expect(leadershipProfiles.body.length).toBeGreaterThan(1);
    expect(leadershipProfiles.body.some((profile: { employee: { email: string } }) => profile.employee.email === "photo@example.com")).toBe(true);

    expect(leadershipDashboard.status).toBe(200);
    expect(leadershipDashboard.body).toMatchObject({
      org_completion_percent: expect.any(Number),
      overdue_module_count: expect.any(Number),
      completion_by_team: expect.any(Array)
    });

    expect(photoProfiles.status).toBe(200);
    expect(photoProfiles.body).toHaveLength(1);
    expect(photoProfiles.body[0].employee.email).toBe("photo@example.com");

    expect(officeProfiles.status).toBe(200);
    expect(officeProfiles.body).toHaveLength(1);
    expect(officeProfiles.body[0].employee.email).toBe("office@example.com");
  }, 15000);

  it("creates a five-question round and persists quiz history back into the employee profile", async () => {
    const beforeAttempts = await pool.query(
      `
        SELECT count(*)::int AS count
        FROM training_quiz_attempt
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      [tenantId, photoUserId]
    );

    const round = await request(app)
      .post("/api/training/quiz-rounds")
      .set("Authorization", `Bearer ${photoToken}`)
      .send({ mode: "dashboard" });

    expect(round.status).toBe(201);
    expect(round.body.round.question_ids).toHaveLength(5);
    expect(round.body.questions).toHaveLength(5);

    const answers = Object.fromEntries(
      round.body.questions.map((question: { id: string; choices: Array<{ id: string; correct: boolean }> }) => [
        question.id,
        question.choices.find((choice) => choice.correct)?.id ?? question.choices[0]?.id
      ])
    );

    const submitted = await request(app)
      .post("/api/training/quiz-attempts")
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        round: round.body.round,
        answers
      });

    expect(submitted.status).toBe(201);
    expect(submitted.body.attempt.question_count).toBe(5);
    expect(submitted.body.attempt.score_percent).toBeGreaterThanOrEqual(submitted.body.round?.pass_threshold ?? 0);
    expect(submitted.body.profile.employee.email).toBe("photo@example.com");
    expect(submitted.body.profile.quiz_history[0].id).toBe(submitted.body.attempt.id);

    const storedAttempts = await pool.query(
      `
        SELECT score_percent, passed
        FROM training_quiz_attempt
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY played_at DESC, created_at DESC
      `,
      [tenantId, photoUserId]
    );
    expect(storedAttempts.rows).toHaveLength(Number(beforeAttempts.rows[0].count) + 1);
    expect(Number(storedAttempts.rows[0].score_percent)).toBe(submitted.body.attempt.score_percent);
    expect(Boolean(storedAttempts.rows[0].passed)).toBe(true);
  }, 20000);

  it("persists leadership sign-off updates and marks completed signoff-required modules complete", async () => {
    await pool.query(
      `
        UPDATE training_module_progress
        SET
          status = 'completed',
          progress_percent = 100,
          completed_at = now(),
          signoff_status = 'pending',
          updated_at = now()
        WHERE tenant_id = $1
          AND user_id = $2
          AND module_id = 'module-equipment-setup'
      `,
      [tenantId, photoUserId]
    );

    const response = await request(app)
      .post(`/api/training/profiles/${photoUserId}/signoff`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ status: "complete" });

    expect(response.status).toBe(200);
    expect(response.body.manager_signoff_status).toBe("complete");

    const completedModule = response.body.modules.find((module: { module_id: string }) => module.module_id === "module-equipment-setup");
    expect(completedModule?.signoff_status).toBe("complete");

    const storedProfile = await pool.query(
      `
        SELECT manager_signoff_status::text AS manager_signoff_status
        FROM training_profile_state
        WHERE tenant_id = $1
          AND user_id = $2
      `,
      [tenantId, photoUserId]
    );
    expect(storedProfile.rows[0].manager_signoff_status).toBe("complete");

    const storedModule = await pool.query(
      `
        SELECT signoff_status::text AS signoff_status
        FROM training_module_progress
        WHERE tenant_id = $1
          AND user_id = $2
          AND module_id = 'module-equipment-setup'
      `,
      [tenantId, photoUserId]
    );
    expect(storedModule.rows[0].signoff_status).toBe("complete");
  }, 20000);

  it("rejects sign-off updates from non-leadership users", async () => {
    const response = await request(app)
      .post(`/api/training/profiles/${leadershipUserId}/signoff`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({ status: "complete" });

    expect(response.status).toBe(403);
  });
});
