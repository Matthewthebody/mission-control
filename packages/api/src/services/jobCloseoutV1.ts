import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";

export const JOB_CLOSEOUT_TIMEZONE = config.JOB_CLOSEOUT_TIMEZONE;

export type JobCloseoutOverallStatus = "smooth" | "few_bumps" | "rough";
export type JobCloseoutScheduleStatus = "on_schedule" | "slight_delays" | "major_delays";
export type JobCloseoutIssueStatus = "none" | "minor" | "major";
export type JobCloseoutRetakeRisk = "none" | "possible" | "likely";
export type JobCloseoutClientSentiment = "very_happy" | "fine" | "frustrated";
export type JobCloseoutDataIssue =
  | "missing_subjects"
  | "qr_missing_or_would_not_scan"
  | "qr_sorting_issue"
  | "schedule_or_roster_issue"
  | "other";
export type JobCloseoutSubmitterRole = "senior_photographer" | "shoot_lead" | "associate" | "leadership" | "other";
export type JobCloseoutMileageDisqualification = "company_vehicle" | "carpool" | "did_not_drive" | "other";
export type JobCloseoutReportType = "daily" | "weekly";

export type LateStaffInput = {
  user_id?: string | null;
  display_name: string;
  minutes_late?: number | null;
  reason?: string | null;
};

export type AttachmentInput = {
  attachment_type?: "setup" | "location" | "issue" | "other";
  storage_key?: string | null;
  file_url?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
};

export type SubmitEvaluationInput = {
  submitter_role?: JobCloseoutSubmitterRole | null;
  evaluation_type?: "post_shoot" | "post_production";
  status?: "draft" | "submitted";
  overall_status: JobCloseoutOverallStatus;
  overall_score?: number | null;
  schedule_status?: JobCloseoutScheduleStatus | null;
  schedule_note?: string | null;
  staffing_status?: JobCloseoutIssueStatus | null;
  staffing_note?: string | null;
  all_photographers_on_time?: boolean | null;
  late_note?: string | null;
  image_confidence_score: number;
  technical_issue_status?: JobCloseoutIssueStatus | null;
  technical_issue_note?: string | null;
  retake_risk?: JobCloseoutRetakeRisk | null;
  client_sentiment?: JobCloseoutClientSentiment | null;
  client_issue_flag?: boolean;
  client_issue_note?: string | null;
  data_issue_types?: JobCloseoutDataIssue[];
  data_issue_note?: string | null;
  positive_shoutout_note?: string | null;
  support_needed_note?: string | null;
  next_year_improvement_note?: string | null;
  mileage_qualified?: boolean | null;
  mileage_note?: string | null;
  mileage_disqualification_reason?: JobCloseoutMileageDisqualification | null;
  general_note?: string | null;
  late_staff?: LateStaffInput[];
  attachments?: AttachmentInput[];
};

export type ReportFilters = {
  date?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  photographer_user_id?: string | null;
  account_id?: string | null;
  organization_id?: string | null;
  job_type?: string | null;
  issue_type?: string | null;
  flag_severity?: string | null;
  score?: number | null;
  mileage_status?: string | null;
};

type JobContext = {
  id: string;
  tenant_id: string;
  department_type: string;
  job_category: string;
  job_number: string | null;
  title: string;
  event_name: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  timezone: string;
  organization_id: string | null;
  organization_name: string | null;
  primary_location_id: string | null;
  location_name: string | null;
  legacy_shoot_id: string | null;
  account_owner_user_id: string | null;
  created_by_user_id: string | null;
  is_assigned_to_user: boolean;
  is_lead_for_user: boolean;
};

type EvaluationRow = {
  id: string;
  job_id: string | null;
  shoot_id: string | null;
  organization_id: string | null;
  location_id: string;
  photographer_user_id: string | null;
  photographer_name: string;
  submitted_by_user_id: string | null;
  eval_status: string;
  evaluation_type: string;
  evaluation_version: string;
  submitter_role: string | null;
  submitted_at: string | null;
  created_at: string;
  v1_overall_status: JobCloseoutOverallStatus | null;
  v1_overall_score: number | null;
  image_confidence_score: number | null;
  schedule_status: JobCloseoutScheduleStatus | null;
  staffing_status: JobCloseoutIssueStatus | null;
  technical_issue_status: JobCloseoutIssueStatus | null;
  retake_risk: JobCloseoutRetakeRisk | null;
  client_sentiment: JobCloseoutClientSentiment | null;
  client_issue_flag: boolean;
  data_issue_types: JobCloseoutDataIssue[];
  positive_shoutout_note: string | null;
  support_needed_note: string | null;
  next_year_improvement_note: string | null;
  mileage_qualified: boolean | null;
  mileage_note: string | null;
};

const URGENT_SEVERITY = "critical";
const REVIEW_SEVERITY = "medium";
const INFO_SEVERITY = "info";

