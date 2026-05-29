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

type SmsDelivery = {
  id: string;
  tenant_id: string;
  related_record_type: string;
  related_record_id: string;
  sender_key: string;
  sender_number: string;
  template_key: string;
  flow_key: string;
  trigger_type: string;
  status: string;
  message_body: string;
  dashboard_url: string | null;
  secure_link_url: string | null;
  recipient_name: string | null;
  recipient_phone_number: string;
  sync_operation_id: string | null;
  metadata: Record<string, unknown>;
};

function buildCallbackUrl() {
  const base = config.API_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/api/integrations/microsoft/sms-optimization/callback`;
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
  const { rows } = await client.query<SmsDelivery>(
    `
      SELECT
        id::text,
        tenant_id::text,
        related_record_type::text,
        related_record_id,
        sender_key,
        sender_number,
        template_key,
        flow_key,
        trigger_type::text,
        status::text,
        message_body,
        dashboard_url,
        secure_link_url,
        recipient_name,
        recipient_phone_number,
        sync_operation_id::text,
        metadata
      FROM microsoft_sms_delivery
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
      INSERT INTO microsoft_sms_event (tenant_id, delivery_id, event_type, note, metadata)
      VALUES ($1,$2,$3::microsoft_sms_event_type,$4,$5::jsonb)
    `,
    [input.tenantId, input.deliveryId, input.eventType, input.note ?? null, JSON.stringify(input.metadata ?? {})]
  );
}

async function markDispatching(client: PoolClient, delivery: SmsDelivery) {
  await client.query(
    `
      UPDATE microsoft_sms_delivery
      SET
        status = 'dispatching'::microsoft_sms_delivery_status,
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
    note: "Worker dispatching reminder SMS to the provider bridge."
  });
}

