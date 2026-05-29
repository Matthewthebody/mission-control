import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photographerToken = "";
let seededOrganizationName = "";
let seededOrganizationId = "";
let seededPrimaryContactName = "";
let leadershipUserId = "";
let photographerUserId = "";

async function seedSearchIndexRow(
  payload: Partial<{
    id: string;
    entity_type: string;
    entity_id: string;
    title: string;
    subtitle: string | null;
    body_search_text: string | null;
    status: string | null;
    department: string | null;
    org_id: string | null;
    org_name: string | null;
    owner_id: string | null;
    assignee_ids: string[];
    related_ids: string[];
    primary_date: string | null;
    risk_level: string | null;
    permissions_payload: Record<string, unknown>;
    deep_link: string;
    has_notes: boolean;
    has_alerts: boolean;
    has_staffing_gap: boolean;
  }>
) {
  const id = payload.id ?? randomUUID();
  await dbPool.query(
    `
      INSERT INTO global_search_index (
        id,
        tenant_id,
        entity_type,
        entity_id,
        title,
        subtitle,
        body_search_text,
        status,
        department,
        org_id,
        org_name,
        owner_id,
        assignee_ids,
        related_ids,
        primary_date,
        risk_level,
        permissions_payload,
        deep_link,
        updated_at,
        activity_at,
        has_notes,
        has_alerts,
        has_staffing_gap
      )
      VALUES (
        $1::uuid,
        (SELECT tenant_id FROM app_user WHERE email = 'leadership@example.com' LIMIT 1),
        $2,
        $3::uuid,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::uuid,
        $10,
        $11::uuid,
        $12::uuid[],
        $13::uuid[],
        $14::timestamptz,
        $15,
        $16::jsonb,
        $17,
        now(),
        COALESCE($14::timestamptz, now()),
        $18,
        $19,
        $20
      )
      ON CONFLICT (tenant_id, entity_type, entity_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        body_search_text = EXCLUDED.body_search_text,
        status = EXCLUDED.status,
        department = EXCLUDED.department,
        org_id = EXCLUDED.org_id,
        org_name = EXCLUDED.org_name,
        owner_id = EXCLUDED.owner_id,
        assignee_ids = EXCLUDED.assignee_ids,
        related_ids = EXCLUDED.related_ids,
        primary_date = EXCLUDED.primary_date,
        risk_level = EXCLUDED.risk_level,
        permissions_payload = EXCLUDED.permissions_payload,
        deep_link = EXCLUDED.deep_link,
        updated_at = now(),
        activity_at = COALESCE(EXCLUDED.primary_date, now()),
        has_notes = EXCLUDED.has_notes,
        has_alerts = EXCLUDED.has_alerts,
        has_staffing_gap = EXCLUDED.has_staffing_gap
    `,
    [
      id,
      payload.entity_type ?? "task",
      payload.entity_id ?? randomUUID(),
      payload.title ?? `Concierge Seed ${Date.now()}`,
      payload.subtitle ?? null,
      payload.body_search_text ?? null,
      payload.status ?? null,
      payload.department ?? null,
      payload.org_id ?? null,
      payload.org_name ?? null,
      payload.owner_id ?? null,
      payload.assignee_ids ?? [],
      payload.related_ids ?? [],
      payload.primary_date ?? null,
      payload.risk_level ?? null,
      JSON.stringify(payload.permissions_payload ?? { access_model: "directory" }),
      payload.deep_link ?? "#home",
      Boolean(payload.has_notes),
      Boolean(payload.has_alerts),
      Boolean(payload.has_staffing_gap)
    ]
  );
  return id;
}

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
}

