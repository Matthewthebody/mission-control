import { Router } from "express";
import { z } from "zod";
import {
  CENTRAL_JOB_DEPARTMENTS,
  CENTRAL_JOB_DELIVERY_TYPES,
  CENTRAL_JOB_PRIORITIES,
  CENTRAL_JOB_PRODUCTION_GROUPING_RULES,
  CENTRAL_JOB_REQUEST_SOURCES
} from "../domain/centralJobIntake/index.js";
import { withClientTransaction } from "../db/tx.js";
import { ApiError } from "../errors/apiError.js";
import { featureFlags } from "../featureFlags.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  createDraftJob,
  getIntakeJob,
  getDraftJob,
  listDraftJobs,
  publishDraftJob,
  previewDraftDuplicates,
  refreshDraftReadiness,
  resolveOrganizationDefaults,
  updatePublishedJob,
  updateDraftJob
} from "../services/centralJobIntake.js";
import { parseJobIntakeText } from "../services/centralJobIntakeSmartPaste.js";
import {
  commitCentralJobImportSession as commitImportSession,
  createCentralJobImportSession as createImportSession,
  getCentralJobImportSession as getImportSession,
  updateCentralJobImportMapping as updateImportMapping
} from "../services/centralJobIntakeImports.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();
const CENTRAL_JOB_IMPORT_COMMIT_MODES = [
  "create_drafts_only",
  "publish_valid_rows_leave_exceptions",
  "publish_all_valid_rows_with_acknowledgement"
] as const;
const CENTRAL_JOB_IMPORT_FIELD_KEYS = [
  "job_type",
  "job_title",
  "source_reference",
  "organization_name",
  "location_name",
  "primary_contact_name",
  "job_owner",
  "account_owner",
  "start_date",
  "start_time",
  "end_time",
  "timezone",
  "date_only",
  "is_multi_day",
  "delivery_due_date",
  "production_required",
  "staffing_required",
  "staffing_estimate",
  "priority",
  "delivery_type",
  "production_grouping_rule",
  "internal_notes",
  "client_notes",
  "special_instructions",
  "school_job_type",
  "school_type",
  "roster_status",
  "roster_due_date",
  "id_required",
  "id_sort_method",
  "yearbook_required",
  "yearbook_due_date",
  "background_requirements",
  "school_day_notes",
  "building_instructions",
  "photo_day_special_notes",
  "sports_job_type",
  "sport_name",
  "season",
  "level_or_age_group",
  "specialty_products_required",
  "specialty_product_types",
  "gallery_required",
  "delivery_deadline_type",
  "uniform_notes",
  "sponsor_notes",
  "event_notes",
  "on_site_sales_notes"
] as const;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuidSchema = z.string().uuid();
const nullableUuidSchema = z.string().uuid().nullable().optional();
const nullableString = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableCountSchema = z.number().int().nonnegative().nullable().optional();

const departmentSchema = z.enum(CENTRAL_JOB_DEPARTMENTS);
const requestSourceSchema = z.enum(CENTRAL_JOB_REQUEST_SOURCES);
const prioritySchema = z.enum(CENTRAL_JOB_PRIORITIES);
const deliveryTypeSchema = z.enum(CENTRAL_JOB_DELIVERY_TYPES);
const productionGroupingRuleSchema = z.enum(CENTRAL_JOB_PRODUCTION_GROUPING_RULES);
const jobTypeSchema = z.enum([
  "schools_underclass_portraits",
  "schools_events",
  "sports",
  "events",
  "studio",
  "headshots",
  "commercial",
  "internal"
]);

