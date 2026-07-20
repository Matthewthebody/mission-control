import type { PoolClient } from "pg";
import { canViewLaborCost } from "../authz/authority.js";
import type { AuthUser } from "../types/auth.js";
import type { ProductionProjectSummaryRecord } from "../types/productionProjects.js";
import { getOperationsDashboard } from "./dashboard.js";
import { getProductionProjectHomeSnapshot, listProductionProjects } from "./productionProjects.js";
import { listShootProfitabilitySignals, type ShootProfitabilitySignalRow } from "./shoots.js";

type WorkspaceTone = "neutral" | "good" | "heads_up" | "action_needed" | "info";
type ProfitabilityFocus = "overview" | "watch" | "burden" | "data_health";

type ProfitabilityWatchItem = {
  id: string;
  kind: "shoot_watch" | "recommendation_flag";
  title: string;
  summary: string;
  tone: WorkspaceTone;
  status_label: string;
  driver_label: string;
  context_label: string | null;
  workspace_hash: string;
  action_hash: string | null;
};

type ProfitabilityOverviewCard = {
  id:
    | "watch_items"
    | "production_burden"
    | "qa_rework_burden"
    | "labor_variance_today"
    | "data_health_issues";
  label: string;
  value: number | string;
  detail: string;
  tone: WorkspaceTone;
  action_hash: string;
};

type ProfitabilityBurdenRow = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: WorkspaceTone;
  action_hash: string;
};

type ProfitabilityBreakdownRow = {
  id: string;
  label: string;
  watch_count: number;
  production_count: number;
  detail: string;
  tone: WorkspaceTone;
  action_hash: string;
};

export interface ProfitabilityWorkspaceResponse {
  generated_at: string;
  anchor_date: string;
  filters: {
    date_from: string;
    date_to: string;
    department: string | null;
    focus: ProfitabilityFocus;
  };
  headline: {
    title: string;
    summary_line: string;
    tone: WorkspaceTone;
  };
  overview_cards: ProfitabilityOverviewCard[];
  watch_items: ProfitabilityWatchItem[];
  operational_burden: {
    summary_line: string;
    rows: ProfitabilityBurdenRow[];
  };
  breakdowns: {
    by_department: ProfitabilityBreakdownRow[];
    by_shoot_type: ProfitabilityBreakdownRow[];
  };
  data_health: {
    summary_line: string;
    cards: Array<{
      id:
        | "latest_import_status"
        | "unresolved_import_issues"
        | "fresh_snapshots"
        | "stale_snapshots"
        | "recommendation_flags";
      label: string;
      value: number | string;
      detail: string;
      tone: WorkspaceTone;
    }>;
    latest_import: {
      source_type: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      file_name: string | null;
      source_line_count: number;
      rejected_line_count: number;
    } | null;
  };
}

type ShootProfitabilityRow = ShootProfitabilitySignalRow;

type RecommendationFlagRow = {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  message: string;
  scope_type: string;
  scope_id: string;
  scope_label: string | null;
  job_id: string | null;
  shoot_code: string | null;
  shoot_title: string | null;
  created_at: string;
};

