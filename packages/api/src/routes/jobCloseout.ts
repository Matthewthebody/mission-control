import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { featureFlags } from "../featureFlags.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  createShootCheckInRequests,
  generateOperationsReportSnapshot,
  getJobCloseoutRules,
  getJobCloseoutWorkspace,
  listEvaluationSearch,
  listMileageReviewQueue,
  listOperationsReportSnapshots,
  markMissedShootCheckIns,
  respondToShootCheckIn,
  submitJobCloseoutEvaluation,
  type JobCloseoutReportType
} from "../services/jobCloseoutV1.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

const uuidParamSchema = z.object({
  jobId: z.string().uuid()
});

const checkInParamSchema = uuidParamSchema.extend({
  checkInId: z.string().uuid()
});

const dataIssueSchema = z.enum([
  "missing_subjects",
  "qr_missing_or_would_not_scan",
  "qr_sorting_issue",
  "schedule_or_roster_issue",
  "other"
]);

const lateStaffSchema = z.object({
  user_id: z.string().uuid().nullable().optional(),
  display_name: z.string().trim().min(1).max(160),
  minutes_late: z.number().int().min(0).nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional()
});

const attachmentSchema = z
  .object({
    attachment_type: z.enum(["setup", "location", "issue", "other"]).optional(),
    storage_key: z.string().trim().max(2000).nullable().optional(),
    file_url: z.string().trim().max(4000).nullable().optional(),
    filename: z.string().trim().max(255).nullable().optional(),
    mime_type: z.string().trim().max(160).nullable().optional(),
    size_bytes: z.number().int().min(0).nullable().optional()
  })
  .refine((value) => Boolean(value.storage_key?.trim() || value.file_url?.trim()), {
    message: "Attachment needs a storage key or file URL."
  });

const evaluationBodySchema = z
  .object({
    submitter_role: z.enum(["senior_photographer", "shoot_lead", "associate", "leadership", "other"]).nullable().optional(),
    evaluation_type: z.enum(["post_shoot", "post_production"]).optional(),
    status: z.enum(["draft", "submitted"]).optional(),
    overall_status: z.enum(["smooth", "few_bumps", "rough"]),
    overall_score: z.number().int().min(1).max(5).nullable().optional(),
    schedule_status: z.enum(["on_schedule", "slight_delays", "major_delays"]).nullable().optional(),
    schedule_note: z.string().trim().max(2000).nullable().optional(),
    staffing_status: z.enum(["none", "minor", "major"]).nullable().optional(),
    staffing_note: z.string().trim().max(2000).nullable().optional(),
    all_photographers_on_time: z.boolean().nullable().optional(),
    late_note: z.string().trim().max(2000).nullable().optional(),
    image_confidence_score: z.number().int().min(1).max(5),
    technical_issue_status: z.enum(["none", "minor", "major"]).nullable().optional(),
    technical_issue_note: z.string().trim().max(2000).nullable().optional(),
    retake_risk: z.enum(["none", "possible", "likely"]).nullable().optional(),
    client_sentiment: z.enum(["very_happy", "fine", "frustrated"]).nullable().optional(),
    client_issue_flag: z.boolean().optional(),
    client_issue_note: z.string().trim().max(2000).nullable().optional(),
    data_issue_types: z.array(dataIssueSchema).max(8).optional(),
    data_issue_note: z.string().trim().max(2000).nullable().optional(),
    positive_shoutout_note: z.string().trim().max(2000).nullable().optional(),
    support_needed_note: z.string().trim().max(2000).nullable().optional(),
    next_year_improvement_note: z.string().trim().max(3000).nullable().optional(),
    mileage_qualified: z.boolean().nullable().optional(),
    mileage_note: z.string().trim().max(1200).nullable().optional(),
    mileage_disqualification_reason: z.enum(["company_vehicle", "carpool", "did_not_drive", "other"]).nullable().optional(),
    general_note: z.string().trim().max(3000).nullable().optional(),
    late_staff: z.array(lateStaffSchema).max(12).optional(),
    attachments: z.array(attachmentSchema).max(8).optional()
  })
  .strict();

const checkInResponseSchema = z
  .object({
    status: z.enum(["good", "issue"]),
    issue_note: z.string().trim().max(1000).nullable().optional()
  })
  .strict();

const reportQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    period_start: z.string().optional(),
    period_end: z.string().optional(),
    photographer_user_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
    organization_id: z.string().uuid().optional(),
    job_type: z.string().trim().max(120).optional(),
    issue_type: dataIssueSchema.optional(),
    flag_severity: z.string().trim().max(80).optional(),
    score: z.coerce.number().int().min(1).max(5).optional(),
    mileage_status: z.string().trim().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional()
  })
  .strict();

const reportTypeSchema = z.object({
  type: z.enum(["daily", "weekly"])
});

router.use(requireFeatureFlag(featureFlags.jobCloseoutV1, { message: "Job Closeout V1 is currently disabled." }));
router.use(requireAuth);

router.get("/config", (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  return res.json({
    tenant_id: auth.tenantId,
    rules: getJobCloseoutRules()
  });
});

router.get("/jobs/:jobId", validateParams(uuidParamSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const jobId = String(req.params.jobId);
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getJobCloseoutWorkspace(client, auth, jobId)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/jobs/:jobId/evaluations", validateParams(uuidParamSchema), validateBody(evaluationBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const jobId = String(req.params.jobId);
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      submitJobCloseoutEvaluation(client, auth, jobId, req.body)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/jobs/:jobId/check-ins", validateParams(uuidParamSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const jobId = String(req.params.jobId);
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createShootCheckInRequests(client, auth, jobId)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/jobs/:jobId/check-ins/:checkInId/respond",
  validateParams(checkInParamSchema),
  validateBody(checkInResponseSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const jobId = String(req.params.jobId);
      const checkInId = String(req.params.checkInId);
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        respondToShootCheckIn(client, auth, jobId, checkInId, req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/check-ins/sweep", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => markMissedShootCheckIns(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/evaluations", validateQuery(reportQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listEvaluationSearch(client, auth, req.query));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/mileage-review", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listMileageReviewQueue(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/reports/:type", validateParams(reportTypeSchema), validateQuery(reportQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listOperationsReportSnapshots(client, auth, req.params.type as JobCloseoutReportType, req.query.limit ? Number(req.query.limit) : 10)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/reports/:type/generate", validateParams(reportTypeSchema), validateQuery(reportQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      generateOperationsReportSnapshot(client, auth, req.params.type as JobCloseoutReportType, req.query)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
