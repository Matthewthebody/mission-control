import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  acknowledgeEmployeeEventNotes,
  acknowledgeEmployeeShiftNotes,
  getEmployeeEventDetail,
  getEmployeeShiftDetail,
  listEmployeeMyWork
} from "../services/employeeExperience.js";
import { submitEmployeeFieldForm } from "../services/employeeFieldForms.js";
import { submitPostShootEvaluationForShift } from "../services/postShootEvaluations.js";
import { applyCompatibilityAliasHeaders } from "../utils/compatibilityAlias.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const fieldFormSubmissionSchema = z.discriminatedUnion("form_type", [
  z.object({
    form_type: z.literal("field_issue_report"),
    issue_category: z.enum([
      "staffing",
      "attendance_no_show",
      "setup_room_problem",
      "parking_load_in",
      "school_readiness",
      "data_roster",
      "equipment_technical",
      "lighting_environment",
      "line_flow_traffic",
      "student_parent_flow",
      "communication_contact_issue",
      "special_product_deliverable_issue",
      "other"
    ]),
    severity: z.enum(["minor", "major", "immediate_help_needed"]),
    summary: z.string().trim().min(1).max(500),
    note: z.string().trim().max(1000).nullable().optional(),
    follow_up_needed: z.boolean().optional(),
    attachment_refs: z.array(z.unknown()).max(10).optional()
  }),
  z.object({
    form_type: z.literal("location_memory_suggestion"),
    memory_type: z.enum([
      "parking_load_in",
      "entrance_check_in",
      "setup_guidance",
      "staffing_recommendation",
      "day_of_coordination",
      "top_watch_out"
    ]),
    summary: z.string().trim().min(1).max(500),
    why_it_matters: z.string().trim().max(1000).nullable().optional(),
    useful_for_future_crews: z.boolean().optional(),
    attachment_refs: z.array(z.unknown()).max(10).optional()
  }),
  z.object({
    form_type: z.literal("directory_update_suggestion"),
    update_type: z.enum([
      "contact_info_changed",
      "title_changed",
      "new_contact",
      "wrong_contact",
      "owner_change_suggestion"
    ]),
    subject_name: z.string().trim().max(240).nullable().optional(),
    summary: z.string().trim().min(1).max(500),
    suggested_change: z.string().trim().max(1000).nullable().optional(),
    attachment_refs: z.array(z.unknown()).max(10).optional()
  }),
  z.object({
    form_type: z.literal("staffing_help_request"),
    issue_type: z.enum(["running_late", "cannot_cover", "need_replacement", "team_member_missing", "coverage_at_risk"]),
    severity: z.enum(["minor", "major", "immediate_help_needed"]),
    summary: z.string().trim().min(1).max(500),
    requested_partner_user_id: z.string().uuid().nullable().optional(),
    attachment_refs: z.array(z.unknown()).max(10).optional()
  })
]);

router.use(requireAuth);

