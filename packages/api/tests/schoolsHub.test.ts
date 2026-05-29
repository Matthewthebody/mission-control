import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, getMembershipId } from "./helpers.js";

const app = createApp();
const testStamp = Date.now();
const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function addLocalDays(dateOnly: string, days: number) {
  const value = new Date(`${dateOnly}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

let schoolsToken = "";
let officeToken = "";
let sportsToken = "";
let photographerToken = "";
let leadershipToken = "";
let schoolsOfficeUserId = "";
let photographerUserId = "";
let organizationId = "";
let locationId = "";
let shootId = "";
let foreignShootId = "";
let contactId = "";
let schoolJobId = "";
let primaryWorkItemId = "";
let secondaryWorkItemId = "";
let mondayImportedJobId = "";
let mondayImportedWorkItemId = "";
const deliverableIds: string[] = [];
const automationEventIds: string[] = [];
const mondaySyncOperationIds: string[] = [];
const notificationEventIds: string[] = [];
const paginationWorkItemIds: string[] = [];

describe("schools hub work engine", () => {
  beforeAll(async () => {
    await pool.query(
      `
        DELETE FROM admin_setting_value
        WHERE setting_key = 'roles_access.home_dashboard_defaults'
          AND scope_type = 'role'
          AND scope_id = 'leadership'
      `
    );
    schoolsToken = (await devLogin(app, "schools-office@example.com")).body.token;
    officeToken = (await devLogin(app, "office@example.com")).body.token;
    sportsToken = (await devLogin(app, "sports-office@example.com")).body.token;
    photographerToken = (await devLogin(app, "photo@example.com")).body.token;
    leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
    schoolsOfficeUserId = (await getMembershipId("schools-office@example.com")) ?? "";
    photographerUserId = (await getMembershipId("photo@example.com")) ?? "";

    const directory = await pool.query(
      `
        SELECT o.id AS organization_id, l.id AS location_id, c.id AS contact_id, s.id AS shoot_id
        FROM organization o
        JOIN shoot_location l
          ON l.tenant_id = o.tenant_id
         AND l.organization_id = o.id
         AND l.active_status = 'active'
        JOIN organization_contact c
          ON c.tenant_id = o.tenant_id
         AND c.organization_id = o.id
         AND c.active_status = 'active'
        LEFT JOIN shoot s
          ON s.tenant_id = o.tenant_id
         AND s.organization_id = o.id
        WHERE o.display_name = 'White Bear Lake High School'
        ORDER BY c.created_at ASC, s.created_at ASC
        LIMIT 1
      `
    );

    organizationId = String(directory.rows[0]?.organization_id ?? "");
    locationId = String(directory.rows[0]?.location_id ?? "");
    contactId = String(directory.rows[0]?.contact_id ?? "");
    shootId = String(directory.rows[0]?.shoot_id ?? "");

    const foreignDirectory = await pool.query(
      `
        SELECT s.id AS shoot_id
        FROM shoot s
        JOIN organization o
          ON o.tenant_id = s.tenant_id
         AND o.id = s.organization_id
        WHERE o.display_name = 'North Metro Athletics'
        ORDER BY s.created_at ASC
        LIMIT 1
      `
    );
    foreignShootId = String(foreignDirectory.rows[0]?.shoot_id ?? "");
  });

  afterAll(async () => {
    if (notificationEventIds.length) {
      await pool.query("DELETE FROM app_event WHERE id = ANY($1::uuid[])", [notificationEventIds]);
    }
    if (automationEventIds.length) {
      await pool.query("DELETE FROM app_event WHERE id = ANY($1::uuid[])", [automationEventIds]);
    }
    if (mondaySyncOperationIds.length) {
      await pool.query("DELETE FROM integration_sync_operation WHERE id = ANY($1::uuid[])", [mondaySyncOperationIds]);
    }
    if (mondayImportedJobId || mondayImportedWorkItemId) {
      await pool.query(
        "DELETE FROM external_object_map WHERE provider = 'monday' AND object_id = ANY($1::uuid[])",
        [[mondayImportedJobId, mondayImportedWorkItemId].filter(Boolean)]
      );
    }
    if (deliverableIds.length) {
      await pool.query("DELETE FROM school_deliverable WHERE id = ANY($1::uuid[])", [deliverableIds]);
    }
    if (mondayImportedWorkItemId) {
      await pool.query("DELETE FROM school_work_item WHERE id = $1", [mondayImportedWorkItemId]);
    }
    if (mondayImportedJobId) {
      await pool.query("DELETE FROM school_job WHERE id = $1", [mondayImportedJobId]);
    }
    if (primaryWorkItemId || secondaryWorkItemId) {
      await pool.query("DELETE FROM school_work_item WHERE id = ANY($1::uuid[])", [[primaryWorkItemId, secondaryWorkItemId].filter(Boolean)]);
    }
    if (paginationWorkItemIds.length) {
      await pool.query("DELETE FROM school_work_item WHERE id = ANY($1::uuid[])", [paginationWorkItemIds]);
    }
    if (schoolJobId) {
      await pool.query("DELETE FROM school_job WHERE id = $1", [schoolJobId]);
    }
  });

  async function ensureCanonicalSchoolsWorkspace() {
    if (schoolJobId && primaryWorkItemId && secondaryWorkItemId) {
      return;
    }

    const yesterday = addLocalDays(localDate, -1);
    const createJob = await request(app)
      .post("/api/schools-hub/jobs")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        linked_location_id: locationId,
        job_type: "spring_portraits",
        title: `Spring Portrait Prep ${testStamp}`,
        event_date: localDate,
        due_date: localDate,
        owner_user_id: schoolsOfficeUserId,
        source_system: "mission_control",
        status: "active",
        notes: "Canonical job for the Schools Hub test."
      });

    if (createJob.status !== 201) {
      throw new Error(`Expected schools job seed to succeed, received ${createJob.status}`);
    }

    schoolJobId = createJob.body.id;

    const createPrimaryWork = await request(app)
      .post("/api/schools-hub/work-items")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        school_job_id: schoolJobId,
        linked_shoot_id: shootId,
        linked_location_id: locationId,
        linked_contact_id: contactId,
        work_type: "pre_shoot_coordination",
        title: `Roster confirmation ${testStamp}`,
        description: "Confirm final roster with the school before the shoot.",
        owner_user_id: photographerUserId,
        due_date: localDate,
        waiting_on: "school",
        priority: "high",
        status: "open"
      });

    if (createPrimaryWork.status !== 201) {
      throw new Error(`Expected primary schools work item seed to succeed, received ${createPrimaryWork.status}`);
    }

    primaryWorkItemId = createPrimaryWork.body.id;

    const createSecondaryWork = await request(app)
      .post("/api/schools-hub/work-items")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        school_job_id: schoolJobId,
        linked_shoot_id: shootId,
        linked_location_id: locationId,
        work_type: "gallery_release",
        title: `Release gallery ${testStamp}`,
        description: "Release the completed gallery after production handoff.",
        owner_user_id: null,
        due_date: yesterday,
        waiting_on: "internal_production",
        priority: "critical",
        status: "blocked",
        blocker_reason: "Production approval still pending.",
        generated_by_rule: true,
        source_system: "monday",
        source_reference: `monday-${testStamp}`
      });

    if (createSecondaryWork.status !== 201) {
      throw new Error(`Expected secondary schools work item seed to succeed, received ${createSecondaryWork.status}`);
    }

    secondaryWorkItemId = createSecondaryWork.body.id;
  }

  async function ensureMondayImportedWorkspace() {
    if (mondayImportedJobId && mondayImportedWorkItemId) {
      return;
    }

    const mondayImport = await request(app)
      .post("/api/schools-hub/monday/import")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        import_mode: "job_and_work_item",
        external_record_id: `monday-item-${testStamp}`,
        external_record_name: `Legacy gallery release ${testStamp}`,
        external_board_name: "Legacy Schools Board",
        linked_location_id: locationId,
        mapped_job: {
          job_type: "delivery",
          title: `Legacy gallery release ${testStamp}`,
          due_date: localDate,
          owner_user_id: schoolsOfficeUserId,
          status: "active",
          notes: "Imported from Monday coexistence."
        },
        mapped_work_item: {
          work_type: "gallery_release",
          title: `Legacy gallery release ${testStamp}`,
          owner_user_id: schoolsOfficeUserId,
          status: "open",
          stage: "waiting_on_internal",
          priority: "high",
          due_date: localDate,
          waiting_on: "internal_production",
          generated_by_rule: true,
          notes: "Imported work item."
        },
        raw_snapshot: {
          status: "Working on it",
          board_name: "Legacy Schools Board"
        }
      });

    if (mondayImport.status !== 201) {
      throw new Error(`Expected Monday import seed to succeed, received ${mondayImport.status}`);
    }

    mondayImportedJobId = mondayImport.body.imported_job.id;
    mondayImportedWorkItemId = mondayImport.body.imported_work_item.id;
    mondaySyncOperationIds.push(...mondayImport.body.sync_operations.map((operation: { operation_id: string }) => operation.operation_id));
  }

  it("lets the schools team create school jobs and unified work items", async () => {
    const yesterday = addLocalDays(localDate, -1);
    const createJob = await request(app)
      .post("/api/schools-hub/jobs")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        linked_location_id: locationId,
        job_type: "spring_portraits",
        title: `Spring Portrait Prep ${testStamp}`,
        event_date: localDate,
        due_date: localDate,
        owner_user_id: schoolsOfficeUserId,
        source_system: "mission_control",
        status: "active",
        notes: "Canonical job for the Schools Hub test."
      });

    expect(createJob.status).toBe(201);
    expect(createJob.body.title).toContain(`Spring Portrait Prep ${testStamp}`);
    schoolJobId = createJob.body.id;

    const createPrimaryWork = await request(app)
      .post("/api/schools-hub/work-items")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        school_job_id: schoolJobId,
        linked_shoot_id: shootId,
        linked_location_id: locationId,
        linked_contact_id: contactId,
        work_type: "pre_shoot_coordination",
        title: `Roster confirmation ${testStamp}`,
        description: "Confirm final roster with the school before the shoot.",
        owner_user_id: photographerUserId,
        due_date: localDate,
        waiting_on: "school",
        priority: "high",
        status: "open"
      });

    expect(createPrimaryWork.status).toBe(201);
    primaryWorkItemId = createPrimaryWork.body.id;
    expect(createPrimaryWork.body.school_job_id).toBe(schoolJobId);
    expect(createPrimaryWork.body.owner_user_id).toBe(photographerUserId);
    expect(createPrimaryWork.body.source_system).toBe("mission_control");
    expect(createPrimaryWork.body.source_reference).toBeNull();
    expect(createPrimaryWork.body.generated_by_rule).toBe(false);

    const createSecondaryWork = await request(app)
      .post("/api/schools-hub/work-items")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        school_job_id: schoolJobId,
        linked_shoot_id: shootId,
        linked_location_id: locationId,
        work_type: "gallery_release",
        title: `Release gallery ${testStamp}`,
        description: "Release the completed gallery after production handoff.",
        owner_user_id: null,
        due_date: yesterday,
        waiting_on: "internal_production",
        priority: "critical",
        status: "blocked",
        blocker_reason: "Production approval still pending.",
        generated_by_rule: true,
        source_system: "monday",
        source_reference: `monday-${testStamp}`
      });

    expect(createSecondaryWork.status).toBe(201);
    secondaryWorkItemId = createSecondaryWork.body.id;
    expect(createSecondaryWork.body.source_system).toBe("mission_control");
    expect(createSecondaryWork.body.source_reference).toBeNull();
    expect(createSecondaryWork.body.generated_by_rule).toBe(false);
  });

  it("shows department scope to approved office roles and own scope to photographers", async () => {
    await ensureCanonicalSchoolsWorkspace();

    const officeView = await request(app)
      .get(`/api/schools-hub?search=${encodeURIComponent(String(testStamp))}`)
      .set("Authorization", `Bearer ${officeToken}`);

    expect(officeView.status).toBe(200);
    expect(officeView.body.scope).toBe("all");
    expect(officeView.body.queue_items.some((item: { id: string }) => item.id === primaryWorkItemId)).toBe(true);
    expect(officeView.body.queue_items.some((item: { id: string }) => item.id === secondaryWorkItemId)).toBe(true);
    expect(officeView.body.summary).toEqual(
      expect.objectContaining({
        due_today: 1,
        overdue: 1,
        waiting_on_school: 1,
        waiting_on_internal_production: 1,
        gallery_due_soon: 1
      })
    );
    expect(officeView.body.sections.find((section: { id: string }) => section.id === "due_today")?.count).toBe(1);
    expect(officeView.body.sections.find((section: { id: string }) => section.id === "overdue")?.count).toBe(1);
    expect(officeView.body.sections.find((section: { id: string }) => section.id === "waiting_on_school")?.count).toBe(1);
    expect(officeView.body.sections.find((section: { id: string }) => section.id === "waiting_on_internal_production")?.count).toBe(1);

    const photographerView = await request(app)
      .get(`/api/schools-hub?search=${encodeURIComponent(String(testStamp))}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(photographerView.status).toBe(200);
    expect(photographerView.body.scope).toBe("own");
    expect(photographerView.body.queue_items.map((item: { id: string }) => item.id)).toContain(primaryWorkItemId);
    expect(photographerView.body.queue_items.map((item: { id: string }) => item.id)).not.toContain(secondaryWorkItemId);

    const sportsView = await request(app)
      .get(`/api/schools-hub?search=${encodeURIComponent(String(testStamp))}`)
      .set("Authorization", `Bearer ${sportsToken}`);

    expect(sportsView.status).toBe(200);
    expect(sportsView.body.scope).toBe("all");
    expect(sportsView.body.queue_items.some((item: { id: string }) => item.id === secondaryWorkItemId)).toBe(true);
  });

  it("supports direct updates and bulk updates for authorized schools users only", async () => {
    await ensureCanonicalSchoolsWorkspace();

    const patchResponse = await request(app)
      .patch(`/api/schools-hub/work-items/${secondaryWorkItemId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        status: "in_progress",
        stage: "active",
        owner_user_id: schoolsOfficeUserId,
        blocker_reason: null,
        waiting_on: "none"
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.status).toBe("in_progress");
    expect(patchResponse.body.owner_user_id).toBe(schoolsOfficeUserId);

    const bulkResponse = await request(app)
      .post("/api/schools-hub/work-items/bulk")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        ids: [primaryWorkItemId, secondaryWorkItemId],
        owner_user_id: schoolsOfficeUserId,
        status: "in_progress",
        waiting_on: "internal_ops"
      });

    expect(bulkResponse.status).toBe(200);
    expect(bulkResponse.body.updated_count).toBe(2);
    expect(bulkResponse.body.updated_ids).toEqual(expect.arrayContaining([primaryWorkItemId, secondaryWorkItemId]));

    const refreshedView = await request(app)
      .get(`/api/schools-hub?search=${encodeURIComponent(String(testStamp))}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(refreshedView.status).toBe(200);
    expect(
      refreshedView.body.queue_items
        .filter((item: { id: string }) => [primaryWorkItemId, secondaryWorkItemId].includes(item.id))
        .every(
          (item: { owner_user_id: string; status: string; waiting_on: string }) =>
            item.owner_user_id === schoolsOfficeUserId && item.status === "in_progress" && item.waiting_on === "internal_ops"
        )
    ).toBe(true);
    expect(
      refreshedView.body.queue_items.find((item: { id: string; stage: string }) => item.id === primaryWorkItemId)?.stage
    ).toBe("waiting_on_internal");

    const deniedCreate = await request(app)
      .post("/api/schools-hub/work-items")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        organization_id: organizationId,
        work_type: "follow_up",
        title: "Unauthorized",
        due_date: localDate
      });

    expect(deniedCreate.status).toBe(403);

    const deniedOfficeUpdate = await request(app)
      .patch(`/api/schools-hub/work-items/${primaryWorkItemId}`)
      .set("Authorization", `Bearer ${officeToken}`)
      .send({
        status: "completed"
      });

    expect(deniedOfficeUpdate.status).toBe(403);
  });

  it("normalizes completion state and rejects conflicting linked records", async () => {
    await ensureCanonicalSchoolsWorkspace();

    const completeResponse = await request(app)
      .patch(`/api/schools-hub/work-items/${secondaryWorkItemId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        status: "completed",
        waiting_on: "school",
        blocker_reason: "Should be cleared on completion."
      });

    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body.status).toBe("completed");
    expect(completeResponse.body.stage).toBe("done");
    expect(completeResponse.body.waiting_on).toBe("none");
    expect(completeResponse.body.blocker_reason).toBeNull();
    expect(completeResponse.body.completed_at).toBeTruthy();

    const conflictingLink = await request(app)
      .patch(`/api/schools-hub/work-items/${primaryWorkItemId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        linked_shoot_id: foreignShootId
      });

    expect(conflictingLink.status).toBe(400);
  });

  it("queues automation runs and manual trigger events for authorized schools users only", async () => {
    await ensureCanonicalSchoolsWorkspace();

    const runAutomation = await request(app)
      .post("/api/schools-hub/automation/run")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({});

    expect(runAutomation.status).toBe(202);
    expect(runAutomation.body.queued).toBe(true);
    automationEventIds.push(runAutomation.body.event_id);

    const uploadTrigger = await request(app)
      .post("/api/schools-hub/automation/triggers/upload")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        linked_location_id: locationId,
        trigger_type: "gallery_deadline_set",
        deadline_date: localDate,
        source_system: "manual_import",
        source_reference: `schools-hub-upload-${testStamp}`
      });

    expect(uploadTrigger.status).toBe(202);
    automationEventIds.push(uploadTrigger.body.event_id);

    const queuedEvents = await pool.query(
      `
        SELECT event_type
        FROM app_event
        WHERE id = ANY($1::uuid[])
        ORDER BY event_type ASC
      `,
      [[runAutomation.body.event_id, uploadTrigger.body.event_id]]
    );

    expect(queuedEvents.rows.map((row) => row.event_type)).toEqual([
      "schools_hub.automation.requested",
      "schools_hub.trigger.upload_state_changed"
    ]);

    const deniedRun = await request(app)
      .post("/api/schools-hub/automation/run")
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({});

    expect(deniedRun.status).toBe(403);
  });

  it("imports Monday metadata into native school records and supports re-import from stored attribution", async () => {
    const mondayImport = await request(app)
      .post("/api/schools-hub/monday/import")
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        organization_id: organizationId,
        import_mode: "job_and_work_item",
        external_record_id: `monday-item-${testStamp}`,
        external_record_name: `Legacy gallery release ${testStamp}`,
        external_board_name: "Legacy Schools Board",
        linked_location_id: locationId,
        mapped_job: {
          job_type: "delivery",
          title: `Legacy gallery release ${testStamp}`,
          due_date: localDate,
          owner_user_id: schoolsOfficeUserId,
          status: "active",
          notes: "Imported from Monday coexistence."
        },
        mapped_work_item: {
          work_type: "gallery_release",
          title: `Legacy gallery release ${testStamp}`,
          owner_user_id: schoolsOfficeUserId,
          status: "open",
          stage: "waiting_on_internal",
          priority: "high",
          due_date: localDate,
          waiting_on: "internal_production",
          generated_by_rule: true,
          notes: "Imported work item."
        },
        raw_snapshot: {
          status: "Working on it",
          board_name: "Legacy Schools Board"
        }
      });

    expect(mondayImport.status).toBe(201);
    expect(mondayImport.body.imported_job.source_system).toBe("monday");
    expect(mondayImport.body.imported_work_item.source_system).toBe("monday");
    expect(mondayImport.body.imported_work_item.external_sync.provider).toBe("monday");
    expect(mondayImport.body.imported_work_item.external_sync.sync_state).toBe("synced");
    mondayImportedJobId = mondayImport.body.imported_job.id;
    mondayImportedWorkItemId = mondayImport.body.imported_work_item.id;
    mondaySyncOperationIds.push(...mondayImport.body.sync_operations.map((operation: { operation_id: string }) => operation.operation_id));

    const mondayView = await request(app)
      .get(`/api/schools-hub?search=${encodeURIComponent(`Legacy gallery release ${testStamp}`)}`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(mondayView.status).toBe(200);
    expect(
      mondayView.body.queue_items.some(
        (item: { id: string; external_sync: { external_record_id: string; board_name: string } | null }) =>
          item.id === mondayImportedWorkItemId &&
          item.external_sync?.external_record_id === `monday-item-${testStamp}` &&
          item.external_sync?.board_name === "Legacy Schools Board"
      )
    ).toBe(true);

    const mondayReimport = await request(app)
      .post(`/api/schools-hub/monday/reimport/school_work_item/${mondayImportedWorkItemId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({});

    expect(mondayReimport.status).toBe(202);
    expect(mondayReimport.body.imported_work_item.id).toBe(mondayImportedWorkItemId);
    expect(mondayReimport.body.imported_work_item.external_sync.external_record_id).toBe(`monday-item-${testStamp}`);
    expect(mondayReimport.body.imported_work_item.source_reference).toBe(`monday:item:${`monday-item-${testStamp}`}`);
    mondaySyncOperationIds.push(...mondayReimport.body.sync_operations.map((operation: { operation_id: string }) => operation.operation_id));
  });

  it("returns honest queue pagination metadata instead of silently truncating the workspace", async () => {
    await ensureCanonicalSchoolsWorkspace();

    for (let index = 0; index < 11; index += 1) {
      const createResponse = await request(app)
        .post("/api/schools-hub/work-items")
        .set("Authorization", `Bearer ${schoolsToken}`)
        .send({
          organization_id: organizationId,
          school_job_id: schoolJobId,
          linked_shoot_id: shootId,
          linked_location_id: locationId,
          work_type: "follow_up",
          title: `Pagination fill ${testStamp}-${index}`,
          owner_user_id: schoolsOfficeUserId,
          due_date: localDate,
          waiting_on: "none",
          priority: "normal",
          status: "open"
        });

      expect(createResponse.status).toBe(201);
      paginationWorkItemIds.push(createResponse.body.id);
    }

    const pagedResponse = await request(app)
      .get(`/api/schools-hub?search=${encodeURIComponent(`Pagination fill ${testStamp}`)}&page=1&page_size=10`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(pagedResponse.status).toBe(200);
    expect(pagedResponse.body.queue_page).toBe(1);
    expect(pagedResponse.body.queue_page_size).toBe(10);
    expect(pagedResponse.body.queue_total_count).toBe(11);
    expect(pagedResponse.body.queue_items).toHaveLength(10);
    expect(pagedResponse.body.queue_has_more).toBe(true);

    const secondPageResponse = await request(app)
      .get(`/api/schools-hub?search=${encodeURIComponent(`Pagination fill ${testStamp}`)}&page=2&page_size=10`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(secondPageResponse.status).toBe(200);
    expect(secondPageResponse.body.queue_page).toBe(2);
    expect(secondPageResponse.body.queue_items).toHaveLength(1);
    expect(secondPageResponse.body.queue_has_more).toBe(false);
    expect(secondPageResponse.body.queue_items[0].id).not.toBe(pagedResponse.body.queue_items[0].id);
  });

  it("keeps source attribution immutable on normal edits and rejects stale optimistic updates", async () => {
    await ensureMondayImportedWorkspace();

    const detailResponse = await request(app)
      .get(`/api/schools-hub/work-items/${mondayImportedWorkItemId}/detail`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.item.source_system).toBe("monday");
    expect(detailResponse.body.item.generated_by_rule).toBe(true);
    expect(detailResponse.body.timeline.length).toBeGreaterThan(0);

    const immutablePatch = await request(app)
      .patch(`/api/schools-hub/work-items/${mondayImportedWorkItemId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        title: `Legacy gallery release ${testStamp} (reviewed)`,
        expected_updated_at: detailResponse.body.item.updated_at,
        source_system: "mission_control",
        source_reference: "manual-overwrite-attempt",
        generated_by_rule: false
      });

    expect(immutablePatch.status).toBe(200);
    expect(immutablePatch.body.title).toContain("(reviewed)");
    expect(immutablePatch.body.source_system).toBe("monday");
    expect(immutablePatch.body.source_reference).toBe(`monday:item:${`monday-item-${testStamp}`}`);
    expect(immutablePatch.body.generated_by_rule).toBe(true);

    const stalePatch = await request(app)
      .patch(`/api/schools-hub/work-items/${mondayImportedWorkItemId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        notes: "This should fail because the item already changed.",
        expected_updated_at: detailResponse.body.item.updated_at
      });

    expect(stalePatch.status).toBe(409);
    expect(stalePatch.body.error).toContain("changed before your update was saved");
  });

  it("shows detail timeline, converts work into deliverables, and surfaces school risk into reporting and notifications", async () => {
    await ensureCanonicalSchoolsWorkspace();
    await ensureMondayImportedWorkspace();

    const convertResponse = await request(app)
      .post(`/api/schools-hub/work-items/${mondayImportedWorkItemId}/convert-to-deliverable`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        deliverable_type: "gallery",
        due_date: localDate,
        delivery_method: "digital",
        notes: "Portal release packet is ready for the school."
      });

    expect(convertResponse.status).toBe(201);
    expect(convertResponse.body.school_work_item_id).toBe(mondayImportedWorkItemId);
    expect(convertResponse.body.deliverable_type).toBe("gallery");
    deliverableIds.push(convertResponse.body.id);

    const detailAfterConvert = await request(app)
      .get(`/api/schools-hub/work-items/${mondayImportedWorkItemId}/detail`)
      .set("Authorization", `Bearer ${schoolsToken}`);

    expect(detailAfterConvert.status).toBe(200);
    expect(detailAfterConvert.body.related_deliverables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: convertResponse.body.id,
          school_work_item_id: mondayImportedWorkItemId,
          deliverable_type: "gallery"
        })
      ])
    );
    expect(detailAfterConvert.body.timeline.some((event: { source: string; event_type: string }) => event.source === "deliverable")).toBe(true);

    const riskUpdate = await request(app)
      .patch(`/api/schools-hub/work-items/${primaryWorkItemId}`)
      .set("Authorization", `Bearer ${schoolsToken}`)
      .send({
        owner_user_id: schoolsOfficeUserId,
        status: "blocked",
        priority: "critical",
        due_date: addLocalDays(localDate, -1),
        blocker_reason: "School has not approved the final roster.",
        waiting_on: "school"
      });

    expect(riskUpdate.status).toBe(200);
    expect(riskUpdate.body.status).toBe("blocked");
    expect(riskUpdate.body.owner_user_id).toBe(schoolsOfficeUserId);

    const notificationEvents = await pool.query<{ id: string; payload: Record<string, unknown> }>(
      `
        SELECT id::text, payload
        FROM app_event
        WHERE tenant_id = (SELECT tenant_id FROM organization WHERE id = $1)
          AND event_type = 'notification.dispatch'
          AND payload ->> 'notification_type' = 'schools.work_item_risk'
          AND payload ->> 'deep_link' = $2
        ORDER BY created_at DESC
        LIMIT 5
      `,
      [organizationId, `#schools?item=${primaryWorkItemId}`]
    );

    expect(notificationEvents.rows.length).toBeGreaterThan(0);
    notificationEventIds.push(...notificationEvents.rows.map((row) => row.id));
    expect(notificationEvents.rows[0].payload).toEqual(
      expect.objectContaining({
        category: "urgent_operational_risk",
        notification_type: "schools.work_item_risk",
        deep_link: `#schools?item=${primaryWorkItemId}`
      })
    );

    const homeResponse = await request(app)
      .get(`/api/dashboard/home?mode=app&date=${localDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(homeResponse.status).toBe(200);
    expect(
      homeResponse.body.home_surface.compact_widgets.find((widget: { id: string }) => widget.id === "schools_risk")
    ).toEqual(
      expect.objectContaining({
        action_hash: "#schools"
      })
    );

    const operatingModelResponse = await request(app)
      .get(`/api/dashboard/reports/operating-model?date=${localDate}&period=monthly`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(operatingModelResponse.status).toBe(200);
    expect(operatingModelResponse.body.schools).toEqual(
      expect.objectContaining({
        action_hash: "#schools",
        overdue_count: expect.any(Number),
        blocked_count: expect.any(Number),
        waiting_on_school_count: expect.any(Number)
      })
    );
    expect(
      operatingModelResponse.body.summary_strip.find((card: { id: string }) => card.id === "schools_overdue")
    ).toEqual(
      expect.objectContaining({
        action_hash: "#schools"
      })
    );
  }, 15000);
});
