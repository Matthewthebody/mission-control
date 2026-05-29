import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { normalizeLocationText } from "../src/services/locationCatalog.js";
import { ApiError } from "../src/errors/apiError.js";
import * as mondayService from "../src/services/locationMonday.js";
import { passwordLogin } from "./helpers.js";

const app = createApp();

let leadershipToken = "";
let tenantId = "";
let studioId = "";
let leadershipUserId = "";
let referenceDate = "";
const originalMondayToken = config.MONDAY_API_TOKEN;

beforeAll(async () => {
  leadershipToken = (await passwordLogin(app, "leadership@example.com")).body.token;

  const context = await pool.query(
    `
      SELECT
        t.id AS tenant_id,
        st.id AS studio_id,
        u.id AS leadership_user_id,
        CURRENT_DATE::text AS reference_date
      FROM tenant t
      JOIN studio st ON st.tenant_id = t.id
      JOIN app_user u ON u.tenant_id = t.id
      WHERE t.name = 'Demo Studio'
        AND st.name = 'Main Studio'
        AND lower(u.email) = lower('leadership@example.com')
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id as string;
  studioId = context.rows[0].studio_id as string;
  leadershipUserId = context.rows[0].leadership_user_id as string;
  referenceDate = context.rows[0].reference_date as string;
});

beforeEach(async () => {
  await cleanupLocationsTestData();
  mondayService.resetMondayLocationCaches();
  vi.restoreAllMocks();
});

afterEach(() => {
  mondayService.resetMondayLocationCaches();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  config.MONDAY_API_TOKEN = originalMondayToken;
});

describe("shoot locations integration", () => {
  it("maps Monday post-shoot history into normalized evaluation rows", async () => {
    const evaluation = mondayService.mapMondayEvaluationRecordForTests({
      id: "monday-eval-1",
      name: "North Metro Stadium",
      column_values: [
        { id: "date", text: "2026-03-20" },
        { id: "short_text", text: "Demo Associate Photographer" },
        { id: "single_select", text: "Sports" },
        { id: "single_select7", text: "No" },
        { id: "single_select0", text: "Yes" },
        { id: "long_text", text: "Traffic stacked up near the athlete entrance." },
        { id: "short_text2", text: "Called the school office on arrival." },
        { id: "short_text67", text: "Unload near the east gate first." },
        { id: "rating_mkrnafzr", text: "4" },
        { id: "text_mkrn46s0", text: "Strong" },
        { id: "color_mks1j8nt", text: "Yes" },
        { id: "short_text5", text: "Late by 8 minutes." },
        { id: "short_text66", text: "Easy once the east gate was opened." }
      ]
    });

    expect(evaluation).toMatchObject({
      source: "monday",
      monday_item_id: "monday-eval-1",
      shoot_name: "North Metro Stadium",
      photographer_name: "Demo Associate Photographer",
      shoot_type: "Sports",
      on_time: "No",
      easy_access: "Yes",
      overall_rating: 4,
      recommendations: "Unload near the east gate first."
    });
  });

  it("enriches Outlook shoot previews with matched location intelligence and a stable shoot id", async () => {
    const shoot = await insertTestShoot({
      shootCode: `LOC-TEST-MATCH-${Date.now()}`,
      title: "Location Match Coverage",
      locationName: "Test Match Academy",
      locationAddress: "501 Match Way, Minneapolis, MN",
      startHour: 5,
      endHour: 7
    });
    await insertTestLocation({
      name: "Test Match Academy",
      address: "501 Match Way, Minneapolis, MN",
      details: "Unload along the south curb and enter through Door 2."
    });
    vi.spyOn(mondayService, "listHistoricalLocationEvaluations").mockResolvedValue(new Map());

    const response = await request(app)
      .get(
        `/api/locations/intelligence?shoot_id=${encodeURIComponent(shoot.id)}&shoot_code=${encodeURIComponent(shoot.shoot_code)}&shoot_location_name=${encodeURIComponent("Test Match Academy")}&shoot_location_address=${encodeURIComponent("501 Match Way, Minneapolis, MN")}&event_subject=${encodeURIComponent(`${shoot.shoot_code} | ${shoot.title}`)}&event_location=${encodeURIComponent("Test Match Academy")}`
      )
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      shoot_id: shoot.id,
      shoot_code: shoot.shoot_code,
      matched_location_id: expect.any(String),
      match_source: "shoot",
      location: {
        name: "Test Match Academy"
      }
    });
    expect(response.body.historical_context).toMatchObject({
      quick_context: {
        first_time_location: true,
        trust_source: "no_history"
      }
    });
  });

  it("dual-writes evaluations, persists setup photo metadata, and clears missing-photo alerts after upload", async () => {
    const shoot = await insertTestShoot({
      shootCode: `LOC-TEST-EVAL-${Date.now()}`,
      title: "Evaluation Coverage",
      locationName: "Fieldhouse South",
      locationAddress: "99 Fieldhouse Lane, Eden Prairie, MN",
      startHour: 12,
      endHour: 14
    });
    const locationId = await insertTestLocation({
      name: "Fieldhouse South",
      address: "99 Fieldhouse Lane, Eden Prairie, MN",
      details: "Use the trainer entrance and keep a second backdrop ready."
    });

    vi.spyOn(mondayService, "createMondayEvaluation").mockResolvedValue({
      monday_item_id: "monday-eval-created",
      raw_payload: { mocked: true, create_item: { id: "monday-eval-created" } }
    });
    vi.spyOn(mondayService, "uploadMondayLocationPhoto").mockResolvedValue({
      monday_item_id: "monday-location-item",
      monday_asset_id: "monday-asset-created",
      image_url: "https://files.monday.com/protected_static/fieldhouse-setup.jpg",
      raw_payload: { mocked: true, add_file_to_column: { id: "monday-asset-created" } }
    });
    vi.spyOn(mondayService, "listHistoricalLocationEvaluations").mockResolvedValue(new Map());

    const evaluation = await request(app)
      .post(`/api/locations/${locationId}/evaluations`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        shoot_id: shoot.id,
        shoot_name: shoot.title,
        shoot_date: referenceDate,
        photographer_name: "Demo Photographer",
        shoot_type: "Schools",
        on_time: "Yes",
        easy_access: "No",
        overall_rating: 4,
        photos_uploaded: "No",
        access_details: "Loading dock needed a staff escort.",
        recommendations: "Have a senior open the dock before unload."
      });

    expect(evaluation.status).toBe(201);

    const storedEvaluation = await pool.query(
      `
        SELECT monday_item_id, photos_uploaded, raw_payload
        FROM post_shoot_evaluation
        WHERE tenant_id = $1
          AND location_id = $2
          AND shoot_id = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, locationId, shoot.id]
    );
    expect(storedEvaluation.rows[0].monday_item_id).toBe("monday-eval-created");
    expect(storedEvaluation.rows[0].photos_uploaded).toBe("No");

    const openAlert = await pool.query(
      `
        SELECT id, status
        FROM alert
        WHERE tenant_id = $1
          AND shoot_id = $2
          AND alert_type = 'MISSING_SETUP_PHOTO'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, shoot.id]
    );
    expect(openAlert.rows[0]).toMatchObject({ status: "open" });

    const photoUpload = await request(app)
      .post(`/api/locations/${locationId}/setup-photos`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        shoot_id: shoot.id,
        file_name: "fieldhouse-setup.jpg",
        content_type: "image/jpeg",
        data_url: "data:image/jpeg;base64,SGVsbG8="
      });

    expect(photoUpload.status).toBe(201);

    const storedPhoto = await pool.query(
      `
        SELECT monday_asset_id, monday_item_id, image_url, file_name
        FROM setup_photo_upload
        WHERE tenant_id = $1
          AND location_id = $2
          AND shoot_id = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, locationId, shoot.id]
    );
    expect(storedPhoto.rows[0]).toMatchObject({
      monday_asset_id: "monday-asset-created",
      file_name: "fieldhouse-setup.jpg"
    });

    const mirroredResource = await pool.query(
      `
        SELECT category::text, approval_status::text, visibility_scope::text, file_name
        FROM resource_library_item
        WHERE tenant_id = $1
          AND source_record_type = 'setup_photo_upload'
          AND source_record_id = (
            SELECT id
            FROM setup_photo_upload
            WHERE tenant_id = $1
              AND location_id = $2
              AND shoot_id = $3
            ORDER BY created_at DESC
            LIMIT 1
          )
        LIMIT 1
      `,
      [tenantId, locationId, shoot.id]
    );
    expect(mirroredResource.rows[0]).toMatchObject({
      category: "setup_photo",
      approval_status: "approved",
      visibility_scope: "photographer_prep",
      file_name: "fieldhouse-setup.jpg"
    });

    const resolvedAlert = await pool.query(
      `
        SELECT status, resolution_note
        FROM alert
        WHERE id = $1
      `,
      [openAlert.rows[0].id]
    );
    expect(resolvedAlert.rows[0].status).toBe("resolved");
    expect(String(resolvedAlert.rows[0].resolution_note)).toMatch(/setup photo upload/i);

    const detail = await request(app)
      .get(`/api/locations/${locationId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.historical_context).toMatchObject({
      quick_context: {
        first_time_location: false,
        total_prior_visits: 1
      },
      last_time_here: {
        shoot_type: "Schools",
        setup_photos_exist: true
      },
      setup_visuals: {
        photos: [
          {
            caption: "fieldhouse-setup.jpg"
          }
        ]
      }
    });
  });

  it("only proxies Monday protected images and returns proxied content for valid requests", async () => {
    await expect(mondayService.proxyMondayProtectedImage("https://example.com/not-monday.jpg")).rejects.toMatchObject<ApiError>({
      status: 400,
      message: "Only Monday protected image URLs can be proxied"
    });

    await expect(mondayService.proxyMondayProtectedImage("https://evilmonday.com/protected_static/not-safe.jpg")).rejects.toMatchObject<ApiError>({
      status: 400,
      message: "Only Monday protected image URLs can be proxied"
    });
  });

  it("forces redirect blocking on Monday proxy fetches and rejects unexpected proxy responses", async () => {
    config.MONDAY_API_TOKEN = "test-monday-token";
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "image/jpeg"
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const proxied = await mondayService.proxyMondayProtectedImage("https://files.monday.com/protected_static/valid-image.jpg");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(proxied.contentType).toBe("image/jpeg");
    expect(proxied.buffer.byteLength).toBe(3);

    fetchMock.mockResolvedValueOnce(
      new Response("<html>not an image</html>", {
        status: 200,
        headers: {
          "content-type": "text/html"
        }
      })
    );

    await expect(
      mondayService.proxyMondayProtectedImage("https://files.monday.com/protected_static/bad-content-type.jpg")
    ).rejects.toMatchObject<ApiError>({
      status: 502,
      message: "Monday image proxy returned an unexpected content type"
    });
  });

  it("rejects oversized Monday proxy responses instead of buffering them into memory", async () => {
    config.MONDAY_API_TOKEN = "test-monday-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(8 * 1_048_576 + 1)
          }
        })
      )
    );

    await expect(
      mondayService.proxyMondayProtectedImage("https://files.monday.com/protected_static/too-large.jpg")
    ).rejects.toMatchObject<ApiError>({
      status: 502,
      message: "Monday response exceeded the maximum allowed size"
    });
  });

  it("retries Monday read-only history fetches once after a rate-limit response", async () => {
    config.MONDAY_API_TOKEN = "test-monday-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: "rate limited" }] }), {
          status: 429,
          headers: {
            "content-type": "application/json"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              boards: [
                {
                  items_page: {
                    items: [
                      {
                        id: "monday-history-1",
                        name: "North Metro Stadium",
                        column_values: [{ id: "date", text: "2026-03-20" }]
                      }
                    ]
                  }
                }
              ]
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const evaluations = await mondayService.listHistoricalLocationEvaluations([
      {
        id: "location-history-1",
        name: "North Metro Stadium",
        address: null
      }
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(evaluations.get("location-history-1")?.[0].monday_item_id).toBe("monday-history-1");
  });

  it("rejects setup photo uploads with mismatched or unsafe payload metadata", async () => {
    const shoot = await insertTestShoot({
      shootCode: `LOC-TEST-UPLOAD-${Date.now()}`,
      title: "Upload Validation Coverage",
      locationName: "Validation Hall",
      locationAddress: "88 Validation Way, Minneapolis, MN",
      startHour: 10,
      endHour: 12
    });
    const locationId = await insertTestLocation({
      name: "Validation Hall",
      address: "88 Validation Way, Minneapolis, MN",
      details: "Use the front lobby for safe unload."
    });

    const mismatchedType = await request(app)
      .post(`/api/locations/${locationId}/setup-photos`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        shoot_id: shoot.id,
        file_name: "bad-upload.jpg",
        content_type: "image/png",
        data_url: "data:image/jpeg;base64,SGVsbG8="
      });

    expect(mismatchedType.status).toBe(400);
    expect(mismatchedType.body.error).toMatch(/content type/i);

    const unsafeName = await request(app)
      .post(`/api/locations/${locationId}/setup-photos`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        shoot_id: shoot.id,
        file_name: "../escape.jpg",
        content_type: "image/jpeg",
        data_url: "data:image/jpeg;base64,SGVsbG8="
      });

    expect(unsafeName.status).toBe(400);
    expect(unsafeName.body.error).toBe("Validation failed");
  });

  it("sanitizes unexpected integration failures instead of echoing internal error details", async () => {
    const shoot = await insertTestShoot({
      shootCode: `LOC-TEST-SAFE-${Date.now()}`,
      title: "Safe Error Coverage",
      locationName: "Safety Center",
      locationAddress: "77 Safety Way, Minneapolis, MN",
      startHour: 8,
      endHour: 10
    });
    const locationId = await insertTestLocation({
      name: "Safety Center",
      address: "77 Safety Way, Minneapolis, MN"
    });

    vi.spyOn(mondayService, "createMondayEvaluation").mockRejectedValue(new Error("MONDAY_API_TOKEN should never leak"));

    const response = await request(app)
      .post(`/api/locations/${locationId}/evaluations`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        shoot_id: shoot.id,
        shoot_name: shoot.title,
        shoot_date: referenceDate,
        photographer_name: "Demo Photographer",
        shoot_type: "Schools",
        on_time: "Yes",
        easy_access: "Yes",
        overall_rating: 5,
        photos_uploaded: "Yes"
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    expect(JSON.stringify(response.body)).not.toContain("MONDAY_API_TOKEN");
  });
});

async function cleanupLocationsTestData() {
  const shootRows = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM shoot
      WHERE tenant_id = $1
        AND shoot_code LIKE 'LOC-TEST-%'
    `,
    [tenantId]
  );
  const shootIds = shootRows.rows.map((row) => row.id);

  const locationRows = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM shoot_location
      WHERE tenant_id = $1
        AND external_source = 'locations_test'
    `,
    [tenantId]
  );
  const locationIds = locationRows.rows.map((row) => row.id);

  if (shootIds.length) {
    await pool.query("DELETE FROM app_event WHERE tenant_id = $1 AND payload->>'shoot_id' = ANY($2::text[])", [tenantId, shootIds]);
    await pool.query("DELETE FROM alert WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenantId, shootIds]);
    await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenantId, shootIds]);
    await pool.query("DELETE FROM media_asset WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenantId, shootIds]);
    await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenantId, shootIds]);
    await pool.query("DELETE FROM shoot_assignment WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenantId, shootIds]);
  }

  if (locationIds.length) {
    await pool.query("DELETE FROM setup_photo_upload WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])", [tenantId, locationIds]);
    await pool.query("DELETE FROM post_shoot_evaluation WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])", [tenantId, locationIds]);
    await pool.query("DELETE FROM shoot_location_alias WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])", [tenantId, locationIds]);
    await pool.query("DELETE FROM shoot_location_link WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])", [tenantId, locationIds]);
    await pool.query("DELETE FROM shoot_location_area WHERE tenant_id = $1 AND location_id = ANY($2::uuid[])", [tenantId, locationIds]);
    await pool.query("DELETE FROM shoot_location WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, locationIds]);
  }

  if (shootIds.length) {
    await pool.query("DELETE FROM shoot WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, shootIds]);
  }
}

async function insertTestLocation(input: {
  name: string;
  address: string;
  details?: string;
}) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO shoot_location (
        tenant_id,
        external_source,
        external_key,
        name,
        normalized_name,
        address,
        normalized_address,
        location_details,
        commentary,
        custodian_contact,
        photo_urls,
        last_catalog_sync_at
      )
      VALUES (
        $1,
        'locations_test',
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'Imported from the feature-port regression harness.',
        'Desk lead',
        '[]'::jsonb,
        now()
      )
      RETURNING id
    `,
    [
      tenantId,
      `test:${input.name}:${Date.now()}`,
      input.name,
      normalizeLocationText(input.name),
      input.address,
      normalizeLocationText(input.address),
      input.details ?? null
    ]
  );

  return rows[0].id;
}

async function insertTestShoot(input: {
  shootCode: string;
  title: string;
  locationName: string;
  locationAddress: string;
  startHour: number;
  endHour: number;
}) {
  const arrival = new Date(`${referenceDate}T${String(Math.max(0, input.startHour - 1)).padStart(2, "0")}:30:00.000Z`);
  const start = new Date(`${referenceDate}T${String(input.startHour).padStart(2, "0")}:00:00.000Z`);
  const end = new Date(`${referenceDate}T${String(input.endHour).padStart(2, "0")}:00:00.000Z`);

  const { rows } = await pool.query<{ id: string; shoot_code: string; title: string }>(
    `
      INSERT INTO shoot (
        tenant_id,
        studio_id,
        shoot_code,
        title,
        shoot_date,
        location_name,
        location_address,
        location_lat,
        location_lng,
        geofence_radius_meters,
        arrival_time,
        start_time,
        end_time_est,
        created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,44.9778,-93.2649,1609,$8,$9,$10,$11)
      RETURNING id, shoot_code, title
    `,
    [tenantId, studioId, input.shootCode, input.title, referenceDate, input.locationName, input.locationAddress, arrival, start, end, leadershipUserId]
  );

  return rows[0];
}