async function markProviderAccepted(
  client: PoolClient,
  input: {
    delivery: SmsDelivery;
    providerMessageId?: string | null;
    providerMessageUrl?: string | null;
    flowRunId?: string | null;
    flowRunUrl?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      UPDATE microsoft_sms_delivery
      SET
        status = 'provider_accepted'::microsoft_sms_delivery_status,
        provider_message_id = COALESCE($2, provider_message_id),
        provider_message_url = COALESCE($3, provider_message_url),
        flow_run_id = COALESCE($4, flow_run_id),
        flow_run_url = COALESCE($5, flow_run_url),
        last_error = NULL,
        last_error_at = NULL,
        metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb,
        updated_at = now()
      WHERE id = $1::uuid
    `,
    [
      input.delivery.id,
      input.providerMessageId ?? null,
      input.providerMessageUrl ?? null,
      input.flowRunId ?? null,
      input.flowRunUrl ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  await recordDeliveryEvent(client, {
    tenantId: input.delivery.tenant_id,
    deliveryId: input.delivery.id,
    eventType: "provider_accepted",
    note: "SMS provider bridge accepted the delivery request.",
    metadata: {
      provider_message_id: input.providerMessageId ?? null,
      flow_run_id: input.flowRunId ?? null,
      flow_run_url: input.flowRunUrl ?? null
    }
  });
}

async function markDispatchFailed(client: PoolClient, delivery: SmsDelivery, message: string, metadata?: Record<string, unknown>) {
  await client.query(
    `
      UPDATE microsoft_sms_delivery
      SET
        status = 'failed'::microsoft_sms_delivery_status,
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
  const timeout = setTimeout(() => controller.abort(), config.MICROSOFT_365_SMS_TIMEOUT_MS);
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

export async function dispatchMicrosoft365SmsAutomationSync(client: PoolClient, operationId: string) {
  const operation = await loadSyncOperation(client, operationId);
  if (!operation) {
    return { code: "skipped", response: { reason: "missing_operation" } };
  }
  if (operation.provider !== "microsoft365_sms_automation") {
    return { code: "skipped", response: { reason: "unsupported_provider" } };
  }
  if (operation.status === "succeeded") {
    return { code: "skipped", response: { reason: "already_succeeded" } };
  }
  if (operation.direction !== "outbound") {
    await updateOperation(client, operation.id, {
      status: "failed",
      error: "Microsoft 365 SMS automation only supports outbound sync operations."
    });
    return { code: "failed", response: { reason: "unsupported_direction" } };
  }
  if (!config.MICROSOFT_365_SMS_OPTIMIZATION_ENABLED) {
    await updateOperation(client, operation.id, {
      status: "failed",
      error: "Microsoft 365 SMS optimization is disabled in the worker environment."
    });
    return { code: "failed", response: { reason: "feature_disabled" } };
  }

  const delivery = await loadDeliveryForOperation(client, operation.tenant_id, operation.id);
  if (!delivery) {
    await updateOperation(client, operation.id, {
      status: "failed",
      error: "SMS delivery record was not found for the sync operation."
    });
    return { code: "failed", response: { reason: "missing_delivery" } };
  }

  const endpoint = config.MICROSOFT_365_SMS_FLOW_ENDPOINTS[delivery.flow_key];
  if (!endpoint) {
    const message = `No SMS flow endpoint is configured for flow ${delivery.flow_key}.`;
    await markDispatchFailed(client, delivery, message, { flow_key: delivery.flow_key });
    await updateOperation(client, operation.id, { status: "failed", error: message, resultPayload: { flow_key: delivery.flow_key } });
    return { code: "failed", response: { reason: "missing_flow_endpoint" } };
  }

  await updateOperation(client, operation.id, { status: "processing" });
  await markDispatching(client, delivery);

  const flowPayload = {
    delivery_id: delivery.id,
    tenant_id: delivery.tenant_id,
    provider: config.MICROSOFT_365_SMS_PROVIDER,
    flow_key: delivery.flow_key,
    trigger_type: delivery.trigger_type,
    template_key: delivery.template_key,
    sender_key: delivery.sender_key,
    sender_number: delivery.sender_number,
    recipient_name: delivery.recipient_name,
    recipient_phone_number: delivery.recipient_phone_number,
    message_body: delivery.message_body,
    dashboard_url: delivery.dashboard_url,
    secure_link_url: delivery.secure_link_url,
    callback: {
      url: buildCallbackUrl(),
      secret: config.MICROSOFT_365_SMS_CALLBACK_SECRET
    },
    metadata: delivery.metadata
  } satisfies Record<string, unknown>;

  try {
    const response = await postFlowRequest(endpoint, flowPayload);
    const text = await response.text();
    const responseBody = parseJsonResponseBody(text);
    if (!response.ok) {
      const message = `SMS flow ${delivery.flow_key} rejected the request with status ${response.status}.`;
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

    const providerMessageId = typeof responseBody.provider_message_id === "string" ? responseBody.provider_message_id : null;
    const providerMessageUrl = typeof responseBody.provider_message_url === "string" ? responseBody.provider_message_url : null;
    const flowRunId = typeof responseBody.flow_run_id === "string" ? responseBody.flow_run_id : null;
    const flowRunUrl = typeof responseBody.flow_run_url === "string" ? responseBody.flow_run_url : null;

    await markProviderAccepted(client, {
      delivery,
      providerMessageId,
      providerMessageUrl,
      flowRunId,
      flowRunUrl,
      metadata: {
        endpoint,
        response_body: responseBody
      }
    });
    await updateOperation(client, operation.id, {
      status: "succeeded",
      externalId: providerMessageId ?? flowRunId,
      resultPayload: {
        dispatch_status: "provider_accepted",
        flow_key: delivery.flow_key,
        endpoint,
        provider_message_id: providerMessageId,
        provider_message_url: providerMessageUrl,
        flow_run_id: flowRunId,
        flow_run_url: flowRunUrl,
        response_body: responseBody
      }
    });
    return {
      code: "provider_accepted",
      response: {
        endpoint,
        provider_message_id: providerMessageId,
        provider_message_url: providerMessageUrl,
        flow_run_id: flowRunId,
        flow_run_url: flowRunUrl,
        response_body: responseBody
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SMS automation dispatch failure.";
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
