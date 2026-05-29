import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireOperatingSystemModuleManage, requireOperatingSystemModuleView } from "../middleware/operatingSystemAccess.js";
import { requireAction } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getLocalDateString } from "../utils/localDate.js";
import { loadProductionProjectBoard } from "../application/productionProjects/load-production-project-board.action.js";
import { loadProductionProjectDetail } from "../application/productionProjects/load-production-project-detail.action.js";
import { loadProductionProjectReferenceData } from "../application/productionProjects/load-production-project-reference-data.action.js";
import { createProductionProjectAction } from "../application/productionProjects/create-production-project.action.js";
import { updateProductionProjectAction } from "../application/productionProjects/update-production-project.action.js";
import { updateProductionProjectTaskAction } from "../application/productionProjects/update-production-project-task.action.js";
import { synchronizeProductionIntake } from "../services/productionIntake.js";
import {
  createProductionProjectException,
  getProductionProjectAnalytics,
  getProductionProjectQaWorkspace,
  listProductionProjectTemplates,
  submitProductionProjectQaReview,
  updateProductionProjectBuddyWorkflow,
  updateProductionProjectException,
  updateProductionProjectVirtualTeamWorkflow
} from "../services/productionProjects.js";

const router = Router();

const queueSchema = z.enum(["my_queue", "team_queue", "blocked_queue", "qa_queue", "ready_to_release_queue", "at_risk_queue", "all"]);
const workspaceViewSchema = z.enum(["lead_board", "staff_workspace"]);
const leadBoardSortSchema = z.enum(["overdue_severity", "due_date", "priority", "last_touched", "owner", "current_step"]);
const leadBoardFocusSchema = z.enum(["all", "blocked", "overdue", "waiting"]);
const ownerFilterSchema = z.union([z.string().uuid(), z.literal("unassigned")]);
const projectCategorySchema = z.enum([
  "production_follow_up",
  "photography_production",
  "digital_production",
  "qa_peer_review",
  "remediation",
  "all"
]);
const projectJobTypeSchema = z.enum([
  "standard_school_production",
  "sports_production",
  "specialty_graphics",
  "banner_specialty_product",
  "gallery_prep_upload",
  "qa_final_review",
  "correction_rework",
  "all"
]);
const projectTeamOwnerSchema = z.enum(["production", "graphics", "upload", "qa", "release", "corrections", "all"]);
const projectStageSchema = z.enum([
  "intake_pending",
  "ready_for_production",
  "in_production",
  "blocked",
  "ready_for_qa",
  "in_qa_review",
  "qa_hold",
  "correction_needed",
  "ready_to_release",
  "released_complete",
  "on_hold",
  "cancelled",
  "all"
]);
const boardQuerySchema = z.object({
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  workspace_view: workspaceViewSchema.optional(),
  status: z.enum(["open", "completed", "all"]).optional(),
  queue: queueSchema.optional(),
  search: z.string().trim().max(160).optional(),
  owner_user_id: ownerFilterSchema.optional(),
  priority: z.enum(["low", "normal", "high", "critical", "all"]).optional(),
  template_id: z.string().uuid().optional(),
  source_type: z.enum(["manual", "trigger", "all"]).optional(),
  source_trigger_key: z.string().trim().max(120).optional(),
  category: projectCategorySchema.optional(),
  job_type: projectJobTypeSchema.optional(),
  stage: projectStageSchema.optional(),
  team_owner: projectTeamOwnerSchema.optional(),
  linked_organization_id: z.string().uuid().optional(),
  linked_location_id: z.string().uuid().optional(),
  linked_shoot_id: z.string().uuid().optional(),
  due_state: z.enum(["overdue", "due_today", "upcoming", "unscheduled", "all"]).optional(),
  big_critical_only: z.coerce.boolean().optional(),
  lead_board_sort: leadBoardSortSchema.optional(),
  lead_board_focus: leadBoardFocusSchema.optional()
});

