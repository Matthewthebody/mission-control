import type { PoolClient } from "pg";
import { canManageAgreements, canViewAgreements } from "../authz/authority.js";
import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type {
  AgreementAccess,
  AgreementAccountWarningRecord,
  AgreementActivityRecord,
  AgreementActivityType,
  AgreementExternalProviderName,
  AgreementFileRecord,
  AgreementFileType,
  AgreementLifecycleBucket,
  AgreementLinkRecord,
  AgreementProviderEventDirection,
  AgreementProviderEventRecord,
  AgreementProviderEventType,
  AgreementProviderLifecycleBucket,
  AgreementProviderSyncHealth,
  AgreementRecord,
  AgreementReminderChannel,
  AgreementReminderRecord,
  AgreementReminderStatus,
  AgreementReminderType,
  AgreementSignerRecord,
  AgreementSignerStatus,
  AgreementSignerType,
  AgreementStatus,
  AgreementTemplateRecord,
  AgreementType,
  AgreementUpcomingShootRisk,
  AgreementVersionRecord,
  AgreementVersionStage,
  AgreementWarningCode,
  AgreementWarningSeverity,
  OrganizationAgreementSummary
} from "../types/agreements.js";
import { createAuditLog } from "./audit.js";
import { createAppEvent } from "./outbox.js";

type AgreementListRow = {
  id: string;
  agreement_title: string;
  agreement_type: AgreementType;
  status: AgreementStatus;
  organization_id: string | null;
  organization_display_name: string | null;
  client_account_id: string | null;
  client_account_display_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  source_template_id: string | null;
  source_template_name: string | null;
  description: string | null;
  contract_value: string | number | null;
  revenue_share_terms: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  renewal_date: string | null;
  notice_deadline: string | null;
  auto_renew: boolean | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  countersigned_at: string | null;
  external_provider_name: AgreementExternalProviderName | null;
  external_envelope_id: string | null;
  external_status: string | null;
  last_provider_sync_at: string | null;
  provider_error_state: string | null;
  provider_metadata: Record<string, unknown> | null;
  internal_countersigner_user_id: string | null;
  internal_countersigner_name: string | null;
  created_by_user_id: string;
  created_by_name: string | null;
  updated_by_user_id: string;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  replaced_by_agreement_id: string | null;
  replaced_by_agreement_title: string | null;
  prior_agreement_id: string | null;
  prior_agreement_title: string | null;
};

