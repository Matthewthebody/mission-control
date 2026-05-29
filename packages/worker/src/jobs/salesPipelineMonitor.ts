import type { PoolClient } from "pg";
import { pool } from "../db.js";

const INACTIVE_OPPORTUNITY_DAYS = 14;

type OpportunityCandidate = {
  tenant_id: string;
  opportunity_id: string;
  organization_id: string;
  organization_display_name: string;
  owner_id: string | null;
  pipeline_type: "schools" | "sports";
  stage: string;
  status: string;
  next_action_date: string | null;
  last_touch_date: string;
};

type AgreementCandidate = {
  tenant_id: string;
  agreement_id: string;
  organization_id: string;
  organization_display_name: string;
  agreement_title: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  expiration_date: string | null;
  opportunity_id: string | null;
  owner_id: string | null;
  pipeline_type: "schools" | "sports" | null;
};

type AgreementReminderSignalRow = {
  agreement_id: string;
  reminder_type: AgreementReminderType;
  status: string;
};

type AgreementReminderRecipient = {
  agreement_id: string;
  signer_id: string;
  signer_name: string;
  signer_email: string;
};

type AgreementReminderType =
  | "unsigned_3_day"
  | "unsigned_7_day"
  | "unsigned_30_day"
  | "expiration_6_month"
  | "expiration_90_day"
  | "expiration_30_day";

type SalesAlertType = "missing_next_action" | "inactive_opportunity" | "meeting_scheduled";

async function createAppEvent(client: any, input: {
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string;
}) {
  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT (tenant_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
    `,
    [input.tenantId, input.eventType, input.aggregateType, input.aggregateId ?? null, JSON.stringify(input.payload), input.dedupeKey]
  );
}

async function insertAuditLog(client: any, input: {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  reasonComment?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `
      INSERT INTO audit_log (
        tenant_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        previous_values,
        new_values,
        reason_comment,
        metadata
      )
      VALUES ($1,NULL,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb)
    `,
    [
      input.tenantId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.previousValues ?? {}),
      JSON.stringify(input.newValues ?? {}),
      input.reasonComment ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function getLeadershipRecipients(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT DISTINCT au.id
      FROM user_authority_assignment uaa
      JOIN app_user au
        ON au.id = uaa.user_id
       AND au.tenant_id = uaa.tenant_id
      WHERE uaa.tenant_id = $1
        AND uaa.authority_tier IN ('super_admin', 'leadership', 'director_admin')
        AND au.status = 'active'
    `,
    [tenantId]
  );

  return rows.map((row: any) => String(row.id));
}

async function getOpportunityRecipients(client: any, input: {
  tenantId: string;
  ownerId?: string | null;
}) {
  const recipients = new Set<string>(await getLeadershipRecipients(client, input.tenantId));
  if (input.ownerId) {
    recipients.add(String(input.ownerId));
  }
  return [...recipients];
}

async function queueInternalNotification(client: any, input: {
  tenantId: string;
  recipientUserIds: string[];
  aggregateId: string;
  notificationType: string;
  title: string;
  body: string;
  priority: "normal" | "high";
  deepLink?: string | null;
  metadata?: Record<string, unknown>;
}) {
  for (const recipientUserId of input.recipientUserIds) {
    for (const channel of ["in_app", "email"]) {
      await createAppEvent(client, {
        tenantId: input.tenantId,
        eventType: "notification.dispatch",
        aggregateType: "sales_pipeline_alert",
        aggregateId: input.aggregateId,
        dedupeKey: `sales-notify:${input.aggregateId}:${input.notificationType}:${recipientUserId}:${channel}`,
        payload: {
          tenant_id: input.tenantId,
          recipient_user_id: recipientUserId,
          notification_type: input.notificationType,
          channel,
          priority: input.priority,
          title: input.title,
          body: input.body,
          deep_link: input.deepLink ?? "/sales",
          metadata: input.metadata ?? {}
        }
      });
    }
  }
}

