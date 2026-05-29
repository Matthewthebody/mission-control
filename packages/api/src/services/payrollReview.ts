import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import {
  getPayrollSummary,
  type PayrollSummaryFilters,
  type PayrollSummaryPayload,
  type PayrollSummaryRow
} from "./timeClockPayroll.js";

type PayrollReviewIssueSeverity = "important" | "watch";
type PayrollReviewState = "attention_required" | "ready" | "exported";
type PayrollExportReadiness = "blocked" | "ready" | "exported";

type PayrollReviewIssue = {
  code: string;
  label: string;
  severity: PayrollReviewIssueSeverity;
  blocks_export: boolean;
  message: string;
  resolution_state: "unresolved" | "resolved";
};

type PayrollReviewSummary = {
  employee_count: number;
  ready_count: number;
  blocked_count: number;
  exported_count: number;
  regular_office_drive_hours: number;
  regular_photography_hours: number;
  overtime_hours: number;
  lunch_deduction_hours: number;
  mileage_reimbursement_amount: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  exception_count: number;
  approval_count: number;
};

export type PayrollReviewRow = PayrollSummaryRow & {
  review_state: PayrollReviewState;
  export_readiness: PayrollExportReadiness;
  unresolved_issue_count: number;
  review_issues: PayrollReviewIssue[];
};

export type PayrollReviewPayload = {
  source_of_truth: PayrollSummaryPayload["source_of_truth"];
  pay_period: PayrollSummaryPayload["pay_period"];
  transition: PayrollSummaryPayload["transition"];
  summary: PayrollReviewSummary;
  rows: PayrollReviewRow[];
};

type PayrollReviewSessionSegment = {
  id: string;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  work_state: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  source_type: string;
  review_status: string;
  reporting_flags: string[];
};

type PayrollReviewSessionDetail = {
  id: string;
  session_id: string;
  work_date: string;
  session_status: string;
  source_shift_id: string | null;
  shift_title: string | null;
  shift_starts_at: string | null;
  shift_ends_at: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  location_name: string | null;
  office_drive_minutes: number;
  photography_minutes: number;
  total_worked_minutes: number;
  lunch_deduction_minutes: number;
  payable_minutes: number;
  regular_office_drive_minutes: number;
  regular_photography_minutes: number;
  overtime_minutes: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  reporting_flags: string[];
  segments: PayrollReviewSessionSegment[];
};

type PayrollReviewApprovalRecord = {
  id: string;
  approver_id: string;
  approver_name: string | null;
  approver_role: string;
  decision: string;
  comment: string | null;
  decided_at: string;
};

type PayrollReviewExceptionRequest = {
  id: string;
  request_type: string;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  requested_state: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  note: string;
  reporting_flags: string[];
  work_date: string | null;
  linked_session_id: string | null;
  linked_segment_id: string | null;
  shift_id: string | null;
  shift_title: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  requested_approver_id: string | null;
  requested_approver_name: string | null;
  reviewed_by_id: string | null;
  reviewed_by_name: string | null;
  approval_records: PayrollReviewApprovalRecord[];
};

type PayrollReviewMileageSource = {
  id: string;
  evaluation_id: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_display_name: string | null;
  location_name: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  submit_for_mileage: boolean;
  vehicle_type: string | null;
  eligible_for_selection: boolean;
  review_reason_code: string | null;
  created_at: string;
};

type PayrollReviewMileageReimbursement = {
  id: string;
  work_date: string;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  organization_display_name: string | null;
  location_name: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  vehicle_type: string | null;
  status: string;
  review_reason_code: string | null;
  reporting_flags: string[];
  source_evaluation_count: number;
  created_at: string;
  updated_at: string;
  sources: PayrollReviewMileageSource[];
};

export type PayrollReviewDetailPayload = {
  row: PayrollReviewRow;
  linked_records: {
    sessions: PayrollReviewSessionDetail[];
    exception_requests: PayrollReviewExceptionRequest[];
    mileage_reimbursements: PayrollReviewMileageReimbursement[];
  };
  export_payload_row: PayrollExportRow;
};

