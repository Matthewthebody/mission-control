import type { PoolClient } from "pg";
import { canManageSalesPipeline, canViewSalesPipeline, getAllowedSalesPipelineTypes } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { AgreementReminderStatus, AgreementReminderType, AgreementStatus } from "../types/agreements.js";
import type {
  SalesEmailCommunicationRecord,
  SalesEmailCommunicationStatus,
  SalesEmailEventType,
  SalesEmailTemplateKey,
  SalesEmailTemplateRecord,
  SalesEmailTriggerType,
  SalesOpportunityDetail,
  SalesPipelineAlertRecord,
  SalesOpportunityListView,
  SalesOpportunityStage,
  SalesOpportunityStageRuleState,
  SalesOpportunityStatus,
  SalesOpportunitySummary,
  SalesPipelineAutomationSummary,
  SalesOpportunityType,
  SalesPipelineBoardView,
  SalesPipelineLane,
  SalesPipelineOwnerOption,
  SalesPipelineStageColumn,
  SalesPipelineType
} from "../types/salesPipeline.js";
import { createAuditLog } from "./audit.js";
import { createAppEvent } from "./outbox.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  sourceSurface?: string | null;
};

type SalesOpportunityRow = {
  id: string;
  organization_id: string;
  organization_display_name: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  opportunity_type: SalesOpportunityType;
  pipeline_type: SalesPipelineType;
  stage: SalesOpportunityStage;
  estimated_value: string | null;
  next_action_date: string | null;
  last_touch_date: string;
  last_verified_contact_date: string | null;
  notes: string | null;
  status: SalesOpportunityStatus;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
};

type OpportunityStageValidationInput = {
  organizationId: string;
  primaryContactId: string | null;
  stage: SalesOpportunityStage;
  estimatedValue: number | null;
};

type OrganizationContactInfo = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};

type SalesPipelineAlertRow = {
  id: string;
  alert_type: SalesPipelineAlertRecord["alert_type"];
  status: SalesPipelineAlertRecord["status"];
  severity: SalesPipelineAlertRecord["severity"];
  dedupe_key: string;
  pipeline_type: SalesPipelineType | null;
  opportunity_id: string | null;
  organization_id: string | null;
  agreement_id: string | null;
  linked_shoot_id: string | null;
  title: string;
  message: string;
  due_at: string | null;
  first_triggered_at: string;
  last_triggered_at: string;
  first_notified_at: string | null;
  last_notified_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type AgreementAutomationRow = {
  agreement_id: string;
  organization_id: string | null;
  status: AgreementStatus;
  sent_at: string | null;
  created_at: string;
  expiration_date: string | null;
};

type AgreementReminderSignalRow = {
  agreement_id: string;
  reminder_type: AgreementReminderType;
  status: AgreementReminderStatus;
};

type UpcomingShootAgreementRiskRow = {
  shoot_id: string;
  organization_id: string | null;
};

type SalesEmailTemplateRow = {
  id: string;
  template_key: SalesEmailTemplateKey;
  template_name: string;
  subject_template: string;
  body_template: string;
  merge_fields: unknown;
  active_status: boolean;
  automation_enabled: boolean;
  created_at: string;
  updated_at: string;
};

type SalesEmailCommunicationRow = {
  id: string;
  template_id: string | null;
  template_key: SalesEmailTemplateKey | null;
  template_name_snapshot: string | null;
  opportunity_id: string | null;
  organization_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  trigger_type: SalesEmailTriggerType;
  status: SalesEmailCommunicationStatus;
  subject: string;
  body: string;
  queued_at: string;
  sent_at: string | null;
  last_delivery_attempt_at: string | null;
  delivery_provider: string | null;
  delivery_reference: string | null;
  provider_error_state: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type SalesEmailCommunicationEventRow = {
  id: string;
  communication_id: string;
  event_type: SalesEmailEventType;
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
  created_at: string;
};

const STAGE_ORDER: SalesOpportunityStage[] = [
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
];

const STAGE_LABELS: Record<SalesOpportunityStage, string> = {
  lead: "Lead",
  contacted: "Contacted",
  meeting_scheduled: "Meeting Scheduled",
  proposal_sent: "Proposal Sent",
  follow_up: "Follow-Up",
  negotiation: "Negotiation",
  contract_sent: "Contract Sent",
  won: "Won",
  lost: "Lost",
  dormant: "Dormant"
};

const RESURFACE_WINDOW_DAYS = 14;
const INACTIVE_OPPORTUNITY_DAYS = 14;
const UPCOMING_SHOOT_RISK_WINDOW_DAYS = 60;

export async function listSalesPipelineOwners(client: PoolClient, auth: AuthUser): Promise<SalesPipelineOwnerOption[]> {
  assertCanViewSalesPipeline(auth);

  const restrictToSelf = !isLeadershipLike(auth);
  const { rows } = await client.query<{
    id: string;
    full_name: string;
    email: string;
    authority_tier: string;
    primary_job_function_profile: string;
    department: string;
  }>(
    `
      SELECT
        u.id,
        u.full_name,
        u.email,
        COALESCE(uaa.authority_tier::text, 'standard_employee') AS authority_tier,
        COALESCE(uaa.primary_job_function_profile::text, 'customer_service_rep') AS primary_job_function_profile,
        u.department::text AS department
      FROM app_user u
      LEFT JOIN user_authority_assignment uaa
        ON uaa.tenant_id = u.tenant_id
       AND uaa.user_id = u.id
      WHERE u.tenant_id = $1
        AND u.status = 'active'
        AND u.is_active = true
        AND ($2::boolean = false OR u.id = $3)
        AND (
          COALESCE(uaa.authority_tier::text, '') IN ('super_admin', 'leadership', 'director_admin')
          OR COALESCE(uaa.primary_job_function_profile::text, '') IN ('schools_client_success', 'sports_client_success', 'customer_service_rep')
          OR EXISTS (
            SELECT 1
            FROM user_job_function_profile ujp
            WHERE ujp.tenant_id = u.tenant_id
              AND ujp.user_id = u.id
              AND ujp.job_function_profile::text IN ('schools_client_success', 'sports_client_success', 'customer_service_rep')
          )
        )
      ORDER BY lower(u.full_name)
    `,
    [auth.tenantId, restrictToSelf, auth.id]
  );

  return rows;
}

export async function getSalesPipelineBoard(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    pipelineType?: SalesPipelineType | null;
    ownerId?: string | null;
  } = {}
): Promise<SalesPipelineBoardView> {
  assertCanViewSalesPipeline(auth);
  const allowedPipelineTypes = resolveAllowedPipelineTypes(auth, filters.pipelineType ?? null);
  const rows = await listSalesOpportunityRows(client, auth.tenantId, {
    pipelineTypes: allowedPipelineTypes,
    ownerId: filters.ownerId ?? null
  });
  const [automationSummary, automationAlerts] = await Promise.all([
    buildAutomationSummary(client, auth.tenantId, rows),
    loadOpenSalesPipelineAlerts(client, auth.tenantId, {
      pipelineTypes: allowedPipelineTypes,
      ownerId: filters.ownerId ?? null,
      limit: 16
    })
  ]);

  return {
    generated_at: new Date().toISOString(),
    allowed_pipeline_types: [...allowedPipelineTypes],
    summary: buildOpportunitySummary(rows),
    automation_summary: automationSummary,
    automation_alerts: automationAlerts,
    pipelines: buildPipelineLanes(rows, allowedPipelineTypes)
  };
}

export async function listSalesOpportunities(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    search?: string | null;
    pipelineType?: SalesPipelineType | null;
    stage?: SalesOpportunityStage | null;
    status?: SalesOpportunityStatus | null;
    ownerId?: string | null;
    resurfacingOnly?: boolean;
  } = {}
): Promise<SalesOpportunityListView> {
  assertCanViewSalesPipeline(auth);
  const allowedPipelineTypes = resolveAllowedPipelineTypes(auth, filters.pipelineType ?? null);
  const rows = await listSalesOpportunityRows(client, auth.tenantId, {
    search: filters.search ?? null,
    pipelineTypes: allowedPipelineTypes,
    stage: filters.stage ?? null,
    status: filters.status ?? null,
    ownerId: filters.ownerId ?? null
  });
  const opportunities = filters.resurfacingOnly ? rows.filter((row) => row.resurface_ready) : rows;
  const [automationSummary, automationAlerts] = await Promise.all([
    buildAutomationSummary(client, auth.tenantId, rows),
    loadOpenSalesPipelineAlerts(client, auth.tenantId, {
      pipelineTypes: allowedPipelineTypes,
      ownerId: filters.ownerId ?? null,
      limit: 16
    })
  ]);

  return {
    allowed_pipeline_types: [...allowedPipelineTypes],
    summary: {
      total: opportunities.length,
      ...buildOpportunitySummary(opportunities)
    },
    automation_summary: automationSummary,
    automation_alerts: automationAlerts,
    opportunities
  };
}

