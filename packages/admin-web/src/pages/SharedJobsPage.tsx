import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import { usePermission } from "../components/PermissionGate";
import { SharedJobListShell } from "../components/jobs/SharedJobListShell";
import {
  BASELINE_FILTER_STATE,
  getDepartmentJobAdapterUI,
  type SharedJobListFilterState,
  type SharedJobSavedViewPreset
} from "../components/jobs/DepartmentJobAdapterUIRegistry";
import { buildSharedJobHash, navigateToSharedJobHash } from "../components/jobs/sharedJobRouting";
import { DetailPreviewPanel, RiskBadge, SavedViewBar, StatusPill, formatDate, formatDateTime, humanizeToken, statusTone, useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import type { SharedJobListItem } from "../jobTruthTypes";
import { canCreateShootRecords, canManageSchoolsHub, canManageSportsWorkspace } from "../permissions";
import { listSharedJobs } from "../services/jobsApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  departmentType: "schools" | "sports" | null;
  routeBase: string;
};

type StoredView = SharedJobSavedViewPreset & {
  isCustom?: boolean;
};

function savedViewStorageKey(scope: string) {
  return `pmc-shared-job-saved-views-${scope}`;
}

function defaultViewStorageKey(scope: string) {
  return `pmc-shared-job-default-view-${scope}`;
}

function readSavedViews(scope: string) {
  try {
    const raw = window.localStorage.getItem(savedViewStorageKey(scope));
    if (!raw) {
      return [] as StoredView[];
    }
    return JSON.parse(raw) as StoredView[];
  } catch {
    return [];
  }
}

function writeSavedViews(scope: string, views: StoredView[]) {
  window.localStorage.setItem(savedViewStorageKey(scope), JSON.stringify(views));
}

function readFilterState(params: URLSearchParams, departmentType: "schools" | "sports" | null): SharedJobListFilterState {
  return {
    ...BASELINE_FILTER_STATE,
    departmentType: params.get("departmentType") ?? (departmentType ?? ""),
    search: params.get("search") ?? "",
    dateRange: params.get("dateRange") ?? "all",
    organizationId: params.get("organizationId") ?? "",
    primaryContactId: params.get("primaryContactId") ?? "",
    locationId: params.get("locationId") ?? "",
    accountOwnerUserId: params.get("accountOwnerUserId") ?? "",
    leadOwnerUserId: params.get("leadOwnerUserId") ?? "",
    jobStatus: params.get("jobStatus") ?? "",
    productionStatus: params.get("productionStatus") ?? "",
    staffingStatus: params.get("staffingStatus") ?? "",
    readinessStatus: params.get("readinessStatus") ?? "",
    riskStatus: params.get("riskStatus") ?? "",
    archived: params.get("archived") ?? "active",
    schoolYear: params.get("schoolYear") ?? "",
    districtId: params.get("districtId") ?? "",
    yearbookRequired: params.get("yearbookRequired") ?? "",
    idCardsRequired: params.get("idCardsRequired") ?? "",
    rosterMode: params.get("rosterMode") ?? "",
    sportType: params.get("sportType") ?? "",
    season: params.get("season") ?? "",
    proofRequired: params.get("proofRequired") ?? "",
    bannerRequired: params.get("bannerRequired") ?? "",
    revenueShareEnabled: params.get("revenueShareEnabled") ?? ""
  };
}

function writeFilterState(routeBase: string, filters: SharedJobListFilterState, extras: Record<string, string | null | undefined> = {}) {
  navigateToSharedJobHash(routeBase, "", {
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
    ...extras
  });
}

function withinDateRange(item: SharedJobListItem, dateRange: string) {
  if (!dateRange || dateRange === "all") {
    return true;
  }
  const anchor = item.primary_day_date ?? item.scheduled_start_at?.slice(0, 10) ?? null;
  if (!anchor) {
    return false;
  }
  const target = new Date(anchor);
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (dateRange === "next-7") {
    return diffDays >= 0 && diffDays <= 7;
  }
  if (dateRange === "next-14") {
    return diffDays >= 0 && diffDays <= 14;
  }
  if (dateRange === "overdue") {
    return diffDays < 0;
  }
  return true;
}

function matchesYesNoFilter(value: boolean, filterValue: string) {
  if (!filterValue) {
    return true;
  }
  return filterValue === "yes" ? value : !value;
}