async function listTrackedOpportunities(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT
        so.tenant_id,
        so.id AS opportunity_id,
        so.organization_id,
        org.display_name AS organization_display_name,
        so.owner_id,
        so.pipeline_type::text AS pipeline_type,
        so.stage::text AS stage,
        so.status::text AS status,
        so.next_action_date::text AS next_action_date,
        so.last_touch_date::text AS last_touch_date
      FROM sales_opportunity so
      JOIN organization org
        ON org.tenant_id = so.tenant_id
       AND org.id = so.organization_id
      WHERE so.tenant_id = $1
        AND so.status IN ('active', 'dormant')
    `,
    [tenantId]
  );

  return rows as OpportunityCandidate[];
}

function buildOpportunityAlerts(opportunity: OpportunityCandidate) {
  const alerts: Array<{
    alertType: SalesAlertType;
    severity: "warning" | "major" | "critical";
    title: string;
    message: string;
    dueAt: string | null;
    dedupeKey: string;
  }> = [];

  if (opportunity.status === "active" && !opportunity.next_action_date) {
    alerts.push({
      alertType: "missing_next_action",
      severity: "critical",
      title: `Missing Next Action: ${opportunity.organization_display_name}`,
      message: `${opportunity.organization_display_name} is active in the ${labelPipeline(opportunity.pipeline_type)} without a next action date.`,
      dueAt: null,
      dedupeKey: `sales-opportunity:${opportunity.opportunity_id}:missing-next-action`
    });
  }

  if (opportunity.status === "active" && diffDays(opportunity.last_touch_date, todayIso()) >= INACTIVE_OPPORTUNITY_DAYS) {
    alerts.push({
      alertType: "inactive_opportunity",
      severity: diffDays(opportunity.last_touch_date, todayIso()) >= 30 ? "major" : "warning",
      title: `Inactive Opportunity: ${opportunity.organization_display_name}`,
      message: `${opportunity.organization_display_name} has not been touched in ${diffDays(opportunity.last_touch_date, todayIso())} days.`,
      dueAt: addDaysIso(opportunity.last_touch_date, INACTIVE_OPPORTUNITY_DAYS),
      dedupeKey: `sales-opportunity:${opportunity.opportunity_id}:inactive`
    });
  }

  if (opportunity.status === "active" && opportunity.stage === "meeting_scheduled") {
    alerts.push({
      alertType: "meeting_scheduled",
      severity: "warning",
      title: `Meeting Scheduled: ${opportunity.organization_display_name}`,
      message: `${opportunity.organization_display_name} moved into Meeting Scheduled in the ${labelPipeline(opportunity.pipeline_type)}.`,
      dueAt: opportunity.next_action_date,
      dedupeKey: `sales-opportunity:${opportunity.opportunity_id}:meeting-scheduled`
    });
  }

  return alerts;
}

async function upsertOpportunityAlert(client: any, opportunity: OpportunityCandidate, input: ReturnType<typeof buildOpportunityAlerts>[number]) {
  const existing = await client.query(
    `
      SELECT *
      FROM sales_pipeline_alert
      WHERE tenant_id = $1
        AND dedupe_key = $2
        AND status = 'open'
      LIMIT 1
      FOR UPDATE
    `,
    [opportunity.tenant_id, input.dedupeKey]
  );

  if (existing.rows[0]) {
    await client.query(
      `
        UPDATE sales_pipeline_alert
        SET
          severity = $3::sales_pipeline_alert_severity,
          title = $4,
          message = $5,
          due_at = $6::timestamptz,
          last_triggered_at = now(),
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [opportunity.tenant_id, existing.rows[0].id, input.severity, input.title, input.message, input.dueAt]
    );
    return;
  }

  const insertResult = await client.query(
    `
      INSERT INTO sales_pipeline_alert (
        tenant_id,
        alert_type,
        status,
        severity,
        dedupe_key,
        pipeline_type,
        opportunity_id,
        organization_id,
        title,
        message,
        due_at,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1,$2::sales_pipeline_alert_type,'open',$3::sales_pipeline_alert_severity,$4,$5::sales_pipeline_type,$6,$7,$8,$9,$10::timestamptz,$11::jsonb,now(),now())
      RETURNING *
    `,
    [
      opportunity.tenant_id,
      input.alertType,
      input.severity,
      input.dedupeKey,
      opportunity.pipeline_type,
      opportunity.opportunity_id,
      opportunity.organization_id,
      input.title,
      input.message,
      input.dueAt,
      JSON.stringify({
        stage: opportunity.stage,
        status: opportunity.status,
        owner_id: opportunity.owner_id
      })
    ]
  );

  const alert = insertResult.rows[0];
  await insertAuditLog(client, {
    tenantId: opportunity.tenant_id,
    action: "sales_pipeline.alert.created",
    entityType: "sales_pipeline_alert",
    entityId: alert.id,
    newValues: alert,
    reasonComment: `CRM automation created ${input.alertType}.`,
    metadata: {
      opportunity_id: opportunity.opportunity_id,
      alert_type: input.alertType
    }
  });
}