export type PayrollExportRow = {
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  pay_period_start: string;
  pay_period_end: string;
  review_state: PayrollReviewState;
  export_readiness: PayrollExportReadiness;
  regular_office_drive_hours: number;
  regular_photography_hours: number;
  overtime_hours: number;
  lunch_deduction_hours: number;
  mileage_reimbursement_amount: number;
  exception_count: number;
  approval_count: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  exception_flags: string[];
  approval_flags: string[];
  notes: string;
};

export type PayrollExportPayload = {
  source_of_truth: PayrollSummaryPayload["source_of_truth"];
  generated_at: string;
  pay_period: PayrollSummaryPayload["pay_period"];
  summary: {
    employee_count: number;
    ready_count: number;
    blocked_count: number;
    exported_count: number;
    total_labor_hours: number;
    total_mileage_reimbursement_amount: number;
  };
  rows: PayrollExportRow[];
};

type SessionContextRow = {
  session_id: string;
  session_status: string;
  source_shift_id: string | null;
  shift_title: string | null;
  shift_starts_at: string | null;
  shift_ends_at: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  location_name: string | null;
};

type SessionSegmentRow = {
  id: string;
  session_id: string;
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  work_state: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  source_type: string;
  review_status: string;
  reporting_flags: string[];
};

type ExceptionRequestRow = {
  id: string;
  request_type: string;
  status: string;
  submitted_at: string;
  reviewed_at: string | null;
  requested_state: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  note: string;
  reporting_flags: string[];
  work_date: string | null;
  linked_session_id: string | null;
  linked_segment_id: string | null;
  shift_id: string | null;
  shift_title: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  requested_approver_id: string | null;
  requested_approver_name: string | null;
  reviewed_by_id: string | null;
  reviewed_by_name: string | null;
};

type ApprovalRecordRow = {
  id: string;
  request_id: string;
  approver_id: string;
  approver_name: string | null;
  approver_role: string;
  decision: string;
  comment: string | null;
  decided_at: string;
};

type MileageReimbursementRow = {
  id: string;
  work_date: string;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  organization_display_name: string | null;
  location_name: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  vehicle_type: string | null;
  status: string;
  review_reason_code: string | null;
  source_evaluation_count: number;
  reporting_flags: string[];
  created_at: string;
  updated_at: string;
};

type MileageSourceRow = {
  id: string;
  reimbursement_id: string;
  evaluation_id: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  organization_display_name: string | null;
  location_name: string | null;
  zone_name: string | null;
  studio_distance_miles: string | null;
  reimbursement_amount: string;
  submit_for_mileage: boolean;
  vehicle_type: string | null;
  eligible_for_selection: boolean;
  review_reason_code: string | null;
  created_at: string;
};

function toHours(minutes: number) {
  return Number((minutes / 60).toFixed(2));
}

function humanizeLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildPayrollReviewIssues(row: PayrollSummaryRow): PayrollReviewIssue[] {
  const issues: PayrollReviewIssue[] = [];
  const pendingLunchChallengeCount =
    typeof row.notes?.pending_lunch_challenge_count === "number" ? row.notes.pending_lunch_challenge_count : 0;
  const reviewRequiredMileageCount =
    typeof row.notes?.review_required_mileage_count === "number" ? row.notes.review_required_mileage_count : 0;

  if (pendingLunchChallengeCount > 0) {
    issues.push({
      code: "pending_no_lunch_challenge",
      label: "Pending No-Lunch Challenge",
      severity: "important",
      blocks_export: true,
      message: `${pendingLunchChallengeCount} no-lunch challenge still needs review before payroll confidence is clean.`,
      resolution_state: "unresolved"
    });
  }

  if (reviewRequiredMileageCount > 0) {
    issues.push({
      code: "review_required_mileage",
      label: "Mileage Review Required",
      severity: "important",
      blocks_export: true,
      message: `${reviewRequiredMileageCount} mileage reimbursement day${reviewRequiredMileageCount === 1 ? "" : "s"} still need review.`,
      resolution_state: "unresolved"
    });
  }

  for (const flag of row.transition_flags ?? []) {
    if (flag === "legacy_time_entry_missing") {
      issues.push({
        code: flag,
        label: "Legacy Time Entry Missing",
        severity: "watch",
        blocks_export: false,
        message: "Canonical payroll has hours for this employee but the legacy time-entry comparison has no matching rows.",
        resolution_state: "unresolved"
      });
    }
    if (flag === "legacy_payable_minutes_mismatch") {
      issues.push({
        code: flag,
        label: "Legacy Payable Minutes Mismatch",
        severity: "watch",
        blocks_export: false,
        message: "Canonical payable minutes do not match the legacy time-entry comparison for this pay period.",
        resolution_state: "unresolved"
      });
    }
    if (flag === "legacy_break_override_mismatch") {
      issues.push({
        code: flag,
        label: "Legacy Break Override Mismatch",
        severity: "watch",
        blocks_export: false,
        message: "Legacy break override history disagrees with the canonical payroll summary notes.",
        resolution_state: "unresolved"
      });
    }
  }

  return issues;
}

