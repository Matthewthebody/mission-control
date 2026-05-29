import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import type {
  TimeClockComplianceItem,
  TimeClockComplianceSeverity,
  TimeClockComplianceStatus
} from "../types/timeClock.js";
import { createAuditLog } from "./audit.js";
import { shouldRestrictShiftList } from "./shiftAccess.js";

export type TimeClockComplianceFlagRecord = {
  id: string;
  tenant_id: string;
  employee_id: string;
  shift_id: string | null;
  session_id: string | null;
  shoot_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  linked_exception_request_id: string | null;
  item_type: TimeClockComplianceItem;
  severity: TimeClockComplianceSeverity;
  status: TimeClockComplianceStatus;
  dedupe_key: string;
  metadata: Record<string, unknown>;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type TimeClockCompliancePreview = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  shift_id: string | null;
  shift_title: string | null;
  session_id: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  location_name: string | null;
  linked_exception_request_id: string | null;
  item_type: TimeClockComplianceItem;
  item_label: string;
  severity: TimeClockComplianceSeverity;
  status: TimeClockComplianceStatus;
  dedupe_key: string;
  message: string;
  metadata: Record<string, unknown>;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

const ITEM_LABELS: Record<TimeClockComplianceItem, string> = {
  missing_setup_photo: "Missing Setup Photo",
  missing_post_shoot_evaluation: "Missing Post-Shoot Evaluation",
  mileage_blocked_missing_post_shoot_evaluation: "Mileage Blocked By Missing Post-Shoot Evaluation",
  upload_while_off_clock: "Upload While Off Clock",
  unresolved_end_of_day_confirmation: "Needs End-of-Day Confirmation"
};

function buildDefaultMessage(itemType: TimeClockComplianceItem) {
  switch (itemType) {
    case "missing_setup_photo":
      return "Setup Photo is still missing for this Shoot.";
    case "missing_post_shoot_evaluation":
      return "Post-Shoot Evaluation is still missing for this Shoot.";
    case "mileage_blocked_missing_post_shoot_evaluation":
      return "Mileage is blocked until the Post-Shoot Evaluation is submitted.";
    case "upload_while_off_clock":
      return "Operational media was uploaded while the employee was Off Clock. Review whether a missed clock-in or correction request is needed.";
    case "unresolved_end_of_day_confirmation":
      return "This Time Session still needs end-of-day confirmation before the paid state is fully settled.";
    default:
      return "Operational compliance review is still required.";
  }
}

function normalizeMessage(itemType: TimeClockComplianceItem, metadata: Record<string, unknown>) {
  return typeof metadata.message === "string" && metadata.message.trim()
    ? metadata.message.trim()
    : buildDefaultMessage(itemType);
}

function countByItem(rows: TimeClockCompliancePreview[]) {
  return rows.reduce<Record<TimeClockComplianceItem, number>>(
    (counts, row) => {
      counts[row.item_type] += 1;
      return counts;
    },
    {
      missing_setup_photo: 0,
      missing_post_shoot_evaluation: 0,
      mileage_blocked_missing_post_shoot_evaluation: 0,
      upload_while_off_clock: 0,
      unresolved_end_of_day_confirmation: 0
    }
  );
}

export function buildTimeClockComplianceDedupeKey(
  itemType: TimeClockComplianceItem,
  parts: Array<string | null | undefined>
) {
  return [itemType, ...parts.filter((part): part is string => Boolean(part && part.trim()))].join(":");
}

export function timeClockComplianceItemLabel(itemType: TimeClockComplianceItem) {
  return ITEM_LABELS[itemType];
}

export async function upsertTimeClockComplianceFlag(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    shiftId?: string | null;
    sessionId?: string | null;
    shootId?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    linkedExceptionRequestId?: string | null;
    itemType: TimeClockComplianceItem;
    severity?: TimeClockComplianceSeverity;
    dedupeKey: string;
    metadata?: Record<string, unknown>;
    detectedAt?: string;
    actorUserId?: string | null;
  }
) {
  const detectedAt = input.detectedAt ?? new Date().toISOString();
  const metadata = {
    item_label: ITEM_LABELS[input.itemType],
    ...input.metadata
  };

  const existing = await client.query<TimeClockComplianceFlagRecord>(
    `
      SELECT
        id,
        tenant_id,
        employee_id,
        shift_id,
        session_id,
        shoot_id,
        organization_id,
        location_id,
        linked_exception_request_id,
        item_type::text AS item_type,
        severity::text AS severity,
        status::text AS status,
        dedupe_key,
        metadata,
        first_detected_at::text,
        last_detected_at::text,
        resolved_at::text,
        resolution_note,
        created_at::text,
        updated_at::text
      FROM time_clock_compliance_flag
      WHERE tenant_id = $1
        AND dedupe_key = $2
        AND status = 'open'
      LIMIT 1
    `,
    [input.tenantId, input.dedupeKey]
  );

  if (existing.rows[0]) {
    const { rows } = await client.query<TimeClockComplianceFlagRecord>(
      `
        UPDATE time_clock_compliance_flag
        SET
          employee_id = $2,
          shift_id = COALESCE($3::uuid, shift_id),
          session_id = COALESCE($4::uuid, session_id),
          shoot_id = COALESCE($5::uuid, shoot_id),
          organization_id = COALESCE($6::uuid, organization_id),
          location_id = COALESCE($7::uuid, location_id),
          linked_exception_request_id = COALESCE($8::uuid, linked_exception_request_id),
          severity = $9::time_clock_compliance_severity,
          metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb,
          last_detected_at = $11::timestamptz,
          updated_at = now()
        WHERE id = $1
        RETURNING
          id,
          tenant_id,
          employee_id,
          shift_id,
          session_id,
          shoot_id,
          organization_id,
          location_id,
          linked_exception_request_id,
          item_type::text AS item_type,
          severity::text AS severity,
          status::text AS status,
          dedupe_key,
          metadata,
          first_detected_at::text,
          last_detected_at::text,
          resolved_at::text,
          resolution_note,
          created_at::text,
          updated_at::text
      `,
      [
        existing.rows[0].id,
        input.employeeId,
        input.shiftId ?? null,
        input.sessionId ?? null,
        input.shootId ?? null,
        input.organizationId ?? null,
        input.locationId ?? null,
        input.linkedExceptionRequestId ?? null,
        input.severity ?? "warning",
        JSON.stringify(metadata),
        detectedAt
      ]
    );
    return { flag: rows[0], created: false };
  }

  const { rows } = await client.query<TimeClockComplianceFlagRecord>(
    `
      INSERT INTO time_clock_compliance_flag (
        tenant_id,
        employee_id,
        shift_id,
        session_id,
        shoot_id,
        organization_id,
        location_id,
        linked_exception_request_id,
        item_type,
        severity,
        status,
        dedupe_key,
        metadata,
        first_detected_at,
        last_detected_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11,$12::jsonb,$13::timestamptz,$13::timestamptz)
      RETURNING
        id,
        tenant_id,
        employee_id,
        shift_id,
        session_id,
        shoot_id,
        organization_id,
        location_id,
        linked_exception_request_id,
        item_type::text AS item_type,
        severity::text AS severity,
        status::text AS status,
        dedupe_key,
        metadata,
        first_detected_at::text,
        last_detected_at::text,
        resolved_at::text,
        resolution_note,
        created_at::text,
        updated_at::text
    `,
    [
      input.tenantId,
      input.employeeId,
      input.shiftId ?? null,
      input.sessionId ?? null,
      input.shootId ?? null,
      input.organizationId ?? null,
      input.locationId ?? null,
      input.linkedExceptionRequestId ?? null,
      input.itemType,
      input.severity ?? "warning",
      input.dedupeKey,
      JSON.stringify(metadata),
      detectedAt
    ]
  );

  await createAuditLog(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.employeeId,
    action: "time_clock.compliance_flag.created",
    entityType: "time_clock_compliance_flag",
    entityId: rows[0].id,
    newValues: {
      item_type: input.itemType,
      severity: input.severity ?? "warning",
      dedupe_key: input.dedupeKey
    },
    metadata
  });

  return { flag: rows[0], created: true };
}