export async function getProfitabilityWorkspace(
  client: PoolClient,
  auth: AuthUser,
  options: {
    anchorDate: string;
    dateFrom: string;
    dateTo: string;
    department?: string | null;
    focus?: ProfitabilityFocus;
  }
): Promise<ProfitabilityWorkspaceResponse> {
  const departmentFilter = options.department?.trim() ? options.department.trim() : null;

  const [
    shootRows,
    projectBoard,
    projectSnapshot,
    laborDashboard,
    latestImportRunResult,
    unresolvedIssueResult,
    snapshotStatusResult,
    recommendationFlagsResult
  ] = await Promise.all([
    listShootProfitabilitySignals(
      client,
      {
        dateFrom: options.dateFrom,
        dateTo: options.dateTo
      },
      auth
    ),
    listProductionProjects(client, auth, {
      anchorDate: options.anchorDate,
      status: "open",
      queue: "all"
    }),
    getProductionProjectHomeSnapshot(client, auth, {
      anchorDate: options.anchorDate
    }),
    canViewLaborCost(auth) ? getOperationsDashboard(client, auth, { date: options.anchorDate, department: departmentFilter ?? undefined }) : Promise.resolve(null),
    client.query(
      `
        SELECT
          source_type::text,
          status::text,
          started_at,
          completed_at,
          file_name,
          source_line_count,
          rejected_line_count
        FROM profitability_import_run
        WHERE tenant_id = $1
        ORDER BY started_at DESC
        LIMIT 1
      `,
      [auth.tenantId]
    ),
    client.query(
      `
        SELECT COUNT(*)::int AS unresolved_issue_count
        FROM profitability_import_validation_issue
        WHERE tenant_id = $1
          AND resolved_at IS NULL
      `,
      [auth.tenantId]
    ),
    client.query(
      `
        SELECT
          snapshot_status::text AS snapshot_status,
          COUNT(*)::int AS total
        FROM profitability_snapshot
        WHERE tenant_id = $1
        GROUP BY snapshot_status
      `,
      [auth.tenantId]
    ),
    client.query<RecommendationFlagRow>(
      `
        SELECT
          flag.id,
          flag.severity::text AS severity,
          flag.title,
          flag.message,
          flag.scope_type::text AS scope_type,
          flag.scope_id,
          snapshot.scope_label,
          snapshot.job_id,
          shoot.shoot_code,
          shoot.title AS shoot_title,
          flag.created_at
        FROM profitability_recommendation_flag flag
        JOIN profitability_snapshot snapshot
          ON snapshot.tenant_id = flag.tenant_id
         AND snapshot.id = flag.snapshot_id
        LEFT JOIN shoot
          ON shoot.tenant_id = snapshot.tenant_id
         AND shoot.id = snapshot.job_id
        WHERE flag.tenant_id = $1
          AND flag.dismissed_at IS NULL
        ORDER BY flag.created_at DESC
        LIMIT 8
      `,
      [auth.tenantId]
    )
  ]);

  const filteredShoots = departmentFilter ? shootRows.filter((row) => row.department === departmentFilter) : shootRows;
  const productionItems = projectBoard.sections.flatMap((section) => section.items);
  const shootById = new Map(filteredShoots.map((row) => [row.id, row]));
  const filteredProductionItems = departmentFilter
    ? productionItems.filter((project) => !project.linked_shoot_id || shootById.has(project.linked_shoot_id))
    : productionItems;

  const watchShoots = filteredShoots.filter(
    (row) => row.future_profitability_flag === "watch" || row.future_profitability_flag === "needs_review"
  );
  const recommendationFlags = recommendationFlagsResult.rows;
  const watchItems = [
    ...watchShoots.map((shoot) => buildShootWatchItem(shoot, options)),
    ...recommendationFlags.map((flag) => buildRecommendationFlagItem(flag, options))
  ]
    .sort(compareWorkspaceItems)
    .slice(0, 10);

  const freshSnapshotCount = Number(
    snapshotStatusResult.rows.find((row) => row.snapshot_status === "fresh")?.total ?? 0
  );
  const staleSnapshotCount = Number(
    snapshotStatusResult.rows.find((row) => row.snapshot_status === "stale")?.total ?? 0
  );
  const unresolvedIssueCount = Number(unresolvedIssueResult.rows[0]?.unresolved_issue_count ?? 0);

  const latestImport = latestImportRunResult.rows[0]
    ? {
        source_type: String(latestImportRunResult.rows[0].source_type),
        status: String(latestImportRunResult.rows[0].status),
        started_at:
          latestImportRunResult.rows[0].started_at instanceof Date
            ? latestImportRunResult.rows[0].started_at.toISOString()
            : String(latestImportRunResult.rows[0].started_at),
        completed_at:
          latestImportRunResult.rows[0].completed_at instanceof Date
            ? latestImportRunResult.rows[0].completed_at.toISOString()
            : latestImportRunResult.rows[0].completed_at
              ? String(latestImportRunResult.rows[0].completed_at)
              : null,
        file_name: latestImportRunResult.rows[0].file_name ? String(latestImportRunResult.rows[0].file_name) : null,
        source_line_count: Number(latestImportRunResult.rows[0].source_line_count ?? 0),
        rejected_line_count: Number(latestImportRunResult.rows[0].rejected_line_count ?? 0)
      }
    : null;

  return {
    generated_at: new Date().toISOString(),
    anchor_date: options.anchorDate,
    filters: {
      date_from: options.dateFrom,
      date_to: options.dateTo,
      department: departmentFilter,
      focus: options.focus ?? "overview"
    },
    headline: {
      title: "Profitability",
      summary_line: buildHeadline({
        watchCount: watchItems.length,
        productionItems: filteredProductionItems,
        staleSnapshotCount,
        unresolvedIssueCount
      }),
      tone: deriveHeadlineTone({
        watchCount: watchItems.length,
        productionItems: filteredProductionItems,
        staleSnapshotCount,
        unresolvedIssueCount
      })
    },
    overview_cards: buildOverviewCards({
      watchCount: watchItems.length,
      productionItems: filteredProductionItems,
      laborDashboard,
      unresolvedIssueCount,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      department: departmentFilter
    }),
    watch_items: watchItems,
    operational_burden: buildOperationalBurden({
      productionItems: filteredProductionItems,
      projectSnapshot,
      laborDashboard
    }),
    breakdowns: {
      by_department: buildDepartmentBreakdown(filteredShoots, filteredProductionItems, options),
      by_shoot_type: buildShootTypeBreakdown(filteredShoots, filteredProductionItems, options)
    },
    data_health: {
      summary_line: buildDataHealthSummary({
        latestImport,
        unresolvedIssueCount,
        freshSnapshotCount,
        staleSnapshotCount,
        recommendationCount: recommendationFlags.length
      }),
      cards: [
        {
          id: "latest_import_status",
          label: "Latest Import",
          value: latestImport ? humanizeValue(latestImport.status) : "None Yet",
          detail: latestImport ? `${humanizeValue(latestImport.source_type)} import` : "No profitability import runs have been recorded yet.",
          tone: latestImport ? toneForImportStatus(latestImport.status) : "heads_up"
        },
        {
          id: "unresolved_import_issues",
          label: "Import Issues",
          value: unresolvedIssueCount,
          detail: "Validation problems still waiting on resolution.",
          tone: unresolvedIssueCount > 0 ? "action_needed" : "good"
        },
        {
          id: "fresh_snapshots",
          label: "Fresh Snapshots",
          value: freshSnapshotCount,
          detail: "Profitability snapshots currently marked fresh.",
          tone: freshSnapshotCount > 0 ? "good" : "neutral"
        },
        {
          id: "stale_snapshots",
          label: "Stale Snapshots",
          value: staleSnapshotCount,
          detail: "Snapshots that need refresh before leaders should trust imported margin detail.",
          tone: staleSnapshotCount > 0 ? "heads_up" : "good"
        },
        {
          id: "recommendation_flags",
          label: "Recommendations",
          value: recommendationFlags.length,
          detail: "Open profitability recommendation flags from calculated snapshots.",
          tone: recommendationFlags.length > 0 ? "heads_up" : "neutral"
        }
      ],
      latest_import: latestImport
    }
  };
}

