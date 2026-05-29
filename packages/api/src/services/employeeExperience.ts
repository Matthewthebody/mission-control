import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { getLocalDateString } from "../utils/localDate.js";
import { createAuditLog } from "./audit.js";
import { getShootLocationIntelligence } from "./locations.js";
import { listWorkTasks } from "./jobTruth/index.js";
import { listNotifications } from "./opsNotifications.js";
import { listLocationMemoryNotesForLocation } from "./operationalNotes.js";
import { canViewOperationalApprovals, listOperationalApprovalWorkspace } from "./operationalApprovals.js";
import { getShiftCloseoutCompliance } from "./postShootEvaluations.js";
import { getShootReadyToShootState } from "./readyToShoot.js";
import { getShootResourceLibrary } from "./resourceLibrary.js";
import { listShifts, listTradeCandidates } from "./scheduling.js";
import { listProjectWorkflowCommandCenter } from "./projectTracking/workflowEngine.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type EmployeeEventProjectionSourceRow = {
  id: string;
  assigned_user_id: string;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_id: string | null;
  organization_display_name: string | null;
  location_id: string | null;
  shoot_date: string | null;
  shift_kind: string;
  status: string;
  title: string;
  department: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string;
  ends_at: string;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
  location_name: string | null;
  location_address: string | null;
  navigation_url: string | null;
  estimated_drive_minutes: number | null;
  manager_user_id: string | null;
  manager_name: string | null;
  manager_phone_number: string | null;
  notes: string | null;
  attendance_state: string | null;
  attendance_state_note: string | null;
  segments: Array<Record<string, unknown>>;
  punches: Array<Record<string, unknown>>;
};

/** @deprecated Compatibility alias while My Work event projections are still sourced from work_shift rows. */
type EmployeeShiftRow = EmployeeEventProjectionSourceRow;

type PreServiceHighlight = {
  label: string;
  text: string;
};

type EmployeeWorkflowTone = "good" | "info" | "heads_up" | "action_needed";

type EmployeeMyWorkEventProjection = {
  id: string;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  shoot_date: string | null;
  title: string;
  shift_kind: string;
  status: string;
  department: string;
  staffing_role: string | null;
  satisfies_lead_coverage: boolean;
  starts_at: string;
  ends_at: string;
  location_name: string | null;
  location_address: string | null;
  navigation_url: string | null;
  manager_name: string | null;
  attendance_state: string | null;
  attendance_state_note: string | null;
  latest_punch_direction: string | null;
  latest_punch_at: string | null;
  latest_geofence_status: string | null;
  latest_punch_approval_state: string | null;
  has_pre_service_notes: boolean;
  notes_acknowledged: boolean;
  note_summary: string | null;
  trade_request_count: number;
  open_exception_count: number;
  follow_through_label: string;
  follow_through_tone: EmployeeWorkflowTone;
  closeout_missing_count: number;
  mileage_status: string | null;
  mileage_issue_label: string | null;
};

/** @deprecated Compatibility alias while event schedule projections are still sourced from work_shift. */
type EmployeeMyWorkShiftPreview = EmployeeMyWorkEventProjection;

type EmployeeMyWorkJobRow = {
  id: string;
  job_number: string | null;
  title: string;
  department_type: string;
  job_status: string;
  organization_display_name: string | null;
};

type EmployeeMyWorkWorkflowStepRecord = {
  id: string;
  workflow_run_id: string;
  job_id: string;
  job_number: string | null;
  job_title: string;
  organization_display_name: string | null;
  step_name: string;
  department: string;
  assigned_user_id: string | null;
  assigned_queue: string | null;
  assignment_status: string | null;
  status: string;
  status_label: string;
  operational_status: string;
  next_action: string;
  clear_condition: string;
  due_at: string | null;
  waiting_on_party: string | null;
  waiting_detail: string | null;
  notes: string | null;
  blocked_reason: string | null;
  updated_at: string | null;
  deep_link: string;
};

type EmployeeMyWorkShiftLinkedJobRow = EmployeeMyWorkJobRow & {
  shoot_id: string;
};

type EmployeeMyWorkExceptionRow = {
  id: string;
  shift_id: string | null;
  exception_type: string;
  status: string;
  severity: string;
  reason_code: string | null;
  notes: string | null;
  created_at: string;
  department: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  shift_title: string | null;
};

type EmployeeMyWorkTaskItem = Awaited<ReturnType<typeof listWorkTasks>>["items"][number];
type EmployeeMyWorkApprovalItem = Awaited<ReturnType<typeof listOperationalApprovalWorkspace>>["awaiting_my_decision"][number];

function formatTaskStatusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatJobStatusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDepartmentLabel(value: string | null | undefined) {
  if (!value) {
    return "Operations";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function toToneFromTask(task: EmployeeMyWorkTaskItem): EmployeeWorkflowTone {
  if (task.status === "blocked") {
    return "action_needed";
  }
  if (task.status === "review" || task.status === "waiting") {
    return "heads_up";
  }
  if (task.status === "completed") {
    return "good";
  }
  if (task.due_at && new Date(task.due_at).getTime() <= Date.now()) {
    return "action_needed";
  }
  return "info";
}

function toToneFromException(status: string, severity: string): EmployeeWorkflowTone {
  if (severity === "critical" || status === "open") {
    return "action_needed";
  }
  if (severity === "high" || status === "approved") {
    return "heads_up";
  }
  return "info";
}

function toToneFromApproval(item: EmployeeMyWorkApprovalItem): EmployeeWorkflowTone {
  if (item.overdue || item.blocking) {
    return "action_needed";
  }
  if (item.escalated) {
    return "heads_up";
  }
  return "info";
}

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const next = parseDateOnly(value);
  next.setDate(next.getDate() + days);
  return formatDateOnly(next);
}

function isAttendanceRiskState(value: string | null | undefined) {
  return ["late_warning", "late", "missed_clock_in", "missed_clock_out", "no_show_suspected"].includes(String(value ?? ""));
}

function buildEventProjectionFollowThroughState(
  eventProjection: Pick<EmployeeEventProjectionSourceRow, "starts_at" | "ends_at" | "attendance_state"> & {
    latest_punch_direction?: string | null;
  },
  closeoutCompliance: Awaited<ReturnType<typeof getShiftCloseoutCompliance>> | null
) {
  const now = Date.now();
  const ended = new Date(eventProjection.ends_at).getTime() <= now;
  const missingRequiredItems = closeoutCompliance?.missing_required_items.length ?? 0;
  const mileageStatus = closeoutCompliance?.mileage_reimbursement?.status ?? "not_applicable";
  const mileageIssueLabel = closeoutCompliance?.mileage_reimbursement?.issue_label ?? null;

  if (missingRequiredItems > 0) {
    return {
      label: missingRequiredItems === 1 ? "1 closeout item due" : `${missingRequiredItems} closeout items due`,
      tone: (ended ? "action_needed" : "heads_up") as EmployeeWorkflowTone,
      closeoutMissingCount: missingRequiredItems,
      mileageStatus,
      mileageIssueLabel
    };
  }

  if (mileageStatus === "review_required") {
    return {
      label: mileageIssueLabel ?? "Mileage needs review",
      tone: "heads_up" as EmployeeWorkflowTone,
      closeoutMissingCount: 0,
      mileageStatus,
      mileageIssueLabel
    };
  }

  if (closeoutCompliance?.post_shoot_evaluation_submitted) {
    return {
      label: "Follow-through logged",
      tone: "good" as EmployeeWorkflowTone,
      closeoutMissingCount: 0,
      mileageStatus,
      mileageIssueLabel
    };
  }

  if (eventProjection.latest_punch_direction === "in") {
    return {
      label: "On shift",
      tone: "info" as EmployeeWorkflowTone,
      closeoutMissingCount: 0,
      mileageStatus,
      mileageIssueLabel
    };
  }

  if (isAttendanceRiskState(eventProjection.attendance_state)) {
    return {
      label: "Attendance needs review",
      tone: "action_needed" as EmployeeWorkflowTone,
      closeoutMissingCount: 0,
      mileageStatus,
      mileageIssueLabel
    };
  }

  return {
    label: ended ? "Wrapped" : "Ready for arrival",
    tone: ended ? ("good" as EmployeeWorkflowTone) : ("info" as EmployeeWorkflowTone),
    closeoutMissingCount: 0,
    mileageStatus,
    mileageIssueLabel
  };
}

function buildPreServiceHighlights(
  eventProjection: Pick<EmployeeEventProjectionSourceRow, "notes">,
  intelligence: Awaited<ReturnType<typeof getShootLocationIntelligence>> | null,
  locationMemory: Array<{ body: string }> = []
) {
  const rawHighlights: PreServiceHighlight[] = [];

  if (eventProjection.notes?.trim()) {
    rawHighlights.push({
      label: "Shift Note",
      text: eventProjection.notes.trim()
    });
  }

  if (intelligence?.location?.location_details?.trim()) {
    rawHighlights.push({
      label: "Setup",
      text: intelligence.location.location_details.trim()
    });
  }

  if (intelligence?.location?.commentary?.trim()) {
    rawHighlights.push({
      label: "Watchout",
      text: intelligence.location.commentary.trim()
    });
  }

  for (const note of locationMemory) {
    if (note.body?.trim()) {
      rawHighlights.push({
        label: "Location Memory",
        text: note.body.trim()
      });
    }
  }

  const latestEvaluation = intelligence?.recent_evaluations?.[0] ?? null;
  if (latestEvaluation?.recommendations?.trim()) {
    rawHighlights.push({
      label: "Recent Recommendation",
      text: latestEvaluation.recommendations.trim()
    });
  }

  if (latestEvaluation?.access_details?.trim()) {
    rawHighlights.push({
      label: "Access",
      text: latestEvaluation.access_details.trim()
    });
  }

  if (latestEvaluation?.late_details?.trim()) {
    rawHighlights.push({
      label: "Timing",
      text: latestEvaluation.late_details.trim()
    });
  }

  const unique = new Map<string, PreServiceHighlight>();
  for (const highlight of rawHighlights) {
    const key = `${highlight.label}:${highlight.text.toLowerCase()}`;
    if (!unique.has(key)) {
      unique.set(key, highlight);
    }
  }

  return [...unique.values()].slice(0, 5);
}

function buildNoteSnapshotHash(highlights: PreServiceHighlight[]) {
  if (!highlights.length) {
    return null;
  }
  return createHash("sha256")
    .update(highlights.map((highlight) => `${highlight.label}:${highlight.text}`).join("||"))
    .digest("hex");
}

function buildEmployeeLocationMemorySummary(input: {
  intelligence: Awaited<ReturnType<typeof getShootLocationIntelligence>> | null;
  locationMemory: Awaited<ReturnType<typeof listLocationMemoryNotesForLocation>> | null;
}) {
  const location = input.intelligence?.location ?? null;
  const activeMemory = (input.locationMemory?.notes ?? []).filter((note) => note.publication_state === "active" && !note.archived_at);
  const topWatchOut = activeMemory.find((note) => note.pinned)?.body ?? input.intelligence?.recent_evaluations?.[0]?.top_watch_out ?? location?.commentary ?? null;
  const lastConfirmedCandidates = [
    activeMemory[0]?.promotion_published_at ?? activeMemory[0]?.updated_at ?? activeMemory[0]?.created_at ?? null,
    input.intelligence?.recent_photos?.[0]?.uploaded_at ?? null,
    input.intelligence?.recent_evaluations?.[0]?.reviewed_at ?? input.intelligence?.recent_evaluations?.[0]?.created_at ?? null
  ].filter(Boolean) as string[];
  const lastConfirmedAt = lastConfirmedCandidates.length
    ? [...lastConfirmedCandidates].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
    : null;
  return {
    status:
      !lastConfirmedAt || Date.now() - new Date(lastConfirmedAt).getTime() > 365 * 24 * 60 * 60 * 1000
        ? ("needs_refresh" as const)
        : ("active" as const),
    last_confirmed_at: lastConfirmedAt,
    where_to_go: location?.address ?? location?.name ?? null,
    where_to_park: location?.commentary ?? activeMemory[0]?.body ?? null,
    where_to_set_up: location?.location_details ?? null,
    top_watch_out: topWatchOut,
    setup_photos: (input.intelligence?.recent_photos ?? []).slice(0, 3).map((photo) => ({
      id: photo.id,
      image_url: photo.image_url,
      caption: photo.caption
    }))
  };
}

async function loadOwnEventProjectionRow(
  client: PoolClient,
  auth: AuthUser,
  eventId: string
): Promise<EmployeeEventProjectionSourceRow> {
  const { rows } = await client.query<EmployeeEventProjectionSourceRow>(
    `
      SELECT
        ws.id,
        ws.assigned_user_id,
        ws.shoot_id,
        s.shoot_code,
        s.title AS shoot_title,
        s.organization_id,
        org.display_name AS organization_display_name,
        s.location_id,
        s.shoot_date::text AS shoot_date,
        ws.shift_kind::text,
        ws.status::text,
        ws.title,
        ws.department::text,
        ws.staffing_role::text,
        ws.satisfies_lead_coverage,
        ws.starts_at::text,
        ws.ends_at::text,
        s.arrival_time::text AS arrival_time,
        s.start_time::text AS start_time,
        s.end_time_est::text AS end_time_est,
        ws.location_name,
        ws.location_address,
        ws.navigation_url,
        s.estimated_drive_minutes,
        ws.manager_user_id,
        manager.full_name AS manager_name,
        manager.phone_number AS manager_phone_number,
        ws.notes,
        ws.attendance_state::text,
        ws.attendance_state_note,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', seg.id,
                'segment_kind', seg.segment_kind,
                'label', seg.label,
                'scheduled_start_at', seg.scheduled_start_at,
                'scheduled_end_at', seg.scheduled_end_at,
                'actual_start_at', seg.actual_start_at,
                'actual_end_at', seg.actual_end_at,
                'rate_code', seg.rate_code,
                'hourly_rate_cents', seg.hourly_rate_cents,
                'sort_order', seg.sort_order
              )
              ORDER BY seg.sort_order ASC
            )
            FROM shift_segment seg
            WHERE seg.shift_id = ws.id
          ),
          '[]'::json
        ) AS segments,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'id', punch.id,
                'direction', punch.direction,
                'client_timestamp', punch.client_timestamp,
                'geofence_status', punch.geofence_status,
                'gps_confidence', punch.gps_confidence,
                'approval_state', punch.approval_state,
                'timing_status', punch.timing_status,
                'late_minutes', punch.late_minutes,
                'early_minutes', punch.early_minutes,
                'missed_punch_required', punch.missed_punch_required
              )
              ORDER BY punch.client_timestamp ASC
            )
            FROM shift_punch punch
            WHERE punch.shift_id = ws.id
          ),
          '[]'::json
        ) AS punches
      FROM work_shift ws
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      LEFT JOIN organization org ON org.id = s.organization_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      WHERE ws.id = $1
        AND ws.tenant_id = $2
        AND ws.cancelled_at IS NULL
      LIMIT 1
    `,
    [eventId, auth.tenantId]
  );

  const eventProjection = rows[0];
  if (!eventProjection) {
    throw new ApiError(404, "Event not found");
  }
  if (String(eventProjection.assigned_user_id) !== auth.id) {
    throw new ApiError(403, "Employees can only open their own assigned events from My Work");
  }
  return eventProjection;
}

async function loadTradeRequestsForShift(client: PoolClient, auth: AuthUser, shiftId: string) {
  const { rows } = await client.query(
    `
      SELECT
        trade.id,
        trade.status::text,
        trade.reason,
        trade.created_at,
        trade.updated_at,
        trade.requested_with_user_id,
        requested.full_name AS requested_with_name,
        trade.requester_user_id,
        requester.full_name AS requester_name
      FROM shift_trade_request trade
      JOIN app_user requester ON requester.id = trade.requester_user_id
      LEFT JOIN app_user requested ON requested.id = trade.requested_with_user_id
      WHERE trade.tenant_id = $1
        AND trade.shift_id = $2
        AND (trade.requester_user_id = $3 OR trade.requested_with_user_id = $3)
      ORDER BY trade.created_at DESC
    `,
    [auth.tenantId, shiftId, auth.id]
  );

  return rows.map((row) => ({
    ...row,
    can_cancel: String(row.requester_user_id) === auth.id && ["pending_recipient", "pending_manager"].includes(String(row.status))
  }));
}

async function loadShiftExceptionsForUser(client: PoolClient, auth: AuthUser, shiftId: string) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        exception_type::text,
        status::text,
        reason_code,
        notes,
        created_at,
        approved_at,
        approved_by_user_id
      FROM attendance_exception
      WHERE tenant_id = $1
        AND shift_id = $2
        AND user_id = $3
      ORDER BY created_at DESC
      LIMIT 12
    `,
    [auth.tenantId, shiftId, auth.id]
  );
  return rows;
}

async function loadAcknowledgedHash(
  client: PoolClient,
  input: { tenantId: string; shiftId: string; userId: string; noteHash: string | null }
) {
  if (!input.noteHash) {
    return false;
  }
  const { rows } = await client.query(
    `
      SELECT 1
      FROM shift_note_acknowledgement
      WHERE tenant_id = $1
        AND shift_id = $2
        AND user_id = $3
        AND acknowledgement_scope = 'pre_service_notes'
        AND note_snapshot_hash = $4
      LIMIT 1
    `,
    [input.tenantId, input.shiftId, input.userId, input.noteHash]
  );
  return Boolean(rows[0]);
}

async function buildEventExecutionBundle(
  client: PoolClient,
  auth: AuthUser,
  eventProjection: EmployeeEventProjectionSourceRow
) {
  const intelligence =
    eventProjection.shoot_id || eventProjection.location_name || eventProjection.location_address
      ? await getShootLocationIntelligence(client, auth, {
          shootId: eventProjection.shoot_id,
          shootCode: eventProjection.shoot_code,
          shootLocationName: eventProjection.location_name,
          shootLocationAddress: eventProjection.location_address
        })
      : null;
  const locationMemory =
    intelligence?.matched_location_id != null
      ? await listLocationMemoryNotesForLocation(client, auth, intelligence.matched_location_id, { limit: 3 })
      : null;

  const preServiceHighlights = buildPreServiceHighlights(eventProjection, intelligence, locationMemory?.notes ?? []);
  const noteSnapshotHash = buildNoteSnapshotHash(preServiceHighlights);
  const noteAcknowledged = await loadAcknowledgedHash(client, {
    tenantId: auth.tenantId,
    shiftId: eventProjection.id,
    userId: auth.id,
    noteHash: noteSnapshotHash
  });

  return {
    intelligence,
    locationMemory,
    preServiceHighlights,
    noteSnapshotHash,
    noteAcknowledged
  };
}

async function loadOpenExceptionCounts(client: PoolClient, tenantId: string, userId: string, shiftIds: string[]) {
  if (!shiftIds.length) {
    return new Map<string, number>();
  }

  const { rows } = await client.query<{ shift_id: string; open_count: string }>(
    `
      SELECT
        shift_id::text,
        COUNT(*)::text AS open_count
      FROM attendance_exception
      WHERE tenant_id = $1
        AND user_id = $2
        AND shift_id = ANY($3::uuid[])
        AND status IN ('open', 'approved')
      GROUP BY shift_id
    `,
    [tenantId, userId, shiftIds]
  );

  return new Map(rows.map((row) => [String(row.shift_id), Number(row.open_count ?? 0)]));
}

async function loadLinkedJobsForShoots(client: PoolClient, tenantId: string, shootIds: string[]) {
  if (!shootIds.length) {
    return new Map<string, EmployeeMyWorkJobRow[]>();
  }

  const { rows } = await client.query<EmployeeMyWorkShiftLinkedJobRow>(
    `
      SELECT
        link.shoot_id::text AS shoot_id,
        job.id::text,
        job.job_number,
        job.title,
        job.department_type::text AS department_type,
        job.job_status::text AS job_status,
        org.display_name AS organization_display_name
      FROM job_shoot_links link
      JOIN jobs job
        ON job.tenant_id = link.tenant_id
       AND job.id = link.job_id
      LEFT JOIN organization org
        ON org.id = job.organization_id
      WHERE link.tenant_id = $1
        AND link.shoot_id = ANY($2::uuid[])
      ORDER BY job.created_at DESC
    `,
    [tenantId, shootIds]
  );

  const jobsByShootId = new Map<string, EmployeeMyWorkJobRow[]>();
  for (const row of rows) {
    const current = jobsByShootId.get(row.shoot_id) ?? [];
    current.push({
      id: row.id,
      job_number: row.job_number,
      title: row.title,
      department_type: row.department_type,
      job_status: row.job_status,
      organization_display_name: row.organization_display_name
    });
    jobsByShootId.set(row.shoot_id, current);
  }
  return jobsByShootId;
}

async function loadJobsByIds(client: PoolClient, tenantId: string, jobIds: string[]) {
  if (!jobIds.length) {
    return new Map<string, EmployeeMyWorkJobRow>();
  }

  const { rows } = await client.query<EmployeeMyWorkJobRow>(
    `
      SELECT
        job.id::text,
        job.job_number,
        job.title,
        job.department_type::text AS department_type,
        job.job_status::text AS job_status,
        org.display_name AS organization_display_name
      FROM jobs job
      LEFT JOIN organization org
        ON org.id = job.organization_id
      WHERE job.tenant_id = $1
        AND job.id = ANY($2::uuid[])
    `,
    [tenantId, jobIds]
  );

  return new Map(rows.map((row) => [row.id, row]));
}

async function loadLiveWorkflowAssignments(client: PoolClient, auth: AuthUser): Promise<EmployeeMyWorkWorkflowStepRecord[]> {
  const commandCenter = await listProjectWorkflowCommandCenter(client, auth, { view: "personal", limit: 200 });
  const seenStepIds = new Set<string>();
  return commandCenter.job_rows
    .filter((row) => row.workflow_run_id && row.current_step?.assigned_user_id === auth.id)
    .filter((row) => row.current_step && !["COMPLETE", "SKIPPED"].includes(row.current_step.status))
    .map((row) => {
      const step = row.current_step!;
      return {
        id: step.id,
        workflow_run_id: row.workflow_run_id!,
        job_id: row.job_id,
        job_number: row.job_number,
        job_title: row.job_title,
        organization_display_name: row.organization_name,
        step_name: step.name,
        department: step.department,
        assigned_user_id: step.assigned_user_id,
        assigned_queue: step.assigned_queue,
        assignment_status: step.assignment_status,
        status: step.status,
        status_label: formatTaskStatusLabel(step.status.toLowerCase()),
        operational_status: row.queue_intelligence.operational_status,
        next_action: row.queue_intelligence.next_action,
        clear_condition: row.queue_intelligence.clear_condition,
        due_at: row.next_deadline_at,
        waiting_on_party: row.waiting_on_party,
        waiting_detail: step.waiting_detail,
        notes: step.notes,
        blocked_reason: row.blocked_reason,
        updated_at: step.updated_at,
        deep_link: `#project-tracking/workflows/${row.workflow_run_id}`
      };
    })
    .filter((item) => {
      if (seenStepIds.has(item.id)) {
        return false;
      }
      seenStepIds.add(item.id);
      return true;
    });
}

