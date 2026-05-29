import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import type { ManagerCockpitFlag, ManagerCockpitQueueItem } from "../types/managerCockpit.js";
import type {
  DirectoryDuplicateReviewRecord,
  DirectoryTouchpointRecord,
  OrganizationDetail,
  OrganizationOperationsHealthCue,
  OrganizationOperationsHub,
  OrganizationOperationsQueueItem,
  OrganizationOperationsTone,
  OrganizationOperationsTimelineItem
} from "../types/organizations.js";
import { getOrganizationDetail, listDirectoryDuplicateReviews, listOrganizationTouchpoints } from "./organizations.js";

type OrganizationOperationsSnapshotRow = {
  organization_id: string;
  organization_display_name: string;
  account_type: string;
  active_status: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  last_touch_id: string | null;
  last_touch_contact_id: string | null;
  last_touch_at: string | null;
  last_touch_summary: string | null;
  last_touch_owner_name: string | null;
  next_follow_up_touchpoint_id: string | null;
  next_follow_up_contact_id: string | null;
  next_follow_up_date: string | null;
  next_follow_up_summary: string | null;
  next_follow_up_owner_name: string | null;
  upcoming_shoot_id: string | null;
  upcoming_shoot_title: string | null;
  upcoming_shoot_date: string | null;
  upcoming_shoot_location_name: string | null;
  active_contact_count: number;
  incomplete_contact_count: number;
  active_location_count: number;
  location_without_contact_count: number;
  open_duplicate_count: number;
  open_duplicate_review_id: string | null;
  open_duplicate_summary: string | null;
  open_duplicate_created_at: string | null;
};

type DirectoryOperationsQueues = {
  contact_cleanup: ManagerCockpitQueueItem[];
  follow_up: ManagerCockpitQueueItem[];
};

type OrganizationLinkedProjectRow = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  priority: string;
  owner_name: string | null;
  due_date: string | null;
  follow_up_date: string | null;
  created_reason: string;
  source_trigger_label: string | null;
  linked_location_id: string | null;
  linked_shoot_id: string | null;
  overdue_task_count: number;
  open_task_count: number;
};

type OrganizationProjectEventRow = {
  id: string;
  project_id: string;
  project_title: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_name: string | null;
  created_at: string;
  linked_location_id: string | null;
  linked_shoot_id: string | null;
};

export async function getDirectoryOperationsQueues(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate?: string | null } = {}
): Promise<DirectoryOperationsQueues> {
  const anchorDate = options.anchorDate ?? getLocalDateString();
  const snapshots = await loadOrganizationOperationsSnapshots(client, auth.tenantId, anchorDate);

  return {
    contact_cleanup: snapshots
      .map((snapshot) => buildContactCleanupQueueItem(snapshot))
      .filter((item): item is ManagerCockpitQueueItem => Boolean(item))
      .sort(compareManagerQueueItems),
    follow_up: snapshots
      .map((snapshot) => buildFollowUpQueueItem(snapshot, anchorDate))
      .filter((item): item is ManagerCockpitQueueItem => Boolean(item))
      .sort(compareManagerQueueItems)
  };
}

export async function getOrganizationOperationsHub(
  client: PoolClient,
  auth: AuthUser,
  organizationId: string,
  options: { anchorDate?: string | null } = {}
): Promise<OrganizationOperationsHub> {
  const anchorDate = options.anchorDate ?? getLocalDateString();
  const detail = await getOrganizationDetail(client, auth, organizationId);
  if (!detail) {
    throw new ApiError(404, "Organization not found");
  }

  const [touchpointPayload, duplicateReviewPayload, snapshot, linkedProjects, projectEvents] = await Promise.all([
    listOrganizationTouchpoints(client, auth, organizationId),
    listDirectoryDuplicateReviews(client, auth),
    loadOrganizationOperationsSnapshot(client, auth.tenantId, organizationId, anchorDate),
    loadOrganizationLinkedProjects(client, auth.tenantId, organizationId, anchorDate),
    loadOrganizationProjectEvents(client, auth.tenantId, organizationId)
  ]);

  const touchpoints = [...touchpointPayload.touchpoints].sort(compareOccurredAtDesc);
  const organizationContactIds = new Set(detail.contacts.map((contact) => contact.id));
  const duplicateReviews = duplicateReviewPayload.reviews.filter(
    (review) =>
      (review.primary_contact_id && organizationContactIds.has(review.primary_contact_id)) ||
      (review.suspected_duplicate_contact_id && organizationContactIds.has(review.suspected_duplicate_contact_id))
  );

  const healthCues = buildOrganizationHealthCues(detail, snapshot, duplicateReviews, anchorDate);
  const relationshipHealthState = getRelationshipHealthState(healthCues);
  const followUpQueueItems = buildOrganizationFollowUpQueueItems(detail, snapshot, touchpoints, anchorDate);
  const duplicateQueueItems = buildOrganizationDuplicateQueueItems(detail, duplicateReviews);
  const contactCleanupItem = buildOrganizationContactCleanupQueueItem(detail, snapshot);
  const projectQueueItems = buildOrganizationProjectQueueItems(linkedProjects, anchorDate);
  const lastTouch = touchpoints[0] ?? null;
  const lastTouchLabel = lastTouch
    ? `${formatDateTimeLabel(lastTouch.occurred_at)}${lastTouch.owner_name ? ` by ${lastTouch.owner_name}` : ""}`
    : "No touchpoint logged yet";
  const nextFollowUpItem = followUpQueueItems[0] ?? null;
  const ownerLabel =
    nextFollowUpItem?.owner_label ||
    snapshot?.next_follow_up_owner_name ||
    lastTouch?.owner_name ||
    snapshot?.last_touch_owner_name ||
    "Owner unassigned";

  return {
    organization_id: organizationId,
    generated_at: new Date().toISOString(),
    summary: {
      last_touch_at: lastTouch?.occurred_at ?? snapshot?.last_touch_at ?? null,
      last_touch_label: lastTouchLabel,
      next_action: nextFollowUpItem?.next_action ?? contactCleanupItem?.next_action ?? projectQueueItems[0]?.next_action ?? "Open the relationship workspace",
      owner_label: ownerLabel,
      follow_up_date: snapshot?.next_follow_up_date ?? null,
      follow_up_label: snapshot?.next_follow_up_date ? formatDueLabel(snapshot.next_follow_up_date, anchorDate) : "No follow-up scheduled",
      relationship_health_state: relationshipHealthState,
      relationship_health_summary: summarizeRelationshipHealth(healthCues, relationshipHealthState)
    },
    health_cues: healthCues,
    queues: {
      contact_cleanup: {
        count: contactCleanupItem ? 1 : 0,
        items: contactCleanupItem ? [contactCleanupItem] : []
      },
      follow_up: {
        count: followUpQueueItems.length,
        items: followUpQueueItems
      },
      duplicate_review: {
        count: duplicateQueueItems.length,
        items: duplicateQueueItems
      },
      projects: {
        count: projectQueueItems.length,
        items: projectQueueItems
      }
    },
    timeline: buildOrganizationOperationsTimeline(detail, touchpoints, duplicateReviews, projectEvents, anchorDate).slice(0, 12)
  };
}