export function getJobCloseoutRules() {
  return {
    feature_flag: "JOB_CLOSEOUT_V1_ENABLED",
    enabled: config.JOB_CLOSEOUT_V1_ENABLED,
    timezone: JOB_CLOSEOUT_TIMEZONE,
    check_in_offset_minutes: config.JOB_CLOSEOUT_CHECK_IN_OFFSET_MINUTES,
    missed_check_in_grace_minutes: config.JOB_CLOSEOUT_MISSED_CHECK_IN_GRACE_MINUTES,
    lateness_threshold_minutes: config.JOB_CLOSEOUT_LATENESS_THRESHOLD_MINUTES,
    senior_evaluation_required: config.JOB_CLOSEOUT_REQUIRE_SENIOR_EVALUATION,
    associate_evaluation_required: config.JOB_CLOSEOUT_REQUIRE_ASSOCIATE_EVALUATION,
    daily_report_time: config.JOB_CLOSEOUT_DAILY_REPORT_TIME,
    weekly_report_time: config.JOB_CLOSEOUT_WEEKLY_REPORT_TIME,
    photo_upload_soft_reminder_enabled: config.JOB_CLOSEOUT_PHOTO_SOFT_REMINDER_ENABLED
  };
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isLeadership(auth: Pick<AuthUser, "authorityTier" | "internalRoleGroups">) {
  return hasAuthorityTier(auth as AuthUser, ["super_admin", "leadership", "director_admin"]);
}

function hasPermission(auth: Pick<AuthUser, "permissions">, permission: string) {
  return auth.permissions.includes(permission);
}

function canReadAll(auth: AuthUser) {
  return isLeadership(auth) || hasPermission(auth, "job_closeout.read") || hasPermission(auth, "evaluation.read");
}

function canManageCloseout(auth: AuthUser) {
  return isLeadership(auth) || hasPermission(auth, "job_closeout.manage") || hasPermission(auth, "evaluation.review");
}

function canReadSensitive(auth: AuthUser) {
  return (
    isLeadership(auth) ||
    hasPermission(auth, "job_closeout.reporting.sensitive") ||
    hasPermission(auth, "evaluation.read_sensitive") ||
    hasPermission(auth, "labor_cost.view")
  );
}

function canManageMileage(auth: AuthUser) {
  return isLeadership(auth) || hasPermission(auth, "job_closeout.mileage.manage") || hasPermission(auth, "labor_cost.approve");
}

function canSubmitForJob(auth: AuthUser, job: JobContext) {
  return (
    isLeadership(auth) ||
    hasPermission(auth, "job_closeout.submit") ||
    hasPermission(auth, "evaluation.create") ||
    job.is_assigned_to_user ||
    job.is_lead_for_user ||
    job.account_owner_user_id === auth.id ||
    job.created_by_user_id === auth.id
  );
}

function assertCanReadJob(auth: AuthUser, job: JobContext) {
  if (canReadAll(auth) || canSubmitForJob(auth, job)) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function scoreToLegacyStatus(status: JobCloseoutOverallStatus) {
  if (status === "smooth") {
    return "successful";
  }
  if (status === "few_bumps") {
    return "completed_with_issues";
  }
  return "significant_issue";
}

function statusToOutcome(status: JobCloseoutOverallStatus) {
  if (status === "smooth") {
    return "smooth";
  }
  if (status === "few_bumps") {
    return "minor_issues";
  }
  return "needs_leadership_review";
}

function statusToRating(status: JobCloseoutOverallStatus, score: number | null | undefined) {
  if (score && score >= 1 && score <= 5) {
    return score;
  }
  if (status === "smooth") {
    return 5;
  }
  if (status === "few_bumps") {
    return 3;
  }
  return 2;
}

function deriveSubmitterRole(auth: AuthUser, job: JobContext, requested?: JobCloseoutSubmitterRole | null): JobCloseoutSubmitterRole {
  if (requested) {
    return requested;
  }
  if (isLeadership(auth)) {
    return "leadership";
  }
  if (job.is_lead_for_user) {
    return "shoot_lead";
  }
  if (auth.primaryJobFunctionProfile === "senior_photographer" || auth.jobFunctionProfiles.includes("senior_photographer")) {
    return "senior_photographer";
  }
  if (auth.primaryJobFunctionProfile === "associate_photographer" || auth.jobFunctionProfiles.includes("associate_photographer")) {
    return "associate";
  }
  return "other";
}

function buildIssueSummary(input: SubmitEvaluationInput) {
  const parts = [
    input.schedule_note,
    input.staffing_note,
    input.technical_issue_note,
    input.client_issue_note,
    input.data_issue_note,
    input.support_needed_note,
    input.next_year_improvement_note,
    input.general_note
  ]
    .map(normalizeText)
    .filter(Boolean);
  return parts[0] ?? "Post-shoot closeout captured operational follow-up.";
}

function mapAssignedTeam(category: string, severity: string) {
  if (category === "mileage") {
    return "payroll_admin";
  }
  if (category === "image_quality" || category === "technical" || category === "retake_risk" || category === "data_issue") {
    return "production";
  }
  if (category === "check_in" || category === "lateness" || category === "staffing" || category === "missing_eval") {
    return "field_ops";
  }
  return severity === URGENT_SEVERITY ? "leadership" : "leadership";
}

function severityRank(severity: string) {
  switch (severity) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    default:
      return 1;
  }
}

async function loadJobContext(client: PoolClient, auth: AuthUser, jobId: string) {
  const { rows } = await client.query<JobContext>(
    `
      SELECT
        job.id::text AS id,
        job.tenant_id::text AS tenant_id,
        job.department_type::text AS department_type,
        job.job_category::text AS job_category,
        job.job_number,
        job.title,
        job.event_name,
        job.scheduled_start_at::text AS scheduled_start_at,
        job.scheduled_end_at::text AS scheduled_end_at,
        job.timezone,
        job.organization_id::text AS organization_id,
        org.display_name AS organization_name,
        job.primary_location_id::text AS primary_location_id,
        loc.name AS location_name,
        job.legacy_shoot_id::text AS legacy_shoot_id,
        job.account_owner_user_id::text AS account_owner_user_id,
        job.created_by_user_id::text AS created_by_user_id,
        EXISTS(
          SELECT 1
          FROM job_staff_assignments assignment
          WHERE assignment.tenant_id = job.tenant_id
            AND assignment.job_id = job.id
            AND assignment.user_id = $3
            AND assignment.assignment_status <> 'cancelled'
        ) AS is_assigned_to_user,
        EXISTS(
          SELECT 1
          FROM job_staff_assignments assignment
          WHERE assignment.tenant_id = job.tenant_id
            AND assignment.job_id = job.id
            AND assignment.user_id = $3
            AND assignment.is_lead = true
            AND assignment.assignment_status <> 'cancelled'
        ) AS is_lead_for_user
      FROM jobs job
      LEFT JOIN organization org
        ON org.tenant_id = job.tenant_id
       AND org.id = job.organization_id
      LEFT JOIN shoot_location loc
        ON loc.tenant_id = job.tenant_id
       AND loc.id = job.primary_location_id
      WHERE job.tenant_id = $1
        AND job.id = $2
      LIMIT 1
    `,
    [auth.tenantId, jobId, auth.id]
  );
  const job = rows[0];
  if (!job) {
    throw new ApiError(404, "Job not found");
  }
  return job;
}

async function loadLatestEvaluation(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<EvaluationRow>(
    `
      SELECT
        id::text,
        job_id::text,
        shoot_id::text,
        organization_id::text,
        location_id::text,
        photographer_user_id::text,
        photographer_name,
        submitted_by_user_id::text,
        eval_status::text,
        evaluation_type::text,
        evaluation_version,
        submitter_role::text,
        submitted_at::text,
        created_at::text,
        v1_overall_status::text AS v1_overall_status,
        v1_overall_score,
        image_confidence_score,
        schedule_status::text AS schedule_status,
        staffing_status::text AS staffing_status,
        technical_issue_status::text AS technical_issue_status,
        retake_risk::text AS retake_risk,
        client_sentiment::text AS client_sentiment,
        client_issue_flag,
        data_issue_types::text[] AS data_issue_types,
        positive_shoutout_note,
        support_needed_note,
        next_year_improvement_note,
        mileage_qualified,
        mileage_note
      FROM post_shoot_evaluation
      WHERE tenant_id = $1
        AND job_id = $2
        AND evaluation_type = 'post_shoot'::job_closeout_evaluation_type
      ORDER BY submitted_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [tenantId, jobId]
  );
  return rows[0] ?? null;
}

async function listJobEvaluations(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query<EvaluationRow>(
    `
      SELECT
        id::text,
        job_id::text,
        shoot_id::text,
        organization_id::text,
        location_id::text,
        photographer_user_id::text,
        photographer_name,
        submitted_by_user_id::text,
        eval_status::text,
        evaluation_type::text,
        evaluation_version,
        submitter_role::text,
        submitted_at::text,
        created_at::text,
        v1_overall_status::text AS v1_overall_status,
        v1_overall_score,
        image_confidence_score,
        schedule_status::text AS schedule_status,
        staffing_status::text AS staffing_status,
        technical_issue_status::text AS technical_issue_status,
        retake_risk::text AS retake_risk,
        client_sentiment::text AS client_sentiment,
        client_issue_flag,
        data_issue_types::text[] AS data_issue_types,
        positive_shoutout_note,
        support_needed_note,
        next_year_improvement_note,
        mileage_qualified,
        mileage_note
      FROM post_shoot_evaluation
      WHERE tenant_id = $1
        AND job_id = $2
      ORDER BY submitted_at DESC NULLS LAST, created_at DESC
      LIMIT 25
    `,
    [tenantId, jobId]
  );
  return rows;
}

async function listCheckIns(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query(
    `
      SELECT
        checkin.id::text,
        checkin.job_id::text,
        checkin.job_day_id::text,
        checkin.requested_for_user_id::text,
        user_row.full_name AS requested_for_name,
        checkin.requested_at::text,
        checkin.due_at::text,
        checkin.responded_at::text,
        checkin.status::text,
        checkin.issue_note,
        checkin.created_at::text,
        checkin.updated_at::text
      FROM shoot_check_in_request checkin
      JOIN app_user user_row
        ON user_row.tenant_id = checkin.tenant_id
       AND user_row.id = checkin.requested_for_user_id
      WHERE checkin.tenant_id = $1
        AND checkin.job_id = $2
      ORDER BY checkin.due_at DESC, checkin.created_at DESC
    `,
    [tenantId, jobId]
  );
  return rows;
}

async function listJobCloseoutFlags(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query(
    `
      SELECT
        id::text,
        job_id::text,
        source_entity_type,
        source_entity_id::text,
        severity::text,
        flag_type,
        title,
        description,
        status::text,
        auto_key,
        created_at::text,
        updated_at::text
      FROM job_watch_flags
      WHERE tenant_id = $1
        AND job_id = $2
        AND (
          flag_type LIKE 'job_closeout_%'
          OR source_entity_type IN ('shoot_check_in', 'post_shoot_evaluation', 'missing_evaluation', 'mileage', 'report')
        )
      ORDER BY
        CASE severity::text
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        created_at DESC
    `,
    [tenantId, jobId]
  );
  return rows;
}

async function listEvaluationAttachments(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query(
    `
      SELECT
        id::text,
        evaluation_id::text,
        job_id::text,
        uploaded_by_user_id::text,
        attachment_type::text,
        storage_key,
        file_url,
        filename,
        mime_type,
        size_bytes,
        created_at::text
      FROM post_shoot_evaluation_attachment
      WHERE tenant_id = $1
        AND job_id = $2
      ORDER BY created_at DESC
    `,
    [tenantId, jobId]
  );
  return rows;
}

async function listMileageReviews(client: PoolClient, tenantId: string, jobId: string) {
  const { rows } = await client.query(
    `
      SELECT
        review.id::text,
        review.job_id::text,
        review.account_id::text,
        review.organization_id::text,
        review.user_id::text,
        user_row.full_name AS user_name,
        review.evaluation_id::text,
        review.mileage_qualified,
        review.zone_id::text,
        review.zone_name,
        review.calculated_amount,
        review.status::text,
        review.note,
        review.created_at::text,
        review.updated_at::text,
        review.exported_at::text
      FROM job_closeout_mileage_review review
      JOIN app_user user_row
        ON user_row.tenant_id = review.tenant_id
       AND user_row.id = review.user_id
      WHERE review.tenant_id = $1
        AND review.job_id = $2
      ORDER BY review.created_at DESC
    `,
    [tenantId, jobId]
  );
  return rows;
}

async function loadPriorAccountSignals(client: PoolClient, tenantId: string, job: JobContext) {
  if (!job.organization_id) {
    return [];
  }
  const { rows } = await client.query(
    `
      SELECT
        pse.id::text,
        pse.job_id::text,
        related_job.title AS job_title,
        related_job.scheduled_start_at::text AS scheduled_start_at,
        pse.submitted_at::text,
        pse.v1_overall_status::text AS overall_status,
        pse.image_confidence_score,
        pse.data_issue_types::text[] AS data_issue_types,
        pse.next_year_improvement_note,
        pse.schedule_note,
        pse.staffing_note,
        pse.client_issue_note,
        pse.retake_risk::text AS retake_risk
      FROM post_shoot_evaluation pse
      JOIN jobs related_job
        ON related_job.tenant_id = pse.tenant_id
       AND related_job.id = pse.job_id
      WHERE pse.tenant_id = $1
        AND pse.organization_id = $2
        AND pse.job_id IS NOT NULL
        AND pse.job_id <> $3
        AND pse.eval_status <> 'draft'::post_shoot_eval_status
      ORDER BY pse.submitted_at DESC NULLS LAST, pse.created_at DESC
      LIMIT 8
    `,
    [tenantId, job.organization_id, job.id]
  );
  return rows;
}

export async function getJobCloseoutWorkspace(client: PoolClient, auth: AuthUser, jobId: string) {
  const job = await loadJobContext(client, auth, jobId);
  assertCanReadJob(auth, job);
  const [evaluations, check_ins, flags, attachments, mileage_reviews, prior_signals] = await Promise.all([
    listJobEvaluations(client, auth.tenantId, jobId),
    listCheckIns(client, auth.tenantId, jobId),
    listJobCloseoutFlags(client, auth.tenantId, jobId),
    listEvaluationAttachments(client, auth.tenantId, jobId),
    listMileageReviews(client, auth.tenantId, jobId),
    loadPriorAccountSignals(client, auth.tenantId, job)
  ]);

  const latest = evaluations[0] ?? null;
  return {
    rules: getJobCloseoutRules(),
    permissions: {
      can_submit: canSubmitForJob(auth, job),
      can_manage: canManageCloseout(auth),
      can_view_sensitive: canReadSensitive(auth),
      can_manage_mileage: canManageMileage(auth)
    },
    job,
    check_ins,
    evaluations,
    latest_evaluation: latest,
    mileage_reviews: canManageMileage(auth) || job.is_assigned_to_user ? mileage_reviews : [],
    attachments,
    flags,
    pre_shoot_brief: {
      prior_post_shoot_evaluations: prior_signals,
      prior_next_year_notes: prior_signals
        .map((signal: any) => signal.next_year_improvement_note)
        .filter((value: string | null) => Boolean(value)),
      prior_data_issues: prior_signals.flatMap((signal: any) => signal.data_issue_types ?? []),
      customer_survey_summary: null,
      customer_survey_summary_status: "not_connected"
    }
  };
}

function buildFlagDefinitions(evaluationId: string, job: JobContext, input: SubmitEvaluationInput, lateStaff: LateStaffInput[]) {
  const flags: Array<{
    severity: string;
    category: string;
    title: string;
    message: string;
    nextAction: string;
    sourceType: string;
    sourceId: string;
  }> = [];
  const jobLabel = job.event_name || job.title;
  const add = (severity: string, category: string, title: string, message: string, nextAction: string) => {
    flags.push({
      severity,
      category,
      title,
      message,
      nextAction,
      sourceType: "post_shoot_evaluation",
      sourceId: evaluationId
    });
  };

  if (input.overall_status === "rough") {
    add(URGENT_SEVERITY, "day_status", `Rough day reported for ${jobLabel}`, buildIssueSummary(input), "Leadership review");
  } else if (input.overall_status === "few_bumps") {
    add(REVIEW_SEVERITY, "day_status", `A few bumps reported for ${jobLabel}`, buildIssueSummary(input), "Review closeout notes");
  }
  if (input.image_confidence_score <= 2) {
    add(URGENT_SEVERITY, "image_quality", `Low image confidence for ${jobLabel}`, "Image confidence score was 2 or lower.", "Review image quality risk");
  } else if (input.image_confidence_score === 3) {
    add(REVIEW_SEVERITY, "image_quality", `Image confidence needs review for ${jobLabel}`, "Image confidence score was 3.", "Spot check image quality");
  }
  if (input.client_sentiment === "frustrated") {
    add(URGENT_SEVERITY, "client_experience", `Client frustration reported for ${jobLabel}`, input.client_issue_note ?? "Client sentiment was frustrated.", "Leadership follow-up");
  }
  if (input.technical_issue_status === "major") {
    add(URGENT_SEVERITY, "technical", `Major technical issue for ${jobLabel}`, input.technical_issue_note ?? "Major technical issue was reported.", "Production review");
  } else if (input.technical_issue_status === "minor") {
    add(REVIEW_SEVERITY, "technical", `Minor technical issue for ${jobLabel}`, input.technical_issue_note ?? "Minor technical issue was reported.", "Review technical note");
  }
  if (input.staffing_status === "major") {
    add(URGENT_SEVERITY, "staffing", `Major staffing issue for ${jobLabel}`, input.staffing_note ?? "Major staffing issue was reported.", "Field ops review");
  } else if (input.staffing_status === "minor") {
    add(REVIEW_SEVERITY, "staffing", `Minor staffing issue for ${jobLabel}`, input.staffing_note ?? "Minor staffing issue was reported.", "Review staffing pattern");
  }
  if (input.schedule_status === "slight_delays" || input.schedule_status === "major_delays") {
    add(
      input.schedule_status === "major_delays" ? URGENT_SEVERITY : REVIEW_SEVERITY,
      "schedule",
      `Schedule delay reported for ${jobLabel}`,
      input.schedule_note ?? "Schedule delay was reported.",
      "Review schedule causes"
    );
  }
  for (const late of lateStaff) {
    const minutesLate = late.minutes_late ?? 0;
    add(
      minutesLate > config.JOB_CLOSEOUT_LATENESS_THRESHOLD_MINUTES ? URGENT_SEVERITY : REVIEW_SEVERITY,
      "lateness",
      `${late.display_name} was late for ${jobLabel}`,
      `${late.display_name} was recorded ${minutesLate || "some"} minute(s) late.${late.reason ? ` ${late.reason}` : ""}`,
      minutesLate > config.JOB_CLOSEOUT_LATENESS_THRESHOLD_MINUTES ? "Leadership and field ops review" : "Track lateness signal"
    );
  }
  if (input.retake_risk === "likely") {
    add(URGENT_SEVERITY, "retake_risk", `Likely retake risk for ${jobLabel}`, "Retake risk was marked likely.", "Production and leadership review");
  } else if (input.retake_risk === "possible") {
    add(REVIEW_SEVERITY, "retake_risk", `Possible retake risk for ${jobLabel}`, "Retake risk was marked possible.", "Review for follow-up");
  }
  if (input.data_issue_types?.length) {
    add(
      REVIEW_SEVERITY,
      "data_issue",
      `Data issue reported for ${jobLabel}`,
      input.data_issue_note ?? `Data issues: ${input.data_issue_types.join(", ")}`,
      "Production/graphics review"
    );
  }
  if (normalizeText(input.next_year_improvement_note)) {
    add(REVIEW_SEVERITY, "next_year", `Next-year note captured for ${jobLabel}`, input.next_year_improvement_note!, "Promote into account history");
  }
  if (input.mileage_qualified) {
    add(REVIEW_SEVERITY, "mileage", `Mileage review needed for ${jobLabel}`, "Employee qualified for mileage; office should review the job zone.", "Payroll/admin review");
  }
  if (!input.attachments?.length && config.JOB_CLOSEOUT_PHOTO_SOFT_REMINDER_ENABLED) {
    add(INFO_SEVERITY, "setup_photo", `Setup photo reminder for ${jobLabel}`, "No setup/location photo was attached. This is a soft reminder only.", "Optional photo follow-up");
  }
  return flags;
}

async function upsertJobCloseoutFlag(
  client: PoolClient,
  auth: AuthUser,
  input: {
    job: JobContext;
    sourceType: string;
    sourceId: string;
    category: string;
    severity: string;
    title: string;
    message: string;
    nextAction: string;
  }
) {
  const autoKey = `job-closeout:${input.job.id}:${input.sourceType}:${input.sourceId}:${input.category}`;
  const { rows } = await client.query<{ id: string; severity: string }>(
    `
      SELECT id::text, severity::text
      FROM job_watch_flags
      WHERE tenant_id = $1
        AND job_id = $2
        AND auto_key = $3
        AND status IN ('open'::job_watch_flag_status_type, 'acknowledged'::job_watch_flag_status_type, 'snoozed'::job_watch_flag_status_type)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [auth.tenantId, input.job.id, autoKey]
  );
  const metadata = {
    source: "job_closeout_v1",
    category: input.category,
    next_action: input.nextAction,
    assigned_team: mapAssignedTeam(input.category, input.severity)
  };
  if (rows[0]) {
    const nextSeverity = severityRank(input.severity) > severityRank(rows[0].severity) ? input.severity : rows[0].severity;
    await client.query(
      `
        UPDATE job_watch_flags
        SET severity = $4::job_watch_flag_severity_type,
            title = $5,
            description = $6,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND job_id = $3
      `,
      [auth.tenantId, rows[0].id, input.job.id, nextSeverity, input.title, `${input.message}\n\nNext action: ${input.nextAction}`]
    );
    return rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO job_watch_flags (
        tenant_id,
        job_id,
        source_entity_type,
        source_entity_id,
        severity,
        flag_type,
        title,
        description,
        status,
        created_by_user_id,
        auto_key
      )
      VALUES ($1,$2,$3,$4,$5::job_watch_flag_severity_type,$6,$7,$8,'open'::job_watch_flag_status_type,$9,$10)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      input.job.id,
      input.sourceType,
      input.sourceId,
      input.severity,
      `job_closeout_${input.category}`,
      input.title,
      `${input.message}\n\nNext action: ${input.nextAction}\n\n${JSON.stringify(metadata)}`,
      auth.id,
      autoKey
    ]
  );
  return inserted.rows[0].id;
}

