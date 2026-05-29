import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import type {
  ZendeskCategoryBreakdownRow,
  ZendeskCategoryRule,
  ZendeskConnection,
  ZendeskLeadershipSummary,
  ZendeskLeadershipTicketList,
  ZendeskLeadershipTrends,
  ZendeskProviderSyncResult,
  ZendeskProviderTicket,
  ZendeskStatusPayload,
  ZendeskSyncError,
  ZendeskSyncRun,
  ZendeskTestPayload,
  ZendeskTicketCategory,
  ZendeskTicketSummary
} from "../types/zendesk.js";
import { getZendeskReportingProvider } from "./zendeskProvider.js";
import { buildMockZendeskFixtureTickets } from "./zendeskFixtures.js";
import {
  buildDefaultZendeskConnection,
  createZendeskAudit,
  listCachedZendeskTickets,
  listZendeskCategoryRules,
  listZendeskDailyMetrics,
  listZendeskSyncRuns,
  loadZendeskConnection,
  mapConnectionToZendeskConnection,
  recordZendeskSyncRun,
  replaceZendeskDailyMetrics,
  upsertZendeskConnection,
  upsertZendeskTickets,
  type ZendeskDailyMetricInput,
  type ZendeskRequestAuditContext
} from "./zendeskStore.js";

type TrendRange = "7d" | "30d" | "this_week" | "this_month";

type DailyMetricPoint = ZendeskDailyMetricInput;

const CATEGORIES: ZendeskTicketCategory[] = ["schools", "sports", "other"];

export async function getZendeskStatus(client: PoolClient, auth: AuthUser): Promise<ZendeskStatusPayload> {
  const projection = await loadZendeskReadProjection(client, auth);
  return {
    connection: projection.connection,
    sync_runs: projection.syncRuns,
    category_rules: projection.categoryRules
  };
}

