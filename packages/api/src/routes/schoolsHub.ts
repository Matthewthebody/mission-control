import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireSchoolsHubManageAccess, requireSchoolsHubReadAccess } from "../middleware/schoolsHubAccess.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  bulkUpdateSchoolWorkItems,
  convertSchoolWorkItemToDeliverable,
  createSchoolJob,
  createSchoolWorkItem,
  getSchoolWorkItemDetail,
  listSchoolsHubReferenceData,
  listSchoolsHubWorkspace,
  updateSchoolWorkItem
} from "../services/schoolsHub.js";
import {
  queueSchoolsHubAutomationRun,
  queueSchoolsHubDeliverableTrigger,
  queueSchoolsHubUploadTrigger,
  queueSchoolsHubYearbookTrigger
} from "../services/schoolsHubAutomation.js";
import { importMondaySchoolSnapshot, reimportMondaySchoolEntity } from "../services/schoolsHubMonday.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const dateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuidSchema = z.string().uuid();
const optimisticTimestampSchema = z.string().trim().min(10).max(80);

const schoolJobTypeSchema = z.enum([
  "fall_portraits",
  "retakes",
  "spring_portraits",
  "sports",
  "graduation",
  "yearbook",
  "ids",
  "admin_fulfillment",
  "delivery",
  "other"
]);

const schoolJobStatusSchema = z.enum(["planned", "active", "waiting", "on_hold", "completed", "cancelled"]);
const schoolWorkTypeSchema = z.enum([
  "pre_shoot_coordination",
  "gallery_release",
  "id_production",
  "admin_item",
  "yearbook",
  "graduation",
  "delivery",
  "invoicing",
  "follow_up",
  "exception_handling"
]);
const schoolWorkStatusSchema = z.enum(["open", "in_progress", "waiting", "blocked", "completed", "cancelled"]);
const schoolWorkStageSchema = z.enum([
  "intake",
  "planning",
  "active",
  "waiting_on_school",
  "waiting_on_internal",
  "ready_for_delivery",
  "done"
]);
const schoolWorkPrioritySchema = z.enum(["low", "normal", "high", "critical"]);
const schoolWorkWaitingOnSchema = z.enum([
  "none",
  "school",
  "internal_production",
  "internal_ops",
  "shipping_vendor",
  "billing",
  "other"
]);
const schoolWorkSourceSystemSchema = z.enum(["mission_control", "monday", "manual_import", "zendesk", "outlook", "other"]);
const mondayImportModeSchema = z.enum(["job", "work_item", "job_and_work_item"]);
const uploadTriggerTypeSchema = z.enum(["id_upload_received", "gallery_deadline_set", "final_retake_upload_completed"]);
const yearbookTriggerTypeSchema = z.enum(["yearbook_request_received", "yearbook_review_requested"]);
const deliverableTriggerTypeSchema = z.enum(["yearbooks_arrived", "admin_items_arrived", "other_deliverable_arrived"]);

const listWorkspaceQuerySchema = z.object({
  anchor_date: dateStringSchema.optional(),
  search: z.string().trim().max(120).optional(),
  owner_user_id: uuidSchema.optional(),
  school_id: uuidSchema.optional(),
  job_id: uuidSchema.optional(),
  work_type: schoolWorkTypeSchema.optional(),
  priority: schoolWorkPrioritySchema.optional(),
  waiting_on: schoolWorkWaitingOnSchema.optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
  page_size: z.coerce.number().int().min(10).max(100).optional()
});

const createSchoolJobSchema = z.object({
  organization_id: uuidSchema,
  linked_shoot_id: uuidSchema.optional().nullable(),
  linked_location_id: uuidSchema.optional().nullable(),
  job_type: schoolJobTypeSchema,
  title: z.string().trim().min(1).max(180),
  event_date: dateStringSchema.optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
  owner_user_id: uuidSchema.optional().nullable(),
  status: schoolJobStatusSchema.optional(),
  notes: z.string().trim().max(4000).optional().nullable()
});