async function loadOrganizationOperationsSnapshot(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  anchorDate: string
) {
  const rows = await loadOrganizationOperationsSnapshots(client, tenantId, anchorDate, organizationId);
  return rows[0] ?? null;
}

async function loadOrganizationOperationsSnapshots(
  client: PoolClient,
  tenantId: string,
  anchorDate: string,
  organizationId?: string
) {
  const values: unknown[] = [tenantId, anchorDate];
  let where = "o.tenant_id = $1";
  if (organizationId) {
    values.push(organizationId);
    where += ` AND o.id = $${values.length}::uuid`;
  }

  const { rows } = await client.query<OrganizationOperationsSnapshotRow>(
    `
      SELECT
        o.id AS organization_id,
        o.display_name AS organization_display_name,
        o.account_type::text AS account_type,
        o.active_status::text AS active_status,
        primary_contact.id AS primary_contact_id,
        primary_contact.full_name AS primary_contact_name,
        primary_contact.phone AS primary_contact_phone,
        primary_contact.email AS primary_contact_email,
        last_touch.id AS last_touch_id,
        last_touch.contact_id AS last_touch_contact_id,
        last_touch.occurred_at::text AS last_touch_at,
        last_touch.summary AS last_touch_summary,
        last_touch.owner_name AS last_touch_owner_name,
        next_follow_up.id AS next_follow_up_touchpoint_id,
        next_follow_up.contact_id AS next_follow_up_contact_id,
        next_follow_up.follow_up_date::text AS next_follow_up_date,
        next_follow_up.summary AS next_follow_up_summary,
        next_follow_up.owner_name AS next_follow_up_owner_name,
        upcoming_shoot.id AS upcoming_shoot_id,
        upcoming_shoot.title AS upcoming_shoot_title,
        upcoming_shoot.shoot_date::text AS upcoming_shoot_date,
        upcoming_shoot.location_name AS upcoming_shoot_location_name,
        COALESCE(contact_stats.active_contact_count, 0)::int AS active_contact_count,
        COALESCE(contact_stats.incomplete_contact_count, 0)::int AS incomplete_contact_count,
        COALESCE(location_stats.active_location_count, 0)::int AS active_location_count,
        COALESCE(location_stats.location_without_contact_count, 0)::int AS location_without_contact_count,
        COALESCE(duplicate_stats.open_duplicate_count, 0)::int AS open_duplicate_count,
        duplicate_stats.open_duplicate_review_id,
        duplicate_stats.open_duplicate_summary,
        duplicate_stats.open_duplicate_created_at
      FROM organization o
      LEFT JOIN LATERAL (
        SELECT oc.id, oc.full_name, oc.phone, oc.email
        FROM organization_contact_relationship ocr
        JOIN organization_contact oc
          ON oc.tenant_id = ocr.tenant_id
         AND oc.id = ocr.contact_id
        WHERE ocr.tenant_id = o.tenant_id
          AND ocr.organization_id = o.id
          AND ocr.is_primary = true
          AND ocr.is_current = true
          AND oc.active_status = 'active'
        ORDER BY oc.updated_at DESC, oc.created_at DESC
        LIMIT 1
      ) primary_contact ON true
      LEFT JOIN LATERAL (
        SELECT
          dt.id,
          dt.contact_id,
          dt.summary,
          dt.occurred_at,
          owner.full_name AS owner_name
        FROM directory_touchpoint dt
        LEFT JOIN app_user owner
          ON owner.id = dt.owner_user_id
        WHERE dt.tenant_id = o.tenant_id
          AND dt.organization_id = o.id
        ORDER BY dt.occurred_at DESC, dt.created_at DESC
        LIMIT 1
      ) last_touch ON true
      LEFT JOIN LATERAL (
        SELECT
          dt.id,
          dt.contact_id,
          dt.summary,
          dt.follow_up_date,
          owner.full_name AS owner_name
        FROM directory_touchpoint dt
        LEFT JOIN app_user owner
          ON owner.id = dt.owner_user_id
        WHERE dt.tenant_id = o.tenant_id
          AND dt.organization_id = o.id
          AND dt.follow_up_date IS NOT NULL
        ORDER BY dt.follow_up_date ASC, dt.occurred_at DESC, dt.created_at DESC
        LIMIT 1
      ) next_follow_up ON true
      LEFT JOIN LATERAL (
        SELECT
          s.id,
          s.title,
          s.shoot_date,
          COALESCE(location.name, s.location_name) AS location_name
        FROM shoot s
        LEFT JOIN shoot_location location
          ON location.tenant_id = s.tenant_id
         AND location.id = s.location_id
        WHERE s.tenant_id = o.tenant_id
          AND s.organization_id = o.id
          AND s.deleted_at IS NULL
          AND s.shoot_date >= $2::date
        ORDER BY s.shoot_date ASC, COALESCE(s.start_time, s.showtime, s.arrival_time) ASC NULLS LAST, s.created_at ASC
        LIMIT 1
      ) upcoming_shoot ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE oc.active_status = 'active') AS active_contact_count,
          COUNT(*) FILTER (
            WHERE oc.active_status = 'active'
              AND (NULLIF(trim(oc.phone), '') IS NULL OR NULLIF(trim(oc.email), '') IS NULL)
          ) AS incomplete_contact_count
        FROM organization_contact_relationship ocr
        JOIN organization_contact oc
          ON oc.tenant_id = ocr.tenant_id
         AND oc.id = ocr.contact_id
        WHERE ocr.tenant_id = o.tenant_id
          AND ocr.organization_id = o.id
          AND ocr.is_current = true
      ) contact_stats ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE sl.active_status = 'active') AS active_location_count,
          COUNT(*) FILTER (
            WHERE sl.active_status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM location_contact_link lcl
                WHERE lcl.tenant_id = sl.tenant_id
                  AND lcl.location_id = sl.id
              )
          ) AS location_without_contact_count
        FROM shoot_location sl
        WHERE sl.tenant_id = o.tenant_id
          AND sl.organization_id = o.id
      ) location_stats ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS open_duplicate_count,
          (ARRAY_AGG(ddr.id ORDER BY ddr.created_at ASC))[1] AS open_duplicate_review_id,
          (ARRAY_AGG(ddr.summary ORDER BY ddr.created_at ASC))[1] AS open_duplicate_summary,
          (ARRAY_AGG(ddr.created_at::text ORDER BY ddr.created_at ASC))[1] AS open_duplicate_created_at
        FROM directory_duplicate_review ddr
        WHERE ddr.tenant_id = o.tenant_id
          AND ddr.status = 'open'
          AND (
            EXISTS (
              SELECT 1
              FROM organization_contact_relationship ocr
              WHERE ocr.tenant_id = ddr.tenant_id
                AND ocr.organization_id = o.id
                AND ocr.contact_id = ddr.primary_contact_id
                AND ocr.is_current = true
            )
            OR EXISTS (
              SELECT 1
              FROM organization_contact_relationship ocr
              WHERE ocr.tenant_id = ddr.tenant_id
                AND ocr.organization_id = o.id
                AND ocr.contact_id = ddr.suspected_duplicate_contact_id
                AND ocr.is_current = true
            )
          )
      ) duplicate_stats ON true
      WHERE ${where}
      ORDER BY o.updated_at DESC, o.display_name ASC
    `,
    values
  );

  return rows;
}

