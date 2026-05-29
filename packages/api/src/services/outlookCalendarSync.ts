import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { config } from "../config.js";
import { queueScheduleSync } from "./scheduleSync.js";

export type WorkShiftOutlookSyncStatus =
  | "not_queued"
  | "pending"
  | "processing"
  | "synced"
  | "failed"
  | "cancelled";

export type WorkShiftOutlookConflictStatus = "clear" | "warning" | "blocking";

type ShiftSyncRow = {
  id: string;
  tenant_id: string;
  shoot_id: string | null;
  assigned_user_id: string;
  assigned_user_email: string | null;
  assigned_user_name: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  location_address: string | null;
  notes: string | null;
  staffing_role: string | null;
  status: string;
  cancelled_at: string | null;
  updated_at: string;
  outlook_event_id: string | null;
  outlook_calendar_owner_email: string | null;
  sync_status: WorkShiftOutlookSyncStatus;
  conflict_status: WorkShiftOutlookConflictStatus;
  conflict_detail: Record<string, unknown> | null;
};

export async function queueWorkShiftOutlookSync(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId: string;
    triggeredByUserId?: string | null;
    operationType?: "upsert" | "cancel";
    previousAssignedUserId?: string | null;
    previousAssignedUserEmail?: string | null;
    previousOutlookEventId?: string | null;
    previousOutlookCalendarOwnerEmail?: string | null;
    conflictStatus?: WorkShiftOutlookConflictStatus | null;
    conflictDetail?: Record<string, unknown> | null;
    dedupeSuffix?: string | null;
  }
) {
  const shift = await loadShiftForSync(client, input.shiftId);
  if (!shift || shift.tenant_id !== input.tenantId) {
    throw new ApiError(404, "Shift not found");
  }

  const operationType = input.operationType ?? (shift.cancelled_at ? "cancel" : "upsert");
  const conflictStatus = input.conflictStatus ?? shift.conflict_status ?? "clear";
  const conflictDetail = input.conflictDetail ?? shift.conflict_detail ?? {};
  const nextSyncStatus = "pending";

  await client.query(
    `
      UPDATE work_shift
      SET calendar_sync_required = true,
          sync_status = $3::outlook_shift_sync_status,
          sync_error = NULL,
          conflict_status = $4::outlook_conflict_status,
          conflict_detail = $5::jsonb,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.shiftId, nextSyncStatus, conflictStatus, JSON.stringify(conflictDetail)]
  );

  return queueScheduleSync(client, {
    tenantId: input.tenantId,
    aggregateType: "work_shift",
    aggregateId: input.shiftId,
    dedupeSuffix:
      input.dedupeSuffix ??
      [operationType, shift.updated_at ?? shift.id, input.previousAssignedUserId ?? "na", input.previousOutlookEventId ?? "na"].join(":"),
    operationType,
    payload: {
      shift_id: shift.id,
      operation_type: operationType,
      source_object: {
        type: "work_shift",
        id: shift.id,
        related_job_id: shift.shoot_id
      },
      target_object: {
        type: "outlook_calendar_event",
        id: shift.outlook_event_id,
        owner_email: shift.outlook_calendar_owner_email ?? shift.assigned_user_email ?? null
      },
      sync_state: {
        last_attempted_sync_at: null,
        last_successful_sync_at: null,
        last_failed_sync_at: null,
        retry_state: "pending_dispatch"
      },
      write_intent: {
        source_of_truth: "mission_control",
        delivery_layer: "outlook_calendar",
        explicit_user_action: Boolean(input.triggeredByUserId),
        operation_type: operationType
      },
      assigned_user_id: shift.assigned_user_id,
      assigned_user_email: shift.assigned_user_email,
      assigned_user_name: shift.assigned_user_name,
      title: shift.title,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      timezone: config.OUTLOOK_CALENDAR_TIMEZONE,
      location_name: shift.location_name,
      location_address: shift.location_address,
      notes_summary: summarizeShiftNotes(shift.notes),
      assigned_role: shift.staffing_role ?? "photographer",
      job_id_reference: shift.shoot_id,
      outlook_event_id: shift.outlook_event_id,
      outlook_calendar_owner_email: shift.outlook_calendar_owner_email,
      previous_assigned_user_id: input.previousAssignedUserId ?? null,
      previous_assigned_user_email: input.previousAssignedUserEmail ?? null,
      previous_outlook_event_id: input.previousOutlookEventId ?? null,
      previous_outlook_calendar_owner_email: input.previousOutlookCalendarOwnerEmail ?? null,
      conflict_status: conflictStatus,
      conflict_detail: conflictDetail
    },
    triggeredByUserId: input.triggeredByUserId ?? null
  });
}

export async function updateWorkShiftConflictState(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId: string;
    conflictStatus: WorkShiftOutlookConflictStatus;
    conflictDetail?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE work_shift
      SET conflict_status = $3::outlook_conflict_status,
          conflict_detail = $4::jsonb,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.shiftId, input.conflictStatus, JSON.stringify(input.conflictDetail ?? {})]
  );
}

async function loadShiftForSync(client: PoolClient, shiftId: string) {
  const { rows } = await client.query<ShiftSyncRow>(
    `
      SELECT
        ws.id,
        ws.tenant_id,
        ws.shoot_id,
        ws.assigned_user_id,
        au.email AS assigned_user_email,
        au.full_name AS assigned_user_name,
        ws.title,
        ws.starts_at::text,
        ws.ends_at::text,
        ws.location_name,
        ws.location_address,
        ws.notes,
        ws.staffing_role::text,
        ws.status::text,
        ws.cancelled_at::text,
        ws.updated_at::text,
        ws.outlook_event_id,
        ws.outlook_calendar_owner_email,
        ws.sync_status::text,
        ws.conflict_status::text,
        ws.conflict_detail
      FROM work_shift ws
      JOIN app_user au
        ON au.id = ws.assigned_user_id
      WHERE ws.id = $1
      LIMIT 1
    `,
    [shiftId]
  );

  return rows[0] ?? null;
}

function summarizeShiftNotes(notes: string | null) {
  if (!notes) {
    return null;
  }
  const compact = notes.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }
  return compact.slice(0, 240);
}
