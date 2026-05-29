import { Router } from "express";
import { z } from "zod";
import { JOB_PRIORITY_LEVELS, WORK_DEPARTMENT_TYPES, WORK_TASK_STATUSES } from "../domain/jobTruth/index.js";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";
import { createWorkTask, getWorkTaskDetail, listWorkTasks, updateWorkTask } from "../services/jobTruth/index.js";

const router = Router();
const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();

const taskCreateObjectSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: nullableString(4000),
    task_type: nullableString(120),
    department_type: z.enum(WORK_DEPARTMENT_TYPES),
    job_id: nullableUuid,
    event_id: nullableUuid,
    workflow_run_id: nullableUuid,
    related_job_id: nullableUuid,
    assigned_to_user_id: nullableUuid,
    assigned_team_id: nullableString(160),
    status: z.enum(WORK_TASK_STATUSES).nullable().optional(),
    priority: z.enum(JOB_PRIORITY_LEVELS).nullable().optional(),
    due_at: nullableString(64),
    blocked_reason: nullableString(2000),
    proof_required: z.boolean().nullable().optional(),
    completion_notes: nullableString(2000)
  })
  .strict();

const taskCreateSchema = taskCreateObjectSchema.refine((value: { job_id?: string | null; related_job_id?: string | null }) => !value.job_id || !value.related_job_id || value.job_id === value.related_job_id, {
    message: "job_id and related_job_id must match when both are provided.",
    path: ["job_id"]
  });

const taskUpdateSchema = taskCreateObjectSchema
  .omit({ department_type: true, job_id: true, related_job_id: true, event_id: true, workflow_run_id: true })
  .partial()
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, "At least one task field must be updated.");

const taskListQuerySchema = z
  .object({
    department_type: z.enum(WORK_DEPARTMENT_TYPES).optional(),
    search: z.string().trim().max(160).optional(),
    assigned_to_user_id: z.string().uuid().optional(),
    job_id: z.string().uuid().optional(),
    related_job_id: z.string().uuid().optional(),
    status: z.enum(WORK_TASK_STATUSES).optional(),
    due_bucket: z.enum(["overdue", "today", "next_7_days"]).optional(),
    proof_required: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
  })
  .strict()
  .refine((value: { job_id?: string; related_job_id?: string }) => !value.job_id || !value.related_job_id || value.job_id === value.related_job_id, {
    message: "job_id and related_job_id must match when both are provided.",
    path: ["job_id"]
  });

router.get("/", requireAuth, validateQuery(taskListQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listWorkTasks(client, auth, req.query));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireAuth, validateBody(taskCreateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const meta = getRequestMeta(req);
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createWorkTask(client, auth, req.body, meta)
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/:taskId", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getWorkTaskDetail(client, auth, String(req.params.taskId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:taskId", requireAuth, validateBody(taskUpdateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const meta = getRequestMeta(req);
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateWorkTask(client, auth, String(req.params.taskId), req.body, meta)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