async function loadOrganizationLinkedProjects(
  client: PoolClient,
  tenantId: string,
  organizationId: string,
  anchorDate: string
) {
  const { rows } = await client.query<OrganizationLinkedProjectRow>(
    `
      SELECT
        project.id,
        project.title,
        project.summary,
        project.status::text AS status,
        project.priority::text AS priority,
        owner.full_name AS owner_name,
        project.due_date::text AS due_date,
        project.follow_up_date::text AS follow_up_date,
        project.created_reason,
        project.source_trigger_label,
        project.linked_location_id,
        project.linked_shoot_id,
        COALESCE(task_summary.overdue_task_count, 0)::int AS overdue_task_count,
        COALESCE(task_summary.open_task_count, 0)::int AS open_task_count
      FROM production_project project
      LEFT JOIN app_user owner
        ON owner.id = project.owner_user_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE task.status NOT IN ('done', 'skipped')
          ) AS open_task_count,
          COUNT(*) FILTER (
            WHERE task.status NOT IN ('done', 'skipped')
              AND task.due_date IS NOT NULL
              AND task.due_date < $3::date
          ) AS overdue_task_count
        FROM production_project_task task
        WHERE task.tenant_id = project.tenant_id
          AND task.project_id = project.id
      ) task_summary ON true
      WHERE project.tenant_id = $1
        AND project.linked_organization_id = $2
        AND project.status NOT IN ('completed', 'canceled')
      ORDER BY
        CASE project.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        COALESCE(project.follow_up_date, project.due_date) ASC NULLS LAST,
        project.updated_at DESC
      LIMIT 6
    `,
    [tenantId, organizationId, anchorDate]
  );

  return rows;
}

