import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin, elevateSession, passwordLogin } from "./helpers.js";

const app = createApp();
const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const quietReportDate = "2035-01-15";
const routePermissionRun = `route-permissions:${Date.now()}:${crypto.randomUUID()}`;

let adminToken = "";
let leadershipToken = "";
let officeToken = "";
let legacyPhotographerToken = "";
let schoolsClientSuccessToken = "";
let sportsClientSuccessToken = "";
let shootId = "";
let alertId = "";
let studioId = "";
let tenantId = "";
let schoolOrganizationId = "";
let schoolLocationId = "";
let schoolPrimaryContactId = "";
let sportsOrganizationId = "";
let sportsLocationId = "";
let sportsPrimaryContactId = "";
let mutableShootId = "";
const createdAlertIds: string[] = [];

beforeAll(async () => {
  adminToken = (await passwordLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;
  officeToken = (await passwordLogin(app, "office@example.com")).body.token;
  legacyPhotographerToken = (await devLogin(app, "photo@example.com")).body.token;
  schoolsClientSuccessToken = (await passwordLogin(app, "schools-office@example.com")).body.token;
  sportsClientSuccessToken = (await passwordLogin(app, "sports-office@example.com")).body.token;
  await elevateSession(app, leadershipToken, "LocalDemo123!");
  tenantId = (
    await pool.query(
      "SELECT tenant_id FROM app_user WHERE lower(email) = lower($1) ORDER BY created_at ASC LIMIT 1",
      ["leadership@example.com"]
    )
  ).rows[0].tenant_id;
  studioId = (await pool.query("SELECT id FROM studio WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1", [tenantId])).rows[0].id;
  shootId = (await pool.query("SELECT id FROM shoot WHERE shoot_code = 'DEMO-001' LIMIT 1")).rows[0].id;
  const mutableShoot = await pool.query(
    `
      INSERT INTO shoot (
        tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address,
        location_lat, location_lng, navigation_url, geofence_radius_meters,
        arrival_time, start_time, end_time_est, projected_students,
        organization_id, location_id, primary_contact_id, shoot_type
      )
      SELECT
        tenant_id, studio_id, $2, $3, shoot_date, location_name, location_address,
        location_lat, location_lng, navigation_url, geofence_radius_meters,
        arrival_time, start_time, end_time_est, projected_students,
        organization_id, location_id, primary_contact_id, shoot_type
      FROM shoot
      WHERE id = $1
      RETURNING id
    `,
    [shootId, `RP-MUT-${crypto.randomUUID().slice(0, 8)}`, `Route Permissions Mutable Shoot ${routePermissionRun}`]
  );
  mutableShootId = mutableShoot.rows[0].id;
  const alertResult = await pool.query(
    `
      INSERT INTO alert (tenant_id, shoot_id, alert_type, message, metadata)
      VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (tenant_id, shoot_id, alert_type)
      WHERE status = 'open'
      DO UPDATE SET
        message = EXCLUDED.message,
        metadata = EXCLUDED.metadata
      RETURNING id
    `,
    [
      tenantId,
      shootId,
      `route_permission_smoke_${routePermissionRun}`,
      "Route permission regression fixture alert.",
      JSON.stringify({ test_marker: routePermissionRun })
    ]
  );
  alertId = alertResult.rows[0].id;
  createdAlertIds.push(alertId);

  const schoolDirectory = await pool.query(
    `
      SELECT o.id AS organization_id, l.id AS location_id, c.id AS contact_id
      FROM organization o
      JOIN shoot_location l
        ON l.tenant_id = o.tenant_id
       AND l.organization_id = o.id
       AND l.active_status = 'active'
      JOIN organization_contact c
        ON c.tenant_id = o.tenant_id
       AND c.organization_id = o.id
       AND c.active_status = 'active'
      WHERE o.tenant_id = $1
        AND o.display_name = 'White Bear Lake High School'
      ORDER BY c.created_at ASC
      LIMIT 1
    `,
    [tenantId]
  );
  schoolOrganizationId = schoolDirectory.rows[0].organization_id;
  schoolLocationId = schoolDirectory.rows[0].location_id;
  schoolPrimaryContactId = schoolDirectory.rows[0].contact_id;

  const sportsDirectory = await pool.query(
    `
      SELECT o.id AS organization_id, l.id AS location_id, c.id AS contact_id
      FROM organization o
      JOIN shoot_location l
        ON l.tenant_id = o.tenant_id
       AND l.organization_id = o.id
       AND l.active_status = 'active'
      JOIN organization_contact c
        ON c.tenant_id = o.tenant_id
       AND c.organization_id = o.id
       AND c.active_status = 'active'
      WHERE o.tenant_id = $1
        AND o.display_name = 'North Metro Athletics'
      ORDER BY c.created_at ASC
      LIMIT 1
    `,
    [tenantId]
  );
  sportsOrganizationId = sportsDirectory.rows[0].organization_id;
  sportsLocationId = sportsDirectory.rows[0].location_id;
  sportsPrimaryContactId = sportsDirectory.rows[0].contact_id;
});

afterAll(async () => {
  if (!tenantId) {
    return;
  }
  if (createdAlertIds.length) {
    await pool.query("DELETE FROM alert WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, createdAlertIds]);
  }
  if (mutableShootId) {
    await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND id = $2", [tenantId, mutableShootId]);
  }
  await pool.query("DELETE FROM integration_sync_operation WHERE tenant_id = $1 AND source_change_key LIKE $2", [
    tenantId,
    `${routePermissionRun}:%`
  ]);
  await pool.query("DELETE FROM report_saved_view WHERE tenant_id = $1 AND name = $2", [
    tenantId,
    `Leadership Test View ${routePermissionRun}`
  ]);
  await pool.query("DELETE FROM leadership_packet_template WHERE tenant_id = $1 AND name = $2", [
    tenantId,
    `Leadership Test Packet ${routePermissionRun}`
  ]);
});

describe("protected route regression coverage", () => {
  it("keeps the legacy photographer flow working on existing field route groups", async () => {
    const eventId = crypto.randomUUID();

    const statusEvent = await request(app)
      .post(`/api/shoots/${shootId}/status-events`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`)
      .set("Idempotency-Key", eventId)
      .send({
        type: "ARRIVED",
        captured_at: new Date().toISOString(),
        client_event_id: eventId
      });

    const clockInId = crypto.randomUUID();
    const clockIn = await request(app)
      .post(`/api/shoots/${shootId}/clock-in`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`)
      .set("Idempotency-Key", clockInId)
      .send({
        captured_at: new Date().toISOString(),
        location_lat: 44.97781,
        location_lng: -93.26492,
        client_event_id: clockInId
      });

    const timeEntries = await request(app)
      .get(`/api/shoots/${shootId}/time-entries`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);

    const mileage = await request(app)
      .post(`/api/shoots/${shootId}/mileage/preview`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`)
      .send({});

    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${legacyPhotographerToken}`)
      .send({ content_type: "image/jpeg", resource_type: "shoot", resource_id: shootId });

    const media = await request(app)
      .post(`/api/shoots/${shootId}/media`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`)
      .send({
        storage_key: presign.body.storage_key,
        kind: "setup_photo"
      });

    const push = await request(app)
      .post("/api/push/register")
      .set("Authorization", `Bearer ${legacyPhotographerToken}`)
      .send({
        platform: "ios",
        device_identifier: `device-${crypto.randomUUID()}`,
        token: `push-${crypto.randomUUID()}`
      });

    expect(statusEvent.status).toBe(201);
    expect(clockIn.status).toBe(201);
    // G2: the deprecated legacy time-entries projection is retired (zero product
    // consumers) — the field flow no longer includes it.
    expect(timeEntries.status).toBe(404);
    expect(mileage.status).toBe(200);
    expect(presign.status).toBe(200);
    expect(media.status).toBe(201);
    expect(push.status).toBe(201);
  }, 45000);

  it("denies an office employee from privileged operational mutations", async () => {
    const createShoot = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${officeToken}`)
      .send({
        studio_id: studioId,
        organization_id: schoolOrganizationId,
        location_id: schoolLocationId,
        primary_contact_id: schoolPrimaryContactId,
        shoot_type: "schools_underclass_portraits",
        shoot_code: `OFFICE-${Date.now()}`,
        title: "Office Blocked",
        shoot_date: localDate,
        geofence_radius_meters: 200,
        arrival_time: `${localDate}T14:00:00.000Z`,
        start_time: `${localDate}T14:15:00.000Z`,
        end_time_est: `${localDate}T15:15:00.000Z`
      });

    const statusEvent = await request(app)
      .post(`/api/shoots/${shootId}/status-events`)
      .set("Authorization", `Bearer ${officeToken}`)
      .send({
        type: "ARRIVED",
        captured_at: new Date().toISOString()
      });

    const clockIn = await request(app)
      .post(`/api/shoots/${shootId}/clock-in`)
      .set("Authorization", `Bearer ${officeToken}`)
      .send({
        captured_at: new Date().toISOString()
      });

    const mileage = await request(app)
      .post(`/api/shoots/${shootId}/mileage/submit`)
      .set("Authorization", `Bearer ${officeToken}`)
      .send({});

    const presign = await request(app)
      .post("/api/uploads/presign")
      .set("Authorization", `Bearer ${officeToken}`)
      .send({ content_type: "image/jpeg" });

    const media = await request(app)
      .post(`/api/shoots/${shootId}/media`)
      .set("Authorization", `Bearer ${officeToken}`)
      .send({
        storage_key: `uploads/${crypto.randomUUID()}.jpg`,
        kind: "setup_photo"
      });

    const resolveAlert = await request(app)
      .post(`/api/alerts/${alertId}/resolve`)
      .set("Authorization", `Bearer ${officeToken}`);
    const integrationGovernance = await request(app)
      .get("/api/integrations/governance")
      .set("Authorization", `Bearer ${officeToken}`);

    expect(createShoot.status).toBe(403);
    expect(statusEvent.status).toBe(403);
    expect(clockIn.status).toBe(403);
    expect(mileage.status).toBe(403);
    expect(presign.status).toBe(403);
    expect(media.status).toBe(403);
    expect(resolveAlert.status).toBe(403);
    expect(integrationGovernance.status).toBe(403);
  });

  it("allows leadership on broad dashboard read routes", async () => {
    const alerts = await request(app).get("/api/alerts").set("Authorization", `Bearer ${leadershipToken}`);
    const dashboard = await request(app)
      .get(`/api/dashboard/operations?date=${localDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const homeDashboard = await request(app)
      .get(`/api/dashboard/home?date=${localDate}&mode=tv`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const dashboardExport = await request(app)
      .get(`/api/dashboard/operations/export.csv?date=${localDate}&report=labor`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(alerts.status).toBe(200);
    expect(dashboard.status).toBe(200);
    expect(homeDashboard.status).toBe(200);
    expect(homeDashboard.body.public_safe).toBe(true);
    expect(homeDashboard.body.widgets.labor_snapshot_today).toBeNull();
    expect(dashboardExport.status).toBe(200);
    expect(String(dashboardExport.headers["content-type"])).toContain("text/csv");
  }, 45000);

  it("allows leadership on report catalog and workspace read routes", async () => {
    const leadershipReports = await request(app)
      .get(`/api/dashboard/reports?date=${quietReportDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const reportingDeliveryCenter = await request(app)
      .get(`/api/dashboard/reports/delivery-center?date=${quietReportDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const reportsWorkspace = await request(app)
      .get(`/api/dashboard/reports/workspace?date=${quietReportDate}&period=monthly`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(leadershipReports.status).toBe(200);
    expect(leadershipReports.body.reports.some((item: { id: string }) => item.id === "executive_overview")).toBe(true);
    expect(reportingDeliveryCenter.status).toBe(200);
    expect(reportingDeliveryCenter.body.packet_templates.length).toBeGreaterThan(0);
    expect(reportsWorkspace.status).toBe(200);
    expect(reportsWorkspace.body.operational_model.summary_strip.length).toBeGreaterThan(0);
  }, 45000);

  it("allows leadership to create report delivery artifacts and run report exports", async () => {
    const integrationGovernance = await request(app)
      .get("/api/integrations/governance")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const createSavedView = await request(app)
      .post("/api/dashboard/reports/saved-views")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        source_module: "reporting_dashboard",
        report_id: "executive_overview",
        name: `Leadership Test View ${routePermissionRun}`,
        description: "Route-permission coverage view",
        visibility: "private",
        window: "last_7_days"
      });
    const createPacketTemplate = await request(app)
      .post("/api/dashboard/reports/packet-templates")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        name: `Leadership Test Packet ${routePermissionRun}`,
        audience: "Leadership test review",
        description: "Permission coverage packet",
        visibility: "private",
        default_window: "last_7_days",
        section_config: [
          { report_id: "executive_overview", enabled: true },
          { report_id: "production_qa_health", enabled: true }
        ]
      });
    const leadershipReportDetail = await request(app)
      .get(`/api/dashboard/reports/big_shoot_readiness_report?date=${quietReportDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipReportCsv = await request(app)
      .get(`/api/dashboard/reports/open_approvals_report/export.csv?date=${quietReportDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const leadershipReportPdf = await request(app)
      .get(`/api/dashboard/reports/big_shoot_readiness_report/export.pdf?date=${quietReportDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(integrationGovernance.status).toBe(200);
    expect(integrationGovernance.body.providers.some((item: { provider: string }) => item.provider === "outlook")).toBe(true);
    expect(createSavedView.status).toBe(201);
    expect(createPacketTemplate.status).toBe(201);
    expect(leadershipReportDetail.status).toBe(200);
    expect(leadershipReportDetail.body.id).toBe("big_shoot_readiness_report");
    expect(leadershipReportCsv.status).toBe(200);
    expect(String(leadershipReportCsv.headers["content-type"])).toContain("text/csv");
    expect(leadershipReportPdf.status).toBe(200);
    expect(String(leadershipReportPdf.headers["content-type"])).toContain("application/pdf");
  }, 45000);

  it("denies field photographers from privileged dashboard, report, staffing, and integration routes", async () => {
    const photographerDashboard = await request(app)
      .get(`/api/dashboard/operations?date=${localDate}`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const photographerHomeDashboard = await request(app)
      .get(`/api/dashboard/home?date=${localDate}&mode=tv`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const photographerReports = await request(app)
      .get(`/api/dashboard/reports?date=${localDate}`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const photographerDeliveryCenter = await request(app)
      .get(`/api/dashboard/reports/delivery-center?date=${localDate}`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const photographerReportsWorkspace = await request(app)
      .get(`/api/dashboard/reports/workspace?date=${localDate}&period=monthly`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const staffingDashboard = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const photographerStaffingDashboard = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDate}`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const staffingSnapshot = await request(app)
      .get(`/api/schedule/shoots/${shootId}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const photographerStaffingSnapshot = await request(app)
      .get(`/api/schedule/shoots/${shootId}/staffing`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const photographerOutlookPush = await request(app)
      .post(`/api/schedule/items/shoot/${shootId}/outlook-push`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const seededSyncOperation = await pool.query(
      `
        INSERT INTO integration_sync_operation (
          tenant_id, provider, direction, entity_type, entity_id, external_object_type,
          operation_type, source_system, source_change_key, status, payload
        )
        VALUES ($1,'outlook','outbound','shoot',$2,'calendar_event','upsert','mission_control',$3,'pending','{}'::jsonb)
        RETURNING id
      `,
      [tenantId, shootId, `${routePermissionRun}:photographer-denial:${crypto.randomUUID()}`]
    );
    const photographerSyncOperations = await request(app)
      .get(`/api/integrations/sync-operations?provider=outlook&entity_type=shoot&entity_id=${shootId}`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);
    const photographerReplaySyncOperation = await request(app)
      .post(`/api/integrations/sync-operations/${seededSyncOperation.rows[0].id}/replay`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);

    expect(photographerDashboard.status).toBe(403);
    expect(photographerHomeDashboard.status).toBe(200);
    expect(photographerHomeDashboard.body.home_surface.layout).toBe("employee");
    expect(photographerHomeDashboard.body.home_surface.visibility_matrix.today_and_next_up).toBe(false);
    expect(photographerReports.status).toBe(403);
    expect(photographerDeliveryCenter.status).toBe(403);
    expect(photographerReportsWorkspace.status).toBe(403);
    expect(photographerStaffingDashboard.status).toBe(403);
    expect(photographerStaffingSnapshot.status).toBe(403);
    expect(photographerOutlookPush.status).toBe(403);
    expect(photographerSyncOperations.status).toBe(403);
    expect(photographerReplaySyncOperation.status).toBe(403);
  }, 45000);

  it("allows leadership on schedule, integration, and sync operation routes without granting permission mutations", async () => {
    const outlookConnect = await request(app)
      .post(`/api/integrations/outlook/connect?date=${localDate}&provider=mock`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const integrationGovernance = await request(app)
      .get("/api/integrations/governance")
      .set("Authorization", `Bearer ${leadershipToken}`);
    const staffingDashboard = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const staffingSnapshot = await request(app)
      .get(`/api/schedule/shoots/${shootId}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const updateShoot = await request(app)
      .patch(`/api/shoots/${mutableShootId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ title: "Leadership Operational Update" });
    const outlookPush = await request(app)
      .post(`/api/schedule/items/shoot/${shootId}/outlook-push`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const seededSyncOperation = await pool.query(
      `
        INSERT INTO integration_sync_operation (
          tenant_id, provider, direction, entity_type, entity_id, external_object_type,
          operation_type, source_system, source_change_key, status, payload
        )
        VALUES ($1,'outlook','outbound','shoot',$2,'calendar_event','upsert','mission_control',$3,'pending','{}'::jsonb)
        RETURNING id
      `,
      [tenantId, shootId, `${routePermissionRun}:leadership-sync:${crypto.randomUUID()}`]
    );
    const syncOperations = await request(app)
      .get(`/api/integrations/sync-operations?provider=outlook&entity_type=shoot&entity_id=${shootId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const replaySyncOperation = await request(app)
      .post(`/api/integrations/sync-operations/${seededSyncOperation.rows[0].id}/replay`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    const users = await request(app).get("/api/access/users").set("Authorization", `Bearer ${leadershipToken}`);
    const invite = await request(app)
      .post("/api/access/invites")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        email: `leadership-forbidden-${Date.now()}@example.com`,
        full_name: "Leadership Forbidden",
        authority_tier: "standard_employee",
        primary_profile: "customer_service_rep",
        job_function_profiles: ["customer_service_rep"],
        department: "office"
      });

    expect(outlookConnect.status).toBe(200);
    expect(integrationGovernance.status).toBe(200);
    expect(integrationGovernance.body.providers.some((item: { provider: string }) => item.provider === "outlook")).toBe(true);
    expect(staffingDashboard.status).toBe(200);
    expect(staffingSnapshot.status).toBe(200);
    expect([202, 409]).toContain(outlookPush.status);
    expect(syncOperations.status).toBe(200);
    expect(replaySyncOperation.status).toBe(202);
    expect(updateShoot.status).toBe(200);
    expect(users.status).toBe(200);
    expect(invite.status).toBe(403);
  }, 45000);

  it("allows department-scoped client success users to create shoots only inside their department", async () => {
    const schoolCreate = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${schoolsClientSuccessToken}`)
      .send({
        studio_id: studioId,
        organization_id: schoolOrganizationId,
        location_id: schoolLocationId,
        primary_contact_id: schoolPrimaryContactId,
        shoot_type: "schools_underclass_portraits",
        shoot_code: `SCH-${Date.now()}`,
        title: "Schools Client Success Shoot",
        shoot_date: localDate,
        geofence_radius_meters: 200,
        arrival_time: `${localDate}T14:00:00.000Z`,
        start_time: `${localDate}T14:15:00.000Z`,
        end_time_est: `${localDate}T15:15:00.000Z`
      });

    const schoolBlocked = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${schoolsClientSuccessToken}`)
      .send({
        studio_id: studioId,
        organization_id: sportsOrganizationId,
        location_id: sportsLocationId,
        primary_contact_id: sportsPrimaryContactId,
        shoot_type: "sports",
        shoot_code: `SCH-BLOCK-${Date.now()}`,
        title: "Blocked Sports Shoot",
        shoot_date: localDate,
        geofence_radius_meters: 200,
        arrival_time: `${localDate}T16:00:00.000Z`,
        start_time: `${localDate}T16:15:00.000Z`,
        end_time_est: `${localDate}T17:15:00.000Z`
      });

    const sportsCreate = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${sportsClientSuccessToken}`)
      .send({
        studio_id: studioId,
        organization_id: sportsOrganizationId,
        location_id: sportsLocationId,
        primary_contact_id: sportsPrimaryContactId,
        shoot_type: "sports",
        shoot_code: `SPT-${Date.now()}`,
        title: "Sports Client Success Shoot",
        shoot_date: localDate,
        geofence_radius_meters: 200,
        arrival_time: `${localDate}T18:00:00.000Z`,
        start_time: `${localDate}T18:15:00.000Z`,
        end_time_est: `${localDate}T19:15:00.000Z`
      });

    const sportsBlocked = await request(app)
      .post("/api/shoots")
      .set("Authorization", `Bearer ${sportsClientSuccessToken}`)
      .send({
        studio_id: studioId,
        organization_id: schoolOrganizationId,
        location_id: schoolLocationId,
        primary_contact_id: schoolPrimaryContactId,
        shoot_type: "schools_underclass_portraits",
        shoot_code: `SPT-BLOCK-${Date.now()}`,
        title: "Blocked Schools Shoot",
        shoot_date: localDate,
        geofence_radius_meters: 200,
        arrival_time: `${localDate}T20:00:00.000Z`,
        start_time: `${localDate}T20:15:00.000Z`,
        end_time_est: `${localDate}T21:15:00.000Z`
      });

    expect(schoolCreate.status).toBe(201);
    expect(schoolBlocked.status).toBe(403);
    expect(sportsCreate.status).toBe(201);
    expect(sportsBlocked.status).toBe(403);
  });

  it("allows customer-service metrics for office/customer-service staff but not photographers", async () => {
    const officeSummary = await request(app)
      .get("/api/zendesk/leadership-summary")
      .set("Authorization", `Bearer ${officeToken}`);
    const photographerSummary = await request(app)
      .get("/api/zendesk/leadership-summary")
      .set("Authorization", `Bearer ${legacyPhotographerToken}`);

    expect(officeSummary.status).toBe(200);
    expect(photographerSummary.status).toBe(403);
  });

  it("requires routed PTO approval authority and uses the fixed date-based request shape", async () => {
    const createPto = await request(app)
      .post("/api/shifts/pto-requests")
      .set("Authorization", `Bearer ${officeToken}`)
      .send({
        requested_on: localDate,
        request_unit: "full_day",
        reason: "Authority model PTO test"
      });

    expect(createPto.status).toBe(201);

    const ptoId = String(createPto.body.id);
    const photographerReview = await request(app)
      .post(`/api/shifts/pto-requests/${ptoId}/review`)
      .set("Authorization", `Bearer ${legacyPhotographerToken}`)
      .send({ status: "approved", notes: "Field user should not approve" });

    const adminReview = await request(app)
      .post(`/api/shifts/pto-requests/${ptoId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved", notes: "Director approval" });

    expect(photographerReview.status).toBe(403);
    expect(adminReview.status).toBe(200);
  });
});