export async function getSalesOpportunityDetail(
  client: PoolClient,
  auth: AuthUser,
  opportunityId: string
): Promise<SalesOpportunityDetail | null> {
  assertCanViewSalesPipeline(auth);
  const row = await loadSalesOpportunityRow(client, auth.tenantId, opportunityId);
  if (!row) {
    return null;
  }
  assertPipelineAccessForOpportunity(auth, row.pipeline_type);
  const [alerts, emailTemplates, communications] = await Promise.all([
    loadOpenSalesPipelineAlerts(client, auth.tenantId, {
      opportunityId,
      limit: 12
    }),
    loadSalesEmailTemplates(client, auth.tenantId),
    loadSalesEmailCommunications(client, auth.tenantId, {
      opportunityId,
      limit: 12
    })
  ]);

  return {
    opportunity: mapSalesOpportunitySummary(row, alerts.length),
    stage_rules: await buildStageRuleState(client, auth.tenantId, {
      organizationId: row.organization_id,
      primaryContactId: row.primary_contact_id,
      stage: row.stage,
      estimatedValue: parseNumeric(row.estimated_value)
    }),
    alerts,
    email_templates: emailTemplates,
    communications
  };
}

export async function getOrganizationSalesPipelineView(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string
): Promise<{
  can_view: boolean;
  summary: {
    linked_opportunities: number;
    active_opportunities: number;
    dormant_opportunities: number;
    open_alerts: number;
    missing_next_action: number;
    inactive_opportunities: number;
    meeting_scheduled: number;
    schools_pipeline_count: number;
    sports_pipeline_count: number;
    renewal_opportunities: number;
    contract_sent: number;
    last_touch_date: string | null;
    last_verified_contact_date: string | null;
    next_action_due_date: string | null;
  };
  alerts: SalesPipelineAlertRecord[];
  opportunities: SalesOpportunitySummary[];
  email_templates: SalesEmailTemplateRecord[];
  communications: SalesEmailCommunicationRecord[];
}> {
  const canView = canViewSalesPipeline(auth);
  if (!canView) {
    return {
      can_view: false,
      summary: {
        linked_opportunities: 0,
        active_opportunities: 0,
        dormant_opportunities: 0,
        open_alerts: 0,
        missing_next_action: 0,
        inactive_opportunities: 0,
        meeting_scheduled: 0,
        schools_pipeline_count: 0,
        sports_pipeline_count: 0,
        renewal_opportunities: 0,
        contract_sent: 0,
        last_touch_date: null,
        last_verified_contact_date: null,
        next_action_due_date: null
      },
      alerts: [],
      opportunities: [],
      email_templates: [],
      communications: []
    };
  }

  const allowedPipelineTypes = resolveAllowedPipelineTypes(auth, null);
  const [opportunities, alerts, emailTemplates, communications] = await Promise.all([
    listSalesOpportunityRows(client, auth.tenantId, {
      pipelineTypes: allowedPipelineTypes,
      organizationId
    }),
    loadOpenSalesPipelineAlerts(client, auth.tenantId, {
      pipelineTypes: allowedPipelineTypes,
      organizationId,
      limit: 12
    }),
    loadSalesEmailTemplates(client, auth.tenantId),
    loadSalesEmailCommunications(client, auth.tenantId, {
      organizationId,
      limit: 12
    })
  ]);

  return {
    can_view: true,
    summary: {
      linked_opportunities: opportunities.length,
      active_opportunities: opportunities.filter((opportunity) => opportunity.status === "active").length,
      dormant_opportunities: opportunities.filter((opportunity) => opportunity.status === "dormant").length,
      open_alerts: alerts.length,
      missing_next_action: alerts.filter((alert) => alert.alert_type === "missing_next_action").length,
      inactive_opportunities: alerts.filter((alert) => alert.alert_type === "inactive_opportunity").length,
      meeting_scheduled: alerts.filter((alert) => alert.alert_type === "meeting_scheduled").length,
      schools_pipeline_count: opportunities.filter((opportunity) => opportunity.pipeline_type === "schools").length,
      sports_pipeline_count: opportunities.filter((opportunity) => opportunity.pipeline_type === "sports").length,
      renewal_opportunities: opportunities.filter((opportunity) => opportunity.opportunity_type === "renewal").length,
      contract_sent: opportunities.filter((opportunity) => opportunity.stage === "contract_sent").length,
      last_touch_date: maxIsoDate(opportunities.map((opportunity) => opportunity.last_touch_date)),
      last_verified_contact_date: maxIsoDate(opportunities.map((opportunity) => opportunity.last_verified_contact_date)),
      next_action_due_date: minIsoDate(
        opportunities
          .filter((opportunity) => opportunity.status === "active")
          .map((opportunity) => opportunity.next_action_date)
      )
    },
    alerts,
    opportunities,
    email_templates: emailTemplates,
    communications
  };
}