export async function resolveTimeClockComplianceFlags(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId?: string | null;
    shiftId?: string | null;
    sessionId?: string | null;
    shootId?: string | null;
    linkedExceptionRequestId?: string | null;
    itemTypes?: TimeClockComplianceItem[];
    dedupeKeys?: string[];
    resolutionNote: string;
    resolvedAt?: string;
    actorUserId?: string | null;
  }
) {
  const values: unknown[] = [input.tenantId, input.resolutionNote, input.resolvedAt ?? new Date().toISOString(), input.linkedExceptionRequestId ?? null];
  const where = ["tenant_id = $1", "status = 'open'"];

  if (input.employeeId) {
    values.push(input.employeeId);
    where.push(`employee_id = $${values.length}::uuid`);
  }
  if (input.shiftId) {
    values.push(input.shiftId);
    where.push(`shift_id = $${values.length}::uuid`);
  }
  if (input.sessionId) {
    values.push(input.sessionId);
    where.push(`session_id = $${values.length}::uuid`);
  }
  if (input.shootId) {
    values.push(input.shootId);
    where.push(`shoot_id = $${values.length}::uuid`);
  }
  if (input.itemTypes?.length) {
    values.push(input.itemTypes);
    where.push(`item_type = ANY($${values.length}::time_clock_compliance_item[])`);
  }
  if (input.dedupeKeys?.length) {
    values.push(input.dedupeKeys);
    where.push(`dedupe_key = ANY($${values.length}::text[])`);
  }

  const { rows } = await client.query<TimeClockComplianceFlagRecord>(
    `
      UPDATE time_clock_compliance_flag
      SET
        status = 'resolved',
        resolved_at = $3::timestamptz,
        resolution_note = $2,
        linked_exception_request_id = COALESCE($4::uuid, linked_exception_request_id),
        updated_at = now()
      WHERE ${where.join(" AND ")}
      RETURNING
        id,
        tenant_id,
        employee_id,
        shift_id,
        session_id,
        shoot_id,
        organization_id,
        location_id,
        linked_exception_request_id,
        item_type::text AS item_type,
        severity::text AS severity,
        status::text AS status,
        dedupe_key,
        metadata,
        first_detected_at::text,
        last_detected_at::text,
        resolved_at::text,
        resolution_note,
        created_at::text,
        updated_at::text
    `,
    values
  );

  for (const row of rows) {
    await createAuditLog(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      targetUserId: row.employee_id,
      action: "time_clock.compliance_flag.resolved",
      entityType: "time_clock_compliance_flag",
      entityId: row.id,
      previousValues: {
        status: "open"
      },
      newValues: {
        status: "resolved",
        linked_exception_request_id: row.linked_exception_request_id
      },
      reasonComment: input.resolutionNote,
      metadata: {
        item_type: row.item_type,
        dedupe_key: row.dedupe_key
      }
    });
  }

  return rows;
}