async function resolveOpportunityAlert(client: any, tenantId: string, dedupeKey: string, reasonComment: string) {
  const { rows } = await client.query(
    `
      UPDATE sales_pipeline_alert
      SET
        status = 'resolved',
        resolved_at = now(),
        resolution_note = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND dedupe_key = $2
        AND status = 'open'
      RETURNING *
    `,
    [tenantId, dedupeKey, reasonComment]
  );

  const alert = rows[0];
  if (!alert) {
    return;
  }

  await insertAuditLog(client, {
    tenantId,
    action: "sales_pipeline.alert.auto_resolved",
    entityType: "sales_pipeline_alert",
    entityId: alert.id,
    newValues: alert,
    reasonComment,
    metadata: {
      dedupe_key: dedupeKey
    }
  });
}

async function syncOpportunityAlerts(client: any, tenantId: string) {
  const opportunities = await listTrackedOpportunities(client, tenantId);
  const desiredKeys = new Set<string>();

  for (const opportunity of opportunities) {
    const desiredAlerts = buildOpportunityAlerts(opportunity);

    for (const alert of desiredAlerts) {
      desiredKeys.add(alert.dedupeKey);
      await upsertOpportunityAlert(client, opportunity, alert);
    }
  }

  const { rows } = await client.query(
    `
      SELECT dedupe_key, alert_type::text AS alert_type
      FROM sales_pipeline_alert
      WHERE tenant_id = $1
        AND status = 'open'
        AND opportunity_id IS NOT NULL
    `,
    [tenantId]
  );

  for (const row of rows as Array<{ dedupe_key: string; alert_type: SalesAlertType }>) {
    if (desiredKeys.has(row.dedupe_key)) {
      continue;
    }
    await resolveOpportunityAlert(client, tenantId, row.dedupe_key, buildAlertResolutionReason(row.alert_type));
  }
}

async function notifyNewSalesAlerts(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT
        spa.*,
        so.owner_id
      FROM sales_pipeline_alert spa
      LEFT JOIN sales_opportunity so
        ON so.tenant_id = spa.tenant_id
       AND so.id = spa.opportunity_id
      WHERE spa.tenant_id = $1
        AND spa.status = 'open'
        AND spa.first_notified_at IS NULL
      ORDER BY spa.created_at ASC
    `,
    [tenantId]
  );

  for (const row of rows) {
    const recipients = await getOpportunityRecipients(client, {
      tenantId,
      ownerId: row.owner_id ?? null
    });
    if (!recipients.length) {
      continue;
    }

    await queueInternalNotification(client, {
      tenantId,
      recipientUserIds: recipients,
      aggregateId: row.id,
      notificationType: `sales.${row.alert_type}`,
      title: row.title,
      body: row.message,
      priority: row.alert_type === "meeting_scheduled" ? "normal" : "high",
      deepLink: "/sales",
      metadata: {
        alert_type: row.alert_type,
        opportunity_id: row.opportunity_id ?? null,
        organization_id: row.organization_id ?? null
      }
    });

    await client.query(
      `
        UPDATE sales_pipeline_alert
        SET
          first_notified_at = now(),
          last_notified_at = now(),
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, row.id]
    );
  }
}

async function listAgreementCandidates(client: any, tenantId: string) {
  const { rows } = await client.query(
    `
      SELECT
        a.tenant_id,
        a.id AS agreement_id,
        a.organization_id,
        org.display_name AS organization_display_name,
        a.agreement_title,
        a.status::text AS status,
        a.sent_at::text,
        a.created_at::text,
        a.expiration_date::text,
        so.id AS opportunity_id,
        so.owner_id,
        so.pipeline_type::text AS pipeline_type
      FROM agreement a
      JOIN organization org
        ON org.tenant_id = a.tenant_id
       AND org.id = a.organization_id
      LEFT JOIN LATERAL (
        SELECT id, owner_id, pipeline_type::text
        FROM sales_opportunity
        WHERE tenant_id = a.tenant_id
          AND organization_id = a.organization_id
          AND status IN ('active', 'dormant')
        ORDER BY
          CASE status
            WHEN 'active' THEN 0
            WHEN 'dormant' THEN 1
            ELSE 2
          END,
          updated_at DESC
        LIMIT 1
      ) so ON true
      WHERE a.tenant_id = $1
        AND a.organization_id IS NOT NULL
        AND a.status NOT IN ('replaced', 'cancelled')
    `,
    [tenantId]
  );

  return rows as AgreementCandidate[];
}

