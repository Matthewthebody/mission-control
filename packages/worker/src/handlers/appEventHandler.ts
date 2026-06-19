import type { PoolClient } from "pg";
import { publishRealtime } from "../realtime/internalPublisher.js";
import { sendPush } from "../push/fcmStub.js";
import { disableInvalidToken } from "../push/tokenHygiene.js";
import { sendSms } from "../notifications/smsStub.js";
import { sendEmail } from "../notifications/emailStub.js";
import { sendTeamsWebhook, type TeamsWebhookDispatchPayload } from "../notifications/teamsWebhook.js";
import { processIntegrationSyncOperation, reconcileExternalCalendarChange, syncShiftToOutlook } from "../calendar/outlookGraph.js";
import { recordWorkerMicrosoftIntegrationEvent, writeWorkerMicrosoftExternalAudit } from "../diagnostics/microsoftIntegrationEvents.js";
import { dispatchMicrosoft365MailAutomationSync } from "../integrations/microsoft365MailAutomationSync.js";
import { dispatchMicrosoft365ProvisioningSync } from "../integrations/microsoft365ProvisioningSync.js";
import { dispatchMicrosoft365SmsAutomationSync } from "../integrations/microsoft365SmsAutomationSync.js";
import {
  handleAgreementSignatureReminder,
  handleAgreementSignatureSend,
  handleAgreementSignatureSync,
  handleAgreementSignatureWebhook
} from "../agreements/agreementSignatureProvider.js";
import {
  handleSchoolsHubDeliverableTrigger,
  handleSchoolsHubUploadTrigger,
  handleSchoolsHubYearbookTrigger,
  runSchoolsHubAutomationForTenant
} from "../jobs/schoolsHubAutomation.js";
import { dispatchTeamsCommunicationDelivery } from "../communications/teamsMessagingGraph.js";
import { dispatchTeamsMeetingSyncOperation } from "../communications/teamsMeetingsGraph.js";

async function logDelivery(
  client: PoolClient,
  input: {
    tenantId: string;
    pushTokenId: string | null;
    appEventId: string;
    status: string;
    responseBody: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO notification_delivery (tenant_id, push_token_id, app_event_id, status, response_body)
      VALUES ($1,$2,$3,$4,$5::jsonb)
    `,
    [input.tenantId, input.pushTokenId, input.appEventId, input.status, JSON.stringify(input.responseBody)]
  );
}

type WorkerNotificationChannel = "in_app" | "push" | "sms" | "email";

function isNotificationChannel(value: unknown): value is WorkerNotificationChannel {
  return value === "in_app" || value === "push" || value === "sms" || value === "email";
}

function parseNotificationChannels(payload: Record<string, any>): WorkerNotificationChannel[] {
  const channels = Array.isArray(payload.channels) ? payload.channels.filter(isNotificationChannel) : [];
  if (channels.length) {
    return [...new Set(channels)];
  }
  return isNotificationChannel(payload.channel) ? [payload.channel] : ["in_app"];
}

function buildNotificationGroupKey(payload: Record<string, any>) {
  if (typeof payload.group_key === "string" && payload.group_key.trim()) {
    return payload.group_key.trim();
  }
  const dedupe =
    payload.metadata && typeof payload.metadata === "object" && typeof payload.metadata.dedupe === "string" && payload.metadata.dedupe.trim()
      ? payload.metadata.dedupe.trim()
      : "default";
  return [
    String(payload.notification_type ?? "notification"),
    String(payload.shift_id ?? "none"),
    String(payload.shoot_id ?? "none"),
    String(payload.attendance_exception_id ?? "none"),
    dedupe
  ].join(":");
}

async function recordNotificationEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    notificationId: string;
    actorUserId?: string | null;
    eventType: "created" | "delivered" | "delivery_failed";
    channel?: "in_app" | "push" | "sms" | "email" | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO ops_notification_event (
        tenant_id,
        notification_id,
        actor_user_id,
        event_type,
        channel,
        metadata
      )
      VALUES ($1,$2,$3,$4::notification_event_type,$5::notification_channel,$6::jsonb)
    `,
    [input.tenantId, input.notificationId, input.actorUserId ?? null, input.eventType, input.channel ?? null, JSON.stringify(input.metadata ?? {})]
  );
}

function deliveryEventType(code: string): "delivered" | "delivery_failed" {
  return code === "sent" ? "delivered" : "delivery_failed";
}

async function loadOperationalAlertDelivery(client: PoolClient, tenantId: string, deliveryId: string) {
  const { rows } = await client.query<{
    id: string;
    route_id: string;
    delivery_channel: string;
    status: string;
    request_payload: Record<string, unknown> | null;
  }>(
    `
      SELECT
        id::text,
        route_id::text,
        delivery_channel::text,
        status::text,
        request_payload
      FROM operational_alert_delivery
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, deliveryId]
  );
  return rows[0] ?? null;
}

async function markOperationalAlertDeliveryAttempt(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    code: "sent" | "failed";
    response: Record<string, unknown>;
    errorMessage?: string | null;
  }
) {
  await client.query(
    `
      UPDATE operational_alert_delivery
      SET
        status = $3::operational_alert_delivery_status,
        attempt_count = attempt_count + 1,
        first_attempted_at = COALESCE(first_attempted_at, now()),
        last_attempted_at = now(),
        sent_at = CASE WHEN $3 = 'sent'::operational_alert_delivery_status THEN now() ELSE sent_at END,
        failed_at = CASE WHEN $3 = 'failed'::operational_alert_delivery_status THEN now() ELSE failed_at END,
        response_payload = COALESCE(response_payload, '{}'::jsonb) || $4::jsonb,
        last_error = CASE WHEN $3 = 'failed'::operational_alert_delivery_status THEN $5 ELSE NULL END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.deliveryId, input.code, JSON.stringify(input.response), input.errorMessage ?? null]
  );
}

