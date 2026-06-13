import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import { JobIntakeLauncherCard } from "../components/jobIntake/JobIntakeLauncherCard";
import { QuickCreateJobDrawer } from "../components/jobIntake/QuickCreateJobDrawer";
import { ResumeDraftsDrawer } from "../components/jobIntake/ResumeDraftsDrawer";
import { SmartPasteJobDrawer } from "../components/jobIntake/SmartPasteJobDrawer";
import {
  DetailPreviewPanel,
  RiskBadge,
  SavedViewBar,
  StatusPill,
  formatDate,
  formatTimeRange,
  humanizeToken,
  statusTone,
  useHashRouteSnapshot
} from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { featureFlags } from "../featureFlags";
import { canCreateShootRecords } from "../permissions";
import { getSportsShootDetail, listSportsShoots } from "../services/sportsApi";
import type { SportsShootDetailResponse, SportsShootListFilters, SportsShootListResponse, SportsShootSummary } from "../sportsTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

function readFilters(params: URLSearchParams): SportsShootListFilters {
  return {
    search: params.get("search"),
    view: (params.get("view") as SportsShootListFilters["view"]) ?? "list",
    date_from: params.get("date_from"),
    date_to: params.get("date_to"),
    sport_type: params.get("sport_type"),
    season: params.get("season"),
    shoot_status: params.get("shoot_status") as SportsShootListFilters["shoot_status"],
    production_status: params.get("production_status") as SportsShootListFilters["production_status"],
    proof_status: params.get("proof_status") as SportsShootListFilters["proof_status"],
    staffing_status: params.get("staffing_status") as SportsShootListFilters["staffing_status"],
    readiness_status: params.get("readiness_status") as SportsShootListFilters["readiness_status"],
    risk_status: params.get("risk_status") as SportsShootListFilters["risk_status"],
    saved_view: params.get("saved_view")
  };
}

function writeFilters(next: SportsShootListFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    params.set(key, String(value));
  }
  const query = params.toString();
  window.location.hash = query ? `#sports/shoots?${query}` : "#sports/shoots";
}

