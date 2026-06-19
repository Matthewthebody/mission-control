import { Router } from "express";
import { z } from "zod";
import {
  JOB_APPROVAL_STATUSES,
  JOB_ASSIGNMENT_STATUSES,
  JOB_CATEGORIES,
  JOB_DELIVERABLE_STATUSES,
  JOB_DAY_STATUSES,
  JOB_DEPARTMENT_TYPES,
  JOB_HANDOFF_STATUSES,
  JOB_PRIORITY_LEVELS,
  JOB_PRODUCTION_STATUSES,
  JOB_PRODUCTION_ISSUE_STATUSES,
  JOB_QA_REVIEW_STATUSES,
  PRODUCTION_BOARD_FILE_MATCH_STATUSES,
  PRODUCTION_BOARD_HEALTH_STATES,
  PRODUCTION_BOARD_RELEASE_STATUSES,
  PRODUCTION_BOARD_SYNC_STATES,
  PRODUCTION_BOARD_UPLOAD_STATUSES,
  PRODUCTION_BOARD_WORKFLOW_STATUSES,
  JOB_WATCH_FLAG_SEVERITIES,
  JOB_WATCH_FLAG_STATUSES
} from "../domain/jobTruth/index.js";
import { connectGuardedClient, pool } from "../db/pool.js";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  acknowledgeWatchFlag,
  addJobDay,
  addJobDayNote,
  archiveJob,
  assignJobStaff,
  cancelJob,
  checkInJobStaff,
  createDraftJob,
  createWatchlistSavedView,
  createOrUpdateApprovalRequest,
  createOrUpdateDeliverableItem,
  createOrUpdateProductionHandoff,
  createOrUpdateProductionIssue,
  createOrResolveWatchFlag,
  createOrUpdateProductionItem,
  createOrUpdateQaFinding,
  createOrUpdateQaReview,
  deleteWatchlistSavedView,
  getDashboard,
  getProductionReporting,
  getJobDetail,
  getJobStatusCounts,
  listAlertCenter,
  listDashboardWidgetPreferences,
  listJobs,
  listPrepReadinessQueue,
  listProductionBlockedQueue,
  listProductionManagementExceptions,
  listProductionOverdueQueue,
  listProductionUrgentWatch,
  listProductionQueue,
  listWatchFlags,
  listWatchlistSavedViews,
  markLeadReady,
  markAlertDeliveryActed,
  markAlertDeliveryRead,
  postponeJob,
  publishJob,
  resolveWatchFlag,
  saveDashboardWidgetPreferences,
  snoozeWatchFlag,
  dismissWatchFlag,
  escalateWatchFlag,
  updateJobDay,
  updateJobStaffAssignment,
  groupProductionItems,
  updateReadinessItem,
  splitProductionItem,
  updateDraftJob,
  updatePublishedJob,
  updateWatchlistSavedView
} from "../services/jobTruth/index.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();
const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

// Canonical operational events still use legacy "day" field names in storage and route shapes.
// Keep this schema stable for compatibility while new code adopts Event terminology at the type layer.
const daySchema = z
  .object({
    day_label: nullableString(160),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start_time: nullableString(32),
    end_time: nullableString(32),
    timezone: nullableString(120),
    location_id: nullableUuid,
    onsite_contact_id: nullableUuid,
    lead_user_id: nullableUuid,
    day_status: z.enum(JOB_DAY_STATUSES).nullable().optional(),
    weather_sensitive: z.boolean().nullable().optional(),
    indoor_outdoor: nullableString(80),
    access_notes: nullableString(2000),
    parking_notes: nullableString(2000),
    setup_notes: nullableString(2000),
    travel_notes: nullableString(2000)
  })
  .strict();

const schoolProfileSchema = z
  .object({
    district_id: nullableUuid,
    school_type: nullableString(120),
    school_year: nullableString(120),
    grade_scope: nullableString(240),
    roster_source: nullableString(120),
    id_cards_required: z.boolean().nullable().optional(),
    yearbook_required: z.boolean().nullable().optional(),
    composite_required: z.boolean().nullable().optional(),
    admin_portal_required: z.boolean().nullable().optional(),
    submission_deadline: nullableString(64),
    advisor_sorting_required: z.boolean().nullable().optional(),
    homeroom_sorting_required: z.boolean().nullable().optional(),
    data_import_mode: nullableString(120),
    special_instructions: nullableString(4000),
    specific_area: nullableString(240)
  })
  .strict();