const referenceDataQuerySchema = z.object({
  linked_organization_id: z.string().uuid().optional(),
  linked_location_id: z.string().uuid().optional()
});

const intakeReconcileBodySchema = z.object({
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const createProjectSchema = z.object({
  template_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["new", "active", "blocked", "waiting", "completed", "canceled"]).optional(),
  job_type: z.enum([
    "standard_school_production",
    "sports_production",
    "specialty_graphics",
    "banner_specialty_product",
    "gallery_prep_upload",
    "qa_final_review",
    "correction_rework"
  ]).optional(),
  category: z.enum(["production_follow_up", "photography_production", "digital_production", "qa_peer_review", "remediation"]).optional(),
  stage: z.enum([
    "intake_pending",
    "ready_for_production",
    "in_production",
    "blocked",
    "ready_for_qa",
    "in_qa_review",
    "qa_hold",
    "correction_needed",
    "ready_to_release",
    "released_complete",
    "on_hold",
    "cancelled"
  ]).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  peer_reviewer_user_id: z.string().uuid().nullable().optional(),
  final_qc_reviewer_user_id: z.string().uuid().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  linked_organization_id: z.string().uuid().nullable().optional(),
  linked_location_id: z.string().uuid().nullable().optional(),
  linked_shoot_id: z.string().uuid().nullable().optional(),
  latest_note: z.string().trim().max(2000).nullable().optional()
});

const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["new", "active", "blocked", "waiting", "completed", "canceled"]).optional(),
  job_type: z.enum([
    "standard_school_production",
    "sports_production",
    "specialty_graphics",
    "banner_specialty_product",
    "gallery_prep_upload",
    "qa_final_review",
    "correction_rework"
  ]).optional(),
  stage: z.enum([
    "intake_pending",
    "ready_for_production",
    "in_production",
    "blocked",
    "ready_for_qa",
    "in_qa_review",
    "qa_hold",
    "correction_needed",
    "ready_to_release",
    "released_complete",
    "on_hold",
    "cancelled"
  ]).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  peer_reviewer_user_id: z.string().uuid().nullable().optional(),
  final_qc_reviewer_user_id: z.string().uuid().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  snoozed_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  latest_note: z.string().trim().max(2000).nullable().optional(),
  blocker_type: z.enum([
    "missing_files",
    "bad_incomplete_data",
    "waiting_on_decision",
    "waiting_on_customer_school",
    "upload_failure",
    "qa_issue",
    "system_tool_problem",
    "staffing_capacity_issue",
    "external_vendor_dependency",
    "other"
  ]).nullable().optional(),
  blocker_owner_user_id: z.string().uuid().nullable().optional(),
  blocker_reason: z.string().trim().max(500).nullable().optional(),
  blocker_dependency: z.string().trim().max(500).nullable().optional(),
  blocker_expected_resolution_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  blocker_notes: z.string().trim().max(2000).nullable().optional(),
  clear_blocker: z.boolean().optional(),
  correction_reason: z.string().trim().max(500).nullable().optional()
});

const qaCheckSchema = z.object({
  key: z.enum([
    "count_reconciliation",
    "blocking_exceptions",
    "buddy_workflow",
    "virtual_team",
    "asset_validation",
    "final_review_notes"
  ]),
  status: z.enum(["pass", "fail", "not_applicable", "needs_review"]),
  notes: z.string().trim().max(1000).nullable().optional()
});

const qaReviewSchema = z.object({
  result: z.enum(["passed", "correction_needed", "blocked"]),
  note: z.string().trim().max(2000).nullable().optional(),
  correction_reason: z.string().trim().max(2000).nullable().optional(),
  qa_checks: z.array(qaCheckSchema).min(1)
});

const updateTaskSchema = z.object({
  status: z.enum(["todo", "in_progress", "blocked", "done", "skipped"]).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  latest_note: z.string().trim().max(2000).nullable().optional(),
  handoff_to_user_id: z.string().uuid().nullable().optional(),
  handoff_note: z.string().trim().max(2000).nullable().optional()
}).refine(
  (value) =>
    value.status !== undefined ||
    value.owner_user_id !== undefined ||
    value.due_date !== undefined ||
    value.latest_note !== undefined ||
    value.handoff_to_user_id !== undefined ||
    value.handoff_note !== undefined,
  "At least one task update field is required."
);