async function loadOrganizationProjectEvents(client: PoolClient, tenantId: string, organizationId: string) {
  const { rows } = await client.query<OrganizationProjectEventRow>(
    `
      SELECT
        event.id,
        project.id AS project_id,
        project.title AS project_title,
        event.event_type,
        event.summary,
        event.note,
        actor.full_name AS actor_name,
        event.created_at::text AS created_at,
        project.linked_location_id,
        project.linked_shoot_id
      FROM production_project_event event
      JOIN production_project project
        ON project.tenant_id = event.tenant_id
       AND project.id = event.project_id
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND project.linked_organization_id = $2
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 6
    `,
    [tenantId, organizationId]
  );

  return rows;
}

function buildContactCleanupQueueItem(snapshot: OrganizationOperationsSnapshotRow): ManagerCockpitQueueItem | null {
  const flags = buildContactCleanupFlags(snapshot);
  if (!flags.length) {
    return null;
  }

  return {
    id: `contact_cleanup:${snapshot.organization_id}`,
    entity_kind: "organization",
    entity_id: snapshot.organization_id,
    organization_id: snapshot.organization_id,
    shoot_id: snapshot.upcoming_shoot_id,
    title: snapshot.organization_display_name,
    summary: summarizeFlags(flags),
    owner_label: snapshot.primary_contact_name ? `Primary ${snapshot.primary_contact_name}` : "Primary contact missing",
    due_label: snapshot.upcoming_shoot_date ? `Next shoot ${formatDateLabel(snapshot.upcoming_shoot_date)}` : null,
    status_label: "Needs Contact Cleanup",
    status_tone: flags.some((flag) => flag.tone === "critical") ? "critical" : "warning",
    next_action: "Resolve contact and relationship gaps",
    action_hash: buildOrganizationHash(snapshot.organization_id, "operations"),
    flags
  };
}

function buildFollowUpQueueItem(snapshot: OrganizationOperationsSnapshotRow, anchorDate: string): ManagerCockpitQueueItem | null {
  const flags = buildFollowUpFlags(snapshot, anchorDate);
  if (!flags.length) {
    return null;
  }

  return {
    id: `follow_up:${snapshot.organization_id}`,
    entity_kind: "organization",
    entity_id: snapshot.organization_id,
    organization_id: snapshot.organization_id,
    shoot_id: snapshot.upcoming_shoot_id,
    title: snapshot.organization_display_name,
    summary: buildFollowUpSummary(snapshot, anchorDate),
    owner_label: snapshot.next_follow_up_owner_name || snapshot.last_touch_owner_name || "Owner unassigned",
    due_label: snapshot.next_follow_up_date
      ? formatDueLabel(snapshot.next_follow_up_date, anchorDate)
      : snapshot.upcoming_shoot_date
        ? `Before ${formatDateLabel(snapshot.upcoming_shoot_date)}`
        : null,
    status_label: "Needs Follow-Up",
    status_tone: flags.some((flag) => flag.tone === "critical") ? "critical" : "warning",
    next_action: "Log outreach and confirm the next step",
    action_hash: buildOrganizationHash(snapshot.organization_id, "operations"),
    flags
  };
}

function buildOrganizationContactCleanupQueueItem(
  detail: OrganizationDetail,
  snapshot: OrganizationOperationsSnapshotRow | null
): OrganizationOperationsQueueItem | null {
  if (!snapshot) {
    return null;
  }
  const flags = buildContactCleanupFlags(snapshot);
  if (!flags.length) {
    return null;
  }

  return {
    id: `organization_cleanup:${detail.organization.id}`,
    kind: "contact_cleanup",
    title: "Resolve relationship gaps",
    summary: summarizeFlags(flags),
    tone: flags.some((flag) => flag.tone === "critical") ? "critical" : "warning",
    next_action: "Edit contacts, mark a primary owner, and close duplicate cleanup work.",
    action_hash: buildOrganizationHash(detail.organization.id, "relationships"),
    owner_label: snapshot.primary_contact_name ? `Primary ${snapshot.primary_contact_name}` : "Primary contact missing",
    due_label: snapshot.upcoming_shoot_date ? `Before ${formatDateLabel(snapshot.upcoming_shoot_date)}` : null,
    related_contact_id: snapshot.primary_contact_id,
    related_location_id: null,
    related_shoot_id: snapshot.upcoming_shoot_id
  };
}