const sportsProfileSchema = z
  .object({
    sport_type: nullableString(120),
    season: nullableString(120),
    league_name: nullableString(160),
    division: nullableString(160),
    team_structure: nullableString(120),
    estimated_team_count: z.number().int().nonnegative().nullable().optional(),
    proof_required: z.boolean().nullable().optional(),
    approval_contact_id: nullableUuid,
    billing_contact_id: nullableUuid,
    revenue_share_enabled: z.boolean().nullable().optional(),
    revenue_share_terms_summary: nullableString(2000),
    banner_work_required: z.boolean().nullable().optional(),
    specialty_products_required: z.boolean().nullable().optional(),
    buddy_photos_required: z.boolean().nullable().optional(),
    sponsor_graphics_required: z.boolean().nullable().optional(),
    client_expectations_notes: nullableString(4000)
  })
  .strict();

const jobDraftSchema = z
  .object({
    department_type: z.enum(JOB_DEPARTMENT_TYPES),
    job_category: z.enum(JOB_CATEGORIES).nullable().optional(),
    organization_id: nullableUuid,
    primary_location_id: nullableUuid,
    primary_contact_id: nullableUuid,
    account_owner_user_id: nullableUuid,
    title: nullableString(240),
    event_name: nullableString(240),
    description_internal: nullableString(4000),
    priority_level: z.enum(JOB_PRIORITY_LEVELS).nullable().optional(),
    delivery_type: nullableString(120),
    gallery_type: nullableString(120),
    scheduled_start_at: nullableString(64),
    scheduled_end_at: nullableString(64),
    timezone: nullableString(120),
    estimated_subject_count: z.number().int().nonnegative().nullable().optional(),
    estimated_staff_count: z.number().int().nonnegative().nullable().optional(),
    client_deadline_at: nullableString(64),
    production_deadline_at: nullableString(64),
    production_required: z.boolean().nullable().optional(),
    location_override_note: nullableString(2000),
    contact_override_note: nullableString(2000),
    school_profile: schoolProfileSchema.nullable().optional(),
    sports_profile: sportsProfileSchema.nullable().optional(),
    workflow_template_key: nullableString(160),
    workflow_template_version_id: nullableUuid,
    events: z.array(daySchema).max(31).nullable().optional(),
    days: z.array(daySchema).max(31).nullable().optional()
  })
  .strict()
  .refine((value) => !value.events || !value.days, {
    message: "Provide either events or days, not both.",
    path: ["events"]
  });

function normalizeJobDraftPayload<T extends { days?: unknown; events?: unknown }>(payload: T) {
  return {
    ...payload,
    days: payload.days ?? payload.events ?? null
  };
}

const listQuerySchema = z
  .object({
    department_type: z.enum(JOB_DEPARTMENT_TYPES).optional(),
    search: z.string().trim().max(120).optional(),
    day_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Optional status filters for deep-linked, coherent filtered views. Kept lenient
    // (the service matches them as text); SharedJobsPage only sends column-mapped
    // values, never the overloaded calendar/derived filter values.
    production_status: z.string().trim().max(80).optional(),
    readiness_status: z.string().trim().max(80).optional()
  })
  .strict();

const assignmentSchema = z
  .object({
    job_day_id: nullableUuid,
    user_id: z.string().uuid(),
    assignment_role: z.string().trim().min(1).max(80).optional(),
    assignment_status: z.string().trim().min(1).max(80).optional(),
    is_lead: z.boolean().optional(),
    notes: nullableString(2000)
  })
  .strict();

const readinessUpdateSchema = z
  .object({
    is_complete: z.boolean().nullable().optional(),
    note: nullableString(2000)
  })
  .strict();
const leadReadySchema = z
  .object({
    on_site_confirmed: z.boolean().optional().default(true),
    setup_complete: z.boolean().optional().default(true),
    all_required_staff_present: z.boolean().optional().default(true),
    blockers_resolved: z.boolean().optional().default(true),
    equipment_ready: z.boolean().nullable().optional(),
    client_contact_checked_in: z.boolean().nullable().optional(),
    note: nullableString(2000)
  })
  .strict();
const lifecycleSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();
const assignmentPatchSchema = z
  .object({
    assignment_role: nullableString(80),
    assignment_status: z.enum(JOB_ASSIGNMENT_STATUSES).nullable().optional(),
    is_lead: z.boolean().nullable().optional(),
    job_day_id: nullableUuid,
    is_ready_present: z.boolean().nullable().optional(),
    notes: nullableString(2000),
    request_backup: z.boolean().nullable().optional()
  })
  .strict();
const dayStatusSchema = z
  .object({
    day_status: z.enum(JOB_DAY_STATUSES),
    note: nullableString(2000)
  })
  .strict();
