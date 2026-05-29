import { useEffect, useMemo, useState } from "react";
import type { JobDepartmentType, SharedJobListItem, SharedProductionQueueItem } from "../../jobTruthTypes";
import { listSharedJobs, listSharedProductionQueue } from "../../services/jobsApi";
import type { SessionUser } from "../../types";
import { WorkspaceActionBar } from "./WorkspaceActionBar";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "./WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "./WorkspaceLoadingBlock";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";

type ActiveWorkSource = "jobs" | "production";
type ActiveWorkViewMode = "compact_list" | "board";
type ActiveWorkScopeMode = "my_work" | "team_work";
type ActiveWorkDueFilter = "all" | "overdue" | "today" | "next_3_days" | "next_7_days" | "unscheduled";
type FocusMode = "overview" | "travel" | "pre_service" | "readiness" | "workload";

type Props = {
  token: string;
  currentUser: SessionUser;
  title: string;
  summary: string;
  defaultDepartment?: JobDepartmentType | "all";
  routeHash?: string;
  focus?: FocusMode;
  showDepartmentFilter?: boolean;
  source?: ActiveWorkSource;
  showOpenWorkspaceAction?: boolean;
  openWorkspaceLabel?: string;
};

type CompactActiveWorkRecord = {
  id: string;
  routeHash: string;
  title: string;
  subtitle: string;
  workTypeLabel: string;
  departmentLabel: string;
  departmentValue: string;
  ownerLabel: string;
  ownerUserId: string | null;
  assignedTeamLabel: string;
  photographerLabel: string | null;
  accountRepLabel: string | null;
  productionAssigneeLabel: string | null;
  productionAssigneeUserId: string | null;
  locationLabel: string;
  statusLabel: string;
  statusValue: string;
  dateLabel: string;
  dateValue: string | null;
  dueStateLabel: string;
  nextActionLabel: string;
  assigneeSummary: string;
  riskTone: "danger" | "warning" | "success" | "info";
  riskLabel: string;
  blocked: boolean;
  atRisk: boolean;
  focusFlags: Record<FocusMode, boolean>;
  relatedUserIds: string[];
  searchHaystack: string;
  boardBucketKey: string;
  boardBucketLabel: string;
};

const RISK_OPTIONS = [
  { value: "all", label: "All risk" },
  { value: "danger", label: "Blocked / critical" },
  { value: "warning", label: "At risk" },
  { value: "success", label: "Ready / on track" },
  { value: "info", label: "Standard" }
] as const;

