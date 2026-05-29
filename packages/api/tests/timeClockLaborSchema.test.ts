import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { createAuditLog } from "../src/services/audit.js";

type TestContext = {
  tenantId: string;
  employeeId: string;
  approverId: string;
  shiftId: string | null;
  shootId: string | null;
  locationId: string | null;
};

const ctx: TestContext = {
  tenantId: "",
  employeeId: "",
  approverId: "",
  shiftId: null,
  shootId: null,
  locationId: null
};

const primaryWorkDate = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const secondaryWorkDate = new Date(Date.now() + 36 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  const tenantResult = await pool.query<{ id: string }>("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  ctx.tenantId = tenantResult.rows[0]?.id ?? "";

  const employeeResult = await pool.query<{ id: string }>(
    "SELECT id FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1"
  );
  ctx.employeeId = employeeResult.rows[0]?.id ?? "";

  const approverResult = await pool.query<{ id: string }>(
    "SELECT id FROM app_user WHERE lower(email) = lower('admin@example.com') LIMIT 1"
  );
  ctx.approverId = approverResult.rows[0]?.id ?? "";

  const shiftResult = await pool.query<{
    shift_id: string | null;
    shoot_id: string | null;
    location_id: string | null;
  }>(
    `
      SELECT
        ws.id AS shift_id,
        ws.shoot_id,
        COALESCE(s.location_id, fallback_location.id) AS location_id
      FROM work_shift ws
      LEFT JOIN shoot s
        ON s.id = ws.shoot_id
      LEFT JOIN LATERAL (
        SELECT sl.id
        FROM shoot_location sl
        WHERE sl.tenant_id = ws.tenant_id
        ORDER BY sl.created_at ASC
        LIMIT 1
      ) fallback_location ON TRUE
      WHERE ws.tenant_id = $1
      ORDER BY ws.starts_at ASC
      LIMIT 1
    `,
    [ctx.tenantId]
  );

  ctx.shiftId = shiftResult.rows[0]?.shift_id ?? null;
  ctx.shootId = shiftResult.rows[0]?.shoot_id ?? null;
  ctx.locationId = shiftResult.rows[0]?.location_id ?? null;

  expect(ctx.tenantId).toBeTruthy();
  expect(ctx.employeeId).toBeTruthy();
  expect(ctx.approverId).toBeTruthy();
});

beforeEach(async () => {
  await pool.query(
    `
      DELETE FROM clock_event
      WHERE tenant_id = $1
        AND employee_id = $2
        AND event_timestamp::date = ANY($3::date[])
    `,
    [ctx.tenantId, ctx.employeeId, [primaryWorkDate, secondaryWorkDate]]
  );

  await pool.query(
    `
      DELETE FROM approval_record
      WHERE tenant_id = $1
        AND request_id IN (
          SELECT id
          FROM exception_request
          WHERE tenant_id = $1
            AND employee_id = $2
            AND submitted_at::date = ANY($3::date[])
        )
    `,
    [ctx.tenantId, ctx.employeeId, [primaryWorkDate, secondaryWorkDate]]
  );

  await pool.query(
    `
      DELETE FROM exception_request
      WHERE tenant_id = $1
        AND employee_id = $2
        AND submitted_at::date = ANY($3::date[])
    `,
    [ctx.tenantId, ctx.employeeId, [primaryWorkDate, secondaryWorkDate]]
  );

  await pool.query(
    `
      DELETE FROM time_session
      WHERE tenant_id = $1
        AND employee_id = $2
        AND work_date = ANY($3::date[])
    `,
    [ctx.tenantId, ctx.employeeId, [primaryWorkDate, secondaryWorkDate]]
  );
});

