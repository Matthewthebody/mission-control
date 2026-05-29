import { Buffer } from "node:buffer";
import { config } from "../config.js";
import { failIntegrationTrace, finishIntegrationTrace, startIntegrationTrace } from "./integrationTelemetry.js";
import type {
  ZendeskProviderMode,
  ZendeskProviderSyncResult,
  ZendeskProviderTicket,
  ZendeskSyncError
} from "../types/zendesk.js";
import { buildMockZendeskFixtureTickets } from "./zendeskFixtures.js";
import { isZendeskLiveConfigured } from "./zendeskStore.js";

type ZendeskProviderTestResult = {
  ok: boolean;
  message: string;
};

export interface ZendeskReportingProvider {
  mode: ZendeskProviderMode;
  testConnection(): Promise<ZendeskProviderTestResult>;
  sync(options: { cursor?: string | null }): Promise<ZendeskProviderSyncResult>;
}

type RawZendeskTicket = {
  id: number | string;
  subject?: string | null;
  requester_id?: number | string | null;
  assignee_id?: number | string | null;
  organization_id?: number | string | null;
  group_id?: number | string | null;
  ticket_form_id?: number | string | null;
  status?: string | null;
  priority?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  solved_at?: string | null;
  tags?: string[] | null;
  deleted?: boolean | null;
  custom_fields?: Array<{ id?: number | string | null; value?: unknown }> | null;
};

type RawMetricSet = {
  ticket_id?: number | string | null;
  reply_time_in_minutes?: unknown;
  full_resolution_time_in_minutes?: unknown;
  first_reply_time_in_minutes?: unknown;
};

type RawZendeskUser = {
  id: number | string;
  name?: string | null;
  email?: string | null;
};

type RawZendeskGroup = {
  id: number | string;
  name?: string | null;
};

type RawZendeskOrganization = {
  id: number | string;
  name?: string | null;
};

type RawZendeskForm = {
  id: number | string;
  name?: string | null;
};

type IncrementalTicketResponse = {
  tickets?: RawZendeskTicket[];
  metric_sets?: RawMetricSet[];
  users?: RawZendeskUser[];
  groups?: RawZendeskGroup[];
  organizations?: RawZendeskOrganization[];
  ticket_forms?: RawZendeskForm[];
  after_cursor?: string;
  end_of_stream?: boolean;
  meta?: {
    after_cursor?: string;
    has_more?: boolean;
  };
};

type RetryableZendeskRequestError = Error & {
  retryAfterSeconds?: number | null;
  retryable?: boolean;
  statusCode?: number | null;
};

export function getZendeskReportingProvider(): ZendeskReportingProvider {
  if (isZendeskLiveConfigured()) {
    return new LiveZendeskReportingProvider();
  }
  return new MockZendeskReportingProvider();
}

export class MockZendeskReportingProvider implements ZendeskReportingProvider {
  mode: ZendeskProviderMode = "mock";

  async testConnection() {
    return {
      ok: true,
      message: "Zendesk mock demo mode is active. Leadership can review support health locally without live credentials."
    };
  }

  async sync(): Promise<ZendeskProviderSyncResult> {
    const tickets = buildMockZendeskFixtureTickets();
    return {
      provider_mode: "mock",
      tickets,
      next_cursor: null,
      records_synced: tickets.length,
      warnings: [
        "Zendesk live credentials are not configured, so Mission Control is using cached demo support data.",
        "Customer Service remains read-only in this module. Ticket editing and agent workflows stay in Zendesk."
      ],
      errors: []
    };
  }
}

export class LiveZendeskReportingProvider implements ZendeskReportingProvider {
  mode: ZendeskProviderMode = "zendesk_live";

  async testConnection() {
    await this.requestJson("/api/v2/users/me.json");
    return {
      ok: true,
      message: `Zendesk responded successfully for ${config.ZENDESK_SUBDOMAIN}.`
    };
  }

  async sync(options: { cursor?: string | null }): Promise<ZendeskProviderSyncResult> {
    const tickets: ZendeskProviderTicket[] = [];
    const warnings: string[] = [];
    const errors: ZendeskSyncError[] = [];
    let cursor = options.cursor ?? null;
    let nextCursor = cursor;
    let pageCount = 0;
    let endOfStream = false;

    while (!endOfStream && pageCount < 5) {
      const response = await this.requestJson<IncrementalTicketResponse>(this.buildIncrementalPath(cursor));
      const normalizedPage = normalizeIncrementalTicketResponse(response);
      tickets.push(...normalizedPage.tickets);

      nextCursor = response.after_cursor ?? response.meta?.after_cursor ?? null;
      endOfStream = Boolean(response.end_of_stream) || !Boolean(response.meta?.has_more);
      cursor = nextCursor;
      pageCount += 1;
    }

    if (!endOfStream && nextCursor) {
      warnings.push("Zendesk sync stopped after the safe page limit. Run sync again to continue advancing the cursor.");
    }

    return {
      provider_mode: "zendesk_live",
      tickets,
      next_cursor: nextCursor,
      records_synced: tickets.length,
      warnings,
      errors
    };
  }