function buildPayrollReviewRow(row: PayrollSummaryRow): PayrollReviewRow {
  const reviewIssues = buildPayrollReviewIssues(row);
  const blockingIssues = reviewIssues.filter((issue) => issue.blocks_export && issue.resolution_state === "unresolved");
  const reviewState: PayrollReviewState =
    row.status === "exported" ? "exported" : blockingIssues.length > 0 ? "attention_required" : "ready";
  const exportReadiness: PayrollExportReadiness =
    row.status === "exported" ? "exported" : blockingIssues.length > 0 ? "blocked" : "ready";

  return {
    ...row,
    review_state: reviewState,
    export_readiness: exportReadiness,
    unresolved_issue_count: reviewIssues.filter((issue) => issue.resolution_state === "unresolved").length,
    review_issues: reviewIssues
  };
}

function buildPayrollReviewSummary(reviewRows: PayrollReviewRow[]): PayrollReviewSummary {
  return {
    employee_count: reviewRows.length,
    ready_count: reviewRows.filter((row) => row.export_readiness === "ready").length,
    blocked_count: reviewRows.filter((row) => row.export_readiness === "blocked").length,
    exported_count: reviewRows.filter((row) => row.export_readiness === "exported").length,
    regular_office_drive_hours: toHours(reviewRows.reduce((sum, row) => sum + row.regular_office_drive_minutes, 0)),
    regular_photography_hours: toHours(reviewRows.reduce((sum, row) => sum + row.regular_photography_minutes, 0)),
    overtime_hours: toHours(reviewRows.reduce((sum, row) => sum + row.overtime_minutes, 0)),
    lunch_deduction_hours: toHours(reviewRows.reduce((sum, row) => sum + row.lunch_deduction_minutes, 0)),
    mileage_reimbursement_amount: Number(
      reviewRows.reduce((sum, row) => sum + Number(row.mileage_reimbursement_amount ?? 0), 0).toFixed(2)
    ),
    manual_correction_count: reviewRows.reduce((sum, row) => sum + row.manual_correction_count, 0),
    missed_clock_in_approval_count: reviewRows.reduce((sum, row) => sum + row.missed_clock_in_approval_count, 0),
    exception_count: reviewRows.reduce((sum, row) => sum + row.exception_request_count, 0),
    approval_count: reviewRows.reduce((sum, row) => sum + row.approval_record_count, 0)
  };
}

function buildExportNotes(row: PayrollReviewRow) {
  const notes: string[] = [];
  if (row.review_issues.length) {
    notes.push(...row.review_issues.map((issue) => issue.label));
  }
  if (row.manual_correction_count > 0) {
    notes.push(`${row.manual_correction_count} manual correction${row.manual_correction_count === 1 ? "" : "s"}`);
  }
  if (row.missed_clock_in_approval_count > 0) {
    notes.push(
      `${row.missed_clock_in_approval_count} missed clock-in approval${row.missed_clock_in_approval_count === 1 ? "" : "s"}`
    );
  }
  return notes.join("; ");
}