function buildOrganizationFollowUpQueueItems(
  detail: OrganizationDetail,
  snapshot: OrganizationOperationsSnapshotRow | null,
  touchpoints: DirectoryTouchpointRecord[],
  anchorDate: string
) {
  if (!snapshot) {
    return [] as OrganizationOperationsQueueItem[];
  }

  const items: OrganizationOperationsQueueItem[] = [];
  if (snapshot.next_follow_up_date) {
    items.push({
      id: `follow_up_due:${detail.organization.id}`,
      kind: "follow_up",
      title: "Follow-up due",
      summary: snapshot.next_follow_up_summary ?? "A saved follow-up date needs attention.",
      tone: isOverdue(snapshot.next_follow_up_date, anchorDate) ? "critical" : "warning",
      next_action: "Log the next touchpoint and update the follow-up date.",
      action_hash: buildOrganizationHash(detail.organization.id, "touchpoints", snapshot.next_follow_up_contact_id),
      owner_label: snapshot.next_follow_up_owner_name || "Owner unassigned",
      due_label: formatDueLabel(snapshot.next_follow_up_date, anchorDate),
      related_contact_id: snapshot.next_follow_up_contact_id,
      related_location_id: null,
      related_shoot_id: snapshot.upcoming_shoot_id
    });
  }

  if (needsUpcomingShootOutreach(snapshot, anchorDate)) {
    items.push({
      id: `shoot_outreach:${detail.organization.id}`,
      kind: "follow_up",
      title: "Upcoming shoot needs outreach",
      summary: `No recent touchpoint is close enough to the next shoot${snapshot.upcoming_shoot_title ? `, ${snapshot.upcoming_shoot_title}` : ""}.`,
      tone: "warning",
      next_action: "Confirm day-of details before the shoot arrives.",
      action_hash: buildOrganizationHash(detail.organization.id, "linked_shoots"),
      owner_label: snapshot.primary_contact_name ? `Contact ${snapshot.primary_contact_name}` : "Primary contact missing",
      due_label: snapshot.upcoming_shoot_date ? `Before ${formatDateLabel(snapshot.upcoming_shoot_date)}` : null,
      related_contact_id: snapshot.primary_contact_id,
      related_location_id: null,
      related_shoot_id: snapshot.upcoming_shoot_id
    });
  }

  if (!snapshot.next_follow_up_date && isTouchpointStale(snapshot.last_touch_at, anchorDate)) {
    items.push({
      id: `stale_touch:${detail.organization.id}`,
      kind: "follow_up",
      title: "Relationship has gone stale",
      summary: touchpoints[0]?.summary ?? "No recent touchpoint has been logged for this account.",
      tone: "warning",
      next_action: "Log a fresh touchpoint or set a next follow-up.",
      action_hash: buildOrganizationHash(detail.organization.id, "touchpoints", snapshot.last_touch_contact_id),
      owner_label: snapshot.last_touch_owner_name || "Owner unassigned",
      due_label: "Refresh this week",
      related_contact_id: snapshot.last_touch_contact_id,
      related_location_id: null,
      related_shoot_id: snapshot.upcoming_shoot_id
    });
  }

  return items.sort(compareOrganizationQueueItems);
}

function buildOrganizationDuplicateQueueItems(detail: OrganizationDetail, duplicateReviews: DirectoryDuplicateReviewRecord[]) {
  return duplicateReviews
    .filter((review) => review.status === "open")
    .map<OrganizationOperationsQueueItem>((review) => ({
      id: review.id,
      kind: "duplicate_review",
      title: `${review.primary_contact_name || "Unknown"} vs ${review.suspected_duplicate_contact_name || "Unknown"}`,
      summary: review.summary,
      tone: "info",
      next_action: "Review whether these contacts should stay separate or move toward merge review.",
      action_hash: buildOrganizationHash(
        detail.organization.id,
        "duplicates",
        review.primary_contact_id ?? review.suspected_duplicate_contact_id ?? null
      ),
      owner_label: review.created_by_name || "Review owner unassigned",
      due_label: `Opened ${formatDateLabel(review.created_at)}`,
      related_contact_id: review.primary_contact_id ?? review.suspected_duplicate_contact_id,
      related_location_id: null,
      related_shoot_id: null
    }))
    .sort(compareOrganizationQueueItems);
}

function buildOrganizationProjectQueueItems(linkedProjects: OrganizationLinkedProjectRow[], anchorDate: string) {
  return linkedProjects.map<OrganizationOperationsQueueItem>((project) => ({
    id: project.id,
    kind: "project",
    title: project.title,
    summary: project.summary ?? project.created_reason,
    tone: deriveProjectTone(project, anchorDate),
    next_action: buildProjectNextAction(project, anchorDate),
    action_hash: buildProjectHash(project.id),
    owner_label: project.owner_name || "Owner unassigned",
    due_label: project.follow_up_date ? formatDueLabel(project.follow_up_date, anchorDate) : project.due_date ? formatDueLabel(project.due_date, anchorDate) : null,
    related_contact_id: null,
    related_location_id: project.linked_location_id,
    related_shoot_id: project.linked_shoot_id
  }));
}