describe("time clock labor-state phase 1 foundation", () => {
  it("stores pay profiles, sessions, segments, events, exception requests, and approval records", async () => {
    await pool.query(
      `
        UPDATE employee_pay_profile
        SET active_status = false,
            updated_at = now()
        WHERE tenant_id = $1
          AND employee_id = $2
          AND active_status = true
      `,
      [ctx.tenantId, ctx.employeeId]
    );

    const payProfile = await pool.query(
      `
        INSERT INTO employee_pay_profile (
          tenant_id, employee_id, office_rate, photography_rate,
          overtime_eligible, mileage_eligible, active_status, effective_date
        )
        VALUES ($1, $2, 21.50, 34.25, true, true, true, current_date)
        ON CONFLICT (tenant_id, employee_id, effective_date)
        DO UPDATE SET
          office_rate = EXCLUDED.office_rate,
          photography_rate = EXCLUDED.photography_rate,
          overtime_eligible = EXCLUDED.overtime_eligible,
          mileage_eligible = EXCLUDED.mileage_eligible,
          active_status = EXCLUDED.active_status,
          updated_at = now()
        RETURNING *
      `,
      [ctx.tenantId, ctx.employeeId]
    );

    const session = await pool.query(
      `
        INSERT INTO time_session (
          tenant_id, employee_id, work_date, source_shift_id, status
        )
        VALUES ($1, $2, $3::date, $4, 'open')
        RETURNING *
      `,
      [ctx.tenantId, ctx.employeeId, primaryWorkDate, ctx.shiftId]
    );

    const segment = await pool.query(
      `
        INSERT INTO time_segment (
          tenant_id, session_id, employee_id, work_state, linked_shoot_id, linked_location_id,
          start_time, end_time, source_type, geofence_supported, review_status
        )
        VALUES (
          $1, $2, $3, 'office_drive', $4, $5,
          now() - interval '45 minutes', now(), 'manual', true, 'pending_review'
        )
        RETURNING *
      `,
      [ctx.tenantId, session.rows[0].id, ctx.employeeId, ctx.shootId, ctx.locationId]
    );

    const clockEvent = await pool.query(
      `
        INSERT INTO clock_event (
          tenant_id, employee_id, linked_session_id, linked_segment_id, linked_shoot_id, linked_location_id,
          event_type, event_timestamp, latitude, longitude, metadata, created_by_actor
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          'work_state_started', now() - interval '45 minutes', 44.9778, -93.2650,
          '{"note":"phase-1 test event"}'::jsonb, 'employee'
        )
        RETURNING *
      `,
      [ctx.tenantId, ctx.employeeId, session.rows[0].id, segment.rows[0].id, ctx.shootId, ctx.locationId]
    );

    const exceptionRequest = await pool.query(
      `
        INSERT INTO exception_request (
          tenant_id, employee_id, request_type, linked_shoot_id, linked_session_id, linked_segment_id,
          requested_state, requested_start_time, requested_end_time, note, status
        )
        VALUES (
          $1, $2, 'time_segment_correction', $3, $4, $5,
          'photography', now() - interval '30 minutes', now() - interval '10 minutes',
          'Correct drive block to photography for payroll review.', 'submitted'
        )
        RETURNING *
      `,
      [ctx.tenantId, ctx.employeeId, ctx.shootId, session.rows[0].id, segment.rows[0].id]
    );

    const approvalRecord = await pool.query(
      `
        INSERT INTO approval_record (
          tenant_id, request_id, approver_id, approver_role, decision, comment
        )
        VALUES ($1, $2, $3, 'leadership', 'approved', 'Approved for phase-1 test coverage.')
        RETURNING *
      `,
      [ctx.tenantId, exceptionRequest.rows[0].id, ctx.approverId]
    );

    expect(payProfile.rows[0].office_rate).toBe("21.50");
    expect(payProfile.rows[0].photography_rate).toBe("34.25");
    expect(session.rows[0].status).toBe("open");
    expect(segment.rows[0].work_state).toBe("office_drive");
    expect(Number(segment.rows[0].duration_minutes)).toBeGreaterThanOrEqual(45);
    expect(clockEvent.rows[0].event_type).toBe("work_state_started");
    expect(exceptionRequest.rows[0].request_type).toBe("time_segment_correction");
    expect(approvalRecord.rows[0].decision).toBe("approved");
  });

  it("enforces one active pay profile and one open session per employee work date", async () => {
    const secondProfile = pool.query(
      `
        INSERT INTO employee_pay_profile (
          tenant_id, employee_id, office_rate, photography_rate,
          overtime_eligible, mileage_eligible, active_status, effective_date
        )
        VALUES ($1, $2, 24.00, 36.00, true, false, true, current_date + interval '1 day')
      `,
      [ctx.tenantId, ctx.employeeId]
    );

    await expect(secondProfile).rejects.toThrow(/employee_pay_profile_active_employee_uq|duplicate key/i);

    const session = await pool.query(
      `
        INSERT INTO time_session (
          tenant_id, employee_id, work_date, source_shift_id, status
        )
        VALUES ($1, $2, $3::date, $4, 'open')
        RETURNING *
      `,
      [ctx.tenantId, ctx.employeeId, secondaryWorkDate, ctx.shiftId]
    );

    const duplicateOpenSession = pool.query(
      `
        INSERT INTO time_session (
          tenant_id, employee_id, work_date, source_shift_id, status
        )
        VALUES ($1, $2, $3, $4, 'open')
      `,
      [ctx.tenantId, ctx.employeeId, session.rows[0].work_date, ctx.shiftId]
    );

    await expect(duplicateOpenSession).rejects.toThrow(/time_session_employee_work_date_open_uq|duplicate key/i);
  });

  it("stores before/after values and reason comment in the audit log", async () => {
    const audit = await createAuditLog(pool, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.approverId,
      targetUserId: ctx.employeeId,
      action: "time_segment.corrected",
      entityType: "time_segment",
      entityId: randomUUID(),
      previousValues: {
        work_state: "office_drive",
        end_time: "2026-03-27T15:00:00.000Z"
      },
      newValues: {
        work_state: "photography",
        end_time: "2026-03-27T15:10:00.000Z"
      },
      reasonComment: "Approved correction after field review.",
      metadata: {
        review_status: "approved"
      }
    });

    expect(audit.reason_comment).toBe("Approved correction after field review.");
    expect(audit.previous_values.work_state).toBe("office_drive");
    expect(audit.new_values.work_state).toBe("photography");
  });
});