function exportRows(items: SportsShootSummary[]) {
  const headers = ["job_number", "organization", "event_name", "sport_type", "season", "shoot_date", "location", "shoot_status", "production_status", "readiness_status"];
  const lines = [
    headers.join(","),
    ...items.map((item) =>
      [
        item.job_number ?? item.shoot_code,
        item.organization_name ?? "",
        item.title,
        item.sport_type ?? "",
        item.season ?? "",
        item.shoot_date ?? "",
        item.location_name ?? "",
        item.shoot_status,
        item.production_status,
        item.readiness_status
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    )
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sports-shoots.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function SportsShoots({ token, currentUser }: Props) {
  const { params } = useHashRouteSnapshot();
  const [workspace, setWorkspace] = useState<SportsShootListResponse | null>(null);
  const [detail, setDetail] = useState<SportsShootDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedShootId, setSelectedShootId] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [smartPasteOpen, setSmartPasteOpen] = useState(false);
  const [resumeDraftsOpen, setResumeDraftsOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);

  const filters = useMemo(() => readFilters(params), [params]);
  const canCreate = canCreateShootRecords(currentUser);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSportsShoots(token, filters)
      .then((response) => {
        if (!cancelled) {
          setWorkspace(response);
          const routeSelectedId = window.location.hash.match(/#sports\/shoots\/([0-9a-f-]{36})/i)?.[1] ?? null;
          const preferredId =
            routeSelectedId && response.items.some((item) => item.id === routeSelectedId)
              ? routeSelectedId
              : response.items[0]?.id ?? null;
          setSelectedShootId(preferredId);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiClientError ? err.message : "We couldn't load sports shoots right now.");
          setWorkspace(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters, token]);

  useEffect(() => {
    if (!selectedShootId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getSportsShootDetail(token, selectedShootId)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedShootId, token]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading sports shoots" summary="Opening the sports master board with live filters and detail context." />;
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports Shoots"
        summary="Operational master board for all sports shoots, with sports-specific filters, saved views, and a stable preview rail."
        meta={workspace ? [
          { label: `${workspace.summary.total} live jobs`, tone: "info" },
          { label: `${workspace.summary.at_risk} at risk`, tone: workspace.summary.at_risk ? "warning" : "success" }
        ] : []}
        actions={
          <WorkspaceActionBar align="end">
            <button type="button" onClick={() => setQuickCreateOpen(true)} disabled={!canCreate}>
              New Sports Job
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/shoots/import")} disabled={!canCreate}>
              Import
            </button>
            <button type="button" className="secondary-button" onClick={() => exportRows(workspace?.items ?? [])} disabled={!workspace?.items.length}>
              Export
            </button>
          </WorkspaceActionBar>
        }
      />

      {featureFlags.centralJobIntakeV1 ? (
        <>
          <JobIntakeLauncherCard
            department="sports"
            contextLabel="Sports"
            canCreate={canCreate}
            onQuickCreate={() => setQuickCreateOpen(true)}
            onSmartPaste={() => setSmartPasteOpen(true)}
            onImportFile={() => {
              window.location.hash = "#sports/shoots/import";
            }}
            onResumeDrafts={() => setResumeDraftsOpen(true)}
          />
          <ResumeDraftsDrawer
            open={resumeDraftsOpen}
            token={token}
            department="sports"
            launchLabel="Sports shoots board"
            onClose={() => setResumeDraftsOpen(false)}
            onResumeDraft={(draftId) => {
              setResumeDraftsOpen(false);
              setResumeDraftId(draftId);
              setQuickCreateOpen(true);
            }}
          />
          <QuickCreateJobDrawer
            open={quickCreateOpen}
            token={token}
            currentUser={currentUser}
            defaultDepartment="sports"
            launchLabel="Sports shoots board"
            resumeDraftId={resumeDraftId}
            onClose={() => {
              setQuickCreateOpen(false);
              setResumeDraftId(null);
            }}
            onPublished={(jobId) => {
              setQuickCreateOpen(false);
              setResumeDraftId(null);
              window.location.hash = `#sports/shoots/${jobId}`;
            }}
          />
          <SmartPasteJobDrawer
            open={smartPasteOpen}
            token={token}
            currentUser={currentUser}
            defaultDepartment="sports"
            launchLabel="Sports shoots board"
            onClose={() => setSmartPasteOpen(false)}
            onPublished={(jobId) => {
              setSmartPasteOpen(false);
              window.location.hash = `#sports/shoots/${jobId}`;
            }}
          />
        </>
      ) : null}

      <WorkspaceFilterToolbar className="sports-filter-toolbar">
        <label className="filter-field">
          <span>Search</span>
          <input value={filters.search ?? ""} onChange={(event) => writeFilters({ ...filters, search: event.target.value || null })} placeholder="Job number, organization, event, team, or contact" />
        </label>
        <label className="filter-field">
          <span>View</span>
          <select value={filters.view ?? "list"} onChange={(event) => writeFilters({ ...filters, view: event.target.value as SportsShootListFilters["view"] })}>
            <option value="list">List</option>
            <option value="calendar">Calendar</option>
            <option value="kanban">Kanban</option>
            <option value="timeline">Timeline</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Shoot Status</span>
          <input value={filters.shoot_status ?? ""} onChange={(event) => writeFilters({ ...filters, shoot_status: (event.target.value || null) as SportsShootListFilters["shoot_status"] })} placeholder="confirmed, ready_to_shoot…" />
        </label>
        <label className="filter-field">
          <span>Sport Type</span>
          <input value={filters.sport_type ?? ""} onChange={(event) => writeFilters({ ...filters, sport_type: event.target.value || null })} placeholder="Football, hockey, volleyball…" />
        </label>
        <label className="filter-field">
          <span>Season</span>
          <input value={filters.season ?? ""} onChange={(event) => writeFilters({ ...filters, season: event.target.value || null })} placeholder="Fall, winter…" />
        </label>
        <SavedViewBar
          views={[
            { key: "next_14_days", label: "Next 14 Days" },
            { key: "at_risk", label: "At Risk" },
            { key: "missing_info", label: "Missing Info" },
            { key: "missing_staffing", label: "Missing Staffing" },
            { key: "ready_to_shoot", label: "Ready to Shoot" },
            { key: "waiting_on_approval", label: "Waiting on Approval" }
          ]}
          activeKey={filters.saved_view ?? null}
          onSelect={(key) => writeFilters({ ...filters, saved_view: key })}
        />
      </WorkspaceFilterToolbar>

      {error ? <div className="error-banner">{error}</div> : null}

      {!workspace || !workspace.items.length ? (
        <WorkspaceEmptyState
          title="No sports shoots match these filters"
          summary="Change the filters or create a new sports job to start populating the board."
          actions={
            canCreate ? (
              <button type="button" onClick={() => setQuickCreateOpen(true)}>
                New Sports Job
              </button>
            ) : null
          }
        />
      ) : (
        <div className="sports-split-pane">
          <section className="panel sports-master-table">
            <div className="sports-master-table__header">
              <strong>{humanizeToken(filters.view ?? "list")} view</strong>
              <span>{workspace.items.length} jobs</span>
            </div>
            <div className="sports-master-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th>Risk</th>
                    <th>Job</th>
                    <th>Organization</th>
                    <th>Sport</th>
                    <th>Season</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Location</th>
                    <th>Lead</th>
                    <th>Teams</th>
                    <th>Status</th>
                    <th>Proof</th>
                    <th>Readiness</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.items.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selectedShootId ? "is-selected" : ""}
                      onClick={() => setSelectedShootId(item.id)}
                    >
                      <td><RiskBadge level={item.risk_status} /></td>
                      <td>
                        <div className="sports-table__primary">{item.job_number ?? item.shoot_code}</div>
                        <div className="sports-table__secondary">{item.title}</div>
                      </td>
                      <td>{item.organization_name ?? "Unresolved account"}</td>
                      <td>{humanizeToken(item.sport_type)}</td>
                      <td>{humanizeToken(item.season)}</td>
                      <td>{formatDate(item.shoot_date)}</td>
                      <td>{formatTimeRange(item.start_time, item.end_time)}</td>
                      <td>{item.location_name ?? "Location pending"}</td>
                      <td>{item.lead_photographer_name ?? "Lead needed"}</td>
                      <td>{item.estimated_team_count ?? "TBD"}</td>
                      <td><StatusPill label={humanizeToken(item.shoot_status)} tone={statusTone(item.shoot_status)} /></td>
                      <td><StatusPill label={humanizeToken(item.proof_status)} tone={statusTone(item.proof_status)} /></td>
                      <td><StatusPill label={humanizeToken(item.readiness_status)} tone={statusTone(item.readiness_status)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <DetailPreviewPanel
            title={detail?.summary.title ?? "Select a sports shoot"}
            subtitle={
              detail
                ? `${detail.summary.organization_name ?? "Account pending"} | ${formatDate(detail.summary.shoot_date)}`
                : "Keep the list visible while you inspect the selected shoot."
            }
            actions={
              detail ? (
                <WorkspaceActionBar align="end">
                  <button type="button" onClick={() => (window.location.hash = `#sports/shoots/${detail.summary.id}`)}>
                    Open Detail
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!detail.linked_context.production_hash}
                    onClick={() => detail.linked_context.production_hash && (window.location.hash = detail.linked_context.production_hash)}
                  >
                    Open Production
                  </button>
                </WorkspaceActionBar>
              ) : null
            }
          >
            {detailLoading ? (
              <WorkspaceLoadingBlock title="Loading shoot preview" summary="Pulling readiness, staffing, and downstream context for the selected sports shoot." />
            ) : detail ? (
              <div className="sports-preview-stack">
                <div className="sports-preview-metrics">
                  <div className="sports-preview-metric">
                    <span>Readiness</span>
                    <strong>{detail.readiness.percent_complete}%</strong>
                  </div>
                  <div className="sports-preview-metric">
                    <span>Assigned Crew</span>
                    <strong>
                      {detail.staffing.assigned_count}/{detail.staffing.required_count}
                    </strong>
                  </div>
                  <div className="sports-preview-metric">
                    <span>Production Items</span>
                    <strong>{detail.production_items.length}</strong>
                  </div>
                </div>
                <div className="sports-preview-status-row">
                  <StatusPill label={humanizeToken(detail.summary.shoot_status)} tone={statusTone(detail.summary.shoot_status)} />
                  <StatusPill label={humanizeToken(detail.summary.production_status)} tone={statusTone(detail.summary.production_status)} />
                  <StatusPill label={humanizeToken(detail.summary.proof_status)} tone={statusTone(detail.summary.proof_status)} />
                  <StatusPill label={humanizeToken(detail.summary.readiness_status)} tone={statusTone(detail.summary.readiness_status)} />
                </div>
                <div className="sports-preview-field-grid">
                  <div>
                    <span>Primary Contact</span>
                    <strong>{detail.client_snapshot.primary_contact_name ?? "Contact pending"}</strong>
                  </div>
                  <div>
                    <span>Approval Owner</span>
                    <strong>{detail.client_snapshot.approval_contact_name ?? "Approval owner pending"}</strong>
                  </div>
                  <div>
                    <span>Lead Photographer</span>
                    <strong>{detail.staffing.lead_photographer_name ?? "Lead needed"}</strong>
                  </div>
                  <div>
                    <span>Open Watch Flags</span>
                    <strong>{detail.watch_flags.filter((flag) => flag.status !== "resolved" && flag.status !== "dismissed").length}</strong>
                  </div>
                </div>
              </div>
            ) : (
              <WorkspaceEmptyState title="Pick a sports shoot" summary="The preview rail keeps list context visible while you inspect a selected job." compact />
            )}
          </DetailPreviewPanel>
        </div>
      )}
    </section>
  );
}