export async function testZendeskConnection(
  client: PoolClient,
  auth: AuthUser,
  meta: ZendeskRequestAuditContext
): Promise<ZendeskTestPayload> {
  const provider = getZendeskReportingProvider();
  try {
    const result = await provider.testConnection();
    await createZendeskAudit(
      client,
      {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "zendesk.integration.tested",
        entityType: "zendesk_connection",
        metadata: { provider_mode: provider.mode, ok: result.ok }
      },
      meta
    );
    if (provider.mode === "zendesk_live") {
      await upsertZendeskConnection(client, auth.tenantId, {
        provider_mode: "zendesk_live",
        connection_status: "connected",
        health_state: "connected_pending_sync",
        connected_account_email: auth.email
      });
    }
    return {
      ok: result.ok,
      mode: provider.mode,
      message: result.message
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zendesk test failed.";
    if (provider.mode === "zendesk_live") {
      await upsertZendeskConnection(client, auth.tenantId, {
        provider_mode: "zendesk_live",
        connection_status: "attention",
        health_state: "connected_error",
        connected_account_email: auth.email,
        last_failed_sync_at: new Date().toISOString(),
        last_error_message: message
      });
    }
    await createZendeskAudit(
      client,
      {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "zendesk.integration.test_failed",
        entityType: "zendesk_connection",
        metadata: { provider_mode: provider.mode, message }
      },
      meta
    );
    return {
      ok: false,
      mode: provider.mode,
      message
    };
  }
}

export async function syncZendeskReporting(
  client: PoolClient,
  auth: AuthUser,
  meta: ZendeskRequestAuditContext
) {
  const result = await performZendeskSync(client, auth, meta, { audit: true });
  return result;
}

export async function getZendeskLeadershipSummary(client: PoolClient, auth: AuthUser): Promise<ZendeskLeadershipSummary> {
  const projection = await loadZendeskReadProjection(client, auth);
  return buildLeadershipSummary(projection.connection, projection.tickets, projection.dailyMetrics);
}

export async function getZendeskLeadershipTrends(
  client: PoolClient,
  auth: AuthUser,
  range: TrendRange
): Promise<ZendeskLeadershipTrends> {
  const projection = await loadZendeskReadProjection(client, auth);
  return {
    connection: projection.connection,
    range,
    points: buildTrendPoints(projection.dailyMetrics, range)
  };
}

export async function getZendeskLeadershipTicketList(
  client: PoolClient,
  auth: AuthUser,
  options: {
    status?: "open" | "all";
    limit?: number;
  } = {}
): Promise<ZendeskLeadershipTicketList> {
  const projection = await loadZendeskReadProjection(client, auth);
  const tickets = filterReadProjectionTickets(projection.tickets, {
    onlyOpen: options.status !== "all",
    limit: options.limit ?? 20
  });
  return {
    connection: projection.connection,
    tickets
  };
}

export function classifyZendeskTicket(ticket: ZendeskProviderTicket, rules: ZendeskCategoryRule[]): ZendeskTicketCategory {
  const normalizedTags = new Set((ticket.tags ?? []).map((tag) => tag.toLowerCase()));
  const groupName = (ticket.group_name ?? "").toLowerCase();
  const formName = (ticket.form_name ?? "").toLowerCase();
  const organizationName = (ticket.organization_name ?? "").toLowerCase();
  const subject = ticket.subject.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    const matchValue = rule.match_value.toLowerCase();
    if (rule.rule_type === "tag" && normalizedTags.has(matchValue)) {
      return rule.category;
    }
    if (rule.rule_type === "group" && groupName.includes(matchValue)) {
      return rule.category;
    }
    if (rule.rule_type === "form" && formName.includes(matchValue)) {
      return rule.category;
    }
    if (rule.rule_type === "organization" && organizationName.includes(matchValue)) {
      return rule.category;
    }
    if (rule.rule_type === "custom_field" && rule.field_key && ticket.custom_fields[rule.field_key]?.includes(matchValue)) {
      return rule.category;
    }
    if (
      rule.rule_type === "keyword" &&
      [subject, groupName, formName, organizationName].some((value) => value.includes(matchValue))
    ) {
      return rule.category;
    }
  }

  const fallbackSchools = ["school", "schools", "picture day", "portrait", "yearbook", "district"];
  const fallbackSports = ["sport", "sports", "athletic", "stadium", "league", "team", "coach"];
  const haystack = [subject, groupName, formName, organizationName, ...normalizedTags].join(" ");

  if (fallbackSchools.some((keyword) => haystack.includes(keyword))) {
    return "schools";
  }
  if (fallbackSports.some((keyword) => haystack.includes(keyword))) {
    return "sports";
  }
  return "other";
}

async function ensureZendeskReportingSeeded(client: PoolClient, auth: AuthUser): Promise<ZendeskConnection> {
  const provider = getZendeskReportingProvider();
  const existingConnection = await loadZendeskConnection(client, auth.tenantId);
  const existingTickets = await listCachedZendeskTickets(client, auth.tenantId, { limit: 1 });

  if (provider.mode === "mock" && (!existingConnection || existingTickets.length === 0)) {
    const seeded = await performZendeskSync(client, auth, {}, { audit: false });
    return seeded.connection;
  }

  if (!existingConnection) {
    return buildDefaultZendeskConnection(auth.tenantId);
  }

  return mapConnectionToZendeskConnection(existingConnection, auth.tenantId);
}