function buildPayrollExportRow(
  row: PayrollReviewRow,
  payPeriod: PayrollSummaryPayload["pay_period"]
): PayrollExportRow {
  return {
    employee_id: row.employee_id,
    employee_name: row.employee_name ?? null,
    department: row.department ?? null,
    pay_period_start: payPeriod.start,
    pay_period_end: payPeriod.end,
    review_state: row.review_state,
    export_readiness: row.export_readiness,
    regular_office_drive_hours: toHours(row.regular_office_drive_minutes),
    regular_photography_hours: toHours(row.regular_photography_minutes),
    overtime_hours: toHours(row.overtime_minutes),
    lunch_deduction_hours: toHours(row.lunch_deduction_minutes),
    mileage_reimbursement_amount: Number(Number(row.mileage_reimbursement_amount ?? 0).toFixed(2)),
    exception_count: row.exception_request_count,
    approval_count: row.approval_record_count,
    manual_correction_count: row.manual_correction_count,
    missed_clock_in_approval_count: row.missed_clock_in_approval_count,
    exception_flags: row.exception_flags ?? [],
    approval_flags: row.approval_flags ?? [],
    notes: buildExportNotes(row)
  };
}

async function loadSessionContext(
  client: PoolClient,
  tenantId: string,
  sessionIds: string[]
) {
  if (!sessionIds.length) {
    return new Map<string, SessionContextRow>();
  }

  const { rows } = await client.query<SessionContextRow>(
    `
      SELECT
        ts.id AS session_id,
        ts.status::text AS session_status,
        ts.source_shift_id,
        ws.title AS shift_title,
        ws.starts_at::text AS shift_starts_at,
        ws.ends_at::text AS shift_ends_at,
        sh.id AS shoot_id,
        sh.shoot_code,
        sh.title AS shoot_title,
        COALESCE(ws.location_name, sh.location_name) AS location_name
      FROM time_session ts
      LEFT JOIN work_shift ws
        ON ws.id = ts.source_shift_id
      LEFT JOIN shoot sh
        ON sh.id = ws.shoot_id
      WHERE ts.tenant_id = $1
        AND ts.id = ANY($2::uuid[])
    `,
    [tenantId, sessionIds]
  );

  return new Map(rows.map((row) => [row.session_id, row]));
}

async function loadSessionSegments(
  client: PoolClient,
  tenantId: string,
  sessionIds: string[]
) {
  if (!sessionIds.length) {
    return new Map<string, PayrollReviewSessionSegment[]>();
  }

  const { rows } = await client.query<SessionSegmentRow>(
    `
      SELECT
        id,
        session_id,
        linked_shift_id,
        linked_shoot_id,
        linked_location_id,
        work_state::text,
        start_time::text,
        end_time::text,
        duration_minutes,
        source_type::text,
        review_status::text,
        reporting_flags
      FROM time_segment
      WHERE tenant_id = $1
        AND session_id = ANY($2::uuid[])
      ORDER BY start_time ASC, created_at ASC
    `,
    [tenantId, sessionIds]
  );

  const bySession = new Map<string, PayrollReviewSessionSegment[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push({
      id: row.id,
      linked_shift_id: row.linked_shift_id,
      linked_shoot_id: row.linked_shoot_id,
      linked_location_id: row.linked_location_id,
      work_state: row.work_state,
      start_time: row.start_time,
      end_time: row.end_time,
      duration_minutes: row.duration_minutes,
      source_type: row.source_type,
      review_status: row.review_status,
      reporting_flags: row.reporting_flags ?? []
    });
    bySession.set(row.session_id, list);
  }

  return bySession;
}