  private buildIncrementalPath(cursor: string | null) {
    if (cursor) {
      return `/api/v2/incremental/tickets/cursor.json?cursor=${encodeURIComponent(cursor)}&include=metric_sets,users,groups,organizations,ticket_forms`;
    }
    const startTime = Math.floor(Date.now() / 1000) - config.ZENDESK_SYNC_LOOKBACK_DAYS * 24 * 60 * 60;
    return `/api/v2/incremental/tickets/cursor.json?start_time=${startTime}&include=metric_sets,users,groups,organizations,ticket_forms`;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const url = `https://${config.ZENDESK_SUBDOMAIN}.zendesk.com${path}`;
    let lastError: RetryableZendeskRequestError | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const trace = startIntegrationTrace({
        provider: "zendesk",
        operation: describeZendeskOperation(path),
        direction: "outbound",
        method: "GET",
        target: url
      });
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), config.ZENDESK_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: buildZendeskAuthHeaders(),
          signal: controller.signal
        });

        if (!response.ok) {
          const message = await response.text();
          const error = buildZendeskRequestError(response.status, message, response.headers);
          failIntegrationTrace(trace, error, {
            statusCode: error.statusCode ?? response.status,
            attempt,
            retryAfterSeconds: error.retryAfterSeconds ?? null,
            retryable: error.retryable ?? false
          });
          lastError = error;
          if (attempt < 2 && error.retryable) {
            continue;
          }
          throw error;
        }

        const payload = (await response.json()) as T;
        finishIntegrationTrace(trace, { statusCode: response.status, attempt });
        return payload;
      } catch (error) {
        const normalized = normalizeZendeskRequestError(error);
        if (error instanceof Error && !(normalized === error)) {
          failIntegrationTrace(trace, normalized, {
            statusCode: normalized.statusCode ?? null,
            attempt,
            retryAfterSeconds: normalized.retryAfterSeconds ?? null,
            retryable: normalized.retryable ?? false
          });
        } else if (!(error instanceof Error)) {
          failIntegrationTrace(trace, normalized, {
            statusCode: normalized.statusCode ?? null,
            attempt,
            retryAfterSeconds: normalized.retryAfterSeconds ?? null,
            retryable: normalized.retryable ?? false
          });
        }
        lastError = normalized;
        if (attempt < 2 && normalized.retryable) {
          continue;
        }
        throw normalized;
      } finally {
        globalThis.clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error("Zendesk request failed without a captured error");
  }
}

function buildZendeskAuthHeaders() {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (config.ZENDESK_AUTH_MODE === "oauth" && config.ZENDESK_ACCESS_TOKEN) {
    headers.set("Authorization", `Bearer ${config.ZENDESK_ACCESS_TOKEN}`);
    return headers;
  }

  const encoded = Buffer.from(`${config.ZENDESK_EMAIL}/token:${config.ZENDESK_API_TOKEN}`).toString("base64");
  headers.set("Authorization", `Basic ${encoded}`);
  return headers;
}

function normalizeIncrementalTicketResponse(response: IncrementalTicketResponse) {
  const users = new Map<string, RawZendeskUser>();
  const groups = new Map<string, RawZendeskGroup>();
  const organizations = new Map<string, RawZendeskOrganization>();
  const forms = new Map<string, RawZendeskForm>();
  const metricSets = new Map<string, RawMetricSet>();

  for (const user of response.users ?? []) {
    users.set(String(user.id), user);
  }
  for (const group of response.groups ?? []) {
    groups.set(String(group.id), group);
  }
  for (const organization of response.organizations ?? []) {
    organizations.set(String(organization.id), organization);
  }
  for (const form of response.ticket_forms ?? []) {
    forms.set(String(form.id), form);
  }
  for (const metric of response.metric_sets ?? []) {
    if (metric.ticket_id !== null && metric.ticket_id !== undefined) {
      metricSets.set(String(metric.ticket_id), metric);
    }
  }

  const tickets = (response.tickets ?? []).map((ticket) => {
    const ticketId = String(ticket.id);
    const metric = metricSets.get(ticketId);
    const requester = ticket.requester_id !== null && ticket.requester_id !== undefined ? users.get(String(ticket.requester_id)) : null;
    const assignee = ticket.assignee_id !== null && ticket.assignee_id !== undefined ? users.get(String(ticket.assignee_id)) : null;
    const organization =
      ticket.organization_id !== null && ticket.organization_id !== undefined ? organizations.get(String(ticket.organization_id)) : null;
    const group = ticket.group_id !== null && ticket.group_id !== undefined ? groups.get(String(ticket.group_id)) : null;
    const form = ticket.ticket_form_id !== null && ticket.ticket_form_id !== undefined ? forms.get(String(ticket.ticket_form_id)) : null;

    return {
      zendesk_ticket_id: ticketId,
      subject: ticket.subject?.trim() || `Zendesk Ticket ${ticketId}`,
      requester_name: requester?.name?.trim() || null,
      requester_email: requester?.email?.trim() || null,
      assignee_name: assignee?.name?.trim() || null,
      assignee_id: assignee ? String(assignee.id) : null,
      organization_name: organization?.name?.trim() || null,
      group_name: group?.name?.trim() || null,
      form_name: form?.name?.trim() || null,
      status: ticket.status?.trim() || "open",
      priority: ticket.priority?.trim() || null,
      ticket_created_at: ticket.created_at || new Date().toISOString(),
      ticket_updated_at: ticket.updated_at || ticket.created_at || new Date().toISOString(),
      ticket_solved_at: ticket.solved_at || null,
      first_reply_minutes: extractMetricMinutes(metric?.first_reply_time_in_minutes ?? metric?.reply_time_in_minutes),
      resolution_minutes: extractMetricMinutes(metric?.full_resolution_time_in_minutes),
      tags: (ticket.tags ?? []).map((tag) => tag.toLowerCase()),
      external_url: `https://${config.ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${ticketId}`,
      is_deleted: Boolean(ticket.deleted),
      custom_fields: normalizeCustomFields(ticket.custom_fields),
      raw_payload: {
        ticket,
        requester,
        assignee,
        organization,
        group,
        form,
        metric
      }
    } satisfies ZendeskProviderTicket;
  });

  return { tickets };
}

