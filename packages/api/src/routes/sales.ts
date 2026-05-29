import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  createSalesOpportunity,
  getSalesOpportunityDetail,
  getSalesPipelineBoard,
  listSalesOpportunities,
  listSalesPipelineOwners,
  sendSalesEmailCommunication,
  updateSalesOpportunity
} from "../services/salesPipeline.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const pipelineTypeSchema = z.enum(["schools", "sports"]);
const opportunityTypeSchema = z.enum(["new", "renewal", "expansion"]);
const stageSchema = z.enum([
  "lead",
  "contacted",
  "meeting_scheduled",
  "proposal_sent",
  "follow_up",
  "negotiation",
  "contract_sent",
  "won",
  "lost",
  "dormant"
]);
const statusSchema = z.enum(["active", "dormant", "won", "lost"]);
const dateStringSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const salesEmailTriggerSchema = z.enum(["manual", "automated"]);

router.use(requireAuth);

router.get(
  "/owners",
  requirePermission("sales_pipeline.view"),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const owners = await withClientTransaction(auth.tenantId, auth.id, (client) => listSalesPipelineOwners(client, auth));
      return res.json({ owners });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/board",
  requirePermission("sales_pipeline.view"),
  validateQuery(
    z.object({
      pipeline_type: pipelineTypeSchema.optional(),
      owner_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getSalesPipelineBoard(client, auth, {
          pipelineType: (req.query.pipeline_type as z.infer<typeof pipelineTypeSchema> | undefined) ?? null,
          ownerId: (req.query.owner_id as string | undefined) ?? null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/opportunities",
  requirePermission("sales_pipeline.view"),
  validateQuery(
    z.object({
      search: z.string().trim().max(120).optional(),
      pipeline_type: pipelineTypeSchema.optional(),
      stage: stageSchema.optional(),
      status: statusSchema.optional(),
      owner_id: z.string().uuid().optional(),
      resurfacing_only: z.coerce.boolean().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listSalesOpportunities(client, auth, {
          search: (req.query.search as string | undefined) ?? null,
          pipelineType: (req.query.pipeline_type as z.infer<typeof pipelineTypeSchema> | undefined) ?? null,
          stage: (req.query.stage as z.infer<typeof stageSchema> | undefined) ?? null,
          status: (req.query.status as z.infer<typeof statusSchema> | undefined) ?? null,
          ownerId: (req.query.owner_id as string | undefined) ?? null,
          resurfacingOnly: req.query.resurfacing_only === undefined ? false : Boolean(req.query.resurfacing_only)
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/opportunities/:opportunityId",
  requirePermission("sales_pipeline.view"),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getSalesOpportunityDetail(client, auth, String(req.params.opportunityId))
      );
      if (!payload) {
        return res.status(404).json({ error: "Sales opportunity not found" });
      }
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/opportunities",
  requirePermission("sales_pipeline.create"),
  validateBody(
    z.object({
      organization_id: z.string().uuid(),
      primary_contact_id: z.string().uuid().nullable().optional(),
      owner_id: z.string().uuid().nullable().optional(),
      opportunity_type: opportunityTypeSchema,
      pipeline_type: pipelineTypeSchema,
      stage: stageSchema.optional(),
      estimated_value: z.number().min(0).max(100000000).nullable().optional(),
      next_action_date: dateStringSchema.nullable().optional(),
      last_touch_date: dateStringSchema.optional().nullable(),
      last_verified_contact_date: dateStringSchema.optional().nullable(),
      notes: z.string().trim().max(4000).nullable().optional(),
      follow_up_date: dateStringSchema.optional().nullable()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createSalesOpportunity(
          client,
          auth,
          {
            organizationId: req.body.organization_id,
            primaryContactId: req.body.primary_contact_id ?? null,
            ownerId: req.body.owner_id ?? null,
            opportunityType: req.body.opportunity_type,
            pipelineType: req.body.pipeline_type,
            stage: req.body.stage,
            estimatedValue: req.body.estimated_value ?? null,
            nextActionDate: req.body.next_action_date ?? null,
            lastTouchDate: req.body.last_touch_date ?? null,
            lastVerifiedContactDate: req.body.last_verified_contact_date ?? null,
            notes: req.body.notes ?? null,
            followUpDate: req.body.follow_up_date ?? null
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

router.patch(
  "/opportunities/:opportunityId",
  requirePermission("sales_pipeline.edit"),
  validateBody(
    z.object({
      primary_contact_id: z.string().uuid().nullable().optional(),
      owner_id: z.string().uuid().nullable().optional(),
      opportunity_type: opportunityTypeSchema.optional(),
      pipeline_type: pipelineTypeSchema.optional(),
      stage: stageSchema.optional(),
      estimated_value: z.number().min(0).max(100000000).nullable().optional(),
      next_action_date: dateStringSchema.nullable().optional(),
      last_touch_date: dateStringSchema.optional().nullable(),
      last_verified_contact_date: dateStringSchema.optional().nullable(),
      notes: z.string().trim().max(4000).nullable().optional(),
      follow_up_date: dateStringSchema.optional().nullable()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateSalesOpportunity(
          client,
          auth,
          String(req.params.opportunityId),
          {
            primaryContactId: req.body.primary_contact_id,
            ownerId: req.body.owner_id,
            opportunityType: req.body.opportunity_type,
            pipelineType: req.body.pipeline_type,
            stage: req.body.stage,
            estimatedValue: req.body.estimated_value,
            nextActionDate: req.body.next_action_date,
            lastTouchDate: req.body.last_touch_date,
            lastVerifiedContactDate: req.body.last_verified_contact_date,
            notes: req.body.notes,
            followUpDate: req.body.follow_up_date
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

router.post(
  "/communications/send",
  requirePermission("sales_pipeline.edit"),
  validateBody(
    z.object({
      organization_id: z.string().uuid(),
      opportunity_id: z.string().uuid().nullable().optional(),
      contact_id: z.string().uuid().nullable().optional(),
      template_id: z.string().uuid(),
      subject: z.string().trim().max(300).nullable().optional(),
      body: z.string().trim().max(12000).nullable().optional(),
      trigger_type: salesEmailTriggerSchema.optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        sendSalesEmailCommunication(
          client,
          auth,
          {
            organizationId: req.body.organization_id,
            opportunityId: req.body.opportunity_id ?? null,
            contactId: req.body.contact_id ?? null,
            templateId: req.body.template_id,
            subject: req.body.subject ?? null,
            body: req.body.body ?? null,
            triggerType: req.body.trigger_type
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