const schoolDetailSchema = z
  .object({
    school_job_type: nullableString(120),
    school_type: nullableString(120),
    student_count_estimate: nullableCountSchema,
    staff_count_estimate: nullableCountSchema,
    grade_range: nullableString(120),
    camera_count_estimate: nullableCountSchema,
    roster_status: nullableString(120),
    roster_due_date: isoDateSchema.nullable().optional(),
    id_required: z.boolean().nullable().optional(),
    id_sort_method: nullableString(120),
    yearbook_required: z.boolean().nullable().optional(),
    yearbook_due_date: isoDateSchema.nullable().optional(),
    staff_packages_required: z.boolean().nullable().optional(),
    parent_communication_needed: z.boolean().nullable().optional(),
    background_requirements: nullableString(2000),
    school_day_notes: nullableString(2000),
    building_instructions: nullableString(2000),
    photo_day_special_notes: nullableString(2000)
  })
  .strict();

const sportsDetailSchema = z
  .object({
    sports_job_type: nullableString(120),
    sport_name: nullableString(120),
    season: nullableString(120),
    level_or_age_group: nullableString(120),
    team_count_estimate: nullableCountSchema,
    athlete_count_estimate: nullableCountSchema,
    coach_count_estimate: nullableCountSchema,
    coach_contact_id: nullableUuidSchema,
    alternate_team_contact_id: nullableUuidSchema,
    specialty_products_required: z.boolean().nullable().optional(),
    specialty_product_types: z.array(z.string().trim().min(1).max(120)).max(20).nullable().optional(),
    gallery_required: z.boolean().nullable().optional(),
    delivery_deadline_type: nullableString(120),
    uniform_notes: nullableString(2000),
    sponsor_notes: nullableString(2000),
    event_notes: nullableString(2000),
    on_site_sales_notes: nullableString(2000)
  })
  .strict();

const jobDaySchema = z
  .object({
    day_index: z.number().int().nonnegative().nullable().optional(),
    shoot_date: isoDateSchema.nullable().optional(),
    start_time: nullableString(32),
    end_time: nullableString(32),
    timezone: nullableString(120),
    location_id: nullableUuidSchema,
    date_only: z.boolean().nullable().optional(),
    start_time_confirmed: z.boolean().nullable().optional()
  })
  .strict();

const intakeDraftSchema = z
  .object({
    department: departmentSchema.nullable().optional(),
    job_type: jobTypeSchema.nullable().optional(),
    job_title: nullableString(240),
    request_source: requestSourceSchema.nullable().optional(),
    source_reference: nullableString(240),
    organization_id: nullableUuidSchema,
    unresolved_organization_name: nullableString(240),
    location_id: nullableUuidSchema,
    unresolved_location_name: nullableString(240),
    primary_contact_id: nullableUuidSchema,
    unresolved_primary_contact_name: nullableString(240),
    account_owner_user_id: nullableUuidSchema,
    job_owner_user_id: nullableUuidSchema,
    start_date: isoDateSchema.nullable().optional(),
    start_time: nullableString(32),
    end_time: nullableString(32),
    timezone: nullableString(120),
    date_only: z.boolean().nullable().optional(),
    is_multi_day: z.boolean().nullable().optional(),
    delivery_due_date: isoDateSchema.nullable().optional(),
    production_required: z.boolean().nullable().optional(),
    staffing_required: z.boolean().nullable().optional(),
    staffing_estimate: nullableCountSchema,
    priority: prioritySchema.nullable().optional(),
    delivery_type: deliveryTypeSchema.nullable().optional(),
    production_grouping_rule: productionGroupingRuleSchema.nullable().optional(),
    internal_notes: nullableString(4000),
    client_notes: nullableString(4000),
    special_instructions: nullableString(4000),
    raw_source_text: nullableString(20000),
    duplicate_override_note: nullableString(4000),
    days: z.array(jobDaySchema).max(31).nullable().optional(),
    school_detail: schoolDetailSchema.nullable().optional(),
    sports_detail: sportsDetailSchema.nullable().optional()
  })
  .strict();

const publishDraftSchema = z
  .object({
    duplicate_override_note: nullableString(4000)
  })
  .strict();