function buildShootWatchItem(
  shoot: ShootProfitabilityRow,
  options: { dateFrom: string; dateTo: string; department?: string | null }
): ProfitabilityWatchItem {
  return {
    id: `shoot:${shoot.id}`,
    kind: "shoot_watch",
    title: shoot.title,
    summary:
      shoot.future_profitability_explanation ??
      "This shoot is flagged as a future profitability watch item based on current operational complexity.",
    tone: shoot.future_profitability_flag === "needs_review" ? "action_needed" : "heads_up",
    status_label: shoot.future_profitability_display ?? "Needs Review",
    driver_label: shoot.shoot_code,
    context_label: [humanizeValue(shoot.department), humanizeValue(shoot.shoot_type), shoot.shoot_date].filter(Boolean).join(" | "),
    workspace_hash: buildProfitabilityHash({
      focus: "watch",
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      department: options.department ?? null
    }),
    action_hash: `#shoots?shoot=${shoot.id}`
  };
}

function buildRecommendationFlagItem(
  flag: RecommendationFlagRow,
  options: { dateFrom: string; dateTo: string; department?: string | null }
): ProfitabilityWatchItem {
  return {
    id: `recommendation:${flag.id}`,
    kind: "recommendation_flag",
    title: flag.title,
    summary: flag.message,
    tone: flag.severity === "critical" || flag.severity === "high" ? "action_needed" : "heads_up",
    status_label: humanizeValue(flag.severity),
    driver_label: flag.scope_label ?? humanizeValue(flag.scope_type),
    context_label: flag.shoot_code ? [flag.shoot_code, flag.shoot_title].filter(Boolean).join(" | ") : null,
    workspace_hash: buildProfitabilityHash({
      focus: "watch",
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      department: options.department ?? null
    }),
    action_hash: flag.job_id ? `#shoots?shoot=${flag.job_id}` : null
  };
}