async function linkOperationalEventDelivery(
  client: PoolClient,
  input: {
    tenantId: string;
    operationalEventDeliveryId: string;
    notificationId: string;
    notificationAppEventId: string;
  }
) {
  await client.query(
    `
      UPDATE operational_event_delivery
      SET
        notification_id = $3,
        notification_app_event_id = COALESCE(notification_app_event_id, $4),
        dispatch_status = 'dispatched'::operational_event_delivery_status,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [input.tenantId, input.operationalEventDeliveryId, input.notificationId, input.notificationAppEventId]
  );
}

function humanizeStaffingRole(role: string | null): string | null {
  if (!role) {
    return null;
  }
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Per-recipient staffing publication delivery. Consumes the precise `staffing.plan.recipient_published`
 * lifecycle event (emitted only for new/materially-changed recipients — never carried-forward/unchanged or
 * acknowledged ones) and queues ONE employee notification, by emitting a deduped `notification.dispatch`
 * event reusing the existing delivery path. This REPLACES the legacy aggregate "all assigned" publication
 * notice. Idempotent: the dispatch dedupe key is tenant+shoot+version+employee+recipient-hash+purpose, so a
 * worker retry (re-processing the source event) never creates a second logical notification.
 */
async function handleStaffingRecipientPublished(client: PoolClient, appEvent: any) {
  const payload = (appEvent.payload ?? {}) as Record<string, any>;
  const tenantId = appEvent.tenant_id as string;
  const shootId = payload.shoot_id as string | undefined;
  const employeeUserId = payload.employee_user_id as string | undefined;
  const recipientHash = payload.recipient_hash as string | undefined;
  const version = payload.version;
  if (!tenantId || !shootId || !employeeUserId || !recipientHash) {
    return;
  }

  // Currency guard: only deliver if the CURRENT recipient still matches this event's package and is still
  // pending. A newer version that materially changed the package emits its own event (different hash); an
  // acknowledged/declined/canceled/superseded recipient must not be (re-)notified.
  const current = await client.query(
    `
      SELECT recipient_hash, response_status
      FROM staffing_plan_recipient
      WHERE tenant_id = $1 AND shoot_id = $2 AND employee_user_id = $3 AND superseded_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId, employeeUserId]
  );
  const recipient = current.rows[0];
  if (!recipient || recipient.recipient_hash !== recipientHash || recipient.response_status !== "pending") {
    return;
  }

  // Minimal package context — shoot identity + this employee's role only. No internal notes, no other employees.
  const context = await client.query(
    `
      SELECT
        s.shoot_code,
        s.title,
        s.shoot_date::text AS shoot_date,
        (
          SELECT ws.staffing_role::text
          FROM work_shift ws
          WHERE ws.tenant_id = $1 AND ws.shoot_id = $2 AND ws.assigned_user_id = $3 AND ws.cancelled_at IS NULL
          ORDER BY ws.satisfies_lead_coverage DESC, ws.starts_at ASC
          LIMIT 1
        ) AS role
      FROM shoot s
      WHERE s.id = $2 AND s.tenant_id = $1
      LIMIT 1
    `,
    [tenantId, shootId, employeeUserId]
  );
  const ctx = context.rows[0];
  if (!ctx) {
    return;
  }

  const roleLabel = humanizeStaffingRole(ctx.role ?? null);
  const dateLabel = ctx.shoot_date ?? "an upcoming date";
  const title = "Staffing assignment published";
  const body = `${ctx.shoot_code}${ctx.title ? ` — ${ctx.title}` : ""} on ${dateLabel}${roleLabel ? `, ${roleLabel}` : ""}. Please review and acknowledge your assignment.`;
  const dedupeKey = `staffing-recipient-publish:${shootId}:${version}:${employeeUserId}:${recipientHash}`;

  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1, 'notification.dispatch', 'ops_notification', $2, $3::jsonb, $4)
      ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    `,
    [
      tenantId,
      appEvent.aggregate_id ?? null,
      JSON.stringify({
        recipient_user_id: employeeUserId,
        notification_type: "schedule.staffing.published",
        title,
        body,
        deep_link: `#my-work?focus_shoot=${shootId}`,
        shoot_id: shootId,
        priority: "high",
        channels: ["in_app", "push"],
        category: "staffing",
        severity: "high",
        action_required: true,
        allow_snooze: true,
        due_at: payload.acknowledgment_due_at ?? null,
        source_event: "staffing.plan.recipient_published",
        metadata: {
          staffing_plan_version: version ?? null,
          recipient_hash: recipientHash,
          purpose: "staffing_publication",
          dedupe: dedupeKey
        }
      }),
      dedupeKey
    ]
  );
}

/**
 * Manager-facing decline delivery. Consumes `staffing.plan.recipient_declined` and queues ONE idempotent
 * notification to the smallest appropriate manager set — the manager(s) who own the declined employee's
 * shift(s) on this shoot (work_shift.manager_user_id), excluding the declining employee. It does NOT claim
 * the employee was removed (the raw assignment/history is preserved until a manager reassigns). If no manager
 * owner can be resolved, it records the ownership gap and stops — never guessing or notifying everyone (the
 * urgent staffing issue from reconcile remains the safety net). Historical/superseded declines do not notify.
 */
