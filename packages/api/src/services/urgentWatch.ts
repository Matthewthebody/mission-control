import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { withClientTransaction, withSystemTransaction } from "../db/tx.js";
import type { AuthUser } from "../types/auth.js";
import type {
  OperationalExceptionActionInput,
  OperationalExceptionCategory,
  OperationalExceptionDetail,
  OperationalExceptionEventRecord,
  OperationalExceptionListItem,
  OperationalExceptionOwnerOption,
  OperationalExceptionSeverity,
  OperationalExceptionStatus,
  OperationalExceptionWorkspace
} from "../types/exceptions.js";
import type {
  UrgentWatchCandidate,
  UrgentWatchDetail,
  UrgentWatchEventRecord,
  UrgentWatchListItem,
  UrgentWatchOwnerOption,
  UrgentWatchSeverity,
  UrgentWatchStatus,
  UrgentWatchWorkspace
} from "../types/urgentWatch.js";
import { getLocalDateString } from "../utils/localDate.js";
import { createAuditLog } from "./audit.js";
import { listAttendanceUrgentWatchCandidates } from "./attendanceOperations.js";
import { canManageOperatingSystemModule, getOperatingSystemQueryScope } from "./operatingSystemAccess.js";
import { listOperationalApprovalWatchCandidates } from "./operationalApprovals.js";
import { synchronizeProductionIntake } from "./productionIntake.js";
import { listProductionUrgentWatchFacts, type ProductionUrgentWatchFact } from "./productionProjects.js";
import { listSchedulingUrgentWatchCandidates } from "./scheduleStaffing.js";

type UrgentWatchScope = Exclude<ReturnType<typeof getOperatingSystemQueryScope>, { level: "none" }>;

type UrgentWatchRow = {
  id: string;
  tenant_id: string;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  scope_department: string | null;
  watch_type: string;
  status: UrgentWatchStatus;
  severity: UrgentWatchSeverity;
  title: string;
  summary: string;
  owner_user_id: string | null;
  owner_name: string | null;
  due_at: string | null;
  next_action_label: string;
  action_hash: string;
  operational_impact_score: number;
  source_snapshot: Record<string, unknown> | null;
  source_fingerprint: string;
  snoozed_until: string | null;
  snooze_reason: string | null;
  handled_at: string | null;
  handled_by_user_id: string | null;
  handled_reason: string | null;
  resolved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type UrgentWatchEventRow = {
  id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type UrgentWatchActionInput =
  | {
      action: "assign_owner";
      owner_user_id: string | null;
      note?: string | null;
    }
  | {
      action: "snooze";
      reason: string;
      duration_minutes: number;
      note?: string | null;
    }
  | {
      action: "mark_handled";
      note?: string | null;
    };

export type ExceptionActionInput = OperationalExceptionActionInput;

const ACTIVE_WORKSPACE_STATUSES = new Set<UrgentWatchStatus>(["active", "snoozed"]);

export async function getUrgentWatchWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: { date?: string | null }
): Promise<UrgentWatchWorkspace> {
  const scope = assertCanViewUrgentWatch(auth);
  const anchorDate = normalizeDateFilter(options.date);
  const items = await loadVisibleUrgentWatchRows(client, auth, ACTIVE_WORKSPACE_STATUSES, anchorDate);
  const mapped = items.map(mapUrgentWatchListItem).sort(compareUrgentWatchItems);
  const ownerOptions = canManageUrgentWatch(auth) ? await listUrgentWatchOwnerOptions(client, auth, scope) : [];

  return {
    generated_at: new Date().toISOString(),
    scope: scope.level as UrgentWatchWorkspace["scope"],
    summary: buildUrgentWatchWorkspaceSummary(mapped),
    home_ready_summary: buildUrgentWatchHomeReadySummary(mapped),
    owner_options: ownerOptions,
    items: mapped
  };
}

export async function getExceptionWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: { date?: string | null }
): Promise<OperationalExceptionWorkspace> {
  const workspace = await getUrgentWatchWorkspace(client, auth, options);
  const items = workspace.items.map(mapOperationalExceptionListItem).sort(compareOperationalExceptionItems);
  return {
    generated_at: workspace.generated_at,
    scope: workspace.scope,
    summary: buildOperationalExceptionWorkspaceSummary(items),
    home_ready_summary: buildOperationalExceptionHomeReadySummary(items),
    owner_options: workspace.owner_options.map(mapOperationalExceptionOwnerOption),
    items
  };
}

export async function getUrgentWatchDetail(client: PoolClient, auth: AuthUser, itemId: string): Promise<UrgentWatchDetail> {
  const scope = assertCanViewUrgentWatch(auth);
  const row = await loadUrgentWatchRowById(client, auth.tenantId, itemId);
  if (!row || !canUserSeeUrgentWatchRow(row, auth, scope)) {
    throw new ApiError(404, "Exception item not found.");
  }

  const history = await loadUrgentWatchEvents(client, auth.tenantId, itemId);
  const ownerOptions = canManageUrgentWatch(auth) ? await listUrgentWatchOwnerOptions(client, auth, scope) : [];

  return {
    generated_at: new Date().toISOString(),
    item: mapUrgentWatchListItem(row),
    owner_options: ownerOptions,
    history,
    available_actions: canManageUrgentWatch(auth) ? ["assign_owner", "snooze", "mark_handled"] : []
  };
}

export async function getExceptionDetail(client: PoolClient, auth: AuthUser, itemId: string): Promise<OperationalExceptionDetail> {
  const detail = await getUrgentWatchDetail(client, auth, itemId);
  return {
    generated_at: detail.generated_at,
    item: mapOperationalExceptionListItem(detail.item),
    owner_options: detail.owner_options.map(mapOperationalExceptionOwnerOption),
    history: detail.history.map(mapOperationalExceptionEventRecord),
    available_actions: detail.available_actions
  };
}