// G2 retirement step: profitability is the THIRD consumer (after the Home labor
// band and leadership reports) to opt into canonical payroll hours. Same honesty
// contract — canonical when time sessions cover the window, legacy fallback with
// the source disclosed, never a fabricated canonical number.
function resolveActualLaborHours(laborDashboard: Awaited<ReturnType<typeof getOperationsDashboard>>) {
  const reconciliation = laborDashboard.hours_reconciliation ?? null;
  if (!reconciliation || reconciliation.status === "canonical_unavailable") {
    return {
      actualHours: Number(laborDashboard.summary.actual_labor_hours ?? 0),
      source: "legacy" as const,
      sourceLabel: "legacy hours — no canonical time sessions cover this window yet"
    };
  }
  return {
    actualHours: Number(reconciliation.canonical_hours_total ?? 0),
    source: "canonical" as const,
    sourceLabel: "canonical payroll hours (time sessions)"
  };
}

function buildOverviewCards(options: {
  watchCount: number;
  productionItems: ProductionProjectSummaryRecord[];
  laborDashboard: Awaited<ReturnType<typeof getOperationsDashboard>> | null;
  unresolvedIssueCount: number;
  dateFrom: string;
  dateTo: string;
  department: string | null;
}): ProfitabilityOverviewCard[] {
  const overdueProduction = options.productionItems.filter((project) => isProductionOverdue(project)).length;
  const reviewPressure = options.productionItems.filter(
    (project) => project.stage === "ready_for_qa" || project.stage === "in_qa_review"
  ).length;
  const blockedRework = options.productionItems.filter(
    (project) => project.stage === "correction_needed" || project.stage === "blocked"
  ).length;
  const laborResolution = options.laborDashboard ? resolveActualLaborHours(options.laborDashboard) : null;
  const laborVariance = laborResolution
    ? Math.max(0, laborResolution.actualHours - Number(options.laborDashboard!.summary.scheduled_labor_hours ?? 0))
    : 0;

  return [
    {
      id: "watch_items",
      label: "Watch Items",
      value: options.watchCount,
      detail: "Shoots or calculated profitability flags that need leadership review.",
      tone: options.watchCount > 0 ? "action_needed" : "good",
      action_hash: buildProfitabilityHash({
        focus: "watch",
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        department: options.department
      })
    },
    {
      id: "production_burden",
      label: "Overdue Production",
      value: overdueProduction,
      detail: "Post-shoot production work already behind or still missing a release path.",
      tone: overdueProduction > 0 ? "action_needed" : "good",
      action_hash: "#production?queue=at_risk_queue&due_state=overdue"
    },
    {
      id: "qa_rework_burden",
      label: "QA / Rework",
      value: blockedRework + reviewPressure,
      detail: "Changes requested, peer review, and final QC pressure affecting delivery confidence.",
      tone: blockedRework > 0 ? "action_needed" : reviewPressure > 0 ? "heads_up" : "good",
      action_hash: "#production/qa?queue=qa_queue"
    },
    {
      id: "labor_variance_today",
      label: "Labor Variance Today",
      value: options.laborDashboard ? `${laborVariance.toFixed(1)}h` : "Hidden",
      detail: laborResolution
        ? `Actual labor above scheduled plan for today (${laborResolution.sourceLabel}).`
        : "Labor profitability signals are hidden without labor-cost access.",
      tone: !options.laborDashboard ? "neutral" : laborVariance > 1 ? "heads_up" : "good",
      action_hash: "#labor"
    },
    {
      id: "data_health_issues",
      label: "Data Health",
      value: options.unresolvedIssueCount,
      detail: "Unresolved import issues that can weaken imported profitability confidence.",
      tone: options.unresolvedIssueCount > 0 ? "heads_up" : "good",
      action_hash: buildProfitabilityHash({
        focus: "data_health",
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        department: options.department
      })
    }
  ];
}