const dayNoteSchema = z
  .object({
    note: z.string().trim().min(1).max(4000)
  })
  .strict();

const productionSchema = z
  .object({
    id: nullableUuid,
    job_day_id: nullableUuid,
    production_group_key: nullableString(160),
    title: nullableString(240),
    production_type: nullableString(120),
    production_template_key: nullableString(120),
    completion_rule_key: nullableString(160),
    status: z.enum(JOB_PRODUCTION_STATUSES).nullable().optional(),
    workflow_status: z.enum(PRODUCTION_BOARD_WORKFLOW_STATUSES).nullable().optional(),
    health_state: z.enum(PRODUCTION_BOARD_HEALTH_STATES).nullable().optional(),
    sync_state: z.enum(PRODUCTION_BOARD_SYNC_STATES).nullable().optional(),
    priority: z.enum(JOB_PRIORITY_LEVELS).nullable().optional(),
    assigned_to_user_id: nullableUuid,
    assigned_peer_reviewer_user_id: nullableUuid,
    assigned_release_reviewer_user_id: nullableUuid,
    escalation_owner_user_id: nullableUuid,
    department_owner_user_id: nullableUuid,
    created_from_source: nullableString(120),
    approval_required: z.boolean().nullable().optional(),
    proof_required: z.boolean().nullable().optional(),
    qa_required: z.boolean().nullable().optional(),
    production_start_at: nullableString(64),
    due_at: nullableString(64),
    release_due_at: nullableString(64),
    delivery_deadline_at: nullableString(64),
    file_count_expected: z.number().int().nonnegative().nullable().optional(),
    file_count_received: z.number().int().nonnegative().nullable().optional(),
    file_match_status: z.enum(PRODUCTION_BOARD_FILE_MATCH_STATUSES).nullable().optional(),
    handoff_complete: z.boolean().nullable().optional(),
    roster_received: z.boolean().nullable().optional(),
    naming_verified: z.boolean().nullable().optional(),
    folder_structure_verified: z.boolean().nullable().optional(),
    tags_or_flags_verified: z.boolean().nullable().optional(),
    creator_review_complete: z.boolean().nullable().optional(),
    peer_review_complete: z.boolean().nullable().optional(),
    final_release_review_complete: z.boolean().nullable().optional(),
    upload_status: z.enum(PRODUCTION_BOARD_UPLOAD_STATUSES).nullable().optional(),
    release_status: z.enum(PRODUCTION_BOARD_RELEASE_STATUSES).nullable().optional(),
    release_target: nullableString(240),
    gallery_or_output_reference: nullableString(240),
    blocked_reason: nullableString(2000),
    vendor_name: nullableString(240),
    vendor_reference: nullableString(240),
    client_visible_label: nullableString(240),
    internal_notes: nullableString(4000),
    production_notes: nullableString(4000),
    post_shoot_eval_summary: nullableString(4000),
    legacy_source_reference: nullableString(240),
    imported_status_source: nullableString(240),
    legacy_owner_history_json: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    hold_reason: nullableString(2000),
    hold_owner_user_id: nullableUuid,
    hold_review_at: nullableString(64),
    allow_checklist_override: z.boolean().nullable().optional(),
    checklist_override_reason: nullableString(2000),
    qa_status: nullableString(120)
  })
  .strict();

const productionGroupSchema = z
  .object({
    production_item_ids: z.array(z.string().uuid()).min(2).max(50),
    title: nullableString(240),
    assigned_to_user_id: nullableUuid,
    assigned_peer_reviewer_user_id: nullableUuid,
    assigned_release_reviewer_user_id: nullableUuid,
    due_at: nullableString(64),
    release_due_at: nullableString(64),
    release_target: nullableString(240),
    note: nullableString(2000)
  })
  .strict();

const productionSplitBranchSchema = z
  .object({
    title: nullableString(240),
    production_type: nullableString(120),
    due_at: nullableString(64),
    release_due_at: nullableString(64),
    delivery_deadline_at: nullableString(64),
    release_target: nullableString(240),
    assigned_to_user_id: nullableUuid,
    assigned_peer_reviewer_user_id: nullableUuid,
    assigned_release_reviewer_user_id: nullableUuid,
    vendor_name: nullableString(240),
    client_visible_label: nullableString(240),
    approval_required: z.boolean().nullable().optional(),
    proof_required: z.boolean().nullable().optional(),
    qa_required: z.boolean().nullable().optional()
  })
  .strict();

const productionSplitSchema = z
  .object({
    branches: z.array(productionSplitBranchSchema).min(2).max(20),
    note: nullableString(2000)
  })
  .strict();