async function loadExceptionRequestsForEmployeePeriod(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  payPeriodStart: string,
  payPeriodEnd: string
) {
  const { rows } = await client.query<ExceptionRequestRow>(
    `
      SELECT
        er.id,
        er.request_type::text,
        er.status::text,
        er.submitted_at::text,
        er.reviewed_at::text,
        er.requested_state::text,
        er.requested_start_time::text,
        er.requested_end_time::text,
        er.note,
        er.reporting_flags,
        ts.work_date::text,
        er.linked_session_id,
        er.linked_segment_id,
        COALESCE(er.linked_shift_id, ts.source_shift_id) AS shift_id,
        ws.title AS shift_title,
        COALESCE(er.linked_shoot_id, ws.shoot_id) AS shoot_id,
        sh.shoot_code,
        sh.title AS shoot_title,
        er.requested_approver_id,
        approver.full_name AS requested_approver_name,
        er.reviewed_by AS reviewed_by_id,
        reviewer.full_name AS reviewed_by_name
      FROM exception_request er
      LEFT JOIN time_session ts
        ON ts.id = er.linked_session_id
      LEFT JOIN work_shift ws
        ON ws.id = COALESCE(er.linked_shift_id, ts.source_shift_id)
      LEFT JOIN shoot sh
        ON sh.id = COALESCE(er.linked_shoot_id, ws.shoot_id)
      LEFT JOIN app_user approver
        ON approver.id = er.requested_approver_id
      LEFT JOIN app_user reviewer
        ON reviewer.id = er.reviewed_by
      WHERE er.tenant_id = $1
        AND er.employee_id = $2
        AND (
          (ts.work_date >= $3::date AND ts.work_date <= $4::date)
          OR (ts.id IS NULL AND er.submitted_at::date >= $3::date AND er.submitted_at::date <= $4::date)
        )
      ORDER BY COALESCE(ts.work_date, er.submitted_at::date) DESC, er.submitted_at DESC
    `,
    [tenantId, employeeId, payPeriodStart, payPeriodEnd]
  );

  const requestIds = rows.map((row) => row.id);
  const approvalRecordsByRequest = new Map<string, PayrollReviewApprovalRecord[]>();
  if (requestIds.length) {
    const approvals = await client.query<ApprovalRecordRow>(
      `
        SELECT
          ar.id,
          ar.request_id,
          ar.approver_id,
          approver.full_name AS approver_name,
          ar.approver_role,
          ar.decision::text,
          ar.comment,
          ar.decided_at::text
        FROM approval_record ar
        LEFT JOIN app_user approver
          ON approver.id = ar.approver_id
        WHERE ar.tenant_id = $1
          AND ar.request_id = ANY($2::uuid[])
        ORDER BY ar.decided_at DESC, ar.id ASC
      `,
      [tenantId, requestIds]
    );
    for (const approval of approvals.rows) {
      const list = approvalRecordsByRequest.get(approval.request_id) ?? [];
      list.push({
        id: approval.id,
        approver_id: approval.approver_id,
        approver_name: approval.approver_name,
        approver_role: approval.approver_role,
        decision: approval.decision,
        comment: approval.comment,
        decided_at: approval.decided_at
      });
      approvalRecordsByRequest.set(approval.request_id, list);
    }
  }

  return rows.map((row) => ({
    ...row,
    approval_records: approvalRecordsByRequest.get(row.id) ?? []
  }));
}