async function seedTaskSearchResult(
  input: Partial<{
    taskId: string;
    title: string;
    description: string | null;
    taskType: string | null;
    status: string | null;
    department: string | null;
    createdByUserId: string | null;
    assignedToUserId: string | null;
    priority: string | null;
    dueAt: string | null;
  }>
) {
  const taskId = input.taskId ?? randomUUID();
  const searchIndexId = await seedSearchIndexRow({
    entity_type: "task",
    entity_id: taskId,
    title: input.title ?? `Concierge Task ${Date.now()}`,
    subtitle: null,
    body_search_text: [input.title ?? null, input.description ?? null, input.taskType ?? null].filter(Boolean).join(" "),
    status: input.status ?? "not_started",
    department: input.department ?? "production",
    owner_id: input.createdByUserId ?? leadershipUserId,
    assignee_ids: input.assignedToUserId ? [input.assignedToUserId] : [],
    related_ids: [],
    primary_date: input.dueAt ?? null,
    risk_level:
      input.status === "blocked" ? "blocked" : input.priority === "urgent" || input.priority === "high" ? input.priority : null,
    permissions_payload: {
      access_model: "task",
      department: input.department ?? "production",
      created_by_user_id: input.createdByUserId ?? leadershipUserId
    },
    deep_link: `#tasks/${taskId}`
  });
  return { taskId, searchIndexId };
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");

  const userRows = await dbPool.query<{ email: string; id: string }>(
    `
      SELECT email, id::text
      FROM app_user
      WHERE email IN ('leadership@example.com', 'photo@example.com')
    `
  );
  leadershipUserId = userRows.rows.find((row) => row.email === "leadership@example.com")?.id ?? "";
  photographerUserId = userRows.rows.find((row) => row.email === "photo@example.com")?.id ?? "";

  const organizationResult = await dbPool.query<{ id: string; display_name: string; primary_contact_name: string | null }>(
    `
      SELECT
        o.id::text,
        o.display_name,
        contact.full_name AS primary_contact_name
      FROM organization o
      JOIN organization_contact_relationship relationship
        ON relationship.tenant_id = o.tenant_id
       AND relationship.organization_id = o.id
       AND relationship.is_current = true
       AND relationship.is_primary = true
      JOIN organization_contact contact
        ON contact.tenant_id = relationship.tenant_id
       AND contact.id = relationship.contact_id
      ORDER BY relationship.updated_at DESC, relationship.created_at DESC
      LIMIT 1
    `
  );
  seededOrganizationName = organizationResult.rows[0]?.display_name ?? "";
  seededOrganizationId = organizationResult.rows[0]?.id ?? "";
  seededPrimaryContactName = organizationResult.rows[0]?.primary_contact_name ?? "";
  if (!seededOrganizationName || !seededOrganizationId || !seededPrimaryContactName) {
    throw new Error("Expected a seeded organization with a primary contact for Kemmetmueller Concierge tests.");
  }
}, 30000);