function buildOrganizationHealthCues(
  detail: OrganizationDetail,
  snapshot: OrganizationOperationsSnapshotRow | null,
  duplicateReviews: DirectoryDuplicateReviewRecord[],
  anchorDate: string
) {
  const cues: OrganizationOperationsHealthCue[] = [];
  if (!snapshot?.primary_contact_id) {
    cues.push({
      code: "missing_primary_contact",
      label: "Primary contact missing",
      detail: "No organization-level primary relationship is set.",
      tone: "critical"
    });
  }
  if ((snapshot?.incomplete_contact_count ?? 0) > 0) {
    cues.push({
      code: "incomplete_contact_data",
      label: "Contact details incomplete",
      detail: `${snapshot?.incomplete_contact_count ?? 0} active contact records are missing phone or email details.`,
      tone: "warning"
    });
  }
  if ((snapshot?.location_without_contact_count ?? 0) > 0) {
    cues.push({
      code: "location_contact_gap",
      label: "Location coverage gap",
      detail: `${snapshot?.location_without_contact_count ?? 0} active locations still have no linked day-of contact.`,
      tone: "warning"
    });
  }
  if (duplicateReviews.some((review) => review.status === "open")) {
    const openCount = duplicateReviews.filter((review) => review.status === "open").length;
    cues.push({
      code: "duplicate_review_open",
      label: "Duplicate review open",
      detail: `${openCount} duplicate contact review item${openCount === 1 ? "" : "s"} are still open.`,
      tone: "info"
    });
  }
  if (snapshot?.next_follow_up_date && isOverdue(snapshot.next_follow_up_date, anchorDate)) {
    cues.push({
      code: "overdue_follow_up",
      label: "Follow-up overdue",
      detail: `A follow-up was due ${formatDueLabel(snapshot.next_follow_up_date, anchorDate).toLowerCase()}.`,
      tone: "critical"
    });
  }
  if (needsUpcomingShootOutreach(snapshot, anchorDate)) {
    cues.push({
      code: "upcoming_shoot_outreach",
      label: "Upcoming shoot needs outreach",
      detail: "The next shoot is approaching without a recent touchpoint trail.",
      tone: "warning"
    });
  }
  if (!cues.length) {
    cues.push({
      code: "relationship_healthy",
      label: "Relationship looks healthy",
      detail: `${detail.organization.display_name} has a primary contact, recent activity, and no open relationship cleanup pressure.`,
      tone: "good"
    });
  }
  return cues;
}

function buildOrganizationOperationsTimeline(
  detail: OrganizationDetail,
  touchpoints: DirectoryTouchpointRecord[],
  duplicateReviews: DirectoryDuplicateReviewRecord[],
  projectEvents: OrganizationProjectEventRow[],
  anchorDate: string
) {
  const items: OrganizationOperationsTimelineItem[] = [];

  for (const touchpoint of touchpoints) {
    items.push({
      id: touchpoint.id,
      kind: "touchpoint",
      title: humanizeTouchpointChannel(touchpoint.channel),
      summary: touchpoint.summary,
      tone: "info",
      occurred_at: touchpoint.occurred_at,
      owner_label: touchpoint.owner_name || "Owner unassigned",
      related_contact_id: touchpoint.contact_id,
      related_location_id: touchpoint.location_id,
      related_shoot_id: touchpoint.shoot_id,
      due_label: touchpoint.follow_up_date ? formatDueLabel(touchpoint.follow_up_date, anchorDate) : null,
      action_hash: touchpoint.contact_id ? buildOrganizationHash(detail.organization.id, "touchpoints", touchpoint.contact_id) : buildOrganizationHash(detail.organization.id, "touchpoints")
    });
  }

  if (detail.next_shoot) {
    items.push({
      id: `next_shoot:${detail.next_shoot.id}`,
      kind: "upcoming_shoot",
      title: detail.next_shoot.title,
      summary: `${formatDateLabel(detail.next_shoot.shoot_date)}${detail.next_shoot.location_name ? ` at ${detail.next_shoot.location_name}` : ""}`,
      tone: "info",
      occurred_at: toStableIso(detail.next_shoot.shoot_date),
      owner_label: detail.next_shoot.location_name || detail.organization.display_name,
      related_contact_id: detail.account_overview.key_contacts[0]?.id ?? null,
      related_location_id: null,
      related_shoot_id: detail.next_shoot.id,
      due_label: `Upcoming ${formatDateLabel(detail.next_shoot.shoot_date)}`,
      action_hash: buildOrganizationHash(detail.organization.id, "linked_shoots")
    });
  }

  for (const review of duplicateReviews) {
    items.push({
      id: `duplicate:${review.id}`,
      kind: "duplicate_review",
      title: `${review.primary_contact_name || "Unknown"} vs ${review.suspected_duplicate_contact_name || "Unknown"}`,
      summary: review.summary,
      tone: review.status === "open" ? "warning" : "info",
      occurred_at: review.created_at,
      owner_label: review.created_by_name || "Review owner unassigned",
      related_contact_id: review.primary_contact_id ?? review.suspected_duplicate_contact_id,
      related_location_id: null,
      related_shoot_id: null,
      due_label: review.status === "open" ? "Open review" : review.status,
      action_hash: buildOrganizationHash(
        detail.organization.id,
        "duplicates",
        review.primary_contact_id ?? review.suspected_duplicate_contact_id ?? null
      )
    });
  }

  for (const projectEvent of projectEvents) {
    items.push({
      id: `project:${projectEvent.id}`,
      kind: "project",
      title: projectEvent.project_title,
      summary: projectEvent.note ? `${projectEvent.summary} | ${projectEvent.note}` : projectEvent.summary,
      tone: deriveProjectEventTone(projectEvent),
      occurred_at: projectEvent.created_at,
      owner_label: projectEvent.actor_name || "Mission Control",
      related_contact_id: null,
      related_location_id: projectEvent.linked_location_id,
      related_shoot_id: projectEvent.linked_shoot_id,
      due_label: null,
      action_hash: buildProjectHash(projectEvent.project_id)
    });
  }

  for (const issue of detail.account_overview.recent_issues ?? []) {
    items.push({
      id: `issue:${issue.issue_type}:${issue.linked_entity_id ?? issue.title}`,
      kind: "account_issue",
      title: issue.title,
      summary: issue.summary,
      tone: issue.severity === "critical" ? "critical" : "warning",
      occurred_at: new Date().toISOString(),
      owner_label: detail.organization.display_name,
      related_contact_id: null,
      related_location_id: null,
      related_shoot_id: issue.linked_entity_id,
      due_label: issue.severity === "critical" ? "Needs attention" : null,
      action_hash: null
    });
  }

  for (const opportunity of detail.sales_opportunities ?? []) {
    if (!opportunity.follow_up_date && !opportunity.next_action_date) {
      continue;
    }
    const dueDate = opportunity.follow_up_date ?? opportunity.next_action_date ?? null;
    items.push({
      id: `sales:${opportunity.id}`,
      kind: "sales_follow_up",
      title: opportunity.primary_contact_name || opportunity.owner_name,
      summary: opportunity.notes || "Sales follow-up is scheduled for this account.",
      tone:
        opportunity.attention_state === "critical"
          ? "critical"
          : opportunity.attention_state === "warning"
            ? "warning"
            : "info",
      occurred_at: dueDate ? toStableIso(dueDate) : new Date().toISOString(),
      owner_label: opportunity.owner_name,
      related_contact_id: opportunity.primary_contact_id,
      related_location_id: null,
      related_shoot_id: null,
      due_label: dueDate ? formatDueLabel(dueDate, anchorDate) : null,
      action_hash: null
    });
  }

  return items.sort(compareTimelineItems);
}