async function loadEmployeeActiveExceptions(client: PoolClient, auth: AuthUser, shiftIds: string[]) {
  if (!shiftIds.length) {
    return [] as EmployeeMyWorkExceptionRow[];
  }

  const { rows } = await client.query<EmployeeMyWorkExceptionRow>(
    `
      SELECT
        exception.id::text,
        exception.shift_id::text,
        exception.exception_type::text,
        exception.status::text,
        exception.severity::text,
        exception.reason_code,
        exception.notes,
        exception.created_at::text,
        shift.department::text AS department,
        shift.shoot_id::text,
        shoot.shoot_code,
        shoot.title AS shoot_title,
        shift.title AS shift_title
      FROM attendance_exception exception
      LEFT JOIN work_shift shift
        ON shift.tenant_id = exception.tenant_id
       AND shift.id = exception.shift_id
      LEFT JOIN shoot
        ON shoot.id = shift.shoot_id
      WHERE exception.tenant_id = $1
        AND exception.user_id = $2
        AND exception.shift_id = ANY($3::uuid[])
        AND exception.status IN ('open', 'approved')
      ORDER BY exception.created_at DESC
      LIMIT 16
    `,
    [auth.tenantId, auth.id, shiftIds]
  );

  return rows;
}

function buildScheduleContext(events: Array<{ id: string; starts_at: string; ends_at: string }>, anchorDate: string) {
  const now = Date.now();
  const activeNow = events.filter((event) => new Date(event.starts_at).getTime() <= now && new Date(event.ends_at).getTime() > now);
  const nextEvent = events
    .filter((event) => new Date(event.starts_at).getTime() >= now)
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())[0] ?? null;

  return {
    active_now_count: activeNow.length,
    upcoming_today_count: events.filter((event) => getLocalDateString(event.starts_at) === anchorDate).length,
    current_event_id: activeNow[0]?.id ?? null,
    next_event_id: (nextEvent as { id?: string } | null)?.id ?? null
  };
}