export async function applyUrgentWatchAction(
  client: PoolClient,
  auth: AuthUser,
  itemId: string,
  input: UrgentWatchActionInput
): Promise<UrgentWatchDetail> {
  const scope = assertCanViewUrgentWatch(auth);
  if (!canManageUrgentWatch(auth)) {
    throw new ApiError(403, "You do not have access to manage exceptions.");
  }

  const existing = await loadUrgentWatchRowById(client, auth.tenantId, itemId);
  if (!existing || !canUserSeeUrgentWatchRow(existing, auth, scope)) {
    throw new ApiError(404, "Exception item not found.");
  }

  switch (input.action) {
    case "assign_owner": {
      await client.query(
        `
          UPDATE urgent_watch_item
          SET owner_user_id = $3::uuid,
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [auth.tenantId, itemId, input.owner_user_id]
      );
      await createUrgentWatchEvent(client, {
        tenantId: auth.tenantId,
        itemId,
        eventType: "watch.owner_assigned",
        summary: input.owner_user_id ? "Urgent Watch owner updated." : "Urgent Watch owner cleared.",
        note: input.note ?? null,
        actorUserId: auth.id,
        metadata: {
          owner_user_id: input.owner_user_id
        }
      });
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "urgent_watch.assign_owner",
        entityType: "urgent_watch_item",
        entityId: itemId,
        reasonComment: input.note ?? null,
        metadata: {
          owner_user_id: input.owner_user_id
        }
      });
      break;
    }
    case "snooze": {
      const snoozedUntil = new Date(Date.now() + input.duration_minutes * 60 * 1000).toISOString();
      await client.query(
        `
          UPDATE urgent_watch_item
          SET status = 'snoozed',
              snoozed_until = $3::timestamptz,
              snooze_reason = $4,
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [auth.tenantId, itemId, snoozedUntil, input.reason]
      );
      await createUrgentWatchEvent(client, {
        tenantId: auth.tenantId,
        itemId,
        eventType: "watch.snoozed",
        summary: `Urgent Watch item snoozed for ${formatDurationLabel(input.duration_minutes)}.`,
        note: input.note ?? null,
        actorUserId: auth.id,
        metadata: {
          reason: input.reason,
          duration_minutes: input.duration_minutes,
          snoozed_until: snoozedUntil
        }
      });
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "urgent_watch.snooze",
        entityType: "urgent_watch_item",
        entityId: itemId,
        reasonComment: input.reason,
        metadata: {
          duration_minutes: input.duration_minutes,
          snoozed_until: snoozedUntil,
          note: input.note ?? null
        }
      });
      break;
    }
    case "mark_handled": {
      await client.query(
        `
          UPDATE urgent_watch_item
          SET status = 'handled',
              handled_at = now(),
              handled_by_user_id = $3::uuid,
              handled_reason = $4,
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [auth.tenantId, itemId, auth.id, input.note?.trim() || null]
      );
      await createUrgentWatchEvent(client, {
        tenantId: auth.tenantId,
        itemId,
        eventType: "watch.handled",
        summary: "Urgent Watch item marked handled.",
        note: input.note ?? null,
        actorUserId: auth.id,
        metadata: {}
      });
      await createAuditLog(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        action: "urgent_watch.mark_handled",
        entityType: "urgent_watch_item",
        entityId: itemId,
        reasonComment: input.note ?? null
      });
      break;
    }
  }

  return getUrgentWatchDetail(client, auth, itemId);
}

export async function applyExceptionAction(
  client: PoolClient,
  auth: AuthUser,
  itemId: string,
  input: OperationalExceptionActionInput
): Promise<OperationalExceptionDetail> {
  await applyUrgentWatchAction(client, auth, itemId, input);
  return getExceptionDetail(client, auth, itemId);
}

export async function getUrgentWatchHomeSummary(
  client: PoolClient,
  auth: AuthUser,
  options: { date?: string | null }
) {
  const workspace = await getUrgentWatchWorkspace(client, auth, options);
  return workspace.home_ready_summary;
}

export async function reconcileUrgentWatchWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: { date?: string | null }
) {
  const anchorDate = options.date?.trim() || getLocalDateString();
  await syncUrgentWatchItems(client, auth, anchorDate);
}

export type UrgentWatchReconcileSweepResult = {
  tenant_count: number;
  reconciled_tenant_count: number;
  failed_tenant_count: number;
};

// Background reconciliation across tenants. Exception READS are pure by design
// (getExceptionWorkspace never mutates), so without a scheduled sweep a resolved,
// canceled, or deleted-source issue lingers as "active" and a returned condition
// is never reopened. This is that scheduled, mutating counterpart — it runs the
// exact same logic as POST /api/exceptions/reconcile, once per tenant, each in its
// own RLS-scoped transaction so one tenant's failure cannot abort the rest.
export async function sweepUrgentWatchReconcile(
  input: { tenantId?: string | null; date?: string | null } = {}
): Promise<UrgentWatchReconcileSweepResult> {
  const anchorDate = input.date?.trim() || getLocalDateString();
  const tenantIds = input.tenantId
    ? [input.tenantId]
    : (
        await withSystemTransaction((client) =>
          client.query<{ id: string }>("SELECT id::text AS id FROM tenant ORDER BY created_at ASC")
        )
      ).rows.map((row) => row.id);

  let reconciled = 0;
  let failed = 0;
  for (const tenantId of tenantIds) {
    // Background actor: matches the repo's system-auth stub convention (see
    // agreements.ts). A null actor id keeps audit/actor columns valid (uuid) and
    // mirrors the null RLS user passed to withClientTransaction below.
    const systemAuth = { tenantId, id: null, authorityTier: "super_admin" } as unknown as AuthUser;
    try {
      await withClientTransaction(tenantId, null, (client) =>
        reconcileUrgentWatchWorkspace(client, systemAuth, { date: anchorDate })
      );
      reconciled += 1;
    } catch (error) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(
        `Urgent watch reconcile failed for tenant ${tenantId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return {
    tenant_count: tenantIds.length,
    reconciled_tenant_count: reconciled,
    failed_tenant_count: failed
  };
}

async function syncUrgentWatchItems(client: PoolClient, auth: AuthUser, anchorDate: string) {
  const tenantId = auth.tenantId;
  // These candidate loaders all share the same transaction client. Running them
  // concurrently causes pg to interleave commands on a single connection and
  // can abort the whole transaction before we even map exceptions.
  const scheduling = await listSchedulingUrgentWatchCandidates(client, tenantId, anchorDate);
  const attendance = await listAttendanceUrgentWatchCandidates(client, tenantId, anchorDate);
  const productionFacts = await listProductionUrgentWatchFacts(client, tenantId, anchorDate);
  const production = buildProductionProjectUrgentWatchCandidates(productionFacts, anchorDate);
  const approvals = await listOperationalApprovalWatchCandidates(client, tenantId);
  const productionIntake = await synchronizeProductionIntake(client, auth, { anchorDate }).catch(() => null);
  const acknowledgements = await listWorkflowAcknowledgementUrgentWatchCandidates(client, tenantId).catch(() => []);
  const microsoftCalendarSync = await listMicrosoftCalendarSyncUrgentWatchCandidates(client, tenantId).catch(() => []);
  const candidates = [
    ...scheduling,
    ...attendance,
    ...production,
    ...listProductionIntakeUrgentWatchCandidates(productionIntake),
    ...approvals,
    ...acknowledgements,
    ...microsoftCalendarSync
  ];
  const existingRows = await loadUrgentWatchRowsForTenant(client, tenantId);
  const existingByKey = new Map(existingRows.map((row) => [buildSourceKey(row), row]));
  const seenKeys = new Set<string>();
  const unchangedSeenItemIds: string[] = [];
  const now = Date.now();

  for (const candidate of candidates) {
    const key = buildSourceKey(candidate);
    seenKeys.add(key);
    const fingerprint = buildCandidateFingerprint(candidate);
    let existing = existingByKey.get(key) ?? null;

      if (!existing) {
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO urgent_watch_item (
              tenant_id,
              source_module,
              source_entity_type,
              source_entity_id,
              source_entity_label,
              scope_department,
              watch_type,
              status,
              severity,
              title,
              summary,
              owner_user_id,
              due_at,
              next_action_label,
              action_hash,
              operational_impact_score,
              source_snapshot,
              source_fingerprint,
              first_seen_at,
              last_seen_at
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,
              'active',
              $8::urgent_watch_severity,
              $9,$10,$11::uuid,$12::timestamptz,$13,$14,$15,$16::jsonb,$17,now(),now()
            )
            ON CONFLICT (tenant_id, source_module, source_entity_type, source_entity_id, watch_type)
              DO NOTHING
            RETURNING id
          `,
          [
            tenantId,
            candidate.source_module,
            candidate.source_entity_type,
            candidate.source_entity_id,
            candidate.source_entity_label,
            candidate.scope_department,
            candidate.watch_type,
            candidate.severity,
            candidate.title,
            candidate.summary,
            candidate.owner_user_id,
            candidate.due_at,
            candidate.next_action_label,
            candidate.action_hash,
            candidate.operational_impact_score,
            JSON.stringify(candidate.source_snapshot ?? {}),
            fingerprint
          ]
        );
        if (inserted.rows[0]) {
          existingByKey.set(key, {
            id: inserted.rows[0].id,
            tenant_id: tenantId,
          source_module: candidate.source_module,
          source_entity_type: candidate.source_entity_type,
          source_entity_id: candidate.source_entity_id,
          source_entity_label: candidate.source_entity_label,
          scope_department: candidate.scope_department,
          watch_type: candidate.watch_type,
          status: "active",
          severity: candidate.severity,
          title: candidate.title,
          summary: candidate.summary,
          owner_user_id: candidate.owner_user_id,
          owner_name: candidate.owner_label ?? null,
          due_at: candidate.due_at,
          next_action_label: candidate.next_action_label,
          action_hash: candidate.action_hash,
          operational_impact_score: candidate.operational_impact_score,
          source_snapshot: candidate.source_snapshot ?? {},
          source_fingerprint: fingerprint,
          snoozed_until: null,
          snooze_reason: null,
          handled_at: null,
          handled_by_user_id: null,
          handled_reason: null,
          resolved_at: null,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        await createUrgentWatchEvent(client, {
          tenantId,
          itemId: inserted.rows[0].id,
          eventType: "watch.generated",
          summary: "Urgent Watch item created from a live source condition.",
          note: null,
            actorUserId: null,
            metadata: buildWatchHistoryMetadata(candidate)
          });
          continue;
        }
        existing = await loadUrgentWatchRowBySourceKey(client, tenantId, candidate);
        if (!existing) {
          throw new Error(`Urgent Watch candidate row missing after conflict-safe insert for ${key}`);
        }
        existingByKey.set(key, existing);
      }

    const snoozeIsActive = Boolean(existing.snoozed_until && new Date(existing.snoozed_until).getTime() > now);
    const fingerprintChanged = existing.source_fingerprint !== fingerprint;
    const shouldRemainHandled = existing.status === "handled" && !fingerprintChanged;
    const shouldRemainSnoozed = existing.status === "snoozed" && snoozeIsActive && !fingerprintChanged;
    const nextStatus: UrgentWatchStatus = shouldRemainHandled ? "handled" : shouldRemainSnoozed ? "snoozed" : "active";
    const shouldClearSnooze = nextStatus !== "snoozed";
    const shouldClearHandled = nextStatus !== "handled";
    const needsRowRefresh =
      fingerprintChanged ||
      existing.status !== nextStatus ||
      existing.source_entity_label !== candidate.source_entity_label ||
      existing.scope_department !== candidate.scope_department ||
      (!existing.owner_user_id && Boolean(candidate.owner_user_id));

    if (!needsRowRefresh) {
      unchangedSeenItemIds.push(existing.id);
      existingByKey.set(key, {
        ...existing,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      continue;
    }

    await client.query(
      `
        UPDATE urgent_watch_item
        SET source_entity_label = $3,
            scope_department = $4,
            severity = $5::urgent_watch_severity,
            title = $6,
            summary = $7,
            owner_user_id = COALESCE(owner_user_id, $8::uuid),
            due_at = $9::timestamptz,
            next_action_label = $10,
            action_hash = $11,
            operational_impact_score = $12,
            source_snapshot = $13::jsonb,
            source_fingerprint = $14,
            status = $15::urgent_watch_status,
            snoozed_until = CASE WHEN $16 THEN NULL ELSE snoozed_until END,
            snooze_reason = CASE WHEN $16 THEN NULL ELSE snooze_reason END,
            handled_at = CASE WHEN $17 THEN NULL ELSE handled_at END,
            handled_by_user_id = CASE WHEN $17 THEN NULL ELSE handled_by_user_id END,
            handled_reason = CASE WHEN $17 THEN NULL ELSE handled_reason END,
            resolved_at = NULL,
            last_seen_at = now(),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        tenantId,
        existing.id,
        candidate.source_entity_label,
        candidate.scope_department,
        candidate.severity,
        candidate.title,
        candidate.summary,
        candidate.owner_user_id,
        candidate.due_at,
        candidate.next_action_label,
        candidate.action_hash,
        candidate.operational_impact_score,
        JSON.stringify(candidate.source_snapshot ?? {}),
        fingerprint,
        nextStatus,
        shouldClearSnooze,
        shouldClearHandled
      ]
    );

    if (existing.status === "resolved") {
      await createUrgentWatchEvent(client, {
        tenantId,
        itemId: existing.id,
        eventType: "watch.reopened",
        summary: "Urgent Watch item reopened because the source condition returned.",
        note: null,
        actorUserId: null,
        metadata: buildWatchHistoryMetadata(candidate)
      });
    } else if (existing.status === "snoozed" && !shouldRemainSnoozed) {
      await createUrgentWatchEvent(client, {
        tenantId,
        itemId: existing.id,
        eventType: "watch.snooze_expired",
        summary: "Urgent Watch snooze expired and the item is active again.",
        note: null,
        actorUserId: null,
        metadata: {}
      });
    } else if (fingerprintChanged) {
      const reactivated = existing.status !== "active";
      await createUrgentWatchEvent(client, {
        tenantId,
        itemId: existing.id,
        eventType: reactivated ? "watch.reopened" : "watch.updated",
        summary: reactivated
          ? "Urgent Watch source details changed and the item was reactivated."
          : "Urgent Watch source details changed while the item stayed active.",
        note: null,
        actorUserId: null,
        metadata: buildWatchHistoryMetadata(candidate)
      });
    }
    existingByKey.set(key, {
      ...existing,
      source_entity_label: candidate.source_entity_label,
      scope_department: candidate.scope_department,
      severity: candidate.severity,
      title: candidate.title,
      summary: candidate.summary,
      owner_user_id: existing.owner_user_id ?? candidate.owner_user_id,
      due_at: candidate.due_at,
      next_action_label: candidate.next_action_label,
      action_hash: candidate.action_hash,
      operational_impact_score: candidate.operational_impact_score,
      source_snapshot: candidate.source_snapshot ?? {},
      source_fingerprint: fingerprint,
      status: nextStatus,
      snoozed_until: shouldClearSnooze ? null : existing.snoozed_until,
      snooze_reason: shouldClearSnooze ? null : existing.snooze_reason,
      handled_at: shouldClearHandled ? null : existing.handled_at,
      handled_by_user_id: shouldClearHandled ? null : existing.handled_by_user_id,
      handled_reason: shouldClearHandled ? null : existing.handled_reason
    });
  }

  await refreshUnchangedUrgentWatchItems(client, tenantId, unchangedSeenItemIds);
  await resolveClearedUrgentWatchItems(client, tenantId, [...seenKeys]);
}

async function refreshUnchangedUrgentWatchItems(client: PoolClient, tenantId: string, itemIds: string[]) {
  if (!itemIds.length) {
    return;
  }
  await client.query(
    `
      UPDATE urgent_watch_item
      SET last_seen_at = now()
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
        AND last_seen_at < now() - interval '15 minutes'
    `,
    [tenantId, itemIds]
  );
}

async function resolveClearedUrgentWatchItems(client: PoolClient, tenantId: string, activeSourceKeys: string[]) {
  await client.query(
    `
      WITH resolved AS (
        UPDATE urgent_watch_item item
        SET status = 'resolved',
            resolved_at = now(),
            updated_at = now()
        WHERE item.tenant_id = $1
          AND item.status <> 'resolved'::urgent_watch_status
          AND (
            item.source_module || ':' || item.source_entity_type || ':' || item.source_entity_id || ':' || item.watch_type
          ) <> ALL($2::text[])
        RETURNING
          item.id,
          item.source_module,
          item.watch_type,
          item.severity::text AS severity,
          item.due_at::text AS due_at,
          item.source_entity_label,
          item.source_snapshot
      )
      INSERT INTO urgent_watch_event (
        tenant_id,
        urgent_watch_item_id,
        event_type,
        summary,
        note,
        actor_user_id,
        metadata
      )
      SELECT
        $1,
        resolved.id,
        'watch.resolved',
        'Urgent Watch item resolved because the source condition cleared.',
        NULL,
        NULL::uuid,
        jsonb_build_object(
          'source_module', resolved.source_module,
          'watch_type', resolved.watch_type,
          'severity', resolved.severity,
          'due_at', resolved.due_at,
          'source_entity_label', resolved.source_entity_label,
          'reason_code',
            COALESCE(
              NULLIF(COALESCE(resolved.source_snapshot, '{}'::jsonb)->>'reason_code', ''),
              NULLIF(COALESCE(resolved.source_snapshot, '{}'::jsonb)->>'blocked_reason', ''),
              NULLIF(COALESCE(resolved.source_snapshot, '{}'::jsonb)->>'issue_type', ''),
              NULLIF(COALESCE(resolved.source_snapshot, '{}'::jsonb)->>'state', ''),
              NULLIF(COALESCE(resolved.source_snapshot, '{}'::jsonb)->>'alert_type', ''),
              resolved.watch_type
            )
        )
      FROM resolved
    `,
    [tenantId, activeSourceKeys]
  );
}

function buildProductionProjectUrgentWatchCandidates(facts: ProductionUrgentWatchFact[], anchorDate: string): UrgentWatchCandidate[] {
  const candidates: UrgentWatchCandidate[] = [];

  for (const fact of facts) {
    const project = fact.project;
    const gate = fact.workflow_gate;
    const dueAt = fact.due_at;
    const severity = project.overdue || project.due_within_24_hours || project.stage === "blocked" ? "red" : "yellow";

    if (project.stage === "blocked" || project.current_blocker || gate.blocked_task_count > 0) {
      candidates.push({
        source_module: "production",
        source_entity_type: "production_project",
        source_entity_id: project.id,
        source_entity_label: project.title,
        scope_department: "production",
        watch_type: "blocked_production_work",
        severity,
        title: `${project.title} is blocked`,
        summary:
          project.current_blocker?.reason ??
          gate.blocked_reasons[0] ??
          `${project.blocker_count || gate.blocked_task_count} task blocker${project.blocker_count === 1 ? "" : "s"} are preventing progress.`,
        owner_user_id: project.current_blocker?.blocker_owner_user_id ?? project.owner_user_id,
        owner_label: project.current_blocker?.blocker_owner_label ?? project.owner_label,
        due_at: dueAt,
        next_action_label: "Open Production",
        action_hash: fact.action_hash,
        operational_impact_score: 115 + gate.blocked_task_count * 10 + (project.overdue ? 20 : 0),
        source_snapshot: {
          project_id: project.id,
          stage: project.stage,
          blocker_count: project.blocker_count,
          blocked_task_count: gate.blocked_task_count,
          blocked_reasons: gate.blocked_reasons,
          exception_category: "production",
          exception_type: "blocked_production_work"
        }
      });
    }

    if (project.overdue || gate.overdue_task_count > 0) {
      candidates.push({
        source_module: "production",
        source_entity_type: "production_project",
        source_entity_id: project.id,
        source_entity_label: project.title,
        scope_department: "production",
        watch_type: "overdue_production_task",
        severity: "red",
        title: `${project.title} has overdue production work`,
        summary: `${project.overdue_task_count || gate.overdue_task_count} task deadline${project.overdue_task_count === 1 ? "" : "s"} are overdue and release is unsafe until they clear.`,
        owner_user_id: project.owner_user_id,
        owner_label: project.owner_label,
        due_at: dueAt,
        next_action_label: "Open Production",
        action_hash: fact.action_hash,
        operational_impact_score: 105 + (project.overdue_task_count || gate.overdue_task_count) * 12,
        source_snapshot: {
          project_id: project.id,
          stage: project.stage,
          overdue_task_count: project.overdue_task_count || gate.overdue_task_count,
          due_date: project.due_date,
          follow_up_date: project.follow_up_date,
          exception_category: "production",
          exception_type: "overdue_production_task"
        }
      });
    }

    if (isProductionProjectPeerReviewLag(project, anchorDate)) {
      candidates.push({
        source_module: "production",
        source_entity_type: "production_project",
        source_entity_id: project.id,
        source_entity_label: project.title,
        scope_department: "production",
        watch_type: "pending_peer_review",
        severity: project.overdue || project.stale_active ? "red" : "yellow",
        title: `${project.title} has been waiting on peer review too long`,
        summary: `${project.title} is still stuck behind peer review and is now stale or overdue.`,
        owner_user_id: project.peer_reviewer_user_id ?? project.owner_user_id,
        owner_label: project.peer_reviewer_label ?? project.owner_label,
        due_at: dueAt,
        next_action_label: "Open Production",
        action_hash: fact.action_hash,
        operational_impact_score: 92 + (project.stale_active ? 10 : 0) + (project.overdue ? 20 : 0),
        source_snapshot: {
          project_id: project.id,
          stage: project.stage,
          peer_review_required: project.peer_review_required,
          peer_reviewer_user_id: project.peer_reviewer_user_id,
          stale_active: project.stale_active,
          exception_category: "production",
          exception_type: "pending_peer_review"
        }
      });
    }

    if (isProductionProjectFinalQcLag(project, anchorDate)) {
      candidates.push({
        source_module: "production",
        source_entity_type: "production_project",
        source_entity_id: project.id,
        source_entity_label: project.title,
        scope_department: "production",
        watch_type: "final_qc_waiting",
        severity: project.overdue || project.stale_active ? "red" : "yellow",
        title: `${project.title} has been waiting on final QC too long`,
        summary: `${project.title} still has not cleared final QC and release remains blocked.`,
        owner_user_id: project.final_qc_reviewer_user_id ?? project.owner_user_id,
        owner_label: project.final_qc_reviewer_label ?? project.owner_label,
        due_at: dueAt,
        next_action_label: "Open Production",
        action_hash: fact.action_hash,
        operational_impact_score: 94 + (project.stale_active ? 10 : 0) + (project.overdue ? 20 : 0),
        source_snapshot: {
          project_id: project.id,
          stage: project.stage,
          final_qc_required: project.final_qc_required,
          final_qc_reviewer_user_id: project.final_qc_reviewer_user_id,
          stale_active: project.stale_active,
          exception_category: "production",
          exception_type: "final_qc_waiting"
        }
      });
    }

    if (isProductionProjectReleaseBlocked(project)) {
      candidates.push({
        source_module: "production",
        source_entity_type: "production_project",
        source_entity_id: project.id,
        source_entity_label: project.title,
        scope_department: "production",
        watch_type: "release_blocker",
        severity: project.overdue || gate.overdue_task_count > 0 ? "red" : "yellow",
        title: `${project.title} is waiting to send but still unsafe to release`,
        summary:
          gate.blocked_reasons[0] ??
          `${project.title} is in the release lane, but open blockers or required tasks are still preventing send.`,
        owner_user_id: project.final_qc_reviewer_user_id ?? project.owner_user_id,
        owner_label: project.final_qc_reviewer_label ?? project.owner_label,
        due_at: dueAt,
        next_action_label: "Open Production",
        action_hash: fact.action_hash,
        operational_impact_score: 98 + gate.overdue_task_count * 8 + (project.overdue ? 15 : 0),
        source_snapshot: {
          project_id: project.id,
          stage: project.stage,
          waiting_to_send: project.waiting_to_send,
          release_blocked: project.release_blocked,
          blocked_reasons: gate.blocked_reasons,
          exception_category: "production",
          exception_type: "release_blocker"
        }
      });
    }

    if (project.stale_active && !isProductionProjectBlocked(project) && !isProductionProjectOverdue(project, anchorDate)) {
      candidates.push({
        source_module: "production",
        source_entity_type: "production_project",
        source_entity_id: project.id,
        source_entity_label: project.title,
        scope_department: "production",
        watch_type: "stale_production_work",
        severity: "yellow",
        title: `${project.title} has gone stale in production`,
        summary: `${project.last_touched_label} and the job is still unfinished, so it is at risk of getting missed.`,
        owner_user_id: project.owner_user_id,
        owner_label: project.owner_label,
        due_at: dueAt,
        next_action_label: "Open Production",
        action_hash: fact.action_hash,
        operational_impact_score: 80 + (project.due_within_24_hours ? 10 : 0),
        source_snapshot: {
          project_id: project.id,
          stage: project.stage,
          stale_active: project.stale_active,
          last_touched_label: project.last_touched_label,
          exception_category: "production",
          exception_type: "stale_production_work"
        }
      });
    }
  }

  return candidates;
}

function isProductionProjectOverdue(fact: ProductionUrgentWatchFact["project"], anchorDate: string) {
  return (
    fact.status !== "completed" &&
    fact.status !== "canceled" &&
    (fact.overdue_task_count > 0 ||
      (fact.follow_up_date != null && fact.follow_up_date < anchorDate) ||
      (fact.follow_up_date == null && fact.due_date != null && fact.due_date < anchorDate))
  );
}

function isProductionProjectPeerReviewLag(fact: ProductionUrgentWatchFact["project"], anchorDate: string) {
  return !isProductionProjectClosed(fact) && isProductionProjectAwaitingPeerReview(fact) && (fact.stale_active || isProductionProjectOverdue(fact, anchorDate));
}

function isProductionProjectFinalQcLag(fact: ProductionUrgentWatchFact["project"], anchorDate: string) {
  return !isProductionProjectClosed(fact) && isProductionProjectAwaitingFinalQc(fact) && (fact.stale_active || isProductionProjectOverdue(fact, anchorDate));
}

function isProductionProjectReleaseBlocked(fact: ProductionUrgentWatchFact["project"]) {
  return !isProductionProjectClosed(fact) && fact.release_blocked && fact.waiting_to_send && !fact.pending_peer_review && !fact.pending_final_qc;
}

function isProductionProjectBlocked(fact: ProductionUrgentWatchFact["project"]) {
  return !isProductionProjectClosed(fact) && (fact.stage === "blocked" || fact.blocker_count > 0 || fact.blocked_task_count > 0);
}

function isProductionProjectAwaitingPeerReview(fact: ProductionUrgentWatchFact["project"]) {
  return !isProductionProjectClosed(fact) && (fact.pending_peer_review || fact.stage === "ready_for_qa" || fact.stage === "in_qa_review");
}

function isProductionProjectAwaitingFinalQc(fact: ProductionUrgentWatchFact["project"]) {
  return !isProductionProjectClosed(fact) && fact.final_qc_required && (fact.pending_final_qc || fact.stage === "ready_to_release");
}

function isProductionProjectClosed(fact: ProductionUrgentWatchFact["project"]) {
  return fact.status === "completed" || fact.status === "canceled";
}

async function loadVisibleUrgentWatchRows(
  client: PoolClient,
  auth: AuthUser,
  statuses: Set<UrgentWatchStatus>,
  anchorDate: string | null
) {
  const scope = assertCanViewUrgentWatch(auth);
  const values: unknown[] = [auth.tenantId, [...statuses]];
  let visibilityClause = "true";
  let dateClause = "";

  if (scope.level === "department") {
    values.push(auth.department, auth.id);
    visibilityClause = `(item.scope_department = $3 OR item.owner_user_id = $4::uuid)`;
  } else if (scope.level === "own") {
    values.push(auth.id);
    visibilityClause = "item.owner_user_id = $3::uuid";
  }

  if (anchorDate) {
    values.push(anchorDate);
    const dateParam = `$${values.length}`;
    dateClause = `
        AND (
          item.due_at IS NULL
          OR item.due_at::date BETWEEN ${dateParam}::date AND (${dateParam}::date + interval '30 days')::date
        )`;
  }

  const { rows } = await client.query<UrgentWatchRow>(
    `
      SELECT
        item.id,
        item.tenant_id,
        item.source_module,
        item.source_entity_type,
        item.source_entity_id,
        item.source_entity_label,
        item.scope_department,
        item.watch_type,
        item.status::text AS status,
        item.severity::text AS severity,
        item.title,
        item.summary,
        item.owner_user_id::text,
        owner.full_name AS owner_name,
        item.due_at::text,
        item.next_action_label,
        item.action_hash,
        item.operational_impact_score,
        item.source_snapshot,
        item.source_fingerprint,
        item.snoozed_until::text,
        item.snooze_reason,
        item.handled_at::text,
        item.handled_by_user_id::text,
        item.handled_reason,
        item.resolved_at::text,
        item.first_seen_at::text,
        item.last_seen_at::text,
        item.created_at::text,
        item.updated_at::text
      FROM urgent_watch_item item
      LEFT JOIN app_user owner
        ON owner.id = item.owner_user_id
      WHERE item.tenant_id = $1
        AND item.status = ANY($2::urgent_watch_status[])
        AND ${visibilityClause}
        ${dateClause}
    `,
    values
  );
  return rows;
}

function normalizeDateFilter(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

async function loadUrgentWatchRowsForTenant(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<UrgentWatchRow>(
    `
      SELECT
        item.id,
        item.tenant_id,
        item.source_module,
        item.source_entity_type,
        item.source_entity_id,
        item.source_entity_label,
        item.scope_department,
        item.watch_type,
        item.status::text AS status,
        item.severity::text AS severity,
        item.title,
        item.summary,
        item.owner_user_id::text,
        owner.full_name AS owner_name,
        item.due_at::text,
        item.next_action_label,
        item.action_hash,
        item.operational_impact_score,
        item.source_snapshot,
        item.source_fingerprint,
        item.snoozed_until::text,
        item.snooze_reason,
        item.handled_at::text,
        item.handled_by_user_id::text,
        item.handled_reason,
        item.resolved_at::text,
        item.first_seen_at::text,
        item.last_seen_at::text,
        item.created_at::text,
        item.updated_at::text
      FROM urgent_watch_item item
      LEFT JOIN app_user owner
        ON owner.id = item.owner_user_id
      WHERE item.tenant_id = $1
    `,
    [tenantId]
  );
  return rows;
}

async function loadUrgentWatchRowById(client: PoolClient, tenantId: string, itemId: string) {
  const { rows } = await client.query<UrgentWatchRow>(
    `
      SELECT
        item.id,
        item.tenant_id,
        item.source_module,
        item.source_entity_type,
        item.source_entity_id,
        item.source_entity_label,
        item.scope_department,
        item.watch_type,
        item.status::text AS status,
        item.severity::text AS severity,
        item.title,
        item.summary,
        item.owner_user_id::text,
        owner.full_name AS owner_name,
        item.due_at::text,
        item.next_action_label,
        item.action_hash,
        item.operational_impact_score,
        item.source_snapshot,
        item.source_fingerprint,
        item.snoozed_until::text,
        item.snooze_reason,
        item.handled_at::text,
        item.handled_by_user_id::text,
        item.handled_reason,
        item.resolved_at::text,
        item.first_seen_at::text,
        item.last_seen_at::text,
        item.created_at::text,
        item.updated_at::text
      FROM urgent_watch_item item
      LEFT JOIN app_user owner
        ON owner.id = item.owner_user_id
      WHERE item.tenant_id = $1
        AND item.id = $2
      LIMIT 1
    `,
    [tenantId, itemId]
  );
  return rows[0] ?? null;
}

async function loadUrgentWatchRowBySourceKey(
  client: PoolClient,
  tenantId: string,
  source: Pick<UrgentWatchCandidate, "source_module" | "source_entity_type" | "source_entity_id" | "watch_type">
) {
  const { rows } = await client.query<UrgentWatchRow>(
    `
      SELECT
        item.id,
        item.tenant_id,
        item.source_module,
        item.source_entity_type,
        item.source_entity_id,
        item.source_entity_label,
        item.scope_department,
        item.watch_type,
        item.status::text AS status,
        item.severity::text AS severity,
        item.title,
        item.summary,
        item.owner_user_id::text,
        owner.full_name AS owner_name,
        item.due_at::text,
        item.next_action_label,
        item.action_hash,
        item.operational_impact_score,
        item.source_snapshot,
        item.source_fingerprint,
        item.snoozed_until::text,
        item.snooze_reason,
        item.handled_at::text,
        item.handled_by_user_id::text,
        item.handled_reason,
        item.resolved_at::text,
        item.first_seen_at::text,
        item.last_seen_at::text,
        item.created_at::text,
        item.updated_at::text
      FROM urgent_watch_item item
      LEFT JOIN app_user owner
        ON owner.id = item.owner_user_id
      WHERE item.tenant_id = $1
        AND item.source_module = $2
        AND item.source_entity_type = $3
        AND item.source_entity_id = $4
        AND item.watch_type = $5
      LIMIT 1
    `,
    [tenantId, source.source_module, source.source_entity_type, source.source_entity_id, source.watch_type]
  );
  return rows[0] ?? null;
}

async function loadUrgentWatchEvents(client: PoolClient, tenantId: string, itemId: string): Promise<UrgentWatchEventRecord[]> {
  const { rows } = await client.query<UrgentWatchEventRow>(
    `
      SELECT
        event.id,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id::text,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text
      FROM urgent_watch_event event
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.urgent_watch_item_id = $2
      ORDER BY event.created_at DESC
    `,
    [tenantId, itemId]
  );
  return rows.map((row) => ({
    id: row.id,
    event_type: row.event_type,
    summary: row.summary,
    note: row.note ?? null,
    actor_user_id: row.actor_user_id ?? null,
    actor_name: row.actor_name ?? null,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

async function listUrgentWatchOwnerOptions(
  client: PoolClient,
  auth: AuthUser,
  scope: UrgentWatchScope
): Promise<UrgentWatchOwnerOption[]> {
  const values: unknown[] = [auth.tenantId];
  let where = "tenant_id = $1 AND status = 'active'";

  if (scope.level === "department" && auth.department) {
    values.push(auth.department);
    where += ` AND department = $${values.length}`;
  }

  const { rows } = await client.query<{
    id: string;
    full_name: string;
    email: string | null;
    department: string | null;
  }>(
    `
      SELECT id, full_name, email, department::text AS department
      FROM app_user
      WHERE ${where}
      ORDER BY full_name ASC
      LIMIT 100
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    label: row.full_name,
    detail: [row.department ? humanizeLabel(row.department) : null, row.email].filter(Boolean).join(" | ") || null
  }));
}

async function createUrgentWatchEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    itemId: string;
    eventType: string;
    summary: string;
    note: string | null;
    actorUserId: string | null;
    metadata: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO urgent_watch_event (
        tenant_id,
        urgent_watch_item_id,
        event_type,
        summary,
        note,
        actor_user_id,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6::uuid,$7::jsonb)
    `,
    [input.tenantId, input.itemId, input.eventType, input.summary, input.note, input.actorUserId, JSON.stringify(input.metadata ?? {})]
  );
}

function assertCanViewUrgentWatch(auth: AuthUser) {
  const scope = getOperatingSystemQueryScope(auth, "exceptions");
  if (scope.level === "none") {
    throw new ApiError(403, "You do not have access to the exception center.");
  }
  return scope as UrgentWatchScope;
}

function canManageUrgentWatch(auth: AuthUser) {
  return canManageOperatingSystemModule(auth, "exceptions");
}

function canUserSeeUrgentWatchRow(row: UrgentWatchRow, auth: AuthUser, scope: UrgentWatchScope) {
  if (scope.level === "all") {
    return true;
  }
  if (scope.level === "department") {
    return row.scope_department === auth.department || row.owner_user_id === auth.id;
  }
  return row.owner_user_id === auth.id;
}

function mapUrgentWatchListItem(row: UrgentWatchRow): UrgentWatchListItem {
  const timing = deriveTimingState(row.due_at);
  return {
    id: row.id,
    source_module: row.source_module as UrgentWatchListItem["source_module"],
    source_module_label: humanizeLabel(row.source_module),
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    source_entity_label: row.source_entity_label,
    scope_department: row.scope_department,
    watch_type: row.watch_type as UrgentWatchListItem["watch_type"],
    watch_type_label: humanizeLabel(row.watch_type),
    status: row.status,
    severity: row.severity,
    severity_label: row.severity === "red" ? "Red" : "Yellow",
    title: row.title,
    summary: row.summary,
    owner_user_id: row.owner_user_id,
    owner_label: row.owner_name ?? "Needs owner",
    due_at: row.due_at,
    due_label: row.due_at ? new Date(row.due_at).toLocaleString() : null,
    timing_state: timing.state,
    timing_label: timing.label,
    next_action_label: row.next_action_label,
    action_hash: row.action_hash,
    operational_impact_score: Number(row.operational_impact_score ?? 0),
    snoozed_until: row.snoozed_until,
    status_detail: buildStatusDetail(row),
    source_snapshot: row.source_snapshot ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function buildUrgentWatchWorkspaceSummary(items: UrgentWatchListItem[]): UrgentWatchWorkspace["summary"] {
  const activeItems = items.filter((item) => item.status === "active");
  return {
    active_count: activeItems.length,
    red_count: activeItems.filter((item) => item.severity === "red").length,
    yellow_count: activeItems.filter((item) => item.severity === "yellow").length,
    overdue_count: activeItems.filter((item) => item.timing_state === "overdue").length,
    snoozed_count: items.filter((item) => item.status === "snoozed").length
  };
}

export function buildUrgentWatchHomeReadySummary(items: UrgentWatchListItem[]): UrgentWatchWorkspace["home_ready_summary"] {
  const activeItems = items.filter((item) => item.status === "active");
  const visibleItems = activeItems.sort(compareUrgentWatchItems).slice(0, 5);
  const redCount = activeItems.filter((item) => item.severity === "red").length;
  const totalActive = activeItems.length;
  return {
    visible: totalActive > 0,
    tone: redCount > 0 ? "action_needed" : totalActive > 0 ? "heads_up" : "neutral",
    summary_line:
      totalActive === 0
        ? "No red or yellow watch items are active right now."
        : redCount > 0
          ? `${redCount} red watch item${redCount === 1 ? "" : "s"} need action now.`
          : `${totalActive} yellow watch item${totalActive === 1 ? "" : "s"} need follow-through.`,
    urgent_count: totalActive,
    items: visibleItems
  };
}

export function buildOperationalExceptionWorkspaceSummary(items: OperationalExceptionListItem[]): OperationalExceptionWorkspace["summary"] {
  const openItems = items.filter((item) => item.status === "open");
  return {
    open_count: openItems.length,
    blocking_count: openItems.filter((item) => item.severity === "blocking").length,
    at_risk_count: openItems.filter((item) => item.severity === "at_risk").length,
    warning_count: openItems.filter((item) => item.severity === "warning").length,
    overdue_count: openItems.filter((item) => item.timing_state === "overdue").length,
    snoozed_count: items.filter((item) => item.status === "snoozed").length
  };
}

export function buildOperationalExceptionHomeReadySummary(items: OperationalExceptionListItem[]): OperationalExceptionWorkspace["home_ready_summary"] {
  const openItems = items.filter((item) => item.status === "open");
  const visibleItems = openItems.sort(compareOperationalExceptionItems).slice(0, 5);
  const blockingCount = openItems.filter((item) => item.severity === "blocking").length;
  const totalOpen = openItems.length;
  return {
    visible: totalOpen > 0,
    tone: blockingCount > 0 ? "action_needed" : totalOpen > 0 ? "heads_up" : "neutral",
    summary_line:
      totalOpen === 0
        ? "No open exceptions need operator action right now."
        : blockingCount > 0
          ? `${blockingCount} blocking exception${blockingCount === 1 ? " needs" : "s need"} action now.`
          : `${totalOpen} open exception${totalOpen === 1 ? " needs" : "s need"} follow-through.`,
    urgent_count: totalOpen,
    items: visibleItems
  };
}

function mapOperationalExceptionOwnerOption(option: UrgentWatchOwnerOption): OperationalExceptionOwnerOption {
  return option;
}

function mapOperationalExceptionEventRecord(event: UrgentWatchEventRecord): OperationalExceptionEventRecord {
  return {
    ...event,
    summary: event.summary.replace(/Urgent Watch/gi, "Exception")
  };
}

function mapOperationalExceptionListItem(item: UrgentWatchListItem): OperationalExceptionListItem {
  const category = resolveOperationalExceptionCategory(item);
  const severity = resolveOperationalExceptionSeverity(item, category);
  const blocking = severity === "blocking";
  const sourceSnapshot = item.source_snapshot ?? {};
  const workflowRunId = typeof sourceSnapshot.workflow_run_id === "string" ? sourceSnapshot.workflow_run_id : null;
  const assignedTeamId = typeof sourceSnapshot.assigned_team_id === "string" ? sourceSnapshot.assigned_team_id : null;
  const status = mapOperationalExceptionStatus(item.status);

  return {
    id: item.id,
    entity_type: item.source_entity_type,
    entity_id: item.source_entity_id,
    workflow_run_id: workflowRunId,
    category,
    type: resolveOperationalExceptionType(item),
    severity,
    severity_label: formatOperationalExceptionSeverityLabel(severity),
    blocking,
    status,
    owner_user_id: item.owner_user_id,
    owner_label: item.owner_label,
    assigned_team_id: assignedTeamId,
    source_module: item.source_module as OperationalExceptionListItem["source_module"],
    source_module_label: item.source_module_label,
    source_entity_label: item.source_entity_label,
    scope_department: item.scope_department,
    title: item.title,
    summary: item.summary,
    due_at: item.due_at,
    due_label: item.due_label,
    timing_state: item.timing_state,
    timing_label: item.timing_label,
    next_action_label: item.next_action_label,
    action_hash: item.action_hash,
    operational_impact_score: item.operational_impact_score,
    snoozed_until: item.snoozed_until,
    status_detail: item.status_detail,
    resolution_note: status === "handled" || status === "resolved" ? item.status_detail : null,
    source_snapshot: sourceSnapshot,
    created_at: item.created_at,
    updated_at: item.updated_at,
    resolved_at: status === "resolved" ? item.updated_at : null
  };
}

function buildStatusDetail(row: UrgentWatchRow) {
  if (row.status === "snoozed" && row.snoozed_until) {
    return `Snoozed until ${new Date(row.snoozed_until).toLocaleString()}${row.snooze_reason ? ` | ${row.snooze_reason}` : ""}`;
  }
  if (row.status === "handled" && row.handled_at) {
    return `Handled ${new Date(row.handled_at).toLocaleString()}${row.handled_reason ? ` | ${row.handled_reason}` : ""}`;
  }
  return null;
}

function compareUrgentWatchItems(left: UrgentWatchListItem, right: UrgentWatchListItem) {
  if (left.status !== right.status) {
    return statusRank(left.status) - statusRank(right.status);
  }
  const now = Date.now();
  const leftDue = left.due_at ? new Date(left.due_at).getTime() : null;
  const rightDue = right.due_at ? new Date(right.due_at).getTime() : null;
  const leftOverdue = leftDue !== null && leftDue < now ? now - leftDue : null;
  const rightOverdue = rightDue !== null && rightDue < now ? now - rightDue : null;

  if (leftOverdue !== null || rightOverdue !== null) {
    if (leftOverdue === null) {
      return 1;
    }
    if (rightOverdue === null) {
      return -1;
    }
    if (rightOverdue !== leftOverdue) {
      return rightOverdue - leftOverdue;
    }
  }

  if (leftDue !== null || rightDue !== null) {
    if (leftDue === null) {
      return 1;
    }
    if (rightDue === null) {
      return -1;
    }
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }
  }

  if (right.operational_impact_score !== left.operational_impact_score) {
    return right.operational_impact_score - left.operational_impact_score;
  }
  return left.title.localeCompare(right.title);
}

function compareOperationalExceptionItems(left: OperationalExceptionListItem, right: OperationalExceptionListItem) {
  if (left.status !== right.status) {
    return operationalExceptionStatusRank(left.status) - operationalExceptionStatusRank(right.status);
  }

  if (left.severity !== right.severity) {
    return operationalExceptionSeverityRank(left.severity) - operationalExceptionSeverityRank(right.severity);
  }

  const now = Date.now();
  const leftDue = left.due_at ? new Date(left.due_at).getTime() : null;
  const rightDue = right.due_at ? new Date(right.due_at).getTime() : null;
  const leftOverdue = leftDue !== null && leftDue < now ? now - leftDue : null;
  const rightOverdue = rightDue !== null && rightDue < now ? now - rightDue : null;

  if (leftOverdue !== null || rightOverdue !== null) {
    if (leftOverdue === null) {
      return 1;
    }
    if (rightOverdue === null) {
      return -1;
    }
    if (rightOverdue !== leftOverdue) {
      return rightOverdue - leftOverdue;
    }
  }

  if (leftDue !== null || rightDue !== null) {
    if (leftDue === null) {
      return 1;
    }
    if (rightDue === null) {
      return -1;
    }
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }
  }

  if (right.operational_impact_score !== left.operational_impact_score) {
    return right.operational_impact_score - left.operational_impact_score;
  }

  return left.title.localeCompare(right.title);
}

function mapOperationalExceptionStatus(status: UrgentWatchStatus): OperationalExceptionStatus {
  switch (status) {
    case "active":
      return "open";
    case "snoozed":
      return "snoozed";
    case "handled":
      return "handled";
    case "resolved":
      return "resolved";
    default:
      return "open";
  }
}

function resolveOperationalExceptionType(item: Pick<UrgentWatchListItem, "watch_type" | "source_snapshot">) {
  const explicitType = item.source_snapshot?.exception_type;
  return typeof explicitType === "string" && explicitType.trim().length > 0 ? explicitType.trim() : item.watch_type;
}

function resolveOperationalExceptionCategory(
  item: Pick<UrgentWatchListItem, "source_module" | "watch_type" | "source_snapshot">
): OperationalExceptionCategory {
  const explicitCategory = item.source_snapshot?.exception_category;
  if (typeof explicitCategory === "string") {
    if (explicitCategory === "staffing") return "staffing";
    if (explicitCategory === "approval") return "approval";
    if (explicitCategory === "acknowledgement") return "acknowledgement";
    if (explicitCategory === "handoff") return "handoff";
    if (explicitCategory === "sync") return "sync";
    if (explicitCategory === "data") return "data";
    if (explicitCategory === "files") return "files";
    if (explicitCategory === "production") return "production";
    if (explicitCategory === "schedule") return "schedule";
    if (explicitCategory === "delivery") return "delivery";
  }

  switch (item.watch_type) {
    case "staffing_gap":
    case "critical_role_gap":
    case "replacement_needed":
    case "attendance_failure_staffing_risk":
      return "staffing";
    case "unconfirmed_shoot":
      return "schedule";
    case "missing_contact_info":
      return "data";
    case "approval_blocker":
      return "approval";
    case "missing_acknowledgement":
      return "acknowledgement";
    case "production_intake_issue":
      return "sync";
    case "release_blocker":
      return "handoff";
    case "overdue_production_task":
    case "blocked_production_work":
    case "pending_peer_review":
    case "final_qc_waiting":
    case "stale_production_work":
      return "production";
    default:
      switch (item.source_module) {
        case "approvals":
          return "approval";
        case "workflow":
          return "acknowledgement";
        case "scheduling":
          return "schedule";
        case "attendance":
          return "staffing";
        default:
          return "production";
      }
  }
}

function resolveOperationalExceptionSeverity(
  item: Pick<UrgentWatchListItem, "watch_type" | "severity" | "timing_state">,
  category: OperationalExceptionCategory
): OperationalExceptionSeverity {
  const hardBlockingTypes = new Set([
    "blocked_production_work",
    "approval_blocker",
    "release_blocker",
    "critical_role_gap",
    "replacement_needed",
    "missing_acknowledgement"
  ]);

  if (hardBlockingTypes.has(item.watch_type) && (item.severity === "red" || item.timing_state === "overdue")) {
    return "blocking";
  }
  if (category === "approval" && item.severity === "red") {
    return "blocking";
  }
  if (item.severity === "red" || item.timing_state === "overdue" || item.timing_state === "due_within_24h") {
    return "at_risk";
  }
  return "warning";
}

function operationalExceptionStatusRank(status: OperationalExceptionStatus) {
  switch (status) {
    case "open":
      return 0;
    case "snoozed":
      return 1;
    case "handled":
      return 2;
    case "resolved":
      return 3;
    default:
      return 4;
  }
}

function operationalExceptionSeverityRank(severity: OperationalExceptionSeverity) {
  switch (severity) {
    case "blocking":
      return 0;
    case "at_risk":
      return 1;
    case "warning":
      return 2;
    default:
      return 3;
  }
}

function formatOperationalExceptionSeverityLabel(severity: OperationalExceptionSeverity) {
  switch (severity) {
    case "blocking":
      return "Blocking";
    case "at_risk":
      return "At Risk";
    case "warning":
      return "Warning";
    default:
      return humanizeLabel(severity);
  }
}

function listProductionIntakeUrgentWatchCandidates(
  summary: Awaited<ReturnType<typeof synchronizeProductionIntake>> | null
): UrgentWatchCandidate[] {
  if (!summary) {
    return [];
  }

  return summary.issues.slice(0, 4).map((issue) => ({
    source_module: "production",
    source_entity_type: "production_intake_issue",
    source_entity_id: issue.id,
    source_entity_label: issue.linked_project_title ?? issue.title,
    scope_department: "production",
    watch_type: "production_intake_issue",
    severity: issue.tone === "critical" ? "red" : "yellow",
    title: issue.title,
    summary: issue.summary,
    owner_user_id: null,
    owner_label: null,
    due_at: null,
    next_action_label: "Open Production",
    action_hash: issue.linked_project_id ? `#production?project=${issue.linked_project_id}` : "#production",
    operational_impact_score:
      issue.tone === "critical"
        ? issue.issue_kind === "sync_failed" || issue.issue_kind === "backfill_failed"
          ? 118
          : 108
        : issue.issue_kind === "sync_stale"
          ? 82
          : 76,
    source_snapshot: {
      reason_code: issue.issue_kind,
      linked_project_id: issue.linked_project_id,
      linked_project_title: issue.linked_project_title,
      source_label: issue.source_label,
      source_system_label: issue.source_system_label,
      source_reference: issue.source_reference,
      issue_action_hash: issue.action_hash,
      issue_last_seen_at: issue.last_seen_at
    }
  }));
}

async function listWorkflowAcknowledgementUrgentWatchCandidates(client: PoolClient, tenantId: string): Promise<UrgentWatchCandidate[]> {
  const { rows } = await client.query<{
    acknowledgement_id: string;
    workflow_run_id: string;
    work_task_id: string | null;
    requested_user_id: string | null;
    requested_user_name: string | null;
    assigned_team_id: string | null;
    department_type: string | null;
    job_id: string | null;
    job_title: string | null;
    task_title: string | null;
    due_at: string | null;
    requested_at: string;
  }>(
    `
      SELECT
        acknowledgement.id::text AS acknowledgement_id,
        acknowledgement.workflow_run_id::text,
        acknowledgement.work_task_id::text,
        acknowledgement.requested_user_id::text,
        requested_user.full_name AS requested_user_name,
        task.assigned_team_id::text,
        job.department_type::text AS department_type,
        job.id::text AS job_id,
        job.title AS job_title,
        task.title AS task_title,
        task.due_at::text,
        acknowledgement.requested_at::text
      FROM workflow_run_acknowledgement acknowledgement
      JOIN workflow_run workflow_run
        ON workflow_run.tenant_id = acknowledgement.tenant_id
       AND workflow_run.id = acknowledgement.workflow_run_id
      JOIN jobs job
        ON job.tenant_id = workflow_run.tenant_id
       AND job.id = workflow_run.job_id
      LEFT JOIN work_task task
        ON task.tenant_id = acknowledgement.tenant_id
       AND task.id = acknowledgement.work_task_id
      LEFT JOIN app_user requested_user
        ON requested_user.id = acknowledgement.requested_user_id
      WHERE acknowledgement.tenant_id = $1
        AND acknowledgement.status = 'pending'::shared_workflow_ack_status_type
      ORDER BY acknowledgement.requested_at DESC
      LIMIT 50
    `,
    [tenantId]
  );

  return rows.map((row) => ({
    source_module: "workflow",
    source_entity_type: "workflow_acknowledgement",
    source_entity_id: row.acknowledgement_id,
    source_entity_label: row.task_title ?? row.job_title,
    scope_department: row.department_type,
    watch_type: "missing_acknowledgement",
    severity: row.due_at && new Date(row.due_at).getTime() < Date.now() ? "red" : "yellow",
    title: row.task_title ? `${row.task_title} is still waiting on acknowledgement` : "Workflow acknowledgement still pending",
    summary: row.task_title
      ? `${row.task_title} has not been acknowledged yet and still needs an owner response.`
      : `${row.job_title ?? "Workflow task"} still has a required acknowledgement pending.`,
    owner_user_id: row.requested_user_id,
    owner_label: row.requested_user_name,
    due_at: row.due_at ?? row.requested_at,
    next_action_label: row.work_task_id ? "Open Task" : "Open Job",
    action_hash: row.work_task_id
      ? `#tasks/${row.work_task_id}`
      : row.job_id
        ? `#jobs/${row.job_id}`
        : "#my-work",
    operational_impact_score: row.due_at && new Date(row.due_at).getTime() < Date.now() ? 108 : 82,
    source_snapshot: {
      workflow_run_id: row.workflow_run_id,
      work_task_id: row.work_task_id,
      assigned_team_id: row.assigned_team_id,
      job_id: row.job_id,
      requested_user_id: row.requested_user_id,
      requested_at: row.requested_at,
      exception_category: "acknowledgement",
      exception_type: "missing_acknowledgement"
    }
  }));
}

async function listMicrosoftCalendarSyncUrgentWatchCandidates(client: PoolClient, tenantId: string): Promise<UrgentWatchCandidate[]> {
  const { rows } = await client.query<{
    sync_key: string;
    resource_type: string | null;
    resource_id: string | null;
    status: "healthy" | "warning" | "error";
    last_failure_at: string | null;
    failure_count: number;
    last_error_code: string | null;
    last_error_message: string | null;
    metadata_json: Record<string, unknown> | null;
  }>(
    `
      SELECT
        sync_key,
        resource_type,
        resource_id,
        status::text,
        last_failure_at::text,
        failure_count,
        last_error_code,
        last_error_message,
        metadata_json
      FROM sync_health_records
      WHERE tenant_id = $1
        AND status <> 'healthy'::sync_health_status_type
        AND sync_key IN ('microsoft_graph_calendar_webhook', 'microsoft_graph_calendar_subscription')
      ORDER BY updated_at DESC
      LIMIT 10
    `,
    [tenantId]
  );

  return rows.map((row) => {
    const metadata = row.metadata_json ?? {};
    const retryState =
      typeof metadata.retry_state === "string" && metadata.retry_state.trim().length > 0 ? metadata.retry_state.trim() : null;
    const lifecycleEvent =
      typeof metadata.lifecycle_event === "string" && metadata.lifecycle_event.trim().length > 0
        ? metadata.lifecycle_event.trim()
        : null;
    const resourceLabel =
      typeof metadata.resource === "string" && metadata.resource.trim().length > 0 ? metadata.resource.trim() : row.sync_key;
    const summary =
      row.last_error_message ??
      (lifecycleEvent
        ? `Microsoft Graph reported ${lifecycleEvent} for the calendar subscription and it needs attention.`
        : "Microsoft Graph calendar sync needs attention.");

    return {
      source_module: "scheduling",
      source_entity_type: row.resource_type ?? "microsoft_graph_sync",
      source_entity_id: row.resource_id ?? row.sync_key,
      source_entity_label: resourceLabel,
      scope_department: null,
      watch_type: "calendar_sync_attention",
      severity: row.status === "error" ? "red" : "yellow",
      title:
        row.sync_key === "microsoft_graph_calendar_subscription"
          ? "Microsoft calendar subscription needs attention"
          : "Microsoft calendar webhook health needs attention",
      summary,
      owner_user_id: null,
      owner_label: null,
      due_at: row.last_failure_at,
      next_action_label: "Open Integrations",
      action_hash: "#admin/integrations",
      operational_impact_score: row.status === "error" ? 118 + row.failure_count * 2 : 88 + row.failure_count * 2,
      source_snapshot: {
        sync_key: row.sync_key,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        failure_count: row.failure_count,
        last_error_code: row.last_error_code,
        last_error_message: row.last_error_message,
        retry_state: retryState,
        lifecycle_event: lifecycleEvent,
        exception_category: "sync",
        exception_type: "calendar_sync_attention"
      }
    } satisfies UrgentWatchCandidate;
  });
}

function deriveTimingState(dueAt: string | null) {
  if (!dueAt) {
    return {
      state: "unscheduled" as const,
      label: "No due time"
    };
  }
  const dueMs = new Date(dueAt).getTime();
  const now = Date.now();
  if (dueMs < now) {
    return {
      state: "overdue" as const,
      label: `Overdue by ${formatRelativeMinutes(Math.max(Math.round((now - dueMs) / 60000), 1))}`
    };
  }
  const remainingMinutes = Math.max(Math.round((dueMs - now) / 60000), 1);
  if (dueMs <= now + 24 * 60 * 60 * 1000) {
    return {
      state: "due_within_24h" as const,
      label: `Due in ${formatRelativeMinutes(remainingMinutes)}`
    };
  }
  return {
    state: "at_risk" as const,
    label: `At risk in ${formatRelativeMinutes(remainingMinutes)}`
  };
}

function buildCandidateFingerprint(candidate: UrgentWatchCandidate) {
  return createHash("sha1")
    .update(
      JSON.stringify({
        source_module: candidate.source_module,
        source_entity_type: candidate.source_entity_type,
        source_entity_id: candidate.source_entity_id,
        watch_type: candidate.watch_type,
        severity: candidate.severity,
        title: candidate.title,
        summary: candidate.summary,
        owner_user_id: candidate.owner_user_id,
        due_at: candidate.due_at,
        next_action_label: candidate.next_action_label,
        action_hash: candidate.action_hash,
        operational_impact_score: candidate.operational_impact_score,
        source_snapshot: candidate.source_snapshot
      })
    )
    .digest("hex");
}

function buildWatchHistoryMetadata(candidate: UrgentWatchCandidate) {
  return {
    source_module: candidate.source_module,
    watch_type: candidate.watch_type,
    severity: candidate.severity,
    due_at: candidate.due_at,
    source_entity_label: candidate.source_entity_label,
    reason_code: extractWatchReasonCode(candidate.source_snapshot, candidate.watch_type)
  };
}

function buildWatchResolutionMetadata(row: Pick<UrgentWatchRow, "source_module" | "watch_type" | "severity" | "due_at" | "source_entity_label" | "source_snapshot">) {
  return {
    source_module: row.source_module,
    watch_type: row.watch_type,
    severity: row.severity,
    due_at: row.due_at,
    source_entity_label: row.source_entity_label,
    reason_code: extractWatchReasonCode(row.source_snapshot ?? {}, row.watch_type)
  };
}

function extractWatchReasonCode(sourceSnapshot: Record<string, unknown> | null | undefined, fallback: string) {
  for (const key of ["reason_code", "blocked_reason", "issue_type", "state", "alert_type"]) {
    const value = sourceSnapshot?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
}

function buildSourceKey(
  value:
    | Pick<UrgentWatchCandidate, "source_module" | "source_entity_type" | "source_entity_id" | "watch_type">
    | Pick<UrgentWatchRow, "source_module" | "source_entity_type" | "source_entity_id" | "watch_type">
) {
  return `${value.source_module}:${value.source_entity_type}:${value.source_entity_id}:${value.watch_type}`;
}

function statusRank(status: UrgentWatchStatus) {
  switch (status) {
    case "active":
      return 0;
    case "snoozed":
      return 1;
    case "handled":
      return 2;
    case "resolved":
      return 3;
    default:
      return 4;
  }
}

function humanizeLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRelativeMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatDurationLabel(minutes: number) {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(minutes / 60);
  if (minutes % 60 === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours}h ${minutes % 60}m`;
}