function buildOperationalBurden(options: {
  productionItems: ProductionProjectSummaryRecord[];
  projectSnapshot: Awaited<ReturnType<typeof getProductionProjectHomeSnapshot>>;
  laborDashboard: Awaited<ReturnType<typeof getOperationsDashboard>> | null;
}) {
  const overdue = options.productionItems.filter((project) => isProductionOverdue(project)).length;
  const peerReview = options.productionItems.filter((project) => project.stage === "ready_for_qa").length;
  const finalQc = options.productionItems.filter(
    (project) => project.stage === "in_qa_review" || project.stage === "ready_to_release"
  ).length;
  const blocked = options.productionItems.filter(
    (project) => project.stage === "correction_needed" || project.stage === "blocked"
  ).length;

  const rows: ProfitabilityBurdenRow[] = [
    {
      id: "production_overdue",
      label: "Overdue Production",
      value: String(overdue),
      detail: "Digital backend work already overdue is a direct profitability drag.",
      tone: overdue > 0 ? "action_needed" : "good",
      action_hash: "#production?queue=at_risk_queue&due_state=overdue"
    },
    {
      id: "peer_review_waiting",
      label: "Ready for QA",
      value: String(peerReview),
      detail: "Production work is ready for QA handoff and waiting to be reviewed.",
      tone: peerReview > 0 ? "heads_up" : "good",
      action_hash: "#production/qa?queue=qa_queue&stage=ready_for_qa"
    },
    {
      id: "final_qc_waiting",
      label: "In QA / Ready to Release",
      value: String(finalQc),
      detail: "Production work is actively in QA or waiting on final release action.",
      tone: finalQc > 0 ? "heads_up" : "good",
      action_hash: "#production/release?queue=ready_to_release_queue&stage=ready_to_release"
    },
    {
      id: "blocked_corrections",
      label: "Blocked / Correction Needed",
      value: String(blocked),
      detail: "Rework cycles create direct QA burden and erode delivery efficiency.",
      tone: blocked > 0 ? "action_needed" : "good",
      action_hash: "#production/qa?queue=qa_queue&stage=correction_needed"
    }
  ];

  if (options.laborDashboard) {
    const scheduled = Number(options.laborDashboard.summary.scheduled_labor_hours ?? 0);
    const resolution = resolveActualLaborHours(options.laborDashboard);
    rows.push({
      id: "labor_today",
      label: "Labor Burden Today",
      value: `${resolution.actualHours.toFixed(1)}h / ${scheduled.toFixed(1)}h`,
      detail: `Actual versus scheduled labor for today (${resolution.sourceLabel}).`,
      tone: resolution.actualHours > scheduled ? "heads_up" : "good",
      action_hash: "#labor"
    });
  }

  return {
    summary_line:
      options.projectSnapshot.counts.overdue > 0 || options.projectSnapshot.counts.blocked > 0
        ? "Production delays, review queues, and labor strain are the clearest current profitability drag."
        : "Production burden is steady right now, with review and release work still visible below.",
    rows
  };
}