async function loadMileageReimbursementsForEmployeePeriod(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  payPeriodStart: string,
  payPeriodEnd: string
) {
  const { rows } = await client.query<MileageReimbursementRow>(
    `
      SELECT
        mr.id,
        mr.work_date::text,
        mr.linked_shoot_id,
        sh.shoot_code AS linked_shoot_code,
        sh.title AS linked_shoot_title,
        org.display_name AS organization_display_name,
        COALESCE(loc.name, sh.location_name) AS location_name,
        mr.zone_name,
        mr.studio_distance_miles::text,
        mr.reimbursement_amount::text,
        mr.vehicle_type::text,
        mr.status::text,
        mr.review_reason_code::text,
        mr.source_evaluation_count,
        mr.reporting_flags,
        mr.created_at::text,
        mr.updated_at::text
      FROM mileage_reimbursement mr
      LEFT JOIN shoot sh
        ON sh.id = mr.linked_shoot_id
      LEFT JOIN organization org
        ON org.id = mr.organization_id
      LEFT JOIN shoot_location loc
        ON loc.id = mr.location_id
      WHERE mr.tenant_id = $1
        AND mr.employee_id = $2
        AND mr.work_date >= $3::date
        AND mr.work_date <= $4::date
      ORDER BY mr.work_date DESC, mr.created_at DESC
    `,
    [tenantId, employeeId, payPeriodStart, payPeriodEnd]
  );

  const reimbursementIds = rows.map((row) => row.id);
  const sourceRowsByReimbursement = new Map<string, PayrollReviewMileageSource[]>();
  if (reimbursementIds.length) {
    const sourceRows = await client.query<MileageSourceRow>(
      `
        SELECT
          mrs.id,
          mrs.reimbursement_id,
          mrs.evaluation_id,
          mrs.shift_id,
          mrs.shoot_id,
          sh.shoot_code,
          sh.title AS shoot_title,
          org.display_name AS organization_display_name,
          COALESCE(loc.name, sh.location_name) AS location_name,
          mrs.zone_name,
          mrs.studio_distance_miles::text,
          mrs.reimbursement_amount::text,
          mrs.submit_for_mileage,
          mrs.vehicle_type::text,
          mrs.eligible_for_selection,
          mrs.review_reason_code::text,
          mrs.created_at::text
        FROM mileage_reimbursement_source mrs
        LEFT JOIN shoot sh
          ON sh.id = mrs.shoot_id
        LEFT JOIN organization org
          ON org.id = mrs.organization_id
        LEFT JOIN shoot_location loc
          ON loc.id = mrs.location_id
        WHERE mrs.tenant_id = $1
          AND mrs.reimbursement_id = ANY($2::uuid[])
        ORDER BY mrs.created_at ASC
      `,
      [tenantId, reimbursementIds]
    );
    for (const source of sourceRows.rows) {
      const list = sourceRowsByReimbursement.get(source.reimbursement_id) ?? [];
      list.push({
        id: source.id,
        evaluation_id: source.evaluation_id,
        shift_id: source.shift_id,
        shoot_id: source.shoot_id,
        shoot_code: source.shoot_code,
        shoot_title: source.shoot_title,
        organization_display_name: source.organization_display_name,
        location_name: source.location_name,
        zone_name: source.zone_name,
        studio_distance_miles: source.studio_distance_miles,
        reimbursement_amount: source.reimbursement_amount,
        submit_for_mileage: source.submit_for_mileage,
        vehicle_type: source.vehicle_type,
        eligible_for_selection: source.eligible_for_selection,
        review_reason_code: source.review_reason_code,
        created_at: source.created_at
      });
      sourceRowsByReimbursement.set(source.reimbursement_id, list);
    }
  }

  return rows.map((row) => ({
    ...row,
    sources: sourceRowsByReimbursement.get(row.id) ?? []
  }));
}

function mapSessionsForDetail(
  row: PayrollReviewRow,
  sessionContext: Map<string, SessionContextRow>,
  sessionSegments: Map<string, PayrollReviewSessionSegment[]>
) {
  return row.sessions.map((session) => {
    const context = sessionContext.get(session.session_id);
    return {
      ...session,
      session_status: context?.session_status ?? "unknown",
      source_shift_id: context?.source_shift_id ?? null,
      shift_title: context?.shift_title ?? null,
      shift_starts_at: context?.shift_starts_at ?? null,
      shift_ends_at: context?.shift_ends_at ?? null,
      shoot_id: context?.shoot_id ?? null,
      shoot_code: context?.shoot_code ?? null,
      shoot_title: context?.shoot_title ?? null,
      location_name: context?.location_name ?? null,
      segments: sessionSegments.get(session.session_id) ?? []
    };
  });
}