const productionListQuerySchema = z
  .object({
    department_type: z.enum(JOB_DEPARTMENT_TYPES).optional(),
    status: z.enum(JOB_PRODUCTION_STATUSES).optional(),
    workflow_status: z.enum(PRODUCTION_BOARD_WORKFLOW_STATUSES).optional(),
    health_state: z.enum(PRODUCTION_BOARD_HEALTH_STATES).optional(),
    approval_status: z.enum(JOB_APPROVAL_STATUSES).optional(),
    qa_status: z.enum(JOB_QA_REVIEW_STATUSES).optional(),
    assigned_to_user_id: z.string().uuid().optional(),
    blocked: z.enum(["yes", "no"]).optional(),
    priority: z.enum(JOB_PRIORITY_LEVELS).optional(),
    due_bucket: z.enum(["today", "overdue", "next-7"]).optional(),
    search: z.string().trim().max(160).optional(),
    deliverable_type: z.string().trim().max(120).optional(),
    organization_id: z.string().uuid().optional(),
    release_status: z.enum(PRODUCTION_BOARD_RELEASE_STATUSES).optional(),
    checklist_state: z.enum(["overdue", "awaiting_approval", "rejected", "blocked"]).optional()
  })
  .strict();

const productionBoardViewQuerySchema = z
  .object({
    department_type: z.enum(JOB_DEPARTMENT_TYPES).optional(),
    limit: z.coerce.number().int().min(1).max(250).optional()
  })
  .strict();

const productionReportingQuerySchema = productionListQuerySchema
  .extend({
    due_window: z.enum(["all", "today", "overdue", "next_3", "next_7", "closed_last_7_days"]).optional()
  })
  .strict();

const handoffSchema = z
  .object({
    id: nullableUuid,
    handoff_type: nullableString(120),
    from_stage: nullableString(120),
    to_stage: nullableString(120),
    from_user_id: nullableUuid,
    to_user_id: nullableUuid,
    status: z.enum(JOB_HANDOFF_STATUSES).nullable().optional(),
    note: nullableString(2000)
  })
  .strict();

const approvalSchema = z
  .object({
    id: nullableUuid,
    job_day_id: nullableUuid,
    approval_type: nullableString(120),
    approver_contact_id: nullableUuid,
    approver_user_id: nullableUuid,
    status: z.enum(JOB_APPROVAL_STATUSES).nullable().optional(),
    due_at: nullableString(64),
    summary: nullableString(4000),
    notes: nullableString(4000),
    log_follow_up: z.boolean().nullable().optional()
  })
  .strict();

const qaReviewSchema = z
  .object({
    id: nullableUuid,
    review_type: nullableString(120),
    review_stage: nullableString(120),
    reviewer_user_id: nullableUuid,
    status: z.enum(JOB_QA_REVIEW_STATUSES).nullable().optional(),
    decision: nullableString(120),
    sample_size_percent: z.number().int().min(0).max(100).nullable().optional(),
    checklist_template_key: nullableString(120),
    question_answers_json: z.record(z.string(), z.unknown()).nullable().optional(),
    notes: nullableString(4000),
    decision_reason: nullableString(4000),
    issue_category: nullableString(160),
    rework_required: z.boolean().nullable().optional(),
    sent_back_to_user_id: nullableUuid,
    override_same_reviewer: z.boolean().nullable().optional(),
    override_reason: nullableString(4000)
  })
  .strict();

const qaFindingSchema = z
  .object({
    id: nullableUuid,
    finding_type: nullableString(120),
    severity: z.enum(JOB_WATCH_FLAG_SEVERITIES).nullable().optional(),
    title: nullableString(240),
    description: nullableString(4000),
    is_blocking: z.boolean().nullable().optional(),
    resolve: z.boolean().nullable().optional()
  })
  .strict();

const deliverableSchema = z
  .object({
    id: nullableUuid,
    parent_deliverable_item_id: nullableUuid,
    deliverable_type: nullableString(120),
    deliverable_group_key: nullableString(120),
    completion_marker_key: nullableString(160),
    title: nullableString(240),
    quantity: z.number().int().nonnegative().nullable().optional(),
    delivery_method: nullableString(120),
    status: z.enum(JOB_DELIVERABLE_STATUSES).nullable().optional(),
    vendor_name: nullableString(240),
    tracking_reference: nullableString(240),
    recipient_contact_id: nullableUuid,
    recipient_organization_id: nullableUuid,
    notes: nullableString(4000),
    legacy_source_reference: nullableString(240)
  })
  .strict();