async function loadZendeskReadProjection(client: PoolClient, auth: AuthUser) {
  const provider = getZendeskReportingProvider();
  const existingConnection = await loadZendeskConnection(client, auth.tenantId);
  const categoryRules = await listZendeskCategoryRules(client, auth.tenantId);
  const cachedTickets = await listCachedZendeskTickets(client, auth.tenantId);
  const dailyMetrics = await listZendeskDailyMetrics(client, auth.tenantId);
  const syncRuns = await listZendeskSyncRuns(client, auth.tenantId);

  if (provider.mode === "mock" && !existingConnection && cachedTickets.length === 0 && dailyMetrics.length === 0) {
    const tickets = buildMockZendeskFixtureTickets().map((ticket) => ({
      ...ticket,
      category: classifyZendeskTicket(ticket, categoryRules),
      is_unassigned: !ticket.assignee_id
    }));
    const summaries = tickets.map((ticket) => ({
      zendesk_ticket_id: ticket.zendesk_ticket_id,
      subject: ticket.subject,
      requester_name: ticket.requester_name,
      requester_email: ticket.requester_email,
      assignee_name: ticket.assignee_name,
      organization_name: ticket.organization_name,
      group_name: ticket.group_name,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      ticket_created_at: ticket.ticket_created_at,
      ticket_updated_at: ticket.ticket_updated_at,
      ticket_solved_at: ticket.ticket_solved_at,
      first_reply_minutes: ticket.first_reply_minutes,
      resolution_minutes: ticket.resolution_minutes,
      is_unassigned: ticket.is_unassigned,
      external_url: ticket.external_url,
      tags: ticket.tags ?? []
    })) satisfies ZendeskTicketSummary[];

    return {
      connection: buildDefaultZendeskConnection(auth.tenantId),
      categoryRules,
      tickets: summaries,
      dailyMetrics: buildDailyMetrics(summaries),
      syncRuns: [
        {
          id: `mock-preview-${auth.tenantId}`,
          provider_mode: "mock" as const,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          status: "success" as const,
          records_synced: summaries.length,
          warnings: [],
          errors: []
        }
      ]
    };
  }

  return {
    connection: existingConnection ? mapConnectionToZendeskConnection(existingConnection, auth.tenantId) : buildDefaultZendeskConnection(auth.tenantId),
    categoryRules,
    tickets: cachedTickets,
    dailyMetrics,
    syncRuns
  };
}

function filterReadProjectionTickets(
  tickets: ZendeskTicketSummary[],
  options: {
    onlyOpen?: boolean;
    limit?: number;
  }
) {
  const filtered = tickets.filter((ticket) => (options.onlyOpen ? !["solved", "closed"].includes(ticket.status) : true));
  return typeof options.limit === "number" ? filtered.slice(0, options.limit) : filtered;
}

async function performZendeskSync(
  client: PoolClient,
  auth: AuthUser,
  meta: ZendeskRequestAuditContext,
  options: { audit: boolean }
) {
  const provider = getZendeskReportingProvider();
  const existingConnection = await loadZendeskConnection(client, auth.tenantId);
  const categoryRules = await listZendeskCategoryRules(client, auth.tenantId);

  let syncResult: ZendeskProviderSyncResult;
  let run: ZendeskSyncRun;
  let connection;
  const nowIso = new Date().toISOString();

  try {
    syncResult = await provider.sync({ cursor: existingConnection?.sync_cursor ?? null });
    const categorizedTickets = syncResult.tickets.map((ticket) => ({
      ...ticket,
      category: classifyZendeskTicket(ticket, categoryRules)
    }));
    await upsertZendeskTickets(client, auth.tenantId, categorizedTickets);

    const cachedTickets = await listCachedZendeskTickets(client, auth.tenantId);
    const dailyMetrics = buildDailyMetrics(cachedTickets);
    await replaceZendeskDailyMetrics(client, auth.tenantId, dailyMetrics);

    const status =
      syncResult.errors.length > 0 ? "error" : syncResult.warnings.length > 0 ? "warning" : "success";
    run = await recordZendeskSyncRun(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      providerMode: syncResult.provider_mode,
      status,
      recordsSynced: syncResult.records_synced,
      warnings: syncResult.warnings,
      errors: syncResult.errors
    });

    const nextConnection = await upsertZendeskConnection(client, auth.tenantId, {
      provider_mode: syncResult.provider_mode,
      connection_status: status === "error" ? "attention" : "connected",
      health_state:
        syncResult.provider_mode === "mock"
          ? "mock"
          : status === "error"
            ? "connected_error"
            : status === "warning"
              ? "connected_warning"
              : "connected_healthy",
      connected_account_email: syncResult.provider_mode === "mock" ? null : auth.email,
      sync_cursor: syncResult.next_cursor,
      records_synced: syncResult.records_synced,
      warning_count: syncResult.warnings.length,
      error_count: syncResult.errors.length,
      last_sync_at: run.finished_at ?? nowIso,
      last_successful_sync_at:
        status === "error" ? existingConnection?.last_successful_sync_at ?? null : run.finished_at ?? nowIso,
      last_failed_sync_at: status === "error" ? run.finished_at ?? nowIso : null,
      last_error_message: syncResult.errors[0]?.message ?? null
    });

    if (options.audit) {
      await createZendeskAudit(
        client,
        {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          action: "zendesk.sync.requested",
          entityType: "zendesk_connection",
          entityId: nextConnection.id,
          metadata: {
            provider_mode: syncResult.provider_mode,
            status,
            records_synced: syncResult.records_synced
          }
        },
        meta
      );
    }

    connection = mapConnectionToZendeskConnection(nextConnection, auth.tenantId);
    return { connection, sync_run: run };
  } catch (error) {
    const syncError = buildSyncError("sync", error instanceof Error ? error.message : "Zendesk sync failed.");
    run = await recordZendeskSyncRun(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      providerMode: provider.mode,
      status: "error",
      recordsSynced: 0,
      warnings: [],
      errors: [syncError]
    });
    const nextConnection = await upsertZendeskConnection(client, auth.tenantId, {
      provider_mode: provider.mode,
      connection_status: provider.mode === "mock" ? "connected" : "attention",
      health_state: provider.mode === "mock" ? "mock" : "connected_error",
      connected_account_email: provider.mode === "mock" ? null : auth.email,
      sync_cursor: existingConnection?.sync_cursor ?? null,
      records_synced: existingConnection?.records_synced ?? 0,
      warning_count: 0,
      error_count: 1,
      last_sync_at: nowIso,
      last_successful_sync_at: existingConnection?.last_successful_sync_at ?? null,
      last_failed_sync_at: nowIso,
      last_error_message: syncError.message
    });

    if (options.audit) {
      await createZendeskAudit(
        client,
        {
          tenantId: auth.tenantId,
          actorUserId: auth.id,
          action: "zendesk.sync.failed",
          entityType: "zendesk_connection",
          entityId: nextConnection.id,
          metadata: { provider_mode: provider.mode, message: syncError.message }
        },
        meta
      );
    }

    connection = mapConnectionToZendeskConnection(nextConnection, auth.tenantId);
    return { connection, sync_run: run };
  }
}

