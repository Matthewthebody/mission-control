import { randomUUID } from "node:crypto";
import { config } from "../config.js";

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

function writeLog(level: "info" | "warn" | "error", payload: Record<string, unknown>, message: string) {
  if (config.NODE_ENV === "test") {
    return;
  }
  const line = `[integration.${level}] ${message} ${JSON.stringify(payload)}`;
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

function buildTracePayload(trace: IntegrationTrace, extra: Record<string, unknown> = {}) {
  const target = sanitizeTarget(trace.target);
  return {
    provider: trace.provider,
    operation: trace.operation,
    direction: trace.direction,
    method: trace.method,
    correlation_id: trace.correlationId,
    target_host: target.host,
    target_path: target.path,
    ...extra
  };
}

export function startIntegrationTrace(input: IntegrationTraceInput): IntegrationTrace {
  return {
    ...input,
    startedAtMs: Date.now(),
    correlationId: input.correlationId ?? randomUUID()
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
  writeLog(durationMs > 300 ? "warn" : "info", payload, durationMs > 300 ? "Integration call completed slowly" : "Integration call completed");
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
  writeLog("error", payload, "Integration call failed");
}
