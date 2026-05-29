import { config } from "../config.js";
import type { PoolClient } from "pg";

type IntegrationSyncOperation = {
  id: string;
  tenant_id: string;
  provider: string;
  direction: string;
  entity_type: string;
  entity_id: string | null;
  external_object_type: string;
  external_id: string | null;
  operation_type: string;
  source_system: string;
  source_change_key: string | null;
  status: string;
  triggered_by_user_id: string | null;
  payload: Record<string, unknown>;
};

type MailDelivery = {
  id: string;
  tenant_id: string;
  related_record_type: string;
  related_record_id: string;
  shared_mailbox_key: string;
  sender_alias: string;
  template_key: string;
  template_url: string | null;
  flow_key: string;
  trigger_type: string;
  status: string;
  subject_hint: string | null;
  merge_context: Record<string, unknown>;
  dashboard_url: string | null;
  recipient_name: string | null;
  recipient_email: string;
  sync_operation_id: string | null;
  metadata: Record<string, unknown>;
};

type MailDispatchAcceptedPayload = {
  dispatch_status: "flow_accepted";
  flow_key: string;
  endpoint: string;
  flow_run_id: string | null;
  flow_run_url: string | null;
  response_body: Record<string, unknown>;
  source_object: {
    type: string;
    id: string;
  };
  target_object: {
    type: "microsoft365_mail_delivery";
    id: string;
    owner_email: string;
    recipient_email: string;
    shared_mailbox_key: string;
    flow_run_id: string | null;
    flow_run_url: string | null;
  };
  sync_state: {
    last_attempted_sync_at: string;
    last_successful_sync_at: null;
    last_failed_sync_at: null;
    retry_state: "awaiting_callback";
    provider_accepted: true;
    delivery_confirmed: false;
    callback_status: null;
  };
};

function buildCallbackUrl() {
  const base = config.API_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/api/integrations/microsoft/email-automation/callback`;
}

async function loadSyncOperation(client: PoolClient, operationId: string) {
  const { rows } = await client.query<IntegrationSyncOperation>(
    `
      SELECT *
      FROM integration_sync_operation
      WHERE id = $1
      LIMIT 1
    `,
    [operationId]
  );
  return rows[0] ?? null;
}

async function loadDeliveryForOperation(client: PoolClient, tenantId: string, operationId: string) {
  const { rows } = await client.query<MailDelivery>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        shared_mailbox_key,
        sender_alias,
        template_key,
        template_url,
        flow_key,
        trigger_type::text,
        status::text,
        subject_hint,
        merge_context,
        dashboard_url,
        recipient_name,
        recipient_email,
        sync_operation_id::text,
        metadata
      FROM microsoft_mail_automation_delivery
      WHERE tenant_id = $1
        AND sync_operation_id = $2::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, operationId]
  );
  return rows[0] ?? null;
}

async function updateOperation(
  client: PoolClient,
  operationId: string,
  input: {
    status: "processing" | "succeeded" | "failed";
    externalId?: string | null;
    resultPayload?: Record<string, unknown>;
    error?: string | null;
  }
) {
  await client.query(
    `
      UPDATE integration_sync_operation
      SET
        status = $2,
        external_id = COALESCE($3, external_id),
        attempt_count = CASE WHEN $2 = 'processing' THEN attempt_count + 1 ELSE attempt_count END,
        last_attempt_at = CASE WHEN $2 = 'processing' THEN now() ELSE COALESCE(last_attempt_at, now()) END,
        result_payload = CASE WHEN $4::jsonb IS NULL THEN result_payload ELSE COALESCE(result_payload, '{}'::jsonb) || $4::jsonb END,
        last_error = CASE WHEN $5::text IS NULL THEN NULL ELSE $5 END,
        last_error_at = CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,
        updated_at = now()
      WHERE id = $1
    `,
    [operationId, input.status, input.externalId ?? null, input.resultPayload ? JSON.stringify(input.resultPayload) : null, input.error ?? null]
  );
}

async function recordDeliveryEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    deliveryId: string;
    eventType: string;
    note?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO microsoft_mail_automation_event (tenant_id, delivery_id, event_type, note, metadata)
      VALUES ($1,$2,$3::microsoft_mail_automation_event_type,$4,$5::jsonb)
    `,
    [input.tenantId, input.deliveryId, input.eventType, input.note ?? null, JSON.stringify(input.metadata ?? {})]
  );
}