export async function listShiftTimeClockComplianceFlags(
  client: PoolClient,
  input: { tenantId: string; employeeId: string; shiftId: string; shootId?: string | null }
) {
  const { rows } = await client.query<TimeClockComplianceFlagRecord>(
    `
      SELECT
        id,
        tenant_id,
        employee_id,
        shift_id,
        session_id,
        shoot_id,
        organization_id,
        location_id,
        linked_exception_request_id,
        item_type::text AS item_type,
        severity::text AS severity,
        status::text AS status,
        dedupe_key,
        metadata,
        first_detected_at::text,
        last_detected_at::text,
        resolved_at::text,
        resolution_note,
        created_at::text,
        updated_at::text
      FROM time_clock_compliance_flag
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status = 'open'
        AND (
          shift_id = $3
          OR ($4::uuid IS NOT NULL AND shoot_id = $4::uuid)
        )
      ORDER BY
        CASE severity
          WHEN 'high' THEN 0
          ELSE 1
        END,
        last_detected_at DESC,
        created_at DESC
    `,
    [input.tenantId, input.employeeId, input.shiftId, input.shootId ?? null]
  );

  return rows.map((row) => ({
    ...row,
    item_label: ITEM_LABELS[row.item_type],
    message: normalizeMessage(row.item_type, row.metadata)
  }));
}