const productionIssueSchema = z
  .object({
    id: nullableUuid,
    issue_type: nullableString(120),
    severity: z.enum(JOB_WATCH_FLAG_SEVERITIES).nullable().optional(),
    title: nullableString(240),
    description: nullableString(4000),
    status: z.enum(JOB_PRODUCTION_ISSUE_STATUSES).nullable().optional(),
    owner_user_id: nullableUuid,
    due_at: nullableString(64),
    is_blocking: z.boolean().nullable().optional(),
    source_key: nullableString(160),
    resolution_note: nullableString(2000)
  })
  .strict();

const watchFlagSchema = z
  .object({
    id: nullableUuid,
    job_day_id: nullableUuid,
    production_item_id: nullableUuid,
    severity: z.enum(JOB_WATCH_FLAG_SEVERITIES).nullable().optional(),
    flag_type: nullableString(120),
    title: nullableString(240),
    description: nullableString(4000),
    status: z.enum(JOB_WATCH_FLAG_STATUSES).nullable().optional(),
    owner_user_id: nullableUuid,
    due_at: nullableString(64)
  })
  .strict();

const exceptionQueueQuerySchema = z
  .object({
    department_type: z.enum(JOB_DEPARTMENT_TYPES).optional(),
    severity: z.enum(JOB_WATCH_FLAG_SEVERITIES).optional(),
    flag_type: z.string().trim().max(120).optional(),
    owner_user_id: z.string().uuid().optional(),
    status: z.enum(JOB_WATCH_FLAG_STATUSES).optional(),
    source_entity_type: z.string().trim().max(120).optional(),
    only_mine: z.enum(["yes", "no"]).optional(),
    next_24_hours: z.enum(["yes", "no"]).optional(),
    critical_high_only: z.enum(["yes", "no"]).optional(),
    only_snoozed: z.enum(["yes", "no"]).optional(),
    only_escalated: z.enum(["yes", "no"]).optional(),
    view_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(250).optional()
  })
  .strict();

const exceptionSavedViewSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scope_type: nullableString(80),
    department_type: z.enum(JOB_DEPARTMENT_TYPES).nullable().optional(),
    filters_json: z.record(z.string(), z.unknown()).nullable().optional(),
    is_default: z.boolean().nullable().optional(),
    is_shared: z.boolean().nullable().optional()
  })
  .strict();

const watchFlagSnoozeSchema = z
  .object({
    snooze_until: z.string().trim().min(1).max(64),
    note: nullableString(2000)
  })
  .strict();

const watchFlagResolveSchema = z
  .object({
    note: nullableString(2000),
    resolution_note: nullableString(2000),
    root_cause: nullableString(2000),
    follow_up_required: z.boolean().nullable().optional()
  })
  .strict();

const watchFlagDismissSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000)
  })
  .strict();

const watchFlagEscalateSchema = z
  .object({
    severity: z.enum(JOB_WATCH_FLAG_SEVERITIES).nullable().optional(),
    owner_user_id: nullableUuid,
    escalated_to_role: nullableString(120),
    due_at: nullableString(64),
    note: nullableString(2000)
  })
  .strict();

const alertsQuerySchema = z
  .object({
    unread_only: z.enum(["yes", "no"]).optional(),
    limit: z.coerce.number().int().min(1).max(250).optional()
  })
  .strict();

const dashboardQuerySchema = z
  .object({
    department_type: z.enum(JOB_DEPARTMENT_TYPES).optional()
  })
  .strict();

const prepReadinessQueueQuerySchema = z
  .object({
    status: z.enum(["all", "ready", "needs_attention", "blocked"]).optional(),
    issue: z
      .enum(["all", "missing_location", "missing_prep_recipient", "missing_sms_eligibility", "missing_location_details", "message_preview_blocked"])
      .optional(),
    department_type: z.enum(["all", ...JOB_DEPARTMENT_TYPES]).optional(),
    limit: z.coerce.number().int().min(1).max(250).optional()
  })
  .strict();

const alertActedSchema = z
  .object({
    action_type: z.string().trim().min(1).max(120)
  })
  .strict();

const widgetPreferenceSchema = z
  .object({
    dashboard_scope: z.string().trim().min(1).max(80),
    preferences: z
      .array(
        z
          .object({
            widget_key: z.string().trim().min(1).max(120),
            position_index: z.number().int().min(0),
            is_visible: z.boolean(),
            settings_json: z.record(z.string(), z.unknown()).nullable().optional()
          })
          .strict()
      )
      .max(40)
  })
  .strict();