async function loadAgreementReminderSignals(client: any, tenantId: string, agreementIds: string[]) {
  if (!agreementIds.length) {
    return new Map<string, Set<AgreementReminderType>>();
  }

  const { rows } = await client.query(
    `
      SELECT agreement_id, reminder_type::text AS reminder_type, status::text AS status
      FROM agreement_reminder
      WHERE tenant_id = $1
        AND agreement_id = ANY($2::uuid[])
    `,
    [tenantId, agreementIds]
  );

  const sentByAgreement = new Map<string, Set<AgreementReminderType>>();
  for (const row of rows as AgreementReminderSignalRow[]) {
    if (!["queued", "sent"].includes(row.status)) {
      continue;
    }
    const current = sentByAgreement.get(row.agreement_id) ?? new Set<AgreementReminderType>();
    current.add(row.reminder_type);
    sentByAgreement.set(row.agreement_id, current);
  }

  return sentByAgreement;
}

async function loadAgreementReminderRecipients(client: any, tenantId: string, agreementIds: string[]) {
  if (!agreementIds.length) {
    return new Map<string, AgreementReminderRecipient[]>();
  }

  const { rows } = await client.query(
    `
      SELECT
        agreement_id,
        id AS signer_id,
        signer_name,
        signer_email
      FROM agreement_signer
      WHERE tenant_id = $1
        AND agreement_id = ANY($2::uuid[])
        AND signer_type <> 'internal'
        AND status NOT IN ('signed', 'replaced', 'cancelled')
        AND NULLIF(trim(COALESCE(signer_email, '')), '') IS NOT NULL
      ORDER BY signer_order NULLS LAST, created_at ASC
    `,
    [tenantId, agreementIds]
  );

  const grouped = new Map<string, AgreementReminderRecipient[]>();
  for (const row of rows as AgreementReminderRecipient[]) {
    const recipients = grouped.get(row.agreement_id) ?? [];
    recipients.push(row);
    grouped.set(row.agreement_id, recipients);
  }
  return grouped;
}