function applyLocalFilters(items: SharedJobListItem[], filters: SharedJobListFilterState) {
  return items.filter((item) => {
    if (filters.archived === "active" && item.archived_at) {
      return false;
    }
    if (filters.archived === "archived" && !item.archived_at) {
      return false;
    }
    if (filters.departmentType && item.department_type !== filters.departmentType) {
      return false;
    }
    if (filters.organizationId && item.organization_id !== filters.organizationId) {
      return false;
    }
    if (filters.primaryContactId && item.primary_contact_id !== filters.primaryContactId) {
      return false;
    }
    if (filters.locationId && item.primary_location_id !== filters.locationId) {
      return false;
    }
    if (filters.accountOwnerUserId && item.account_owner_user_id !== filters.accountOwnerUserId) {
      return false;
    }
    if (filters.leadOwnerUserId && item.lead_owner_user_id !== filters.leadOwnerUserId) {
      return false;
    }
    if (filters.jobStatus && item.job_status !== filters.jobStatus) {
      return false;
    }
    if (filters.productionStatus && item.production_status !== filters.productionStatus) {
      return false;
    }
    if (filters.staffingStatus && item.staffing_status !== filters.staffingStatus) {
      return false;
    }
    if (filters.readinessStatus && item.readiness_status !== filters.readinessStatus) {
      return false;
    }
    if (filters.riskStatus && item.risk_status !== filters.riskStatus) {
      return false;
    }
    if (!withinDateRange(item, filters.dateRange)) {
      return false;
    }
    if (filters.schoolYear && ((filters.schoolYear === "current" && !item.school_profile?.school_year?.includes(String(new Date().getFullYear()))) || (filters.schoolYear === "next" && !item.school_profile?.school_year?.includes(String(new Date().getFullYear() + 1))))) {
      return false;
    }
    if (filters.districtId === "assigned" && !item.school_profile?.district_id) {
      return false;
    }
    if (filters.districtId === "missing" && item.school_profile?.district_id) {
      return false;
    }
    if (!matchesYesNoFilter(item.school_profile?.yearbook_required ?? false, filters.yearbookRequired)) {
      return false;
    }
    if (!matchesYesNoFilter(item.school_profile?.id_cards_required ?? false, filters.idCardsRequired)) {
      return false;
    }
    if (filters.sportType && item.sports_profile?.sport_type !== filters.sportType) {
      return false;
    }
    if (filters.season && item.sports_profile?.season !== filters.season) {
      return false;
    }
    if (!matchesYesNoFilter(item.sports_profile?.proof_required ?? false, filters.proofRequired)) {
      return false;
    }
    if (!matchesYesNoFilter(item.sports_profile?.banner_work_required ?? false, filters.bannerRequired)) {
      return false;
    }
    if (!matchesYesNoFilter(item.sports_profile?.revenue_share_enabled ?? false, filters.revenueShareEnabled)) {
      return false;
    }
    return true;
  });
}