router.get(
  "/my-work",
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
        listEmployeeMyWork(client, auth, req.query.anchor_date ? String(req.query.anchor_date) : undefined)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/shifts/:id", requireAction("schedule.read"), async (req, res, next) => {
  try {
    applyCompatibilityAliasHeaders(res, {
      aliasRoute: "/api/employee/shifts/:id",
      canonicalRoute: "/api/employee/events/:id"
    });
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getEmployeeShiftDetail(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/events/:id", requireAction("schedule.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getEmployeeEventDetail(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/shifts/:id/post-shoot-evaluation",
  requireAction("schedule.read"),
  validateBody(
    z.object({
      eval_status: z.enum(["draft", "submitted"]).optional(),
      overall_outcome: z.enum(["smooth", "minor_issues", "major_issues", "needs_leadership_review"]).optional().nullable(),
      overall_shoot_status: z.enum(["successful", "completed_with_issues", "significant_issue"]).optional().nullable(),
      staffing_fit: z.enum(["understaffed", "right_sized", "overstaffed"]).optional().nullable(),
      setup_difficulty: z.enum(["low", "medium", "high"]).optional().nullable(),
      customer_school_readiness: z.enum(["ready", "minor_friction", "major_friction"]).optional().nullable(),
      data_roster_readiness: z.enum(["ready", "minor_friction", "major_friction"]).optional().nullable(),
      equipment_workflow_issue: z.enum(["none", "minor", "major"]).optional().nullable(),
      started_on_time: z.boolean().optional().nullable(),
      short_summary_note: z.string().trim().max(1000).optional().nullable(),
      next_time_recommendation: z.string().trim().max(1000).optional().nullable(),
      follow_up_required: z.boolean().optional(),
      major_issue_flag: z.boolean().optional(),
      location_memory_update_suggested: z.boolean().optional(),
      leadership_review_needed: z.boolean().optional(),
      issue_category: z
        .enum([
          "staffing",
          "attendance_no_show",
          "setup_room_problem",
          "parking_load_in",
          "school_readiness",
          "data_roster",
          "equipment_technical",
          "lighting_environment",
          "line_flow_traffic",
          "student_parent_flow",
          "communication_contact_issue",
          "special_product_deliverable_issue",
          "other"
        ])
        .optional()
        .nullable(),
      understaffed_role: z.string().trim().max(200).optional().nullable(),
      staffing_change_recommendation: z.string().trim().max(1000).optional().nullable(),
      customer_follow_up_needed: z.boolean().optional(),
      follow_up_owner_user_id: z.string().uuid().optional().nullable(),
      recommended_staffing_next_time: z.number().int().min(0).max(99).optional().nullable(),
      recommended_arrival_buffer_minutes: z.number().int().min(0).max(240).optional().nullable(),
      recommended_room_setup_change: z.string().trim().max(1000).optional().nullable(),
      special_gear_needed_next_time: z.string().trim().max(1000).optional().nullable(),
      top_watch_out: z.string().trim().max(500).optional().nullable(),
      location_memory_promotion_text: z.string().trim().max(1000).optional().nullable(),
      went_well: z.string().trim().max(1000).optional().nullable(),
      remember_next_time: z.string().trim().max(1000).optional().nullable(),
      issue_flag: z.boolean().optional(),
      open_comment: z.string().trim().max(2000).optional().nullable(),
      submit_for_mileage: z.boolean().optional(),
      vehicle_type: z.enum(["personal_vehicle", "carpool_passenger", "company_vehicle", "other_needs_review"]).optional().nullable()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitPostShootEvaluationForShift(
          client,
          auth,
          String(req.params.id),
          {
            eval_status: req.body.eval_status ?? "submitted",
            overall_outcome: req.body.overall_outcome ?? null,
            overall_shoot_status: req.body.overall_shoot_status ?? null,
            staffing_fit: req.body.staffing_fit ?? null,
            setup_difficulty: req.body.setup_difficulty ?? null,
            customer_school_readiness: req.body.customer_school_readiness ?? null,
            data_roster_readiness: req.body.data_roster_readiness ?? null,
            equipment_workflow_issue: req.body.equipment_workflow_issue ?? null,
            started_on_time: req.body.started_on_time ?? null,
            short_summary_note: req.body.short_summary_note ?? null,
            next_time_recommendation: req.body.next_time_recommendation ?? null,
            follow_up_required: req.body.follow_up_required ?? false,
            major_issue_flag: req.body.major_issue_flag ?? false,
            location_memory_update_suggested: req.body.location_memory_update_suggested ?? false,
            leadership_review_needed: req.body.leadership_review_needed ?? false,
            issue_category: req.body.issue_category ?? null,
            understaffed_role: req.body.understaffed_role ?? null,
            staffing_change_recommendation: req.body.staffing_change_recommendation ?? null,
            customer_follow_up_needed: req.body.customer_follow_up_needed ?? false,
            follow_up_owner_user_id: req.body.follow_up_owner_user_id ?? null,
            recommended_staffing_next_time: req.body.recommended_staffing_next_time ?? null,
            recommended_arrival_buffer_minutes: req.body.recommended_arrival_buffer_minutes ?? null,
            recommended_room_setup_change: req.body.recommended_room_setup_change ?? null,
            special_gear_needed_next_time: req.body.special_gear_needed_next_time ?? null,
            top_watch_out: req.body.top_watch_out ?? null,
            location_memory_promotion_text: req.body.location_memory_promotion_text ?? null,
            went_well: req.body.went_well ?? null,
            remember_next_time: req.body.remember_next_time ?? null,
            issue_flag: req.body.issue_flag ?? false,
            open_comment: req.body.open_comment ?? null,
            submit_for_mileage: req.body.submit_for_mileage ?? false,
            vehicle_type: req.body.vehicle_type ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/shifts/:id/acknowledge", requireAction("schedule.read"), async (req, res, next) => {
  try {
    applyCompatibilityAliasHeaders(res, {
      aliasRoute: "/api/employee/shifts/:id/acknowledge",
      canonicalRoute: "/api/employee/events/:id/acknowledge"
    });
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      acknowledgeEmployeeShiftNotes(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/events/:id/acknowledge", requireAction("schedule.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      acknowledgeEmployeeEventNotes(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/shifts/:id/form-submissions",
  requireAction("schedule.read"),
  validateBody(fieldFormSubmissionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitEmployeeFieldForm(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