const importMappingSchema = z.record(z.string().trim().min(1).max(160)).superRefine((mapping, ctx) => {
  for (const key of Object.keys(mapping)) {
    if (!(CENTRAL_JOB_IMPORT_FIELD_KEYS as readonly string[]).includes(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported import field key "${key}".`,
        path: [key]
      });
    }
  }
});

const createImportSessionSchema = z
  .object({
    department: departmentSchema,
    source_filename: z.string().trim().min(1).max(240),
    csv_text: z.string().trim().min(1).max(5_000_000)
  })
  .strict();

const updateImportMappingSchema = z
  .object({
    mapping: importMappingSchema
  })
  .strict();

const commitImportSessionSchema = z
  .object({
    mode: z.enum(CENTRAL_JOB_IMPORT_COMMIT_MODES).optional(),
    acknowledge_soft_duplicates: z.boolean().optional(),
    override_hard_duplicates: z.boolean().optional(),
    duplicate_override_note: nullableString(4000)
  })
  .strict();

const parseTextSchema = z
  .object({
    raw_text: z.string().trim().min(1).max(20000),
    department_hint: departmentSchema.nullable().optional()
  })
  .strict();

const organizationDefaultsQuerySchema = z
  .object({
    department: departmentSchema
  })
  .strict();

const draftListQuerySchema = z
  .object({
    department: departmentSchema.optional()
  })
  .strict();

type CentralJobRouteLogger = {
  warn: (payload: Record<string, unknown>, message: string) => void;
  error: (payload: Record<string, unknown>, message: string) => void;
};

type CentralJobLoggableRequest = AuthenticatedRequest & {
  log?: Partial<CentralJobRouteLogger>;
  route?: { path?: string };
  method?: string;
};

router.use((req, res, next) => {
  if (!featureFlags.centralJobIntakeV1) {
    return res.status(404).json({ error: "Not found" });
  }
  return next();
});

router.use(requireAuth);

function parseUuidParam(value: unknown, label: string) {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        [label]: ["Must be a valid UUID."]
      },
      form_errors: []
    });
  }
  return parsed.data;
}

export function logCentralJobRouteFailure(
  req: CentralJobLoggableRequest,
  event: string,
  error: unknown,
  context: Record<string, unknown> = {}
) {
  const logger = req.log;
  if (!logger?.warn || !logger?.error) {
    return;
  }

  const payload: Record<string, unknown> = {
    event,
    method: req.method ?? null,
    route_path: req.route?.path ?? null,
    tenant_id: req.auth?.tenantId ?? null,
    actor_user_id: req.auth?.id ?? null,
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: error instanceof Error ? error.message : String(error),
    status_code: error instanceof ApiError ? error.status : null,
    ...context
  };

  if (error instanceof ApiError) {
    payload.error_details = error.details ?? null;
  }

  if (error instanceof ApiError && error.status < 500) {
    logger.warn(payload, "Central job intake route failure");
    return;
  }

  logger.error(payload, "Central job intake route failure");
}

router.post("/drafts", requirePermission("shoot.create"), validateBody(intakeDraftSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const draft = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      createDraftJob(client, auth, req.body)
    );
    return res.status(201).json(draft);
  } catch (error) {
    return next(error);
  }
});

router.get("/drafts", requirePermission("shoot.read"), validateQuery(draftListQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      listDraftJobs(client, auth, {
        department: (req.query.department as "schools" | "sports" | undefined) ?? null
      })
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/parse", requirePermission("shoot.create"), validateBody(parseTextSchema), async (req, res, next) => {
  try {
    const parseResult = parseJobIntakeText(req.body.raw_text, req.body.department_hint ?? null);
    return res.json(parseResult);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/import-sessions",
  requirePermission("shoot.create"),
  validateBody(createImportSessionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const session = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        createImportSession(client, auth, req.body)
      );
      return res.status(201).json(session);
    } catch (error) {
      logCentralJobRouteFailure(req as CentralJobLoggableRequest, "central_job_intake.import_session_create_failed", error, {
        department: req.body.department ?? null,
        source_filename: req.body.source_filename ?? null
      });
      return next(error);
    }
  }
);

router.get("/import-sessions/:id", requirePermission("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const sessionId = parseUuidParam(req.params.id, "id");
    const session = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      getImportSession(client, auth, sessionId)
    );
    return res.json(session);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/import-sessions/:id/mapping",
  requirePermission("shoot.create"),
  validateBody(updateImportMappingSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const sessionId = parseUuidParam(req.params.id, "id");
      const session = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        updateImportMapping(client, auth, sessionId, req.body)
      );
      return res.json(session);
    } catch (error) {
      logCentralJobRouteFailure(req as CentralJobLoggableRequest, "central_job_intake.import_session_validate_failed", error, {
        session_id: req.params.id ?? null
      });
      return next(error);
    }
  }
);

router.post(
  "/import-sessions/:id/commit",
  requirePermission("shoot.create"),
  validateBody(commitImportSessionSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const sessionId = parseUuidParam(req.params.id, "id");
      const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        commitImportSession(client, auth, sessionId, req.body)
      );
      return res.json(result);
    } catch (error) {
      logCentralJobRouteFailure(req as CentralJobLoggableRequest, "central_job_intake.import_session_commit_failed", error, {
        session_id: req.params.id ?? null,
        commit_mode: req.body.mode ?? "create_drafts_only",
        acknowledge_soft_duplicates: Boolean(req.body.acknowledge_soft_duplicates),
        override_hard_duplicates: Boolean(req.body.override_hard_duplicates)
      });
      return next(error);
    }
  }
);

router.get("/drafts/:id", requirePermission("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shootId = parseUuidParam(req.params.id, "id");
    const draft = await withClientTransaction(auth.tenantId, auth.id, async (client) => getDraftJob(client, auth, shootId));
    return res.json(draft);
  } catch (error) {
    return next(error);
  }
});

router.get("/jobs/:id", requirePermission("shoot.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shootId = parseUuidParam(req.params.id, "id");
    const job = await withClientTransaction(auth.tenantId, auth.id, async (client) => getIntakeJob(client, auth, shootId));
    return res.json(job);
  } catch (error) {
    return next(error);
  }
});

router.patch("/drafts/:id", requirePermission("shoot.update"), validateBody(intakeDraftSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shootId = parseUuidParam(req.params.id, "id");
    const draft = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      updateDraftJob(client, auth, shootId, req.body)
    );
    return res.json(draft);
  } catch (error) {
    return next(error);
  }
});

router.patch("/jobs/:id", requirePermission("shoot.update"), validateBody(intakeDraftSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shootId = parseUuidParam(req.params.id, "id");
    const job = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      updatePublishedJob(client, auth, shootId, req.body)
    );
    return res.json(job);
  } catch (error) {
    return next(error);
  }
});

router.post("/drafts/:id/duplicate-check", requirePermission("shoot.update"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shootId = parseUuidParam(req.params.id, "id");
    const duplicates = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      previewDraftDuplicates(client, auth, shootId)
    );
    return res.json(duplicates);
  } catch (error) {
    return next(error);
  }
});

router.post("/drafts/:id/publish", requirePermission("shoot.update"), validateBody(publishDraftSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shootId = parseUuidParam(req.params.id, "id");
    const result = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      publishDraftJob(client, auth, shootId, req.body)
    );
    return res.json(result);
  } catch (error) {
    logCentralJobRouteFailure(req as CentralJobLoggableRequest, "central_job_intake.publish_failed", error, {
      shoot_id: req.params.id ?? null,
      duplicate_override_attempted: Boolean(req.body.duplicate_override_note)
    });
    return next(error);
  }
});

router.get("/drafts/:id/readiness", requirePermission("shoot.update"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shootId = parseUuidParam(req.params.id, "id");
    const draft = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      refreshDraftReadiness(client, auth, shootId)
    );
    return res.json(draft.readiness);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/organizations/:organizationId/defaults",
  requirePermission("shoot.read"),
  validateQuery(organizationDefaultsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const organizationId = parseUuidParam(req.params.organizationId, "organizationId");
      const department = req.query.department as "schools" | "sports";
      const defaults = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
        resolveOrganizationDefaults(client, auth, organizationId, department)
      );
      return res.json(defaults);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