async function createLateStaffEntries(
  client: PoolClient,
  auth: AuthUser,
  input: { evaluationId: string; jobId: string; lateStaff: LateStaffInput[] }
) {
  if (!input.lateStaff.length) {
    return [];
  }
  const inserted = [];
  for (const late of input.lateStaff) {
    const row = await client.query<{ id: string }>(
      `
        INSERT INTO post_shoot_late_staff_entry (
          tenant_id,
          evaluation_id,
          job_id,
          user_id,
          display_name,
          minutes_late,
          reason
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        input.evaluationId,
        input.jobId,
        late.user_id ?? null,
        late.display_name.trim(),
        late.minutes_late ?? null,
        normalizeText(late.reason)
      ]
    );
    inserted.push(row.rows[0].id);
  }
  return inserted;
}

async function createAttachments(
  client: PoolClient,
  auth: AuthUser,
  input: { evaluationId: string; jobId: string; attachments: AttachmentInput[] }
) {
  const valid = input.attachments.filter((attachment) => normalizeText(attachment.storage_key) || normalizeText(attachment.file_url));
  const inserted = [];
  for (const attachment of valid) {
    const row = await client.query<{ id: string }>(
      `
        INSERT INTO post_shoot_evaluation_attachment (
          tenant_id,
          evaluation_id,
          job_id,
          uploaded_by_user_id,
          attachment_type,
          storage_key,
          file_url,
          filename,
          mime_type,
          size_bytes
        )
        VALUES ($1,$2,$3,$4,$5::job_closeout_attachment_type,$6,$7,$8,$9,$10)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        input.evaluationId,
        input.jobId,
        auth.id,
        attachment.attachment_type ?? "setup",
        normalizeText(attachment.storage_key),
        normalizeText(attachment.file_url),
        normalizeText(attachment.filename),
        normalizeText(attachment.mime_type),
        attachment.size_bytes ?? null
      ]
    );
    inserted.push(row.rows[0].id);
  }
  return inserted;
}