async function markDispatching(client: PoolClient, delivery: MailDelivery) {
  await client.query(
    `
      UPDATE microsoft_mail_automation_delivery
      SET
        status = 'dispatching'::microsoft_mail_automation_status,
        attempt_count = attempt_count + 1,
        first_dispatched_at = COALESCE(first_dispatched_at, now()),
        last_dispatched_at = now(),
        updated_at = now()
      WHERE id = $1::uuid
    `,
    [delivery.id]
  );
  await recordDeliveryEvent(client, {
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    eventType: "dispatching",
    note: "Worker dispatching delivery to Power Automate."
  });
}

async function markFlowAccepted(
  client: PoolClient,
  input: {
    delivery: MailDelivery;
    flowRunId?: string | null;
    flowRunUrl?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE microsoft_mail_automation_delivery
      SET
        status = 'flow_accepted'::microsoft_mail_automation_status,
        flow_run_id = COALESCE($2, flow_run_id),
        flow_run_url = COALESCE($3, flow_run_url),
        last_error = NULL,
        last_error_at = NULL,
        metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
        updated_at = now()
      WHERE id = $1::uuid
    `,
    [input.delivery.id, input.flowRunId ?? null, input.flowRunUrl ?? null, JSON.stringify(input.metadata ?? {})]
  );
  await recordDeliveryEvent(client, {
    tenantId: input.delivery.tenant_id,
    deliveryId: input.delivery.id,
    eventType: "flow_accepted",
    note: "Power Automate accepted the delivery request.",
    metadata: {
      flow_run_id: input.flowRunId ?? null,
      flow_run_url: input.flowRunUrl ?? null
    }
  });
}

async function markDispatchFailed(client: PoolClient, delivery: MailDelivery, message: string, metadata?: Record<string, unknown>) {
  await client.query(
    `
      UPDATE microsoft_mail_automation_delivery
      SET
        status = 'failed'::microsoft_mail_automation_status,
        last_error = $2,
        last_error_at = now(),
        metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
        updated_at = now()
      WHERE id = $1::uuid
    `,
    [delivery.id, message, JSON.stringify(metadata ?? {})]
  );
  await recordDeliveryEvent(client, {
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    eventType: "failed",
    note: message,
    metadata
  });
  await recordDeliveryEvent(client, {
    tenantId: delivery.tenant_id,
    deliveryId: delivery.id,
    eventType: "alerted",
    note: "Dispatch failure recorded for diagnostics.",
    metadata
  });
}

async function postFlowRequest(endpoint: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.MICROSOFT_365_MAIL_AUTOMATION_TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonResponseBody(text: string) {
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      raw_body: text
    };
  }
}

export function buildMailAutomationDispatchAcceptedPayload(input: {
  delivery: Pick<
    MailDelivery,
    | "id"
    | "related_record_type"
    | "related_record_id"
    | "shared_mailbox_key"
    | "sender_alias"
    | "recipient_email"
    | "flow_key"
  >;
  endpoint: string;
  responseBody: Record<string, unknown>;
  flowRunId?: string | null;
  flowRunUrl?: string | null;
  occurredAt?: string;
}): MailDispatchAcceptedPayload {
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  return {
    dispatch_status: "flow_accepted",
    flow_key: input.delivery.flow_key,
    endpoint: input.endpoint,
    flow_run_id: input.flowRunId ?? null,
    flow_run_url: input.flowRunUrl ?? null,
    response_body: input.responseBody,
    source_object: {
      type: input.delivery.related_record_type,
      id: input.delivery.related_record_id
    },
    target_object: {
      type: "microsoft365_mail_delivery",
      id: input.delivery.id,
      owner_email: input.delivery.sender_alias,
      recipient_email: input.delivery.recipient_email,
      shared_mailbox_key: input.delivery.shared_mailbox_key,
      flow_run_id: input.flowRunId ?? null,
      flow_run_url: input.flowRunUrl ?? null
    },
    sync_state: {
      last_attempted_sync_at: occurredAt,
      last_successful_sync_at: null,
      last_failed_sync_at: null,
      retry_state: "awaiting_callback",
      provider_accepted: true,
      delivery_confirmed: false,
      callback_status: null
    }
  };
}

async function markOperationAwaitingCallback(
  client: PoolClient,
  operationId: string,
  input: {
    externalId?: string | null;
    resultPayload: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE integration_sync_operation
      SET
        status = 'processing',
        external_id = COALESCE($2, external_id),
        result_payload = COALESCE(result_payload, '{}'::jsonb) || $3::jsonb,
        last_error = NULL,
        last_error_at = NULL,
        updated_at = now()
      WHERE id = $1
    `,
    [operationId, input.externalId ?? null, JSON.stringify(input.resultPayload)]
  );
}