function buildRecentChanges(input: {
  notifications: Awaited<ReturnType<typeof listNotifications>>;
  tasks: EmployeeMyWorkTaskItem[];
  exceptions: EmployeeMyWorkExceptionRow[];
  approvals: EmployeeMyWorkApprovalItem[];
}) {
  const changes = [
    ...input.notifications.map((notification) => ({
      id: `notification:${notification.id}`,
      change_type: "notification",
      title: notification.title,
      summary: notification.body,
      created_at: notification.created_at,
      tone:
        notification.priority === "high"
          ? ("action_needed" as EmployeeWorkflowTone)
          : notification.priority === "normal"
            ? ("info" as EmployeeWorkflowTone)
            : ("heads_up" as EmployeeWorkflowTone),
      department: null,
      related_record_type: "notification",
      related_record_id: notification.id
    })),
    ...input.tasks.map((task) => ({
      id: `task:${task.id}`,
      change_type: "task",
      title: task.title,
      summary: `${formatTaskStatusLabel(task.status)}${task.related_job_number ? ` · ${task.related_job_number}` : ""}`,
      created_at: String(task.updated_at),
      tone: toToneFromTask(task),
      department: task.department_type,
      related_record_type: "task",
      related_record_id: task.id
    })),
    ...input.exceptions.map((exception) => ({
      id: `exception:${exception.id}`,
      change_type: "exception",
      title: exception.shift_title ?? exception.shoot_title ?? "Exception",
      summary: `${formatDepartmentLabel(exception.department)} · ${formatTaskStatusLabel(exception.exception_type)}`,
      created_at: exception.created_at,
      tone: toToneFromException(exception.status, exception.severity),
      department: exception.department,
      related_record_type: "exception",
      related_record_id: exception.id
    })),
    ...input.approvals.map((approval) => ({
      id: `approval:${approval.id}`,
      change_type: "approval",
      title: approval.request_title,
      summary: approval.request_summary ?? approval.request_type_label,
      created_at: approval.updated_at,
      tone: toToneFromApproval(approval),
      department: approval.requester_department,
      related_record_type: "approval",
      related_record_id: approval.id
    }))
  ];

  return changes
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 12);
}