async function upsertMileageReview(
  client: PoolClient,
  auth: AuthUser,
  input: { job: JobContext; evaluationId: string; mileageQualified: boolean; note: string | null }
) {
  if (!input.mileageQualified) {
    return null;
  }
  const zone = await client.query<{ id: string; zone_name: string; reimbursement_amount: string }>(
    `
      SELECT id::text, zone_name, reimbursement_amount::text
      FROM mileage_zone
      WHERE tenant_id = $1
        AND active_status = true
      ORDER BY effective_date DESC, min_distance ASC
      LIMIT 1
    `,
    [auth.tenantId]
  );
  const matchedZone = zone.rows[0] ?? null;
  const status = matchedZone ? "pending_review" : "needs_zone_review";
  const result = await client.query<{ id: string; status: string }>(
    `
      INSERT INTO job_closeout_mileage_review (
        tenant_id,
        job_id,
        account_id,
        organization_id,
        user_id,
        evaluation_id,
        mileage_qualified,
        zone_id,
        zone_name,
        calculated_amount,
        status,
        note
      )
      VALUES ($1,$2,$3,$3,$4,$5,true,$6,$7,$8,$9::job_closeout_mileage_status_type,$10)
      ON CONFLICT (tenant_id, evaluation_id, user_id)
      WHERE evaluation_id IS NOT NULL
      DO UPDATE SET
        mileage_qualified = EXCLUDED.mileage_qualified,
        zone_id = EXCLUDED.zone_id,
        zone_name = EXCLUDED.zone_name,
        calculated_amount = EXCLUDED.calculated_amount,
        status = EXCLUDED.status,
        note = EXCLUDED.note,
        updated_at = now()
      RETURNING id::text, status::text
    `,
    [
      auth.tenantId,
      input.job.id,
      input.job.organization_id,
      auth.id,
      input.evaluationId,
      matchedZone?.id ?? null,
      matchedZone?.zone_name ?? null,
      matchedZone?.reimbursement_amount ?? null,
      status,
      input.note
    ]
  );
  return result.rows[0];
}