function exportRows(items: SharedJobListItem[]) {
  const lines = [
    ["job_number", "department", "organization", "title", "date", "status"].join(","),
    ...items.map((item) =>
      [item.job_number ?? "", item.department_type, item.organization_name ?? "", item.title, item.primary_day_date ?? "", item.job_status]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    )
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "shared-jobs.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function SharedJobsPage({ token, currentUser, departmentType, routeBase }: Props) {
  const { params } = useHashRouteSnapshot();
  const scope = departmentType ?? "all";
  const adapter = departmentType ? getDepartmentJobAdapterUI(departmentType) : null;
  const [items, setItems] = useState<SharedJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(params.get("preview"));
  const [savedViews, setSavedViews] = useState<StoredView[]>(() => readSavedViews(scope));
  const filters = useMemo(() => readFilterState(params, departmentType), [departmentType, params]);
  const permissionContext = { departmentType: (departmentType ?? filters.departmentType) || null };
  const canCreateByPolicy = usePermission(currentUser, "job.create", permissionContext);
  const canUpdateByPolicy = usePermission(currentUser, "job.update", permissionContext);
  const canExportJobs = usePermission(currentUser, "export.jobs", permissionContext);
  const createAllowed = canCreateByPolicy || (departmentType === "schools" ? canManageSchoolsHub(currentUser) || canCreateShootRecords(currentUser) : departmentType === "sports" ? canManageSportsWorkspace(currentUser) || canCreateShootRecords(currentUser) : canCreateShootRecords(currentUser));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSharedJobs(token, { department_type: departmentType ?? "all", search: filters.search || null }).then((response) => {
      if (!cancelled) {
        setItems(response.jobs);
        setSelectedJobId((current) => current ?? response.jobs[0]?.id ?? null);
      }
    }).catch((loadError) => {
      if (!cancelled) {
        setItems([]);
        setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load jobs right now.");
      }
    }).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [departmentType, filters.search, token]);

  const filteredItems = useMemo(() => applyLocalFilters(items, filters), [filters, items]);
  const selectedItem = filteredItems.find((item) => item.id === selectedJobId) ?? filteredItems[0] ?? null;
  const columns = useMemo(() => (adapter ? adapter.getListColumns() : getDepartmentJobAdapterUI("sports").getListColumns()), [adapter]);
  const filterDefinitions = useMemo(() => (adapter ? adapter.getFilterDefinitions() : []), [adapter]);
  const presetViews = useMemo(() => (adapter ? adapter.getSavedViewPresets() : []), [adapter]);
  const activeSavedViewKey = params.get("savedView") ?? window.localStorage.getItem(defaultViewStorageKey(scope)) ?? "";

  function applySavedView(view: StoredView) {
    writeFilterState(routeBase, { ...BASELINE_FILTER_STATE, ...filters, ...view.filters, departmentType: departmentType ?? filters.departmentType }, { savedView: view.key, preview: selectedItem?.id ?? null });
  }

  function saveCurrentView() {
    const label = window.prompt("Saved view name", "My view");
    if (!label?.trim()) {
      return;
    }
    const nextView: StoredView = { key: `custom-${Date.now()}`, label: label.trim(), description: "Custom shared job view", filters: { ...filters }, isCustom: true };
    const nextViews = [...savedViews, nextView];
    setSavedViews(nextViews);
    writeSavedViews(scope, nextViews);
    applySavedView(nextView);
  }

  function renameCurrentView() {
    const current = savedViews.find((view) => view.key === activeSavedViewKey);
    if (!current) {
      return;
    }
    const label = window.prompt("Rename saved view", current.label);
    if (!label?.trim()) {
      return;
    }
    const nextViews = savedViews.map((view) => (view.key === current.key ? { ...view, label: label.trim() } : view));
    setSavedViews(nextViews);
    writeSavedViews(scope, nextViews);
  }

  function deleteCurrentView() {
    const current = savedViews.find((view) => view.key === activeSavedViewKey);
    if (!current || !window.confirm(`Delete "${current.label}"?`)) {
      return;
    }
    const nextViews = savedViews.filter((view) => view.key !== current.key);
    setSavedViews(nextViews);
    writeSavedViews(scope, nextViews);
    window.localStorage.removeItem(defaultViewStorageKey(scope));
    writeFilterState(routeBase, { ...filters, savedView: "" } as SharedJobListFilterState, { savedView: null, preview: selectedItem?.id ?? null });
  }

  function pinCurrentView() {
    if (!activeSavedViewKey) {
      return;
    }
    window.localStorage.setItem(defaultViewStorageKey(scope), activeSavedViewKey);
  }

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading shared jobs" summary="Opening the shared job list infrastructure with department-aware filters and preview context." />;
  }

  const viewLibrary = [...presetViews, ...savedViews];

  return (
    <SharedJobListShell
      eyebrow={adapter?.labels.departmentBadge ?? "Jobs"}
      title={adapter?.listTitle ?? "Jobs"}
      summary={adapter ? `One shared ${adapter.labels.listScope.toLowerCase()} board with department-specific filters, columns, and saved views on top of the same job truth layer.` : "Shared global jobs list across departments."}
      meta={[
        { label: `${filteredItems.length} visible`, tone: "info" },
        { label: `${filteredItems.filter((item) => item.readiness_status === "at_risk" || item.readiness_status === "off_track").length} attention`, tone: filteredItems.some((item) => item.readiness_status === "at_risk" || item.readiness_status === "off_track") ? "warning" : "success" }
      ]}
      actions={
        <WorkspaceActionBar align="end">
          <button type="button" onClick={() => navigateToSharedJobHash(routeBase, "new", departmentType ? {} : { department: filters.departmentType || "sports" })} disabled={!createAllowed}>
            {adapter?.createTitle ?? "New Job"}
          </button>
          <button type="button" className="secondary-button" onClick={() => exportRows(filteredItems)} disabled={!filteredItems.length || !canExportJobs}>
            Export
          </button>
        </WorkspaceActionBar>
      }
      savedViews={
        <div className="shared-job-list__saved-views">
          <SavedViewBar views={viewLibrary.map((view) => ({ key: view.key, label: view.label }))} activeKey={activeSavedViewKey || null} onSelect={(key) => {
            const view = viewLibrary.find((candidate) => candidate.key === key);
            if (view) {
              applySavedView(view);
            }
          }} />
          <WorkspaceActionBar align="start" compact>
            <button type="button" className="secondary-button" onClick={saveCurrentView}>Save current view</button>
            <button type="button" className="secondary-button" onClick={renameCurrentView} disabled={!savedViews.some((view) => view.key === activeSavedViewKey)}>Rename</button>
            <button type="button" className="secondary-button" onClick={pinCurrentView} disabled={!activeSavedViewKey}>Pin default</button>
            <button type="button" className="secondary-button" onClick={deleteCurrentView} disabled={!savedViews.some((view) => view.key === activeSavedViewKey)}>Delete</button>
          </WorkspaceActionBar>
        </div>
      }
      filters={
        <div className="shared-job-list__filter-grid">
          <label className="filter-field filter-field--wide">
            <span>Search</span>
            <input value={filters.search} onChange={(event) => writeFilterState(routeBase, { ...filters, search: event.target.value }, { preview: selectedItem?.id ?? null, savedView: activeSavedViewKey || null })} placeholder="Job number, organization, title, or contact" />
          </label>
          {filterDefinitions.map((definition) => (
            <label key={definition.key} className="filter-field">
              <span>{definition.label}</span>
              <select value={(filters as Record<string, string>)[definition.key] ?? ""} onChange={(event) => writeFilterState(routeBase, { ...filters, [definition.key]: event.target.value }, { preview: selectedItem?.id ?? null, savedView: activeSavedViewKey || null })}>
                {definition.options.map((option) => (
                  <option key={`${definition.key}-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      }
      content={
        <div className="shared-job-list__table-wrap">
          {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
          <table className="shared-job-table">
            <thead>
              <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className={selectedItem?.id === item.id ? "is-selected" : ""} onClick={() => {
                  setSelectedJobId(item.id);
                  writeFilterState(routeBase, filters, { preview: item.id, savedView: activeSavedViewKey || null });
                }}>
                  {columns.map((column) => <td key={`${item.id}-${column.key}`}>{column.render(item)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      emptyState={!filteredItems.length ? { title: "No jobs match this view", summary: "Adjust filters or create a new job through the shared shell.", actions: createAllowed ? <button type="button" onClick={() => navigateToSharedJobHash(routeBase, "new", departmentType ? {} : { department: filters.departmentType || "sports" })}>Create job</button> : null } : null}
      preview={
        selectedItem ? (
          <DetailPreviewPanel
            title={selectedItem.title || selectedItem.event_name || selectedItem.job_number || "Selected job"}
            subtitle={`${selectedItem.organization_name ?? "No organization"} | ${selectedItem.job_number ?? "Draft"}`}
            actions={
              <WorkspaceActionBar align="end" compact>
                <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase, selectedItem.id)}>Open detail</button>
                {canUpdateByPolicy ? <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase, `${selectedItem.id}/edit`)}>Edit</button> : null}
              </WorkspaceActionBar>
            }
          >
            <div className="shared-job-preview__grid">
              <div><span>Primary date</span><strong>{selectedItem.primary_day_date ? formatDate(selectedItem.primary_day_date) : "TBD"}</strong></div>
              <div><span>Location</span><strong>{selectedItem.primary_location_name ?? "TBD"}</strong></div>
              <div><span>Contact</span><strong>{selectedItem.primary_contact_name ?? "TBD"}</strong></div>
              <div><span>Owner</span><strong>{selectedItem.account_owner_name ?? "Unassigned"}</strong></div>
            </div>
            <div className="shared-job-preview__status-row">
              <RiskBadge level={selectedItem.risk_status} />
              <StatusPill label={humanizeToken(selectedItem.job_status)} tone={statusTone(selectedItem.job_status)} />
              <StatusPill label={humanizeToken(selectedItem.readiness_status)} tone={statusTone(selectedItem.readiness_status)} />
              <StatusPill label={humanizeToken(selectedItem.production_status)} tone={statusTone(selectedItem.production_status)} />
            </div>
          </DetailPreviewPanel>
        ) : null
      }
    />
  );
}