function buildContactCleanupFlags(snapshot: OrganizationOperationsSnapshotRow): ManagerCockpitFlag[] {
  const flags: ManagerCockpitFlag[] = [];
  if (!snapshot.primary_contact_id) {
    flags.push({ label: "Primary contact missing", tone: "critical" });
  }
  if (snapshot.incomplete_contact_count > 0) {
    flags.push({
      label: `${snapshot.incomplete_contact_count} incomplete contact record${snapshot.incomplete_contact_count === 1 ? "" : "s"}`,
      tone: "warning"
    });
  }
  if (snapshot.location_without_contact_count > 0) {
    flags.push({
      label: `${snapshot.location_without_contact_count} location contact gap${snapshot.location_without_contact_count === 1 ? "" : "s"}`,
      tone: "warning"
    });
  }
  if (snapshot.open_duplicate_count > 0) {
    flags.push({
      label: `${snapshot.open_duplicate_count} duplicate review${snapshot.open_duplicate_count === 1 ? "" : "s"}`,
      tone: "info"
    });
  }
  return flags;
}

function buildFollowUpFlags(snapshot: OrganizationOperationsSnapshotRow, anchorDate: string): ManagerCockpitFlag[] {
  const flags: ManagerCockpitFlag[] = [];
  if (snapshot.next_follow_up_date) {
    flags.push({
      label: isOverdue(snapshot.next_follow_up_date, anchorDate) ? "Follow-up overdue" : "Follow-up scheduled",
      tone: isOverdue(snapshot.next_follow_up_date, anchorDate) ? "critical" : "warning"
    });
  }
  if (needsUpcomingShootOutreach(snapshot, anchorDate)) {
    flags.push({ label: "Upcoming shoot outreach gap", tone: "warning" });
  }
  if (!snapshot.next_follow_up_date && isTouchpointStale(snapshot.last_touch_at, anchorDate)) {
    flags.push({ label: "Touchpoint stale", tone: "warning" });
  }
  return flags;
}

function buildFollowUpSummary(snapshot: OrganizationOperationsSnapshotRow, anchorDate: string) {
  if (snapshot.next_follow_up_date) {
    return `${snapshot.next_follow_up_summary ?? "A touchpoint follow-up is due."} ${formatDueLabel(snapshot.next_follow_up_date, anchorDate)}.`;
  }
  if (needsUpcomingShootOutreach(snapshot, anchorDate)) {
    return "The next shoot is coming up and the relationship trail needs a fresher touchpoint.";
  }
  return "The relationship needs a fresh touchpoint and next-step owner.";
}

function summarizeFlags(flags: ManagerCockpitFlag[]) {
  return flags
    .slice(0, 3)
    .map((flag) => flag.label)
    .join(" | ");
}

function getRelationshipHealthState(cues: OrganizationOperationsHealthCue[]) {
  if (cues.some((cue) => cue.tone === "critical")) {
    return "at_risk" as const;
  }
  if (cues.some((cue) => cue.tone === "warning" || cue.tone === "info")) {
    return "watch" as const;
  }
  return "healthy" as const;
}