export async function submitJobCloseoutEvaluation(client: PoolClient, auth: AuthUser, jobId: string, input: SubmitEvaluationInput) {
  const job = await loadJobContext(client, auth, jobId);
  if (!canSubmitForJob(auth, job)) {
    throw new ApiError(403, "Forbidden");
  }
  if (!job.organization_id || !job.primary_location_id) {
    throw new ApiError(409, "Job must be linked to an account and location before closeout.");
  }
  const status = input.status ?? "submitted";
  const submitterRole = deriveSubmitterRole(auth, job, input.submitter_role);
  const shootDate = job.scheduled_start_at ? job.scheduled_start_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const legacyStatus = scoreToLegacyStatus(input.overall_status);
  const overallOutcome = statusToOutcome(input.overall_status);
  const rating = statusToRating(input.overall_status, input.overall_score);
  const summary = normalizeText(input.general_note) ?? buildIssueSummary(input);
  const nextYearNote = normalizeText(input.next_year_improvement_note);
  const mileageQualified = input.mileage_qualified ?? false;
  const persisted = await client.query<{ id: string; submitted_at: string | null }>(
    `
      INSERT INTO post_shoot_evaluation (
        tenant_id,
        job_id,
        organization_id,
        location_id,
        shoot_id,
        shoot_name,
        shoot_date,
        photographer_user_id,
        photographer_name,
        shoot_type,
        on_time,
        easy_access,
        overall_rating,
        photos_uploaded,
        notes,
        outreach_notes,
        recommendations,
        submitted_by_user_id,
        source,
        raw_payload,
        evaluation_year,
        eval_status,
        overall_outcome,
        eval_owner_user_id,
        overall_shoot_status,
        evaluation_type,
        evaluation_version,
        submitter_role,
        v1_overall_status,
        v1_overall_score,
        schedule_status,
        schedule_note,
        staffing_status,
        staffing_note,
        all_photographers_on_time,
        late_note,
        image_confidence_score,
        technical_issue_status,
        technical_issue_note,
        retake_risk,
        client_sentiment,
        client_issue_flag,
        client_issue_note,
        data_issue_types,
        data_issue_note,
        positive_shoutout_note,
        support_needed_note,
        next_year_improvement_note,
        mileage_qualified,
        mileage_note,
        mileage_disqualification_reason,
        submit_for_mileage,
        vehicle_type,
        submitted_at,
        submitter_locked,
        updated_by_user_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'mission_control',$19::jsonb,
        $20,$21::post_shoot_eval_status,$22::post_shoot_eval_outcome,$23,$24::post_shoot_overall_status,
        $25::job_closeout_evaluation_type,$26,$27::job_closeout_submitter_role_type,$28::job_closeout_overall_status_type,$29,
        $30::job_closeout_schedule_status_type,$31,$32::job_closeout_issue_status_type,$33,$34,$35,$36,
        $37::job_closeout_issue_status_type,$38,$39::job_closeout_retake_risk_type,$40::job_closeout_client_sentiment_type,
        $41,$42,$43::job_closeout_data_issue_type[],$44,$45,$46,$47,$48,$49,$50::job_closeout_mileage_disqualification_type,
        $51,$52::mileage_vehicle_type,$53,$54,$55
      )
      RETURNING id::text, submitted_at::text
    `,
    [
      auth.tenantId,
      job.id,
      job.organization_id,
      job.primary_location_id,
      job.legacy_shoot_id,
      job.event_name ?? job.title,
      shootDate,
      auth.id,
      auth.fullName,
      job.job_category,
      input.all_photographers_on_time === false ? "No" : "Yes",
      input.schedule_status === "major_delays" || input.staffing_status === "major" ? "No" : "Yes",
      rating,
      input.attachments?.length ? "Yes" : "No",
      summary,
      normalizeText(input.positive_shoutout_note),
      nextYearNote ?? normalizeText(input.data_issue_note),
      auth.id,
      JSON.stringify({
        form_version: "job_closeout_v1",
        submitter_role: submitterRole,
        status,
        ...input
      }),
      new Date(`${shootDate}T12:00:00Z`).getUTCFullYear(),
      status,
      overallOutcome,
      auth.id,
      legacyStatus,
      input.evaluation_type ?? "post_shoot",
      "v1",
      submitterRole,
      input.overall_status,
      input.overall_score ?? rating,
      input.schedule_status ?? "on_schedule",
      normalizeText(input.schedule_note),
      input.staffing_status ?? "none",
      normalizeText(input.staffing_note),
      input.all_photographers_on_time ?? null,
      normalizeText(input.late_note),
      input.image_confidence_score,
      input.technical_issue_status ?? "none",
      normalizeText(input.technical_issue_note),
      input.retake_risk ?? "none",
      input.client_sentiment ?? "fine",
      Boolean(input.client_issue_flag),
      normalizeText(input.client_issue_note),
      input.data_issue_types ?? [],
      normalizeText(input.data_issue_note),
      normalizeText(input.positive_shoutout_note),
      normalizeText(input.support_needed_note),
      nextYearNote,
      mileageQualified,
      normalizeText(input.mileage_note),
      input.mileage_disqualification_reason ?? null,
      mileageQualified,
      mileageQualified ? "personal_vehicle" : input.mileage_disqualification_reason === "company_vehicle" ? "company_vehicle" : input.mileage_disqualification_reason === "carpool" ? "carpool_passenger" : null,
      status === "submitted" ? new Date().toISOString() : null,
      status === "submitted",
      auth.id
    ]
  );

  const evaluationId = persisted.rows[0].id;
  const lateStaff = input.late_staff ?? [];
  const lateStaffEntryIds = await createLateStaffEntries(client, auth, { evaluationId, jobId: job.id, lateStaff });
  const attachmentIds = await createAttachments(client, auth, {
    evaluationId,
    jobId: job.id,
    attachments: input.attachments ?? []
  });
  const mileageReview = await upsertMileageReview(client, auth, {
    job,
    evaluationId,
    mileageQualified,
    note: normalizeText(input.mileage_note)
  });

  const flags = buildFlagDefinitions(evaluationId, job, input, lateStaff);
  const flagIds = [];
  for (const flag of flags) {
    flagIds.push(await upsertJobCloseoutFlag(client, auth, { job, ...flag }));
  }

  return {
    evaluation: {
      id: evaluationId,
      job_id: job.id,
      submitted_at: persisted.rows[0].submitted_at,
      eval_status: status,
      evaluation_type: input.evaluation_type ?? "post_shoot",
      evaluation_version: "v1",
      submitter_role: submitterRole,
      overall_status: input.overall_status,
      overall_score: input.overall_score ?? rating,
      image_confidence_score: input.image_confidence_score,
      mileage_qualified: mileageQualified
    },
    late_staff_entry_ids: lateStaffEntryIds,
    attachment_ids: attachmentIds,
    mileage_review: mileageReview,
    flag_ids: flagIds
  };
}