export async function listEmployeeMyWork(
  client: PoolClient,
  auth: AuthUser,
  anchorDate = getLocalDateString()
) {
  const windowEndDate = addDays(anchorDate, 7);
  const assignedEventSourceRows = (await listShifts(client, auth, {
    dateFrom: anchorDate,
    dateTo: windowEndDate
  }))
    .filter((eventSourceRow) => String(eventSourceRow.assigned_user_id) === auth.id)
    .filter((eventSourceRow) => ["published", "completed"].includes(String(eventSourceRow.status)));
  const exceptionCounts = await loadOpenExceptionCounts(
    client,
    auth.tenantId,
    auth.id,
    assignedEventSourceRows.map((eventSourceRow) => String(eventSourceRow.id))
  );

  const eventProjections: EmployeeMyWorkEventProjection[] = [];
  for (const eventSourceRow of assignedEventSourceRows) {
    const typedEventSourceRow = eventSourceRow as EmployeeEventProjectionSourceRow;
    const bundle = await buildEventExecutionBundle(client, auth, typedEventSourceRow);
    const tradeRows = await loadTradeRequestsForShift(client, auth, typedEventSourceRow.id);
    const closeoutCompliance = await getShiftCloseoutCompliance(client, {
      tenantId: auth.tenantId,
      shiftId: typedEventSourceRow.id,
      submitterUserId: auth.id
    });
    const followThrough = buildEventProjectionFollowThroughState(
      {
        starts_at: typedEventSourceRow.starts_at,
        ends_at: typedEventSourceRow.ends_at,
        attendance_state: typedEventSourceRow.attendance_state,
        latest_punch_direction: eventSourceRow.latest_punch_direction ?? null
      },
      closeoutCompliance
    );
    const latestPunch =
      Array.isArray(typedEventSourceRow.punches) && typedEventSourceRow.punches.length
        ? (typedEventSourceRow.punches[typedEventSourceRow.punches.length - 1] as Record<string, unknown>)
        : null;
    eventProjections.push({
      id: typedEventSourceRow.id,
      shoot_id: typedEventSourceRow.shoot_id,
      shoot_code: typedEventSourceRow.shoot_code,
      shoot_title: typedEventSourceRow.shoot_title,
      shoot_date: typedEventSourceRow.shoot_date,
      title: typedEventSourceRow.title,
      shift_kind: typedEventSourceRow.shift_kind,
      status: typedEventSourceRow.status,
      department: typedEventSourceRow.department,
      staffing_role: typedEventSourceRow.staffing_role,
      satisfies_lead_coverage: Boolean(typedEventSourceRow.satisfies_lead_coverage),
      starts_at: typedEventSourceRow.starts_at,
      ends_at: typedEventSourceRow.ends_at,
      location_name: typedEventSourceRow.location_name,
      location_address: typedEventSourceRow.location_address,
      navigation_url: typedEventSourceRow.navigation_url,
      manager_name: typedEventSourceRow.manager_name,
      attendance_state: typedEventSourceRow.attendance_state,
      attendance_state_note: typedEventSourceRow.attendance_state_note,
      latest_punch_direction: eventSourceRow.latest_punch_direction ?? null,
      latest_punch_at: eventSourceRow.latest_punch_at ?? null,
      latest_geofence_status: typeof latestPunch?.geofence_status === "string" ? latestPunch.geofence_status : null,
      latest_punch_approval_state: typeof latestPunch?.approval_state === "string" ? latestPunch.approval_state : null,
      has_pre_service_notes: bundle.preServiceHighlights.length > 0,
      notes_acknowledged: bundle.noteAcknowledged,
      note_summary: bundle.preServiceHighlights[0]?.text ?? null,
      trade_request_count: tradeRows.filter((row) => ["pending_recipient", "pending_manager"].includes(String(row.status))).length,
      open_exception_count: exceptionCounts.get(String(typedEventSourceRow.id)) ?? 0,
      follow_through_label: followThrough.label,
      follow_through_tone: followThrough.tone,
      closeout_missing_count: followThrough.closeoutMissingCount,
      mileage_status: followThrough.mileageStatus,
      mileage_issue_label: followThrough.mileageIssueLabel
    });
  }

  const orderedEventProjections = eventProjections.sort(
    (left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
  );
  const eventProjectionIds = orderedEventProjections.map((eventProjection) => eventProjection.id);
  const linkedJobsByShootId = await loadLinkedJobsForShoots(
    client,
    auth.tenantId,
    [...new Set(orderedEventProjections.map((eventProjection) => eventProjection.shoot_id).filter((value): value is string => Boolean(value)))]
  );
  const tasks = (await listWorkTasks(client, auth, { assigned_to_user_id: auth.id, limit: 24 })).items.filter(
    (task) => !["completed", "cancelled"].includes(task.status)
  );
  const liveWorkflowSteps = await loadLiveWorkflowAssignments(client, auth);
  const taskJobIds = tasks
    .map((task) => task.job_id ?? task.related_job_id)
    .filter((value): value is string => Boolean(value));
  const liveWorkflowJobIds = liveWorkflowSteps.map((step) => step.job_id);
  const linkedEventJobIds = [...linkedJobsByShootId.values()].flat().map((job) => job.id);
  const jobRowsById = await loadJobsByIds(client, auth.tenantId, [...new Set([...taskJobIds, ...linkedEventJobIds, ...liveWorkflowJobIds])]);
  const exceptions = await loadEmployeeActiveExceptions(client, auth, eventProjectionIds);
  const approvals = canViewOperationalApprovals(auth)
    ? (await listOperationalApprovalWorkspace(client, auth)).awaiting_my_decision.slice(0, 8)
    : [];
  const notifications =
    auth.permissions.includes("notification.read") || auth.permissions.includes("alerts.read")
      ? await listNotifications(client, auth, { limit: 8 })
      : [];
  const unreadNotifications = notifications.filter((notification) => notification.status === "new" || notification.status === "escalated").length;

  const events = orderedEventProjections.map((eventProjection) => {
    const linkedJob = eventProjection.shoot_id ? linkedJobsByShootId.get(eventProjection.shoot_id)?.[0] ?? null : null;
    const activeNow =
      new Date(eventProjection.starts_at).getTime() <= Date.now() && new Date(eventProjection.ends_at).getTime() > Date.now();
    return {
      id: eventProjection.id,
      event_id: eventProjection.id,
      source: "work_shift",
      source_record_type: "work_shift",
      source_record_id: eventProjection.id,
      shift_id: eventProjection.id,
      linked_job_id: linkedJob?.id ?? null,
      linked_job_number: linkedJob?.job_number ?? null,
      linked_job_title: linkedJob?.title ?? null,
      title: eventProjection.shoot_code ?? eventProjection.title,
      subtitle: eventProjection.shoot_title ?? eventProjection.title,
      department: eventProjection.department,
      staffing_role: eventProjection.staffing_role,
      status: eventProjection.status,
      starts_at: eventProjection.starts_at,
      ends_at: eventProjection.ends_at,
      location_name: eventProjection.location_name,
      location_address: eventProjection.location_address,
      action_label:
        activeNow ? "On now" : new Date(eventProjection.starts_at).getTime() < Date.now() ? "Wrapped" : "Upcoming",
      follow_through_label: eventProjection.follow_through_label,
      note_summary: eventProjection.note_summary,
      open_exception_count: eventProjection.open_exception_count,
      notes_acknowledged: eventProjection.notes_acknowledged
    };
  });

  const acknowledgements = orderedEventProjections
    .filter((eventProjection) => eventProjection.has_pre_service_notes && !eventProjection.notes_acknowledged)
    .map((eventProjection) => {
      const linkedJob = eventProjection.shoot_id ? linkedJobsByShootId.get(eventProjection.shoot_id)?.[0] ?? null : null;
      return {
        id: `shift-note:${eventProjection.id}`,
        acknowledgement_type: "pre_service_notes",
        title: eventProjection.shoot_code ?? eventProjection.title,
        summary: eventProjection.note_summary ?? "Pre-service notes need acknowledgement.",
        department: eventProjection.department,
        due_at: eventProjection.starts_at,
        event_id: eventProjection.id,
        source_record_type: "work_shift",
        source_record_id: eventProjection.id,
        shift_id: eventProjection.id,
        linked_job_id: linkedJob?.id ?? null,
        linked_job_number: linkedJob?.job_number ?? null,
        linked_job_title: linkedJob?.title ?? null,
        action_label: "Acknowledge notes"
      };
    });

  const taskRecords = tasks.map((task) => ({
    id: task.id,
    task_number: task.task_number,
    title: task.title,
    department: task.department_type,
    status: task.status,
    status_label: formatTaskStatusLabel(task.status),
    priority: task.priority,
    due_at: task.due_at ? String(task.due_at) : null,
    blocked_reason: task.blocked_reason,
    job_id: task.job_id ?? task.related_job_id,
    event_id: task.event_id,
    workflow_run_id: task.workflow_run_id,
    linked_job_number: task.related_job_number,
    linked_job_title: task.related_job_title,
    organization_display_name: task.organization_name,
    proof_required: task.proof_required
  }));

  const exceptionRecords = exceptions.map((exception) => {
    const linkedJob = exception.shoot_id ? linkedJobsByShootId.get(exception.shoot_id)?.[0] ?? null : null;
    return {
      id: exception.id,
      exception_type: exception.exception_type,
      exception_type_label: formatTaskStatusLabel(exception.exception_type),
      status: exception.status,
      severity: exception.severity,
      reason_code: exception.reason_code,
      notes: exception.notes,
      created_at: exception.created_at,
      department: exception.department,
      event_id: exception.shift_id,
      source_record_type: exception.shift_id ? "work_shift" : null,
      source_record_id: exception.shift_id,
      shift_id: exception.shift_id,
      linked_job_id: linkedJob?.id ?? null,
      linked_job_number: linkedJob?.job_number ?? null,
      linked_job_title: linkedJob?.title ?? null,
      scope_label: exception.shoot_code ?? exception.shift_title ?? "Assigned work",
      tone: toToneFromException(exception.status, exception.severity)
    };
  });

  const approvalRecords = approvals.map((approval) => ({
    id: approval.id,
    request_type: approval.request_type,
    request_type_label: approval.request_type_label,
    request_title: approval.request_title,
    request_summary: approval.request_summary,
    source_entity_type: approval.source_entity_type,
    source_entity_id: approval.source_entity_id,
    source_entity_label: approval.source_entity_label,
    blocking: approval.blocking,
    severity: approval.severity,
    current_approver_role_group_label: approval.current_approver_role_group_label,
    due_at: approval.sla_due_at,
    overdue: approval.overdue,
    escalated: approval.escalated
  }));

  const jobRollups = new Map<
    string,
    {
      row: EmployeeMyWorkJobRow;
      assigned_task_count: number;
      assigned_event_count: number;
      assigned_workflow_step_count: number;
      open_exception_count: number;
      next_event_at: string | null;
    }
  >();

  for (const task of tasks) {
    const jobId = task.job_id ?? task.related_job_id;
    if (!jobId) {
      continue;
    }
    const job = jobRowsById.get(jobId);
    if (!job) {
      continue;
    }
    const current = jobRollups.get(jobId) ?? {
      row: job,
      assigned_task_count: 0,
      assigned_event_count: 0,
      assigned_workflow_step_count: 0,
      open_exception_count: 0,
      next_event_at: null
    };
    current.assigned_task_count += 1;
    jobRollups.set(jobId, current);
  }

  for (const event of events) {
    if (!event.linked_job_id) {
      continue;
    }
    const job = jobRowsById.get(event.linked_job_id);
    if (!job) {
      continue;
    }
    const current = jobRollups.get(event.linked_job_id) ?? {
      row: job,
      assigned_task_count: 0,
      assigned_event_count: 0,
      assigned_workflow_step_count: 0,
      open_exception_count: 0,
      next_event_at: null
    };
    current.assigned_event_count += 1;
    current.open_exception_count += event.open_exception_count;
    if (!current.next_event_at || new Date(event.starts_at).getTime() < new Date(current.next_event_at).getTime()) {
      current.next_event_at = event.starts_at;
    }
    jobRollups.set(event.linked_job_id, current);
  }

  for (const workflowStep of liveWorkflowSteps) {
    const job = jobRowsById.get(workflowStep.job_id);
    if (!job) {
      continue;
    }
    const current = jobRollups.get(workflowStep.job_id) ?? {
      row: job,
      assigned_task_count: 0,
      assigned_event_count: 0,
      assigned_workflow_step_count: 0,
      open_exception_count: 0,
      next_event_at: null
    };
    current.assigned_workflow_step_count += 1;
    jobRollups.set(workflowStep.job_id, current);
  }

  const jobs = [...jobRollups.values()]
    .map((item) => ({
      id: item.row.id,
      job_number: item.row.job_number,
      title: item.row.title,
      department: item.row.department_type,
      status: item.row.job_status,
      status_label: formatJobStatusLabel(item.row.job_status),
      organization_display_name: item.row.organization_display_name,
      assigned_task_count: item.assigned_task_count,
      assigned_event_count: item.assigned_event_count,
      assigned_workflow_step_count: item.assigned_workflow_step_count,
      open_exception_count: item.open_exception_count,
      next_event_at: item.next_event_at
    }))
    .sort((left, right) => {
      if (left.next_event_at && right.next_event_at) {
        return new Date(left.next_event_at).getTime() - new Date(right.next_event_at).getTime();
      }
      if (left.next_event_at) {
        return -1;
      }
      if (right.next_event_at) {
        return 1;
      }
      return left.title.localeCompare(right.title);
    });

  const recentChanges = buildRecentChanges({
    notifications,
    tasks,
    exceptions,
    approvals
  });

  const now = new Date();
  const eventsToday = orderedEventProjections.filter((eventProjection) => getLocalDateString(eventProjection.starts_at) === anchorDate).length;
  const clockedInEventCount = orderedEventProjections.filter((eventProjection) => eventProjection.latest_punch_direction === "in").length;
  const attentionNeededCount = orderedEventProjections.filter(
    (eventProjection) =>
      isAttendanceRiskState(eventProjection.attendance_state ?? null) ||
      eventProjection.open_exception_count > 0 ||
      eventProjection.closeout_missing_count > 0 ||
      eventProjection.mileage_status === "review_required"
  ).length;
  const closeoutDueCount = orderedEventProjections.filter((eventProjection) => eventProjection.closeout_missing_count > 0).length;
  const lateOrExceptionCount = orderedEventProjections.filter(
    (eventProjection) => isAttendanceRiskState(eventProjection.attendance_state ?? null) || eventProjection.open_exception_count > 0
  ).length;
  const mileageReviewCount = orderedEventProjections.filter((eventProjection) => eventProjection.mileage_status === "review_required").length;
  const nextEventProjection = orderedEventProjections
    .filter((eventProjection) => new Date(eventProjection.starts_at).getTime() >= now.getTime())
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())[0];
  const scheduleContext = buildScheduleContext(events, anchorDate);

  return {
    anchor_date: anchorDate,
    window_end_date: windowEndDate,
    summary: {
      events_today: eventsToday,
      upcoming_events: eventProjections.filter((eventProjection) => new Date(eventProjection.starts_at).getTime() > now.getTime()).length,
      shifts_today: eventsToday,
      upcoming_shifts: eventProjections.filter((eventProjection) => new Date(eventProjection.starts_at).getTime() > now.getTime()).length,
      pending_trade_requests: eventProjections.reduce((total, eventProjection) => total + eventProjection.trade_request_count, 0),
      unread_notifications: unreadNotifications,
      clocked_in_shift_count: clockedInEventCount,
      attention_needed_count: attentionNeededCount,
      closeout_due_count: closeoutDueCount,
      late_or_exception_count: lateOrExceptionCount,
      mileage_review_count: mileageReviewCount,
      assigned_job_count: jobs.length,
      assigned_event_count: events.length,
      assigned_task_count: taskRecords.length,
      live_workflow_step_count: liveWorkflowSteps.length,
      acknowledgement_count: acknowledgements.length,
      owned_exception_count: exceptionRecords.length,
      approval_waiting_count: approvalRecords.length,
      recent_change_count: recentChanges.length,
      next_event_label: nextEventProjection
        ? `${nextEventProjection.shoot_code ?? nextEventProjection.title} at ${new Date(nextEventProjection.starts_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
          })}`
        : null,
      next_shift_label: nextEventProjection
        ? `${nextEventProjection.shoot_code ?? nextEventProjection.title} at ${new Date(nextEventProjection.starts_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
          })}`
        : null
    },
    shifts: orderedEventProjections,
    notifications,
    jobs,
    live_workflow_steps: liveWorkflowSteps,
    events,
    tasks: taskRecords,
    acknowledgements,
    exceptions: exceptionRecords,
    approvals: approvalRecords,
    recent_changes: recentChanges,
    schedule_context: {
      active_now_count: scheduleContext.active_now_count,
      upcoming_today_count: scheduleContext.upcoming_today_count,
      current_event: scheduleContext.current_event_id ? events.find((event) => event.id === scheduleContext.current_event_id) ?? null : null,
      next_event: scheduleContext.next_event_id ? events.find((event) => event.id === scheduleContext.next_event_id) ?? null : null
    }
  };
}