export async function sendSalesEmailCommunication(
  client: PoolClient,
  auth: AuthUser,
  input: {
    organizationId: string;
    opportunityId?: string | null;
    contactId?: string | null;
    templateId: string;
    subject?: string | null;
    body?: string | null;
    triggerType?: SalesEmailTriggerType;
  },
  requestMeta: RequestMeta = {}
): Promise<SalesEmailCommunicationRecord> {
  assertCanManageSalesPipeline(auth);

  const triggerType = input.triggerType ?? "manual";
  const template = await loadSalesEmailTemplateById(client, auth.tenantId, input.templateId);
  if (!template || !template.active_status) {
    throw new ApiError(404, "Sales email template not found.");
  }

  const opportunity = input.opportunityId ? await loadSalesOpportunityRow(client, auth.tenantId, input.opportunityId) : null;
  if (input.opportunityId && !opportunity) {
    throw new ApiError(404, "Sales opportunity not found.");
  }
  if (opportunity) {
    assertPipelineAccessForOpportunity(auth, opportunity.pipeline_type);
  }

  const organizationId = opportunity?.organization_id ?? input.organizationId;
  if (!organizationId) {
    throw new ApiError(400, "An Organization is required to send sales email.");
  }
  if (opportunity && input.organizationId && input.organizationId !== opportunity.organization_id) {
    throw new ApiError(400, "Opportunity email must use the linked Organization.");
  }

  const { rows: organizationRows } = await client.query<{ id: string; display_name: string }>(
    `
      SELECT id, display_name
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, organizationId]
  );
  const organization = organizationRows[0];
  if (!organization) {
    throw new ApiError(404, "Organization not found.");
  }

  const contactId = input.contactId ?? opportunity?.primary_contact_id ?? null;
  if (!contactId) {
    throw new ApiError(400, "Choose a Contact before sending email.");
  }

  const contact = await loadScopedOrganizationContact(client, auth.tenantId, organizationId, contactId);
  if (!contact) {
    throw new ApiError(404, "Contact not found on this Organization.");
  }
  if (!contact.email) {
    throw new ApiError(400, "The selected Contact does not have an email address.");
  }

  const mergeContext = buildSalesEmailMergeContext({
    organizationName: organization.display_name,
    contactName: contact.full_name,
    senderName: auth.fullName,
    opportunity
  });

  const subject = normalizeOptionalText(input.subject) ?? renderSalesEmailTemplate(template.subject_template, mergeContext);
  const body = normalizeOptionalText(input.body) ?? renderSalesEmailTemplate(template.body_template, mergeContext);

  if (!subject) {
    throw new ApiError(400, "Email subject cannot be empty.");
  }
  if (!body) {
    throw new ApiError(400, "Email body cannot be empty.");
  }

  const insert = await client.query<{ id: string }>(
    `
      INSERT INTO sales_email_communication (
        tenant_id,
        template_id,
        template_key,
        template_name_snapshot,
        opportunity_id,
        organization_id,
        contact_id,
        sent_by_user_id,
        trigger_type,
        status,
        recipient_name,
        recipient_email,
        subject,
        body,
        metadata
      )
      VALUES (
        $1,$2,$3::sales_email_template_key,$4,$5,$6,$7,$8,$9::sales_email_trigger_type,'queued',$10,$11,$12,$13,$14::jsonb
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      template.id,
      template.template_key,
      template.template_name,
      opportunity?.id ?? null,
      organizationId,
      contact.id,
      auth.id,
      triggerType,
      contact.full_name,
      contact.email,
      subject,
      body,
      JSON.stringify({
        template_key: template.template_key,
        merge_context: mergeContext
      })
    ]
  );

  const communicationId = insert.rows[0]?.id;
  if (!communicationId) {
    throw new Error("Failed to create sales email communication.");
  }

  await insertSalesEmailCommunicationEvent(client, {
    tenantId: auth.tenantId,
    communicationId,
    eventType: "queued",
    actorUserId: auth.id,
    note: triggerType === "manual" ? "Queued from Sales Pipeline template send." : "Queued from automation trigger.",
    metadata: {
      template_key: template.template_key,
      trigger_type: triggerType
    }
  });

  await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "sales.email.send_requested",
    aggregateType: "sales_email_communication",
    aggregateId: communicationId,
    dedupeKey: `sales-email:${communicationId}:send-requested`,
    payload: {
      communication_id: communicationId,
      organization_id: organizationId,
      opportunity_id: opportunity?.id ?? null,
      contact_id: contact.id,
      recipient_name: contact.full_name,
      recipient_email: contact.email,
      subject,
      body
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "sales.email.queue",
    entityType: "sales_email_communication",
    entityId: communicationId,
    metadata: {
      organization_id: organizationId,
      opportunity_id: opportunity?.id ?? null,
      contact_id: contact.id,
      template_key: template.template_key,
      trigger_type: triggerType
    },
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null,
    sourceSurface: requestMeta.sourceSurface ?? "sales_pipeline",
    newValues: {
      subject,
      status: "queued",
      recipient_email: contact.email
    }
  });

  const communication = await loadSalesEmailCommunicationById(client, auth.tenantId, communicationId);
  if (!communication) {
    throw new Error("Failed to reload sales email communication.");
  }
  return communication;
}

export async function createSalesOpportunity(
  client: PoolClient,
  auth: AuthUser,
  input: {
    organizationId: string;
    primaryContactId?: string | null;
    ownerId?: string | null;
    opportunityType: SalesOpportunityType;
    pipelineType: SalesPipelineType;
    stage?: SalesOpportunityStage;
    estimatedValue?: number | null;
    nextActionDate?: string | null;
    lastTouchDate?: string | null;
    lastVerifiedContactDate?: string | null;
    notes?: string | null;
    followUpDate?: string | null;
  },
  requestMeta: RequestMeta = {}
) {
  assertCanManageSalesPipeline(auth);
  assertPipelineAccessForOpportunity(auth, input.pipelineType);

  const stage = input.stage ?? "lead";
  const ownerId = await resolveOpportunityOwnerId(client, auth, input.ownerId ?? null);
  await validateOpportunityReferences(client, auth.tenantId, {
    organizationId: input.organizationId,
    primaryContactId: input.primaryContactId ?? null,
    stage,
    estimatedValue: input.estimatedValue ?? null
  });

  const status = deriveOpportunityStatus(stage);
  const nextActionDate = normalizeOptionalDate(input.nextActionDate ?? null);
  const lastTouchDate = normalizeRequiredDate(
    input.lastTouchDate ?? new Date().toISOString().slice(0, 10),
    "Last touch date is required."
  );
  const lastVerifiedContactDate = normalizeOptionalDate(input.lastVerifiedContactDate ?? null);
  const followUpDate = normalizeOptionalDate(input.followUpDate ?? null);
  assertDormantFollowUp(stage, followUpDate);

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO sales_opportunity (
        tenant_id,
        organization_id,
        primary_contact_id,
        owner_id,
        opportunity_type,
        pipeline_type,
        stage,
        estimated_value,
        next_action_date,
        last_touch_date,
        last_verified_contact_date,
        notes,
        status,
        follow_up_date,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11::date,$12,$13,$14::date,$15,$15)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.organizationId,
      input.primaryContactId ?? null,
      ownerId,
      input.opportunityType,
      input.pipelineType,
      stage,
      input.estimatedValue ?? null,
      nextActionDate,
      lastTouchDate,
      lastVerifiedContactDate,
      normalizeOptionalText(input.notes),
      status,
      followUpDate,
      auth.id
    ]
  );

  const created = await getSalesOpportunityDetail(client, auth, rows[0].id);
  if (!created) {
    throw new ApiError(500, "Sales opportunity could not be loaded after creation.");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "sales_pipeline.opportunity.created",
    entityType: "sales_opportunity",
    entityId: rows[0].id,
    newValues: created.opportunity,
    reasonComment: created.opportunity.notes ?? "Sales opportunity created.",
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return created;
}