async function handleStaffingRecipientDeclined(client: PoolClient, appEvent: any) {
  const payload = (appEvent.payload ?? {}) as Record<string, any>;
  const tenantId = appEvent.tenant_id as string;
  const shootId = payload.shoot_id as string | undefined;
  const employeeUserId = payload.employee_user_id as string | undefined;
  const recipientId = appEvent.aggregate_id as string | undefined;
  if (!tenantId || !shootId || !employeeUserId) {
    return;
  }

  // Currency: only the CURRENT recipient (superseded_at IS NULL) that is STILL declined yields a notification.
  // A newer version that re-published this employee as pending makes the old decline historical (skip).
  const context = await client.query(
    `
      SELECT r.response_status, r.decline_reason, r.responded_at::text AS responded_at,
        s.shoot_code, s.title, s.shoot_date::text AS shoot_date, u.full_name AS employee_name
      FROM staffing_plan_recipient r
      JOIN shoot s ON s.id = r.shoot_id AND s.tenant_id = r.tenant_id
      JOIN app_user u ON u.id = r.employee_user_id AND u.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND r.shoot_id = $2 AND r.employee_user_id = $3 AND r.superseded_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId, employeeUserId]
  );
  const ctx = context.rows[0];
  if (!ctx || ctx.response_status !== "declined") {
    return;
  }

  // Smallest appropriate manager set: the owner(s) of this employee's shift(s) on the shoot.
  const managerRows = await client.query(
    `
      SELECT DISTINCT ws.manager_user_id::text AS manager_user_id, ws.staffing_role::text AS role
      FROM work_shift ws
      WHERE ws.tenant_id = $1 AND ws.shoot_id = $2 AND ws.assigned_user_id = $3 AND ws.cancelled_at IS NULL
    `,
    [tenantId, shootId, employeeUserId]
  );
  const managers = [
    ...new Set(
      managerRows.rows
        .map((row: any) => row.manager_user_id as string | null)
        .filter((id): id is string => Boolean(id) && id !== employeeUserId)
    )
  ];
  const roleLabel = humanizeStaffingRole(
    (managerRows.rows.find((row: any) => row.role)?.role as string | undefined) ?? null
  );

  if (managers.length === 0) {
    // Ownership gap — do NOT guess or notify everyone. The decline already reduces coverage eligibility and
    // surfaces as an urgent staffing issue via reconcile; record the gap for follow-up.
    console.warn(
      `[staffing-decline] no manager owner resolved for shoot=${shootId} employee=${employeeUserId}; relying on urgent-watch coverage gap`
    );
    return;
  }

  const dateLabel = ctx.shoot_date ?? "an upcoming date";
  const reason = typeof ctx.decline_reason === "string" && ctx.decline_reason.trim() ? ctx.decline_reason.trim() : null;
  const employeeName = ctx.employee_name ?? "An assigned employee";
  const title = "Assignment declined — replacement required";
  const body = `${employeeName} declined their ${roleLabel ?? "assignment"} on ${ctx.shoot_code}${ctx.title ? ` — ${ctx.title}` : ""} (${dateLabel}).${reason ? ` Reason: "${reason}".` : ""} A replacement is required.`;
  const deepLink = `#operations/staffing?area=staffing&date=${ctx.shoot_date ?? ""}&shoot=${shootId}`;

  for (const manager of managers) {
    const dedupeKey = `staffing-decline:${recipientId ?? `${shootId}:${employeeUserId}`}:${manager}`;
    await client.query(
      `
        INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
        VALUES ($1, 'notification.dispatch', 'ops_notification', $2, $3::jsonb, $4)
        ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [
        tenantId,
        recipientId ?? null,
        JSON.stringify({
          recipient_user_id: manager,
          notification_type: "schedule.staffing.declined",
          title,
          body,
          deep_link: deepLink,
          shoot_id: shootId,
          priority: "high",
          channels: ["in_app", "push"],
          category: "staffing",
          severity: "high",
          action_required: true,
          action_owner_user_id: manager,
          allow_snooze: false,
          source_event: "staffing.plan.recipient_declined",
          metadata: {
            purpose: "staffing_decline",
            declined_employee_user_id: employeeUserId,
            recipient_id: recipientId ?? null,
            replacement_required: true,
            dedupe: dedupeKey
          }
        }),
        dedupeKey
      ]
    );
  }
}

/**
 * Manager-initiated acknowledgment reminder delivery. Consumes `staffing.plan.recipient_reminder` (emitted
 * by the cooldown-guarded remind endpoint) and re-nudges the employee — but only if their CURRENT recipient
 * is still pending. Idempotent per reminder event (worker retry never double-delivers); cooldown/no-duplicate
 * across reminders is enforced upstream by the event's per-window dedupe + the recipient cooldown column.
 */
async function handleStaffingRecipientReminder(client: PoolClient, appEvent: any) {
  const payload = (appEvent.payload ?? {}) as Record<string, any>;
  const tenantId = appEvent.tenant_id as string;
  const shootId = payload.shoot_id as string | undefined;
  const employeeUserId = payload.employee_user_id as string | undefined;
  const recipientId = appEvent.aggregate_id as string | undefined;
  if (!tenantId || !shootId || !employeeUserId) {
    return;
  }

  const current = await client.query(
    `
      SELECT response_status
      FROM staffing_plan_recipient
      WHERE tenant_id = $1 AND shoot_id = $2 AND employee_user_id = $3 AND superseded_at IS NULL
      LIMIT 1
    `,
    [tenantId, shootId, employeeUserId]
  );
  const recipient = current.rows[0];
  if (!recipient || recipient.response_status !== "pending") {
    return; // already acknowledged/declined/superseded — no reminder needed
  }

  const context = await client.query(
    `
      SELECT s.shoot_code, s.title, s.shoot_date::text AS shoot_date,
        (
          SELECT ws.staffing_role::text
          FROM work_shift ws
          WHERE ws.tenant_id = $1 AND ws.shoot_id = $2 AND ws.assigned_user_id = $3 AND ws.cancelled_at IS NULL
          ORDER BY ws.satisfies_lead_coverage DESC, ws.starts_at ASC
          LIMIT 1
        ) AS role
      FROM shoot s
      WHERE s.id = $2 AND s.tenant_id = $1
      LIMIT 1
    `,
    [tenantId, shootId, employeeUserId]
  );
  const ctx = context.rows[0];
  if (!ctx) {
    return;
  }

  const roleLabel = humanizeStaffingRole(ctx.role ?? null);
  const dateLabel = ctx.shoot_date ?? "an upcoming date";
  const body = `Reminder — ${ctx.shoot_code}${ctx.title ? ` — ${ctx.title}` : ""} on ${dateLabel}${roleLabel ? `, ${roleLabel}` : ""} is still awaiting your acknowledgment. Please review and acknowledge.`;
  const dedupeKey = `staffing-reminder-notify:${appEvent.id ?? recipientId ?? `${shootId}:${employeeUserId}`}`;

  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1, 'notification.dispatch', 'ops_notification', $2, $3::jsonb, $4)
      ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    `,
    [
      tenantId,
      recipientId ?? null,
      JSON.stringify({
        recipient_user_id: employeeUserId,
        notification_type: "schedule.staffing.published",
        title: "Reminder: please acknowledge your staffing assignment",
        body,
        deep_link: `#my-work?focus_shoot=${shootId}`,
        shoot_id: shootId,
        priority: "high",
        channels: ["in_app", "push"],
        category: "staffing",
        severity: "high",
        action_required: true,
        allow_snooze: true,
        source_event: "staffing.plan.recipient_reminder",
        metadata: {
          purpose: "staffing_reminder",
          recipient_id: recipientId ?? null,
          dedupe: dedupeKey
        }
      }),
      dedupeKey
    ]
  );
}

export async function handleAppEvent(client: PoolClient, appEvent: any) {
  if (appEvent.event_type === "status_event.created") {
    publishRealtime(appEvent.tenant_id, "status_event", appEvent.payload);
    return;
  }

  if (appEvent.event_type === "schedule.realtime.changed") {
    publishRealtime(appEvent.tenant_id, "schedule_changed", appEvent.payload);
    return;
  }

  if (appEvent.event_type === "attendance.realtime.changed") {
    publishRealtime(appEvent.tenant_id, "attendance_changed", appEvent.payload);
    return;
  }

  if (appEvent.event_type === "staffing.plan.recipient_published") {
    await handleStaffingRecipientPublished(client, appEvent);
    return;
  }

  if (appEvent.event_type === "staffing.plan.recipient_declined") {
    await handleStaffingRecipientDeclined(client, appEvent);
    return;
  }

  if (appEvent.event_type === "staffing.plan.recipient_reminder") {
    await handleStaffingRecipientReminder(client, appEvent);
    return;
  }

  if (appEvent.event_type === "notification.dispatch") {
    const payload = appEvent.payload as Record<string, any>;
    const channels = parseNotificationChannels(payload);
    const primaryChannel = channels[0] ?? "in_app";
    const groupKey = buildNotificationGroupKey(payload);
    const insert = await client.query(
      `
        INSERT INTO ops_notification (
          tenant_id, recipient_user_id, related_user_id, shift_id, shoot_id, attendance_exception_id,
          notification_type, channel, priority, status, title, body, deep_link, metadata,
          category, severity, action_required, action_owner_user_id, due_at, source_event,
          state, requires_acknowledgement, allow_snooze, group_key, digest_eligible,
          quiet_hours_deferred, delivery_channels, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13::jsonb,
          $14::notification_category,$15::notification_severity,$16,$17,$18,$19,
          $20::notification_center_state,$21,$22,$23,$24,$25,$26::jsonb,now()
        )
        RETURNING *
      `,
      [
        appEvent.tenant_id,
        payload.recipient_user_id,
        payload.related_user_id ?? null,
        payload.shift_id ?? null,
        payload.shoot_id ?? null,
        payload.attendance_exception_id ?? null,
        payload.notification_type,
        primaryChannel,
        payload.priority,
        payload.title,
        payload.body,
        payload.deep_link ?? null,
        JSON.stringify(payload.metadata ?? {}),
        payload.category ?? "informational_summary",
        payload.severity ?? (payload.priority === "critical" ? "critical" : payload.priority === "high" ? "high" : "medium"),
        Boolean(payload.action_required),
        payload.action_owner_user_id ?? null,
        payload.due_at ?? null,
        payload.source_event ?? payload.notification_type ?? null,
        payload.state ?? "new",
        Boolean(payload.requires_acknowledgement),
        Boolean(payload.allow_snooze),
        groupKey,
        Boolean(payload.digest_eligible),
        Boolean(payload.quiet_hours_deferred),
        JSON.stringify(channels)
      ]
    );
    const notification = insert.rows[0];
    const operationalEventDeliveryId =
      payload.metadata && typeof payload.metadata === "object" && typeof payload.metadata.operational_event_delivery_id === "string"
        ? payload.metadata.operational_event_delivery_id
        : null;
    if (operationalEventDeliveryId) {
      await linkOperationalEventDelivery(client, {
        tenantId: appEvent.tenant_id,
        operationalEventDeliveryId,
        notificationId: String(notification.id),
        notificationAppEventId: String(appEvent.id)
      });
    }
    await recordNotificationEvent(client, {
      tenantId: appEvent.tenant_id,
      notificationId: notification.id,
      actorUserId: payload.actor_user_id ?? null,
      eventType: "created",
      metadata: {
        channels
      }
    });
    const userResult = await client.query("SELECT email, phone_number FROM app_user WHERE id = $1 LIMIT 1", [payload.recipient_user_id]);
    const user = userResult.rows[0] ?? {};

    const deliveryResults: Array<{ channel: WorkerNotificationChannel; code: string; response: Record<string, unknown> }> = [];

    for (const channel of channels) {
      if (channel === "in_app") {
        publishRealtime(appEvent.tenant_id, "notification_created", notification);
        deliveryResults.push({ channel, code: "sent", response: { channel } });
        await recordNotificationEvent(client, {
          tenantId: appEvent.tenant_id,
          notificationId: notification.id,
          eventType: "delivered",
          channel,
          metadata: { channel }
        });
        continue;
      }

      if (channel === "push") {
        const tokens = await client.query(
          `
            SELECT id, token
            FROM push_token
            WHERE tenant_id = $1
              AND user_id = $2
              AND enabled = true
          `,
          [appEvent.tenant_id, payload.recipient_user_id]
        );
        if (!tokens.rows.length) {
          deliveryResults.push({ channel, code: "skipped", response: { reason: "no_push_tokens" } });
          await recordNotificationEvent(client, {
            tenantId: appEvent.tenant_id,
            notificationId: notification.id,
            eventType: "delivery_failed",
            channel,
            metadata: { code: "skipped", reason: "no_push_tokens" }
          });
          continue;
        }

        let lastResult = { channel, code: "skipped", response: { reason: "no_push_tokens" } } as { channel: "push"; code: string; response: Record<string, unknown> };
        for (const token of tokens.rows) {
          const result = await sendPush(token.token, {
            title: String(payload.title ?? "Photographer Mission Control"),
            body: String(payload.body ?? ""),
            deepLink: String(payload.deep_link ?? "")
          });
          await logDelivery(client, {
            tenantId: appEvent.tenant_id,
            pushTokenId: token.id,
            appEventId: appEvent.id,
            status: result.code,
            responseBody: result.response
          });
          if (result.code === "invalid_token") {
            await disableInvalidToken(client, token.id);
          }
          lastResult = { channel, code: result.code, response: result.response };
        }
        deliveryResults.push(lastResult);
        await recordNotificationEvent(client, {
          tenantId: appEvent.tenant_id,
          notificationId: notification.id,
          eventType: deliveryEventType(lastResult.code),
          channel,
          metadata: { code: lastResult.code, response: lastResult.response }
        });
        continue;
      }

      if (channel === "sms") {
        const delivery = await sendSms(user.phone_number, String(payload.body ?? ""));
        deliveryResults.push({ channel, code: delivery.code, response: delivery.response });
        await recordNotificationEvent(client, {
          tenantId: appEvent.tenant_id,
          notificationId: notification.id,
          eventType: deliveryEventType(delivery.code),
          channel,
          metadata: { code: delivery.code, response: delivery.response }
        });
        continue;
      }

      const delivery = await sendEmail(user.email, String(payload.title ?? "Photographer Mission Control"), String(payload.body ?? ""));
      deliveryResults.push({ channel, code: delivery.code, response: delivery.response });
      await recordNotificationEvent(client, {
        tenantId: appEvent.tenant_id,
        notificationId: notification.id,
        eventType: deliveryEventType(delivery.code),
        channel,
        metadata: { code: delivery.code, response: delivery.response }
      });
    }

    const overallStatus =
      deliveryResults.some((result) => result.code === "failed" || result.code === "invalid_token")
        ? "failed"
        : deliveryResults.some((result) => result.code === "sent")
          ? "sent"
          : "skipped";
    const failureResult = deliveryResults.find((result) => result.code === "failed" || result.code === "invalid_token") ?? null;

    await client.query(
      `
        UPDATE ops_notification
        SET status = $2::notification_status,
            sent_at = CASE WHEN $2 IN ('sent','skipped') THEN now() ELSE sent_at END,
            failed_at = CASE WHEN $2 = 'failed' THEN now() ELSE failed_at END,
            last_error = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
            updated_at = now()
        WHERE id = $1
      `,
      [
        notification.id,
        overallStatus,
        failureResult ? JSON.stringify(failureResult.response) : null
      ]
    );
    return;
  }

  if (appEvent.event_type === "alert.created") {
    publishRealtime(appEvent.tenant_id, "alert_created", appEvent.payload);
    const tokens = await client.query(
      `
        SELECT id, token
        FROM push_token
        WHERE tenant_id = $1 AND enabled = true
      `,
      [appEvent.tenant_id]
    );
    for (const token of tokens.rows) {
      const result = await sendPush(token.token, {
        title: "Photographer Mission Control",
        body: `New alert for shoot ${String(appEvent.payload.shoot_code ?? "")}`.trim(),
        deepLink: `pmc://shoots/${String(appEvent.payload.shoot_id ?? "")}`
      });
      await logDelivery(client, {
        tenantId: appEvent.tenant_id,
        pushTokenId: token.id,
        appEventId: appEvent.id,
        status: result.code,
        responseBody: result.response
      });
      if (result.code === "invalid_token") {
        await disableInvalidToken(client, token.id);
      }
    }
    return;
  }

  if (appEvent.event_type === "schedule.calendar.sync") {
    await syncShiftToOutlook(client, { tenant_id: appEvent.tenant_id, ...(appEvent.payload as Record<string, unknown>) });
    return;
  }

  if (appEvent.event_type === "operational_alert.dispatch") {
    const payload = appEvent.payload as Record<string, unknown>;
    const deliveryId = typeof payload.delivery_id === "string" ? payload.delivery_id : "";
    if (!deliveryId) {
      return;
    }

    const delivery = await loadOperationalAlertDelivery(client, appEvent.tenant_id, deliveryId);
    if (!delivery) {
      return;
    }

    if (delivery.delivery_channel !== "teams_webhook") {
      await markOperationalAlertDeliveryAttempt(client, {
        tenantId: appEvent.tenant_id,
        deliveryId,
        code: "failed",
        response: {
          reason: "unsupported_delivery_channel",
          delivery_channel: delivery.delivery_channel
        },
        errorMessage: `Unsupported operational alert delivery channel: ${delivery.delivery_channel}`
      });
      throw new Error(`Unsupported operational alert delivery channel: ${delivery.delivery_channel}`);
    }

    const requestPayload = delivery.request_payload as TeamsWebhookDispatchPayload | null;
    if (!requestPayload?.route?.destination_config?.webhook_url || !requestPayload?.alert?.title) {
      await markOperationalAlertDeliveryAttempt(client, {
        tenantId: appEvent.tenant_id,
        deliveryId,
        code: "failed",
        response: {
          reason: "invalid_request_payload"
        },
        errorMessage: "Operational alert delivery payload is missing the Teams webhook request body."
      });
      throw new Error("Operational alert delivery payload is missing the Teams webhook request body.");
    }

    const result = await sendTeamsWebhook(requestPayload);
    await markOperationalAlertDeliveryAttempt(client, {
      tenantId: appEvent.tenant_id,
      deliveryId,
      code: result.code,
      response: result.response,
      errorMessage: result.code === "failed" ? JSON.stringify(result.response) : null
    });

    if (result.code === "failed") {
      await recordWorkerMicrosoftIntegrationEvent(client, {
        tenantId: appEvent.tenant_id,
        area: "teams_alerts",
        level: "error",
        eventType: "teams.alert_delivery.failed",
        eventStatus: "failed",
        summary: "Teams operational alert delivery failed.",
        detail: {
          delivery_id: deliveryId,
          route_name: requestPayload.route.route_name,
          destination_label: requestPayload.route.destination_label,
          response: result.response
        },
        relatedEntityType: "operational_alert_delivery",
        relatedEntityId: deliveryId,
        externalTarget: requestPayload.route.destination_label
      });
      await writeWorkerMicrosoftExternalAudit(client, {
        tenantId: appEvent.tenant_id,
        eventCategory: "microsoft_teams_alerts",
        eventType: "teams.alert_delivery.write",
        resourceType: "operational_alert_delivery",
        resourceId: deliveryId,
        result: "failed",
        context: {
          route_name: requestPayload.route.route_name,
          destination_label: requestPayload.route.destination_label,
          response: result.response
        }
      });
      throw new Error(typeof result.response.body === "string" ? result.response.body : "Teams webhook delivery failed.");
    }

    await recordWorkerMicrosoftIntegrationEvent(client, {
      tenantId: appEvent.tenant_id,
      area: "teams_alerts",
      level: "info",
      eventType: "teams.alert_delivery.sent",
      eventStatus: "sent",
      summary: "Teams operational alert delivery succeeded.",
      detail: {
        delivery_id: deliveryId,
        route_name: requestPayload.route.route_name,
        destination_label: requestPayload.route.destination_label,
        response: result.response
      },
      relatedEntityType: "operational_alert_delivery",
      relatedEntityId: deliveryId,
      externalTarget: requestPayload.route.destination_label
    });
    await writeWorkerMicrosoftExternalAudit(client, {
      tenantId: appEvent.tenant_id,
      eventCategory: "microsoft_teams_alerts",
      eventType: "teams.alert_delivery.write",
      resourceType: "operational_alert_delivery",
      resourceId: deliveryId,
      result: "sent",
      context: {
        route_name: requestPayload.route.route_name,
        destination_label: requestPayload.route.destination_label,
        response: result.response
      }
    });

    publishRealtime(appEvent.tenant_id, "integration_event", {
      operational_alert_delivery_id: deliveryId,
      provider: "teams",
      direction: "outbound"
    });
    return;
  }

  if (appEvent.event_type === "teams.communication.dispatch") {
    const payload = appEvent.payload as Record<string, unknown>;
    const deliveryId = typeof payload.delivery_id === "string" ? payload.delivery_id : "";
    if (!deliveryId) {
      return;
    }
    await dispatchTeamsCommunicationDelivery(client, appEvent.tenant_id, deliveryId);
    return;
  }

  if (appEvent.event_type === "teams.meeting.sync") {
    const payload = appEvent.payload as Record<string, unknown>;
    const operationId = typeof payload.operation_id === "string" ? payload.operation_id : "";
    if (!operationId) {
      return;
    }
    await dispatchTeamsMeetingSyncOperation(client, appEvent.tenant_id, operationId);
    publishRealtime(appEvent.tenant_id, "integration_event", {
      teams_meeting_sync_operation_id: operationId,
      provider: "teams_meetings",
      direction: "outbound"
    });
    return;
  }

  if (appEvent.event_type === "schools_hub.automation.requested") {
    await runSchoolsHubAutomationForTenant(client, appEvent.tenant_id);
    publishRealtime(appEvent.tenant_id, "schools_hub_changed", {
      change_type: "automation_run_completed"
    });
    return;
  }

  if (appEvent.event_type === "schools_hub.trigger.upload_state_changed") {
    await handleSchoolsHubUploadTrigger(client, appEvent.tenant_id, appEvent.payload as Record<string, unknown>);
    publishRealtime(appEvent.tenant_id, "schools_hub_changed", {
      change_type: "upload_trigger_processed"
    });
    return;
  }

  if (appEvent.event_type === "schools_hub.trigger.yearbook_request_received") {
    await handleSchoolsHubYearbookTrigger(client, appEvent.tenant_id, appEvent.payload as Record<string, unknown>);
    publishRealtime(appEvent.tenant_id, "schools_hub_changed", {
      change_type: "yearbook_trigger_processed"
    });
    return;
  }

  if (appEvent.event_type === "schools_hub.trigger.deliverable_arrived") {
    await handleSchoolsHubDeliverableTrigger(client, appEvent.tenant_id, appEvent.payload as Record<string, unknown>);
    publishRealtime(appEvent.tenant_id, "schools_hub_changed", {
      change_type: "deliverable_trigger_processed"
    });
    return;
  }

  if (appEvent.event_type === "agreement.signature.send_requested") {
    await handleAgreementSignatureSend(client, appEvent.payload as Record<string, unknown>);
    publishRealtime(appEvent.tenant_id, "agreement_changed", {
      agreement_id: (appEvent.payload as Record<string, unknown>).agreement_id ?? null,
      change_type: "signature_send_processed"
    });
    return;
  }

  if (appEvent.event_type === "agreement.signature.reminder_requested") {
    await handleAgreementSignatureReminder(client, appEvent.payload as Record<string, unknown>);
    publishRealtime(appEvent.tenant_id, "agreement_changed", {
      agreement_id: (appEvent.payload as Record<string, unknown>).agreement_id ?? null,
      change_type: "signature_reminder_processed"
    });
    return;
  }

  if (appEvent.event_type === "agreement.reminder_requested") {
    const payload = appEvent.payload as Record<string, unknown>;
    const delivery = await sendEmail(
      typeof payload.recipient_email === "string" ? payload.recipient_email : null,
      typeof payload.agreement_title === "string" ? `Reminder: ${payload.agreement_title}` : "Agreement reminder",
      typeof payload.note === "string" && payload.note.trim().length
        ? payload.note
        : "Mission Control sent a reminder that this agreement still needs attention."
    );

    if (typeof payload.reminder_id === "string") {
      await client.query(
        `
          UPDATE agreement_reminder
          SET
            status = $2::agreement_reminder_status,
            sent_at = CASE WHEN $2 IN ('sent', 'skipped') THEN now() ELSE sent_at END,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'delivery_code', $3,
              'delivery_response', $4::jsonb,
              'delivery_processed_at', now()
            ),
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $5
        `,
        [
          appEvent.tenant_id,
          delivery.code === "sent" ? "sent" : "skipped",
          delivery.code,
          JSON.stringify(delivery.response ?? {}),
          payload.reminder_id
        ]
      );
    }

    publishRealtime(appEvent.tenant_id, "agreement_changed", {
      agreement_id: payload.agreement_id ?? null,
      change_type: "reminder_processed"
    });
    return;
  }

  if (appEvent.event_type === "sales.email.send_requested") {
    const payload = appEvent.payload as Record<string, unknown>;
    const delivery = await sendEmail(
      typeof payload.recipient_email === "string" ? payload.recipient_email : null,
      typeof payload.subject === "string" ? payload.subject : "Mission Control Email",
      typeof payload.body === "string" ? payload.body : ""
    );
    const nextStatus = delivery.code === "sent" ? "sent" : delivery.code === "failed" ? "failed" : "skipped";
    const providerName =
      delivery.response && typeof delivery.response === "object" && typeof delivery.response.provider === "string"
        ? delivery.response.provider
        : null;

    if (typeof payload.communication_id === "string") {
      await client.query(
        `
          UPDATE sales_email_communication
          SET
            status = $2::sales_email_communication_status,
            sent_at = CASE WHEN $2 IN ('sent', 'skipped') THEN now() ELSE sent_at END,
            last_delivery_attempt_at = now(),
            delivery_provider = COALESCE($3, delivery_provider),
            provider_error_state = CASE
              WHEN $2 = 'failed' THEN $4
              WHEN $2 = 'skipped' THEN $4
              ELSE NULL
            END,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'delivery_code', $5,
              'delivery_response', $6::jsonb,
              'delivery_processed_at', now()
            ),
            updated_at = now()
          WHERE tenant_id = $1
            AND id = $7
        `,
        [
          appEvent.tenant_id,
          nextStatus,
          providerName,
          delivery.code === "sent" ? null : JSON.stringify(delivery.response ?? {}),
          delivery.code,
          JSON.stringify(delivery.response ?? {}),
          payload.communication_id
        ]
      );

      await client.query(
        `
          INSERT INTO sales_email_communication_event (
            tenant_id,
            communication_id,
            event_type,
            note,
            metadata
          )
          VALUES ($1,$2,$3::sales_email_event_type,$4,$5::jsonb)
        `,
        [
          appEvent.tenant_id,
          payload.communication_id,
          nextStatus,
          nextStatus === "sent"
            ? "Email delivery completed."
            : nextStatus === "failed"
              ? "Email delivery failed."
              : "Email delivery skipped.",
          JSON.stringify({
            delivery_code: delivery.code,
            delivery_response: delivery.response ?? {}
          })
        ]
      );
    }

    publishRealtime(appEvent.tenant_id, "sales_pipeline_changed", {
      communication_id: payload.communication_id ?? null,
      organization_id: payload.organization_id ?? null,
      opportunity_id: payload.opportunity_id ?? null,
      change_type: "sales_email_processed"
    });
    return;
  }

  if (appEvent.event_type === "agreement.signature.sync_requested") {
    await handleAgreementSignatureSync(client, appEvent.payload as Record<string, unknown>);
    publishRealtime(appEvent.tenant_id, "agreement_changed", {
      agreement_id: (appEvent.payload as Record<string, unknown>).agreement_id ?? null,
      change_type: "signature_sync_processed"
    });
    return;
  }

  if (appEvent.event_type === "integration.sync.process") {
    const payload = appEvent.payload as Record<string, unknown>;
    const operationId = String(payload.sync_operation_id ?? "");
    if (!operationId) {
      return;
    }
    try {
      if (payload.provider === "microsoft365_workspace") {
        await dispatchMicrosoft365ProvisioningSync(client, operationId);
      } else if (payload.provider === "microsoft365_mail_automation") {
        await dispatchMicrosoft365MailAutomationSync(client, operationId);
      } else if (payload.provider === "microsoft365_sms_automation") {
        await dispatchMicrosoft365SmsAutomationSync(client, operationId);
      } else {
        await processIntegrationSyncOperation(client, operationId);
      }
      if (payload.provider === "outlook") {
        await recordWorkerMicrosoftIntegrationEvent(client, {
          tenantId: appEvent.tenant_id,
          area: "outlook_calendar_sync",
          level: "info",
          eventType: "outlook.calendar_sync.processed",
          eventStatus: "synced",
          summary: "Outlook calendar sync operation completed.",
          detail: {
            sync_operation_id: operationId,
            direction: payload.direction ?? null
          },
          relatedEntityType: "integration_sync_operation",
          relatedEntityId: operationId
        });
        await writeWorkerMicrosoftExternalAudit(client, {
          tenantId: appEvent.tenant_id,
          eventCategory: "microsoft_outlook_sync",
          eventType: "outlook.calendar_event.write",
          resourceType: "integration_sync_operation",
          resourceId: operationId,
          result: "sent",
          context: {
            direction: payload.direction ?? null
          }
        });
      }
      if (payload.provider === "microsoft365_mail_automation") {
        await recordWorkerMicrosoftIntegrationEvent(client, {
          tenantId: appEvent.tenant_id,
          area: "mail_automation",
          level: "info",
          eventType: "mail_automation.dispatch.processed",
          eventStatus: "accepted",
          summary: "Microsoft 365 mail automation sync operation completed.",
          detail: {
            sync_operation_id: operationId,
            direction: payload.direction ?? null
          },
          relatedEntityType: "integration_sync_operation",
          relatedEntityId: operationId
        });
        await writeWorkerMicrosoftExternalAudit(client, {
          tenantId: appEvent.tenant_id,
          eventCategory: "microsoft_mail_automation",
          eventType: "mail_automation.flow.dispatch",
          resourceType: "integration_sync_operation",
          resourceId: operationId,
          result: "sent",
          context: {
            direction: payload.direction ?? null
          }
        });
      }
      if (payload.provider === "microsoft365_sms_automation") {
        await recordWorkerMicrosoftIntegrationEvent(client, {
          tenantId: appEvent.tenant_id,
          area: "sms_automation",
          level: "info",
          eventType: "sms_automation.dispatch.processed",
          eventStatus: "accepted",
          summary: "Microsoft 365 SMS automation sync operation completed.",
          detail: {
            sync_operation_id: operationId,
            direction: payload.direction ?? null
          },
          relatedEntityType: "integration_sync_operation",
          relatedEntityId: operationId
        });
        await writeWorkerMicrosoftExternalAudit(client, {
          tenantId: appEvent.tenant_id,
          eventCategory: "microsoft_sms_automation",
          eventType: "sms_automation.dispatch",
          resourceType: "integration_sync_operation",
          resourceId: operationId,
          result: "sent",
          context: {
            direction: payload.direction ?? null
          }
        });
      }
      publishRealtime(appEvent.tenant_id, "integration_event", {
        sync_operation_id: operationId,
        provider: payload.provider ?? null,
        direction: payload.direction ?? null
      });
      return;
    } catch (error) {
      if (payload.provider === "outlook") {
        await recordWorkerMicrosoftIntegrationEvent(client, {
          tenantId: appEvent.tenant_id,
          area: "outlook_calendar_sync",
          level: "error",
          eventType: "outlook.calendar_sync.failed",
          eventStatus: "failed",
          summary: "Outlook calendar sync operation failed.",
          detail: {
            sync_operation_id: operationId,
            direction: payload.direction ?? null,
            message: error instanceof Error ? error.message : "Unknown Outlook sync failure."
          },
          relatedEntityType: "integration_sync_operation",
          relatedEntityId: operationId
        });
        await writeWorkerMicrosoftExternalAudit(client, {
          tenantId: appEvent.tenant_id,
          eventCategory: "microsoft_outlook_sync",
          eventType: "outlook.calendar_event.write",
          resourceType: "integration_sync_operation",
          resourceId: operationId,
          result: "failed",
          context: {
            direction: payload.direction ?? null,
            message: error instanceof Error ? error.message : "Unknown Outlook sync failure."
          }
        });
      }
      if (payload.provider === "microsoft365_mail_automation") {
        await recordWorkerMicrosoftIntegrationEvent(client, {
          tenantId: appEvent.tenant_id,
          area: "mail_automation",
          level: "error",
          eventType: "mail_automation.dispatch.failed",
          eventStatus: "failed",
          summary: "Microsoft 365 mail automation sync operation failed.",
          detail: {
            sync_operation_id: operationId,
            direction: payload.direction ?? null,
            message: error instanceof Error ? error.message : "Unknown mail automation failure."
          },
          relatedEntityType: "integration_sync_operation",
          relatedEntityId: operationId
        });
        await writeWorkerMicrosoftExternalAudit(client, {
          tenantId: appEvent.tenant_id,
          eventCategory: "microsoft_mail_automation",
          eventType: "mail_automation.flow.dispatch",
          resourceType: "integration_sync_operation",
          resourceId: operationId,
          result: "failed",
          context: {
            direction: payload.direction ?? null,
            message: error instanceof Error ? error.message : "Unknown mail automation failure."
          }
        });
      }
      if (payload.provider === "microsoft365_sms_automation") {
        await recordWorkerMicrosoftIntegrationEvent(client, {
          tenantId: appEvent.tenant_id,
          area: "sms_automation",
          level: "error",
          eventType: "sms_automation.dispatch.failed",
          eventStatus: "failed",
          summary: "Microsoft 365 SMS automation sync operation failed.",
          detail: {
            sync_operation_id: operationId,
            direction: payload.direction ?? null,
            message: error instanceof Error ? error.message : "Unknown SMS automation failure."
          },
          relatedEntityType: "integration_sync_operation",
          relatedEntityId: operationId
        });
        await writeWorkerMicrosoftExternalAudit(client, {
          tenantId: appEvent.tenant_id,
          eventCategory: "microsoft_sms_automation",
          eventType: "sms_automation.dispatch",
          resourceType: "integration_sync_operation",
          resourceId: operationId,
          result: "failed",
          context: {
            direction: payload.direction ?? null,
            message: error instanceof Error ? error.message : "Unknown SMS automation failure."
          }
        });
      }
      throw error;
    }
  }

  if (appEvent.event_type.endsWith(".webhook.received")) {
    if (appEvent.event_type === "microsoft_graph.webhook.received") {
      await reconcileExternalCalendarChange(client, appEvent.tenant_id, appEvent.payload as Record<string, unknown>);
    }
    if (appEvent.event_type === "agreement_signature.webhook.received") {
      await handleAgreementSignatureWebhook(client, appEvent.payload as Record<string, unknown>);
    }
    publishRealtime(appEvent.tenant_id, "integration_event", appEvent.payload);
  }
}