const createSchoolWorkItemSchema = z.object({
  organization_id: uuidSchema,
  school_job_id: uuidSchema.optional().nullable(),
  linked_shoot_id: uuidSchema.optional().nullable(),
  linked_location_id: uuidSchema.optional().nullable(),
  linked_contact_id: uuidSchema.optional().nullable(),
  linked_follow_up_id: uuidSchema.optional().nullable(),
  linked_production_project_id: uuidSchema.optional().nullable(),
  work_type: schoolWorkTypeSchema,
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4000).optional().nullable(),
  owner_user_id: uuidSchema.optional().nullable(),
  status: schoolWorkStatusSchema.optional(),
  stage: schoolWorkStageSchema.optional(),
  priority: schoolWorkPrioritySchema.optional(),
  due_date: dateStringSchema.optional().nullable(),
  sla_date: dateStringSchema.optional().nullable(),
  blocker_reason: z.string().trim().max(500).optional().nullable(),
  waiting_on: schoolWorkWaitingOnSchema.optional(),
  notes: z.string().trim().max(4000).optional().nullable()
});

const updateSchoolWorkItemSchema = z
  .object({
    school_job_id: uuidSchema.optional().nullable(),
    linked_shoot_id: uuidSchema.optional().nullable(),
    linked_location_id: uuidSchema.optional().nullable(),
    linked_contact_id: uuidSchema.optional().nullable(),
    linked_follow_up_id: uuidSchema.optional().nullable(),
    linked_production_project_id: uuidSchema.optional().nullable(),
    title: z.string().trim().min(1).max(180).optional().nullable(),
    description: z.string().trim().max(4000).optional().nullable(),
    owner_user_id: uuidSchema.optional().nullable(),
    status: schoolWorkStatusSchema.optional().nullable(),
    stage: schoolWorkStageSchema.optional().nullable(),
    priority: schoolWorkPrioritySchema.optional().nullable(),
    due_date: dateStringSchema.optional().nullable(),
    sla_date: dateStringSchema.optional().nullable(),
    blocker_reason: z.string().trim().max(500).optional().nullable(),
    waiting_on: schoolWorkWaitingOnSchema.optional().nullable(),
    expected_updated_at: optimisticTimestampSchema.optional().nullable(),
    notes: z.string().trim().max(4000).optional().nullable()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Provide at least one work-item field to update");

const convertToDeliverableSchema = z.object({
  deliverable_type: z.enum(["gallery", "ids", "yearbook", "graduation", "admin_items", "shipment", "other"]).optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
  delivery_method: z.enum(["pickup", "mail", "courier", "digital", "field_drop", "other"]).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable()
});

const bulkUpdateSchoolWorkItemsSchema = z
  .object({
    ids: z.array(uuidSchema).min(1).max(100),
    owner_user_id: uuidSchema.optional().nullable(),
    status: schoolWorkStatusSchema.optional().nullable(),
    stage: schoolWorkStageSchema.optional().nullable(),
    priority: schoolWorkPrioritySchema.optional().nullable(),
    due_date: dateStringSchema.optional().nullable(),
    blocker_reason: z.string().trim().max(500).optional().nullable(),
    waiting_on: schoolWorkWaitingOnSchema.optional().nullable()
  })
  .refine(
    (value) =>
      value.owner_user_id !== undefined ||
      value.status !== undefined ||
      value.stage !== undefined ||
      value.priority !== undefined ||
      value.due_date !== undefined ||
      value.blocker_reason !== undefined ||
      value.waiting_on !== undefined,
    "Choose at least one bulk update value"
  );

const queueUploadAutomationTriggerSchema = z.object({
  organization_id: uuidSchema,
  school_job_id: uuidSchema.optional().nullable(),
  linked_shoot_id: uuidSchema.optional().nullable(),
  linked_location_id: uuidSchema.optional().nullable(),
  linked_production_project_id: uuidSchema.optional().nullable(),
  trigger_type: uploadTriggerTypeSchema,
  deadline_date: dateStringSchema.optional().nullable(),
  source_system: schoolWorkSourceSystemSchema.optional(),
  source_reference: z.string().trim().max(240).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable()
});

const queueYearbookAutomationTriggerSchema = z.object({
  organization_id: uuidSchema,
  school_job_id: uuidSchema.optional().nullable(),
  linked_shoot_id: uuidSchema.optional().nullable(),
  linked_location_id: uuidSchema.optional().nullable(),
  request_type: yearbookTriggerTypeSchema,
  deadline_date: dateStringSchema.optional().nullable(),
  source_system: schoolWorkSourceSystemSchema.optional(),
  source_reference: z.string().trim().max(240).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable()
});

const queueDeliverableAutomationTriggerSchema = z.object({
  organization_id: uuidSchema,
  school_job_id: uuidSchema.optional().nullable(),
  linked_shoot_id: uuidSchema.optional().nullable(),
  linked_location_id: uuidSchema.optional().nullable(),
  deliverable_type: deliverableTriggerTypeSchema,
  arrived_on: dateStringSchema.optional().nullable(),
  ready_date: dateStringSchema.optional().nullable(),
  source_system: schoolWorkSourceSystemSchema.optional(),
  source_reference: z.string().trim().max(240).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable()
});

const mondaySchoolJobImportSchema = z.object({
  job_type: schoolJobTypeSchema,
  title: z.string().trim().min(1).max(180),
  event_date: dateStringSchema.optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
  owner_user_id: uuidSchema.optional().nullable(),
  status: schoolJobStatusSchema.optional(),
  notes: z.string().trim().max(4000).optional().nullable()
});

const mondaySchoolWorkItemImportSchema = z.object({
  work_type: schoolWorkTypeSchema,
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4000).optional().nullable(),
  owner_user_id: uuidSchema.optional().nullable(),
  status: schoolWorkStatusSchema.optional(),
  stage: schoolWorkStageSchema.optional().nullable(),
  priority: schoolWorkPrioritySchema.optional(),
  due_date: dateStringSchema.optional().nullable(),
  sla_date: dateStringSchema.optional().nullable(),
  blocker_reason: z.string().trim().max(500).optional().nullable(),
  waiting_on: schoolWorkWaitingOnSchema.optional(),
  generated_by_rule: z.boolean().optional(),
  notes: z.string().trim().max(4000).optional().nullable()
});

const mondayImportSchema = z
  .object({
    organization_id: uuidSchema,
    import_mode: mondayImportModeSchema,
    external_record_id: z.string().trim().min(1).max(120),
    external_record_name: z.string().trim().min(1).max(180),
    external_board_id: z.string().trim().max(120).optional().nullable(),
    external_board_name: z.string().trim().max(180).optional().nullable(),
    external_group_id: z.string().trim().max(120).optional().nullable(),
    external_group_title: z.string().trim().max(180).optional().nullable(),
    external_record_url: z.string().trim().url().max(500).optional().nullable(),
    linked_shoot_id: uuidSchema.optional().nullable(),
    linked_location_id: uuidSchema.optional().nullable(),
    linked_contact_id: uuidSchema.optional().nullable(),
    linked_production_project_id: uuidSchema.optional().nullable(),
    existing_school_job_id: uuidSchema.optional().nullable(),
    raw_snapshot: z.record(z.string(), z.unknown()).optional().nullable(),
    mapped_job: mondaySchoolJobImportSchema.optional().nullable(),
    mapped_work_item: mondaySchoolWorkItemImportSchema.optional().nullable()
  })
  .superRefine((value, context) => {
    if (value.import_mode !== "work_item" && !value.mapped_job) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mapped_job"],
        message: "Job imports need mapped school-job metadata."
      });
    }
    if (value.import_mode !== "job" && !value.mapped_work_item) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mapped_work_item"],
        message: "Work-item imports need mapped school work metadata."
      });
    }
  });