function getAuth(req: unknown) {
  return (req as AuthenticatedRequest).auth;
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.use(requireAuth);

router.get("/watchlist", validateQuery(exceptionQueueQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listWatchFlags(client, auth, {
        department_type: (req.query.department_type as any) ?? null,
        severity: (req.query.severity as any) ?? null,
        flag_type: (req.query.flag_type as string | undefined) ?? null,
        owner_user_id: (req.query.owner_user_id as string | undefined) ?? null,
        status: (req.query.status as any) ?? null,
        source_entity_type: (req.query.source_entity_type as string | undefined) ?? null,
        only_mine: req.query.only_mine === "yes",
        next_24_hours: req.query.next_24_hours === "yes",
        critical_high_only: req.query.critical_high_only === "yes",
        only_snoozed: req.query.only_snoozed === "yes",
        only_escalated: req.query.only_escalated === "yes",
        view_id: (req.query.view_id as string | undefined) ?? null,
        limit: typeof req.query.limit === "number" ? req.query.limit : undefined
      });
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/exceptions", validateQuery(exceptionQueueQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listWatchFlags(client, auth, req.query as any);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/watchlist/saved-views", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const views = await listWatchlistSavedViews(client, auth, (req.query.department_type as any) ?? null);
      return res.json({ views });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/exceptions/saved-views", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const views = await listWatchlistSavedViews(client, auth, (req.query.department_type as any) ?? null);
      return res.json({ views });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post("/watchlist/saved-views", validateBody(exceptionSavedViewSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const view = await withClientTransaction(auth.tenantId, auth.id, (client) => createWatchlistSavedView(client, auth, req.body));
    return res.status(201).json({ view });
  } catch (error) {
    return next(error);
  }
});

router.post("/exceptions/saved-views", validateBody(exceptionSavedViewSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const view = await withClientTransaction(auth.tenantId, auth.id, (client) => createWatchlistSavedView(client, auth, req.body));
    return res.status(201).json({ view });
  } catch (error) {
    return next(error);
  }
});

router.patch("/watchlist/saved-views/:viewId", validateBody(exceptionSavedViewSchema.partial()), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const view = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateWatchlistSavedView(client, auth, singleParam(req.params.viewId), req.body)
    );
    return res.json({ view });
  } catch (error) {
    return next(error);
  }
});

router.patch("/exceptions/saved-views/:viewId", validateBody(exceptionSavedViewSchema.partial()), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const view = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateWatchlistSavedView(client, auth, singleParam(req.params.viewId), req.body)
    );
    return res.json({ view });
  } catch (error) {
    return next(error);
  }
});

router.delete("/watchlist/saved-views/:viewId", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    await withClientTransaction(auth.tenantId, auth.id, (client) => deleteWatchlistSavedView(client, auth, singleParam(req.params.viewId)));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.delete("/exceptions/saved-views/:viewId", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    await withClientTransaction(auth.tenantId, auth.id, (client) => deleteWatchlistSavedView(client, auth, singleParam(req.params.viewId)));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/watch-flags/:flagId/acknowledge", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    await withClientTransaction(auth.tenantId, auth.id, (client) => acknowledgeWatchFlag(client, auth, singleParam(req.params.flagId)));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/watch-flags/:flagId/snooze", validateBody(watchFlagSnoozeSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      snoozeWatchFlag(client, auth, singleParam(req.params.flagId), req.body.snooze_until, req.body.note ?? null)
    );
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/watch-flags/:flagId/resolve", validateBody(watchFlagResolveSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      resolveWatchFlag(client, auth, singleParam(req.params.flagId), req.body)
    );
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/watch-flags/:flagId/dismiss", validateBody(watchFlagDismissSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      dismissWatchFlag(client, auth, singleParam(req.params.flagId), req.body.reason)
    );
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/watch-flags/:flagId/escalate", validateBody(watchFlagEscalateSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      escalateWatchFlag(client, auth, singleParam(req.params.flagId), req.body)
    );
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/alerts", validateQuery(alertsQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listAlertCenter(client, auth, req.query.unread_only === "yes", typeof req.query.limit === "number" ? req.query.limit : 100);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post("/alerts/:deliveryId/read", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      markAlertDeliveryRead(client, auth, singleParam(req.params.deliveryId))
    );
    return res.json({ delivery: result });
  } catch (error) {
    return next(error);
  }
});