function escapeCsv(value: string | number | null | string[]) {
  if (Array.isArray(value)) {
    return `"${value.join("; ").replace(/"/g, "\"\"")}"`;
  }
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export async function getPayrollReview(
  client: PoolClient,
  auth: AuthUser,
  filters: PayrollSummaryFilters = {}
): Promise<PayrollReviewPayload> {
  const summaryPayload = await getPayrollSummary(client, auth, filters);
  const reviewRows = summaryPayload.rows.map(buildPayrollReviewRow);

  return {
    source_of_truth: summaryPayload.source_of_truth,
    pay_period: summaryPayload.pay_period,
    transition: summaryPayload.transition,
    summary: buildPayrollReviewSummary(reviewRows),
    rows: reviewRows
  };
}

export async function getPayrollReviewDetail(
  client: PoolClient,
  auth: AuthUser,
  input: PayrollSummaryFilters & { employeeId: string }
): Promise<PayrollReviewDetailPayload> {
  const payload = await getPayrollReview(client, auth, {
    ...input,
    userId: input.employeeId
  });

  const row = payload.rows[0];
  if (!row || row.employee_id !== input.employeeId) {
    throw new ApiError(404, "Payroll review row not found for this employee and pay period.");
  }

  const sessionIds = row.sessions.map((session) => session.session_id);
  const [sessionContext, sessionSegments, exceptionRequests, mileageReimbursements] = await Promise.all([
    loadSessionContext(client, auth.tenantId, sessionIds),
    loadSessionSegments(client, auth.tenantId, sessionIds),
    loadExceptionRequestsForEmployeePeriod(client, auth.tenantId, row.employee_id, payload.pay_period.start, payload.pay_period.end),
    loadMileageReimbursementsForEmployeePeriod(client, auth.tenantId, row.employee_id, payload.pay_period.start, payload.pay_period.end)
  ]);

  return {
    row,
    linked_records: {
      sessions: mapSessionsForDetail(row, sessionContext, sessionSegments),
      exception_requests: exceptionRequests,
      mileage_reimbursements: mileageReimbursements
    },
    export_payload_row: buildPayrollExportRow(row, payload.pay_period)
  };
}

export async function buildPayrollExportPayload(
  client: PoolClient,
  auth: AuthUser,
  filters: PayrollSummaryFilters = {}
): Promise<PayrollExportPayload> {
  const review = await getPayrollReview(client, auth, filters);
  const rows = review.rows.map((row) => buildPayrollExportRow(row, review.pay_period));

  return {
    source_of_truth: review.source_of_truth,
    generated_at: new Date().toISOString(),
    pay_period: review.pay_period,
    summary: {
      employee_count: rows.length,
      ready_count: rows.filter((row) => row.export_readiness === "ready").length,
      blocked_count: rows.filter((row) => row.export_readiness === "blocked").length,
      exported_count: rows.filter((row) => row.export_readiness === "exported").length,
      total_labor_hours: Number(
        rows
          .reduce(
            (sum, row) => sum + row.regular_office_drive_hours + row.regular_photography_hours + row.overtime_hours,
            0
          )
          .toFixed(2)
      ),
      total_mileage_reimbursement_amount: Number(
        rows.reduce((sum, row) => sum + row.mileage_reimbursement_amount, 0).toFixed(2)
      )
    },
    rows
  };
}

export function renderPayrollExportCsv(payload: PayrollExportPayload) {
  const header = [
    "pay_period_start",
    "pay_period_end",
    "employee_id",
    "employee_name",
    "department",
    "review_state",
    "export_readiness",
    "regular_office_drive_hours",
    "regular_photography_hours",
    "overtime_hours",
    "lunch_deduction_hours",
    "mileage_reimbursement_amount",
    "exception_count",
    "approval_count",
    "manual_correction_count",
    "missed_clock_in_approval_count",
    "exception_flags",
    "approval_flags",
    "notes"
  ];

  const lines = [header.join(",")];
  for (const row of payload.rows) {
    lines.push(
      [
        payload.pay_period.start,
        payload.pay_period.end,
        row.employee_id,
        row.employee_name ?? "",
        row.department ?? "",
        row.review_state,
        row.export_readiness,
        row.regular_office_drive_hours,
        row.regular_photography_hours,
        row.overtime_hours,
        row.lunch_deduction_hours,
        row.mileage_reimbursement_amount,
        row.exception_count,
        row.approval_count,
        row.manual_correction_count,
        row.missed_clock_in_approval_count,
        row.exception_flags,
        row.approval_flags,
        row.notes
      ]
        .map((value) => escapeCsv(value as string | number | null | string[]))
        .join(",")
    );
  }

  return lines.join("\n");
}

export function humanizePayrollReviewCode(value: string) {
  return humanizeLabel(value);
}