export async function getEmployeeEventDetail(client: PoolClient, auth: AuthUser, eventId: string) {
  const eventProjection = await loadOwnEventProjectionRow(client, auth, eventId);
  const bundle = await buildEventExecutionBundle(client, auth, eventProjection);
  const tradeRequests = await loadTradeRequestsForShift(client, auth, eventId);
  const tradeCandidates = auth.permissions.includes("trade.request") ? await listTradeCandidates(client, auth, eventId) : [];
  const exceptions = await loadShiftExceptionsForUser(client, auth, eventId);
  const resourceLibrary = eventProjection.shoot_id ? await getShootResourceLibrary(client, auth, eventProjection.shoot_id) : null;
  const readyToShoot = eventProjection.shoot_id ? await getShootReadyToShootState(client, auth, eventProjection.shoot_id) : null;
  const closeoutCompliance = await getShiftCloseoutCompliance(client, {
    tenantId: auth.tenantId,
    shiftId: eventId,
    submitterUserId: auth.id
  });

  return {
    event: {
      id: eventProjection.id,
      source: "work_shift",
      source_record_type: "work_shift",
      source_record_id: eventProjection.id,
      linked_record_type: "work_shift",
      shift_id: eventProjection.id,
      title: eventProjection.shoot_code ?? eventProjection.title,
      subtitle: eventProjection.shoot_title ?? eventProjection.title,
      department: eventProjection.department,
      staffing_role: eventProjection.staffing_role,
      status: eventProjection.status,
      starts_at: eventProjection.starts_at,
      ends_at: eventProjection.ends_at,
      location_name: eventProjection.location_name,
      location_address: eventProjection.location_address,
      navigation_url: eventProjection.navigation_url,
      manager_name: eventProjection.manager_name,
      attendance_state: eventProjection.attendance_state,
      attendance_state_note: eventProjection.attendance_state_note
    },
    shift: {
      id: eventProjection.id,
      shoot_id: eventProjection.shoot_id,
      shoot_code: eventProjection.shoot_code,
      shoot_title: eventProjection.shoot_title,
      shoot_date: eventProjection.shoot_date,
      title: eventProjection.title,
      shift_kind: eventProjection.shift_kind,
      status: eventProjection.status,
      department: eventProjection.department,
      staffing_role: eventProjection.staffing_role,
      satisfies_lead_coverage: Boolean(eventProjection.satisfies_lead_coverage),
      starts_at: eventProjection.starts_at,
      ends_at: eventProjection.ends_at,
      arrival_time: eventProjection.arrival_time,
      start_time: eventProjection.start_time,
      end_time_est: eventProjection.end_time_est,
      location_name: eventProjection.location_name,
      location_address: eventProjection.location_address,
      navigation_url: eventProjection.navigation_url,
      estimated_drive_minutes: eventProjection.estimated_drive_minutes,
      attendance_state: eventProjection.attendance_state,
      attendance_state_note: eventProjection.attendance_state_note,
      manager_name: eventProjection.manager_name,
      manager_user_id: eventProjection.manager_user_id,
      manager_phone_number: eventProjection.manager_phone_number,
      segments: eventProjection.segments,
      punches: eventProjection.punches
    },
    linked_records: {
      shoot: eventProjection.shoot_id
        ? {
            id: eventProjection.shoot_id,
            shoot_code: eventProjection.shoot_code,
            title: eventProjection.shoot_title ?? eventProjection.title
          }
        : null,
      organization: eventProjection.organization_id
        ? {
            id: eventProjection.organization_id,
            display_name: eventProjection.organization_display_name ?? "Organization"
          }
        : null,
      location:
        eventProjection.location_id && (eventProjection.location_name || eventProjection.location_address)
          ? {
              id: eventProjection.location_id,
              name: eventProjection.location_name ?? "Location",
              address: eventProjection.location_address
            }
          : null
    },
    primary_contact: eventProjection.manager_name
      ? {
          name: eventProjection.manager_name,
          role_label: "Lead Contact",
          phone_number: eventProjection.manager_phone_number,
          call_href: eventProjection.manager_phone_number ? `tel:${eventProjection.manager_phone_number}` : null,
          text_href: eventProjection.manager_phone_number ? `sms:${eventProjection.manager_phone_number}` : null
        }
      : null,
    site_contact: bundle.intelligence?.location?.custodian_contact
      ? {
          label: "Site Contact",
          value: bundle.intelligence.location.custodian_contact
        }
      : null,
    pre_service_notes: {
      summary_line: bundle.preServiceHighlights[0]?.text ?? "No extra prep notes are attached to this shift.",
      highlights: bundle.preServiceHighlights,
      note_snapshot_hash: bundle.noteSnapshotHash,
      acknowledged: bundle.noteAcknowledged
    },
    location_context: {
      matched_location_id: bundle.intelligence?.matched_location_id ?? null,
      location_name: bundle.intelligence?.location?.name ?? eventProjection.location_name,
      location_address: bundle.intelligence?.location?.address ?? eventProjection.location_address,
      navigation_url: bundle.intelligence?.location?.navigation_url ?? eventProjection.navigation_url,
      estimated_drive_minutes: bundle.intelligence?.location?.estimated_drive_minutes ?? eventProjection.estimated_drive_minutes,
      location_memory_highlights: (bundle.locationMemory?.notes ?? []).slice(0, 3).map((note) => ({
        id: note.id,
        body: note.body,
        pinned: note.pinned
      })),
      recent_photos: (bundle.intelligence?.recent_photos ?? []).slice(0, 3),
      recent_evaluations: (bundle.intelligence?.recent_evaluations ?? []).slice(0, 2),
      location_memory_summary: buildEmployeeLocationMemorySummary({
        intelligence: bundle.intelligence,
        locationMemory: bundle.locationMemory
      })
    },
    actions: {
      can_clock: auth.permissions.includes("time.clock"),
      can_upload_setup_photo: auth.permissions.includes("media.attach") && Boolean(bundle.intelligence?.matched_location_id),
      can_submit_post_shoot_eval: auth.permissions.includes("shoot.read") && Boolean(eventProjection.shoot_id && eventProjection.location_id),
      can_request_trade: auth.permissions.includes("trade.request"),
      can_submit_exception_note: auth.permissions.includes("attendance_exceptions.create"),
      can_submit_missed_punch: auth.permissions.includes("missed_punches.create")
    },
    ready_to_shoot: readyToShoot,
    closeout_compliance: closeoutCompliance,
    resource_library: resourceLibrary,
    trade_candidates: tradeCandidates,
    trade_requests: tradeRequests,
    exceptions
  };
}