export async function dispatchMicrosoft365MailAutomationSync(client: PoolClient, operationId: string) {
  const operation = await loadSyncOperation(client, operationId);
  if (!operation) {
    return { code: "skipped", response: { reason: "missing_operation" } };
  }
  if (operation.provider !== "microsoft365_mail_automation") {
    return { code: "skipped", response: { reason: "unsupported_provider" } };
  }
  if (operation.status === "succeeded") {
    return { code: "skipped", response: { reason: "already_succeeded" } };
  }
  if (operation.direction !== "outbound") {
    await updateOperation(client, operation.id, {
      status: "failed",
      error: "Microsoft 365 mail automation only supports outbound sync operations."
    });
    return { code: "failed", response: { reason: "unsupported_direction" } };
  }
  if (!config.MICROSOFT_365_MAIL_AUTOMATION_ENABLED) {
    await updateOperation(client, operation.id, {
      status: "failed",
      error: "Microsoft 365 mail automation is disabled in the worker environment."
    });
    return { code: "failed", response: { reason: "feature_disabled" } };
  }

  const delivery = await loadDeliveryForOperation(client, operation.tenant_id, operation.id);
  if (!delivery) {
    await updateOperation(client, operation.id, {
      status: "failed",
      error: "Mail automation delivery record was not found for the sync operation."
    });
    return { code: "failed", response: { reason: "missing_delivery" } };
  }

  const endpoint = config.MICROSOFT_365_MAIL_AUTOMATION_FLOW_ENDPOINTS[delivery.flow_key];
  if (!endpoint) {
    const message = `No Power Automate endpoint is configured for flow ${delivery.flow_key}.`;
    await markDispatchFailed(client, delivery, message, { flow_key: delivery.flow_key });
    await updateOperation(client, operation.id, { status: "failed", error: message, resultPayload: { flow_key: delivery.flow_key } });
    return { code: "failed", response: { reason: "missing_flow_endpoint" } };
  }

  await updateOperation(client, operation.id, { status: "processing" });
  await markDispatching(client, delivery);

  const flowPayload = {
    delivery_id: delivery.id,
    tenant_id: delivery.tenant_id,
    flow_key: delivery.flow_key,
    trigger_type: delivery.trigger_type,
    template_key: delivery.template_key,
    template_url: delivery.template_url,
    shared_mailbox_key: delivery.shared_mailbox_key,
    sender_alias: delivery.sender_alias,
    recipient_name: delivery.recipient_name,
    recipient_email: delivery.recipient_email,
    subject_hint: delivery.subject_hint,
    merge_context: delivery.merge_context,
    dashboard_url: delivery.dashboard_url,
    callback: {
      url: buildCallbackUrl(),
      secret: config.MICROSOFT_365_MAIL_AUTOMATION_CALLBACK_SECRET
    },
    metadata: delivery.metadata
  } satisfies Record<string, unknown>;

  try {
    const response = await postFlowRequest(endpoint, flowPayload);
    const text = await response.text();
    const responseBody = parseJsonResponseBody(text);
    if (!response.ok) {
      const message = `Power Automate flow ${delivery.flow_key} rejected the request with status ${response.status}.`;
      await markDispatchFailed(client, delivery, message, {
        endpoint,
        response_status: response.status,
        response_body: responseBody
      });
      await updateOperation(client, operation.id, {
        status: "failed",
        error: message,
        resultPayload: {
          endpoint,
          response_status: response.status,
          response_body: responseBody
        }
      });
      return { code: "failed", response: { response_status: response.status, response_body: responseBody } };
    }

    const flowRunId = typeof responseBody.flow_run_id === "string" ? responseBody.flow_run_id : null;
    const flowRunUrl = typeof responseBody.flow_run_url === "string" ? responseBody.flow_run_url : null;
    const acceptedPayload = buildMailAutomationDispatchAcceptedPayload({
      delivery,
      endpoint,
      responseBody,
      flowRunId,
      flowRunUrl
    });
    await markFlowAccepted(client, {
      delivery,
      flowRunId,
      flowRunUrl,
      metadata: {
        endpoint,
        response_body: responseBody
      }
    });
    await markOperationAwaitingCallback(client, operation.id, {
      externalId: flowRunId,
      resultPayload: acceptedPayload
    });
    return {
      code: "flow_accepted",
      response: acceptedPayload
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown mail automation dispatch failure.";
    await markDispatchFailed(client, delivery, message, { endpoint });
    await updateOperation(client, operation.id, {
      status: "failed",
      error: message,
      resultPayload: {
        endpoint
      }
    });
    return { code: "failed", response: { endpoint, message } };
  }
}
