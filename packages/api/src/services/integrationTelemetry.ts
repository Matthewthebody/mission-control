import pino from "pino";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { getRequestContext } from "./requestContext.js";

const logger = pino({ name: "pmc-integrations", enabled: config.NODE_ENV !== "test" });

type IntegrationDirection = "inbound" | "outbound";

type IntegrationTraceInput = {
  provider: string;
  operation: string;
  direction: IntegrationDirection;
  method: string;
  target: string;
  correlationId?: string | null;
};

type IntegrationTrace = IntegrationTraceInput & {
  startedAtMs: number;
  correlationId: string;
  requestId: string | null;
};

function sanitizeTarget(target: string) {
  try {
    const parsed = new URL(target);
    return {
      host: parsed.host,
      path: parsed.pathname
    };
  } catch {
    return {
      host: null,
      path: target
    };
  }
}

function buildTracePayload(trace: IntegrationTrace, extra: Record<string, unknown> = {}) {
  const target = sanitizeTarget(trace.target);
  return {
    provider: trace.provider,
    operation: trace.operation,
    direction: trace.direction,
    method: trace.method,
    correlation_id: trace.correlationId,
    request_id: trace.requestId,
    target_host: target.host,
    target_path: target.path,
    ...extra
  };
}

export function startIntegrationTrace(input: IntegrationTraceInput): IntegrationTrace {
  const requestContext = getRequestContext();
  return {
    ...input,
    startedAtMs: Date.now(),
    correlationId: input.correlationId ?? requestContext?.requestId ?? randomUUID(),
    requestId: requestContext?.requestId ?? null
  };
}

export function finishIntegrationTrace(
  trace: IntegrationTrace,
  input: {
    statusCode?: number | null;
    attempt?: number;
    retryAfterSeconds?: number | null;
    extra?: Record<string, unknown>;
  } = {}
) {
  const durationMs = Date.now() - trace.startedAtMs;
  const payload = buildTracePayload(trace, {
    status: "success",
    duration_ms: durationMs,
    status_code: input.statusCode ?? null,
    attempt: input.attempt ?? 1,
    retry_after_seconds: input.retryAfterSeconds ?? null,
    ...(input.extra ?? {})
  });

  if (durationMs > 300) {
    logger.warn(payload, "Integration call completed slowly");
    return;
  }
  logger.info(payload, "Integration call completed");
}

export function failIntegrationTrace(
  trace: IntegrationTrace,
  error: unknown,
  input: {
    statusCode?: number | null;
    attempt?: number;
    retryAfterSeconds?: number | null;
    retryable?: boolean | null;
    extra?: Record<string, unknown>;
  } = {}
) {
  const durationMs = Date.now() - trace.startedAtMs;
  const payload = buildTracePayload(trace, {
    status: "failed",
    duration_ms: durationMs,
    status_code: input.statusCode ?? null,
    attempt: input.attempt ?? 1,
    retry_after_seconds: input.retryAfterSeconds ?? null,
    retryable: input.retryable ?? null,
    error_name: error instanceof Error ? error.name : "Error",
    error_message: error instanceof Error ? error.message : String(error),
    ...(input.extra ?? {})
  });
  logger.error(payload, "Integration call failed");
}