function summarizeRelationshipHealth(cues: OrganizationOperationsHealthCue[], state: "healthy" | "watch" | "at_risk") {
  if (state === "healthy") {
    return cues[0]?.detail ?? "Relationship coverage looks healthy.";
  }
  return cues
    .slice(0, 2)
    .map((cue) => cue.label)
    .join(" | ");
}

function deriveProjectTone(project: OrganizationLinkedProjectRow, anchorDate: string): OrganizationOperationsTone {
  if (project.status === "blocked" || project.priority === "critical" || project.overdue_task_count > 0) {
    return "critical";
  }
  if (!project.owner_name || !project.due_date || (project.follow_up_date && project.follow_up_date <= anchorDate)) {
    return "warning";
  }
  return "info";
}

function buildProjectNextAction(project: OrganizationLinkedProjectRow, anchorDate: string) {
  if (!project.owner_name) {
    return "Assign an owner";
  }
  if (!project.due_date) {
    return "Set a due date";
  }
  if (project.overdue_task_count > 0) {
    return "Clear overdue checklist work";
  }
  if (project.follow_up_date && project.follow_up_date <= anchorDate) {
    return "Log follow-up and update the date";
  }
  if (project.status === "new") {
    return "Kick off post-shoot production";
  }
  if (project.open_task_count > 0) {
    return "Work the next checklist item";
  }
  return "Open production detail";
}

function deriveProjectEventTone(projectEvent: OrganizationProjectEventRow): OrganizationOperationsTone {
  if (projectEvent.event_type.includes("completed")) {
    return "good";
  }
  if (projectEvent.event_type.includes("blocked")) {
    return "warning";
  }
  return "info";
}

function buildOrganizationHash(
  organizationId: string,
  tab: "profile" | "relationships" | "touchpoints" | "linked_shoots" | "duplicates" | "operations",
  contactId: string | null = null,
  locationId: string | null = null
) {
  const params = new URLSearchParams();
  params.set("view", contactId ? "contacts" : locationId ? "locations" : "organizations");
  params.set("organization", organizationId);
  params.set("tab", tab);
  if (contactId) {
    params.set("contact", contactId);
  }
  if (locationId) {
    params.set("location", locationId);
  }
  return `#organizations?${params.toString()}`;
}

function buildProjectHash(projectId: string) {
  const params = new URLSearchParams();
  params.set("project", projectId);
  return `#production?${params.toString()}`;
}

function needsUpcomingShootOutreach(snapshot: OrganizationOperationsSnapshotRow | null, anchorDate: string) {
  if (!snapshot?.upcoming_shoot_date) {
    return false;
  }
  const daysUntilShoot = dayDelta(anchorDate, snapshot.upcoming_shoot_date);
  if (daysUntilShoot < 0 || daysUntilShoot > 14) {
    return false;
  }
  return !snapshot.last_touch_at || dayDelta(extractDatePart(snapshot.last_touch_at), snapshot.upcoming_shoot_date) > 14;
}

function isTouchpointStale(lastTouchAt: string | null, anchorDate: string) {
  if (!lastTouchAt) {
    return true;
  }
  return dayDelta(extractDatePart(lastTouchAt), anchorDate) > 30;
}

function isOverdue(dateValue: string, anchorDate: string) {
  return dateValue < anchorDate;
}

function compareManagerQueueItems(left: ManagerCockpitQueueItem, right: ManagerCockpitQueueItem) {
  const leftCritical = left.flags.some((flag) => flag.tone === "critical") ? 0 : 1;
  const rightCritical = right.flags.some((flag) => flag.tone === "critical") ? 0 : 1;
  if (leftCritical !== rightCritical) {
    return leftCritical - rightCritical;
  }
  return (left.due_label ?? "").localeCompare(right.due_label ?? "") || left.title.localeCompare(right.title);
}

function compareOrganizationQueueItems(left: OrganizationOperationsQueueItem, right: OrganizationOperationsQueueItem) {
  const toneRank = tonePriority(left.tone) - tonePriority(right.tone);
  if (toneRank !== 0) {
    return toneRank;
  }
  return (left.due_label ?? "").localeCompare(right.due_label ?? "") || left.title.localeCompare(right.title);
}

function compareTimelineItems(left: OrganizationOperationsTimelineItem, right: OrganizationOperationsTimelineItem) {
  return Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
}

function compareOccurredAtDesc(left: DirectoryTouchpointRecord, right: DirectoryTouchpointRecord) {
  return Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
}

function tonePriority(value: "good" | "info" | "warning" | "critical") {
  switch (value) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
    default:
      return 3;
  }
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(toStableIso(value)));
}

function formatDateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDueLabel(value: string, anchorDate: string) {
  if (value < anchorDate) {
    return `Overdue since ${formatDateLabel(value)}`;
  }
  if (value === anchorDate) {
    return "Due today";
  }
  return `Due ${formatDateLabel(value)}`;
}

function dayDelta(fromDate: string, toDate: string) {
  return Math.round((Date.parse(toStableIso(toDate)) - Date.parse(toStableIso(fromDate))) / 86_400_000);
}

function extractDatePart(value: string) {
  return value.slice(0, 10);
}

function toStableIso(dateValue: string) {
  return `${dateValue.slice(0, 10)}T12:00:00.000Z`;
}

function humanizeTouchpointChannel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