function buildDepartmentBreakdown(
  shoots: ShootProfitabilityRow[],
  productionItems: ProductionProjectSummaryRecord[],
  options: { dateFrom: string; dateTo: string; department?: string | null }
) {
  const buckets = new Map<string, { label: string; shootCount: number; watchCount: number; productionCount: number }>();
  const shootById = new Map(shoots.map((shoot) => [shoot.id, shoot]));

  for (const shoot of shoots) {
    const key = shoot.department || "operations";
    const bucket = buckets.get(key) ?? { label: humanizeValue(key), shootCount: 0, watchCount: 0, productionCount: 0 };
    bucket.shootCount += 1;
    if (shoot.future_profitability_flag === "watch" || shoot.future_profitability_flag === "needs_review") {
      bucket.watchCount += 1;
    }
    buckets.set(key, bucket);
  }

  for (const project of productionItems) {
    const department = project.linked_shoot_id ? shootById.get(project.linked_shoot_id)?.department ?? "operations" : "operations";
    const bucket = buckets.get(department) ?? { label: humanizeValue(department), shootCount: 0, watchCount: 0, productionCount: 0 };
    bucket.productionCount += 1;
    buckets.set(department, bucket);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      id: key,
      label: bucket.label,
      watch_count: bucket.watchCount,
      production_count: bucket.productionCount,
      detail: `${bucket.shootCount} shoot${bucket.shootCount === 1 ? "" : "s"} in window | ${bucket.watchCount} watch flag${bucket.watchCount === 1 ? "" : "s"}`,
      tone: (bucket.watchCount > 0 ? "heads_up" : bucket.productionCount > 0 ? "info" : "neutral") as WorkspaceTone,
      action_hash: buildProfitabilityHash({
        focus: "overview",
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        department: key
      })
    }))
    .sort((left, right) => right.watch_count - left.watch_count || right.production_count - left.production_count || left.label.localeCompare(right.label))
    .slice(0, 6);
}

function buildShootTypeBreakdown(
  shoots: ShootProfitabilityRow[],
  productionItems: ProductionProjectSummaryRecord[],
  options: { dateFrom: string; dateTo: string; department?: string | null }
) {
  const buckets = new Map<string, { label: string; shootCount: number; watchCount: number; productionCount: number }>();
  const shootById = new Map(shoots.map((shoot) => [shoot.id, shoot]));

  for (const shoot of shoots) {
    const key = shoot.shoot_type || "other";
    const bucket = buckets.get(key) ?? { label: humanizeValue(key), shootCount: 0, watchCount: 0, productionCount: 0 };
    bucket.shootCount += 1;
    if (shoot.future_profitability_flag === "watch" || shoot.future_profitability_flag === "needs_review") {
      bucket.watchCount += 1;
    }
    buckets.set(key, bucket);
  }

  for (const project of productionItems) {
    const key = project.linked_shoot_id ? shootById.get(project.linked_shoot_id)?.shoot_type ?? "unlinked" : "unlinked";
    const bucket = buckets.get(key) ?? { label: humanizeValue(key), shootCount: 0, watchCount: 0, productionCount: 0 };
    bucket.productionCount += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      id: key,
      label: bucket.label,
      watch_count: bucket.watchCount,
      production_count: bucket.productionCount,
      detail: `${bucket.shootCount} shoot${bucket.shootCount === 1 ? "" : "s"} in window | ${bucket.productionCount} linked production item${bucket.productionCount === 1 ? "" : "s"}`,
      tone: (bucket.watchCount > 0 ? "heads_up" : bucket.productionCount > 0 ? "info" : "neutral") as WorkspaceTone,
      action_hash: buildProfitabilityHash({
        focus: "overview",
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        department: options.department ?? null
      })
    }))
    .sort((left, right) => right.watch_count - left.watch_count || right.production_count - left.production_count || left.label.localeCompare(right.label))
    .slice(0, 6);
}