function buildLeadershipSummary(
  connection: ZendeskConnection,
  tickets: ZendeskTicketSummary[],
  dailyMetrics: DailyMetricPoint[]
): ZendeskLeadershipSummary {
  const openTickets = tickets.filter((ticket) => isOpenStatus(ticket.status));
  const thisWeek = getWeekRange(0);
  const previousWeek = getWeekRange(-7);
  const thisWeekNewTickets = tickets.filter((ticket) => inRange(ticket.ticket_created_at, thisWeek.start, thisWeek.endExclusive));
  const previousWeekNewTickets = tickets.filter((ticket) => inRange(ticket.ticket_created_at, previousWeek.start, previousWeek.endExclusive));
  const thisWeekResolvedTickets = tickets.filter(
    (ticket) => Boolean(ticket.ticket_solved_at) && inRange(ticket.ticket_solved_at as string, thisWeek.start, thisWeek.endExclusive)
  );
  const previousWeekResolvedTickets = tickets.filter(
    (ticket) => Boolean(ticket.ticket_solved_at) && inRange(ticket.ticket_solved_at as string, previousWeek.start, previousWeek.endExclusive)
  );
  const thisWeekReplyMedian = median(thisWeekNewTickets.map((ticket) => ticket.first_reply_minutes).filter(isNumber));
  const previousWeekReplyMedian = median(previousWeekNewTickets.map((ticket) => ticket.first_reply_minutes).filter(isNumber));
  const thisWeekResolutionMedian = median(thisWeekResolvedTickets.map((ticket) => ticket.resolution_minutes).filter(isNumber));
  const previousWeekResolutionMedian = median(previousWeekResolvedTickets.map((ticket) => ticket.resolution_minutes).filter(isNumber));
  const comparisons = {
    new_tickets_week_over_week: thisWeekNewTickets.length - previousWeekNewTickets.length,
    resolved_tickets_week_over_week: thisWeekResolvedTickets.length - previousWeekResolvedTickets.length,
    open_backlog_change:
      getOpenBacklogForDate(dailyMetrics, addDays(new Date(), -1)) -
      getOpenBacklogForDate(dailyMetrics, addDays(new Date(), -8)),
    first_reply_change_minutes:
      thisWeekReplyMedian !== null && previousWeekReplyMedian !== null ? thisWeekReplyMedian - previousWeekReplyMedian : null,
    resolution_change_minutes:
      thisWeekResolutionMedian !== null && previousWeekResolutionMedian !== null
        ? thisWeekResolutionMedian - previousWeekResolutionMedian
        : null
  };

  return {
    connection,
    kpis: {
      open_tickets: openTickets.length,
      new_tickets_this_week: thisWeekNewTickets.length,
      resolved_tickets_this_week: thisWeekResolvedTickets.length,
      unassigned_tickets: openTickets.filter((ticket) => ticket.is_unassigned).length,
      median_first_reply_minutes: thisWeekReplyMedian,
      median_resolution_minutes: thisWeekResolutionMedian,
      oldest_open_tickets: openTickets.filter((ticket) => ageInDays(ticket.ticket_created_at) >= 8).length
    },
    comparisons,
    queue_health: {
      total_open: openTickets.length,
      aging_buckets: [
        { label: "0 to 1 days", count: openTickets.filter((ticket) => ageInDays(ticket.ticket_created_at) <= 1).length },
        { label: "2 to 3 days", count: openTickets.filter((ticket) => ageInDays(ticket.ticket_created_at) >= 2 && ageInDays(ticket.ticket_created_at) <= 3).length },
        { label: "4 to 7 days", count: openTickets.filter((ticket) => ageInDays(ticket.ticket_created_at) >= 4 && ageInDays(ticket.ticket_created_at) <= 7).length },
        { label: "8+ days", count: openTickets.filter((ticket) => ageInDays(ticket.ticket_created_at) >= 8).length }
      ],
      status_breakdown: buildStatusBreakdown(tickets)
    },
    category_breakdown: buildCategoryBreakdown(tickets),
    flags: {
      backlog_rising: (comparisons.open_backlog_change ?? 0) > 0,
      reply_time_degrading: (comparisons.first_reply_change_minutes ?? 0) > 15,
      unusual_ticket_spike:
        previousWeekNewTickets.length > 0
          ? thisWeekNewTickets.length > previousWeekNewTickets.length * 1.35
          : thisWeekNewTickets.length >= 6
    }
  };
}