export async function updateSalesOpportunity(
  client: PoolClient,
  auth: AuthUser,
  opportunityId: string,
  input: {
    primaryContactId?: string | null;
    ownerId?: string | null;
    opportunityType?: SalesOpportunityType;
    pipelineType?: SalesPipelineType;
    stage?: SalesOpportunityStage;
    estimatedValue?: number | null;
    nextActionDate?: string | null;
    lastTouchDate?: string | null;
    lastVerifiedContactDate?: string | null;
    notes?: string | null;
    followUpDate?: string | null;
  },
  requestMeta: RequestMeta = {}
) {
  assertCanManageSalesPipeline(auth);
  const existing = await loadSalesOpportunityRowForUpdate(client, auth.tenantId, opportunityId);
  if (!existing) {
    throw new ApiError(404, "Sales opportunity not found.");
  }
  assertPipelineAccessForOpportunity(auth, existing.pipeline_type);

  const nextPipelineType = input.pipelineType ?? existing.pipeline_type;
  assertPipelineAccessForOpportunity(auth, nextPipelineType);

  const nextStage = input.stage ?? existing.stage;
  const nextPrimaryContactId = input.primaryContactId === undefined ? existing.primary_contact_id : input.primaryContactId ?? null;
  const nextEstimatedValue = input.estimatedValue === undefined ? parseNumeric(existing.estimated_value) : input.estimatedValue;
  const nextOwnerId = input.ownerId === undefined ? existing.owner_id : await resolveOpportunityOwnerId(client, auth, input.ownerId ?? null);
  await validateOpportunityReferences(client, auth.tenantId, {
    organizationId: existing.organization_id,
    primaryContactId: nextPrimaryContactId,
    stage: nextStage,
    estimatedValue: nextEstimatedValue ?? null
  });

  const nextStatus = deriveOpportunityStatus(nextStage);
  const nextActionDate =
    input.nextActionDate === undefined
      ? existing.next_action_date
      : normalizeOptionalDate(input.nextActionDate ?? null);
  const lastTouchDate =
    input.lastTouchDate === undefined
      ? existing.last_touch_date
      : normalizeRequiredDate(input.lastTouchDate ?? null, "Last touch date is required.");
  const lastVerifiedContactDate =
    input.lastVerifiedContactDate === undefined
      ? existing.last_verified_contact_date
      : normalizeOptionalDate(input.lastVerifiedContactDate ?? null);
  const followUpDate =
    input.followUpDate === undefined ? existing.follow_up_date : normalizeOptionalDate(input.followUpDate ?? null);
  assertDormantFollowUp(nextStage, followUpDate);

  const previousValues = mapSalesOpportunitySummary(existing);

  await client.query(
    `
      UPDATE sales_opportunity
      SET
        primary_contact_id = $3,
        owner_id = $4,
        opportunity_type = $5,
        pipeline_type = $6,
        stage = $7,
        estimated_value = $8,
        next_action_date = $9::date,
        last_touch_date = $10::date,
        last_verified_contact_date = $11::date,
        notes = $12,
        status = $13,
        follow_up_date = $14::date,
        updated_by_user_id = $15,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      opportunityId,
      nextPrimaryContactId,
      nextOwnerId,
      input.opportunityType ?? existing.opportunity_type,
      nextPipelineType,
      nextStage,
      nextEstimatedValue ?? null,
      nextActionDate,
      lastTouchDate,
      lastVerifiedContactDate,
      input.notes === undefined ? existing.notes : normalizeOptionalText(input.notes),
      nextStatus,
      followUpDate,
      auth.id
    ]
  );

  const updated = await getSalesOpportunityDetail(client, auth, opportunityId);
  if (!updated) {
    throw new ApiError(500, "Sales opportunity could not be loaded after update.");
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "sales_pipeline.opportunity.updated",
    entityType: "sales_opportunity",
    entityId: opportunityId,
    previousValues,
    newValues: updated.opportunity,
    reasonComment: updated.opportunity.notes ?? `Opportunity updated to ${updated.opportunity.stage}.`,
    sourceSurface: requestMeta.sourceSurface ?? null,
    ipAddress: requestMeta.ipAddress ?? null,
    userAgent: requestMeta.userAgent ?? null
  });

  return updated;
}

async function validateOpportunityReferences(
  client: PoolClient,
  tenantId: string,
  input: OpportunityStageValidationInput
) {
  await assertOrganizationExists(client, tenantId, input.organizationId);
  const contact = input.primaryContactId ? await loadOrganizationContact(client, tenantId, input.primaryContactId) : null;
  if (contact && contact.organization_id !== input.organizationId) {
    throw new ApiError(400, "Primary Contact must belong to the selected Organization.");
  }

  const stageRules = await buildStageRuleState(client, tenantId, input);
  if (stageRules.proposal_sent_blockers.length) {
    throw new ApiError(400, stageRules.proposal_sent_blockers[0]);
  }
  if (stageRules.contract_sent_blockers.length) {
    throw new ApiError(400, stageRules.contract_sent_blockers[0]);
  }
  if (stageRules.won_blockers.length) {
    throw new ApiError(400, stageRules.won_blockers[0]);
  }
}

async function buildStageRuleState(
  client: PoolClient,
  tenantId: string,
  input: OpportunityStageValidationInput
): Promise<SalesOpportunityStageRuleState> {
  const contact = input.primaryContactId ? await loadOrganizationContact(client, tenantId, input.primaryContactId) : null;
  const signedAgreementCount = await countSignedAgreementsForOrganization(client, tenantId, input.organizationId);

  return {
    proposal_sent_blockers:
      requiresEstimatedValue(input.stage) && !(input.estimatedValue && input.estimatedValue > 0)
        ? ["Proposal Sent and later stages require an estimated value."]
        : [],
    contract_sent_blockers:
      requiresContactInfo(input.stage) && (!contact || (!contact.email && !contact.phone))
        ? ["Contract Sent and later stages require a primary Contact with email or phone."]
        : [],
    won_blockers:
      requiresSignedAgreement(input.stage) && signedAgreementCount < 1
        ? ["Won requires a signed, countersigned, or active Agreement on the Organization."]
        : [],
    has_signed_agreement_on_file: signedAgreementCount > 0,
    signed_agreement_count: signedAgreementCount
  };
}

async function countSignedAgreementsForOrganization(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM agreement
      WHERE tenant_id = $1
        AND organization_id = $2
        AND status IN ('signed', 'countersigned', 'active')
    `,
    [tenantId, organizationId]
  );
  return Number(rows[0]?.count ?? "0");
}

async function listSalesOpportunityRows(
  client: PoolClient,
  tenantId: string,
  filters: {
    search?: string | null;
    pipelineTypes: readonly SalesPipelineType[];
    stage?: SalesOpportunityStage | null;
    status?: SalesOpportunityStatus | null;
    ownerId?: string | null;
    organizationId?: string | null;
  }
) {
  const search = normalizeOptionalText(filters.search);
  const searchLike = search ? `%${search.toLowerCase()}%` : null;

  const { rows } = await client.query<SalesOpportunityRow>(
    `
      SELECT
        so.id,
        so.organization_id,
        org.display_name AS organization_display_name,
        so.primary_contact_id,
        contact.full_name AS primary_contact_name,
        contact.email AS primary_contact_email,
        contact.phone AS primary_contact_phone,
        so.owner_id,
        owner.full_name AS owner_name,
        owner.email AS owner_email,
        so.opportunity_type::text AS opportunity_type,
        so.pipeline_type::text AS pipeline_type,
        so.stage::text AS stage,
        so.estimated_value::text AS estimated_value,
        so.next_action_date::text AS next_action_date,
        so.last_touch_date::text AS last_touch_date,
        so.last_verified_contact_date::text AS last_verified_contact_date,
        so.notes,
        so.status::text AS status,
        so.follow_up_date::text AS follow_up_date,
        so.created_at::text AS created_at,
        so.updated_at::text AS updated_at
      FROM sales_opportunity so
      JOIN organization org
        ON org.tenant_id = so.tenant_id
       AND org.id = so.organization_id
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = so.tenant_id
       AND contact.id = so.primary_contact_id
      JOIN app_user owner
        ON owner.tenant_id = so.tenant_id
       AND owner.id = so.owner_id
      WHERE so.tenant_id = $1
        AND so.pipeline_type::text = ANY($2::text[])
        AND ($3::text IS NULL OR so.stage::text = $3)
        AND ($4::text IS NULL OR so.status::text = $4)
        AND ($5::uuid IS NULL OR so.owner_id = $5)
        AND ($6::uuid IS NULL OR so.organization_id = $6)
        AND (
          $7::text IS NULL
          OR lower(org.display_name) LIKE $7
          OR lower(COALESCE(contact.full_name, '')) LIKE $7
          OR lower(COALESCE(owner.full_name, '')) LIKE $7
          OR lower(COALESCE(so.notes, '')) LIKE $7
        )
      ORDER BY
        CASE
          WHEN so.status = 'active' AND so.next_action_date IS NULL THEN 0
          WHEN so.status = 'dormant' AND so.follow_up_date IS NOT NULL AND so.follow_up_date <= current_date + $8::integer THEN 1
          WHEN so.status = 'active' AND so.next_action_date < current_date THEN 2
          ELSE 3
        END,
        COALESCE(so.next_action_date, current_date) ASC,
        so.updated_at DESC,
        lower(org.display_name) ASC
    `,
    [
      tenantId,
      filters.pipelineTypes,
      filters.stage ?? null,
      filters.status ?? null,
      filters.ownerId ?? null,
      filters.organizationId ?? null,
      searchLike,
      RESURFACE_WINDOW_DAYS
    ]
  );

  const openAlertCounts = await loadOpenAlertCountByOpportunity(
    client,
    tenantId,
    rows.map((row) => row.id)
  );

  return rows.map((row) => mapSalesOpportunitySummary(row, openAlertCounts.get(row.id) ?? 0));
}

