import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import { usePermission } from "../components/PermissionGate";
import { SharedJobListShell } from "../components/jobs/SharedJobListShell";
import {
  BASELINE_FILTER_STATE,
  getDepartmentJobAdapterUI,
  type SharedJobListFilterState
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

const JOBS_PAGE_SIZES = [10, 25, 50] as const;

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
    if (filters.leadOwnerUserId && item.lead_owner_user_id !== filters.leadOwnerUserId && item.account_owner_user_id !== filters.leadOwnerUserId) {
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

type SelectOption = {
  value: string;
  label: string;
};

function uniqueOptions(values: Array<SelectOption | null | undefined>) {
  const byValue = new Map<string, string>();
  values.forEach((option) => {
    if (!option?.value || !option.label) {
      return;
    }
    byValue.set(option.value, option.label);
  });
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildDatabaseOptions(items: SharedJobListItem[]) {
  return {
    organizations: uniqueOptions(items.map((item) => (item.organization_id ? { value: item.organization_id, label: item.organization_name ?? item.organization_id } : null))),
    statuses: uniqueOptions(items.map((item) => (item.job_status ? { value: item.job_status, label: humanizeToken(item.job_status) } : null))),
    risks: uniqueOptions(items.map((item) => (item.risk_status ? { value: item.risk_status, label: humanizeToken(item.risk_status) } : null))),
    owners: uniqueOptions(
      items.flatMap((item) => [
        item.account_owner_user_id ? { value: item.account_owner_user_id, label: item.account_owner_name ?? item.account_owner_user_id } : null,
        item.lead_owner_user_id ? { value: item.lead_owner_user_id, label: item.lead_owner_name ?? item.lead_owner_user_id } : null
      ])
    )
  };
}

function paginateItems<T>(items: T[], currentPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  return {
    currentPage: safePage,
    totalPages,
    startIndex,
    endIndex: Math.min(startIndex + pageSize, items.length),
    items: items.slice(startIndex, startIndex + pageSize)
  };
}

export function SharedJobsPage({ token, currentUser, departmentType, routeBase }: Props) {
  const { params } = useHashRouteSnapshot();
  const adapter = departmentType ? getDepartmentJobAdapterUI(departmentType) : null;
  const [items, setItems] = useState<SharedJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(params.get("preview"));
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState(1);
  const filters = useMemo(() => readFilterState(params, departmentType), [departmentType, params]);
  const permissionContext = { departmentType: (departmentType ?? filters.departmentType) || null };
  const canCreateByPolicy = usePermission(currentUser, "job.create", permissionContext);
  const canUpdateByPolicy = usePermission(currentUser, "job.update", permissionContext);
  const createAllowed = canCreateByPolicy || (departmentType === "schools" ? canManageSchoolsHub(currentUser) || canCreateShootRecords(currentUser) : departmentType === "sports" ? canManageSportsWorkspace(currentUser) || canCreateShootRecords(currentUser) : canCreateShootRecords(currentUser));
  const isGlobalJobsPage = departmentType == null;

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

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, pageSize]);

  const filteredItems = useMemo(() => applyLocalFilters(items, filters), [filters, items]);
  const pagedItems = useMemo(() => paginateItems(filteredItems, currentPage, pageSize), [currentPage, filteredItems, pageSize]);
  const selectedItem = filteredItems.find((item) => item.id === selectedJobId) ?? pagedItems.items[0] ?? null;
  const columns = useMemo(() => (adapter ? adapter.getListColumns() : getDepartmentJobAdapterUI("sports").getListColumns()), [adapter]);
  const filterDefinitions = useMemo(() => (adapter ? adapter.getFilterDefinitions() : []), [adapter]);
  const presetViews = useMemo(() => (adapter ? adapter.getSavedViewPresets() : []), [adapter]);
  const databaseOptions = useMemo(() => buildDatabaseOptions(items), [items]);
  const activeSavedViewKey = params.get("savedView") ?? "";

  function applySavedView(view: (typeof presetViews)[number]) {
    writeFilterState(routeBase, { ...BASELINE_FILTER_STATE, ...filters, ...view.filters, departmentType: departmentType ?? filters.departmentType }, { savedView: view.key, preview: selectedItem?.id ?? null });
  }

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading shared jobs" summary="Opening the shared job list infrastructure with department-aware filters and preview context." />;
  }

  const viewLibrary = presetViews;
  const visibleStart = filteredItems.length ? pagedItems.startIndex + 1 : 0;
  const visibleEnd = pagedItems.endIndex;
  const attentionCount = filteredItems.filter((item) => item.readiness_status === "at_risk" || item.readiness_status === "off_track" || item.risk_status === "high" || item.risk_status === "critical").length;

  return (
    <SharedJobListShell
      eyebrow={adapter?.labels.departmentBadge ?? "Database"}
      title={adapter?.listTitle ?? "Jobs Database"}
      summary={adapter ? `One shared ${adapter.labels.listScope.toLowerCase()} board with department-specific filters, columns, and preset lenses on top of the same job truth layer.` : "Search the shared job database by department, organization, job name, status, date, urgency, and owner without turning the page into a long scroll."}
      meta={[
        { label: `${filteredItems.length} visible`, tone: "info" },
        { label: `${attentionCount} attention`, tone: attentionCount ? "warning" : "success" }
      ]}
      actions={
        !isGlobalJobsPage && createAllowed ? (
        <WorkspaceActionBar align="end">
          <button type="button" onClick={() => navigateToSharedJobHash(routeBase, "new", departmentType ? {} : { department: filters.departmentType || "sports" })} disabled={!createAllowed}>
            {adapter?.createTitle ?? "New Job"}
          </button>
        </WorkspaceActionBar>
        ) : null
      }
      savedViews={
        isGlobalJobsPage || !viewLibrary.length ? null : (
        <div className="shared-job-list__saved-views">
          <SavedViewBar views={viewLibrary.map((view) => ({ key: view.key, label: view.label }))} activeKey={activeSavedViewKey || null} onSelect={(key) => {
            const view = viewLibrary.find((candidate) => candidate.key === key);
            if (view) {
              applySavedView(view);
            }
          }} />
        </div>
        )
      }
      filters={
        <div className="shared-job-list__filter-grid">
          <label className="filter-field filter-field--wide">
            <span>Job name / number / organization</span>
            <input value={filters.search} onChange={(event) => writeFilterState(routeBase, { ...filters, search: event.target.value }, { preview: selectedItem?.id ?? null, savedView: activeSavedViewKey || null })} placeholder="Job number, organization, title, or contact" />
          </label>
          {isGlobalJobsPage ? (
            <>
              <label className="filter-field">
                <span>Department / type</span>
                <select value={filters.departmentType} onChange={(event) => writeFilterState(routeBase, { ...filters, departmentType: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All departments</option>
                  <option value="schools">Schools</option>
                  <option value="sports">Sports</option>
                  <option value="photography">Photography</option>
                  <option value="specialty">Specialty</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Organization / school / team</span>
                <select value={filters.organizationId} onChange={(event) => writeFilterState(routeBase, { ...filters, organizationId: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All organizations</option>
                  {databaseOptions.organizations.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Status</span>
                <select value={filters.jobStatus} onChange={(event) => writeFilterState(routeBase, { ...filters, jobStatus: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All statuses</option>
                  {databaseOptions.statuses.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Date range</span>
                <select value={filters.dateRange} onChange={(event) => writeFilterState(routeBase, { ...filters, dateRange: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="all">All dates</option>
                  <option value="next-7">Next 7 days</option>
                  <option value="next-14">Next 14 days</option>
                  <option value="overdue">Overdue</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Needs attention / urgent</span>
                <select value={filters.riskStatus} onChange={(event) => writeFilterState(routeBase, { ...filters, riskStatus: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All risk states</option>
                  {databaseOptions.risks.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Assigned owner</span>
                <select value={filters.leadOwnerUserId} onChange={(event) => writeFilterState(routeBase, { ...filters, leadOwnerUserId: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All owners</option>
                  {databaseOptions.owners.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : filterDefinitions.map((definition) => (
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
        <div className="shared-job-list__database">
          {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
          <div className="shared-job-list__database-toolbar">
            <span>Showing {visibleStart}-{visibleEnd} of {filteredItems.length} jobs</span>
            <label className="filter-field filter-field--compact">
              <span>Per page</span>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Jobs per page">
                {JOBS_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size} per page</option>
                ))}
              </select>
            </label>
          </div>
          <div className="shared-job-list__table-wrap">
            <table className="shared-job-table">
              <thead>
                <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {pagedItems.items.map((item) => (
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
          <div className="shared-job-list__pagination" aria-label="Jobs pagination">
            <button type="button" className="secondary-button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={pagedItems.currentPage <= 1}>
              Previous
            </button>
            <span>Page {pagedItems.currentPage} of {pagedItems.totalPages}</span>
            <button type="button" className="secondary-button" onClick={() => setCurrentPage((page) => Math.min(pagedItems.totalPages, page + 1))} disabled={pagedItems.currentPage >= pagedItems.totalPages}>
              Next
            </button>
          </div>
        </div>
      }
      emptyState={!filteredItems.length ? { title: "No jobs match this view", summary: "Adjust filters to find a school, sports, photography, or specialty job.", actions: !isGlobalJobsPage && createAllowed ? <button type="button" onClick={() => navigateToSharedJobHash(routeBase, "new", departmentType ? {} : { department: filters.departmentType || "sports" })}>Create job</button> : null } : null}
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