describe("Kemmetmueller Concierge Phase 3", () => {
  it("returns indexed organization results for direct lookup queries", async () => {
    const uniqueTitle = `Concierge Org Lookup ${Date.now()}`;
    await seedSearchIndexRow({
      entity_type: "organization",
      entity_id: randomUUID(),
      title: uniqueTitle,
      subtitle: "schools",
      body_search_text: "Operational school account",
      status: "active",
      department: "schools",
      org_id: seededOrganizationId,
      org_name: uniqueTitle,
      related_ids: [seededOrganizationId],
      permissions_payload: {
        access_model: "directory"
      },
      deep_link: `#directory/organizations?organization=${seededOrganizationId}&tab=profile`
    });

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: uniqueTitle, limit: 8 });

    expect(response.status).toBe(200);
    expect(response.body.product_name).toBe("Kemmetmueller Concierge");
    expect(response.body.query).toBe(uniqueTitle);

    const organizationSection = response.body.sections.find((section: { entity_type: string }) => section.entity_type === "organization");
    expect(organizationSection).toBeTruthy();
    expect(
      organizationSection.results.some(
        (result: { title: string; deep_link: string }) =>
          result.title === uniqueTitle && result.deep_link.startsWith("#directory/organizations")
      )
    ).toBe(true);
  });

  it("interprets contact lookup questions and returns a direct answer card", async () => {
    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: `who is the contact for ${seededOrganizationName}`, limit: 8 });

    expect(response.status).toBe(200);
    expect(response.body.interpreted_intent.kind).toBe("contact_lookup");
    expect(response.body.answer_cards[0].kind).toBe("contact_lookup");
    expect(response.body.answer_cards[0].title).toContain(seededOrganizationName);
    expect(response.body.answer_cards[0].title).toContain(seededPrimaryContactName);
    expect(response.body.answer_cards[0].actions.some((action: { deep_link: string }) => action.deep_link.startsWith("#directory/contacts"))).toBe(true);
  });

  it("ranks an exact task title match above looser matches and preserves direct deep links", async () => {
    const exactTitle = `Concierge Exact ${Date.now()}`;
    const fuzzyTitle = `Follow up for ${exactTitle}`;

    const exactCreate = await seedTaskSearchResult({
      title: exactTitle,
      taskType: "concierge_follow_up",
      status: "not_started",
      priority: "urgent"
    });
    const fuzzyCreate = await seedTaskSearchResult({
      title: fuzzyTitle,
      taskType: "concierge_follow_up",
      status: "not_started",
      priority: "normal"
    });

    expect(exactCreate.taskId).toBeTruthy();
    expect(fuzzyCreate.taskId).toBeTruthy();

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: exactTitle, limit: 10 });

    expect(response.status).toBe(200);
    const taskSection = response.body.sections.find((section: { entity_type: string }) => section.entity_type === "task");
    expect(taskSection).toBeTruthy();
    expect(taskSection.results[0].title).toBe(exactTitle);
    expect(taskSection.results[0].deep_link).toBe(`#tasks/${exactCreate.taskId}`);
    expect(taskSection.results.some((result: { title: string }) => result.title === fuzzyTitle)).toBe(true);
  });

  it("filters search results by permissions for field users outside the task scope", async () => {
    const restrictedTitle = `Concierge Restricted ${Date.now()}`;
    const createResponse = await seedTaskSearchResult({
      title: restrictedTitle,
      taskType: "leadership_follow_up",
      status: "blocked",
      priority: "urgent"
    });

    expect(createResponse.taskId).toBeTruthy();

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${photographerToken}`)
      .query({ q: restrictedTitle, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.access_limited).toBe(true);
    const flattened = response.body.sections.flatMap((section: { results: Array<{ title: string }> }) => section.results);
    expect(flattened.some((result: { title: string }) => result.title === restrictedTitle)).toBe(false);
  });

  it("does not leak leadership-only note content when only related shared records are visible", async () => {
    const uniqueSuffix = Date.now();
    const orgName = `Restricted Search Org ${uniqueSuffix}`;
    const orgId = randomUUID();
    const confidentialNeedle = `leadership-secret-${uniqueSuffix}`;

    await seedSearchIndexRow({
      entity_type: "organization",
      entity_id: orgId,
      title: orgName,
      subtitle: "schools",
      body_search_text: `Shared organization profile for ${orgName}. Historical context is safe to preview without leadership notes.`,
      status: "active",
      department: "schools",
      org_id: null,
      org_name: orgName,
      related_ids: [],
      permissions_payload: {
        access_model: "directory"
      },
      deep_link: "#directory/organizations?view=organizations"
    });

    await seedSearchIndexRow({
      entity_type: "note",
      entity_id: randomUUID(),
      title: `${orgName} leadership issue note`,
      subtitle: orgName,
      body_search_text: `${confidentialNeedle} went wrong during the last shoot and needs leadership review.`,
      status: "major_issues",
      department: "schools",
      org_id: null,
      org_name: orgName,
      owner_id: leadershipUserId,
      assignee_ids: [],
      related_ids: [],
      primary_date: new Date().toISOString(),
      risk_level: "critical",
      permissions_payload: {
        access_model: "note",
        object_type: "shoot",
        visibility_scope: "leadership_only",
        department: "schools",
        assigned_user_id: null,
        manager_user_id: leadershipUserId,
        assigned_user_ids: [],
        lead_user_ids: [leadershipUserId]
      },
      deep_link: "#photography/shoots?shoot=restricted-search-note",
      has_notes: true
    });

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${photographerToken}`)
      .query({ q: `what went wrong last time at ${orgName}`, limit: 12 });

    expect(response.status).toBe(200);
    const allResults = response.body.sections.flatMap((section: { results: Array<{ title: string; body: string | null; snippet: string | null }> }) => section.results);
    expect(allResults.some((result: { title: string }) => result.title === orgName)).toBe(true);
    expect(response.body.access_limited).toBe(true);
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain(confidentialNeedle.toLowerCase());
  });

  it("allows assigned users to search assigned-only notes", async () => {
    const uniqueSuffix = Date.now();
    const assignedNeedle = `assigned-only-${uniqueSuffix}`;

    await seedSearchIndexRow({
      entity_type: "note",
      entity_id: randomUUID(),
      title: `Assigned staffing note ${uniqueSuffix}`,
      subtitle: seededOrganizationName,
      body_search_text: `Assigned follow-up: ${assignedNeedle} still needs photographer confirmation.`,
      status: "active",
      department: "schools",
      org_id: seededOrganizationId,
      org_name: seededOrganizationName,
      owner_id: leadershipUserId,
      assignee_ids: [photographerUserId],
      related_ids: [seededOrganizationId],
      primary_date: new Date().toISOString(),
      permissions_payload: {
        access_model: "note",
        object_type: "shoot",
        visibility_scope: "assigned_staff_and_managers",
        department: "schools",
        assigned_user_id: photographerUserId,
        manager_user_id: leadershipUserId,
        assigned_user_ids: [photographerUserId],
        lead_user_ids: [leadershipUserId]
      },
      deep_link: "#photography/shoots?shoot=assigned-note",
      has_notes: true
    });

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${photographerToken}`)
      .query({ q: assignedNeedle, limit: 8 });

    expect(response.status).toBe(200);
    const noteSection = response.body.sections.find((section: { entity_type: string }) => section.entity_type === "note");
    expect(noteSection).toBeTruthy();
    expect(JSON.stringify(noteSection).toLowerCase()).toContain(assignedNeedle.toLowerCase());
  });

  it("keeps manager-only comments out of non-manager search while allowing leadership access", async () => {
    const uniqueSuffix = Date.now();
    const managerNeedle = `manager-comment-${uniqueSuffix}`;

    await seedSearchIndexRow({
      entity_type: "comment",
      entity_id: randomUUID(),
      title: `Manager only comment ${uniqueSuffix}`,
      subtitle: seededOrganizationName,
      body_search_text: `Internal manager discussion: ${managerNeedle}.`,
      status: "manager_only",
      department: "schools",
      org_id: seededOrganizationId,
      org_name: seededOrganizationName,
      owner_id: leadershipUserId,
      assignee_ids: [],
      related_ids: [seededOrganizationId],
      primary_date: new Date().toISOString(),
      permissions_payload: {
        access_model: "comment",
        visibility: "manager_only",
        department: "schools",
        principal_user_ids: []
      },
      deep_link: "#production?item=manager-only-comment",
      has_notes: true
    });

    const photographerResponse = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${photographerToken}`)
      .query({ q: managerNeedle, type: "comment", limit: 8 });

    expect(photographerResponse.status).toBe(200);
    expect(
      JSON.stringify({
        sections: photographerResponse.body.sections,
        answer_cards: photographerResponse.body.answer_cards,
        related_clusters: photographerResponse.body.related_clusters
      }).toLowerCase()
    ).not.toContain(managerNeedle.toLowerCase());

    const leadershipResponse = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: managerNeedle, type: "comment", limit: 8 });

    expect(leadershipResponse.status).toBe(200);
    const commentSection = leadershipResponse.body.sections.find((section: { entity_type: string }) => section.entity_type === "comment");
    expect(commentSection).toBeTruthy();
    expect(JSON.stringify(commentSection).toLowerCase()).toContain(managerNeedle.toLowerCase());
  });

  it("suppresses snippets and answer summaries for restricted records flagged as non-previewable", async () => {
    const uniqueSuffix = Date.now();
    const hiddenNeedle = `restricted-summary-${uniqueSuffix}`;

    await seedSearchIndexRow({
      entity_type: "note",
      entity_id: randomUUID(),
      title: `Leadership restricted summary ${uniqueSuffix}`,
      subtitle: seededOrganizationName,
      body_search_text: `Sensitive agreement notes: ${hiddenNeedle}.`,
      status: "leadership_only",
      department: "schools",
      org_id: seededOrganizationId,
      org_name: seededOrganizationName,
      owner_id: leadershipUserId,
      assignee_ids: [leadershipUserId],
      related_ids: [seededOrganizationId],
      primary_date: new Date().toISOString(),
      permissions_payload: {
        access_model: "note",
        object_type: "shoot",
        visibility_scope: "leadership_only",
        department: "schools",
        assigned_user_id: leadershipUserId,
        manager_user_id: leadershipUserId,
        assigned_user_ids: [leadershipUserId],
        lead_user_ids: [leadershipUserId],
        allow_snippet_preview: false,
        allow_answer_summary: false,
        masking_strategy: "redacted_text"
      },
      deep_link: "#photography/shoots?shoot=restricted-summary-note",
      has_notes: true
    });

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: hiddenNeedle, limit: 8 });

    expect(response.status).toBe(200);
    const noteSection = response.body.sections.find((section: { entity_type: string }) => section.entity_type === "note");
    expect(noteSection).toBeTruthy();
    const restrictedResult = noteSection.results.find((result: { title: string }) => result.title === `Leadership restricted summary ${uniqueSuffix}`);
    expect(restrictedResult).toBeTruthy();
    expect(restrictedResult.snippet).toBe("Redacted");
    expect(restrictedResult.body).toBe("Redacted");
    expect(JSON.stringify(response.body.answer_cards).toLowerCase()).not.toContain(hiddenNeedle.toLowerCase());
  });

  it("supports result lookup and recent-search persistence for indexed records", async () => {
    const uniqueTitle = `Concierge Lookup ${Date.now()}`;
    const createResponse = await seedTaskSearchResult({
      title: uniqueTitle,
      taskType: "concierge_lookup",
      status: "in_progress",
      priority: "high"
    });

    expect(createResponse.taskId).toBeTruthy();

    const searchResponse = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: uniqueTitle, limit: 5 });

    const taskResult = searchResponse.body.sections
      .flatMap((section: { results: Array<{ title: string; search_index_id: string }> }) => section.results)
      .find((result: { title: string }) => result.title === uniqueTitle);

    expect(taskResult).toBeTruthy();

    const lookupResponse = await request(app)
      .get(`/api/concierge/result/${taskResult.search_index_id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(lookupResponse.status).toBe(200);
    expect(lookupResponse.body.result.title).toBe(uniqueTitle);
    expect(lookupResponse.body.result.deep_link).toBe(`#tasks/${createResponse.taskId}`);

    const recordResponse = await request(app)
      .post("/api/concierge/recent")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        query: uniqueTitle,
        selected_search_index_id: taskResult.search_index_id
      });

    expect(recordResponse.status).toBe(204);

    const recentResponse = await request(app)
      .get("/api/concierge/recent")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(recentResponse.status).toBe(200);
    expect(recentResponse.body.recent_searches.some((entry: { query: string }) => entry.query === uniqueTitle)).toBe(true);
  });

  it("applies typed filters and returns snippets for body matches", async () => {
    const bodyNeedle = `concierge-body-${Date.now()}`;
    const taskTitle = `Operational follow-up ${Date.now()}`;
    const createResponse = await seedTaskSearchResult({
      title: taskTitle,
      description: `Production needs escalation because ${bodyNeedle} is still unresolved.`,
      taskType: "concierge_follow_up",
      status: "blocked",
      priority: "high"
    });

    expect(createResponse.taskId).toBeTruthy();

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: `type:task department:production ${bodyNeedle}`, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.applied_filters.entity_types).toContain("task");
    expect(response.body.applied_filters.department).toBe("production");

    const taskSection = response.body.sections.find((section: { entity_type: string }) => section.entity_type === "task");
    expect(taskSection).toBeTruthy();
    const matchingTask = taskSection.results.find((result: { title: string }) => result.title === taskTitle);
    expect(matchingTask).toBeTruthy();
    expect(matchingTask.snippet.toLowerCase()).toContain(bodyNeedle.toLowerCase());
    expect(matchingTask.quick_actions.some((action: { key: string }) => action.key === "open")).toBe(true);
  });

  it("builds a risk-review answer card and related cluster for at-risk work tomorrow", async () => {
    const uniqueSuffix = Date.now();
    const tomorrowAtNoon = new Date();
    tomorrowAtNoon.setDate(tomorrowAtNoon.getDate() + 1);
    tomorrowAtNoon.setHours(12, 0, 0, 0);

    await seedSearchIndexRow({
      entity_type: "shoot",
      entity_id: randomUUID(),
      title: `Risk Shoot ${uniqueSuffix}`,
      subtitle: seededOrganizationName,
      body_search_text: "At risk tomorrow because a staffing gap remains open and the crew lead is still unassigned.",
      status: "ready",
      department: "schools",
      org_id: seededOrganizationId,
      org_name: seededOrganizationName,
      owner_id: leadershipUserId,
      assignee_ids: [photographerUserId],
      related_ids: [seededOrganizationId],
      primary_date: tomorrowAtNoon.toISOString(),
      risk_level: "high",
      permissions_payload: {
        access_model: "shoot",
        department: "schools"
      },
      deep_link: "#photography/shoots?shoot=risk-shoot",
      has_notes: false,
      has_alerts: false,
      has_staffing_gap: true
    });

    await seedSearchIndexRow({
      entity_type: "urgent_watch_alert",
      entity_id: randomUUID(),
      title: `Risk Alert ${uniqueSuffix}`,
      subtitle: "schools",
      body_search_text: "At risk tomorrow because staffing coverage is incomplete.",
      status: "active",
      department: "schools",
      org_id: seededOrganizationId,
      org_name: seededOrganizationName,
      owner_id: leadershipUserId,
      assignee_ids: [leadershipUserId],
      related_ids: [seededOrganizationId],
      primary_date: tomorrowAtNoon.toISOString(),
      risk_level: "critical",
      permissions_payload: {
        access_model: "urgent_watch_alert",
        scope_department: "schools",
        owner_user_id: leadershipUserId
      },
      deep_link: "#operations/urgent-watch?alert=risk-alert",
      has_notes: false,
      has_alerts: true,
      has_staffing_gap: true
    });

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: "what is at risk tomorrow", limit: 12 });

    expect(response.status).toBe(200);
    expect(response.body.interpreted_intent.kind).toBe("risk_review");
    expect(response.body.answer_cards[0].kind).toBe("risk_review");
    expect(response.body.answer_cards[0].title.toLowerCase()).toContain("tomorrow");
  });

  it("returns issue history answer cards for natural-language problem lookups", async () => {
    const uniqueSuffix = Date.now();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const orgName = `Issue History Org ${uniqueSuffix}`;

    await seedSearchIndexRow({
      entity_type: "post_shoot_evaluation",
      entity_id: randomUUID(),
      title: `${orgName} post-shoot evaluation ${uniqueSuffix}`,
      subtitle: orgName,
      body_search_text: "Data roster mismatch caused long lines and a parent flow problem during the last shoot.",
      status: "major_issues",
      department: "schools",
      org_id: null,
      org_name: orgName,
      owner_id: photographerUserId,
      assignee_ids: [photographerUserId],
      related_ids: [],
      primary_date: yesterday,
      risk_level: "critical",
      permissions_payload: {
        access_model: "post_shoot_evaluation",
        department: "schools",
        photographer_user_id: photographerUserId,
        manager_user_id: leadershipUserId,
        assigned_user_ids: [photographerUserId],
        lead_user_ids: [leadershipUserId]
      },
      deep_link: "#photography/shoots?shoot=issue-history",
      has_notes: true,
      has_alerts: false,
      has_staffing_gap: false
    });

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: `what went wrong last time at ${orgName}`, limit: 12 });

    expect(response.status).toBe(200);
    expect(response.body.interpreted_intent.kind).toBe("issue_lookup");
    expect(response.body.answer_cards[0].kind).toBe("issue_lookup");
    expect(response.body.answer_cards[0].title).toContain(orgName);
    expect(response.body.answer_cards[0].summary.toLowerCase()).toMatch(/mismatch|parent flow problem/);
  });

  it("returns production blockage answer cards for blocked production questions", async () => {
    const uniqueSuffix = Date.now();

    await seedSearchIndexRow({
      entity_type: "production_item",
      entity_id: randomUUID(),
      title: `Sports production blocker ${uniqueSuffix}`,
      subtitle: seededOrganizationName,
      body_search_text: "Blocked production work is waiting for uploads before QA release can continue.",
      status: "blocked",
      department: "sports",
      org_id: seededOrganizationId,
      org_name: seededOrganizationName,
      owner_id: leadershipUserId,
      assignee_ids: [leadershipUserId],
      related_ids: [seededOrganizationId],
      primary_date: new Date().toISOString(),
      risk_level: "critical",
      permissions_payload: {
        access_model: "production_item",
        department: "sports"
      },
      deep_link: "#production?item=sports-blocker",
      has_notes: false,
      has_alerts: true,
      has_staffing_gap: false
    });

    const response = await request(app)
      .get("/api/concierge/search")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: "what jobs are blocked in sports production", limit: 12 });

    expect(response.status).toBe(200);
    expect(response.body.interpreted_intent.kind).toBe("production_blockage_lookup");
    expect(response.body.answer_cards[0].kind).toBe("production_blockage_lookup");
    expect(response.body.answer_cards[0].title.toLowerCase()).toContain("blocked");
    expect(response.body.answer_cards[0].summary.toLowerCase()).toContain("upload");
  });

  it("supports saved search CRUD and saved-search suggestions", async () => {
    const createResponse = await request(app)
      .post("/api/concierge/saved")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        name: "Blocked Production",
        query: "blocked production",
        filters: {
          department: "production",
          status: "blocked",
          has_any: ["alerts"]
        },
        pinned: true
      });

    expect(createResponse.status).toBe(201);
    const savedSearch = createResponse.body.saved_searches.find((entry: { name: string }) => entry.name === "Blocked Production");
    expect(savedSearch).toBeTruthy();
    expect(savedSearch.filters.department).toBe("production");
    expect(savedSearch.filters.status).toBe("blocked");
    expect(savedSearch.filters.has_any).toContain("alerts");

    const suggestionsResponse = await request(app)
      .get("/api/concierge/suggestions")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ q: "Blocked Production" });

    expect(suggestionsResponse.status).toBe(200);
    expect(
      suggestionsResponse.body.suggestions.some(
        (entry: { kind: string; saved_search_id?: string }) =>
          entry.kind === "saved_search" && entry.saved_search_id === savedSearch.id
      )
    ).toBe(true);

    const updateResponse = await request(app)
      .patch(`/api/concierge/saved/${savedSearch.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        pinned: false,
        touch: true
      });

    expect(updateResponse.status).toBe(200);
    const updatedSavedSearch = updateResponse.body.saved_searches.find((entry: { id: string }) => entry.id === savedSearch.id);
    expect(updatedSavedSearch).toBeTruthy();
    expect(updatedSavedSearch.pinned).toBe(false);
    expect(updatedSavedSearch.last_used_at).toBeTruthy();

    const deleteResponse = await request(app)
      .delete(`/api/concierge/saved/${savedSearch.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.saved_searches.some((entry: { id: string }) => entry.id === savedSearch.id)).toBe(false);
  });
});