function buildTrendPoints(dailyMetrics: DailyMetricPoint[], range: TrendRange) {
  const window = getTrendWindow(range);
  const series = new Map<string, DailyMetricPoint[]>();

  for (const metric of dailyMetrics) {
    if (metric.metric_date < window.startDate || metric.metric_date > window.endDate) {
      continue;
    }
    const existing = series.get(metric.metric_date);
    if (existing) {
      existing.push(metric);
    } else {
      series.set(metric.metric_date, [metric]);
    }
  }

  const points = [];
  for (const day of window.days) {
    const dateKey = toDateString(day);
    const metrics = series.get(dateKey) ?? [];
    points.push({
      metric_date: dateKey,
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      opened_count: metrics.reduce((sum, metric) => sum + metric.new_ticket_count, 0),
      resolved_count: metrics.reduce((sum, metric) => sum + metric.resolved_ticket_count, 0),
      open_backlog_count: metrics.reduce((sum, metric) => sum + metric.open_backlog_count, 0),
      median_first_reply_minutes: median(metrics.map((metric) => metric.median_first_reply_minutes).filter(isNumber)),
      median_resolution_minutes: median(metrics.map((metric) => metric.median_resolution_minutes).filter(isNumber))
    });
  }
  return points;
}

function buildCategoryBreakdown(tickets: ZendeskTicketSummary[]): ZendeskCategoryBreakdownRow[] {
  const lookbackStart = addDays(startOfDay(new Date()), -29);
  return CATEGORIES.map((category) => {
    const categoryTickets = tickets.filter((ticket) => ticket.category === category);
    const periodTickets = categoryTickets.filter((ticket) => new Date(ticket.ticket_created_at) >= lookbackStart);
    return {
      category,
      total_count: periodTickets.length,
      open_count: categoryTickets.filter((ticket) => isOpenStatus(ticket.status)).length,
      resolved_count: categoryTickets.filter((ticket) => ticket.ticket_solved_at !== null && new Date(ticket.ticket_solved_at as string) >= lookbackStart).length,
      unassigned_count: categoryTickets.filter((ticket) => isOpenStatus(ticket.status) && ticket.is_unassigned).length
    };
  });
}