function normalizeCustomFields(
  values: RawZendeskTicket["custom_fields"]
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of values ?? []) {
    if (field?.id === null || field?.id === undefined || field.value === null || field.value === undefined) {
      continue;
    }
    next[String(field.id)] = String(field.value).trim().toLowerCase();
  }
  return next;
}

function extractMetricMinutes(metricValue: unknown) {
  if (typeof metricValue === "number" && Number.isFinite(metricValue)) {
    return Math.round(metricValue);
  }
  if (!metricValue || typeof metricValue !== "object") {
    return null;
  }
  const candidate = metricValue as Record<string, unknown>;
  const calendarMinutes = typeof candidate.calendar === "number" ? candidate.calendar : null;
  const businessMinutes = typeof candidate.business === "number" ? candidate.business : null;
  const value = calendarMinutes ?? businessMinutes;
  return value === null ? null : Math.round(value);
}

function describeZendeskOperation(path: string) {
  if (path.includes("/users/me.json")) {
    return "test_connection";
  }
  if (path.includes("/incremental/tickets/cursor.json")) {
    return "incremental_ticket_sync";
  }
  return "zendesk_request";
}

function buildZendeskRequestError(statusCode: number, message: string, headers: Headers): RetryableZendeskRequestError {
  const error = new Error(`Zendesk request failed (${statusCode}): ${message}`) as RetryableZendeskRequestError;
  error.name = "ZendeskRequestError";
  error.statusCode = statusCode;
  error.retryAfterSeconds = readRetryAfterSeconds(headers);
  error.retryable = statusCode === 429 || statusCode >= 500;
  return error;
}

function normalizeZendeskRequestError(error: unknown): RetryableZendeskRequestError {
  if (error instanceof Error && error.name === "AbortError") {
    const timeoutError = new Error("Zendesk request timed out") as RetryableZendeskRequestError;
    timeoutError.name = "ZendeskTimeoutError";
    timeoutError.statusCode = 408;
    timeoutError.retryAfterSeconds = null;
    timeoutError.retryable = true;
    return timeoutError;
  }

  if (error instanceof Error) {
    const known = error as RetryableZendeskRequestError;
    if (typeof known.retryable === "boolean") {
      return known;
    }
    const networkError = new Error(error.message) as RetryableZendeskRequestError;
    networkError.name = error.name || "ZendeskNetworkError";
    networkError.statusCode = known.statusCode ?? null;
    networkError.retryAfterSeconds = known.retryAfterSeconds ?? null;
    networkError.retryable = true;
    return networkError;
  }

  const unknownError = new Error(String(error)) as RetryableZendeskRequestError;
  unknownError.name = "ZendeskUnknownError";
  unknownError.statusCode = null;
  unknownError.retryAfterSeconds = null;
  unknownError.retryable = false;
  return unknownError;
}

function readRetryAfterSeconds(headers: Headers) {
  const rawValue = headers.get("Retry-After");
  if (!rawValue) {
    return null;
  }
  const numericValue = Number(rawValue);
  if (Number.isFinite(numericValue) && numericValue >= 0) {
    return Math.ceil(numericValue);
  }
  const retryAt = Date.parse(rawValue);
  if (Number.isNaN(retryAt)) {
    return null;
  }
  const deltaSeconds = Math.ceil((retryAt - Date.now()) / 1000);
  return deltaSeconds >= 0 ? deltaSeconds : null;
}