async function loadSalesOpportunityRow(client: PoolClient, tenantId: string, opportunityId: string) {
  const { rows } = await client.query<SalesOpportunityRow>(
    `
      SELECT
        so.id,
        so.organization_id,
        org.display_name AS organization_display_name,
        so.primary_contact_id,
        contact.full_name AS primary_contact_name,
        contact.email AS primary_contact_email,
        contact.phone AS primary_contact_phone,
        so.owner_id,
        owner.full_name AS owner_name,
        owner.email AS owner_email,
        so.opportunity_type::text AS opportunity_type,
        so.pipeline_type::text AS pipeline_type,
        so.stage::text AS stage,
        so.estimated_value::text AS estimated_value,
        so.next_action_date::text AS next_action_date,
        so.last_touch_date::text AS last_touch_date,
        so.last_verified_contact_date::text AS last_verified_contact_date,
        so.notes,
        so.status::text AS status,
        so.follow_up_date::text AS follow_up_date,
        so.created_at::text AS created_at,
        so.updated_at::text AS updated_at
      FROM sales_opportunity so
      JOIN organization org
        ON org.tenant_id = so.tenant_id
       AND org.id = so.organization_id
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = so.tenant_id
       AND contact.id = so.primary_contact_id
      JOIN app_user owner
        ON owner.tenant_id = so.tenant_id
       AND owner.id = so.owner_id
      WHERE so.tenant_id = $1
        AND so.id = $2
      LIMIT 1
    `,
    [tenantId, opportunityId]
  );

  return rows[0] ?? null;
}

async function loadSalesOpportunityRowForUpdate(client: PoolClient, tenantId: string, opportunityId: string) {
  const { rows } = await client.query<SalesOpportunityRow>(
    `
      SELECT
        so.id,
        so.organization_id,
        org.display_name AS organization_display_name,
        so.primary_contact_id,
        contact.full_name AS primary_contact_name,
        contact.email AS primary_contact_email,
        contact.phone AS primary_contact_phone,
        so.owner_id,
        owner.full_name AS owner_name,
        owner.email AS owner_email,
        so.opportunity_type::text AS opportunity_type,
        so.pipeline_type::text AS pipeline_type,
        so.stage::text AS stage,
        so.estimated_value::text AS estimated_value,
        so.next_action_date::text AS next_action_date,
        so.last_touch_date::text AS last_touch_date,
        so.last_verified_contact_date::text AS last_verified_contact_date,
        so.notes,
        so.status::text AS status,
        so.follow_up_date::text AS follow_up_date,
        so.created_at::text AS created_at,
        so.updated_at::text AS updated_at
      FROM sales_opportunity so
      JOIN organization org
        ON org.tenant_id = so.tenant_id
       AND org.id = so.organization_id
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = so.tenant_id
       AND contact.id = so.primary_contact_id
      JOIN app_user owner
        ON owner.tenant_id = so.tenant_id
       AND owner.id = so.owner_id
      WHERE so.tenant_id = $1
        AND so.id = $2
      FOR UPDATE
    `,
    [tenantId, opportunityId]
  );

  return rows[0] ?? null;
}

async function assertOrganizationExists(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Organization not found.");
  }
}

async function loadOrganizationContact(client: PoolClient, tenantId: string, contactId: string) {
  const { rows } = await client.query<OrganizationContactInfo>(
    `
      SELECT id, organization_id, full_name, email, phone
      FROM organization_contact
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, contactId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Primary Contact not found.");
  }
  return rows[0];
}

async function resolveOpportunityOwnerId(client: PoolClient, auth: AuthUser, requestedOwnerId: string | null) {
  if (!requestedOwnerId) {
    const { rows } = await client.query<{ id: string }>(
      `
        SELECT id
        FROM app_user
        WHERE tenant_id = $1
          AND status = 'active'
          AND is_active = true
          AND (
            lower(full_name) LIKE '%brenda%'
            OR lower(email) LIKE '%brenda%'
          )
        ORDER BY
          CASE
            WHEN lower(full_name) = 'brenda' THEN 0
            WHEN lower(full_name) LIKE 'brenda %' THEN 1
            ELSE 2
          END,
          lower(full_name)
        LIMIT 1
      `,
      [auth.tenantId]
    );
    return rows[0]?.id ?? auth.id;
  }
  if (!isLeadershipLike(auth) && requestedOwnerId !== auth.id) {
    throw new ApiError(403, "Only leadership can reassign opportunity ownership.");
  }
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM app_user
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'active'
        AND is_active = true
      LIMIT 1
    `,
    [auth.tenantId, requestedOwnerId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Owner not found.");
  }
  return requestedOwnerId;
}

function resolveAllowedPipelineTypes(auth: AuthUser, requestedPipelineType: SalesPipelineType | null) {
  const allowed = [...getAllowedSalesPipelineTypes(auth)] as SalesPipelineType[];
  if (!allowed.length) {
    throw new ApiError(403, "You do not have access to the sales pipeline.");
  }
  if (requestedPipelineType && !allowed.includes(requestedPipelineType)) {
    throw new ApiError(403, "You do not have access to that pipeline.");
  }
  return requestedPipelineType ? [requestedPipelineType] : allowed;
}

function assertPipelineAccessForOpportunity(auth: AuthUser, pipelineType: SalesPipelineType) {
  const allowed = [...getAllowedSalesPipelineTypes(auth)] as SalesPipelineType[];
  if (!allowed.includes(pipelineType)) {
    throw new ApiError(403, "You do not have access to that pipeline.");
  }
}

function buildPipelineLanes(rows: SalesOpportunitySummary[], allowedPipelineTypes: readonly SalesPipelineType[]) {
  return allowedPipelineTypes.map<SalesPipelineLane>((pipelineType) => {
    const pipelineRows = rows.filter((row) => row.pipeline_type === pipelineType);
    const stage_columns = STAGE_ORDER.map<SalesPipelineStageColumn>((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      opportunities: pipelineRows.filter((row) => row.stage === stage)
    }));

    return {
      pipeline_type: pipelineType,
      label: pipelineType === "schools" ? "Schools Pipeline" : "Sports Pipeline",
      summary: buildOpportunitySummary(pipelineRows),
      resurfacing_soon: pipelineRows.filter((row) => row.resurface_ready),
      stage_columns
    };
  });
}

function buildOpportunitySummary(rows: SalesOpportunitySummary[]) {
  return {
    active: rows.filter((row) => row.status === "active").length,
    dormant: rows.filter((row) => row.status === "dormant").length,
    won: rows.filter((row) => row.status === "won").length,
    lost: rows.filter((row) => row.status === "lost").length,
    resurfacing_soon: rows.filter((row) => row.resurface_ready).length,
    overdue_next_actions: rows.filter((row) => row.next_action_overdue).length
  };
}

function maxIsoDate(values: Array<string | null | undefined>) {
  const normalized = values.filter((value): value is string => Boolean(value)).sort();
  return normalized[normalized.length - 1] ?? null;
}

function minIsoDate(values: Array<string | null | undefined>) {
  const normalized = values.filter((value): value is string => Boolean(value)).sort();
  return normalized[0] ?? null;
}