export function CompactActiveWorkPanel({
  token,
  currentUser,
  title,
  summary,
  defaultDepartment = "all",
  routeHash = "#jobs",
  focus = "overview",
  showDepartmentFilter = true,
  source = "jobs",
  showOpenWorkspaceAction = true,
  openWorkspaceLabel = "Open Full Workspace"
}: Props) {
  const [records, setRecords] = useState<CompactActiveWorkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ActiveWorkViewMode>(focus === "workload" ? "board" : "compact_list");
  const [scopeMode, setScopeMode] = useState<ActiveWorkScopeMode>("team_work");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState(defaultDepartment);
  const [status, setStatus] = useState("all");
  const [dueFilter, setDueFilter] = useState<ActiveWorkDueFilter>("all");
  const [riskTone, setRiskTone] = useState<(typeof RISK_OPTIONS)[number]["value"]>("all");
  const [owner, setOwner] = useState("all");
  const [assignedTeam, setAssignedTeam] = useState("all");
  const [photographer, setPhotographer] = useState("all");
  const [accountRep, setAccountRep] = useState("all");
  const [productionAssignee, setProductionAssignee] = useState("all");
  const [location, setLocation] = useState("all");

  useEffect(() => {
    let cancelled = false;

    async function loadRecords() {
      setLoading(true);
      setError("");
      try {
        if (source === "production") {
          const response = await listSharedProductionQueue(token, {
            department_type: defaultDepartment
          });
          if (!cancelled) {
            setRecords(response.items.map((item) => mapProductionItemToRecord(item)));
          }
        } else {
          const response = await listSharedJobs(token, {
            department_type: defaultDepartment
          });
          if (!cancelled) {
            setRecords(response.jobs.map((job) => mapJobToRecord(job)));
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setRecords([]);
          setError(loadError instanceof Error ? loadError.message : "We couldn't load active work right now.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRecords();
    return () => {
      cancelled = true;
    };
  }, [defaultDepartment, source, token]);

  useEffect(() => {
    setDepartment(defaultDepartment);
  }, [defaultDepartment]);

  const statusOptions = useMemo(() => buildOptions(records, (record) => record.statusValue, (record) => record.statusLabel, "All statuses"), [records]);
  const ownerOptions = useMemo(() => buildOptions(records, (record) => record.ownerLabel, (record) => record.ownerLabel, "All owners"), [records]);
  const teamOptions = useMemo(
    () => buildOptions(records, (record) => record.assignedTeamLabel, (record) => record.assignedTeamLabel, "All teams"),
    [records]
  );
  const photographerOptions = useMemo(() => buildOptionalOptions(records, (record) => record.photographerLabel, "All photographers"), [records]);
  const accountRepOptions = useMemo(() => buildOptionalOptions(records, (record) => record.accountRepLabel, "All account reps"), [records]);
  const productionAssigneeOptions = useMemo(
    () => buildOptionalOptions(records, (record) => record.productionAssigneeLabel, "All production assignees"),
    [records]
  );
  const locationOptions = useMemo(
    () => buildOptions(records, (record) => record.locationLabel, (record) => record.locationLabel, "All locations"),
    [records]
  );

  const filteredRecords = useMemo(
    () =>
      records
        .filter((record) => record.focusFlags[focus])
        .filter((record) => department === "all" || record.departmentValue === department)
        .filter((record) => status === "all" || record.statusValue === status)
        .filter((record) => owner === "all" || record.ownerLabel === owner)
        .filter((record) => assignedTeam === "all" || record.assignedTeamLabel === assignedTeam)
        .filter((record) => photographer === "all" || record.photographerLabel === photographer)
        .filter((record) => accountRep === "all" || record.accountRepLabel === accountRep)
        .filter((record) => productionAssignee === "all" || record.productionAssigneeLabel === productionAssignee)
        .filter((record) => location === "all" || record.locationLabel === location)
        .filter((record) => riskTone === "all" || record.riskTone === riskTone)
        .filter((record) => matchesDueFilter(record.dateValue, dueFilter))
        .filter((record) => scopeMode === "team_work" || record.relatedUserIds.includes(currentUser.id))
        .filter((record) => record.searchHaystack.includes(search.trim().toLowerCase()))
        .sort(compareRecordsForScan),
    [
      accountRep,
      assignedTeam,
      currentUser.id,
      department,
      dueFilter,
      focus,
      location,
      owner,
      photographer,
      productionAssignee,
      records,
      riskTone,
      scopeMode,
      search,
      status
    ]
  );

  const boardGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: CompactActiveWorkRecord[] }>();
    filteredRecords.forEach((record) => {
      const existing = groups.get(record.boardBucketKey);
      if (existing) {
        existing.items.push(record);
        return;
      }
      groups.set(record.boardBucketKey, { label: record.boardBucketLabel, items: [record] });
    });
    return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
  }, [filteredRecords]);

  const summaryCounts = useMemo(
    () => ({
      inView: filteredRecords.length,
      blocked: filteredRecords.filter((record) => record.blocked).length,
      atRisk: filteredRecords.filter((record) => record.atRisk).length,
      dueSoon: filteredRecords.filter((record) => matchesDueFilter(record.dateValue, "today") || matchesDueFilter(record.dateValue, "next_3_days")).length
    }),
    [filteredRecords]
  );

  const hasActiveFilters =
    department !== defaultDepartment ||
    status !== "all" ||
    dueFilter !== "all" ||
    riskTone !== "all" ||
    owner !== "all" ||
    assignedTeam !== "all" ||
    photographer !== "all" ||
    accountRep !== "all" ||
    productionAssignee !== "all" ||
    location !== "all" ||
    search.trim().length > 0;

  if (loading) {
    return <WorkspaceLoadingBlock title={`Loading ${title.toLowerCase()}`} summary={summary} />;
  }

  return (
    <section className="panel compact-active-work">
      <WorkspaceSectionHeader
        eyebrow="Active Work"
        title={title}
        summary={summary}
        badge={<span className="metric-pill">{summaryCounts.inView} in view</span>}
        actions={
          <WorkspaceActionBar compact>
            <div className="compact-active-work__mode-group" aria-label="Work scope mode">
              <button
                type="button"
                className={scopeMode === "my_work" ? "secondary-button is-active" : "secondary-button"}
                onClick={() => setScopeMode("my_work")}
              >
                My Work
              </button>
              <button
                type="button"
                className={scopeMode === "team_work" ? "secondary-button is-active" : "secondary-button"}
                onClick={() => setScopeMode("team_work")}
              >
                Team Work
              </button>
            </div>
            <div className="compact-active-work__mode-group" aria-label="Active work view mode">
              <button
                type="button"
                className={viewMode === "compact_list" ? "secondary-button is-active" : "secondary-button"}
                onClick={() => setViewMode("compact_list")}
              >
                Compact List
              </button>
              <button
                type="button"
                className={viewMode === "board" ? "secondary-button is-active" : "secondary-button"}
                onClick={() => setViewMode("board")}
              >
                Board
              </button>
            </div>
            {showOpenWorkspaceAction ? (
              <button type="button" onClick={() => (window.location.hash = routeHash)}>
                {openWorkspaceLabel}
              </button>
            ) : null}
          </WorkspaceActionBar>
        }
      />
      <div className="compact-active-work__summary-grid" aria-label="Active work summary">
        <article className="compact-active-work__summary-card compact-active-work__summary-card--neutral">
          <span>Open work</span>
          <strong>{summaryCounts.inView}</strong>
        </article>
        <article className="compact-active-work__summary-card compact-active-work__summary-card--danger">
          <span>Blocked</span>
          <strong>{summaryCounts.blocked}</strong>
        </article>
        <article className="compact-active-work__summary-card compact-active-work__summary-card--warning">
          <span>At risk</span>
          <strong>{summaryCounts.atRisk}</strong>
        </article>
        <article className="compact-active-work__summary-card compact-active-work__summary-card--info">
          <span>Due soon</span>
          <strong>{summaryCounts.dueSoon}</strong>
        </article>
      </div>

      <WorkspaceFilterToolbar className="compact-active-work__filters">
        <div className="workspace-toolbar__group">
          <label className="filter-field filter-field--wide">
            <span>Find work</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, owner, organization, location, or next move" />
          </label>
          {showDepartmentFilter ? (
            <label className="filter-field">
              <span>Department</span>
              <select value={department} onChange={(event) => setDepartment(event.target.value as JobDepartmentType | "all")}>
                <option value="all">All departments</option>
                <option value="schools">Schools</option>
                <option value="sports">Sports</option>
                <option value="corporate">Corporate</option>
                <option value="headshots">Headshots</option>
                <option value="other">Other</option>
              </select>
            </label>
          ) : null}
          <label className="filter-field">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Due</span>
            <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value as ActiveWorkDueFilter)}>
              <option value="all">All due states</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="next_3_days">Next 3 days</option>
              <option value="next_7_days">Next 7 days</option>
              <option value="unscheduled">Date missing</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Risk</span>
            <select value={riskTone} onChange={(event) => setRiskTone(event.target.value as (typeof RISK_OPTIONS)[number]["value"])}>
              {RISK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="workspace-toolbar__actions compact-active-work__filter-actions">
          <button type="button" className="secondary-button" onClick={() => setShowAdvancedFilters((current) => !current)}>
            {showAdvancedFilters ? "Hide Extra Filters" : "More Filters"}
          </button>
          {hasActiveFilters ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setDepartment(defaultDepartment);
                setStatus("all");
                setDueFilter("all");
                setRiskTone("all");
                setOwner("all");
                setAssignedTeam("all");
                setPhotographer("all");
                setAccountRep("all");
                setProductionAssignee("all");
                setLocation("all");
              }}
            >
              Reset Filters
            </button>
          ) : null}
        </div>
      </WorkspaceFilterToolbar>

      {showAdvancedFilters ? (
        <WorkspaceFilterToolbar className="compact-active-work__filters compact-active-work__filters--advanced">
          <div className="workspace-toolbar__group">
            <label className="filter-field">
              <span>Owner</span>
              <select value={owner} onChange={(event) => setOwner(event.target.value)}>
                {ownerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Assigned team</span>
              <select value={assignedTeam} onChange={(event) => setAssignedTeam(event.target.value)}>
                {teamOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Photographer</span>
              <select value={photographer} onChange={(event) => setPhotographer(event.target.value)}>
                {photographerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Account rep</span>
              <select value={accountRep} onChange={(event) => setAccountRep(event.target.value)}>
                {accountRepOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Production assignee</span>
              <select value={productionAssignee} onChange={(event) => setProductionAssignee(event.target.value)}>
                {productionAssigneeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Location</span>
              <select value={location} onChange={(event) => setLocation(event.target.value)}>
                {locationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </WorkspaceFilterToolbar>
      ) : null}

      {error ? (
        <WorkspaceEmptyState
          title="Active work is unavailable"
          summary={error}
          actions={
            <button type="button" className="secondary-button" onClick={() => window.location.reload()}>
              Retry
            </button>
          }
        />
      ) : null}

      {!error && !filteredRecords.length ? (
        <WorkspaceEmptyState
          title={hasActiveFilters ? "No work matches these filters" : "No active work is surfacing right now"}
          summary={
            hasActiveFilters
              ? "Try widening the filters so the next owner, deadline, or blocker can surface again."
              : "This strip stays intentionally compact. As new work, risk, or blockers show up, they will appear here first."
          }
        />
      ) : null}

      {!error && filteredRecords.length ? (
        viewMode === "compact_list" ? (
          <div className="compact-active-work__list" role="table" aria-label={title}>
            <div className="compact-active-work__row compact-active-work__row--head" role="row">
              <span role="columnheader">Status</span>
              <span role="columnheader">Title</span>
              <span role="columnheader">Work type</span>
              <span role="columnheader">Date</span>
              <span role="columnheader">Owner</span>
              <span role="columnheader">Team</span>
              <span role="columnheader">Next action</span>
              <span role="columnheader">Risk</span>
            </div>
            {filteredRecords.slice(0, 14).map((record) => (
              <button
                key={record.id}
                type="button"
                className={`compact-active-work__row compact-active-work__row--${record.riskTone}`}
                onClick={() => {
                  window.location.hash = record.routeHash;
                }}
              >
                <span className="compact-active-work__status-cell">
                  <span className={`compact-active-work__status-dot compact-active-work__status-dot--${record.riskTone}`} aria-hidden="true" />
                  <strong>{record.statusLabel}</strong>
                </span>
                <span className="compact-active-work__title-cell">
                  <strong>{record.title}</strong>
                  <small>{record.subtitle}</small>
                </span>
                <span>{record.workTypeLabel}</span>
                <span className="compact-active-work__date-cell">
                  <strong>{record.dateLabel}</strong>
                  <small>{record.dueStateLabel}</small>
                </span>
                <span>{record.ownerLabel}</span>
                <span className="compact-active-work__team-cell">
                  <strong>{record.assignedTeamLabel}</strong>
                  <small>{record.assigneeSummary}</small>
                </span>
                <span className="compact-active-work__action-cell">{record.nextActionLabel}</span>
                <span className={`compact-active-work__risk-badge compact-active-work__risk-badge--${record.riskTone}`}>{record.riskLabel}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="compact-active-work__board">
            {boardGroups.map((group) => (
              <section key={group.key} className="compact-active-work__board-column">
                <div className="compact-active-work__board-column-header">
                  <strong>{group.label}</strong>
                  <span className="metric-pill">{group.items.length}</span>
                </div>
                <div className="compact-active-work__board-stack">
                  {group.items.slice(0, 6).map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      className={`compact-active-work__board-card compact-active-work__board-card--${record.riskTone}`}
                      onClick={() => {
                        window.location.hash = record.routeHash;
                      }}
                    >
                      <div className="compact-active-work__board-card-top">
                        <span className="eyebrow">{record.departmentLabel}</span>
                        <span className={`compact-active-work__risk-badge compact-active-work__risk-badge--${record.riskTone}`}>{record.riskLabel}</span>
                      </div>
                      <strong>{record.title}</strong>
                      <p>{record.nextActionLabel}</p>
                      <div className="compact-active-work__board-meta">
                        <span>{record.dateLabel}</span>
                        <span>{record.ownerLabel}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

function mapJobToRecord(job: SharedJobListItem): CompactActiveWorkRecord {
  const productionAssigneeLabel =
    readSummaryString(job.department_summary, [
      "production_assignee_name",
      "production_owner_name",
      "assigned_to_name",
      "productionAssigneeName"
    ]) ?? null;
  const productionAssigneeUserId =
    readSummaryString(job.department_summary, [
      "production_assignee_user_id",
      "production_owner_user_id",
      "assigned_to_user_id",
      "productionAssigneeUserId"
    ]) ?? null;
  const blocked = job.blocker_count > 0 || job.job_status === "intake_blocked" || job.job_status === "weather_hold";
  const riskTone = getJobRiskTone(job);
  const boardBucket = getGenericBoardBucket({ blocked, riskTone, dateValue: job.primary_day_date, statusValue: job.job_status });

  return {
    id: job.id,
    routeHash: `#jobs/${job.id}`,
    title: job.title,
    subtitle: job.organization_name ?? "Unlinked organization",
    workTypeLabel: humanizeValue(job.job_category),
    departmentLabel: humanizeValue(job.department_type),
    departmentValue: job.department_type,
    ownerLabel: job.lead_owner_name ?? job.account_owner_name ?? "Unassigned",
    ownerUserId: job.lead_owner_user_id ?? job.account_owner_user_id,
    assignedTeamLabel:
      readSummaryString(job.department_summary, ["assigned_team", "team_name", "team", "workload_group"]) ??
      `${humanizeValue(job.department_type)} Team`,
    photographerLabel: job.lead_owner_name,
    accountRepLabel: job.account_owner_name,
    productionAssigneeLabel,
    productionAssigneeUserId,
    locationLabel: job.primary_location_name ?? "Location TBD",
    statusLabel: humanizeValue(job.job_status),
    statusValue: job.job_status,
    dateLabel: formatPrimaryDate(job.primary_day_date),
    dateValue: job.primary_day_date,
    dueStateLabel: describeDateState(job.primary_day_date),
    nextActionLabel: describeJobNextAction(job),
    assigneeSummary: describeJobCoverage(job),
    riskTone,
    riskLabel: blocked ? `${job.blocker_count || 1} blocker${job.blocker_count === 1 ? "" : "s"}` : humanizeValue(job.risk_status),
    blocked,
    atRisk: riskTone === "danger" || riskTone === "warning",
    focusFlags: {
      overview: !["archived", "cancelled"].includes(job.job_status),
      travel: job.job_status !== "archived" && job.job_status !== "cancelled" && job.primary_day_date != null,
      pre_service: ["confirmed", "ready_to_staff", "staffed", "ready_to_execute"].includes(job.job_status),
      readiness: job.readiness_status !== "ready" || job.staffing_status !== "ready_confirmed" || blocked,
      workload: !["execution_complete", "archived", "cancelled"].includes(job.job_status)
    },
    relatedUserIds: [job.lead_owner_user_id, job.account_owner_user_id, productionAssigneeUserId].filter((value): value is string => Boolean(value)),
    searchHaystack: [
      job.title,
      job.job_number,
      job.organization_name,
      job.primary_location_name,
      job.primary_contact_name,
      job.lead_owner_name,
      job.account_owner_name,
      productionAssigneeLabel
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    boardBucketKey: boardBucket.key,
    boardBucketLabel: boardBucket.label
  };
}

function mapProductionItemToRecord(item: SharedProductionQueueItem): CompactActiveWorkRecord {
  const blocked = item.blocking_issue_count > 0 || item.health_state === "BLOCKED" || item.workflow_status === "BLOCKED";
  const riskTone = getProductionRiskTone(item);
  const dueValue = item.release_due_at ?? item.due_at ?? item.shoot_date_end ?? item.shoot_date_start;
  const boardBucket = getGenericBoardBucket({ blocked, riskTone, dateValue: dueValue, statusValue: item.workflow_status });

  return {
    id: item.id,
    routeHash: `#jobs/${item.job_id}?tab=production`,
    title: item.title,
    subtitle: item.organization_name ?? item.job_title,
    workTypeLabel: humanizeValue(item.production_type),
    departmentLabel: humanizeValue(item.department_type),
    departmentValue: item.department_type,
    ownerLabel: item.assigned_to_name ?? item.account_owner_name ?? "Unassigned",
    ownerUserId: item.assigned_to_user_id ?? item.account_owner_user_id,
    assignedTeamLabel: `${humanizeValue(item.department_type)} Production`,
    photographerLabel: null,
    accountRepLabel: item.account_owner_name,
    productionAssigneeLabel: item.assigned_to_name,
    productionAssigneeUserId: item.assigned_to_user_id,
    locationLabel: item.primary_location_name ?? "Location TBD",
    statusLabel: humanizeValue(item.workflow_status),
    statusValue: item.workflow_status,
    dateLabel: formatPrimaryDateTime(dueValue),
    dateValue: dueValue,
    dueStateLabel: describeDateState(dueValue),
    nextActionLabel: describeProductionNextAction(item),
    assigneeSummary: describeProductionAssigneeSummary(item),
    riskTone,
    riskLabel: blocked ? `${Math.max(item.blocking_issue_count, item.open_blocker_count, 1)} blockers` : humanizeValue(item.health_state),
    blocked,
    atRisk: ["WATCH", "AT_RISK", "OVERDUE", "BLOCKED"].includes(item.health_state),
    focusFlags: {
      overview: !["DELIVERED_CLOSED", "CANCELLED"].includes(item.workflow_status),
      travel: true,
      pre_service: true,
      readiness: !["READY_FOR_RELEASE", "RELEASED", "DELIVERED_CLOSED"].includes(item.workflow_status) || blocked,
      workload: !["DELIVERED_CLOSED", "CANCELLED"].includes(item.workflow_status)
    },
    relatedUserIds: [
      item.assigned_to_user_id,
      item.account_owner_user_id,
      item.assigned_peer_reviewer_user_id,
      item.assigned_release_reviewer_user_id,
      item.escalation_owner_user_id
    ].filter((value): value is string => Boolean(value)),
    searchHaystack: [
      item.title,
      item.job_number,
      item.job_title,
      item.organization_name,
      item.primary_location_name,
      item.assigned_to_name,
      item.account_owner_name,
      item.assigned_peer_reviewer_name,
      item.assigned_release_reviewer_name
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    boardBucketKey: boardBucket.key,
    boardBucketLabel: boardBucket.label
  };
}

function buildOptions(
  records: CompactActiveWorkRecord[],
  getValue: (record: CompactActiveWorkRecord) => string,
  getLabel: (record: CompactActiveWorkRecord) => string,
  fallbackLabel: string
) {
  const values = new Map<string, string>();
  records.forEach((record) => {
    const value = getValue(record);
    if (value) {
      values.set(value, getLabel(record));
    }
  });
  return [{ value: "all", label: fallbackLabel }, ...Array.from(values.entries()).sort((left, right) => left[1].localeCompare(right[1])).map(([value, label]) => ({ value, label }))];
}

function buildOptionalOptions(records: CompactActiveWorkRecord[], getValue: (record: CompactActiveWorkRecord) => string | null, fallbackLabel: string) {
  const values = new Map<string, string>();
  records.forEach((record) => {
    const value = getValue(record);
    if (value) {
      values.set(value, value);
    }
  });
  return [{ value: "all", label: fallbackLabel }, ...Array.from(values.entries()).sort((left, right) => left[1].localeCompare(right[1])).map(([value, label]) => ({ value, label }))];
}

function compareRecordsForScan(left: CompactActiveWorkRecord, right: CompactActiveWorkRecord) {
  return getRecordSortRank(left) - getRecordSortRank(right) || compareDateValue(left.dateValue, right.dateValue) || left.title.localeCompare(right.title);
}

function getRecordSortRank(record: CompactActiveWorkRecord) {
  if (record.blocked) {
    return 0;
  }
  if (record.dueStateLabel === "Overdue") {
    return 1;
  }
  if (record.dueStateLabel === "Due today") {
    return 2;
  }
  if (record.riskTone === "danger") {
    return 3;
  }
  if (record.riskTone === "warning") {
    return 4;
  }
  return 5;
}

function matchesDueFilter(dateValue: string | null, filter: ActiveWorkDueFilter) {
  if (filter === "all") {
    return true;
  }
  if (!dateValue) {
    return filter === "unscheduled";
  }
  const diff = getDayDifference(dateValue);
  if (diff == null) {
    return filter === "unscheduled";
  }
  if (filter === "overdue") {
    return diff < 0;
  }
  if (filter === "today") {
    return diff === 0;
  }
  if (filter === "next_3_days") {
    return diff >= 0 && diff <= 3;
  }
  if (filter === "next_7_days") {
    return diff >= 0 && diff <= 7;
  }
  return false;
}

function getDayDifference(value: string) {
  const dateOnly = value.includes("T") ? value.slice(0, 10) : value;
  const parsed = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return Math.round((targetDate.getTime() - todayDate.getTime()) / 86_400_000);
}

function describeDateState(value: string | null) {
  if (!value) {
    return "Date missing";
  }
  const diff = getDayDifference(value);
  if (diff == null) {
    return "Date pending";
  }
  if (diff < 0) {
    return "Overdue";
  }
  if (diff === 0) {
    return "Due today";
  }
  if (diff <= 3) {
    return "Due within 3 days";
  }
  if (diff <= 7) {
    return "Due within 7 days";
  }
  return "Upcoming";
}

function compareDateValue(left: string | null, right: string | null) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  return left.localeCompare(right);
}

function formatPrimaryDate(value: string | null) {
  if (!value) {
    return "Date TBD";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatPrimaryDateTime(value: string | null) {
  if (!value) {
    return "Date TBD";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return formatPrimaryDate(value.slice(0, 10));
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getJobRiskTone(job: SharedJobListItem): CompactActiveWorkRecord["riskTone"] {
  if (job.blocker_count > 0 || job.job_status === "intake_blocked" || job.job_status === "weather_hold" || job.risk_status === "critical") {
    return "danger";
  }
  if (job.risk_status === "high" || job.risk_status === "medium") {
    return "warning";
  }
  if (job.readiness_status === "ready" || job.staffing_status === "ready_confirmed") {
    return "success";
  }
  return "info";
}

function getProductionRiskTone(item: SharedProductionQueueItem): CompactActiveWorkRecord["riskTone"] {
  if (item.blocking_issue_count > 0 || item.health_state === "BLOCKED" || item.health_state === "OVERDUE") {
    return "danger";
  }
  if (item.health_state === "AT_RISK" || item.health_state === "WATCH" || item.workflow_status === "REWORK_REQUIRED") {
    return "warning";
  }
  if (["READY_FOR_RELEASE", "RELEASED", "DELIVERED_CLOSED"].includes(item.workflow_status)) {
    return "success";
  }
  return "info";
}

function getGenericBoardBucket(input: {
  blocked: boolean;
  riskTone: CompactActiveWorkRecord["riskTone"];
  dateValue: string | null;
  statusValue: string;
}) {
  if (input.blocked || input.riskTone === "danger") {
    return { key: "attention", label: "Needs attention" };
  }
  if (matchesDueFilter(input.dateValue, "today") || matchesDueFilter(input.dateValue, "overdue")) {
    return { key: "due_now", label: "Due now" };
  }
  if (input.statusValue.toLowerCase().includes("ready") || input.statusValue.toLowerCase().includes("review")) {
    return { key: "ready_next", label: "Ready next" };
  }
  return { key: "active", label: "In flight" };
}

function describeJobCoverage(job: SharedJobListItem) {
  return `${job.assigned_staff_count} assigned / ${job.ready_present_count > 0 ? job.ready_present_count : job.checked_in_staff_count} active`;
}

function describeJobNextAction(job: SharedJobListItem) {
  if (job.blocker_count > 0 || job.job_status === "intake_blocked" || job.job_status === "weather_hold") {
    return "Clear blockers before the crew moves.";
  }
  if (job.readiness_status !== "ready") {
    return "Finish readiness checks and field prep.";
  }
  if (job.staffing_status === "gap_flagged" || job.staffing_status === "unassigned" || job.job_status === "ready_to_staff") {
    return "Close staffing gaps and confirm coverage.";
  }
  if (job.staffing_status === "staffed" || job.job_status === "ready_to_execute") {
    return "Confirm pre-service and final field logistics.";
  }
  if (job.job_status === "in_progress") {
    return "Support live execution and watch for issues.";
  }
  if (job.production_required && job.production_status !== "complete") {
    return "Keep the handoff into production clean.";
  }
  return "Keep the next milestone moving.";
}

function describeProductionNextAction(item: SharedProductionQueueItem) {
  if (item.blocking_issue_count > 0 || item.health_state === "BLOCKED") {
    return "Resolve blockers and restore downstream flow.";
  }
  if (item.checklist_missing_proof_count > 0) {
    return "Attach missing proof before the next gate.";
  }
  if (item.checklist_awaiting_approval_count > 0) {
    return "Clear overdue approvals and manager sign-off.";
  }
  if (item.workflow_status === "WAITING_ON_FILES") {
    return "Close the file receipt gap before production starts.";
  }
  if (item.workflow_status === "READY_FOR_QA" || item.workflow_status === "IN_PEER_REVIEW") {
    return "Move peer review and QA to the next decision.";
  }
  if (item.workflow_status === "READY_FOR_UPLOAD" || item.workflow_status === "UPLOADING") {
    return "Verify upload and prepare the release path.";
  }
  if (item.workflow_status === "UPLOADED" || item.workflow_status === "READY_FOR_RELEASE") {
    return "Finish release review and push the delivery path.";
  }
  return "Keep downstream work moving.";
}

function describeProductionAssigneeSummary(item: SharedProductionQueueItem) {
  const checklistBurden = item.checklist_overdue_count + item.checklist_awaiting_approval_count + item.checklist_rejected_count;
  if (checklistBurden > 0) {
    return `${checklistBurden} checklist issue${checklistBurden === 1 ? "" : "s"}`;
  }
  if (item.open_issue_count > 0) {
    return `${item.open_issue_count} open issue${item.open_issue_count === 1 ? "" : "s"}`;
  }
  if (item.open_blocker_count > 0) {
    return `${item.open_blocker_count} blocker${item.open_blocker_count === 1 ? "" : "s"}`;
  }
  return item.assigned_peer_reviewer_name
    ? `Peer review: ${item.assigned_peer_reviewer_name}`
    : item.assigned_release_reviewer_name
      ? `Release review: ${item.assigned_release_reviewer_name}`
      : "Assignment pending";
}

function readSummaryString(summary: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = summary[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