/** @deprecated Use getEmployeeEventDetail for event-native My Work detail loading. */
export async function getEmployeeShiftDetail(client: PoolClient, auth: AuthUser, shiftId: string) {
  return getEmployeeEventDetail(client, auth, shiftId);
}

export async function acknowledgeEmployeeEventNotes(
  client: PoolClient,
  auth: AuthUser,
  eventId: string,
  meta: RequestMeta
) {
  const eventProjection = await loadOwnEventProjectionRow(client, auth, eventId);
  const bundle = await buildEventExecutionBundle(client, auth, eventProjection);
  if (!bundle.noteSnapshotHash) {
    throw new ApiError(409, "There are no pre-service notes to acknowledge for this event");
  }

  await client.query(
    `
      INSERT INTO shift_note_acknowledgement (
        tenant_id,
        shift_id,
        user_id,
        acknowledgement_scope,
        note_snapshot_hash,
        source_module,
        acknowledged_at,
        updated_at
      )
      VALUES ($1,$2,$3,'pre_service_notes',$4,'employee_my_work',now(),now())
      ON CONFLICT (tenant_id, shift_id, user_id, acknowledgement_scope, note_snapshot_hash)
      DO UPDATE SET
        acknowledged_at = now(),
        updated_at = now()
    `,
    [auth.tenantId, eventId, auth.id, bundle.noteSnapshotHash]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "employee.shift_notes.acknowledged",
    entityType: "work_shift",
    entityId: eventId,
    metadata: {
      acknowledgement_scope: "pre_service_notes",
      note_snapshot_hash: bundle.noteSnapshotHash,
      event_id: eventId
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return {
    acknowledged: true,
    event_id: eventId,
    shift_id: eventId,
    note_snapshot_hash: bundle.noteSnapshotHash
  };
}

/** @deprecated Use acknowledgeEmployeeEventNotes for event-native My Work acknowledgement flows. */
export async function acknowledgeEmployeeShiftNotes(
  client: PoolClient,
  auth: AuthUser,
  shiftId: string,
  meta: RequestMeta
) {
  return acknowledgeEmployeeEventNotes(client, auth, shiftId, meta);
}