function buildStatusBreakdown(tickets: ZendeskTicketSummary[]) {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count);
}

function buildDailyMetrics(tickets: ZendeskTicketSummary[]): DailyMetricPoint[] {
  const start = addDays(startOfDay(new Date()), -44);
  const days: Date[] = [];
  for (let cursor = new Date(start); cursor <= startOfDay(new Date()); cursor = addDays(cursor, 1)) {
    days.push(new Date(cursor));
  }

  const metrics: DailyMetricPoint[] = [];
  for (const day of days) {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    for (const category of CATEGORIES) {
      const categoryTickets = tickets.filter((ticket) => ticket.category === category);
      const created = categoryTickets.filter((ticket) => inRange(ticket.ticket_created_at, dayStart, dayEnd));
      const resolved = categoryTickets.filter(
        (ticket) => Boolean(ticket.ticket_solved_at) && inRange(ticket.ticket_solved_at as string, dayStart, dayEnd)
      );
      const openAtEnd = categoryTickets.filter((ticket) => {
        const createdAt = new Date(ticket.ticket_created_at);
        const solvedAt = ticket.ticket_solved_at ? new Date(ticket.ticket_solved_at) : null;
        return createdAt < dayEnd && (!solvedAt || solvedAt >= dayEnd);
      });
      metrics.push({
        metric_date: toDateString(dayStart),
        category,
        new_ticket_count: created.length,
        resolved_ticket_count: resolved.length,
        open_backlog_count: openAtEnd.length,
        oldest_open_ticket_count: openAtEnd.filter((ticket) => differenceInDays(dayEnd, new Date(ticket.ticket_created_at)) >= 8).length,
        median_first_reply_minutes: median(created.map((ticket) => ticket.first_reply_minutes).filter(isNumber)),
        median_resolution_minutes: median(resolved.map((ticket) => ticket.resolution_minutes).filter(isNumber))
      });
    }
  }
  return metrics;
}

function getTrendWindow(range: TrendRange) {
  const today = startOfDay(new Date());
  if (range === "7d") {
    const start = addDays(today, -6);
    return buildWindow(start, today);
  }
  if (range === "30d") {
    const start = addDays(today, -29);
    return buildWindow(start, today);
  }
  if (range === "this_week") {
    const start = startOfWeek(today);
    const end = addDays(start, 6);
    return buildWindow(start, end);
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return buildWindow(start, end);
}

function buildWindow(start: Date, end: Date) {
  const days: Date[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(new Date(cursor));
  }
  return {
    startDate: toDateString(start),
    endDate: toDateString(end),
    days
  };
}

function getWeekRange(offsetDays: number) {
  const today = startOfDay(new Date());
  const shifted = addDays(today, offsetDays);
  const start = startOfWeek(shifted);
  return {
    start,
    endExclusive: addDays(start, 7)
  };
}

function getOpenBacklogForDate(metrics: DailyMetricPoint[], day: Date) {
  const dateKey = toDateString(startOfDay(day));
  return metrics.filter((metric) => metric.metric_date === dateKey).reduce((sum, metric) => sum + metric.open_backlog_count, 0);
}

function isOpenStatus(status: string, solvedBeforeWindow = false) {
  if (solvedBeforeWindow) {
    return false;
  }
  return !["solved", "closed"].includes(status);
}

function inRange(value: string, start: Date, endExclusive: Date) {
  const timestamp = new Date(value);
  return timestamp >= start && timestamp < endExclusive;
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(value: Date) {
  const next = startOfDay(value);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(next, diff);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateString(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ageInDays(value: string) {
  return differenceInDays(new Date(), new Date(value));
}

function differenceInDays(left: Date, right: Date) {
  return Math.floor((left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000));
}

function median(values: number[]) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }
  return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
}

function isNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function buildSyncError(scope: string, message: string): ZendeskSyncError {
  return {
    code: "zendesk_sync_failed",
    message,
    scope,
    occurred_at: new Date().toISOString()
  };
}