export async function syncShiftCloseoutComplianceFlags(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    shiftId: string;
    shootId: string | null;
    organizationId: string | null;
    locationId: string | null;
    shootCode?: string | null;
    shootTitle: string;
    reminderThresholdMinutes: number;
    setupPhotoRequired: boolean;
    setupPhotoUploaded: boolean;
    postShootEvaluationRequired: boolean;
    postShootEvaluationSubmitted: boolean;
    mileageReimbursement?: {
      status: string;
      review_reason_code: string | null;
      mileage_eligible: boolean;
      issue_label: string | null;
    } | null;
    actorUserId?: string | null;
    source: "during_shoot_reminder" | "clock_out" | "evaluation_submitted" | "manual_refresh";
    detectedAt?: string;
  }
) {
  const shootLabel = input.shootCode ? `${input.shootCode} | ${input.shootTitle}` : input.shootTitle;

  if (input.setupPhotoRequired && !input.setupPhotoUploaded) {
    await upsertTimeClockComplianceFlag(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      shootId: input.shootId,
      organizationId: input.organizationId,
      locationId: input.locationId,
      itemType: "missing_setup_photo",
      severity: input.source === "clock_out" ? "high" : "warning",
      dedupeKey: buildTimeClockComplianceDedupeKey("missing_setup_photo", [input.shiftId]),
      actorUserId: input.actorUserId ?? null,
      detectedAt: input.detectedAt,
      metadata: {
        source: input.source,
        shoot_label: shootLabel,
        reminder_threshold_minutes: input.reminderThresholdMinutes,
        message:
          input.source === "during_shoot_reminder"
            ? `Setup Photo is still missing ${input.reminderThresholdMinutes} minutes into ${shootLabel}.`
            : `Setup Photo was still missing when ${shootLabel} reached closeout.`
      }
    });
  } else {
    await resolveTimeClockComplianceFlags(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      itemTypes: ["missing_setup_photo"],
      resolutionNote: "Setup Photo requirement satisfied.",
      actorUserId: input.actorUserId ?? null
    });
  }

  if (input.postShootEvaluationRequired && !input.postShootEvaluationSubmitted) {
    await upsertTimeClockComplianceFlag(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      shootId: input.shootId,
      organizationId: input.organizationId,
      locationId: input.locationId,
      itemType: "missing_post_shoot_evaluation",
      severity: "high",
      dedupeKey: buildTimeClockComplianceDedupeKey("missing_post_shoot_evaluation", [input.shiftId]),
      actorUserId: input.actorUserId ?? null,
      detectedAt: input.detectedAt,
      metadata: {
        source: input.source,
        shoot_label: shootLabel,
        message: `Post-Shoot Evaluation is still missing for ${shootLabel}.`
      }
    });
  } else {
    await resolveTimeClockComplianceFlags(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      itemTypes: ["missing_post_shoot_evaluation"],
      resolutionNote: "Post-Shoot Evaluation requirement satisfied.",
      actorUserId: input.actorUserId ?? null
    });
  }

  const mileageBlocked =
    input.mileageReimbursement?.status === "review_required" &&
    input.mileageReimbursement?.review_reason_code === "missing_post_shoot_evaluation";

  if (mileageBlocked) {
    await upsertTimeClockComplianceFlag(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      shootId: input.shootId,
      organizationId: input.organizationId,
      locationId: input.locationId,
      itemType: "mileage_blocked_missing_post_shoot_evaluation",
      severity: "warning",
      dedupeKey: buildTimeClockComplianceDedupeKey("mileage_blocked_missing_post_shoot_evaluation", [input.shiftId]),
      actorUserId: input.actorUserId ?? null,
      detectedAt: input.detectedAt,
      metadata: {
        source: input.source,
        shoot_label: shootLabel,
        mileage_eligible: input.mileageReimbursement?.mileage_eligible ?? false,
        message:
          input.mileageReimbursement?.issue_label ??
          "Mileage is blocked until the Post-Shoot Evaluation is submitted."
      }
    });
  } else {
    await resolveTimeClockComplianceFlags(client, {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      itemTypes: ["mileage_blocked_missing_post_shoot_evaluation"],
      resolutionNote: "Mileage is no longer blocked by a missing Post-Shoot Evaluation.",
      actorUserId: input.actorUserId ?? null
    });
  }
}

export async function flagUploadWhileOffClock(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    shiftId?: string | null;
    sessionId?: string | null;
    shootId?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    category: string;
    targetType: string;
    targetId: string;
    targetLabel: string;
    actorUserId?: string | null;
  }
) {
  return upsertTimeClockComplianceFlag(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    shiftId: input.shiftId ?? null,
    sessionId: input.sessionId ?? null,
    shootId: input.shootId ?? null,
    organizationId: input.organizationId ?? null,
    locationId: input.locationId ?? null,
    itemType: "upload_while_off_clock",
    severity: "warning",
    dedupeKey: buildTimeClockComplianceDedupeKey("upload_while_off_clock", [input.shiftId ?? input.shootId ?? input.targetId, input.employeeId]),
    actorUserId: input.actorUserId ?? null,
    metadata: {
      category: input.category,
      target_type: input.targetType,
      target_id: input.targetId,
      target_label: input.targetLabel,
      message:
        `Upload captured while Off Clock for ${input.targetLabel}. The upload was saved, but the employee should submit a missed clock-in or correction request if this was paid work.`
    }
  });
}