function deriveDueReminderTypes(candidate: AgreementCandidate, sentTypes: Set<AgreementReminderType>) {
  const due: AgreementReminderType[] = [];
  const sendAnchor = candidate.sent_at?.slice(0, 10) ?? candidate.created_at.slice(0, 10);
  const unsigned = ["draft", "sent", "viewed", "partially_signed", "signed"].includes(candidate.status);
  if (unsigned) {
    const ageDays = diffDays(sendAnchor, todayIso());
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
  if (candidate.expiration_date) {
    const daysUntilExpiration = diffDays(todayIso(), candidate.expiration_date);
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

async function insertAgreementActivityLog(client: any, input: {
  tenantId: string;
  agreementId: string;
  activityType: string;
  note: string;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `
      INSERT INTO agreement_activity_log (
        tenant_id,
        agreement_id,
        activity_type,
        actor_id,
        actor_role,
        timestamp,
        note,
        metadata
      )
      VALUES ($1,$2,$3,NULL,'system',now(),$4,$5::jsonb)
    `,
    [input.tenantId, input.agreementId, input.activityType, input.note, JSON.stringify(input.metadata ?? {})]
  );
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
    default:
      return "expiration_30_day_follow_up";
  }
}

function humanizeReminderType(reminderType: AgreementReminderType) {
  switch (reminderType) {
    case "unsigned_3_day":
      return "3-day unsigned";
    case "unsigned_7_day":
      return "7-day unsigned";
    case "unsigned_30_day":
      return "30-day unsigned";
    case "expiration_6_month":
      return "6-month renewal";
    case "expiration_90_day":
      return "90-day renewal";
    default:
      return "30-day renewal";
  }
}

function buildAlertResolutionReason(alertType: SalesAlertType) {
  switch (alertType) {
    case "missing_next_action":
      return "Missing next action alert auto-resolved after a next action date was added or the opportunity left active follow-up.";
    case "inactive_opportunity":
      return "Inactive opportunity alert auto-resolved after recent touch activity was updated or the opportunity left active follow-up.";
    default:
      return "Meeting scheduled alert auto-resolved after the opportunity moved to another stage.";
  }
}

async function processAgreementReminders(client: any, tenantId: string) {
  const agreements = await listAgreementCandidates(client, tenantId);
  const reminderSignals = await loadAgreementReminderSignals(
    client,
    tenantId,
    agreements.map((agreement) => agreement.agreement_id)
  );
  const recipientsByAgreement = await loadAgreementReminderRecipients(
    client,
    tenantId,
    agreements.map((agreement) => agreement.agreement_id)
  );

  for (const agreement of agreements) {
    const dueTypes = deriveDueReminderTypes(agreement, reminderSignals.get(agreement.agreement_id) ?? new Set<AgreementReminderType>());
    if (!dueTypes.length) {
      continue;
    }

    const recipients = recipientsByAgreement.get(agreement.agreement_id) ?? [];
    if (!recipients.length) {
      continue;
    }

    for (const reminderType of dueTypes) {
      const existingReminder = await client.query(
        `
          SELECT 1
          FROM agreement_reminder
          WHERE tenant_id = $1
            AND agreement_id = $2
            AND reminder_type = $3::agreement_reminder_type
            AND status IN ('queued', 'sent')
          LIMIT 1
        `,
        [tenantId, agreement.agreement_id, reminderType]
      );
      if (existingReminder.rows[0]) {
        continue;
      }

      const reminderIds: string[] = [];

      for (const recipient of recipients) {
        const reminderInsert = await (client as PoolClient).query(
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
            VALUES ($1,$2,$3,$4::agreement_reminder_type,'email','queued',$5,$6,$7,now(),NULL,NULL,$8,$9::jsonb)
            RETURNING id
          `,
          [
            tenantId,
            agreement.agreement_id,
            recipient.signer_id,
            reminderType,
            buildReminderFollowUpState(reminderType),
            recipient.signer_name,
            recipient.signer_email,
            `Automated ${humanizeReminderType(reminderType)} reminder from CRM automation.`,
            JSON.stringify({
              agreement_title: agreement.agreement_title,
              organization_id: agreement.organization_id,
              automation_source: "sales_pipeline_monitor"
            })
          ]
        );

        const reminderId = reminderInsert.rows[0]?.id as string | undefined;
        if (!reminderId) {
          continue;
        }
        reminderIds.push(reminderId);

        await createAppEvent(client, {
          tenantId,
          eventType: "agreement.reminder_requested",
          aggregateType: "agreement_reminder",
          aggregateId: reminderId,
          dedupeKey: `agreement-reminder:${agreement.agreement_id}:${reminderId}:email`,
          payload: {
            agreement_id: agreement.agreement_id,
            agreement_title: agreement.agreement_title,
            organization_id: agreement.organization_id,
            organization_display_name: agreement.organization_display_name,
            reminder_type: reminderType,
            reminder_id: reminderId,
            channel: "email",
            recipient_name: recipient.signer_name,
            recipient_email: recipient.signer_email,
            signer_id: recipient.signer_id,
            actor_user_id: null,
            note: `Automated ${humanizeReminderType(reminderType)} reminder from CRM automation.`
          }
        });
      }

      if (!reminderIds.length) {
        continue;
      }

      await insertAgreementActivityLog(client, {
        tenantId,
        agreementId: agreement.agreement_id,
        activityType: "reminder_sent",
        note: `CRM automation queued ${humanizeReminderType(reminderType)} reminders for unsigned signers.`,
        metadata: {
          reminder_type: reminderType,
          reminder_ids: reminderIds
        }
      });

      await insertAuditLog(client, {
        tenantId,
        action: "agreement.reminder.auto_sent",
        entityType: "agreement",
        entityId: agreement.agreement_id,
        newValues: {
          reminder_type: reminderType,
          reminder_ids: reminderIds
        },
        reasonComment: `CRM automation queued ${humanizeReminderType(reminderType)} reminders.`,
        metadata: {
          organization_id: agreement.organization_id
        }
      });

      const internalRecipients = await getOpportunityRecipients(client, {
        tenantId,
        ownerId: agreement.owner_id
      });
      if (internalRecipients.length) {
        await queueInternalNotification(client, {
          tenantId,
          recipientUserIds: internalRecipients,
          aggregateId: agreement.agreement_id,
          notificationType: reminderType.startsWith("unsigned_") ? "sales.contract_reminder" : "sales.renewal_reminder",
          title: `${humanizeReminderType(reminderType)} reminder: ${agreement.organization_display_name}`,
          body: `${agreement.agreement_title} triggered a ${humanizeReminderType(reminderType)} automation reminder.`,
          priority: reminderType === "unsigned_30_day" || reminderType === "expiration_30_day" ? "high" : "normal",
          deepLink: "/organizations",
          metadata: {
            agreement_id: agreement.agreement_id,
            organization_id: agreement.organization_id,
            reminder_type: reminderType
          }
        });
      }
    }
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffDays(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const to = new Date(`${toIso}T00:00:00.000Z`);
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function labelPipeline(value: "schools" | "sports") {
  return value === "schools" ? "Schools Pipeline" : "Sports Pipeline";
}

export async function monitorSalesPipeline() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pmc_app");
    const tenants = await client.query("SELECT id FROM tenant");
    for (const tenant of tenants.rows) {
      await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenant.id]);
      await syncOpportunityAlerts(client, tenant.id);
      await notifyNewSalesAlerts(client, tenant.id);
      await processAgreementReminders(client, tenant.id);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