type AgreementFileRow = {
  id: string;
  agreement_id: string;
  agreement_version_id: string | null;
  file_type: AgreementFileType;
  file_name: string;
  storage_reference: string;
  file_url: string | null;
  content_type: string | null;
  file_size_bytes: string | number | null;
  version_label: string | null;
  is_current: boolean;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

type AgreementLinkRow = {
  id: string;
  agreement_id: string;
  linked_entity_type: AgreementLinkRecord["linked_entity_type"];
  linked_entity_id: string;
  relationship_type: string;
  label: string | null;
  secondary_label: string | null;
  created_at: string;
};

type AgreementActivityRow = {
  id: string;
  agreement_id: string;
  activity_type: AgreementActivityType;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  timestamp: string;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

type AgreementTemplateRow = {
  id: string;
  template_name: string;
  agreement_type: AgreementType;
  active_status: boolean;
  template_body: string | null;
  template_file_reference: string | null;
  merge_fields: unknown;
  created_by_user_id: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type AgreementSignerRow = {
  id: string;
  agreement_id: string;
  contact_id: string | null;
  signer_name: string;
  signer_email: string | null;
  signer_role: string | null;
  signer_order: number | null;
  signer_type: AgreementSignerType;
  status: AgreementSignerStatus;
  external_recipient_id: string | null;
  external_status: string | null;
  last_provider_sync_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
};

type AgreementProviderEventRow = {
  id: string;
  agreement_id: string;
  signer_id: string | null;
  provider_name: string;
  external_envelope_id: string | null;
  external_recipient_id: string | null;
  direction: AgreementProviderEventDirection;
  event_type: AgreementProviderEventType;
  provider_status: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
};

type AgreementVersionRow = {
  id: string;
  agreement_id: string;
  version_number: string | number;
  version_label: string;
  version_stage: AgreementVersionStage;
  prior_version_id: string | null;
  source_template_id: string | null;
  source_template_name: string | null;
  rendered_body: string | null;
  merge_snapshot: Record<string, unknown> | null;
  is_current: boolean;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type AgreementReminderRow = {
  id: string;
  agreement_id: string;
  signer_id: string | null;
  reminder_type: AgreementReminderType;
  reminder_channel: AgreementReminderChannel;
  status: AgreementReminderStatus;
  follow_up_state: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  due_at: string | null;
  sent_at: string | null;
  triggered_by_user_id: string | null;
  triggered_by_name: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type OrganizationCoverageRow = {
  agreement_id: string;
  organization_id: string | null;
  client_account_id: string | null;
  status: AgreementStatus;
  effective_date: string | null;
  expiration_date: string | null;
  renewal_date: string | null;
  notice_deadline: string | null;
};

type OrganizationMergeContext = {
  organizationName: string;
  primaryContactName: string | null;
};

type UpcomingShootRow = {
  shoot_id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  organization_id: string | null;
  organization_display_name: string | null;
};

export type AgreementSignerInput = {
  contact_id?: string | null;
  signer_name: string;
  signer_email?: string | null;
  signer_role?: string | null;
  signer_order?: number | null;
  signer_type: AgreementSignerType;
  status?: AgreementSignerStatus;
  viewed_at?: string | null;
  signed_at?: string | null;
};

export type CreateAgreementInput = {
  agreement_title: string;
  agreement_type: AgreementType;
  status?: AgreementStatus;
  primary_contact_id?: string | null;
  description?: string | null;
  contract_value?: number | null;
  revenue_share_terms?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  renewal_date?: string | null;
  notice_deadline?: string | null;
  auto_renew?: boolean | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  signed_at?: string | null;
  countersigned_at?: string | null;
  prior_agreement_id?: string | null;
  replaced_by_agreement_id?: string | null;
  linked_contact_ids?: string[];
  linked_location_ids?: string[];
  source_template_id?: string | null;
  signers?: AgreementSignerInput[];
  initial_version_label?: string | null;
  initial_version_stage?: AgreementVersionStage | null;
  rendered_body?: string | null;
  merge_snapshot?: Record<string, unknown>;
};

export type UpdateAgreementInput = CreateAgreementInput & {
  note?: string | null;
};

export type RegisterAgreementFileInput = {
  file_type: AgreementFileType;
  file_name: string;
  storage_reference: string;
  file_url?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  version_label?: string | null;
  is_current?: boolean;
  activity_note?: string | null;
  legacy_upload?: boolean;
  agreement_version_id?: string | null;
  version_stage?: AgreementVersionStage | null;
  create_version?: boolean;
};

export type CreateAgreementTemplateInput = {
  template_name: string;
  agreement_type: AgreementType;
  active_status?: boolean;
  template_body?: string | null;
  template_file_reference?: string | null;
  merge_fields?: string[];
};

export type CreateAgreementFromTemplateInput = {
  template_id: string;
  agreement_title?: string | null;
  primary_contact_id?: string | null;
  description?: string | null;
  contract_value?: number | null;
  revenue_share_terms?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  renewal_date?: string | null;
  notice_deadline?: string | null;
  auto_renew?: boolean | null;
  signers?: AgreementSignerInput[];
  linked_contact_ids?: string[];
  linked_location_ids?: string[];
  note?: string | null;
};

export type SendAgreementReminderInput = {
  reminder_type: AgreementReminderType;
  channels?: AgreementReminderChannel[];
  note?: string | null;
};

export type SendAgreementForSignatureInput = {
  agreement_version_id?: string | null;
  provider_name?: AgreementExternalProviderName | null;
  note?: string | null;
};

export type SyncAgreementProviderStatusInput = {
  note?: string | null;
};

export type CreateAgreementRenewalInput = {
  agreement_title?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  renewal_date?: string | null;
  notice_deadline?: string | null;
  auto_renew?: boolean | null;
  signers?: AgreementSignerInput[];
  note?: string | null;
};

export async function getOrganizationAgreementsView(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string
): Promise<{
  agreements_access: AgreementAccess;
  agreement_summary: OrganizationAgreementSummary;
  agreements: AgreementRecord[];
  agreement_templates: AgreementTemplateRecord[];
  upcoming_shoot_agreement_risks: AgreementUpcomingShootRisk[];
}> {
  const access = {
    can_view: canViewAgreements(auth),
    can_manage: canManageAgreements(auth)
  };
  if (!access.can_view) {
    return {
      agreements_access: access,
      agreement_summary: emptyAgreementSummary(),
      agreements: [],
      agreement_templates: [],
      upcoming_shoot_agreement_risks: []
    };
  }

  const [agreementRows, templateRows, upcomingShootRows] = await Promise.all([
    client.query<AgreementListRow>(
      `
        SELECT
          a.id,
          a.agreement_title,
          a.agreement_type,
          a.status,
          a.organization_id,
          org.display_name AS organization_display_name,
          a.client_account_id,
          client_org.display_name AS client_account_display_name,
          a.primary_contact_id,
          primary_contact.full_name AS primary_contact_name,
          primary_contact.email AS primary_contact_email,
          primary_contact.phone AS primary_contact_phone,
          a.source_template_id,
          template.template_name AS source_template_name,
          a.description,
          a.contract_value::text,
          a.revenue_share_terms,
          a.effective_date::text,
          a.expiration_date::text,
          a.renewal_date::text,
          a.notice_deadline::text,
          a.auto_renew,
          a.sent_at::text,
          a.viewed_at::text,
          a.signed_at::text,
          a.countersigned_at::text,
          a.external_provider_name,
          a.external_envelope_id,
          a.external_status,
          a.last_provider_sync_at::text,
          a.provider_error_state,
          a.provider_metadata,
          a.internal_countersigner_user_id,
          countersigner.full_name AS internal_countersigner_name,
          a.created_by_user_id,
          created_by.full_name AS created_by_name,
          a.updated_by_user_id,
          updated_by.full_name AS updated_by_name,
          a.created_at::text,
          a.updated_at::text,
          a.replaced_by_agreement_id,
          replacement.agreement_title AS replaced_by_agreement_title,
          a.prior_agreement_id,
          prior.agreement_title AS prior_agreement_title
        FROM agreement a
        LEFT JOIN organization org
          ON org.tenant_id = a.tenant_id
         AND org.id = a.organization_id
        LEFT JOIN organization client_org
          ON client_org.tenant_id = a.tenant_id
         AND client_org.id = a.client_account_id
        LEFT JOIN organization_contact primary_contact
          ON primary_contact.tenant_id = a.tenant_id
         AND primary_contact.id = a.primary_contact_id
        LEFT JOIN agreement_template template
          ON template.tenant_id = a.tenant_id
         AND template.id = a.source_template_id
        LEFT JOIN app_user countersigner
          ON countersigner.tenant_id = a.tenant_id
         AND countersigner.id = a.internal_countersigner_user_id
        LEFT JOIN app_user created_by
          ON created_by.tenant_id = a.tenant_id
         AND created_by.id = a.created_by_user_id
        LEFT JOIN app_user updated_by
          ON updated_by.tenant_id = a.tenant_id
         AND updated_by.id = a.updated_by_user_id
        LEFT JOIN agreement replacement
          ON replacement.tenant_id = a.tenant_id
         AND replacement.id = a.replaced_by_agreement_id
        LEFT JOIN agreement prior
          ON prior.tenant_id = a.tenant_id
         AND prior.id = a.prior_agreement_id
        WHERE a.tenant_id = $1
          AND (
            a.organization_id = $2
            OR a.client_account_id = $2
            OR EXISTS (
              SELECT 1
              FROM organization_contact oc
              WHERE oc.tenant_id = a.tenant_id
                AND oc.id = a.primary_contact_id
                AND oc.organization_id = $2
            )
            OR EXISTS (
              SELECT 1
              FROM agreement_link al
              WHERE al.tenant_id = a.tenant_id
                AND al.agreement_id = a.id
                AND al.linked_entity_type = 'organization'
                AND al.linked_entity_id = $2
            )
            OR EXISTS (
              SELECT 1
              FROM agreement_link al
              JOIN organization_contact oc
                ON oc.tenant_id = al.tenant_id
               AND oc.id = al.linked_entity_id
              WHERE al.tenant_id = a.tenant_id
                AND al.agreement_id = a.id
                AND al.linked_entity_type = 'organization_contact'
                AND oc.organization_id = $2
            )
            OR EXISTS (
              SELECT 1
              FROM agreement_link al
              JOIN shoot_location sl
                ON sl.tenant_id = al.tenant_id
               AND sl.id = al.linked_entity_id
              WHERE al.tenant_id = a.tenant_id
                AND al.agreement_id = a.id
                AND al.linked_entity_type = 'shoot_location'
                AND sl.organization_id = $2
            )
          )
        ORDER BY
          COALESCE(a.expiration_date, DATE '9999-12-31') ASC,
          a.updated_at DESC,
          lower(a.agreement_title) ASC
      `,
      [auth.tenantId, organizationId]
    ),
    client.query<AgreementTemplateRow>(
      `
        SELECT
          at.id,
          at.template_name,
          at.agreement_type,
          at.active_status,
          at.template_body,
          at.template_file_reference,
          at.merge_fields,
          at.created_by_user_id,
          creator.full_name AS created_by_name,
          at.created_at::text,
          at.updated_at::text
        FROM agreement_template at
        LEFT JOIN app_user creator
          ON creator.tenant_id = at.tenant_id
         AND creator.id = at.created_by_user_id
        WHERE at.tenant_id = $1
        ORDER BY at.active_status DESC, lower(at.template_name) ASC
      `,
      [auth.tenantId]
    ),
    loadUpcomingShootRows(client, auth.tenantId, organizationId)
  ]);

  const agreementIds = agreementRows.rows.map((row) => row.id);
  if (!agreementIds.length) {
    const emptySummary = emptyAgreementSummary();
    const upcomingShootRisks = upcomingShootRows.map((row) => classifyUpcomingShootRisk(row, emptySummary));
    return {
      agreements_access: access,
      agreement_summary: buildAgreementSummary([], upcomingShootRisks),
      agreements: [],
      agreement_templates: templateRows.rows.map(mapAgreementTemplate),
      upcoming_shoot_agreement_risks: upcomingShootRisks
    };
  }

  const [fileResult, linkResult, activityResult, signerResult, versionResult, reminderResult, providerEventResult] = await Promise.all([
    loadAgreementFiles(client, auth.tenantId, agreementIds),
    loadAgreementLinks(client, auth.tenantId, agreementIds),
    loadAgreementActivity(client, auth.tenantId, agreementIds),
    loadAgreementSignersByIds(client, auth.tenantId, agreementIds),
    loadAgreementVersions(client, auth.tenantId, agreementIds),
    loadAgreementReminders(client, auth.tenantId, agreementIds),
    loadAgreementProviderEvents(client, auth.tenantId, agreementIds)
  ]);

  const filesByAgreement = groupByAgreement(fileResult.rows, mapAgreementFile);
  const linksByAgreement = groupByAgreement(linkResult.rows, mapAgreementLink);
  const activityByAgreement = groupByAgreement(activityResult.rows, mapAgreementActivity);
  const signersByAgreement = groupByAgreement(signerResult.rows, mapAgreementSigner);
  const remindersByAgreement = groupByAgreement(reminderResult.rows, mapAgreementReminder);
  const providerEventsByAgreement = groupByAgreement(providerEventResult.rows, mapAgreementProviderEvent);
  const filesByVersion = new Map<string, AgreementFileRecord[]>();
  for (const row of fileResult.rows) {
    if (!row.agreement_version_id) {
      continue;
    }
    const list = filesByVersion.get(row.agreement_version_id) ?? [];
    list.push(mapAgreementFile(row));
    filesByVersion.set(row.agreement_version_id, list);
  }
  const versionsByAgreement = new Map<string, AgreementVersionRecord[]>();
  for (const row of versionResult.rows) {
    const list = versionsByAgreement.get(row.agreement_id) ?? [];
    list.push(mapAgreementVersion(row, filesByVersion.get(row.id) ?? []));
    versionsByAgreement.set(row.agreement_id, list);
  }

  const agreements = agreementRows.rows.map((row) => {
    const lifecycleBucket = deriveAgreementLifecycleBucket(row);
    const reminders = remindersByAgreement.get(row.id) ?? [];
    const dueReminders = deriveDueReminderTypes(row, reminders);
    const warningState = deriveAgreementWarningState(row, lifecycleBucket, dueReminders);
    const signers = signersByAgreement.get(row.id) ?? [];
    const providerEvents = providerEventsByAgreement.get(row.id) ?? [];
    const providerLifecycle = deriveAgreementProviderLifecycle(row, signers, providerEvents);
    return mapAgreementRecord(row, lifecycleBucket, {
      signers,
      versions: versionsByAgreement.get(row.id) ?? [],
      files: filesByAgreement.get(row.id) ?? [],
      links: linksByAgreement.get(row.id) ?? [],
      reminders,
      due_reminders: dueReminders,
      warning_codes: warningState.codes,
      warning_severity: warningState.severity,
      warning_summary: warningState.summary,
      provider_lifecycle_bucket: providerLifecycle.bucket,
      provider_sync_health: providerLifecycle.health,
      provider_events: providerEvents,
      activity_log: activityByAgreement.get(row.id) ?? []
    });
  });

  const preliminarySummary = buildAgreementSummary(agreements, []);
  const upcomingShootRisks = upcomingShootRows.map((row) => classifyUpcomingShootRisk(row, preliminarySummary));
  return {
    agreements_access: access,
    agreement_summary: buildAgreementSummary(agreements, upcomingShootRisks),
    agreements,
    agreement_templates: templateRows.rows.map(mapAgreementTemplate),
    upcoming_shoot_agreement_risks: upcomingShootRisks
  };
}

export async function createAgreement(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateAgreementInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  await assertOrganizationExists(client, auth.tenantId, organizationId);

  const linkedContactIds = dedupeIds(input.linked_contact_ids ?? []);
  const linkedLocationIds = dedupeIds(input.linked_location_ids ?? []);
  await assertPrimaryContactBelongsToOrganization(client, auth.tenantId, organizationId, input.primary_contact_id ?? null);
  await assertLinkedContactsBelongToOrganization(client, auth.tenantId, organizationId, linkedContactIds);
  await assertLinkedLocationsBelongToOrganization(client, auth.tenantId, organizationId, linkedLocationIds);
  await assertRelatedAgreementIds(client, auth.tenantId, [input.prior_agreement_id ?? null, input.replaced_by_agreement_id ?? null]);
  await assertAgreementTemplateId(client, auth.tenantId, input.source_template_id ?? null);
  await assertSignerContactsBelongToOrganization(client, auth.tenantId, organizationId, input.signers ?? []);

  const normalized = normalizeAgreementInput(input);
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO agreement (
        tenant_id,
        agreement_title,
        agreement_type,
        status,
        organization_id,
        client_account_id,
        primary_contact_id,
        source_template_id,
        description,
        contract_value,
        revenue_share_terms,
        effective_date,
        expiration_date,
        renewal_date,
        notice_deadline,
        auto_renew,
        sent_at,
        viewed_at,
        signed_at,
        countersigned_at,
        internal_countersigner_user_id,
        created_by_user_id,
        updated_by_user_id,
        prior_agreement_id,
        replaced_by_agreement_id
      )
      VALUES (
        $1,$2,$3::agreement_type,$4::agreement_status,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22,$23,$24
      )
      RETURNING id
    `,
    [
      auth.tenantId,
      normalized.agreement_title,
      normalized.agreement_type,
      normalized.status,
      organizationId,
      organizationId,
      normalized.primary_contact_id,
      normalized.source_template_id,
      normalized.description,
      normalized.contract_value,
      normalized.revenue_share_terms,
      normalized.effective_date,
      normalized.expiration_date,
      normalized.renewal_date,
      normalized.notice_deadline,
      normalized.auto_renew,
      normalized.sent_at,
      normalized.viewed_at,
      normalized.signed_at,
      normalized.countersigned_at,
      normalized.status === "countersigned" ? auth.id : null,
      auth.id,
      normalized.prior_agreement_id,
      normalized.replaced_by_agreement_id
    ]
  );

  const agreementId = rows[0].id;
  await replaceAgreementLinks(client, auth, agreementId, linkedContactIds, linkedLocationIds);
  await replaceAgreementSigners(client, auth, agreementId, input.signers ?? [], "created");
  const initialVersionId = await ensureAgreementVersionRecord(client, auth, agreementId, {
    version_label: normalizeOptionalText(input.initial_version_label) ?? "Initial Draft",
    version_stage: input.initial_version_stage ?? "draft",
    source_template_id: normalized.source_template_id,
    rendered_body: normalizeOptionalText(input.rendered_body),
    merge_snapshot: input.merge_snapshot ?? {},
    make_current: true,
    activity_note: normalized.source_template_id
      ? "Created the initial agreement draft from a template."
      : "Created the initial agreement draft version."
  });

  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId,
    activityType: "created",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note: normalized.description ? "Initial agreement record created with metadata and linkage." : "Initial agreement record created.",
    metadata: {
      agreement_type: normalized.agreement_type,
      status: normalized.status,
      organization_id: organizationId,
      linked_contact_count: linkedContactIds.length,
      linked_location_count: linkedLocationIds.length,
      signer_count: (input.signers ?? []).length,
      initial_version_id: initialVersionId
    }
  });

  if (normalized.source_template_id) {
    await insertAgreementActivityLog(client, {
      tenantId: auth.tenantId,
      agreementId,
      activityType: "draft_created_from_template",
      actorId: auth.id,
      actorRole: auth.authorityTier,
      note: "Created a draft Agreement from a saved template.",
      metadata: {
        template_id: normalized.source_template_id
      }
    });
  }

  if (normalized.prior_agreement_id) {
    await insertAgreementActivityLog(client, {
      tenantId: auth.tenantId,
      agreementId,
      activityType: "prior_agreement_linked",
      actorId: auth.id,
      actorRole: auth.authorityTier,
      note: "Linked to a prior agreement for renewal or replacement history.",
      metadata: {
        prior_agreement_id: normalized.prior_agreement_id
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement.created",
    entityType: "agreement",
    entityId: agreementId,
    newValues: {
      agreement_title: normalized.agreement_title,
      agreement_type: normalized.agreement_type,
      status: normalized.status,
      organization_id: organizationId,
      client_account_id: organizationId,
      primary_contact_id: normalized.primary_contact_id,
      source_template_id: normalized.source_template_id,
      contract_value: normalized.contract_value,
      expiration_date: normalized.expiration_date
    },
    metadata: {
      linked_contact_ids: linkedContactIds,
      linked_location_ids: linkedLocationIds,
      signers: input.signers ?? [],
      initial_version_id: initialVersionId
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return agreementId;
}

export async function updateAgreement(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  agreementId: string,
  input: UpdateAgreementInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const existing = await loadAgreementForOrganization(client, auth.tenantId, organizationId, agreementId);
  if (!existing) {
    throw new ApiError(404, "Agreement not found");
  }

  const linkedContactIds = dedupeIds(input.linked_contact_ids ?? []);
  const linkedLocationIds = dedupeIds(input.linked_location_ids ?? []);
  await assertPrimaryContactBelongsToOrganization(client, auth.tenantId, organizationId, input.primary_contact_id ?? null);
  await assertLinkedContactsBelongToOrganization(client, auth.tenantId, organizationId, linkedContactIds);
  await assertLinkedLocationsBelongToOrganization(client, auth.tenantId, organizationId, linkedLocationIds);
  await assertRelatedAgreementIds(client, auth.tenantId, [input.prior_agreement_id ?? null, input.replaced_by_agreement_id ?? null], agreementId);
  await assertAgreementTemplateId(client, auth.tenantId, input.source_template_id ?? null);
  await assertSignerContactsBelongToOrganization(client, auth.tenantId, organizationId, input.signers ?? []);

  const normalized = normalizeAgreementInput(input);
  const nextInternalCountersignerId =
    normalized.status === "countersigned" && !existing.internal_countersigner_user_id ? auth.id : existing.internal_countersigner_user_id;

  await client.query(
    `
      UPDATE agreement
      SET
        agreement_title = $3,
        agreement_type = $4::agreement_type,
        status = $5::agreement_status,
        primary_contact_id = $6,
        source_template_id = $7,
        description = $8,
        contract_value = $9,
        revenue_share_terms = $10,
        effective_date = $11,
        expiration_date = $12,
        renewal_date = $13,
        notice_deadline = $14,
        auto_renew = $15,
        sent_at = $16,
        viewed_at = $17,
        signed_at = $18,
        countersigned_at = $19,
        internal_countersigner_user_id = $20,
        prior_agreement_id = $21,
        replaced_by_agreement_id = $22,
        updated_by_user_id = $23,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      agreementId,
      normalized.agreement_title,
      normalized.agreement_type,
      normalized.status,
      normalized.primary_contact_id,
      normalized.source_template_id,
      normalized.description,
      normalized.contract_value,
      normalized.revenue_share_terms,
      normalized.effective_date,
      normalized.expiration_date,
      normalized.renewal_date,
      normalized.notice_deadline,
      normalized.auto_renew,
      normalized.sent_at,
      normalized.viewed_at,
      normalized.signed_at,
      normalized.countersigned_at,
      nextInternalCountersignerId,
      normalized.prior_agreement_id,
      normalized.replaced_by_agreement_id,
      auth.id
    ]
  );

  await replaceAgreementLinks(client, auth, agreementId, linkedContactIds, linkedLocationIds);
  await replaceAgreementSigners(client, auth, agreementId, input.signers ?? [], "updated");

  const previousValues = snapshotAgreementForAudit(existing);
  const newValues = {
    agreement_title: normalized.agreement_title,
    agreement_type: normalized.agreement_type,
    status: normalized.status,
    primary_contact_id: normalized.primary_contact_id,
    source_template_id: normalized.source_template_id,
    contract_value: normalized.contract_value,
    expiration_date: normalized.expiration_date,
    prior_agreement_id: normalized.prior_agreement_id,
    replaced_by_agreement_id: normalized.replaced_by_agreement_id,
    linked_contact_ids: linkedContactIds,
    linked_location_ids: linkedLocationIds,
    signers: input.signers ?? []
  };

  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId,
    activityType: "metadata_updated",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note: input.note?.trim() || "Agreement metadata was updated.",
    metadata: newValues
  });

  if (existing.status !== normalized.status) {
    await insertAgreementActivityLog(client, {
      tenantId: auth.tenantId,
      agreementId,
      activityType: "status_changed",
      actorId: auth.id,
      actorRole: auth.authorityTier,
      note: `Agreement status moved from ${humanizeAgreementStatus(existing.status)} to ${humanizeAgreementStatus(normalized.status)}.`,
      metadata: {
        previous_status: existing.status,
        new_status: normalized.status
      }
    });
  }

  if (existing.prior_agreement_id !== normalized.prior_agreement_id) {
    await insertAgreementActivityLog(client, {
      tenantId: auth.tenantId,
      agreementId,
      activityType: "prior_agreement_linked",
      actorId: auth.id,
      actorRole: auth.authorityTier,
      note: "Updated the prior agreement relationship.",
      metadata: {
        previous_prior_agreement_id: existing.prior_agreement_id,
        new_prior_agreement_id: normalized.prior_agreement_id
      }
    });
  }

  if (existing.replaced_by_agreement_id !== normalized.replaced_by_agreement_id) {
    await insertAgreementActivityLog(client, {
      tenantId: auth.tenantId,
      agreementId,
      activityType: "replacement_linked",
      actorId: auth.id,
      actorRole: auth.authorityTier,
      note: "Updated the replacement agreement relationship.",
      metadata: {
        previous_replaced_by_agreement_id: existing.replaced_by_agreement_id,
        new_replaced_by_agreement_id: normalized.replaced_by_agreement_id
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement.updated",
    entityType: "agreement",
    entityId: agreementId,
    previousValues,
    newValues,
    reasonComment: input.note?.trim() ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return agreementId;
}

export async function registerAgreementFile(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  agreementId: string,
  input: RegisterAgreementFileInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const agreement = await loadAgreementForOrganization(client, auth.tenantId, organizationId, agreementId);
  if (!agreement) {
    throw new ApiError(404, "Agreement not found");
  }

  const isCurrent = input.is_current ?? true;
  const agreementVersionId =
    input.agreement_version_id ??
    (input.create_version || input.version_stage || input.version_label || input.legacy_upload
      ? await ensureAgreementVersionRecord(client, auth, agreementId, {
          version_label:
            normalizeOptionalText(input.version_label) ??
            (input.legacy_upload ? `Legacy Import ${todayIso()}` : "Uploaded Version"),
          version_stage: input.version_stage ?? (input.legacy_upload ? "legacy_import" : "revised"),
          make_current: isCurrent,
          activity_note:
            normalizeOptionalText(input.activity_note) ??
            (input.legacy_upload ? "Created a legacy-import version record." : "Created a new agreement version.")
        })
      : null);

  if (isCurrent) {
    await client.query(
      `
        UPDATE agreement_file
        SET is_current = false
        WHERE tenant_id = $1
          AND agreement_id = $2
          AND is_current = true
      `,
      [auth.tenantId, agreementId]
    );
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO agreement_file (
        tenant_id,
        agreement_id,
        agreement_version_id,
        file_type,
        file_name,
        storage_reference,
        file_url,
        content_type,
        file_size_bytes,
        version_label,
        is_current,
        uploaded_by_user_id
      )
      VALUES ($1,$2,$3,$4::agreement_file_type,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
    `,
    [
      auth.tenantId,
      agreementId,
      agreementVersionId,
      input.file_type,
      input.file_name.trim(),
      input.storage_reference.trim(),
      normalizeOptionalText(input.file_url),
      normalizeOptionalText(input.content_type),
      input.file_size_bytes ?? null,
      normalizeOptionalText(input.version_label),
      isCurrent,
      auth.id
    ]
  );

  const fileId = rows[0].id;

  if (agreementVersionId && isCurrent) {
    await client.query(
      `
        UPDATE agreement_version
        SET is_current = false, updated_at = now()
        WHERE tenant_id = $1
          AND agreement_id = $2
          AND id <> $3
          AND is_current = true
      `,
      [auth.tenantId, agreementId, agreementVersionId]
    );
    await client.query(
      `
        UPDATE agreement_version
        SET is_current = true, updated_at = now()
        WHERE tenant_id = $1
          AND agreement_id = $2
          AND id = $3
      `,
      [auth.tenantId, agreementId, agreementVersionId]
    );
  }

  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId,
    activityType: input.legacy_upload ? "legacy_file_registered" : "file_uploaded",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note:
      normalizeOptionalText(input.activity_note) ??
      (input.legacy_upload
        ? "Registered a legacy agreement file and made it available in Contracts & Agreements."
        : "Uploaded a new agreement file version."),
    metadata: {
      file_id: fileId,
      agreement_version_id: agreementVersionId,
      file_name: input.file_name.trim(),
      version_label: normalizeOptionalText(input.version_label),
      is_current: isCurrent
    }
  });

  if (isCurrent) {
    await insertAgreementActivityLog(client, {
      tenantId: auth.tenantId,
      agreementId,
      activityType: "file_marked_current",
      actorId: auth.id,
      actorRole: auth.authorityTier,
      note: "Marked this file version as the current agreement version.",
      metadata: {
        file_id: fileId,
        agreement_version_id: agreementVersionId,
        file_name: input.file_name.trim()
      }
    });
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement_file.created",
    entityType: "agreement_file",
    entityId: fileId,
    newValues: {
      agreement_id: agreementId,
      agreement_version_id: agreementVersionId,
      file_type: input.file_type,
      file_name: input.file_name.trim(),
      storage_reference: input.storage_reference.trim(),
      version_label: normalizeOptionalText(input.version_label),
      is_current: isCurrent
    },
    metadata: {
      legacy_upload: input.legacy_upload ?? false
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return fileId;
}

export async function createAgreementTemplate(
  client: PoolClient,
  auth: AuthUser,
  input: CreateAgreementTemplateInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const normalizedName = input.template_name.trim();
  const normalizedBody = normalizeOptionalText(input.template_body);
  const normalizedFileReference = normalizeOptionalText(input.template_file_reference);
  if (!normalizedBody && !normalizedFileReference) {
    throw new ApiError(400, "Templates require either template body content or a stored template file reference.");
  }

  const mergeFields = dedupeIds((input.merge_fields ?? []).map((value) => value.trim()));
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO agreement_template (
        tenant_id,
        template_name,
        agreement_type,
        active_status,
        template_body,
        template_file_reference,
        merge_fields,
        created_by_user_id
      )
      VALUES ($1,$2,$3::agreement_type,$4,$5,$6,$7::jsonb,$8)
      RETURNING id
    `,
    [
      auth.tenantId,
      normalizedName,
      input.agreement_type,
      input.active_status ?? true,
      normalizedBody,
      normalizedFileReference,
      JSON.stringify(mergeFields),
      auth.id
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement_template.created",
    entityType: "agreement_template",
    entityId: rows[0].id,
    newValues: {
      template_name: normalizedName,
      agreement_type: input.agreement_type,
      active_status: input.active_status ?? true,
      merge_fields: mergeFields
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return rows[0].id;
}

export async function createAgreementFromTemplate(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  input: CreateAgreementFromTemplateInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const template = await loadAgreementTemplate(client, auth.tenantId, input.template_id);
  if (!template) {
    throw new ApiError(404, "Agreement template not found");
  }

  const primaryContactId = input.primary_contact_id ?? null;
  const mergeContext = await loadOrganizationMergeContext(client, auth.tenantId, organizationId, primaryContactId);
  const signers = normalizeDraftTemplateSigners(input.signers ?? [], mergeContext.primaryContactName, primaryContactId);
  const mergeSnapshot = buildTemplateMergeSnapshot(template, mergeContext, {
    agreement_title: input.agreement_title ?? null,
    effective_date: input.effective_date ?? null,
    expiration_date: input.expiration_date ?? null,
    renewal_date: input.renewal_date ?? null,
    notice_deadline: input.notice_deadline ?? null,
    contract_value: input.contract_value ?? null,
    revenue_share_terms: input.revenue_share_terms ?? null,
    signers
  });
  const renderedBody = renderAgreementTemplate(template.template_body, mergeSnapshot);

  return createAgreement(
    client,
    auth,
    organizationId,
    {
      agreement_title: input.agreement_title?.trim() || `${mergeContext.organizationName} ${humanizeAgreementType(template.agreement_type)} Agreement`,
      agreement_type: template.agreement_type,
      status: "draft",
      primary_contact_id: primaryContactId,
      description: input.description ?? null,
      contract_value: input.contract_value ?? null,
      revenue_share_terms: input.revenue_share_terms ?? null,
      effective_date: input.effective_date ?? null,
      expiration_date: input.expiration_date ?? null,
      renewal_date: input.renewal_date ?? null,
      notice_deadline: input.notice_deadline ?? null,
      auto_renew: input.auto_renew ?? null,
      linked_contact_ids: dedupeIds([...(input.linked_contact_ids ?? []), ...(primaryContactId ? [primaryContactId] : [])]),
      linked_location_ids: input.linked_location_ids ?? [],
      source_template_id: template.id,
      signers,
      initial_version_label: `${template.template_name} Draft`,
      initial_version_stage: "draft",
      rendered_body: renderedBody,
      merge_snapshot: mergeSnapshot
    },
    meta
  );
}

export async function sendAgreementForSignature(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  agreementId: string,
  input: SendAgreementForSignatureInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const agreement = await loadFullAgreementForRenewal(client, auth.tenantId, organizationId, agreementId);
  if (!agreement) {
    throw new ApiError(404, "Agreement not found");
  }

  const providerName = input.provider_name ?? agreement.external_provider_name ?? config.AGREEMENT_ESIGN_PROVIDER;
  if (
    agreement.external_envelope_id &&
    !["cancelled", "voided", "send_failed", "sync_failed"].includes((agreement.external_status ?? "").toLowerCase())
  ) {
    throw new ApiError(409, "This Agreement already has an active provider envelope. Sync or void it before sending again.");
  }

  const selectedVersion =
    (input.agreement_version_id ? agreement.versions.find((version) => version.id === input.agreement_version_id) : null) ??
    agreement.versions.find((version) => version.is_current) ??
    agreement.versions[0] ??
    null;
  const selectedFile =
    selectedVersion?.files.find((file) => file.is_current) ??
    selectedVersion?.files[0] ??
    agreement.files.find((file) => file.is_current) ??
    agreement.files[0] ??
    null;
  if (!selectedVersion && !selectedFile) {
    throw new ApiError(400, "Attach or generate a current Agreement version before sending for signature.");
  }
  if (!selectedFile && !selectedVersion?.rendered_body) {
    throw new ApiError(400, "The selected Agreement version does not have a file or rendered body available to send.");
  }

  const eligibleSigners = agreement.signers.filter(
    (signer) =>
      Boolean(signer.signer_name.trim()) &&
      Boolean(signer.signer_email?.trim()) &&
      !["signed", "replaced", "cancelled"].includes(signer.status)
  );
  if (!eligibleSigners.length) {
    throw new ApiError(400, "Add at least one unsigned signer with an email address before sending this Agreement.");
  }

  const providerEventId = await insertAgreementProviderEvent(client, {
    tenantId: auth.tenantId,
    agreementId,
    signerId: null,
    providerName,
    externalEnvelopeId: agreement.external_envelope_id,
    externalRecipientId: null,
    direction: "outbound",
    eventType: "send_requested",
    providerStatus: agreement.external_status,
    payload: {
      agreement_version_id: selectedVersion?.id ?? null,
      file_id: selectedFile?.id ?? null,
      signer_ids: eligibleSigners.map((signer) => signer.id),
      note: normalizeOptionalText(input.note)
    }
  });

  await client.query(
    `
      UPDATE agreement
      SET
        status = CASE
          WHEN status IN ('draft', 'viewed', 'partially_signed', 'signed') THEN 'sent'::agreement_status
          ELSE status
        END,
        sent_at = COALESCE(sent_at, now()),
        external_provider_name = $2,
        external_status = COALESCE(external_status, 'send_requested'),
        provider_error_state = NULL,
        updated_by_user_id = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $4
    `,
    [auth.tenantId, providerName, auth.id, agreementId]
  );

  const appEvent = await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "agreement.signature.send_requested",
    aggregateType: "agreement",
    aggregateId: agreementId,
    dedupeKey: `agreement-signature-send:${agreementId}:${selectedVersion?.id ?? selectedFile?.id ?? "current"}:${providerEventId}`,
    payload: {
      agreement_id: agreementId,
      organization_id: organizationId,
      agreement_title: agreement.agreement_title,
      provider_name: providerName,
      agreement_version_id: selectedVersion?.id ?? null,
      selected_file: selectedFile
        ? {
            id: selectedFile.id,
            file_name: selectedFile.file_name,
            storage_reference: selectedFile.storage_reference,
            file_url: selectedFile.file_url,
            content_type: selectedFile.content_type,
            version_label: selectedFile.version_label
          }
        : null,
      rendered_body: selectedVersion?.rendered_body ?? null,
      signer_recipients: eligibleSigners.map((signer) => ({
        signer_id: signer.id,
        signer_name: signer.signer_name,
        signer_email: signer.signer_email,
        signer_type: signer.signer_type,
        signer_order: signer.signer_order
      })),
      provider_event_id: providerEventId,
      note: normalizeOptionalText(input.note)
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement.signature.send_requested",
    entityType: "agreement",
    entityId: agreementId,
    newValues: {
      provider_name: providerName,
      agreement_version_id: selectedVersion?.id ?? null,
      signer_ids: eligibleSigners.map((signer) => signer.id)
    },
    metadata: {
      provider_event_id: providerEventId,
      app_event_id: appEvent.id,
      file_id: selectedFile?.id ?? null
    },
    reasonComment: normalizeOptionalText(input.note),
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return providerEventId;
}

export async function syncAgreementProviderStatus(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  agreementId: string,
  input: SyncAgreementProviderStatusInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const agreement = await loadAgreementForOrganization(client, auth.tenantId, organizationId, agreementId);
  if (!agreement) {
    throw new ApiError(404, "Agreement not found");
  }
  if (!agreement.external_envelope_id) {
    throw new ApiError(409, "This Agreement has not been sent to a provider yet.");
  }

  const providerName = agreement.external_provider_name ?? config.AGREEMENT_ESIGN_PROVIDER;
  const providerEventId = await insertAgreementProviderEvent(client, {
    tenantId: auth.tenantId,
    agreementId,
    signerId: null,
    providerName,
    externalEnvelopeId: agreement.external_envelope_id,
    externalRecipientId: null,
    direction: "outbound",
    eventType: "sync_requested",
    providerStatus: agreement.external_status,
    payload: {
      note: normalizeOptionalText(input.note)
    }
  });

  const appEvent = await createAppEvent(client, {
    tenantId: auth.tenantId,
    eventType: "agreement.signature.sync_requested",
    aggregateType: "agreement",
    aggregateId: agreementId,
    dedupeKey: `agreement-signature-sync:${agreementId}:${providerEventId}`,
    payload: {
      agreement_id: agreementId,
      organization_id: organizationId,
      agreement_title: agreement.agreement_title,
      provider_name: providerName,
      external_envelope_id: agreement.external_envelope_id,
      provider_event_id: providerEventId,
      note: normalizeOptionalText(input.note)
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement.signature.sync_requested",
    entityType: "agreement",
    entityId: agreementId,
    newValues: {
      provider_name: providerName,
      external_envelope_id: agreement.external_envelope_id
    },
    metadata: {
      provider_event_id: providerEventId,
      app_event_id: appEvent.id
    },
    reasonComment: normalizeOptionalText(input.note),
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return providerEventId;
}

export async function sendAgreementReminder(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  agreementId: string,
  input: SendAgreementReminderInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const agreement = await loadAgreementForOrganization(client, auth.tenantId, organizationId, agreementId);
  if (!agreement) {
    throw new ApiError(404, "Agreement not found");
  }

  const signers = await loadAgreementSigners(client, auth.tenantId, agreementId);
  const recipients = resolveReminderRecipients(signers);
  if (!recipients.length) {
    throw new ApiError(400, "No unsigned signers are available for reminders on this Agreement.");
  }

  const channels = [...new Set((input.channels ?? ["email", "internal_notice"]).filter(Boolean))];
  const sentReminderIds: string[] = [];

  for (const recipient of recipients) {
    for (const channel of channels) {
      const { rows } = await client.query<{ id: string }>(
        `
          INSERT INTO agreement_reminder (
            tenant_id,
            agreement_id,
            signer_id,
            reminder_type,
            reminder_channel,
            status,
            follow_up_state,
            recipient_name,
            recipient_email,
            due_at,
            sent_at,
            triggered_by_user_id,
            note,
            metadata
          )
          VALUES ($1,$2,$3,$4::agreement_reminder_type,$5::agreement_reminder_channel,'sent',$6,$7,$8,now(),now(),$9,$10,$11::jsonb)
          RETURNING id
        `,
        [
          auth.tenantId,
          agreementId,
          recipient.signer_id,
          input.reminder_type,
          channel,
          buildReminderFollowUpState(input.reminder_type),
          recipient.recipient_name,
          recipient.recipient_email,
          auth.id,
          normalizeOptionalText(input.note),
          JSON.stringify({
            agreement_title: agreement.agreement_title,
            agreement_status: agreement.status
          })
        ]
      );
      sentReminderIds.push(rows[0].id);

      await createAppEvent(client, {
        tenantId: auth.tenantId,
        eventType: "agreement.reminder_requested",
        aggregateType: "agreement_reminder",
        aggregateId: rows[0].id,
        dedupeKey: `agreement-reminder:${agreementId}:${rows[0].id}:${channel}`,
        payload: {
          agreement_id: agreementId,
          agreement_title: agreement.agreement_title,
          organization_id: organizationId,
          organization_display_name: agreement.organization_display_name,
          reminder_type: input.reminder_type,
          channel,
          recipient_name: recipient.recipient_name,
          recipient_email: recipient.recipient_email,
          signer_id: recipient.signer_id,
          actor_user_id: auth.id,
          note: normalizeOptionalText(input.note)
        }
      });
    }
  }

  if (agreement.external_envelope_id && agreement.external_provider_name) {
    const providerEventId = await insertAgreementProviderEvent(client, {
      tenantId: auth.tenantId,
      agreementId,
      signerId: null,
      providerName: agreement.external_provider_name,
      externalEnvelopeId: agreement.external_envelope_id,
      externalRecipientId: null,
      direction: "outbound",
      eventType: "reminder_requested",
      providerStatus: agreement.external_status,
      payload: {
        reminder_type: input.reminder_type,
        reminder_ids: sentReminderIds,
        signer_ids: recipients.map((recipient) => recipient.signer_id),
        note: normalizeOptionalText(input.note)
      }
    });

    await createAppEvent(client, {
      tenantId: auth.tenantId,
      eventType: "agreement.signature.reminder_requested",
      aggregateType: "agreement",
      aggregateId: agreementId,
      dedupeKey: `agreement-signature-reminder:${agreementId}:${providerEventId}`,
      payload: {
        agreement_id: agreementId,
        agreement_title: agreement.agreement_title,
        organization_id: organizationId,
        organization_display_name: agreement.organization_display_name,
        provider_name: agreement.external_provider_name,
        external_envelope_id: agreement.external_envelope_id,
        reminder_type: input.reminder_type,
        signer_recipients: recipients,
        reminder_ids: sentReminderIds,
        provider_event_id: providerEventId,
        note: normalizeOptionalText(input.note)
      }
    });
  }

  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId,
    activityType: "reminder_sent",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note: normalizeOptionalText(input.note) ?? `Queued ${humanizeReminderType(input.reminder_type)} reminder actions for unsigned signers.`,
    metadata: {
      reminder_type: input.reminder_type,
      reminder_ids: sentReminderIds,
      recipient_count: recipients.length,
      channels
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement.reminder.sent",
    entityType: "agreement",
    entityId: agreementId,
    newValues: {
      reminder_type: input.reminder_type,
      channels
    },
    metadata: {
      recipients: recipients.map((recipient) => ({
        signer_id: recipient.signer_id,
        recipient_email: recipient.recipient_email
      }))
    },
    reasonComment: normalizeOptionalText(input.note),
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return sentReminderIds;
}

export async function createAgreementRenewalDraft(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  agreementId: string,
  input: CreateAgreementRenewalInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  assertAgreementManageAccess(auth);
  const agreement = await loadFullAgreementForRenewal(client, auth.tenantId, organizationId, agreementId);
  if (!agreement) {
    throw new ApiError(404, "Agreement not found");
  }

  const nextTitle = input.agreement_title?.trim() || `${agreement.agreement_title} Renewal`;
  const signerInputs =
    input.signers ??
    agreement.signers.map<AgreementSignerInput>((signer) => ({
      contact_id: signer.contact_id,
      signer_name: signer.signer_name,
      signer_email: signer.signer_email,
      signer_role: signer.signer_role,
      signer_order: signer.signer_order,
      signer_type: signer.signer_type,
      status: "pending",
      viewed_at: null,
      signed_at: null
    }));

  const renewalAgreementId = await createAgreement(
    client,
    auth,
    organizationId,
    {
      agreement_title: nextTitle,
      agreement_type: agreement.agreement_type,
      status: "draft",
      primary_contact_id: agreement.primary_contact_id,
      description: agreement.description,
      contract_value: agreement.contract_value,
      revenue_share_terms: agreement.revenue_share_terms,
      effective_date: input.effective_date ?? agreement.renewal_date ?? agreement.effective_date,
      expiration_date: input.expiration_date ?? agreement.expiration_date,
      renewal_date: input.renewal_date ?? agreement.renewal_date,
      notice_deadline: input.notice_deadline ?? agreement.notice_deadline,
      auto_renew: input.auto_renew ?? agreement.auto_renew,
      prior_agreement_id: agreementId,
      linked_contact_ids: agreement.links
        .filter((link) => link.linked_entity_type === "organization_contact")
        .map((link) => link.linked_entity_id),
      linked_location_ids: agreement.links
        .filter((link) => link.linked_entity_type === "shoot_location")
        .map((link) => link.linked_entity_id),
      signers: signerInputs,
      initial_version_label: "Renewal Draft",
      initial_version_stage: "draft",
      rendered_body: agreement.versions.find((version) => version.is_current)?.rendered_body ?? null,
      merge_snapshot: agreement.versions.find((version) => version.is_current)?.merge_snapshot ?? {}
    },
    meta
  );

  await client.query(
    `
      UPDATE agreement
      SET replaced_by_agreement_id = $3,
          updated_by_user_id = $4,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, agreementId, renewalAgreementId, auth.id]
  );

  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId,
    activityType: "renewal_draft_created",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note: normalizeOptionalText(input.note) ?? "Created a renewal draft from the prior Agreement.",
    metadata: {
      renewal_agreement_id: renewalAgreementId
    }
  });

  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId: renewalAgreementId,
    activityType: "renewal_draft_created",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note: normalizeOptionalText(input.note) ?? "This renewal draft was created from a prior Agreement.",
    metadata: {
      prior_agreement_id: agreementId
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "agreement.renewal_draft_created",
    entityType: "agreement",
    entityId: renewalAgreementId,
    newValues: {
      prior_agreement_id: agreementId,
      agreement_title: nextTitle
    },
    reasonComment: normalizeOptionalText(input.note),
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return renewalAgreementId;
}

export async function getAgreementCoverageByOrganizationIds(
  client: PoolClient,
  tenantId: string,
  organizationIds: string[]
) {
  const ids = dedupeIds(organizationIds);
  const coverage = new Map<string, OrganizationAgreementSummary>();
  if (!ids.length) {
    return coverage;
  }

  const { rows } = await client.query<OrganizationCoverageRow>(
    `
      SELECT
        a.id AS agreement_id,
        a.organization_id,
        a.client_account_id,
        a.status,
        a.effective_date::text,
        a.expiration_date::text,
        a.renewal_date::text,
        a.notice_deadline::text
      FROM agreement a
      WHERE a.tenant_id = $1
        AND (
          a.organization_id = ANY($2::uuid[])
          OR a.client_account_id = ANY($2::uuid[])
        )
    `,
    [tenantId, ids]
  );

  const rowsByOrganization = new Map<string, OrganizationCoverageRow[]>();
  for (const row of rows) {
    const organizationId = row.organization_id ?? row.client_account_id;
    if (!organizationId || !ids.includes(organizationId)) {
      continue;
    }
    const existing = rowsByOrganization.get(organizationId) ?? [];
    existing.push(row);
    rowsByOrganization.set(organizationId, existing);
  }

  for (const id of ids) {
    const agreementRecords = (rowsByOrganization.get(id) ?? []).map((row) => mapAgreementCoverageRowToAgreementRecord(row));
    coverage.set(id, buildAgreementSummary(agreementRecords, []));
  }

  return coverage;
}

export function buildShootAgreementWarning(
  agreementSummary: OrganizationAgreementSummary | undefined,
  shootDate: string | null | undefined
): {
  agreement_warning_severity: AgreementWarningSeverity;
  agreement_warning_summary: string | null;
  agreement_warning_codes: AgreementWarningCode[];
  agreement_has_active: boolean;
} {
  if (!agreementSummary) {
    return {
      agreement_warning_severity: "warning",
      agreement_warning_summary: "No active Agreement is linked to this account yet.",
      agreement_warning_codes: ["no_active_agreement"],
      agreement_has_active: false
    };
  }

  const daysUntilShoot = shootDate ? diffDays(todayIso(), shootDate) : null;
  const majorWindow = daysUntilShoot !== null && daysUntilShoot <= 14;

  if (agreementSummary.has_expired) {
    return {
      agreement_warning_severity: majorWindow ? "major" : "warning",
      agreement_warning_summary: majorWindow
        ? "This upcoming Shoot is tied to an account with an expired Agreement."
        : "The linked account has an expired Agreement on file.",
      agreement_warning_codes: ["expired_agreement"],
      agreement_has_active: false
    };
  }
  if (!agreementSummary.has_active_agreement && agreementSummary.has_pending_signature) {
    return {
      agreement_warning_severity: majorWindow ? "major" : "warning",
      agreement_warning_summary: majorWindow
        ? "This upcoming Shoot is approaching without a fully signed active Agreement."
        : "A pending Agreement exists, but no active Agreement is on file yet.",
      agreement_warning_codes: ["pending_unsigned_agreement", "no_active_agreement"],
      agreement_has_active: false
    };
  }
  if (!agreementSummary.has_active_agreement) {
    return {
      agreement_warning_severity: "warning",
      agreement_warning_summary: "No active Agreement is linked to this account.",
      agreement_warning_codes: ["no_active_agreement"],
      agreement_has_active: false
    };
  }
  if (agreementSummary.has_expiring_soon) {
    return {
      agreement_warning_severity: "warning",
      agreement_warning_summary: "The active Agreement for this account is expiring soon.",
      agreement_warning_codes: ["expiring_agreement"],
      agreement_has_active: true
    };
  }

  return {
    agreement_warning_severity: "clear",
    agreement_warning_summary: null,
    agreement_warning_codes: [],
    agreement_has_active: true
  };
}

async function loadAgreementFiles(client: PoolClient, tenantId: string, agreementIds: string[]) {
  return client.query<AgreementFileRow>(
    `
      SELECT
        af.id,
        af.agreement_id,
        af.agreement_version_id,
        af.file_type,
        af.file_name,
        af.storage_reference,
        af.file_url,
        af.content_type,
        af.file_size_bytes::text,
        af.version_label,
        af.is_current,
        af.uploaded_by_user_id,
        uploader.full_name AS uploaded_by_name,
        af.uploaded_at::text
      FROM agreement_file af
      LEFT JOIN app_user uploader
        ON uploader.tenant_id = af.tenant_id
       AND uploader.id = af.uploaded_by_user_id
      WHERE af.tenant_id = $1
        AND af.agreement_id = ANY($2::uuid[])
      ORDER BY af.is_current DESC, af.uploaded_at DESC
    `,
    [tenantId, agreementIds]
  );
}

async function loadAgreementLinks(client: PoolClient, tenantId: string, agreementIds: string[]) {
  return client.query<AgreementLinkRow>(
    `
      SELECT
        al.id,
        al.agreement_id,
        al.linked_entity_type,
        al.linked_entity_id,
        al.relationship_type,
        COALESCE(org.display_name, oc.full_name, sl.name) AS label,
        COALESCE(
          oc.email,
          NULLIF(
            trim(
              concat_ws(', ', NULLIF(sl.address_line_1, ''), NULLIF(sl.city, ''), NULLIF(sl.state, ''))
            ),
            ''
          ),
          NULL
        ) AS secondary_label,
        al.created_at::text
      FROM agreement_link al
      LEFT JOIN organization org
        ON al.linked_entity_type = 'organization'
       AND org.tenant_id = al.tenant_id
       AND org.id = al.linked_entity_id
      LEFT JOIN organization_contact oc
        ON al.linked_entity_type = 'organization_contact'
       AND oc.tenant_id = al.tenant_id
       AND oc.id = al.linked_entity_id
      LEFT JOIN shoot_location sl
        ON al.linked_entity_type = 'shoot_location'
       AND sl.tenant_id = al.tenant_id
       AND sl.id = al.linked_entity_id
      WHERE al.tenant_id = $1
        AND al.agreement_id = ANY($2::uuid[])
      ORDER BY al.created_at ASC
    `,
    [tenantId, agreementIds]
  );
}

async function loadAgreementActivity(client: PoolClient, tenantId: string, agreementIds: string[]) {
  return client.query<AgreementActivityRow>(
    `
      SELECT
        aal.id,
        aal.agreement_id,
        aal.activity_type,
        aal.actor_id,
        actor.full_name AS actor_name,
        aal.actor_role,
        aal.timestamp::text,
        aal.note,
        aal.metadata
      FROM agreement_activity_log aal
      LEFT JOIN app_user actor
        ON actor.tenant_id = aal.tenant_id
       AND actor.id = aal.actor_id
      WHERE aal.tenant_id = $1
        AND aal.agreement_id = ANY($2::uuid[])
      ORDER BY aal.timestamp DESC
    `,
    [tenantId, agreementIds]
  );
}

async function loadAgreementSignersByIds(client: PoolClient, tenantId: string, agreementIds: string[]) {
  return client.query<AgreementSignerRow>(
    `
      SELECT
        id,
        agreement_id,
        contact_id,
        signer_name,
        signer_email,
        signer_role,
        signer_order,
        signer_type,
        status,
        external_recipient_id,
        external_status,
        last_provider_sync_at::text,
        viewed_at::text,
        signed_at::text,
        created_at::text,
        updated_at::text
      FROM agreement_signer
      WHERE tenant_id = $1
        AND agreement_id = ANY($2::uuid[])
      ORDER BY signer_order ASC NULLS LAST, created_at ASC
    `,
    [tenantId, agreementIds]
  );
}

async function loadAgreementVersions(client: PoolClient, tenantId: string, agreementIds: string[]) {
  return client.query<AgreementVersionRow>(
    `
      SELECT
        av.id,
        av.agreement_id,
        av.version_number::text,
        av.version_label,
        av.version_stage,
        av.prior_version_id,
        av.source_template_id,
        template.template_name AS source_template_name,
        av.rendered_body,
        av.merge_snapshot,
        av.is_current,
        av.created_by_user_id,
        creator.full_name AS created_by_name,
        av.created_at::text,
        av.updated_at::text
      FROM agreement_version av
      LEFT JOIN agreement_template template
        ON template.tenant_id = av.tenant_id
       AND template.id = av.source_template_id
      LEFT JOIN app_user creator
        ON creator.tenant_id = av.tenant_id
       AND creator.id = av.created_by_user_id
      WHERE av.tenant_id = $1
        AND av.agreement_id = ANY($2::uuid[])
      ORDER BY av.version_number DESC, av.created_at DESC
    `,
    [tenantId, agreementIds]
  );
}

async function loadAgreementReminders(client: PoolClient, tenantId: string, agreementIds: string[]) {
  return client.query<AgreementReminderRow>(
    `
      SELECT
        ar.id,
        ar.agreement_id,
        ar.signer_id,
        ar.reminder_type,
        ar.reminder_channel,
        ar.status,
        ar.follow_up_state,
        ar.recipient_name,
        ar.recipient_email,
        ar.due_at::text,
        ar.sent_at::text,
        ar.triggered_by_user_id,
        trigger_user.full_name AS triggered_by_name,
        ar.note,
        ar.metadata,
        ar.created_at::text,
        ar.updated_at::text
      FROM agreement_reminder ar
      LEFT JOIN app_user trigger_user
        ON trigger_user.tenant_id = ar.tenant_id
       AND trigger_user.id = ar.triggered_by_user_id
      WHERE ar.tenant_id = $1
        AND ar.agreement_id = ANY($2::uuid[])
      ORDER BY COALESCE(ar.sent_at, ar.created_at) DESC
    `,
    [tenantId, agreementIds]
  );
}

async function loadAgreementProviderEvents(client: PoolClient, tenantId: string, agreementIds: string[]) {
  return client.query<AgreementProviderEventRow>(
    `
      SELECT
        ape.id,
        ape.agreement_id,
        ape.signer_id,
        ape.provider_name,
        ape.external_envelope_id,
        ape.external_recipient_id,
        ape.direction,
        ape.event_type,
        ape.provider_status,
        ape.payload,
        ape.occurred_at::text,
        ape.created_at::text
      FROM agreement_provider_event ape
      WHERE ape.tenant_id = $1
        AND ape.agreement_id = ANY($2::uuid[])
      ORDER BY ape.occurred_at DESC, ape.created_at DESC
    `,
    [tenantId, agreementIds]
  );
}

async function loadAgreementForOrganization(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  agreementId: string
) {
  const { rows } = await client.query<
    Pick<
      AgreementListRow,
      | "id"
      | "agreement_title"
      | "status"
      | "external_provider_name"
      | "external_envelope_id"
      | "external_status"
      | "last_provider_sync_at"
      | "provider_error_state"
      | "internal_countersigner_user_id"
      | "prior_agreement_id"
      | "replaced_by_agreement_id"
      | "source_template_id"
      | "organization_display_name"
    >
  >(
    `
      SELECT
        a.id,
        a.agreement_title,
        a.status,
        a.external_provider_name,
        a.external_envelope_id,
        a.external_status,
        a.last_provider_sync_at::text,
        a.provider_error_state,
        a.internal_countersigner_user_id,
        a.prior_agreement_id,
        a.replaced_by_agreement_id,
        a.source_template_id,
        org.display_name AS organization_display_name
      FROM agreement a
      LEFT JOIN organization org
        ON org.tenant_id = a.tenant_id
       AND org.id = a.organization_id
      WHERE a.tenant_id = $1
        AND a.id = $2
        AND (
          a.organization_id = $3
          OR a.client_account_id = $3
          OR EXISTS (
            SELECT 1
            FROM agreement_link al
            WHERE al.tenant_id = a.tenant_id
              AND al.agreement_id = a.id
              AND al.linked_entity_type = 'organization'
              AND al.linked_entity_id = $3
          )
        )
      LIMIT 1
    `,
    [tenantId, agreementId, organizationId]
  );
  return rows[0] ?? null;
}

async function loadAgreementTemplate(client: PoolClient, tenantId: string, templateId: string) {
  const { rows } = await client.query<AgreementTemplateRow>(
    `
      SELECT
        id,
        template_name,
        agreement_type,
        active_status,
        template_body,
        template_file_reference,
        merge_fields,
        created_by_user_id,
        NULL::text AS created_by_name,
        created_at::text,
        updated_at::text
      FROM agreement_template
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, templateId]
  );
  return rows[0] ? mapAgreementTemplate(rows[0]) : null;
}

async function loadAgreementSigners(client: PoolClient, tenantId: string, agreementId: string) {
  const { rows } = await client.query<AgreementSignerRow>(
    `
      SELECT
        id,
        agreement_id,
        contact_id,
        signer_name,
        signer_email,
        signer_role,
        signer_order,
        signer_type,
        status,
        external_recipient_id,
        external_status,
        last_provider_sync_at::text,
        viewed_at::text,
        signed_at::text,
        created_at::text,
        updated_at::text
      FROM agreement_signer
      WHERE tenant_id = $1
        AND agreement_id = $2
      ORDER BY signer_order ASC NULLS LAST, created_at ASC
    `,
    [tenantId, agreementId]
  );
  return rows.map(mapAgreementSigner);
}

async function loadFullAgreementForRenewal(client: PoolClient, tenantId: string, organizationId: string, agreementId: string) {
  const authStub = {
    tenantId,
    id: "",
    authorityTier: "leadership"
  } as unknown as AuthUser;
  const view = await getOrganizationAgreementsView(client, authStub, organizationId);
  return view.agreements.find((agreement) => agreement.id === agreementId) ?? null;
}

async function loadUpcomingShootRows(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<UpcomingShootRow>(
    `
      SELECT
        s.id AS shoot_id,
        s.shoot_code,
        s.title,
        s.shoot_date::text,
        s.organization_id,
        o.display_name AS organization_display_name
      FROM shoot s
      LEFT JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      WHERE s.tenant_id = $1
        AND s.deleted_at IS NULL
        AND s.organization_id = $2
        AND s.shoot_date >= current_date
        AND s.shoot_date <= current_date + interval '60 days'
      ORDER BY s.shoot_date ASC, s.arrival_time ASC, s.start_time ASC, s.title ASC
      LIMIT 24
    `,
    [tenantId, organizationId]
  );
  return rows;
}

async function loadOrganizationMergeContext(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  primaryContactId: string | null
): Promise<OrganizationMergeContext> {
  const organizationResult = await client.query<{ display_name: string }>(
    `
      SELECT display_name
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  if (!organizationResult.rows[0]) {
    throw new ApiError(404, "Organization not found");
  }

  let primaryContactName: string | null = null;
  if (primaryContactId) {
    const contactResult = await client.query<{ full_name: string }>(
      `
        SELECT full_name
        FROM organization_contact
        WHERE tenant_id = $1
          AND organization_id = $2
          AND id = $3
        LIMIT 1
      `,
      [tenantId, organizationId, primaryContactId]
    );
    primaryContactName = contactResult.rows[0]?.full_name ?? null;
  }

  return {
    organizationName: organizationResult.rows[0].display_name,
    primaryContactName
  };
}

async function ensureAgreementVersionRecord(
  client: PoolClient,
  auth: AuthUser,
  agreementId: string,
  input: {
    version_label: string;
    version_stage: AgreementVersionStage;
    source_template_id?: string | null;
    rendered_body?: string | null;
    merge_snapshot?: Record<string, unknown>;
    make_current?: boolean;
    activity_note?: string | null;
  }
) {
  const versionNumberResult = await client.query<{ next_version_number: string | number }>(
    `
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
      FROM agreement_version
      WHERE tenant_id = $1
        AND agreement_id = $2
    `,
    [auth.tenantId, agreementId]
  );
  const versionNumber = toNumber(versionNumberResult.rows[0]?.next_version_number) ?? 1;
  const isCurrent = input.make_current ?? true;

  if (isCurrent) {
    await client.query(
      `
        UPDATE agreement_version
        SET is_current = false,
            updated_at = now()
        WHERE tenant_id = $1
          AND agreement_id = $2
          AND is_current = true
      `,
      [auth.tenantId, agreementId]
    );
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO agreement_version (
        tenant_id,
        agreement_id,
        version_number,
        version_label,
        version_stage,
        source_template_id,
        rendered_body,
        merge_snapshot,
        is_current,
        created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5::agreement_version_stage,$6,$7,$8::jsonb,$9,$10)
      RETURNING id
    `,
    [
      auth.tenantId,
      agreementId,
      versionNumber,
      input.version_label,
      input.version_stage,
      input.source_template_id ?? null,
      normalizeOptionalText(input.rendered_body),
      JSON.stringify(input.merge_snapshot ?? {}),
      isCurrent,
      auth.id
    ]
  );

  const versionId = rows[0].id;
  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId,
    activityType: "version_created",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note: normalizeOptionalText(input.activity_note) ?? `Created agreement version ${versionNumber}.`,
    metadata: {
      agreement_version_id: versionId,
      version_number: versionNumber,
      version_label: input.version_label,
      version_stage: input.version_stage,
      is_current: isCurrent
    }
  });
  return versionId;
}

async function replaceAgreementLinks(
  client: PoolClient,
  auth: AuthUser,
  agreementId: string,
  linkedContactIds: string[],
  linkedLocationIds: string[]
) {
  await client.query(
    `
      DELETE FROM agreement_link
      WHERE tenant_id = $1
        AND agreement_id = $2
        AND (
          (linked_entity_type = 'organization_contact' AND relationship_type = 'linked_contact')
          OR (linked_entity_type = 'shoot_location' AND relationship_type = 'linked_location')
        )
    `,
    [auth.tenantId, agreementId]
  );

  for (const contactId of linkedContactIds) {
    await client.query(
      `
        INSERT INTO agreement_link (
          tenant_id,
          agreement_id,
          linked_entity_type,
          linked_entity_id,
          relationship_type,
          created_by_user_id,
          updated_at
        )
        VALUES ($1,$2,'organization_contact',$3,'linked_contact',$4,now())
      `,
      [auth.tenantId, agreementId, contactId, auth.id]
    );
  }

  for (const locationId of linkedLocationIds) {
    await client.query(
      `
        INSERT INTO agreement_link (
          tenant_id,
          agreement_id,
          linked_entity_type,
          linked_entity_id,
          relationship_type,
          created_by_user_id,
          updated_at
        )
        VALUES ($1,$2,'shoot_location',$3,'linked_location',$4,now())
      `,
      [auth.tenantId, agreementId, locationId, auth.id]
    );
  }
}

async function replaceAgreementSigners(
  client: PoolClient,
  auth: AuthUser,
  agreementId: string,
  signers: AgreementSignerInput[],
  mode: "created" | "updated"
) {
  await client.query(
    `
      DELETE FROM agreement_signer
      WHERE tenant_id = $1
        AND agreement_id = $2
    `,
    [auth.tenantId, agreementId]
  );

  if (!signers.length) {
    return;
  }

  for (const signer of signers) {
    const normalizedSigner = normalizeSignerInput(signer);
    await client.query(
      `
        INSERT INTO agreement_signer (
          tenant_id,
          agreement_id,
          contact_id,
          signer_name,
          signer_email,
          signer_role,
          signer_order,
          signer_type,
          status,
          viewed_at,
          signed_at,
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::agreement_signer_type,$9::agreement_signer_status,$10,$11,$12)
      `,
      [
        auth.tenantId,
        agreementId,
        normalizedSigner.contact_id,
        normalizedSigner.signer_name,
        normalizedSigner.signer_email,
        normalizedSigner.signer_role,
        normalizedSigner.signer_order,
        normalizedSigner.signer_type,
        normalizedSigner.status,
        normalizedSigner.viewed_at,
        normalizedSigner.signed_at,
        auth.id
      ]
    );
  }

  await insertAgreementActivityLog(client, {
    tenantId: auth.tenantId,
    agreementId,
    activityType: mode === "created" ? "signer_added" : "signer_updated",
    actorId: auth.id,
    actorRole: auth.authorityTier,
    note:
      mode === "created"
        ? "Added signer and countersigner routing to the Agreement."
        : "Updated signer and countersigner routing on the Agreement.",
    metadata: {
      signer_count: signers.length,
      signers: signers.map((signer) => ({
        signer_name: signer.signer_name,
        signer_type: signer.signer_type,
        signer_order: signer.signer_order ?? null,
        status: signer.status ?? "pending"
      }))
    }
  });
}

async function insertAgreementActivityLog(
  client: PoolClient,
  input: {
    tenantId: string;
    agreementId: string;
    activityType: AgreementActivityType;
    actorId?: string | null;
    actorRole?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO agreement_activity_log (
        tenant_id,
        agreement_id,
        activity_type,
        actor_id,
        actor_role,
        note,
        metadata
      )
      VALUES ($1,$2,$3::agreement_activity_type,$4,$5,$6,$7::jsonb)
    `,
    [
      input.tenantId,
      input.agreementId,
      input.activityType,
      input.actorId ?? null,
      input.actorRole ?? null,
      normalizeOptionalText(input.note),
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function insertAgreementProviderEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    agreementId: string;
    signerId?: string | null;
    providerName: string;
    externalEnvelopeId?: string | null;
    externalRecipientId?: string | null;
    direction: AgreementProviderEventDirection;
    eventType: AgreementProviderEventType;
    providerStatus?: string | null;
    payload?: Record<string, unknown>;
    occurredAt?: string | null;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO agreement_provider_event (
        tenant_id,
        agreement_id,
        signer_id,
        provider_name,
        external_envelope_id,
        external_recipient_id,
        direction,
        event_type,
        provider_status,
        payload,
        occurred_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::agreement_provider_event_direction,$8::agreement_provider_event_type,$9,$10::jsonb,COALESCE($11::timestamptz, now()))
      RETURNING id
    `,
    [
      input.tenantId,
      input.agreementId,
      input.signerId ?? null,
      input.providerName,
      input.externalEnvelopeId ?? null,
      input.externalRecipientId ?? null,
      input.direction,
      input.eventType,
      normalizeOptionalText(input.providerStatus),
      JSON.stringify(input.payload ?? {}),
      normalizeOptionalText(input.occurredAt)
    ]
  );
  return rows[0].id;
}

function deriveAgreementLifecycleBucket(row: Pick<AgreementListRow, "status" | "effective_date" | "expiration_date">): AgreementLifecycleBucket {
  const currentDay = todayIso();
  if (row.status === "replaced" || row.status === "cancelled") {
    return "replaced_archived";
  }
  if (row.status === "expired" || (row.expiration_date && row.expiration_date < currentDay)) {
    return "expired";
  }
  if (
    row.status === "expiring_soon" ||
    (isEffectivelyActive(row.status, row.effective_date, currentDay) &&
      row.expiration_date !== null &&
      row.expiration_date <= addDaysIso(currentDay, 90))
  ) {
    return "expiring_soon";
  }
  if (["draft", "sent", "viewed", "partially_signed", "signed"].includes(row.status)) {
    return "pending_signature";
  }
  return "active";
}

function deriveAgreementProviderLifecycle(
  row: Pick<AgreementListRow, "external_envelope_id" | "external_status" | "provider_error_state">,
  signers: AgreementSignerRecord[],
  providerEvents: AgreementProviderEventRecord[]
): { bucket: AgreementProviderLifecycleBucket; health: AgreementProviderSyncHealth } {
  const normalizedStatus = (row.external_status ?? "").trim().toLowerCase();
  if (row.provider_error_state || ["send_failed", "sync_failed", "failed_delivery", "delivery_failed"].includes(normalizedStatus)) {
    return { bucket: "issue", health: "error" };
  }

  const latestEvent = providerEvents[0] ?? null;
  if (!row.external_envelope_id) {
    if (latestEvent?.event_type === "send_requested") {
      return { bucket: "queued_to_send", health: "warning" };
    }
    return { bucket: "not_sent", health: "clear" };
  }

  const hasPendingCountersigner = signers.some(
    (signer) => signer.signer_type === "countersigner" && !["signed", "replaced", "cancelled"].includes(signer.status)
  );

  if (["countersigned", "completed"].includes(normalizedStatus)) {
    return { bucket: "completed", health: "clear" };
  }
  if (normalizedStatus === "signed") {
    return { bucket: hasPendingCountersigner ? "countersign_pending" : "completed", health: hasPendingCountersigner ? "warning" : "clear" };
  }
  if (normalizedStatus === "partially_signed") {
    return { bucket: "partially_signed", health: "warning" };
  }
  if (normalizedStatus === "viewed") {
    return { bucket: "viewed_not_signed", health: "warning" };
  }
  if (["cancelled", "voided"].includes(normalizedStatus)) {
    return { bucket: "issue", health: "error" };
  }
  return { bucket: "sent_unsigned", health: "warning" };
}

function deriveDueReminderTypes(
  row: Pick<AgreementListRow, "status" | "created_at" | "sent_at" | "expiration_date">,
  reminders: AgreementReminderRecord[]
) {
  const currentDay = todayIso();
  const sentTypes = new Set(reminders.filter((reminder) => reminder.status === "sent").map((reminder) => reminder.reminder_type));
  const due: AgreementReminderType[] = [];
  const sendAnchor = row.sent_at?.slice(0, 10) ?? row.created_at.slice(0, 10);
  const unsigned = ["draft", "sent", "viewed", "partially_signed", "signed"].includes(row.status);
  if (unsigned) {
    if (diffDays(sendAnchor, currentDay) >= 3 && !sentTypes.has("unsigned_3_day")) {
      due.push("unsigned_3_day");
    }
    if (diffDays(sendAnchor, currentDay) >= 7 && !sentTypes.has("unsigned_7_day")) {
      due.push("unsigned_7_day");
    }
    if (diffDays(sendAnchor, currentDay) >= 30 && !sentTypes.has("unsigned_30_day")) {
      due.push("unsigned_30_day");
    }
  }
  if (row.expiration_date) {
    const daysUntilExpiration = diffDays(currentDay, row.expiration_date);
    if (daysUntilExpiration <= 180 && daysUntilExpiration >= 0 && !sentTypes.has("expiration_6_month")) {
      due.push("expiration_6_month");
    }
    if (daysUntilExpiration <= 90 && daysUntilExpiration >= 0 && !sentTypes.has("expiration_90_day")) {
      due.push("expiration_90_day");
    }
    if (daysUntilExpiration <= 30 && daysUntilExpiration >= 0 && !sentTypes.has("expiration_30_day")) {
      due.push("expiration_30_day");
    }
  }
  return [...new Set(due)];
}

function deriveAgreementWarningState(
  row: Pick<AgreementListRow, "status" | "expiration_date" | "renewal_date" | "notice_deadline">,
  lifecycleBucket: AgreementLifecycleBucket,
  dueReminders: AgreementReminderType[]
) {
  const codes: AgreementWarningCode[] = [];
  if (lifecycleBucket === "pending_signature") {
    codes.push("pending_unsigned_agreement");
  }
  if (lifecycleBucket === "expiring_soon") {
    codes.push("expiring_agreement");
  }
  if (lifecycleBucket === "expired") {
    codes.push("expired_agreement");
  }

  const currentDay = todayIso();
  const renewalAnchor = row.renewal_date ?? row.notice_deadline ?? row.expiration_date;
  if (renewalAnchor && renewalAnchor <= addDaysIso(currentDay, 90)) {
    codes.push("renewal_needed");
  }
  if (!codes.length && dueReminders.includes("unsigned_30_day")) {
    codes.push("pending_unsigned_agreement");
  }

  const severity: AgreementWarningSeverity = codes.includes("expired_agreement")
    ? "major"
    : codes.length
      ? "warning"
      : "clear";
  const summary = codes.includes("expired_agreement")
    ? "This Agreement is expired and needs replacement attention."
    : codes.includes("pending_unsigned_agreement")
      ? "This Agreement still needs signature follow-through."
      : codes.includes("expiring_agreement")
        ? "This Agreement is expiring soon."
        : codes.includes("renewal_needed")
          ? "This Agreement is entering its renewal window."
          : null;

  return { codes, severity, summary };
}

function buildAgreementSummary(
  agreements: AgreementRecord[],
  upcomingShootRisks: AgreementUpcomingShootRisk[]
): OrganizationAgreementSummary {
  const summary = {
    total: 0,
    active: 0,
    pending_signature: 0,
    expiring_soon: 0,
    expired: 0,
    replaced_archived: 0,
    renewals_needed: 0,
    accounts_missing_active: 0,
    upcoming_shoot_risk_count: 0,
    has_active_agreement: false,
    has_pending_signature: false,
    has_expiring_soon: false,
    has_expired: false,
    needs_attention: false,
    warning_severity: "clear" as AgreementWarningSeverity,
    warnings: [] as AgreementAccountWarningRecord[]
  };

  summary.total = agreements.length;
  for (const agreement of agreements) {
    switch (agreement.lifecycle_bucket) {
      case "active":
        summary.active += 1;
        break;
      case "pending_signature":
        summary.pending_signature += 1;
        break;
      case "expiring_soon":
        summary.expiring_soon += 1;
        break;
      case "expired":
        summary.expired += 1;
        break;
      case "replaced_archived":
        summary.replaced_archived += 1;
        break;
    }
    if (agreement.warning_codes.includes("renewal_needed")) {
      summary.renewals_needed += 1;
    }
  }

  summary.has_active_agreement = summary.active > 0;
  summary.has_pending_signature = summary.pending_signature > 0;
  summary.has_expiring_soon = summary.expiring_soon > 0;
  summary.has_expired = summary.expired > 0;
  summary.accounts_missing_active = summary.has_active_agreement ? 0 : 1;
  summary.upcoming_shoot_risk_count = upcomingShootRisks.length;
  summary.needs_attention =
    !summary.has_active_agreement ||
    summary.pending_signature > 0 ||
    summary.expiring_soon > 0 ||
    summary.expired > 0 ||
    summary.renewals_needed > 0 ||
    upcomingShootRisks.length > 0;

  if (!summary.has_active_agreement) {
    summary.warnings.push({ code: "no_active_agreement", severity: "warning", summary: "No active Agreement is on file for this account." });
  }
  if (summary.pending_signature > 0) {
    summary.warnings.push({
      code: "pending_unsigned_agreement",
      severity: "warning",
      summary: `${summary.pending_signature} Agreement${summary.pending_signature === 1 ? "" : "s"} still need signature follow-through.`
    });
  }
  if (summary.expiring_soon > 0) {
    summary.warnings.push({
      code: "expiring_agreement",
      severity: "warning",
      summary: `${summary.expiring_soon} Agreement${summary.expiring_soon === 1 ? "" : "s"} are expiring soon.`
    });
  }
  if (summary.expired > 0) {
    summary.warnings.push({
      code: "expired_agreement",
      severity: "major",
      summary: `${summary.expired} Agreement${summary.expired === 1 ? "" : "s"} are already expired.`
    });
  }
  if (summary.renewals_needed > 0) {
    summary.warnings.push({
      code: "renewal_needed",
      severity: "warning",
      summary: `${summary.renewals_needed} Agreement${summary.renewals_needed === 1 ? "" : "s"} are in the renewal window.`
    });
  }
  if (upcomingShootRisks.length > 0) {
    summary.warnings.push({
      code: "upcoming_shoot_risk",
      severity: upcomingShootRisks.some((risk) => risk.severity === "major") ? "major" : "warning",
      summary: `${upcomingShootRisks.length} upcoming Shoot${upcomingShootRisks.length === 1 ? "" : "s"} carry agreement risk.`
    });
  }

  summary.warning_severity = summary.warnings.some((warning) => warning.severity === "major")
    ? "major"
    : summary.warnings.length
      ? "warning"
      : "clear";

  return summary;
}

function emptyAgreementSummary(): OrganizationAgreementSummary {
  return {
    total: 0,
    active: 0,
    pending_signature: 0,
    expiring_soon: 0,
    expired: 0,
    replaced_archived: 0,
    renewals_needed: 0,
    accounts_missing_active: 1,
    upcoming_shoot_risk_count: 0,
    has_active_agreement: false,
    has_pending_signature: false,
    has_expiring_soon: false,
    has_expired: false,
    needs_attention: true,
    warning_severity: "warning",
    warnings: [{ code: "no_active_agreement", severity: "warning", summary: "No active Agreement is on file for this account." }]
  };
}

function classifyUpcomingShootRisk(row: UpcomingShootRow, summary: OrganizationAgreementSummary): AgreementUpcomingShootRisk {
  const shootWarning = buildShootAgreementWarning(summary, row.shoot_date);
  return {
    shoot_id: row.shoot_id,
    shoot_code: row.shoot_code,
    title: row.title,
    shoot_date: row.shoot_date,
    severity: shootWarning.agreement_warning_severity,
    summary: shootWarning.agreement_warning_summary ?? "Agreement coverage looks clear for this Shoot.",
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    agreement_status: summary.has_expired
      ? "expired"
      : summary.has_pending_signature && !summary.has_active_agreement
        ? "sent"
        : summary.has_expiring_soon
          ? "expiring_soon"
          : summary.has_active_agreement
            ? "active"
            : null
  };
}

function mapAgreementRecord(
  row: AgreementListRow,
  lifecycleBucket: AgreementLifecycleBucket,
  related: {
    signers: AgreementSignerRecord[];
    versions: AgreementVersionRecord[];
    files: AgreementFileRecord[];
    links: AgreementLinkRecord[];
    reminders: AgreementReminderRecord[];
    due_reminders: AgreementReminderType[];
    warning_codes: AgreementWarningCode[];
    warning_severity: AgreementWarningSeverity;
    warning_summary: string | null;
    provider_lifecycle_bucket: AgreementProviderLifecycleBucket;
    provider_sync_health: AgreementProviderSyncHealth;
    provider_events: AgreementProviderEventRecord[];
    activity_log: AgreementActivityRecord[];
  }
): AgreementRecord {
  return {
    id: row.id,
    agreement_title: row.agreement_title,
    agreement_type: row.agreement_type,
    status: row.status,
    lifecycle_bucket: lifecycleBucket,
    organization_id: row.organization_id,
    organization_display_name: row.organization_display_name,
    client_account_id: row.client_account_id,
    client_account_display_name: row.client_account_display_name,
    primary_contact_id: row.primary_contact_id,
    primary_contact_name: row.primary_contact_name,
    primary_contact_email: row.primary_contact_email,
    primary_contact_phone: row.primary_contact_phone,
    source_template_id: row.source_template_id,
    source_template_name: row.source_template_name,
    description: row.description,
    contract_value: toNumber(row.contract_value),
    revenue_share_terms: row.revenue_share_terms,
    effective_date: row.effective_date,
    expiration_date: row.expiration_date,
    renewal_date: row.renewal_date,
    notice_deadline: row.notice_deadline,
    auto_renew: row.auto_renew,
    sent_at: row.sent_at,
    viewed_at: row.viewed_at,
    signed_at: row.signed_at,
    countersigned_at: row.countersigned_at,
    external_provider_name: row.external_provider_name,
    external_envelope_id: row.external_envelope_id,
    external_status: row.external_status,
    last_provider_sync_at: row.last_provider_sync_at,
    provider_error_state: row.provider_error_state,
    provider_metadata: row.provider_metadata ?? {},
    internal_countersigner_user_id: row.internal_countersigner_user_id,
    internal_countersigner_name: row.internal_countersigner_name,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name,
    updated_by_user_id: row.updated_by_user_id,
    updated_by_name: row.updated_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    replaced_by_agreement_id: row.replaced_by_agreement_id,
    replaced_by_agreement_title: row.replaced_by_agreement_title,
    prior_agreement_id: row.prior_agreement_id,
    prior_agreement_title: row.prior_agreement_title,
    signers: related.signers,
    versions: related.versions,
    files: related.files,
    links: related.links,
    reminders: related.reminders,
    due_reminders: related.due_reminders,
    warning_codes: related.warning_codes,
    warning_severity: related.warning_severity,
    warning_summary: related.warning_summary,
    provider_lifecycle_bucket: related.provider_lifecycle_bucket,
    provider_sync_health: related.provider_sync_health,
    provider_events: related.provider_events,
    activity_log: related.activity_log
  };
}

function mapAgreementFile(row: AgreementFileRow): AgreementFileRecord {
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    agreement_version_id: row.agreement_version_id,
    file_type: row.file_type,
    file_name: row.file_name,
    storage_reference: row.storage_reference,
    file_url: row.file_url,
    content_type: row.content_type,
    file_size_bytes: toNumber(row.file_size_bytes),
    version_label: row.version_label,
    is_current: row.is_current,
    uploaded_by_user_id: row.uploaded_by_user_id,
    uploaded_by_name: row.uploaded_by_name,
    uploaded_at: row.uploaded_at
  };
}

function mapAgreementLink(row: AgreementLinkRow): AgreementLinkRecord {
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    linked_entity_type: row.linked_entity_type,
    linked_entity_id: row.linked_entity_id,
    relationship_type: row.relationship_type,
    label: row.label,
    secondary_label: row.secondary_label,
    created_at: row.created_at
  };
}

function mapAgreementActivity(row: AgreementActivityRow): AgreementActivityRecord {
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    activity_type: row.activity_type,
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    actor_role: row.actor_role,
    timestamp: row.timestamp,
    note: row.note,
    metadata: row.metadata ?? {}
  };
}

function mapAgreementTemplate(row: AgreementTemplateRow): AgreementTemplateRecord {
  return {
    id: row.id,
    template_name: row.template_name,
    agreement_type: row.agreement_type,
    active_status: row.active_status,
    template_body: row.template_body,
    template_file_reference: row.template_file_reference,
    merge_fields: normalizeMergeFields(row.merge_fields),
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapAgreementSigner(row: AgreementSignerRow): AgreementSignerRecord {
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    contact_id: row.contact_id,
    signer_name: row.signer_name,
    signer_email: row.signer_email,
    signer_role: row.signer_role,
    signer_order: row.signer_order,
    signer_type: row.signer_type,
    status: row.status,
    external_recipient_id: row.external_recipient_id,
    external_status: row.external_status,
    last_provider_sync_at: row.last_provider_sync_at,
    viewed_at: row.viewed_at,
    signed_at: row.signed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapAgreementProviderEvent(row: AgreementProviderEventRow): AgreementProviderEventRecord {
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    signer_id: row.signer_id,
    provider_name: row.provider_name,
    external_envelope_id: row.external_envelope_id,
    external_recipient_id: row.external_recipient_id,
    direction: row.direction,
    event_type: row.event_type,
    provider_status: row.provider_status,
    payload: row.payload ?? {},
    occurred_at: row.occurred_at,
    created_at: row.created_at
  };
}

function mapAgreementVersion(row: AgreementVersionRow, files: AgreementFileRecord[]): AgreementVersionRecord {
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    version_number: toNumber(row.version_number) ?? 1,
    version_label: row.version_label,
    version_stage: row.version_stage,
    prior_version_id: row.prior_version_id,
    source_template_id: row.source_template_id,
    source_template_name: row.source_template_name,
    rendered_body: row.rendered_body,
    merge_snapshot: row.merge_snapshot ?? {},
    is_current: row.is_current,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    files
  };
}

function mapAgreementReminder(row: AgreementReminderRow): AgreementReminderRecord {
  return {
    id: row.id,
    agreement_id: row.agreement_id,
    signer_id: row.signer_id,
    reminder_type: row.reminder_type,
    reminder_channel: row.reminder_channel,
    status: row.status,
    follow_up_state: row.follow_up_state,
    recipient_name: row.recipient_name,
    recipient_email: row.recipient_email,
    due_at: row.due_at,
    sent_at: row.sent_at,
    triggered_by_user_id: row.triggered_by_user_id,
    triggered_by_name: row.triggered_by_name,
    note: row.note,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function groupByAgreement<T extends { agreement_id: string }, M>(rows: T[], mapper: (row: T) => M) {
  const grouped = new Map<string, M[]>();
  for (const row of rows) {
    const existing = grouped.get(row.agreement_id) ?? [];
    existing.push(mapper(row));
    grouped.set(row.agreement_id, existing);
  }
  return grouped;
}

function mapAgreementCoverageRowToAgreementRecord(row: OrganizationCoverageRow): AgreementRecord {
  const lifecycleBucket = deriveAgreementLifecycleBucket({
    status: row.status,
    effective_date: row.effective_date,
    expiration_date: row.expiration_date
  });
  const warningState = deriveAgreementWarningState(
    {
      status: row.status,
      expiration_date: row.expiration_date,
      renewal_date: row.renewal_date,
      notice_deadline: row.notice_deadline
    },
    lifecycleBucket,
    []
  );
  return {
    id: row.agreement_id,
    agreement_title: "",
    agreement_type: "schools",
    status: row.status,
    lifecycle_bucket: lifecycleBucket,
    organization_id: row.organization_id,
    organization_display_name: null,
    client_account_id: row.client_account_id,
    client_account_display_name: null,
    primary_contact_id: null,
    primary_contact_name: null,
    primary_contact_email: null,
    primary_contact_phone: null,
    source_template_id: null,
    source_template_name: null,
    description: null,
    contract_value: null,
    revenue_share_terms: null,
    effective_date: row.effective_date,
    expiration_date: row.expiration_date,
    renewal_date: row.renewal_date,
    notice_deadline: row.notice_deadline,
    auto_renew: null,
    sent_at: null,
    viewed_at: null,
    signed_at: null,
    countersigned_at: null,
    external_provider_name: null,
    external_envelope_id: null,
    external_status: null,
    last_provider_sync_at: null,
    provider_error_state: null,
    provider_metadata: {},
    internal_countersigner_user_id: null,
    internal_countersigner_name: null,
    created_by_user_id: "",
    created_by_name: null,
    updated_by_user_id: "",
    updated_by_name: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    replaced_by_agreement_id: null,
    replaced_by_agreement_title: null,
    prior_agreement_id: null,
    prior_agreement_title: null,
    signers: [],
    versions: [],
    files: [],
    links: [],
    reminders: [],
    due_reminders: [],
    warning_codes: warningState.codes,
    warning_severity: warningState.severity,
    warning_summary: warningState.summary,
    provider_lifecycle_bucket: "not_sent",
    provider_sync_health: "clear",
    provider_events: [],
    activity_log: []
  };
}

function snapshotAgreementForAudit(existing: Pick<AgreementListRow, "status" | "internal_countersigner_user_id" | "prior_agreement_id" | "replaced_by_agreement_id" | "source_template_id">) {
  return {
    status: existing.status,
    internal_countersigner_user_id: existing.internal_countersigner_user_id,
    source_template_id: existing.source_template_id,
    prior_agreement_id: existing.prior_agreement_id,
    replaced_by_agreement_id: existing.replaced_by_agreement_id
  };
}

function assertAgreementManageAccess(auth: AuthUser) {
  if (!canManageAgreements(auth)) {
    throw new ApiError(403, "You do not have permission to create or manage Agreements.");
  }
}

async function assertOrganizationExists(client: PoolClient, tenantId: string, organizationId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, organizationId]
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "Organization not found");
  }
}

async function assertAgreementTemplateId(client: PoolClient, tenantId: string, templateId: string | null) {
  if (!templateId) {
    return;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM agreement_template
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, templateId]
  );
  if (!result.rows[0]) {
    throw new ApiError(400, "The selected Agreement template could not be found.");
  }
}

async function assertPrimaryContactBelongsToOrganization(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  primaryContactId: string | null
) {
  if (!primaryContactId) {
    return;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = $3
      LIMIT 1
    `,
    [tenantId, organizationId, primaryContactId]
  );
  if (!result.rows[0]) {
    throw new ApiError(400, "The selected primary Contact does not belong to this Organization.");
  }
}

async function assertLinkedContactsBelongToOrganization(client: PoolClient, tenantId: string, organizationId: string, linkedContactIds: string[]) {
  if (!linkedContactIds.length) {
    return;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = ANY($3::uuid[])
    `,
    [tenantId, organizationId, linkedContactIds]
  );
  if (result.rows.length !== linkedContactIds.length) {
    throw new ApiError(400, "One or more linked Contacts do not belong to this Organization.");
  }
}

async function assertLinkedLocationsBelongToOrganization(client: PoolClient, tenantId: string, organizationId: string, linkedLocationIds: string[]) {
  if (!linkedLocationIds.length) {
    return;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM shoot_location
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = ANY($3::uuid[])
    `,
    [tenantId, organizationId, linkedLocationIds]
  );
  if (result.rows.length !== linkedLocationIds.length) {
    throw new ApiError(400, "One or more linked Locations do not belong to this Organization.");
  }
}

async function assertSignerContactsBelongToOrganization(client: PoolClient, tenantId: string, organizationId: string, signers: AgreementSignerInput[]) {
  const signerContactIds = dedupeIds(signers.map((signer) => signer.contact_id ?? "").filter(Boolean));
  if (!signerContactIds.length) {
    return;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM organization_contact
      WHERE tenant_id = $1
        AND organization_id = $2
        AND id = ANY($3::uuid[])
    `,
    [tenantId, organizationId, signerContactIds]
  );
  if (result.rows.length !== signerContactIds.length) {
    throw new ApiError(400, "One or more Agreement signers are linked to a Contact outside this Organization.");
  }
}

async function assertRelatedAgreementIds(client: PoolClient, tenantId: string, agreementIds: Array<string | null>, currentAgreementId?: string) {
  const ids = dedupeIds(agreementIds.filter((value): value is string => Boolean(value)).filter((value) => value !== currentAgreementId));
  if (!ids.length) {
    return;
  }
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM agreement
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
    `,
    [tenantId, ids]
  );
  if (result.rows.length !== ids.length) {
    throw new ApiError(400, "A related prior or replacement Agreement could not be found.");
  }
}

function normalizeAgreementInput(input: CreateAgreementInput | UpdateAgreementInput) {
  return {
    agreement_title: input.agreement_title.trim(),
    agreement_type: input.agreement_type,
    status: input.status ?? "draft",
    primary_contact_id: input.primary_contact_id ?? null,
    source_template_id: input.source_template_id ?? null,
    description: normalizeOptionalText(input.description),
    contract_value: input.contract_value ?? null,
    revenue_share_terms: normalizeOptionalText(input.revenue_share_terms),
    effective_date: normalizeOptionalText(input.effective_date),
    expiration_date: normalizeOptionalText(input.expiration_date),
    renewal_date: normalizeOptionalText(input.renewal_date),
    notice_deadline: normalizeOptionalText(input.notice_deadline),
    auto_renew: typeof input.auto_renew === "boolean" ? input.auto_renew : null,
    sent_at: normalizeOptionalText(input.sent_at),
    viewed_at: normalizeOptionalText(input.viewed_at),
    signed_at: normalizeOptionalText(input.signed_at),
    countersigned_at: normalizeOptionalText(input.countersigned_at),
    prior_agreement_id: input.prior_agreement_id ?? null,
    replaced_by_agreement_id: input.replaced_by_agreement_id ?? null
  };
}

function normalizeSignerInput(input: AgreementSignerInput) {
  return {
    contact_id: input.contact_id ?? null,
    signer_name: input.signer_name.trim(),
    signer_email: normalizeOptionalText(input.signer_email),
    signer_role: normalizeOptionalText(input.signer_role),
    signer_order: input.signer_order ?? null,
    signer_type: input.signer_type,
    status: input.status ?? "pending",
    viewed_at: normalizeOptionalText(input.viewed_at),
    signed_at: normalizeOptionalText(input.signed_at)
  };
}

function normalizeDraftTemplateSigners(
  signers: AgreementSignerInput[],
  primaryContactName: string | null,
  primaryContactId: string | null
): AgreementSignerInput[] {
  if (signers.length) {
    return signers;
  }
  if (!primaryContactName) {
    return [];
  }
  return [
    {
      contact_id: primaryContactId,
      signer_name: primaryContactName,
      signer_type: "external",
      status: "pending",
      signer_order: 1
    }
  ];
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dedupeIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMergeFields(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((field) => String(field)).filter(Boolean);
}

function buildTemplateMergeSnapshot(
  template: AgreementTemplateRecord,
  context: OrganizationMergeContext,
  input: { agreement_title?: string | null; effective_date?: string | null; expiration_date?: string | null; renewal_date?: string | null; notice_deadline?: string | null; contract_value?: number | null; revenue_share_terms?: string | null; signers: AgreementSignerInput[] }
) {
  const signerNames = input.signers.map((signer) => signer.signer_name).filter(Boolean);
  const snapshot: Record<string, unknown> = {
    organization_name: context.organizationName,
    client_contact_name: context.primaryContactName,
    agreement_title: input.agreement_title ?? null,
    effective_date: input.effective_date ?? null,
    expiration_date: input.expiration_date ?? null,
    renewal_date: input.renewal_date ?? null,
    notice_deadline: input.notice_deadline ?? null,
    contract_value: input.contract_value ?? null,
    revenue_share_terms: input.revenue_share_terms ?? null,
    signer_names: signerNames.join(", ")
  };
  for (const mergeField of template.merge_fields) {
    if (!(mergeField in snapshot)) {
      snapshot[mergeField] = null;
    }
  }
  return snapshot;
}

function renderAgreementTemplate(templateBody: string | null, snapshot: Record<string, unknown>) {
  if (!templateBody) {
    return null;
  }
  let rendered = templateBody;
  for (const [key, value] of Object.entries(snapshot)) {
    const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
    rendered = rendered.replace(pattern, value == null ? "" : String(value));
  }
  return rendered;
}

function resolveReminderRecipients(signers: AgreementSignerRecord[]) {
  return signers
    .filter((signer) => signer.signer_type !== "internal")
    .filter((signer) => !["signed", "replaced", "cancelled"].includes(signer.status))
    .filter((signer) => Boolean(signer.signer_email))
    .map((signer) => ({ signer_id: signer.id, recipient_name: signer.signer_name, recipient_email: signer.signer_email }));
}

function buildReminderFollowUpState(reminderType: AgreementReminderType) {
  switch (reminderType) {
    case "unsigned_3_day":
      return "unsigned_3_day_follow_up";
    case "unsigned_7_day":
      return "unsigned_7_day_follow_up";
    case "unsigned_30_day":
      return "unsigned_30_day_follow_up";
    case "expiration_6_month":
      return "expiration_6_month_follow_up";
    case "expiration_90_day":
      return "expiration_90_day_follow_up";
    case "expiration_30_day":
      return "expiration_30_day_follow_up";
    default:
      return "manual_follow_up";
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isEffectivelyActive(status: AgreementStatus, effectiveDate: string | null, currentDay: string) {
  if (status === "active" || status === "countersigned") {
    return true;
  }
  if (status === "signed" && effectiveDate && effectiveDate <= currentDay) {
    return true;
  }
  return false;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(baseIso: string, days: number) {
  const value = new Date(`${baseIso}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function diffDays(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T12:00:00.000Z`).getTime();
  const end = new Date(`${endIso}T12:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86400000);
}

function humanizeAgreementStatus(status: AgreementStatus) {
  switch (status) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "viewed":
      return "Viewed";
    case "partially_signed":
      return "Partially Signed";
    case "signed":
      return "Signed";
    case "countersigned":
      return "Countersigned";
    case "active":
      return "Active";
    case "expiring_soon":
      return "Expiring Soon";
    case "expired":
      return "Expired";
    case "replaced":
      return "Replaced";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function humanizeAgreementType(type: AgreementType) {
  switch (type) {
    case "schools":
      return "Schools";
    case "sports":
      return "Sports";
    case "events":
      return "Events";
    case "studio_client":
      return "Studio / Client";
    case "nda":
      return "NDA";
    case "image_release":
      return "Image Release";
    default:
      return type;
  }
}

function humanizeReminderType(type: AgreementReminderType) {
  switch (type) {
    case "unsigned_3_day":
      return "3-day unsigned";
    case "unsigned_7_day":
      return "7-day unsigned";
    case "unsigned_30_day":
      return "30-day unsigned";
    case "expiration_6_month":
      return "6-month expiration";
    case "expiration_90_day":
      return "90-day expiration";
    case "expiration_30_day":
      return "30-day expiration";
    default:
      return "manual follow-up";
  }
}