export async function markEndOfDayConfirmationRequired(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    sessionId: string;
    shiftId?: string | null;
    shootId?: string | null;
    organizationId?: string | null;
    locationId?: string | null;
    actorUserId?: string | null;
    detectedAt?: string;
  }
) {
  return upsertTimeClockComplianceFlag(client, {
    tenantId: input.tenantId,
    employeeId: input.employeeId,
    shiftId: input.shiftId ?? null,
    sessionId: input.sessionId,
    shootId: input.shootId ?? null,
    organizationId: input.organizationId ?? null,
    locationId: input.locationId ?? null,
    itemType: "unresolved_end_of_day_confirmation",
    severity: "high",
    dedupeKey: buildTimeClockComplianceDedupeKey("unresolved_end_of_day_confirmation", [input.sessionId]),
    actorUserId: input.actorUserId ?? null,
    detectedAt: input.detectedAt,
    metadata: {
      message: "Needs End-of-Day Confirmation is still unresolved. Confirm whether the employee returned to studio, went Off Clock, or needs a correction."
    }
  });
}

export async function listTimeClockComplianceFlags(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    date?: string;
    status?: TimeClockComplianceStatus | "all";
    userId?: string;
    shootId?: string;
  } = {}
) {
  const values: unknown[] = [auth.tenantId];
  const where = ["flag.tenant_id = $1"];

  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    where.push(`flag.status = $${values.length}::time_clock_compliance_status`);
  }

  if (filters.date) {
    values.push(filters.date);
    where.push(`COALESCE(ws.starts_at::date, flag.first_detected_at::date) = $${values.length}::date`);
  }

  if (filters.userId && !shouldRestrictShiftList(auth)) {
    values.push(filters.userId);
    where.push(`flag.employee_id = $${values.length}::uuid`);
  } else if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`flag.employee_id = $${values.length}::uuid`);
  }

  if (filters.shootId) {
    values.push(filters.shootId);
    where.push(`COALESCE(flag.shoot_id, ws.shoot_id) = $${values.length}::uuid`);
  }

  const { rows } = await client.query<{
    id: string;
    employee_id: string;
    employee_name: string | null;
    shift_id: string | null;
    shift_title: string | null;
    session_id: string | null;
    shoot_id: string | null;
    shoot_code: string | null;
    shoot_title: string | null;
    organization_id: string | null;
    organization_display_name: string | null;
    location_id: string | null;
    location_name: string | null;
    linked_exception_request_id: string | null;
    item_type: TimeClockComplianceItem;
    severity: TimeClockComplianceSeverity;
    status: TimeClockComplianceStatus;
    dedupe_key: string;
    metadata: Record<string, unknown>;
    first_detected_at: string;
    last_detected_at: string;
    resolved_at: string | null;
    resolution_note: string | null;
  }>(
    `
      SELECT
        flag.id,
        flag.employee_id,
        employee.full_name AS employee_name,
        flag.shift_id,
        ws.title AS shift_title,
        flag.session_id,
        flag.shoot_id,
        shoot.shoot_code,
        shoot.title AS shoot_title,
        flag.organization_id,
        org.display_name AS organization_display_name,
        flag.location_id,
        location.name AS location_name,
        flag.linked_exception_request_id,
        flag.item_type::text AS item_type,
        flag.severity::text AS severity,
        flag.status::text AS status,
        flag.dedupe_key,
        flag.metadata,
        flag.first_detected_at::text,
        flag.last_detected_at::text,
        flag.resolved_at::text,
        flag.resolution_note
      FROM time_clock_compliance_flag flag
      JOIN app_user employee
        ON employee.id = flag.employee_id
      LEFT JOIN work_shift ws
        ON ws.id = flag.shift_id
      LEFT JOIN shoot
        ON shoot.id = flag.shoot_id
      LEFT JOIN organization org
        ON org.id = flag.organization_id
      LEFT JOIN shoot_location location
        ON location.id = flag.location_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        CASE flag.severity
          WHEN 'high' THEN 0
          ELSE 1
        END,
        flag.last_detected_at DESC,
        employee.full_name ASC
    `,
    values
  );

  const enriched: TimeClockCompliancePreview[] = rows.map((row) => ({
    ...row,
    item_label: ITEM_LABELS[row.item_type],
    message: normalizeMessage(row.item_type, row.metadata)
  }));

  return {
    summary: {
      open_count: enriched.filter((row) => row.status === "open").length,
      high_severity_count: enriched.filter((row) => row.status === "open" && row.severity === "high").length,
      counts_by_item: countByItem(enriched.filter((row) => row.status === "open"))
    },
    rows: enriched
  };
}