function mapSalesOpportunitySummary(row: SalesOpportunityRow, openAlertCount = 0): SalesOpportunitySummary {
  const today = new Date().toISOString().slice(0, 10);
  const resurfaceHorizon = addDaysToIsoDate(today, RESURFACE_WINDOW_DAYS);
  const resurfaceReady = row.status === "dormant" && Boolean(row.follow_up_date && row.follow_up_date <= resurfaceHorizon);
  const nextActionMissing = row.status === "active" && !row.next_action_date;
  const nextActionOverdue = row.status === "active" && Boolean(row.next_action_date && row.next_action_date < today);
  const attentionState =
    nextActionMissing || (row.status === "dormant" && Boolean(row.follow_up_date && row.follow_up_date <= today)) || nextActionOverdue || openAlertCount > 0
      ? "critical"
      : resurfaceReady || (row.status === "active" && Boolean(row.next_action_date && row.next_action_date <= resurfaceHorizon))
        ? "warning"
        : "standard";

  return {
    id: row.id,
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    primary_contact_id: row.primary_contact_id,
    primary_contact_name: row.primary_contact_name,
    primary_contact_email: row.primary_contact_email,
    primary_contact_phone: row.primary_contact_phone,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    owner_email: row.owner_email,
    opportunity_type: row.opportunity_type,
    pipeline_type: row.pipeline_type,
    stage: row.stage,
    estimated_value: parseNumeric(row.estimated_value),
    next_action_date: row.next_action_date,
    last_touch_date: row.last_touch_date,
    last_verified_contact_date: row.last_verified_contact_date,
    notes: row.notes,
    status: row.status,
    follow_up_date: row.follow_up_date,
    resurface_ready: resurfaceReady,
    next_action_missing: nextActionMissing,
    next_action_overdue: nextActionOverdue,
    open_alert_count: openAlertCount,
    attention_state: attentionState,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function loadOpenAlertCountByOpportunity(client: PoolClient, tenantId: string, opportunityIds: string[]) {
  if (!opportunityIds.length) {
    return new Map<string, number>();
  }

  const { rows } = await client.query<{ opportunity_id: string; count: string }>(
    `
      SELECT opportunity_id, count(*)::text AS count
      FROM sales_pipeline_alert
      WHERE tenant_id = $1
        AND status = 'open'
        AND opportunity_id = ANY($2::uuid[])
      GROUP BY opportunity_id
    `,
    [tenantId, opportunityIds]
  );

  return new Map(rows.map((row) => [row.opportunity_id, Number(row.count)]));
}

async function loadOpenSalesPipelineAlerts(
  client: PoolClient,
  tenantId: string,
  filters: {
    pipelineTypes?: readonly SalesPipelineType[];
    ownerId?: string | null;
    opportunityId?: string | null;
    organizationId?: string | null;
    limit?: number;
  } = {}
) {
  const { rows } = await client.query<SalesPipelineAlertRow>(
    `
      SELECT
        spa.id,
        spa.alert_type::text AS alert_type,
        spa.status::text AS status,
        spa.severity::text AS severity,
        spa.dedupe_key,
        spa.pipeline_type::text AS pipeline_type,
        spa.opportunity_id,
        spa.organization_id,
        spa.agreement_id,
        spa.linked_shoot_id,
        spa.title,
        spa.message,
        spa.due_at::text,
        spa.first_triggered_at::text,
        spa.last_triggered_at::text,
        spa.first_notified_at::text,
        spa.last_notified_at::text,
        spa.resolved_at::text,
        spa.metadata,
        spa.created_at::text,
        spa.updated_at::text
      FROM sales_pipeline_alert spa
      LEFT JOIN sales_opportunity so
        ON so.tenant_id = spa.tenant_id
       AND so.id = spa.opportunity_id
      WHERE spa.tenant_id = $1
        AND spa.status = 'open'
        AND ($2::uuid IS NULL OR spa.opportunity_id = $2 OR so.id = $2)
        AND ($3::uuid IS NULL OR spa.organization_id = $3 OR so.organization_id = $3)
        AND ($4::uuid IS NULL OR so.owner_id = $4)
        AND ($5::text[] IS NULL OR spa.pipeline_type::text = ANY($5::text[]) OR so.pipeline_type::text = ANY($5::text[]))
      ORDER BY
        CASE spa.severity
          WHEN 'critical' THEN 0
          WHEN 'major' THEN 1
          ELSE 2
        END,
        COALESCE(spa.due_at, spa.last_triggered_at) ASC,
        spa.created_at DESC
      LIMIT $6
    `,
    [
      tenantId,
      filters.opportunityId ?? null,
      filters.organizationId ?? null,
      filters.ownerId ?? null,
      filters.pipelineTypes?.length ? filters.pipelineTypes : null,
      filters.limit ?? 20
    ]
  );

  return rows.map(mapSalesPipelineAlert);
}

async function loadSalesEmailTemplates(client: PoolClient, tenantId: string): Promise<SalesEmailTemplateRecord[]> {
  const { rows } = await client.query<SalesEmailTemplateRow>(
    `
      SELECT
        id,
        template_key::text AS template_key,
        template_name,
        subject_template,
        body_template,
        merge_fields,
        active_status,
        automation_enabled,
        created_at::text,
        updated_at::text
      FROM sales_email_template
      WHERE tenant_id = $1
        AND active_status = true
      ORDER BY template_name
    `,
    [tenantId]
  );

  return rows.map((row) => ({
    id: row.id,
    template_key: row.template_key,
    template_name: row.template_name,
    subject_template: row.subject_template,
    body_template: row.body_template,
    merge_fields: Array.isArray(row.merge_fields) ? row.merge_fields.filter((value): value is string => typeof value === "string") : [],
    active_status: row.active_status,
    automation_enabled: row.automation_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

async function loadSalesEmailTemplateById(client: PoolClient, tenantId: string, templateId: string): Promise<SalesEmailTemplateRecord | null> {
  const { rows } = await client.query<SalesEmailTemplateRow>(
    `
      SELECT
        id,
        template_key::text AS template_key,
        template_name,
        subject_template,
        body_template,
        merge_fields,
        active_status,
        automation_enabled,
        created_at::text,
        updated_at::text
      FROM sales_email_template
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, templateId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    template_key: row.template_key,
    template_name: row.template_name,
    subject_template: row.subject_template,
    body_template: row.body_template,
    merge_fields: Array.isArray(row.merge_fields) ? row.merge_fields.filter((value): value is string => typeof value === "string") : [],
    active_status: row.active_status,
    automation_enabled: row.automation_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function loadSalesEmailCommunicationById(
  client: PoolClient,
  tenantId: string,
  communicationId: string
): Promise<SalesEmailCommunicationRecord | null> {
  const rows = await loadSalesEmailCommunications(client, tenantId, {
    communicationId,
    limit: 1
  });
  return rows[0] ?? null;
}

async function loadSalesEmailCommunications(
  client: PoolClient,
  tenantId: string,
  filters: {
    opportunityId?: string | null;
    organizationId?: string | null;
    communicationId?: string | null;
    limit?: number;
  }
): Promise<SalesEmailCommunicationRecord[]> {
  const { rows } = await client.query<SalesEmailCommunicationRow>(
    `
      SELECT
        sec.id,
        sec.template_id,
        sec.template_key::text AS template_key,
        sec.template_name_snapshot,
        sec.opportunity_id,
        sec.organization_id,
        sec.contact_id,
        contact.full_name AS contact_name,
        contact.email AS contact_email,
        sec.sent_by_user_id,
        sender.full_name AS sent_by_name,
        sec.trigger_type::text AS trigger_type,
        sec.status::text AS status,
        sec.subject,
        sec.body,
        sec.queued_at::text,
        sec.sent_at::text,
        sec.last_delivery_attempt_at::text,
        sec.delivery_provider,
        sec.delivery_reference,
        sec.provider_error_state,
        sec.metadata,
        sec.created_at::text,
        sec.updated_at::text
      FROM sales_email_communication sec
      LEFT JOIN organization_contact contact
        ON contact.tenant_id = sec.tenant_id
       AND contact.id = sec.contact_id
      LEFT JOIN app_user sender
        ON sender.id = sec.sent_by_user_id
      WHERE sec.tenant_id = $1
        AND ($2::uuid IS NULL OR sec.id = $2)
        AND ($3::uuid IS NULL OR sec.opportunity_id = $3)
        AND ($4::uuid IS NULL OR sec.organization_id = $4)
      ORDER BY sec.created_at DESC
      LIMIT $5
    `,
    [tenantId, filters.communicationId ?? null, filters.opportunityId ?? null, filters.organizationId ?? null, filters.limit ?? 20]
  );

  if (!rows.length) {
    return [];
  }

  const communicationIds = rows.map((row) => row.id);
  const { rows: eventRows } = await client.query<SalesEmailCommunicationEventRow>(
    `
      SELECT
        sece.id,
        sece.communication_id,
        sece.event_type::text AS event_type,
        sece.actor_user_id,
        actor.full_name AS actor_name,
        sece.note,
        sece.metadata,
        sece.timestamp::text,
        sece.created_at::text
      FROM sales_email_communication_event sece
      LEFT JOIN app_user actor
        ON actor.id = sece.actor_user_id
      WHERE sece.tenant_id = $1
        AND sece.communication_id = ANY($2::uuid[])
      ORDER BY sece.timestamp DESC, sece.created_at DESC
    `,
    [tenantId, communicationIds]
  );

  const eventsByCommunication = new Map<string, SalesEmailCommunicationRecord["events"]>();
  for (const eventRow of eventRows) {
    const events = eventsByCommunication.get(eventRow.communication_id) ?? [];
    events.push({
      id: eventRow.id,
      communication_id: eventRow.communication_id,
      event_type: eventRow.event_type,
      actor_user_id: eventRow.actor_user_id,
      actor_name: eventRow.actor_name,
      note: eventRow.note,
      metadata: eventRow.metadata ?? {},
      timestamp: eventRow.timestamp,
      created_at: eventRow.created_at
    });
    eventsByCommunication.set(eventRow.communication_id, events);
  }

  return rows.map((row) => ({
    id: row.id,
    template_id: row.template_id,
    template_key: row.template_key,
    template_name: row.template_name_snapshot,
    opportunity_id: row.opportunity_id,
    organization_id: row.organization_id,
    contact_id: row.contact_id,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    sent_by_user_id: row.sent_by_user_id,
    sent_by_name: row.sent_by_name,
    trigger_type: row.trigger_type,
    status: row.status,
    subject: row.subject,
    body: row.body,
    queued_at: row.queued_at,
    sent_at: row.sent_at,
    last_delivery_attempt_at: row.last_delivery_attempt_at,
    delivery_provider: row.delivery_provider,
    delivery_reference: row.delivery_reference,
    provider_error_state: row.provider_error_state,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    events: eventsByCommunication.get(row.id) ?? []
  }));
}

async function insertSalesEmailCommunicationEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    communicationId: string;
    eventType: SalesEmailEventType;
    actorUserId?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO sales_email_communication_event (
        tenant_id,
        communication_id,
        event_type,
        actor_user_id,
        note,
        metadata
      )
      VALUES ($1,$2,$3::sales_email_event_type,$4,$5,$6::jsonb)
    `,
    [
      input.tenantId,
      input.communicationId,
      input.eventType,
      input.actorUserId ?? null,
      input.note ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function loadScopedOrganizationContact(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  contactId: string
): Promise<OrganizationContactInfo | null> {
  const { rows } = await client.query<OrganizationContactInfo>(
    `
      SELECT id, organization_id, full_name, email, phone
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = $3
      LIMIT 1
    `,
    [tenantId, organizationId, contactId]
  );
  return rows[0] ?? null;
}

type SalesEmailMergeContext = {
  organization_name: string;
  contact_name: string;
  sender_name: string;
  estimated_value: string;
  next_action_date: string;
  opportunity_stage: string;
  pipeline_type: string;
  opportunity_type: string;
};

function buildSalesEmailMergeContext(input: {
  organizationName: string;
  contactName: string;
  senderName: string;
  opportunity: SalesOpportunityRow | null;
}): SalesEmailMergeContext {
  return {
    organization_name: input.organizationName,
    contact_name: input.contactName,
    sender_name: input.senderName,
    estimated_value: input.opportunity ? formatCurrencyPlain(parseNumeric(input.opportunity.estimated_value)) : "Not set",
    next_action_date: input.opportunity?.next_action_date ? input.opportunity.next_action_date : "Not scheduled",
    opportunity_stage: input.opportunity ? STAGE_LABELS[input.opportunity.stage] : "Not linked",
    pipeline_type: input.opportunity ? labelForPipelineType(input.opportunity.pipeline_type) : "Not linked",
    opportunity_type: input.opportunity ? labelForOpportunityTypePlain(input.opportunity.opportunity_type) : "Not linked"
  };
}

function renderSalesEmailTemplate(template: string, context: SalesEmailMergeContext) {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, token: string) => {
    const value = context[token as keyof SalesEmailMergeContext];
    return typeof value === "string" ? value : "";
  });
}

async function buildAutomationSummary(
  client: PoolClient,
  tenantId: string,
  rows: SalesOpportunitySummary[]
): Promise<SalesPipelineAutomationSummary> {
  const opportunityIds = rows.map((row) => row.id);
  const organizationIds = [...new Set(rows.map((row) => row.organization_id).filter(Boolean))];

  const alertCounts = opportunityIds.length
    ? await client.query<{ alert_type: SalesPipelineAlertRecord["alert_type"]; count: string }>(
        `
          SELECT alert_type::text AS alert_type, count(*)::text AS count
          FROM sales_pipeline_alert
          WHERE tenant_id = $1
            AND status = 'open'
            AND opportunity_id = ANY($2::uuid[])
          GROUP BY alert_type
        `,
        [tenantId, opportunityIds]
      )
    : { rows: [] as Array<{ alert_type: SalesPipelineAlertRecord["alert_type"]; count: string }> };

  const countByType = new Map(alertCounts.rows.map((row) => [row.alert_type, Number(row.count)]));
  const agreementSignals = await loadAgreementAutomationSummary(client, tenantId, organizationIds);

  return {
    missing_next_action: countByType.get("missing_next_action") ?? 0,
    inactive_opportunities: countByType.get("inactive_opportunity") ?? 0,
    meeting_scheduled: countByType.get("meeting_scheduled") ?? 0,
    contract_reminders_due: agreementSignals.contractRemindersDue,
    renewals_due: agreementSignals.renewalsDue,
    upcoming_shoot_risk: agreementSignals.upcomingShootRisk,
    pending_unsigned_accounts: agreementSignals.pendingUnsignedAccounts,
    accounts_missing_active_agreement: agreementSignals.accountsMissingActiveAgreement
  };
}

async function loadAgreementAutomationSummary(client: PoolClient, tenantId: string, organizationIds: string[]) {
  if (!organizationIds.length) {
    return {
      contractRemindersDue: 0,
      renewalsDue: 0,
      upcomingShootRisk: 0,
      pendingUnsignedAccounts: 0,
      accountsMissingActiveAgreement: 0
    };
  }

  const agreementResult = await client.query<AgreementAutomationRow>(
    `
      SELECT
        a.id AS agreement_id,
        a.organization_id,
        a.status::text AS status,
        a.sent_at::text,
        a.created_at::text,
        a.expiration_date::text
      FROM agreement a
      WHERE a.tenant_id = $1
        AND a.organization_id = ANY($2::uuid[])
        AND a.status NOT IN ('replaced', 'cancelled')
    `,
    [tenantId, organizationIds]
  );

  const agreementIds = agreementResult.rows.map((row) => row.agreement_id);
  const reminderResult = agreementIds.length
    ? await client.query<AgreementReminderSignalRow>(
        `
          SELECT agreement_id, reminder_type::text AS reminder_type, status::text AS status
          FROM agreement_reminder
          WHERE tenant_id = $1
            AND agreement_id = ANY($2::uuid[])
        `,
        [tenantId, agreementIds]
      )
    : { rows: [] as AgreementReminderSignalRow[] };

  const sentReminderTypesByAgreement = new Map<string, Set<AgreementReminderType>>();
  for (const row of reminderResult.rows) {
    if (!["queued", "sent"].includes(row.status)) {
      continue;
    }
    const sentTypes = sentReminderTypesByAgreement.get(row.agreement_id) ?? new Set<AgreementReminderType>();
    sentTypes.add(row.reminder_type);
    sentReminderTypesByAgreement.set(row.agreement_id, sentTypes);
  }

  const activeOrganizations = new Set<string>();
  const pendingUnsignedOrganizations = new Set<string>();
  let contractRemindersDue = 0;
  let renewalsDue = 0;

  for (const agreement of agreementResult.rows) {
    if (!agreement.organization_id) {
      continue;
    }
    if (agreement.status === "active") {
      activeOrganizations.add(agreement.organization_id);
    }
    if (["draft", "sent", "viewed", "partially_signed", "signed"].includes(agreement.status)) {
      pendingUnsignedOrganizations.add(agreement.organization_id);
    }

    const dueTypes = deriveAgreementReminderTypesForAutomation(
      agreement,
      sentReminderTypesByAgreement.get(agreement.agreement_id) ?? new Set<AgreementReminderType>()
    );
    for (const dueType of dueTypes) {
      if (dueType.startsWith("unsigned_")) {
        contractRemindersDue += 1;
      } else if (dueType.startsWith("expiration_")) {
        renewalsDue += 1;
      }
    }
  }

  let upcomingShootRisk = 0;
  if (organizationIds.length) {
    const { rows: shootRows } = await client.query<UpcomingShootAgreementRiskRow>(
      `
        SELECT s.id AS shoot_id, s.organization_id
        FROM shoot s
        WHERE s.tenant_id = $1
          AND s.deleted_at IS NULL
          AND s.organization_id = ANY($2::uuid[])
          AND s.shoot_date >= current_date
          AND s.shoot_date <= current_date + $3::integer
      `,
      [tenantId, organizationIds, UPCOMING_SHOOT_RISK_WINDOW_DAYS]
    );

    upcomingShootRisk = shootRows.filter(
      (row) => row.organization_id && (!activeOrganizations.has(row.organization_id) || pendingUnsignedOrganizations.has(row.organization_id))
    ).length;
  }

  return {
    contractRemindersDue,
    renewalsDue,
    upcomingShootRisk,
    pendingUnsignedAccounts: [...pendingUnsignedOrganizations].filter((organizationId) => !activeOrganizations.has(organizationId)).length,
    accountsMissingActiveAgreement: organizationIds.filter((organizationId) => !activeOrganizations.has(organizationId)).length
  };
}

function deriveAgreementReminderTypesForAutomation(
  agreement: Pick<AgreementAutomationRow, "status" | "sent_at" | "created_at" | "expiration_date">,
  sentTypes: Set<AgreementReminderType>
) {
  const currentDay = todayIso();
  const due: AgreementReminderType[] = [];
  const sendAnchor = agreement.sent_at?.slice(0, 10) ?? agreement.created_at.slice(0, 10);
  const unsigned = ["draft", "sent", "viewed", "partially_signed", "signed"].includes(agreement.status);
  if (unsigned) {
    const ageDays = diffDays(sendAnchor, currentDay);
    if (ageDays >= 30) {
      if (!sentTypes.has("unsigned_30_day")) {
        due.push("unsigned_30_day");
      }
    } else if (ageDays >= 7) {
      if (!sentTypes.has("unsigned_7_day")) {
        due.push("unsigned_7_day");
      }
    } else if (ageDays >= 3) {
      if (!sentTypes.has("unsigned_3_day")) {
        due.push("unsigned_3_day");
      }
    }
  }
  if (agreement.expiration_date) {
    const daysUntilExpiration = diffDays(currentDay, agreement.expiration_date);
    if (daysUntilExpiration <= 30 && daysUntilExpiration >= 0) {
      if (!sentTypes.has("expiration_30_day")) {
        due.push("expiration_30_day");
      }
    } else if (daysUntilExpiration <= 90 && daysUntilExpiration >= 0) {
      if (!sentTypes.has("expiration_90_day")) {
        due.push("expiration_90_day");
      }
    } else if (daysUntilExpiration <= 180 && daysUntilExpiration >= 0) {
      if (!sentTypes.has("expiration_6_month")) {
        due.push("expiration_6_month");
      }
    }
  }
  return [...new Set(due)];
}

function mapSalesPipelineAlert(row: SalesPipelineAlertRow): SalesPipelineAlertRecord {
  return {
    id: row.id,
    alert_type: row.alert_type,
    status: row.status,
    severity: row.severity,
    dedupe_key: row.dedupe_key,
    pipeline_type: row.pipeline_type,
    opportunity_id: row.opportunity_id,
    organization_id: row.organization_id,
    agreement_id: row.agreement_id,
    linked_shoot_id: row.linked_shoot_id,
    title: row.title,
    message: row.message,
    due_at: row.due_at,
    first_triggered_at: row.first_triggered_at,
    last_triggered_at: row.last_triggered_at,
    first_notified_at: row.first_notified_at,
    last_notified_at: row.last_notified_at,
    resolved_at: row.resolved_at,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function requiresEstimatedValue(stage: SalesOpportunityStage) {
  return stageOrderIndex(stage) >= stageOrderIndex("proposal_sent") && !["lost", "dormant"].includes(stage);
}

function requiresContactInfo(stage: SalesOpportunityStage) {
  return stageOrderIndex(stage) >= stageOrderIndex("contract_sent") && !["lost", "dormant"].includes(stage);
}

function requiresSignedAgreement(stage: SalesOpportunityStage) {
  return stage === "won";
}

function deriveOpportunityStatus(stage: SalesOpportunityStage): SalesOpportunityStatus {
  if (stage === "won") {
    return "won";
  }
  if (stage === "lost") {
    return "lost";
  }
  if (stage === "dormant") {
    return "dormant";
  }
  return "active";
}

function assertDormantFollowUp(stage: SalesOpportunityStage, followUpDate: string | null) {
  if (stage === "dormant" && !followUpDate) {
    throw new ApiError(400, "Dormant opportunities require a follow-up date.");
  }
}

function stageOrderIndex(stage: SalesOpportunityStage) {
  return STAGE_ORDER.indexOf(stage);
}

function parseNumeric(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredDate(value: string | null | undefined, message: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new ApiError(400, message);
  }
  return value.trim();
}

function normalizeOptionalDate(value?: string | null) {
  if (!value) {
    return null;
  }
  return normalizeRequiredDate(value, "Date values must use YYYY-MM-DD.");
}

function addDaysToIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const to = new Date(`${toIso}T00:00:00.000Z`);
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function formatCurrencyPlain(value: number | null) {
  if (value === null) {
    return "Not set";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function labelForPipelineType(value: SalesPipelineType) {
  return value === "schools" ? "Schools Pipeline" : "Sports Pipeline";
}

function labelForOpportunityTypePlain(value: SalesOpportunityType) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function isLeadershipLike(auth: Pick<AuthUser, "authorityTier">) {
  return ["super_admin", "leadership", "director_admin"].includes(auth.authorityTier);
}

function assertCanViewSalesPipeline(auth: AuthUser) {
  if (!canViewSalesPipeline(auth)) {
    throw new ApiError(403, "You do not have access to the sales pipeline.");
  }
}

function assertCanManageSalesPipeline(auth: AuthUser) {
  if (!canManageSalesPipeline(auth)) {
    throw new ApiError(403, "You do not have permission to manage the sales pipeline.");
  }
}