function buildDataHealthSummary(options: {
  latestImport: ProfitabilityWorkspaceResponse["data_health"]["latest_import"];
  unresolvedIssueCount: number;
  freshSnapshotCount: number;
  staleSnapshotCount: number;
  recommendationCount: number;
}) {
  if (!options.latestImport) {
    return "No profitability imports or snapshot refreshes have landed yet, so this workspace is leaning on operational watch signals and production burden.";
  }
  if (options.unresolvedIssueCount > 0 || options.staleSnapshotCount > 0) {
    return `${options.unresolvedIssueCount} unresolved import issue${options.unresolvedIssueCount === 1 ? "" : "s"} and ${options.staleSnapshotCount} stale snapshot${options.staleSnapshotCount === 1 ? "" : "s"} still need cleanup.`;
  }
  if (options.recommendationCount > 0) {
    return `${options.recommendationCount} profitability recommendation flag${options.recommendationCount === 1 ? "" : "s"} are open on fresh data.`;
  }
  if (options.freshSnapshotCount > 0) {
    return `${options.freshSnapshotCount} fresh profitability snapshot${options.freshSnapshotCount === 1 ? "" : "s"} are available for leadership review.`;
  }
  return "Profitability data imports have started, but leadership-ready snapshot coverage is still building.";
}

function buildHeadline(options: {
  watchCount: number;
  productionItems: ProductionProjectSummaryRecord[];
  staleSnapshotCount: number;
  unresolvedIssueCount: number;
}) {
  const overdueProduction = options.productionItems.filter((project) => isProductionOverdue(project)).length;
  const blockedProduction = options.productionItems.filter(
    (project) => project.stage === "correction_needed" || project.stage === "blocked"
  ).length;
  if (options.watchCount > 0) {
    return `${options.watchCount} profitability watch item${options.watchCount === 1 ? "" : "s"} need leadership review across upcoming shoots, production drag, or calculated recommendations.`;
  }
  if (overdueProduction > 0 || blockedProduction > 0) {
    return `${overdueProduction + blockedProduction} production item${overdueProduction + blockedProduction === 1 ? "" : "s"} are creating delay or rework pressure that can weaken profitability.`;
  }
  if (options.unresolvedIssueCount > 0 || options.staleSnapshotCount > 0) {
    return "Operational signals look steady, but profitability data health still needs cleanup before deeper margin reads are trustworthy.";
  }
  return "Profitability signals are steady right now, with production burden and data health visible in one leadership workspace.";
}

function deriveHeadlineTone(options: {
  watchCount: number;
  productionItems: ProductionProjectSummaryRecord[];
  staleSnapshotCount: number;
  unresolvedIssueCount: number;
}) {
  const overdueProduction = options.productionItems.filter((project) => isProductionOverdue(project)).length;
  const blockedProduction = options.productionItems.filter(
    (project) => project.stage === "correction_needed" || project.stage === "blocked"
  ).length;
  if (options.watchCount > 0 || overdueProduction > 0 || blockedProduction > 0) {
    return "action_needed" as const;
  }
  if (options.unresolvedIssueCount > 0 || options.staleSnapshotCount > 0) {
    return "heads_up" as const;
  }
  return "good" as const;
}

function buildProfitabilityHash(options: {
  focus?: ProfitabilityFocus | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  department?: string | null;
}) {
  const params = new URLSearchParams();
  if (options.focus && options.focus !== "overview") {
    params.set("focus", options.focus);
  }
  if (options.dateFrom) {
    params.set("date_from", options.dateFrom);
  }
  if (options.dateTo) {
    params.set("date_to", options.dateTo);
  }
  if (options.department) {
    params.set("department", options.department);
  }
  const query = params.toString();
  return query ? `#profitability?${query}` : "#profitability";
}

function toneForImportStatus(value: string) {
  if (value === "failed") {
    return "action_needed" as const;
  }
  if (value === "completed_with_issues") {
    return "heads_up" as const;
  }
  if (value === "completed") {
    return "good" as const;
  }
  return "neutral" as const;
}

function isProductionOverdue(project: ProductionProjectSummaryRecord) {
  return project.overdue_task_count > 0 || project.status_tone === "critical";
}

function compareWorkspaceItems(left: ProfitabilityWatchItem, right: ProfitabilityWatchItem) {
  return toneWeight(left.tone) - toneWeight(right.tone) || left.title.localeCompare(right.title);
}

function toneWeight(value: WorkspaceTone) {
  switch (value) {
    case "action_needed":
      return 0;
    case "heads_up":
      return 1;
    case "info":
      return 2;
    case "good":
      return 3;
    default:
      return 4;
  }
}

function humanizeValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