export async function createShootCheckInRequests(client: PoolClient, auth: AuthUser, jobId: string) {
  const job = await loadJobContext(client, auth, jobId);
  if (!canManageCloseout(auth) && !canSubmitForJob(auth, job)) {
    throw new ApiError(403, "Forbidden");
  }
  if (!job.scheduled_start_at) {
    throw new ApiError(409, "Job must have a scheduled start before check-in can be requested.");
  }
  const scheduledDueAt = new Date(new Date(job.scheduled_start_at).getTime() + config.JOB_CLOSEOUT_CHECK_IN_OFFSET_MINUTES * 60_000);
  const now = new Date();
  const requestedAt = scheduledDueAt < now ? scheduledDueAt : now;
  const { rows: leads } = await client.query<{ user_id: string; job_day_id: string | null }>(
    `
      SELECT user_id::text, job_day_id::text
      FROM job_staff_assignments
      WHERE tenant_id = $1
        AND job_id = $2
        AND assignment_status <> 'cancelled'
        AND (is_lead = true OR assignment_role IN ('lead', 'senior_photographer', 'shoot_lead'))
      ORDER BY is_lead DESC, created_at ASC
    `,
    [auth.tenantId, job.id]
  );
  const targets = leads.length ? leads : job.is_assigned_to_user ? [{ user_id: auth.id, job_day_id: null }] : [];
  if (!targets.length) {
    throw new ApiError(409, "No shoot lead assignment is available for this check-in.");
  }
  const inserted = [];
  for (const lead of targets) {
    const result = await client.query(
      `
        INSERT INTO shoot_check_in_request (
          tenant_id,
          job_id,
          job_day_id,
          requested_for_user_id,
          requested_at,
          due_at,
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (tenant_id, job_id, requested_for_user_id, due_at)
        DO UPDATE SET updated_at = now()
        RETURNING id::text, requested_for_user_id::text, due_at::text, status::text
      `,
      [auth.tenantId, job.id, lead.job_day_id, lead.user_id, requestedAt.toISOString(), scheduledDueAt.toISOString(), auth.id]
    );
    inserted.push(result.rows[0]);
  }
  return { check_ins: inserted };
}

export async function respondToShootCheckIn(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  checkInId: string,
  input: { status: "good" | "issue"; issue_note?: string | null }
) {
  const job = await loadJobContext(client, auth, jobId);
  assertCanReadJob(auth, job);
  const { rows } = await client.query<{ id: string; requested_for_user_id: string }>(
    `
      SELECT id::text, requested_for_user_id::text
      FROM shoot_check_in_request
      WHERE tenant_id = $1
        AND job_id = $2
        AND id = $3
      LIMIT 1
    `,
    [auth.tenantId, jobId, checkInId]
  );
  const checkIn = rows[0];
  if (!checkIn) {
    throw new ApiError(404, "Check-in not found");
  }
  if (checkIn.requested_for_user_id !== auth.id && !canManageCloseout(auth)) {
    throw new ApiError(403, "Only the requested lead or a manager can respond to this check-in.");
  }
  if (input.status === "issue" && !normalizeText(input.issue_note)) {
    throw new ApiError(400, "Issue check-ins need a short note.");
  }
  const updated = await client.query(
    `
      UPDATE shoot_check_in_request
      SET status = $4::shoot_check_in_status_type,
          issue_note = $5,
          responded_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND job_id = $2
        AND id = $3
      RETURNING id::text, status::text, issue_note, responded_at::text
    `,
    [auth.tenantId, jobId, checkInId, input.status, normalizeText(input.issue_note)]
  );
  if (input.status === "issue") {
    await upsertJobCloseoutFlag(client, auth, {
      job,
      sourceType: "shoot_check_in",
      sourceId: checkInId,
      category: "check_in",
      severity: URGENT_SEVERITY,
      title: `Check-in issue for ${job.event_name ?? job.title}`,
      message: normalizeText(input.issue_note) ?? "Shoot lead reported an issue.",
      nextAction: "Leadership or field ops should reach out while the shoot is in progress."
    });
  }
  return { check_in: updated.rows[0] };
}