router.post("/alerts/:deliveryId/acted", validateBody(alertActedSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      markAlertDeliveryActed(client, auth, singleParam(req.params.deliveryId), req.body.action_type)
    );
    return res.json({ delivery: result });
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard/home", validateQuery(dashboardQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await getDashboard(client, auth, "home", (req.query.department_type as any) ?? null);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard/executive", validateQuery(dashboardQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await getDashboard(client, auth, "executive", (req.query.department_type as any) ?? null);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard/today", validateQuery(dashboardQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await getDashboard(client, auth, "today", (req.query.department_type as any) ?? null);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard/widget-preferences", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const dashboardScope = typeof req.query.dashboard_scope === "string" && req.query.dashboard_scope.trim() ? req.query.dashboard_scope.trim() : "home";
      const preferences = await listDashboardWidgetPreferences(client, auth, dashboardScope);
      return res.json({ preferences });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.put("/dashboard/widget-preferences", validateBody(widgetPreferenceSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const preferences = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      saveDashboardWidgetPreferences(client, auth, req.body.dashboard_scope, req.body.preferences)
    );
    return res.json({ preferences });
  } catch (error) {
    return next(error);
  }
});

router.get("/", validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const jobs = await listJobs(client, auth, req.query as any);
      return res.json({ jobs });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

// Accurate, uncapped job-status counts for Company Command headline cards. Reuses
// dashboardQuerySchema (optional department_type) and the same router-level auth +
// service-level read-scope as the jobs list.
router.get("/status-counts", validateQuery(dashboardQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const counts = await getJobStatusCounts(client, auth, {
        department_type: (req.query.department_type as any) ?? null
      });
      return res.json({ counts });
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/prep-readiness-queue", validateQuery(prepReadinessQueueQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listPrepReadinessQueue(client, auth, {
        status: (req.query.status as any) ?? "all",
        issue: (req.query.issue as any) ?? "all",
        department_type: (req.query.department_type as any) ?? "all",
        limit: typeof req.query.limit === "number" ? req.query.limit : undefined
      });
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/production-items", validateQuery(productionListQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listProductionQueue(client, auth, {
        ...(req.query as any),
        run_automation: false
      });
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/production-items/urgent-watch", validateQuery(productionBoardViewQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listProductionUrgentWatch(client, auth, req.query as any);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/production-items/exceptions", validateQuery(productionBoardViewQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listProductionManagementExceptions(client, auth, req.query as any);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/production-items/overdue", validateQuery(productionBoardViewQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listProductionOverdueQueue(client, auth, req.query as any);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/production-items/blocked", validateQuery(productionBoardViewQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await listProductionBlockedQueue(client, auth, req.query as any);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/production-items/reporting", validateQuery(productionReportingQuerySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const response = await getProductionReporting(client, auth, req.query as any);
      return res.json(response);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/:jobId", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const client = await connectGuardedClient();
    try {
      const detail = await getJobDetail(client, auth, singleParam(req.params.jobId));
      return res.json(detail);
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post("/drafts", validateBody(jobDraftSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createDraftJob(client, auth, normalizeJobDraftPayload(req.body))
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId", validateBody(jobDraftSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updatePublishedJob(client, auth, singleParam(req.params.jobId), normalizeJobDraftPayload(req.body))
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/drafts/:jobId", validateBody(jobDraftSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateDraftJob(client, auth, singleParam(req.params.jobId), normalizeJobDraftPayload(req.body))
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/publish", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) => publishJob(client, auth, singleParam(req.params.jobId)));
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/days", validateBody(daySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) => addJobDay(client, auth, singleParam(req.params.jobId), req.body));
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/staff-assignments", validateBody(assignmentSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      assignJobStaff(client, auth, singleParam(req.params.jobId), req.body)
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/staff-assignments/:assignmentId/check-in", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      checkInJobStaff(client, auth, singleParam(req.params.jobId), singleParam(req.params.assignmentId))
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/staff-assignments/:assignmentId", validateBody(assignmentPatchSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateJobStaffAssignment(client, auth, singleParam(req.params.jobId), singleParam(req.params.assignmentId), req.body)
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/days/:dayId/ready", validateBody(leadReadySchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      markLeadReady(client, auth, singleParam(req.params.jobId), singleParam(req.params.dayId), req.body)
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/days/:dayId", validateBody(dayStatusSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateJobDay(client, auth, singleParam(req.params.jobId), singleParam(req.params.dayId), req.body)
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/days/:dayId/notes", validateBody(dayNoteSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      addJobDayNote(client, auth, singleParam(req.params.jobId), singleParam(req.params.dayId), req.body.note)
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/readiness-items/:itemId", validateBody(readinessUpdateSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateReadinessItem(client, auth, singleParam(req.params.jobId), singleParam(req.params.itemId), req.body)
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/readiness-items/:itemId/complete", validateBody(readinessUpdateSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateReadinessItem(client, auth, singleParam(req.params.jobId), singleParam(req.params.itemId), {
        ...req.body,
        is_complete: req.body.is_complete ?? true
      })
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/production-items", validateBody(productionSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateProductionItem(client, auth, singleParam(req.params.jobId), req.body)
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/production-items/:productionItemId", validateBody(productionSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateProductionItem(client, auth, singleParam(req.params.jobId), {
        ...req.body,
        id: singleParam(req.params.productionItemId)
      })
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/production-items/group", validateBody(productionGroupSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      groupProductionItems(client, auth, singleParam(req.params.jobId), req.body)
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/production-items/:productionItemId/split", validateBody(productionSplitSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      splitProductionItem(client, auth, singleParam(req.params.jobId), singleParam(req.params.productionItemId), req.body)
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/production-items/:productionItemId/handoffs", validateBody(handoffSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateProductionHandoff(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        req.body
      )
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/production-items/:productionItemId/handoffs/:handoffId", validateBody(handoffSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateProductionHandoff(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        {
          ...req.body,
          id: singleParam(req.params.handoffId)
        }
      )
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/production-items/:productionItemId/approvals", validateBody(approvalSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateApprovalRequest(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        req.body
      )
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/production-items/:productionItemId/approvals/:approvalId", validateBody(approvalSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateApprovalRequest(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        {
          ...req.body,
          id: singleParam(req.params.approvalId)
        }
      )
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/production-items/:productionItemId/qa-reviews", validateBody(qaReviewSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateQaReview(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        req.body
      )
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/production-items/:productionItemId/qa-reviews/:qaReviewId", validateBody(qaReviewSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateQaReview(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        {
          ...req.body,
          id: singleParam(req.params.qaReviewId)
        }
      )
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:jobId/production-items/:productionItemId/qa-reviews/:qaReviewId/findings",
  validateBody(qaFindingSchema),
  async (req, res, next) => {
    try {
      const auth = getAuth(req as unknown as AuthenticatedRequest);
      const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createOrUpdateQaFinding(
          client,
          auth,
          singleParam(req.params.jobId),
          singleParam(req.params.productionItemId),
          singleParam(req.params.qaReviewId),
          req.body
        )
      );
      return res.status(201).json(detail);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/:jobId/production-items/:productionItemId/qa-reviews/:qaReviewId/findings/:findingId",
  validateBody(qaFindingSchema),
  async (req, res, next) => {
    try {
      const auth = getAuth(req as unknown as AuthenticatedRequest);
      const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createOrUpdateQaFinding(
          client,
          auth,
          singleParam(req.params.jobId),
          singleParam(req.params.productionItemId),
          singleParam(req.params.qaReviewId),
          {
            ...req.body,
            id: singleParam(req.params.findingId)
          }
        )
      );
      return res.json(detail);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/:jobId/production-items/:productionItemId/deliverables", validateBody(deliverableSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateDeliverableItem(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        req.body
      )
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/production-items/:productionItemId/deliverables/:deliverableId", validateBody(deliverableSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateDeliverableItem(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        {
          ...req.body,
          id: singleParam(req.params.deliverableId)
        }
      )
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/production-items/:productionItemId/issues", validateBody(productionIssueSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateProductionIssue(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        req.body
      )
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:jobId/production-items/:productionItemId/issues/:issueId", validateBody(productionIssueSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrUpdateProductionIssue(
        client,
        auth,
        singleParam(req.params.jobId),
        singleParam(req.params.productionItemId),
        {
          ...req.body,
          id: singleParam(req.params.issueId)
        }
      )
    );
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/watch-flags", validateBody(watchFlagSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOrResolveWatchFlag(client, auth, singleParam(req.params.jobId), req.body)
    );
    return res.status(201).json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/cancel", validateBody(lifecycleSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) => cancelJob(client, auth, singleParam(req.params.jobId), req.body.reason));
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/postpone", validateBody(lifecycleSchema), async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) => postponeJob(client, auth, singleParam(req.params.jobId), req.body.reason));
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

router.post("/:jobId/archive", async (req, res, next) => {
  try {
    const auth = getAuth(req as unknown as AuthenticatedRequest);
    const detail = await withClientTransaction(auth.tenantId, auth.id, (client) => archiveJob(client, auth, singleParam(req.params.jobId)));
    return res.json(detail);
  } catch (error) {
    return next(error);
  }
});

export default router;