const mondayReimportParamsSchema = z.object({
  entityType: z.enum(["school_job", "school_work_item"]),
  id: uuidSchema
});

router.get("/", requireSchoolsHubReadAccess, validateQuery(listWorkspaceQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const query = req.query as z.infer<typeof listWorkspaceQuerySchema>;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listSchoolsHubWorkspace(client, auth, {
        anchor_date: query.anchor_date,
        search: query.search,
        owner_user_id: query.owner_user_id,
        school_id: query.school_id,
        job_id: query.job_id,
        work_type: query.work_type,
        priority: query.priority,
        waiting_on: query.waiting_on,
        page: query.page,
        page_size: query.page_size
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/reference-data", requireSchoolsHubReadAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listSchoolsHubReferenceData(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/automation/run", requireSchoolsHubManageAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      queueSchoolsHubAutomationRun(client, auth, getRequestMeta(req))
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/automation/triggers/upload",
  requireSchoolsHubManageAccess,
  validateBody(queueUploadAutomationTriggerSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueSchoolsHubUploadTrigger(
          client,
          auth,
          {
            organization_id: req.body.organization_id,
            school_job_id: req.body.school_job_id ?? null,
            linked_shoot_id: req.body.linked_shoot_id ?? null,
            linked_location_id: req.body.linked_location_id ?? null,
            linked_production_project_id: req.body.linked_production_project_id ?? null,
            trigger_type: req.body.trigger_type,
            deadline_date: req.body.deadline_date ?? null,
            source_system: req.body.source_system,
            source_reference: req.body.source_reference ?? null,
            note: req.body.note ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/automation/triggers/yearbook",
  requireSchoolsHubManageAccess,
  validateBody(queueYearbookAutomationTriggerSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueSchoolsHubYearbookTrigger(
          client,
          auth,
          {
            organization_id: req.body.organization_id,
            school_job_id: req.body.school_job_id ?? null,
            linked_shoot_id: req.body.linked_shoot_id ?? null,
            linked_location_id: req.body.linked_location_id ?? null,
            request_type: req.body.request_type,
            deadline_date: req.body.deadline_date ?? null,
            source_system: req.body.source_system,
            source_reference: req.body.source_reference ?? null,
            note: req.body.note ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/automation/triggers/deliverable",
  requireSchoolsHubManageAccess,
  validateBody(queueDeliverableAutomationTriggerSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        queueSchoolsHubDeliverableTrigger(
          client,
          auth,
          {
            organization_id: req.body.organization_id,
            school_job_id: req.body.school_job_id ?? null,
            linked_shoot_id: req.body.linked_shoot_id ?? null,
            linked_location_id: req.body.linked_location_id ?? null,
            deliverable_type: req.body.deliverable_type,
            arrived_on: req.body.arrived_on ?? null,
            ready_date: req.body.ready_date ?? null,
            source_system: req.body.source_system,
            source_reference: req.body.source_reference ?? null,
            note: req.body.note ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/jobs", requireSchoolsHubManageAccess, validateBody(createSchoolJobSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createSchoolJob(
        client,
        auth,
        {
          organization_id: req.body.organization_id,
          linked_shoot_id: req.body.linked_shoot_id ?? null,
          linked_location_id: req.body.linked_location_id ?? null,
          job_type: req.body.job_type,
          title: req.body.title,
          event_date: req.body.event_date ?? null,
          due_date: req.body.due_date ?? null,
          owner_user_id: req.body.owner_user_id ?? null,
          status: req.body.status,
          notes: req.body.notes ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/monday/import", requireSchoolsHubManageAccess, validateBody(mondayImportSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      importMondaySchoolSnapshot(
        client,
        auth,
        {
          organization_id: req.body.organization_id,
          import_mode: req.body.import_mode,
          external_record_id: req.body.external_record_id,
          external_record_name: req.body.external_record_name,
          external_board_id: req.body.external_board_id ?? null,
          external_board_name: req.body.external_board_name ?? null,
          external_group_id: req.body.external_group_id ?? null,
          external_group_title: req.body.external_group_title ?? null,
          external_record_url: req.body.external_record_url ?? null,
          linked_shoot_id: req.body.linked_shoot_id ?? null,
          linked_location_id: req.body.linked_location_id ?? null,
          linked_contact_id: req.body.linked_contact_id ?? null,
          linked_production_project_id: req.body.linked_production_project_id ?? null,
          existing_school_job_id: req.body.existing_school_job_id ?? null,
          raw_snapshot: req.body.raw_snapshot ?? null,
          mapped_job: req.body.mapped_job ?? null,
          mapped_work_item: req.body.mapped_work_item ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/monday/reimport/:entityType/:id",
  requireSchoolsHubManageAccess,
  async (req, res, next) => {
    try {
      const parsed = mondayReimportParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: parsed.error.flatten()
        });
      }
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reimportMondaySchoolEntity(client, auth, parsed.data.entityType, parsed.data.id, getRequestMeta(req))
      );
      return res.status(202).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/work-items", requireSchoolsHubManageAccess, validateBody(createSchoolWorkItemSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createSchoolWorkItem(
        client,
        auth,
        {
          organization_id: req.body.organization_id,
          school_job_id: req.body.school_job_id ?? null,
          linked_shoot_id: req.body.linked_shoot_id ?? null,
          linked_location_id: req.body.linked_location_id ?? null,
          linked_contact_id: req.body.linked_contact_id ?? null,
          linked_follow_up_id: req.body.linked_follow_up_id ?? null,
          linked_production_project_id: req.body.linked_production_project_id ?? null,
          work_type: req.body.work_type,
          title: req.body.title,
          description: req.body.description ?? null,
          owner_user_id: req.body.owner_user_id ?? null,
          status: req.body.status,
          stage: req.body.stage,
          priority: req.body.priority,
          due_date: req.body.due_date ?? null,
          sla_date: req.body.sla_date ?? null,
          blocker_reason: req.body.blocker_reason ?? null,
          waiting_on: req.body.waiting_on,
          notes: req.body.notes ?? null
        },
        getRequestMeta(req)
      )
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/work-items/:id", requireSchoolsHubManageAccess, validateBody(updateSchoolWorkItemSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateSchoolWorkItem(
        client,
        auth,
        String(req.params.id),
        {
          school_job_id: req.body.school_job_id !== undefined ? req.body.school_job_id : undefined,
          linked_shoot_id: req.body.linked_shoot_id !== undefined ? req.body.linked_shoot_id : undefined,
          linked_location_id: req.body.linked_location_id !== undefined ? req.body.linked_location_id : undefined,
          linked_contact_id: req.body.linked_contact_id !== undefined ? req.body.linked_contact_id : undefined,
          linked_follow_up_id: req.body.linked_follow_up_id !== undefined ? req.body.linked_follow_up_id : undefined,
          linked_production_project_id:
            req.body.linked_production_project_id !== undefined ? req.body.linked_production_project_id : undefined,
          title: req.body.title !== undefined ? req.body.title : undefined,
          description: req.body.description !== undefined ? req.body.description : undefined,
          owner_user_id: req.body.owner_user_id !== undefined ? req.body.owner_user_id : undefined,
          status: req.body.status !== undefined ? req.body.status : undefined,
          stage: req.body.stage !== undefined ? req.body.stage : undefined,
          priority: req.body.priority !== undefined ? req.body.priority : undefined,
          due_date: req.body.due_date !== undefined ? req.body.due_date : undefined,
          sla_date: req.body.sla_date !== undefined ? req.body.sla_date : undefined,
          blocker_reason: req.body.blocker_reason !== undefined ? req.body.blocker_reason : undefined,
          waiting_on: req.body.waiting_on !== undefined ? req.body.waiting_on : undefined,
          expected_updated_at: req.body.expected_updated_at !== undefined ? req.body.expected_updated_at : undefined,
          notes: req.body.notes !== undefined ? req.body.notes : undefined
        },
        getRequestMeta(req)
      )
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/work-items/bulk",
  requireSchoolsHubManageAccess,
  validateBody(bulkUpdateSchoolWorkItemsSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        bulkUpdateSchoolWorkItems(
          client,
          auth,
          {
            ids: req.body.ids,
            owner_user_id: req.body.owner_user_id !== undefined ? req.body.owner_user_id : undefined,
            status: req.body.status !== undefined ? req.body.status : undefined,
            stage: req.body.stage !== undefined ? req.body.stage : undefined,
            priority: req.body.priority !== undefined ? req.body.priority : undefined,
            due_date: req.body.due_date !== undefined ? req.body.due_date : undefined,
            blocker_reason: req.body.blocker_reason !== undefined ? req.body.blocker_reason : undefined,
            waiting_on: req.body.waiting_on !== undefined ? req.body.waiting_on : undefined
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/work-items/:id/detail", requireSchoolsHubReadAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getSchoolWorkItemDetail(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/work-items/:id/convert-to-deliverable",
  requireSchoolsHubManageAccess,
  validateBody(convertToDeliverableSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        convertSchoolWorkItemToDeliverable(
          client,
          auth,
          {
            school_work_item_id: String(req.params.id),
            deliverable_type: req.body.deliverable_type ?? null,
            due_date: req.body.due_date ?? null,
            delivery_method: req.body.delivery_method ?? null,
            notes: req.body.notes ?? null
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

export default router;