const updateBuddyWorkflowSchema = z
  .object({
    status: z.enum(["todo", "in_progress", "blocked", "done", "skipped"]).optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    duplicate_handling_required: z.boolean().optional(),
    cleanup_completed: z.boolean().optional(),
    unresolved_group_count: z.number().int().min(0).optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one buddy workflow field is required.");

const updateVirtualTeamWorkflowSchema = z
  .object({
    status: z.enum(["todo", "in_progress", "blocked", "done", "skipped"]).optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    attributes_validated: z.boolean().optional(),
    coach_tags_validated: z.boolean().optional(),
    split_by_group_validated: z.boolean().optional(),
    ambiguous_match_required: z.boolean().optional(),
    ambiguous_match_resolved: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one virtual team workflow field is required.");

const exceptionCreateSchema = z.object({
  lane_type: z.enum(["buddy_photos", "virtual_teams"]),
  exception_type: z.enum([
    "buddy_unresolved_group",
    "buddy_duplicate_handling_needed",
    "vt_ambiguous_match",
    "vt_coach_tag_missing",
    "vt_split_group_mismatch",
    "vt_attribute_validation_failed"
  ]),
  severity: z.enum(["low", "normal", "high", "critical"]).optional(),
  blocking: z.boolean().optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  issue_tag: z.string().trim().max(120).nullable().optional(),
  follow_up_type: z.enum(["training", "ops_followup", "coaching", "process_update"]).nullable().optional(),
  follow_up_status: z.enum(["open", "in_progress", "complete"]).nullable().optional(),
  follow_up_owner_user_id: z.string().uuid().nullable().optional(),
  follow_up_notes: z.string().trim().max(2000).nullable().optional()
});

const exceptionUpdateSchema = z
  .object({
    status: z.enum(["open", "resolved", "dismissed"]).optional(),
    blocking: z.boolean().optional(),
    assignee_user_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    resolution_notes: z.string().trim().max(2000).nullable().optional(),
    issue_tag: z.string().trim().max(120).nullable().optional(),
    follow_up_type: z.enum(["training", "ops_followup", "coaching", "process_update"]).nullable().optional(),
    follow_up_status: z.enum(["open", "in_progress", "complete"]).nullable().optional(),
    follow_up_owner_user_id: z.string().uuid().nullable().optional(),
    follow_up_notes: z.string().trim().max(2000).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one exception field is required.");

router.get("/templates", requireAuth, requireOperatingSystemModuleView("production"), requireAction("schedule.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listProductionProjectTemplates(client, auth)
    );
    return res.json({ templates: payload });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/reference-data",
  requireAuth,
  requireOperatingSystemModuleView("production"),
  requireAction("schedule.read"),
  validateQuery(referenceDataQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        loadProductionProjectReferenceData(client, auth, {
          linkedOrganizationId: req.query.linked_organization_id ? String(req.query.linked_organization_id) : null,
          linkedLocationId: req.query.linked_location_id ? String(req.query.linked_location_id) : null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/", requireAuth, requireOperatingSystemModuleView("production"), requireAction("schedule.read"), validateQuery(boardQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      loadProductionProjectBoard(client, auth, {
        anchorDate: req.query.anchor_date ? String(req.query.anchor_date) : getLocalDateString(),
        workspaceView: req.query.workspace_view ? (String(req.query.workspace_view) as "lead_board" | "staff_workspace") : null,
        status: req.query.status ? (String(req.query.status) as "open" | "completed" | "all") : "open",
        queue: req.query.queue
          ? (String(req.query.queue) as "my_queue" | "team_queue" | "blocked_queue" | "qa_queue" | "ready_to_release_queue" | "at_risk_queue" | "all")
          : "all",
        search: req.query.search ? String(req.query.search) : null,
        ownerUserId: req.query.owner_user_id ? String(req.query.owner_user_id) : null,
        priority: req.query.priority && String(req.query.priority) !== "all" ? (String(req.query.priority) as "low" | "normal" | "high" | "critical") : null,
        templateId: req.query.template_id ? String(req.query.template_id) : null,
        sourceType:
          req.query.source_type && String(req.query.source_type) !== "all"
            ? (String(req.query.source_type) as "manual" | "trigger")
            : null,
        sourceTriggerKey: req.query.source_trigger_key ? String(req.query.source_trigger_key) : null,
        category:
          req.query.category && String(req.query.category) !== "all"
            ? (String(req.query.category) as "production_follow_up" | "photography_production" | "digital_production" | "qa_peer_review" | "remediation")
            : null,
        jobType:
          req.query.job_type && String(req.query.job_type) !== "all"
            ? (String(req.query.job_type) as
                | "standard_school_production"
                | "sports_production"
                | "specialty_graphics"
                | "banner_specialty_product"
                | "gallery_prep_upload"
                | "qa_final_review"
                | "correction_rework")
            : null,
        stage:
          req.query.stage && String(req.query.stage) !== "all"
            ? (String(req.query.stage) as
                | "intake_pending"
                | "ready_for_production"
                | "in_production"
                | "blocked"
                | "ready_for_qa"
                | "in_qa_review"
                | "qa_hold"
                | "correction_needed"
                | "ready_to_release"
                | "released_complete"
                | "on_hold"
                | "cancelled")
            : null,
        teamOwner:
          req.query.team_owner && String(req.query.team_owner) !== "all"
            ? (String(req.query.team_owner) as "production" | "graphics" | "upload" | "qa" | "release" | "corrections")
            : null,
        linkedOrganizationId: req.query.linked_organization_id ? String(req.query.linked_organization_id) : null,
        linkedLocationId: req.query.linked_location_id ? String(req.query.linked_location_id) : null,
        linkedShootId: req.query.linked_shoot_id ? String(req.query.linked_shoot_id) : null,
        dueState:
          req.query.due_state && String(req.query.due_state) !== "all"
            ? (String(req.query.due_state) as "overdue" | "due_today" | "upcoming" | "unscheduled")
            : null,
        bigCriticalOnly: String(req.query.big_critical_only ?? "") === "true",
        leadBoardSort: req.query.lead_board_sort
          ? (String(req.query.lead_board_sort) as "overdue_severity" | "due_date" | "priority" | "last_touched" | "owner" | "current_step")
          : "overdue_severity",
        leadBoardFocus: req.query.lead_board_focus
          ? (String(req.query.lead_board_focus) as "all" | "blocked" | "overdue" | "waiting")
          : "all"
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/qa-workspace",
  requireAuth,
  requireOperatingSystemModuleView("production"),
  requireAction("schedule.read"),
  validateQuery(
    z.object({
      anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getProductionProjectQaWorkspace(client, auth, {
          anchorDate: req.query.anchor_date ? String(req.query.anchor_date) : getLocalDateString()
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/analytics",
  requireAuth,
  requireOperatingSystemModuleView("production"),
  requireAction("schedule.read"),
  validateQuery(
    z.object({
      window_days: z.string().regex(/^\d+$/).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const windowDays = req.query.window_days ? Number(req.query.window_days) : undefined;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getProductionProjectAnalytics(client, auth, { windowDays })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/:id", requireAuth, requireOperatingSystemModuleView("production"), requireAction("schedule.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      loadProductionProjectDetail(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/intake/reconcile",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(intakeReconcileBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        synchronizeProductionIntake(client, auth, {
          anchorDate: req.body.anchor_date ? String(req.body.anchor_date) : getLocalDateString()
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(createProjectSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createProductionProjectAction(client, auth, {
        templateId: req.body.template_id ?? null,
        title: String(req.body.title),
        summary: req.body.summary ?? null,
        status: req.body.status,
        jobType: req.body.job_type,
        category: req.body.category,
        stage: req.body.stage,
        priority: req.body.priority,
        ownerUserId: req.body.owner_user_id ?? null,
        peerReviewerUserId: req.body.peer_reviewer_user_id ?? null,
        finalQcReviewerUserId: req.body.final_qc_reviewer_user_id ?? null,
        dueDate: req.body.due_date ?? null,
        followUpDate: req.body.follow_up_date ?? null,
        linkedOrganizationId: req.body.linked_organization_id ?? null,
        linkedLocationId: req.body.linked_location_id ?? null,
        linkedShootId: req.body.linked_shoot_id ?? null,
        latestNote: req.body.latest_note ?? null
      })
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.patch(
  "/:id",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateProjectSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const patch: Parameters<typeof updateProductionProjectAction>[3] = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "title")) {
      patch.title = req.body.title;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "summary")) {
      patch.summary = req.body.summary;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "status")) {
      patch.status = req.body.status;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "job_type")) {
      patch.jobType = req.body.job_type;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "stage")) {
      patch.stage = req.body.stage;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "priority")) {
      patch.priority = req.body.priority;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "owner_user_id")) {
      patch.ownerUserId = req.body.owner_user_id;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "peer_reviewer_user_id")) {
      patch.peerReviewerUserId = req.body.peer_reviewer_user_id;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "final_qc_reviewer_user_id")) {
      patch.finalQcReviewerUserId = req.body.final_qc_reviewer_user_id;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "due_date")) {
      patch.dueDate = req.body.due_date;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "follow_up_date")) {
      patch.followUpDate = req.body.follow_up_date;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "snoozed_until")) {
      patch.snoozedUntil = req.body.snoozed_until;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "latest_note")) {
      patch.latestNote = req.body.latest_note;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "blocker_type")) {
      patch.blockerType = req.body.blocker_type;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "blocker_owner_user_id")) {
      patch.blockerOwnerUserId = req.body.blocker_owner_user_id;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "blocker_reason")) {
      patch.blockerReason = req.body.blocker_reason;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "blocker_dependency")) {
      patch.blockerDependency = req.body.blocker_dependency;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "blocker_expected_resolution_date")) {
      patch.blockerExpectedResolutionDate = req.body.blocker_expected_resolution_date;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "blocker_notes")) {
      patch.blockerNotes = req.body.blocker_notes;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "clear_blocker")) {
      patch.clearBlocker = req.body.clear_blocker;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, "correction_reason")) {
      patch.correctionReason = req.body.correction_reason;
    }
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateProductionProjectAction(client, auth, String(req.params.id), patch)
    );
    return res.status("approval_required" in payload ? 202 : 200).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/:id/qa-review",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(qaReviewSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitProductionProjectQaReview(client, auth, String(req.params.id), {
          result: req.body.result,
          note: req.body.note ?? null,
          correctionReason: req.body.correction_reason ?? null,
          qaChecks: req.body.qa_checks
        })
      );
      return res.status("approval_required" in payload ? 202 : 200).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/:id/tasks/:taskId",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateTaskSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const patch: Parameters<typeof updateProductionProjectTaskAction>[4] = {};
      if (Object.prototype.hasOwnProperty.call(req.body, "status")) {
        patch.status = req.body.status;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "owner_user_id")) {
        patch.ownerUserId = req.body.owner_user_id;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "due_date")) {
        patch.dueDate = req.body.due_date;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "latest_note")) {
        patch.latestNote = req.body.latest_note;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "handoff_to_user_id")) {
        patch.handoffToUserId = req.body.handoff_to_user_id;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "handoff_note")) {
        patch.handoffNote = req.body.handoff_note;
      }
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateProductionProjectTaskAction(client, auth, String(req.params.id), String(req.params.taskId), patch)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/:id/buddy-workflow",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateBuddyWorkflowSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateProductionProjectBuddyWorkflow(client, auth, String(req.params.id), {
          status: req.body.status,
          ownerUserId: Object.prototype.hasOwnProperty.call(req.body, "owner_user_id") ? req.body.owner_user_id : undefined,
          duplicateHandlingRequired: Object.prototype.hasOwnProperty.call(req.body, "duplicate_handling_required")
            ? req.body.duplicate_handling_required
            : undefined,
          cleanupCompleted: Object.prototype.hasOwnProperty.call(req.body, "cleanup_completed") ? req.body.cleanup_completed : undefined,
          unresolvedGroupCount: Object.prototype.hasOwnProperty.call(req.body, "unresolved_group_count")
            ? req.body.unresolved_group_count
            : undefined,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/:id/virtual-team-workflow",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(updateVirtualTeamWorkflowSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateProductionProjectVirtualTeamWorkflow(client, auth, String(req.params.id), {
          status: req.body.status,
          ownerUserId: Object.prototype.hasOwnProperty.call(req.body, "owner_user_id") ? req.body.owner_user_id : undefined,
          attributesValidated: Object.prototype.hasOwnProperty.call(req.body, "attributes_validated")
            ? req.body.attributes_validated
            : undefined,
          coachTagsValidated: Object.prototype.hasOwnProperty.call(req.body, "coach_tags_validated")
            ? req.body.coach_tags_validated
            : undefined,
          splitByGroupValidated: Object.prototype.hasOwnProperty.call(req.body, "split_by_group_validated")
            ? req.body.split_by_group_validated
            : undefined,
          ambiguousMatchRequired: Object.prototype.hasOwnProperty.call(req.body, "ambiguous_match_required")
            ? req.body.ambiguous_match_required
            : undefined,
          ambiguousMatchResolved: Object.prototype.hasOwnProperty.call(req.body, "ambiguous_match_resolved")
            ? req.body.ambiguous_match_resolved
            : undefined,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/:id/exceptions",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(exceptionCreateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createProductionProjectException(client, auth, String(req.params.id), {
          laneType: req.body.lane_type,
          exceptionType: req.body.exception_type,
          severity: req.body.severity,
          blocking: req.body.blocking,
          assigneeUserId: req.body.assignee_user_id ?? null,
          notes: req.body.notes ?? null,
          issueTag: req.body.issue_tag ?? null,
          followUpType: req.body.follow_up_type ?? null,
          followUpStatus: req.body.follow_up_status ?? null,
          followUpOwnerUserId: req.body.follow_up_owner_user_id ?? null,
          followUpNotes: req.body.follow_up_notes ?? null
        })
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/exceptions/:exceptionId",
  requireAuth,
  requireOperatingSystemModuleManage("production"),
  requireAction("schedule.manage"),
  validateBody(exceptionUpdateSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateProductionProjectException(client, auth, String(req.params.exceptionId), {
          status: req.body.status,
          blocking: req.body.blocking,
          assigneeUserId: Object.prototype.hasOwnProperty.call(req.body, "assignee_user_id") ? req.body.assignee_user_id : undefined,
          notes: Object.prototype.hasOwnProperty.call(req.body, "notes") ? req.body.notes : undefined,
          resolutionNotes: Object.prototype.hasOwnProperty.call(req.body, "resolution_notes") ? req.body.resolution_notes : undefined,
          issueTag: Object.prototype.hasOwnProperty.call(req.body, "issue_tag") ? req.body.issue_tag : undefined,
          followUpType: Object.prototype.hasOwnProperty.call(req.body, "follow_up_type") ? req.body.follow_up_type : undefined,
          followUpStatus: Object.prototype.hasOwnProperty.call(req.body, "follow_up_status") ? req.body.follow_up_status : undefined,
          followUpOwnerUserId: Object.prototype.hasOwnProperty.call(req.body, "follow_up_owner_user_id") ? req.body.follow_up_owner_user_id : undefined,
          followUpNotes: Object.prototype.hasOwnProperty.call(req.body, "follow_up_notes") ? req.body.follow_up_notes : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