export async function markMissedShootCheckIns(client: PoolClient, auth: AuthUser, now = new Date()) {
  if (!canManageCloseout(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const cutoff = new Date(now.getTime() - config.JOB_CLOSEOUT_MISSED_CHECK_IN_GRACE_MINUTES * 60_000);
  const { rows } = await client.query<{ id: string; job_id: string }>(
    `
      UPDATE shoot_check_in_request
      SET status = 'missed'::shoot_check_in_status_type,
          updated_at = now()
      WHERE tenant_id = $1
        AND status = 'pending'::shoot_check_in_status_type
        AND due_at < $2
      RETURNING id::text, job_id::text
    `,
    [auth.tenantId, cutoff.toISOString()]
  );
  const flagIds = [];
  for (const row of rows) {
    const job = await loadJobContext(client, auth, row.job_id);
    flagIds.push(
      await upsertJobCloseoutFlag(client, auth, {
        job,
        sourceType: "shoot_check_in",
        sourceId: row.id,
        category: "check_in",
        severity: URGENT_SEVERITY,
        title: `No check-in from ${job.event_name ?? job.title}`,
        message: `No check-in was received within ${config.JOB_CLOSEOUT_MISSED_CHECK_IN_GRACE_MINUTES} minutes of the due time.`,
        nextAction: "Leadership or field ops should review and reach out if needed."
      })
    );
  }
  return { missed_count: rows.length, flag_ids: flagIds };
}

function parseDateStart(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function defaultReportWindow(type: JobCloseoutReportType, anchorDate?: string | null) {
  const anchor = parseDateStart(anchorDate ?? new Date().toISOString().slice(0, 10));
  if (type === "weekly") {
    const day = anchor.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const startOfThisWeek = addDays(anchor, mondayOffset);
    const periodStart = addDays(startOfThisWeek, -7);
    return { periodStart, periodEnd: startOfThisWeek };
  }
  const periodEnd = anchor;
  return { periodStart: addDays(periodEnd, -1), periodEnd };
}

function buildWhere(filters: ReportFilters, values: unknown[], includeSensitive: boolean) {
  const clauses = [
    "pse.tenant_id = $1",
    "pse.evaluation_type = 'post_shoot'::job_closeout_evaluation_type",
    "pse.eval_status <> 'draft'::post_shoot_eval_status"
  ];
  if (filters.photographer_user_id) {
    values.push(filters.photographer_user_id);
    clauses.push(`pse.photographer_user_id = $${values.length}`);
  }
  if (filters.account_id || filters.organization_id) {
    values.push(filters.account_id ?? filters.organization_id);
    clauses.push(`pse.organization_id = $${values.length}`);
  }
  if (filters.job_type) {
    values.push(filters.job_type);
    clauses.push(`job.job_category::text = $${values.length}`);
  }
  if (filters.issue_type) {
    values.push(filters.issue_type);
    clauses.push(`$${values.length} = ANY(pse.data_issue_types::text[])`);
  }
  if (filters.score) {
    values.push(filters.score);
    clauses.push(`pse.image_confidence_score = $${values.length}`);
  }
  if (filters.mileage_status) {
    values.push(filters.mileage_status);
    clauses.push(`EXISTS (
      SELECT 1
      FROM job_closeout_mileage_review review
      WHERE review.tenant_id = pse.tenant_id
        AND review.evaluation_id = pse.id
        AND review.status::text = $${values.length}
    )`);
  }
  if (!includeSensitive) {
    clauses.push("pse.support_needed_note IS NULL");
  }
  return clauses.join(" AND ");
}

export async function generateOperationsReportSnapshot(
  client: PoolClient,
  auth: AuthUser,
  type: JobCloseoutReportType,
  filters: ReportFilters = {}
) {
  if (!canReadAll(auth) || !hasPermission(auth, "job_closeout.reporting.read") && !isLeadership(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const includeSensitive = canReadSensitive(auth);
  const explicitStart = filters.period_start ? new Date(filters.period_start) : null;
  const explicitEnd = filters.period_end ? new Date(filters.period_end) : null;
  const fallbackWindow = defaultReportWindow(type, filters.date);
  const periodStart = explicitStart ?? fallbackWindow.periodStart;
  const periodEnd = explicitEnd ?? fallbackWindow.periodEnd;
  const values: unknown[] = [auth.tenantId, periodStart.toISOString(), periodEnd.toISOString()];
  const where = `${buildWhere(filters, values, includeSensitive)}
    AND COALESCE(pse.submitted_at, pse.created_at) >= $2::timestamptz
    AND COALESCE(pse.submitted_at, pse.created_at) < $3::timestamptz`;

  const { rows: evaluationRows } = await client.query<any>(
    `
      SELECT
        pse.id::text,
        pse.job_id::text,
        job.title AS job_title,
        job.job_category::text AS job_category,
        org.display_name AS organization_name,
        loc.name AS location_name,
        pse.photographer_user_id::text,
        photographer.full_name AS photographer_name,
        pse.v1_overall_status::text AS overall_status,
        pse.image_confidence_score,
        pse.schedule_status::text AS schedule_status,
        pse.staffing_status::text AS staffing_status,
        pse.technical_issue_status::text AS technical_issue_status,
        pse.retake_risk::text AS retake_risk,
        pse.client_sentiment::text AS client_sentiment,
        pse.client_issue_flag,
        pse.data_issue_types::text[] AS data_issue_types,
        pse.positive_shoutout_note,
        ${includeSensitive ? "pse.support_needed_note" : "NULL::text AS support_needed_note"},
        pse.next_year_improvement_note,
        pse.mileage_qualified
      FROM post_shoot_evaluation pse
      JOIN jobs job
        ON job.tenant_id = pse.tenant_id
       AND job.id = pse.job_id
      LEFT JOIN organization org
        ON org.tenant_id = pse.tenant_id
       AND org.id = pse.organization_id
      LEFT JOIN shoot_location loc
        ON loc.tenant_id = pse.tenant_id
       AND loc.id = pse.location_id
      LEFT JOIN app_user photographer
        ON photographer.tenant_id = pse.tenant_id
       AND photographer.id = pse.photographer_user_id
      WHERE ${where}
      ORDER BY COALESCE(pse.submitted_at, pse.created_at) DESC
      LIMIT 500
    `,
    values
  );

  const { rows: flagRows } = await client.query<any>(
    `
      SELECT
        flag.id::text,
        flag.job_id::text,
        flag.severity::text,
        flag.flag_type,
        flag.title,
        flag.description,
        flag.status::text,
        job.title AS job_title,
        org.display_name AS organization_name
      FROM job_watch_flags flag
      JOIN jobs job
        ON job.tenant_id = flag.tenant_id
       AND job.id = flag.job_id
      LEFT JOIN organization org
        ON org.tenant_id = job.tenant_id
       AND org.id = job.organization_id
      WHERE flag.tenant_id = $1
        AND flag.created_at >= $2::timestamptz
        AND flag.created_at < $3::timestamptz
        AND (
          flag.flag_type LIKE 'job_closeout_%'
          OR flag.source_entity_type IN ('shoot_check_in', 'post_shoot_evaluation', 'missing_evaluation', 'mileage', 'report')
        )
      ORDER BY
        CASE flag.severity::text
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        flag.created_at DESC
      LIMIT 500
    `,
    [auth.tenantId, periodStart.toISOString(), periodEnd.toISOString()]
  );

  const total = evaluationRows.length;
  const smooth = evaluationRows.filter((row) => row.overall_status === "smooth").length;
  const fewBumps = evaluationRows.filter((row) => row.overall_status === "few_bumps").length;
  const rough = evaluationRows.filter((row) => row.overall_status === "rough").length;
  const imageScores = evaluationRows.map((row) => Number(row.image_confidence_score)).filter((value) => Number.isFinite(value));
  const urgentFlags = flagRows.filter((row) => row.severity === "critical" || row.severity === "high");
  const needsReviewFlags = flagRows.filter((row) => row.severity === "medium");
  const mileageQualified = evaluationRows.filter((row) => row.mileage_qualified === true).length;
  const lateStaff = await client.query<any>(
    `
      SELECT
        late.id::text,
        late.display_name,
        late.minutes_late,
        late.reason,
        late.job_id::text,
        job.title AS job_title
      FROM post_shoot_late_staff_entry late
      JOIN jobs job
        ON job.tenant_id = late.tenant_id
       AND job.id = late.job_id
      WHERE late.tenant_id = $1
        AND late.created_at >= $2::timestamptz
        AND late.created_at < $3::timestamptz
      ORDER BY late.created_at DESC
      LIMIT 200
    `,
    [auth.tenantId, periodStart.toISOString(), periodEnd.toISOString()]
  );

  const sourceEvaluationIds = evaluationRows.map((row) => row.id);
  const sourceFlagIds = flagRows.map((row) => row.id);
  const summaryMetrics = {
    report_type: type,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    timezone: JOB_CLOSEOUT_TIMEZONE,
    jobs_completed: total,
    evaluations_submitted: total,
    smooth_count: smooth,
    few_bumps_count: fewBumps,
    rough_count: rough,
    average_image_score: imageScores.length
      ? Number((imageScores.reduce((sum, value) => sum + value, 0) / imageScores.length).toFixed(1))
      : null,
    urgent_flag_count: urgentFlags.length,
    needs_review_flag_count: needsReviewFlags.length,
    mileage_qualified_count: mileageQualified,
    missed_required_evaluation_count: flagRows.filter((row) => row.flag_type === "job_closeout_missing_eval").length,
    on_time_rate: lateStaff.rows.length ? Number((((total - lateStaff.rows.length) / Math.max(total, 1)) * 100).toFixed(1)) : 100
  };
  const issueSummary = {
    urgent_flags: urgentFlags,
    needs_review_flags: needsReviewFlags,
    data_issues: evaluationRows.flatMap((row) => row.data_issue_types ?? []),
    schedule_issues: evaluationRows.filter((row) => row.schedule_status && row.schedule_status !== "on_schedule"),
    staffing_issues: evaluationRows.filter((row) => row.staffing_status && row.staffing_status !== "none"),
    technical_issues: evaluationRows.filter((row) => row.technical_issue_status && row.technical_issue_status !== "none"),
    client_concerns: evaluationRows.filter((row) => row.client_sentiment === "frustrated" || row.client_issue_flag),
    retake_risks: evaluationRows.filter((row) => row.retake_risk && row.retake_risk !== "none")
  };
  const winsSummary = {
    smooth_jobs: evaluationRows.filter((row) => row.overall_status === "smooth"),
    positive_shoutouts: evaluationRows
      .filter((row) => row.positive_shoutout_note)
      .map((row) => ({ job_title: row.job_title, photographer_name: row.photographer_name, note: row.positive_shoutout_note })),
    high_image_scores: evaluationRows.filter((row) => Number(row.image_confidence_score) >= 4)
  };
  const peopleSummary = includeSensitive
    ? {
        late_staff: lateStaff.rows,
        support_needed: evaluationRows
          .filter((row) => row.support_needed_note)
          .map((row) => ({ photographer_name: row.photographer_name, job_title: row.job_title, note: row.support_needed_note })),
        photographer_rollup: Object.values(
          evaluationRows.reduce<Record<string, any>>((accumulator, row) => {
            const key = row.photographer_user_id ?? row.photographer_name ?? "unknown";
            const entry = accumulator[key] ?? {
              photographer_user_id: row.photographer_user_id,
              photographer_name: row.photographer_name,
              evaluations: 0,
              image_score_total: 0,
              shoutouts: 0
            };
            entry.evaluations += 1;
            entry.image_score_total += Number(row.image_confidence_score ?? 0);
            if (row.positive_shoutout_note) {
              entry.shoutouts += 1;
            }
            accumulator[key] = entry;
            return accumulator;
          }, {})
        ).map((entry: any) => ({
          ...entry,
          average_image_score: entry.evaluations ? Number((entry.image_score_total / entry.evaluations).toFixed(1)) : null
        }))
      }
    : { restricted: true };
  const accountSummary = Object.values(
    evaluationRows.reduce<Record<string, any>>((accumulator, row) => {
      const key = row.organization_name ?? "Unknown account";
      const entry = accumulator[key] ?? {
        organization_name: key,
        evaluations: 0,
        rough_count: 0,
        data_issue_count: 0,
        next_year_notes: []
      };
      entry.evaluations += 1;
      if (row.overall_status === "rough") {
        entry.rough_count += 1;
      }
      entry.data_issue_count += (row.data_issue_types ?? []).length;
      if (row.next_year_improvement_note) {
        entry.next_year_notes.push({ job_title: row.job_title, note: row.next_year_improvement_note });
      }
      accumulator[key] = entry;
      return accumulator;
    }, {})
  );
  const nextYearSummary = evaluationRows
    .filter((row) => row.next_year_improvement_note)
    .map((row) => ({
      job_id: row.job_id,
      job_title: row.job_title,
      organization_name: row.organization_name,
      note: row.next_year_improvement_note
    }));

  const snapshot = await client.query<{ id: string }>(
    `
      INSERT INTO operations_report_snapshot (
        tenant_id,
        report_type,
        period_start,
        period_end,
        timezone,
        generated_at,
        generated_by_user_id,
        generated_by,
        filters,
        summary_metrics,
        issue_summary,
        wins_summary,
        people_summary,
        account_summary,
        next_year_summary,
        source_evaluation_ids,
        source_flag_ids
      )
      VALUES ($1,$2::operations_report_type,$3,$4,$5,now(),$6,'user',$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::uuid[],$15::uuid[])
      RETURNING id::text
    `,
    [
      auth.tenantId,
      type,
      periodStart.toISOString(),
      periodEnd.toISOString(),
      JOB_CLOSEOUT_TIMEZONE,
      auth.id,
      JSON.stringify(filters),
      JSON.stringify(summaryMetrics),
      JSON.stringify(issueSummary),
      JSON.stringify(winsSummary),
      JSON.stringify(peopleSummary),
      JSON.stringify(accountSummary),
      JSON.stringify(nextYearSummary),
      sourceEvaluationIds,
      sourceFlagIds
    ]
  );

  return {
    snapshot: {
      id: snapshot.rows[0].id,
      report_type: type,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      timezone: JOB_CLOSEOUT_TIMEZONE,
      summary_metrics: summaryMetrics,
      issue_summary: issueSummary,
      wins_summary: winsSummary,
      people_summary: peopleSummary,
      account_summary: accountSummary,
      next_year_summary: nextYearSummary,
      source_evaluation_ids: sourceEvaluationIds,
      source_flag_ids: sourceFlagIds
    }
  };
}

export async function listOperationsReportSnapshots(
  client: PoolClient,
  auth: AuthUser,
  type: JobCloseoutReportType,
  limit = 10
) {
  if (!canReadAll(auth) || (!hasPermission(auth, "job_closeout.reporting.read") && !isLeadership(auth))) {
    throw new ApiError(403, "Forbidden");
  }
  const { rows } = await client.query(
    `
      SELECT
        id::text,
        report_type::text,
        period_start::text,
        period_end::text,
        timezone,
        generated_at::text,
        generated_by,
        summary_metrics,
        issue_summary,
        wins_summary,
        ${canReadSensitive(auth) ? "people_summary" : "'{\"restricted\": true}'::jsonb AS people_summary"},
        account_summary,
        next_year_summary,
        source_evaluation_ids::text[] AS source_evaluation_ids,
        source_flag_ids::text[] AS source_flag_ids
      FROM operations_report_snapshot
      WHERE tenant_id = $1
        AND report_type = $2::operations_report_type
      ORDER BY generated_at DESC
      LIMIT $3
    `,
    [auth.tenantId, type, limit]
  );
  return { snapshots: rows };
}

export async function listEvaluationSearch(client: PoolClient, auth: AuthUser, filters: ReportFilters = {}) {
  if (!canReadAll(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const values: unknown[] = [auth.tenantId];
  const where = buildWhere(filters, values, canReadSensitive(auth));
  const { rows } = await client.query(
    `
      SELECT
        pse.id::text,
        pse.job_id::text,
        job.title AS job_title,
        job.department_type::text AS department_type,
        job.job_category::text AS job_category,
        org.display_name AS organization_name,
        loc.name AS location_name,
        pse.photographer_user_id::text,
        photographer.full_name AS photographer_name,
        pse.submitter_role::text,
        pse.eval_status::text,
        pse.submitted_at::text,
        pse.v1_overall_status::text AS overall_status,
        pse.image_confidence_score,
        pse.client_sentiment::text AS client_sentiment,
        pse.data_issue_types::text[] AS data_issue_types,
        pse.retake_risk::text AS retake_risk,
        pse.mileage_qualified,
        pse.next_year_improvement_note
      FROM post_shoot_evaluation pse
      JOIN jobs job
        ON job.tenant_id = pse.tenant_id
       AND job.id = pse.job_id
      LEFT JOIN organization org
        ON org.tenant_id = pse.tenant_id
       AND org.id = pse.organization_id
      LEFT JOIN shoot_location loc
        ON loc.tenant_id = pse.tenant_id
       AND loc.id = pse.location_id
      LEFT JOIN app_user photographer
        ON photographer.tenant_id = pse.tenant_id
       AND photographer.id = pse.photographer_user_id
      WHERE ${where}
      ORDER BY pse.submitted_at DESC NULLS LAST, pse.created_at DESC
      LIMIT 200
    `,
    values
  );
  return { evaluations: rows };
}

export async function listMileageReviewQueue(client: PoolClient, auth: AuthUser) {
  if (!canManageMileage(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const { rows } = await client.query(
    `
      SELECT
        review.id::text,
        review.job_id::text,
        job.title AS job_title,
        review.account_id::text,
        org.display_name AS account_name,
        review.user_id::text,
        user_row.full_name AS user_name,
        review.evaluation_id::text,
        review.mileage_qualified,
        review.zone_id::text,
        review.zone_name,
        review.calculated_amount,
        review.status::text,
        review.note,
        review.created_at::text,
        review.updated_at::text,
        review.exported_at::text
      FROM job_closeout_mileage_review review
      JOIN jobs job
        ON job.tenant_id = review.tenant_id
       AND job.id = review.job_id
      JOIN app_user user_row
        ON user_row.tenant_id = review.tenant_id
       AND user_row.id = review.user_id
      LEFT JOIN organization org
        ON org.tenant_id = review.tenant_id
       AND org.id = review.account_id
      WHERE review.tenant_id = $1
        AND review.status IN ('pending_review'::job_closeout_mileage_status_type, 'needs_zone_review'::job_closeout_mileage_status_type)
      ORDER BY
        CASE review.status::text WHEN 'needs_zone_review' THEN 1 ELSE 2 END,
        review.created_at DESC
      LIMIT 200
    `,
    [auth.tenantId]
  );
  return { mileage_reviews: rows };
}
