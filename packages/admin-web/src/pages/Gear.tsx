import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard, type OperationalPreviewChip } from "../components/OperationalPreviewCard";
import type {
  GearAlertSummary,
  GearActiveCheckoutSummary,
  GearAssetDetailView,
  GearAssetListItem,
  GearAssetListResponse,
  GearCustodyActivityItem,
  GearCustodyReportItem,
  GearDashboardView,
  GearInventoryQueueItem,
  GearKitDetailView,
  GearKitListItem,
  GearKitListResponse,
  GearMonthlyReportItem,
  GearMonthlyReportView,
  GearScanActivityItem,
  GearServiceRepairSummary,
  GearStatus
} from "../gearTypes";
import { canAccessGearModule } from "../permissions";
import {
  createGearIssueReport,
  createGearTemporarySubstitution,
  endGearTemporarySubstitution,
  getGearAssetDetail,
  getGearDashboard,
  getGearMonthlyReport,
  getGearKitDetail,
  listGearAssets,
  listGearKits,
  resolveGearAlert,
  updateGearIssueReport
} from "../services/gearApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type GearView = "dashboard" | "assets" | "kits" | "reports";

type RouteState = {
  view: GearView;
  assetId: string | null;
  kitId: string | null;
};

const STATUS_OPTIONS: Array<{ value: GearStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "available", label: "Available" },
  { value: "assigned", label: "Assigned" },
  { value: "checked_out", label: "Checked Out" },
  { value: "in_office", label: "In Office" },
  { value: "in_transit", label: "In Transit" },
  { value: "needs_repair", label: "Needs Repair" },
  { value: "under_repair", label: "Under Repair" },
  { value: "missing", label: "Missing" },
  { value: "retired", label: "Retired" }
];

const ISSUE_TYPE_OPTIONS = [
  { value: "broken", label: "Broken" },
  { value: "damage", label: "Damaged" },
  { value: "missing", label: "Missing" },
  { value: "missing_part", label: "Missing Part" },
  { value: "not_working", label: "Not Working" },
  { value: "tile_inactive", label: "Tile Inactive" },
  { value: "needs_repair", label: "Needs Repair" },
  { value: "tracker_issue", label: "Tracker Issue" },
  { value: "battery_issue", label: "Battery Issue" },
  { value: "routine_service", label: "Routine Service" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" }
] as const;

const SERVICE_STATUS_ACTIONS = [
  { status: "open", label: "Needs Repair" },
  { status: "in_service", label: "Under Repair" },
  { status: "resolved", label: "Repaired / Ready" }
] as const;

export function Gear({ token, currentUser }: Props) {
  const [route, setRoute] = useState<RouteState>(() => parseGearHash());
  const [dashboard, setDashboard] = useState<GearDashboardView | null>(null);
  const [assetList, setAssetList] = useState<GearAssetListResponse | null>(null);
  const [kitList, setKitList] = useState<GearKitListResponse | null>(null);
  const [monthlyReport, setMonthlyReport] = useState<GearMonthlyReportView | null>(null);
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [assetDetail, setAssetDetail] = useState<GearAssetDetailView | null>(null);
  const [kitDetail, setKitDetail] = useState<GearKitDetailView | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategory, setAssetCategory] = useState("all");
  const [assetStatus, setAssetStatus] = useState<GearStatus | "all">("all");
  const [assetCustodian, setAssetCustodian] = useState("");
  const [assetHomeLocation, setAssetHomeLocation] = useState("");
  const [assetKit, setAssetKit] = useState("");
  const [kitSearch, setKitSearch] = useState("");
  const [kitType, setKitType] = useState("all");
  const [kitStatus, setKitStatus] = useState<GearStatus | "all">("all");
  const [kitAssignedUser, setKitAssignedUser] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingKits, setLoadingKits] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const canViewGear = canAccessGearModule(currentUser);

  useEffect(() => {
    const sync = () => setRoute(parseGearHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!canViewGear) {
      setDashboard(null);
      setLoadingDashboard(false);
      return;
    }
    let cancelled = false;
    setLoadingDashboard(true);
    void getGearDashboard(token)
      .then((payload) => {
        if (!cancelled) {
          setDashboard(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load the gear dashboard.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDashboard(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewGear, token]);

  useEffect(() => {
    if (!canViewGear || route.view !== "assets") {
      if (!canViewGear) {
        setAssetList(null);
        setLoadingAssets(false);
      }
      return;
    }
    let cancelled = false;
    setLoadingAssets(true);
    void listGearAssets(token, {
      search: assetSearch,
      category: assetCategory,
      status: assetStatus,
      currentCustodianId: assetCustodian || undefined,
      homeLocationId: assetHomeLocation || undefined,
      kitId: assetKit || undefined
    })
      .then((payload) => {
        if (!cancelled) {
          setAssetList(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load Asset inventory.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAssets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetCategory, assetCustodian, assetHomeLocation, assetKit, assetSearch, assetStatus, canViewGear, route.view, token]);

  useEffect(() => {
    if (!canViewGear || route.view !== "kits") {
      if (!canViewGear) {
        setKitList(null);
        setLoadingKits(false);
      }
      return;
    }
    let cancelled = false;
    setLoadingKits(true);
    void listGearKits(token, {
      search: kitSearch,
      kitType,
      status: kitStatus,
      assignedUserId: kitAssignedUser || undefined
    })
      .then((payload) => {
        if (!cancelled) {
          setKitList(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load Kit inventory.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingKits(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewGear, kitAssignedUser, kitSearch, kitStatus, kitType, route.view, token]);

  const activeAssetId = useMemo(() => {
    if (route.view !== "assets") {
      return null;
    }
    if (route.assetId && assetList?.assets.some((asset) => asset.id === route.assetId)) {
      return route.assetId;
    }
    return assetList?.assets[0]?.id ?? null;
  }, [assetList?.assets, route.assetId, route.view]);

  const activeKitId = useMemo(() => {
    if (route.view !== "kits") {
      return null;
    }
    if (route.kitId && kitList?.kits.some((kit) => kit.id === route.kitId)) {
      return route.kitId;
    }
    return kitList?.kits[0]?.id ?? null;
  }, [kitList?.kits, route.kitId, route.view]);

  useEffect(() => {
    if (!canViewGear || route.view !== "assets" || !activeAssetId) {
      setAssetDetail(null);
      if (!canViewGear) {
        setLoadingDetail(false);
      }
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void getGearAssetDetail(token, activeAssetId)
      .then((payload) => {
        if (!cancelled) {
          setAssetDetail(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load this Asset.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeAssetId, canViewGear, route.view, token]);

  useEffect(() => {
    if (!canViewGear || route.view !== "kits" || !activeKitId) {
      setKitDetail(null);
      if (!canViewGear) {
        setLoadingDetail(false);
      }
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void getGearKitDetail(token, activeKitId)
      .then((payload) => {
        if (!cancelled) {
          setKitDetail(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load this Kit.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeKitId, canViewGear, route.view, token]);

  useEffect(() => {
    if (!canViewGear || route.view !== "reports") {
      if (!canViewGear) {
        setMonthlyReport(null);
        setLoadingReports(false);
      }
      return;
    }
    let cancelled = false;
    setLoadingReports(true);
    void getGearMonthlyReport(token, reportMonth)
      .then((payload) => {
        if (!cancelled) {
          setMonthlyReport(payload);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load Gear reporting.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingReports(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewGear, reportMonth, route.view, token]);

  const canManageRegistry =
    ["super_admin", "leadership", "director_admin"].includes(currentUser.authorityTier) ||
    currentUser.permissions.includes("gear_assets.edit") ||
    currentUser.permissions.includes("gear_kits.edit");
  const canManageGearIssues =
    canManageRegistry ||
    currentUser.permissions.includes("gear_service_records.create") ||
    currentUser.permissions.includes("gear_custody.edit");
  const canResolveGearAlerts =
    ["super_admin", "leadership", "director_admin"].includes(currentUser.authorityTier) ||
    currentUser.permissions.includes("gear_custody.override");

  async function refreshDashboard() {
    const payload = await getGearDashboard(token);
    setDashboard(payload);
    return payload;
  }

  async function refreshMonthlyReport() {
    const payload = await getGearMonthlyReport(token, reportMonth);
    setMonthlyReport(payload);
    return payload;
  }

  async function refreshActiveAssetDetail() {
    if (!activeAssetId) {
      return null;
    }
    setLoadingDetail(true);
    try {
      const payload = await getGearAssetDetail(token, activeAssetId);
      setAssetDetail(payload);
      return payload;
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshActiveKitDetail() {
    if (!activeKitId) {
      return null;
    }
    setLoadingDetail(true);
    try {
      const payload = await getGearKitDetail(token, activeKitId);
      setKitDetail(payload);
      return payload;
    } finally {
      setLoadingDetail(false);
    }
  }

  if (!canViewGear) {
    return (
      <section className="panel loading-panel">
        <div className="section-title">Gear access is restricted</div>
        <p className="section-subtitle">Mission Control keeps Asset and Kit custody surfaces limited to leadership and operational managers.</p>
      </section>
    );
  }

  return (
    <div className="workspace-shell">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">Gear And Equipment</div>
          <h2>Inventory, custody, and readiness</h2>
          <p>See what exists, what is assigned, what is checked out, what is in office, what is in transit, and what needs attention without digging through custody history first.</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <div className="metric-pill metric-pill--identity">Viewer {currentUser.fullName}</div>
          <div className="meta-pill">{canManageRegistry ? "Leadership registry access" : "Operational detail access"}</div>
        </div>
      </section>

      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <div className="report-tab-row">
            <button className={route.view === "dashboard" ? "is-active" : ""} onClick={() => pushGearRoute(route, { view: "dashboard" })}>Dashboard</button>
            <button className={route.view === "assets" ? "is-active" : ""} onClick={() => pushGearRoute(route, { view: "assets" })}>Assets</button>
            <button className={route.view === "kits" ? "is-active" : ""} onClick={() => pushGearRoute(route, { view: "kits" })}>Kits</button>
            <button className={route.view === "reports" ? "is-active" : ""} onClick={() => pushGearRoute(route, { view: "reports" })}>Reports</button>
          </div>
        </div>
        <div className="workspace-toolbar__actions">
          <button
            className="secondary-button"
            onClick={() =>
              void (route.view === "reports"
                ? refreshMonthlyReport()
                : refreshDashboard())
            }
          >
            {route.view === "reports" ? "Refresh Gear Reports" : "Refresh Gear Status"}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="gear-summary-grid workspace-summary-strip">
        {buildSummaryCards(dashboard).map((card) => (
          <article key={card.label} className="stat-card panel">
            <div className="eyebrow">{card.label}</div>
            <strong>{card.value}</strong>
            <span className="muted">{card.summary}</span>
          </article>
        ))}
      </section>

      {loadingDashboard && !dashboard ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading gear dashboard</div>
          <p className="section-subtitle">Pulling the live Asset and Kit registry, open custody state, repair pressure, and tracker attention.</p>
        </section>
      ) : null}

      {route.view === "dashboard" ? (
        <DashboardView dashboard={dashboard} onOpen={openQueueItem} />
      ) : null}

      {route.view === "assets" ? (
        <InventoryView
          title="Asset Inventory"
          subtitle="Search by Asset name, internal ID, serial, category, or custodian and keep the detail panel anchored to the filtered result set."
          count={assetList?.assets.length ?? 0}
          loading={loadingAssets}
          filters={
            <div className="field-grid">
              <label className="filter-field filter-field--wide"><span>Search</span><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Asset name, internal ID, serial, manufacturer" /></label>
              <label className="filter-field"><span>Category</span><select value={assetCategory} onChange={(event) => setAssetCategory(event.target.value)}><option value="all">All categories</option>{assetList?.filters.categories.map((value) => <option key={value} value={value}>{humanizeLabel(value)}</option>)}</select></label>
              <label className="filter-field"><span>Status</span><select value={assetStatus} onChange={(event) => setAssetStatus(event.target.value as GearStatus | "all")}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="filter-field"><span>Current Custodian</span><select value={assetCustodian} onChange={(event) => setAssetCustodian(event.target.value)}><option value="">All custodians</option>{assetList?.filters.custodians.map((option) => <option key={option.id} value={option.id}>{option.full_name}</option>)}</select></label>
              <label className="filter-field"><span>Home Location</span><select value={assetHomeLocation} onChange={(event) => setAssetHomeLocation(event.target.value)}><option value="">All Home Locations</option>{assetList?.filters.home_locations.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
              <label className="filter-field"><span>Kit</span><select value={assetKit} onChange={(event) => setAssetKit(event.target.value)}><option value="">All Kits</option>{assetList?.filters.kits.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            </div>
          }
          previews={assetList?.assets.map((asset) => (
            <OperationalPreviewCard key={asset.id} eyebrow={asset.category} title={asset.asset_name} summary={summarizeAsset(asset)} statusLabel={humanizeGearStatus(asset.status)} statusTone={mapGearTone(asset.status)} meta={buildAssetMeta(asset)} flags={buildAssetFlags(asset)} selected={asset.id === activeAssetId} onClick={() => pushGearRoute(route, { view: "assets", assetId: asset.id, kitId: null })} />
          ))}
          emptyMessage="No Assets match the current filters."
          detail={
            assetDetail ? (
              <AssetDetailPanel
                token={token}
                detail={assetDetail}
                availableAssets={assetList?.assets ?? []}
                canManageGearIssues={canManageGearIssues}
                canResolveGearAlerts={canResolveGearAlerts}
                onRefresh={async () => {
                  await refreshActiveAssetDetail();
                  await refreshDashboard();
                  if (route.view === "reports") {
                    await refreshMonthlyReport();
                  }
                }}
              />
            ) : (
              <div className="empty-state empty-state--panel">Select an Asset to review identity, custody, tracker, and repair state.</div>
            )
          }
          detailLoading={loadingDetail}
        />
      ) : null}

      {route.view === "kits" ? (
        <InventoryView
          title="Kit Inventory"
          subtitle="Search by Kit name, internal Kit ID, type, or assigned owner and keep required contents visible before any custody action starts."
          count={kitList?.kits.length ?? 0}
          loading={loadingKits}
          filters={
            <div className="field-grid">
              <label className="filter-field filter-field--wide"><span>Search</span><input value={kitSearch} onChange={(event) => setKitSearch(event.target.value)} placeholder="Kit name, internal Kit ID, tracker" /></label>
              <label className="filter-field"><span>Kit Type</span><select value={kitType} onChange={(event) => setKitType(event.target.value)}><option value="all">All types</option>{kitList?.filters.kit_types.map((value) => <option key={value} value={value}>{humanizeLabel(value)}</option>)}</select></label>
              <label className="filter-field"><span>Status</span><select value={kitStatus} onChange={(event) => setKitStatus(event.target.value as GearStatus | "all")}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="filter-field"><span>Assigned User</span><select value={kitAssignedUser} onChange={(event) => setKitAssignedUser(event.target.value)}><option value="">All assigned users</option>{kitList?.filters.assigned_users.map((option) => <option key={option.id} value={option.id}>{option.full_name}</option>)}</select></label>
            </div>
          }
          previews={kitList?.kits.map((kit) => (
            <OperationalPreviewCard key={kit.id} eyebrow={kit.kit_type} title={kit.kit_name} summary={summarizeKit(kit)} statusLabel={humanizeGearStatus(kit.status)} statusTone={mapGearTone(kit.status)} meta={buildKitMeta(kit)} flags={buildKitFlags(kit)} selected={kit.id === activeKitId} onClick={() => pushGearRoute(route, { view: "kits", kitId: kit.id, assetId: null })} />
          ))}
          emptyMessage="No Kits match the current filters."
          detail={
            kitDetail ? (
              <KitDetailPanel
                token={token}
                detail={kitDetail}
                canManageGearIssues={canManageGearIssues}
                canResolveGearAlerts={canResolveGearAlerts}
                onRefresh={async () => {
                  await refreshActiveKitDetail();
                  await refreshDashboard();
                  if (route.view === "reports") {
                    await refreshMonthlyReport();
                  }
                }}
              />
            ) : (
              <div className="empty-state empty-state--panel">Select a Kit to review standing assignment, contents, Pre-Shoot Verification, and custody history.</div>
            )
          }
          detailLoading={loadingDetail}
        />
      ) : null}

      {route.view === "reports" ? (
        <ReportsView
          report={monthlyReport}
          month={reportMonth}
          loading={loadingReports}
          onMonthChange={setReportMonth}
          onOpen={(item) =>
            pushGearRoute(
              route,
              item.target_type === "asset"
                ? { view: "assets", assetId: item.target_id, kitId: null }
                : { view: "kits", kitId: item.target_id, assetId: null }
            )
          }
        />
      ) : null}
    </div>
  );

  function openQueueItem(item: GearInventoryQueueItem) {
    pushGearRoute(route, item.target_type === "asset" ? { view: "assets", assetId: item.target_id, kitId: null } : { view: "kits", kitId: item.target_id, assetId: null });
  }
}

function DashboardView({
  dashboard,
  onOpen
}: {
  dashboard: GearDashboardView | null;
  onOpen: (item: GearInventoryQueueItem) => void;
}) {
  if (!dashboard) {
    return null;
  }
  const sections = [
    { title: "Out", summary: "What is physically out right now.", items: dashboard.checked_out_now },
    { title: "Overdue Return", summary: "Open custody past the allowed post-shoot return window.", items: dashboard.overdue_returns },
    { title: "Missing Gear Alert", summary: "Anything already marked missing and needing resolution.", items: dashboard.missing_gear },
    { title: "Repair Queue", summary: "Asset and Kit records that need service attention.", items: dashboard.repair_queue },
    { title: "Recently Returned", summary: "Recent returns that were logged back into inventory.", items: dashboard.recently_returned },
    { title: "Tile Tracker Attention", summary: "Inactive or unassigned trackers from current manual linkage.", items: dashboard.tile_attention }
  ];

  return (
    <section className="gear-queue-grid">
      {sections.map((section) => (
        <div key={section.title} className="panel dashboard-panel">
          <div className="dashboard-panel__header">
            <div>
              <div className="section-title">{section.title}</div>
              <p className="section-subtitle">{section.summary}</p>
            </div>
            <span className="metric-pill">{section.items.length}</span>
          </div>
          <div className="ops-preview-list">
            {section.items.map((item) => (
              <OperationalPreviewCard
                key={`${section.title}-${item.target_type}-${item.target_id}`}
                eyebrow={item.target_type === "asset" ? "Asset" : "Kit"}
                title={item.label}
                summary={summarizeText(item.note, item.linked_shoot_title || "Operational note not recorded yet.")}
                statusLabel={humanizeGearStatus(item.status)}
                statusTone={mapGearTone(item.status)}
                meta={buildQueueMeta(item)}
                onClick={() => onOpen(item)}
              />
            ))}
            {!section.items.length ? <div className="empty-state">No items are currently in this queue.</div> : null}
          </div>
        </div>
      ))}
    </section>
  );
}

function ReportsView({
  report,
  month,
  loading,
  onMonthChange,
  onOpen
}: {
  report: GearMonthlyReportView | null;
  month: string;
  loading: boolean;
  onMonthChange: (value: string) => void;
  onOpen: (item: GearMonthlyReportItem | GearInventoryQueueItem | GearCustodyReportItem | GearCustodyActivityItem | GearScanActivityItem) => void;
}) {
  return (
    <section className="dashboard-stack">
      <div className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <div>
            <div className="section-title">Monthly Gear Report</div>
            <p className="section-subtitle">Track Missing Gear Alert pressure, Overdue Return follow-through, unresolved service load, current custody, and scan activity in one reporting surface.</p>
          </div>
        </div>
        <div className="workspace-toolbar__actions">
          <label className="filter-field">
            <span>Month</span>
            <input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} />
          </label>
        </div>
      </div>

      <section className="gear-summary-grid workspace-summary-strip">
        {buildReportSummaryCards(report).map((card) => (
          <article key={card.label} className="stat-card panel">
            <div className="eyebrow">{card.label}</div>
            <strong>{card.value}</strong>
            <span className="muted">{card.summary}</span>
          </article>
        ))}
      </section>

      {loading && !report ? <section className="panel loading-panel"><div className="section-title">Loading Gear reports</div><p className="section-subtitle">Pulling unresolved alerts, current custody, and recent scan activity.</p></section> : null}

      {report ? (
        <>
          <section className="gear-queue-grid">
            <ReportQueueSection title="Missing Gear Alert" summary="Open missing items that still need leadership follow-through." items={report.missing_items} onOpen={onOpen} />
            <ReportQueueSection title="Overdue Return" summary="Open custody records still unresolved after the post-shoot window." items={report.overdue_returns} onOpen={onOpen} />
            <ReportQueueSection title="Missing Over 30 Days" summary="Long-running missing items that need immediate cleanup or replacement action." items={report.missing_over_30_days} onOpen={onOpen} />
            <ReportQueueSection title="Tile Tracker Attention" summary="Missing or inactive Tile linkage from the current manual tracker model." items={report.tile_attention} onOpen={onOpen} />
          </section>

          <section className="gear-queue-grid">
            <div className="panel dashboard-panel">
              <div className="dashboard-panel__header">
                <div>
                  <div className="section-title">Unresolved Service / Repair Record</div>
                  <p className="section-subtitle">Everything still in `Needs Repair` or `Under Repair` state.</p>
                </div>
                <span className="metric-pill">{report.unresolved_repairs.length}</span>
              </div>
              <div className="gear-history-list">
                {report.unresolved_repairs.length ? report.unresolved_repairs.map((record) => <ServiceRecordCard key={record.id} record={record} canManageGearIssues={false} serviceActionId="" onUpdateStatus={async () => {}} />) : <div className="empty-state">No unresolved Service / Repair Record entries in this report window.</div>}
              </div>
            </div>
          </section>

          <div className="panel dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Current Custody Summary</div>
                <p className="section-subtitle">Who has what, which Shoot it is tied to, and the latest scan context.</p>
              </div>
              <span className="metric-pill">{report.current_custody.length}</span>
            </div>
            <div className="report-table-shell">
              <table className="shoots-table report-table">
                <thead><tr><th>Target</th><th>Current Custodian</th><th>Linked Shoot</th><th>Checkout State</th><th>Expected Return</th><th>Last Scan</th></tr></thead>
                <tbody>
                  {report.current_custody.map((item) => (
                    <tr key={`${item.target_type}-${item.target_id}-${item.reserved_at}`} onClick={() => onOpen(item)}>
                      <td><strong>{item.label}</strong><div className="muted">{humanizeLabel(item.target_type)}</div></td>
                      <td>{item.current_custodian_name || "No Current Custodian"}</td>
                      <td>{item.linked_shoot_title || item.linked_location_name || "No linked Shoot"}</td>
                      <td>{humanizeLabel(item.checkout_status)}</td>
                      <td>{item.expected_return_at ? formatDateTime(item.expected_return_at) : "Not scheduled"}</td>
                      <td>{formatScanLabel(item.last_scanned_at, item.last_scanned_by_name)}</td>
                    </tr>
                  ))}
                  {!report.current_custody.length ? <tr><td colSpan={6} className="empty-state">No active custody records are open right now.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Recent Custody Activity</div>
                <p className="section-subtitle">Recent checkouts, returns, transfers, and substitution activity from the selected month.</p>
              </div>
              <span className="metric-pill">{report.recent_custody_activity.length}</span>
            </div>
            <div className="report-table-shell">
              <table className="shoots-table report-table">
                <thead><tr><th>Target</th><th>Event</th><th>User</th><th>Linked Shoot</th><th>When</th></tr></thead>
                <tbody>
                  {report.recent_custody_activity.map((item) => (
                    <tr key={`${item.target_type}-${item.target_id}-${item.occurred_at}-${item.event_type}`} onClick={() => onOpen(item)}>
                      <td><strong>{item.label}</strong><div className="muted">{humanizeLabel(item.target_type)}</div></td>
                      <td>{humanizeLabel(item.event_type)}</td>
                      <td>{item.to_user_name || "No Current Custodian"}</td>
                      <td>{item.linked_shoot_title || item.linked_location_name || "No linked Shoot"}</td>
                      <td>{formatDateTime(item.occurred_at)}</td>
                    </tr>
                  ))}
                  {!report.recent_custody_activity.length ? <tr><td colSpan={5} className="empty-state">No recent custody activity matched the selected month.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel dashboard-panel">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Recent Scan Activity</div>
                <p className="section-subtitle">Latest QR scan activity, who scanned it, and whether any mismatch or override happened.</p>
              </div>
              <span className="metric-pill">{report.recent_scan_activity.length}</span>
            </div>
            <div className="report-table-shell">
              <table className="shoots-table report-table">
                <thead><tr><th>Target</th><th>Action</th><th>Scanned By</th><th>Linked Shoot</th><th>When</th><th>Flags</th></tr></thead>
                <tbody>
                  {report.recent_scan_activity.map((item) => (
                    <tr key={item.id} onClick={() => onOpen(item)}>
                      <td><strong>{item.label}</strong><div className="muted">{humanizeLabel(item.target_type)}</div></td>
                      <td>{humanizeLabel(item.scan_action)}</td>
                      <td>{item.scanned_by_name}</td>
                      <td>{item.linked_shoot_title || item.linked_location_name || "No linked Shoot"}</td>
                      <td>{formatDateTime(item.scanned_at)}</td>
                      <td>{item.mismatch_detected ? "Mismatch" : item.override_applied ? "Override" : "Clear"}</td>
                    </tr>
                  ))}
                  {!report.recent_scan_activity.length ? <tr><td colSpan={6} className="empty-state">No scan activity matched the selected month.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ReportQueueSection({
  title,
  summary,
  items,
  onOpen
}: {
  title: string;
  summary: string;
  items: Array<GearMonthlyReportItem | GearInventoryQueueItem>;
  onOpen: (item: GearMonthlyReportItem | GearInventoryQueueItem) => void;
}) {
  return (
    <div className="panel dashboard-panel">
      <div className="dashboard-panel__header">
        <div>
          <div className="section-title">{title}</div>
          <p className="section-subtitle">{summary}</p>
        </div>
        <span className="metric-pill">{items.length}</span>
      </div>
      <div className="ops-preview-list">
        {items.map((item) => (
          <OperationalPreviewCard
            key={`${title}-${item.target_type}-${item.target_id}-${getReportItemAnchor(item)}`}
            eyebrow={item.target_type === "asset" ? "Asset" : "Kit"}
            title={item.label}
            summary={item.note || formatScanLabel(item.last_scanned_at, item.last_scanned_by_name)}
            statusLabel={humanizeGearStatus(item.status)}
            statusTone={mapGearTone(item.status)}
            meta={buildReportQueueMeta(item)}
            onClick={() => onOpen(item)}
          />
        ))}
        {!items.length ? <div className="empty-state">Nothing is in this section right now.</div> : null}
      </div>
    </div>
  );
}

function InventoryView({
  title,
  subtitle,
  count,
  loading,
  filters,
  previews,
  emptyMessage,
  detail,
  detailLoading
}: {
  title: string;
  subtitle: string;
  count: number;
  loading: boolean;
  filters: ReactNode;
  previews?: ReactNode[];
  emptyMessage: string;
  detail: ReactNode;
  detailLoading: boolean;
}) {
  return (
    <section className="locations-layout workspace-main">
      <div className="panel workspace-rail">
        <div className="dashboard-panel__header">
          <div>
            <div className="section-title">{title}</div>
            <p className="section-subtitle">{subtitle}</p>
          </div>
          <span className="metric-pill">{count}</span>
        </div>
        {filters}
        {loading && !previews?.length ? <div className="empty-state">Loading inventory...</div> : null}
        <div className="ops-preview-list">
          {previews}
          {!loading && !previews?.length ? <div className="empty-state">{emptyMessage}</div> : null}
        </div>
      </div>
      <div className="panel workspace-detail">
        {detailLoading ? <div className="empty-state">Loading detail...</div> : detail}
      </div>
    </section>
  );
}

function AssetDetailPanel({
  token,
  detail,
  availableAssets,
  canManageGearIssues,
  canResolveGearAlerts,
  onRefresh
}: {
  token: string;
  detail: GearAssetDetailView;
  availableAssets: GearAssetListItem[];
  canManageGearIssues: boolean;
  canResolveGearAlerts: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [issueType, setIssueType] = useState<(typeof ISSUE_TYPE_OPTIONS)[number]["value"]>("broken");
  const [issueNote, setIssueNote] = useState("");
  const [reportingIssue, setReportingIssue] = useState(false);
  const [serviceActionId, setServiceActionId] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [substituteAssetId, setSubstituteAssetId] = useState("");
  const [substitutionNote, setSubstitutionNote] = useState("");
  const [creatingSubstitution, setCreatingSubstitution] = useState(false);

  useEffect(() => {
    setIssueType("broken");
    setIssueNote("");
    setReportingIssue(false);
    setServiceActionId("");
    setActionNotice("");
    setActionError("");
    setSubstituteAssetId("");
    setSubstitutionNote("");
    setCreatingSubstitution(false);
  }, [detail.asset.id]);

  const substituteOptions = availableAssets.filter(
    (asset) => asset.id !== detail.asset.id && ["available", "in_office"].includes(asset.status)
  );

  return (
    <div className="dashboard-stack">
      <div className="dashboard-panel__header">
        <div>
          <div className="eyebrow">Asset Detail</div>
          <div className="section-title">{detail.asset.asset_name}</div>
          <p className="section-subtitle">Identity, tracker state, Current Custodian, Last Seen With, repair history, substitutions, and custody history stay on one page.</p>
        </div>
        <div className="dashboard-summary-list">
          <div className="dashboard-summary-row"><span className="muted">Status</span><strong>{humanizeGearStatus(detail.asset.status)}</strong></div>
          <div className="dashboard-summary-row"><span className="muted">Internal ID</span><strong>{detail.asset.internal_asset_id}</strong></div>
        </div>
      </div>
      {actionError ? <div className="error-banner">{actionError}</div> : null}
      {actionNotice ? <div className="success-banner">{actionNotice}</div> : null}
      <OperationalDetailSection title="Asset Summary" summary="Core identity, tracker linkage, and operational ownership." defaultOpen><div className="detail-two-column">{buildDetailCardsForAsset(detail.asset)}</div></OperationalDetailSection>
      <OperationalDetailSection title="Current Custody" summary="Who has it now, where it is tied, and when it should come back."><div className="detail-two-column">{buildCheckoutCards(detail.active_checkout)}</div></OperationalDetailSection>
      <OperationalDetailSection title="Open Alerts" summary="Leadership-visible `Overdue Return` and `Missing Gear Alert` state for this Asset.">
        <AlertSection
          token={token}
          alerts={detail.open_alerts ?? []}
          canResolveGearAlerts={canResolveGearAlerts}
          onRefresh={onRefresh}
          setActionError={setActionError}
          setActionNotice={setActionNotice}
          setServiceActionId={setServiceActionId}
          serviceActionId={serviceActionId}
        />
      </OperationalDetailSection>
      <OperationalDetailSection title="Issue Reporting" summary="Prompt for broken, damaged, missing, or not-working gear without losing history.">
        <div className="dashboard-stack">
          <div className="field-grid">
            <label className="filter-field">
              <span>Issue Type</span>
              <select value={issueType} onChange={(event) => setIssueType(event.target.value as (typeof ISSUE_TYPE_OPTIONS)[number]["value"])} disabled={!canManageGearIssues || reportingIssue}>
                {ISSUE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Note</span>
              <textarea value={issueNote} onChange={(event) => setIssueNote(event.target.value)} rows={3} disabled={!canManageGearIssues || reportingIssue} />
            </label>
          </div>
          <div className="page-intro-actions page-intro-actions--compact">
            <button className="secondary-button" disabled={!canManageGearIssues || reportingIssue} onClick={() => void handleReportIssue()}>
              {reportingIssue ? "Reporting..." : "Report Issue"}
            </button>
            <div className="meta-pill">
              {detail.active_checkout?.linked_shoot_title ? `Linked to ${detail.active_checkout.linked_shoot_title}` : "No linked Shoot context"}
            </div>
          </div>
        </div>
      </OperationalDetailSection>
      <OperationalDetailSection title="Temporary Substitution" summary="Track when a replacement Asset is temporarily issued so original custody and the loaner path both stay understandable.">
        <div className="dashboard-stack">
          {detail.temporary_substitutions.length ? (
            <div className="gear-history-list">
              {detail.temporary_substitutions.map((substitution) => (
                <article key={substitution.id} className="request-card">
                  <strong>{substitution.substitute_asset_name}</strong>
                  <div className="muted">Replacing {substitution.original_asset_name} for {substitution.assigned_user_name}{substitution.linked_shoot_title ? ` | ${substitution.linked_shoot_title}` : ""}</div>
                  <div className="muted">{substitution.status === "active" ? "Active" : "Ended"} | Started {formatDateTime(substitution.starts_at)}{substitution.ends_at ? ` | Ended ${formatDateTime(substitution.ends_at)}` : ""}</div>
                  {substitution.note ? <div className="muted">{substitution.note}</div> : null}
                  {canManageGearIssues && substitution.status === "active" ? <div className="page-intro-actions page-intro-actions--compact"><button className="secondary-button" disabled={serviceActionId === substitution.id} onClick={() => void handleEndSubstitution(substitution.id)}>{serviceActionId === substitution.id ? "Ending..." : "End Temporary Substitution"}</button></div> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">No Temporary Substitution history is on file for this Asset.</div>
          )}
          {canManageGearIssues ? (
            <>
              <div className="field-grid">
                <label className="filter-field">
                  <span>Substitute Asset</span>
                  <select value={substituteAssetId} onChange={(event) => setSubstituteAssetId(event.target.value)} disabled={creatingSubstitution}>
                    <option value="">Choose an available Asset</option>
                    {substituteOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_name} ({asset.internal_asset_id})</option>)}
                  </select>
                </label>
                <label className="filter-field filter-field--wide">
                  <span>Reason / Note</span>
                  <textarea value={substitutionNote} onChange={(event) => setSubstitutionNote(event.target.value)} rows={3} disabled={creatingSubstitution} />
                </label>
              </div>
              <div className="page-intro-actions page-intro-actions--compact">
                <button className="secondary-button" disabled={creatingSubstitution || !substituteAssetId} onClick={() => void handleCreateSubstitution()}>{creatingSubstitution ? "Creating..." : "Create Temporary Substitution"}</button>
                <div className="meta-pill">{detail.active_checkout?.checked_out_to_user_name || detail.asset.current_custodian_name || "No Current Custodian"}</div>
              </div>
            </>
          ) : null}
        </div>
      </OperationalDetailSection>
      <OperationalDetailSection title="Service / Repair Record" summary="Keep broken, missing, repair, and readiness state searchable instead of collapsing it into one note field.">
        <div className="gear-history-list">
          {detail.service_records.length ? detail.service_records.map((record) => <ServiceRecordCard key={record.id} record={record} canManageGearIssues={canManageGearIssues} serviceActionId={serviceActionId} onUpdateStatus={async (status) => {
            setServiceActionId(record.id);
            setActionError("");
            try {
              await updateGearIssueReport(token, { serviceRecordId: record.id, status });
              setActionNotice(`Service / Repair Record moved to ${mapServiceStatusLabel(status)}.`);
              await onRefresh();
            } catch (error) {
              setActionError(error instanceof Error ? error.message : "We couldn't update this Service / Repair Record.");
            } finally {
              setServiceActionId("");
            }
          }} />) : <div className="empty-state">No Service / Repair Record entries are on file for this Asset.</div>}
        </div>
      </OperationalDetailSection>
      <HistorySection title="Custody Event History" emptyMessage="No Custody Event history is recorded for this Asset yet.">
        {detail.custody_history.map((entry) => <HistoryCard key={entry.id} title={humanizeLabel(entry.event_type)} subtitle={`${formatDateTime(entry.timestamp)} | ${entry.created_by_name}`} detail={`${entry.from_user_name || "Unassigned"} -> ${entry.to_user_name || "No Current Custodian"} | ${entry.linked_shoot_title || entry.linked_location_name || entry.note || "No linked Shoot or note recorded."}`} />)}
      </HistorySection>
    </div>
  );

  async function handleReportIssue() {
    setReportingIssue(true);
    setActionError("");
    setActionNotice("");
    try {
      await createGearIssueReport(token, {
        targetType: "asset",
        targetId: detail.asset.id,
        issueType,
        linkedShootId: detail.active_checkout?.linked_shoot_id ?? null,
        linkedLocationId: detail.active_checkout?.linked_location_id ?? null,
        sourceCheckoutId: detail.active_checkout?.id ?? null,
        note: issueNote.trim() || null
      });
      setActionNotice("Issue report saved.");
      setIssueNote("");
      setIssueType("broken");
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't save this issue report.");
    } finally {
      setReportingIssue(false);
    }
  }

  async function handleCreateSubstitution() {
    setCreatingSubstitution(true);
    setActionError("");
    setActionNotice("");
    try {
      await createGearTemporarySubstitution(token, {
        originalAssetId: detail.asset.id,
        substituteAssetId,
        assignedUserId: detail.active_checkout?.checked_out_to_user_id ?? detail.asset.current_custodian_id ?? null,
        linkedShootId: detail.active_checkout?.linked_shoot_id ?? null,
        linkedLocationId: detail.active_checkout?.linked_location_id ?? null,
        note: substitutionNote.trim() || null
      });
      setActionNotice("Temporary Substitution created.");
      setSubstituteAssetId("");
      setSubstitutionNote("");
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't create this Temporary Substitution.");
    } finally {
      setCreatingSubstitution(false);
    }
  }

  async function handleEndSubstitution(substitutionId: string) {
    setServiceActionId(substitutionId);
    setActionError("");
    setActionNotice("");
    try {
      await endGearTemporarySubstitution(token, { substitutionId });
      setActionNotice("Temporary Substitution ended.");
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't end this Temporary Substitution.");
    } finally {
      setServiceActionId("");
    }
  }
}

function KitDetailPanel({
  token,
  detail,
  canManageGearIssues,
  canResolveGearAlerts,
  onRefresh
}: {
  token: string;
  detail: GearKitDetailView;
  canManageGearIssues: boolean;
  canResolveGearAlerts: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [issueType, setIssueType] = useState<(typeof ISSUE_TYPE_OPTIONS)[number]["value"]>("broken");
  const [issueNote, setIssueNote] = useState("");
  const [reportingIssue, setReportingIssue] = useState(false);
  const [serviceActionId, setServiceActionId] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setIssueType("broken");
    setIssueNote("");
    setReportingIssue(false);
    setServiceActionId("");
    setActionNotice("");
    setActionError("");
  }, [detail.kit.id]);

  return (
    <div className="dashboard-stack">
      <div className="dashboard-panel__header">
        <div>
          <div className="eyebrow">Kit Detail</div>
          <div className="section-title">{detail.kit.kit_name}</div>
          <p className="section-subtitle">Standing assignment, Current Custodian, full contents, Pre-Shoot Verification, service state, and substitutions stay visible in one leadership workspace.</p>
        </div>
        <div className="dashboard-summary-list">
          <div className="dashboard-summary-row"><span className="muted">Status</span><strong>{humanizeGearStatus(detail.kit.status)}</strong></div>
          <div className="dashboard-summary-row"><span className="muted">Internal ID</span><strong>{detail.kit.internal_kit_id}</strong></div>
        </div>
      </div>
      {actionError ? <div className="error-banner">{actionError}</div> : null}
      {actionNotice ? <div className="success-banner">{actionNotice}</div> : null}
      <OperationalDetailSection title="Kit Summary" summary="Identity, standing assignment, tracker linkage, and Home Location." defaultOpen><div className="detail-two-column">{buildDetailCardsForKit(detail.kit)}</div></OperationalDetailSection>
      <OperationalDetailSection title="Current Custody" summary="Who has it now, what Shoot it is tied to, and when it should be back."><div className="detail-two-column">{buildCheckoutCards(detail.active_checkout)}</div></OperationalDetailSection>
      <OperationalDetailSection title="Open Alerts" summary="Leadership-visible `Overdue Return` and `Missing Gear Alert` state for this Kit.">
        <AlertSection
          token={token}
          alerts={detail.open_alerts ?? []}
          canResolveGearAlerts={canResolveGearAlerts}
          onRefresh={onRefresh}
          setActionError={setActionError}
          setActionNotice={setActionNotice}
          setServiceActionId={setServiceActionId}
          serviceActionId={serviceActionId}
        />
      </OperationalDetailSection>
      <OperationalDetailSection title="Issue Reporting" summary="Report broken, damaged, missing, or not-working Kit issues directly from the Kit workspace.">
        <div className="dashboard-stack">
          <div className="field-grid">
            <label className="filter-field">
              <span>Issue Type</span>
              <select value={issueType} onChange={(event) => setIssueType(event.target.value as (typeof ISSUE_TYPE_OPTIONS)[number]["value"])} disabled={!canManageGearIssues || reportingIssue}>
                {ISSUE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Note</span>
              <textarea value={issueNote} onChange={(event) => setIssueNote(event.target.value)} rows={3} disabled={!canManageGearIssues || reportingIssue} />
            </label>
          </div>
          <div className="page-intro-actions page-intro-actions--compact">
            <button className="secondary-button" disabled={!canManageGearIssues || reportingIssue} onClick={() => void handleReportIssue()}>{reportingIssue ? "Reporting..." : "Report Kit Issue"}</button>
            <div className="meta-pill">{detail.active_checkout?.linked_shoot_title ? `Linked to ${detail.active_checkout.linked_shoot_title}` : "No linked Shoot context"}</div>
          </div>
        </div>
      </OperationalDetailSection>
      <OperationalDetailSection title="Required Contents Checklist" summary={`${detail.contents.length} Asset${detail.contents.length === 1 ? "" : "s"} linked through Kit Asset Membership.`}>
        <div className="report-table-shell">
          <table className="shoots-table report-table">
            <thead><tr><th>Asset</th><th>Category</th><th>Required</th><th>Status</th><th>Current Custodian</th><th>Service</th></tr></thead>
            <tbody>
              {detail.contents.map((item) => (
                <tr key={item.membership_id}>
                  <td><strong>{item.asset_name}</strong><div className="muted">{item.internal_asset_id}</div></td>
                  <td>{humanizeLabel(item.category)}</td>
                  <td>{item.required_in_kit ? "Required" : "Optional"}</td>
                  <td>{humanizeGearStatus(item.status)}</td>
                  <td>{item.current_custodian_name || item.last_seen_with_name || "In Office"}</td>
                  <td>{item.open_service_count ? `${item.open_service_count} open` : "Clear"}</td>
                </tr>
              ))}
              {!detail.contents.length ? <tr><td colSpan={6} className="empty-state">This Kit does not have any Kit Asset Membership records yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </OperationalDetailSection>
      <OperationalDetailSection title="Pre-Shoot Verification" summary="Latest verification state from scan-assisted readiness flows.">
        <div className="detail-two-column">
          {detail.latest_pre_shoot_verification ? (
            [
              { label: "Status", value: humanizeLabel(detail.latest_pre_shoot_verification.status) },
              { label: "Verified By", value: detail.latest_pre_shoot_verification.verified_by_name },
              { label: "Linked Shoot", value: detail.latest_pre_shoot_verification.linked_shoot_title || "No linked Shoot saved" },
              { label: "Verified Ready At", value: detail.latest_pre_shoot_verification.verified_ready_at ? formatDateTime(detail.latest_pre_shoot_verification.verified_ready_at) : "Not marked ready yet" }
            ].map((item) => <article key={item.label} className="request-card"><strong>{item.label}</strong><div className="muted">{item.value}</div></article>)
          ) : (
            <div className="empty-state">No Pre-Shoot Verification has been recorded for this Kit yet.</div>
          )}
        </div>
      </OperationalDetailSection>
      <OperationalDetailSection title="Temporary Substitution" summary="See which Kit contents were replaced temporarily so leadership can understand what actually left the building.">
        <div className="gear-history-list">
          {detail.temporary_substitutions.length ? detail.temporary_substitutions.map((substitution) => <HistoryCard key={substitution.id} title={`${substitution.substitute_asset_name} replacing ${substitution.original_asset_name}`} subtitle={`${substitution.status === "active" ? "Active" : "Ended"} | ${substitution.assigned_user_name}${substitution.linked_shoot_title ? ` | ${substitution.linked_shoot_title}` : ""}`} detail={substitution.note || "No substitution note recorded."} />) : <div className="empty-state">No Temporary Substitution history is recorded for this Kit.</div>}
        </div>
      </OperationalDetailSection>
      <OperationalDetailSection title="Service / Repair Record" summary="Keep repair and missing-gear history visible beside the contents checklist.">
        <div className="gear-history-list">
          {detail.service_records.length ? detail.service_records.map((record) => <ServiceRecordCard key={record.id} record={record} canManageGearIssues={canManageGearIssues} serviceActionId={serviceActionId} onUpdateStatus={async (status) => {
            setServiceActionId(record.id);
            setActionError("");
            try {
              await updateGearIssueReport(token, { serviceRecordId: record.id, status });
              setActionNotice(`Service / Repair Record moved to ${mapServiceStatusLabel(status)}.`);
              await onRefresh();
            } catch (error) {
              setActionError(error instanceof Error ? error.message : "We couldn't update this Service / Repair Record.");
            } finally {
              setServiceActionId("");
            }
          }} />) : <div className="empty-state">No Service / Repair Record entries are on file for this Kit.</div>}
        </div>
      </OperationalDetailSection>
      <HistorySection title="Custody Event History" emptyMessage="No Custody Event history is recorded for this Kit yet.">
        {detail.custody_history.map((entry) => <HistoryCard key={entry.id} title={humanizeLabel(entry.event_type)} subtitle={`${formatDateTime(entry.timestamp)} | ${entry.created_by_name}`} detail={`${entry.from_user_name || "Unassigned"} -> ${entry.to_user_name || "No Current Custodian"} | ${entry.linked_shoot_title || entry.linked_location_name || entry.note || "No linked Shoot or note recorded."}`} />)}
      </HistorySection>
    </div>
  );

  async function handleReportIssue() {
    setReportingIssue(true);
    setActionError("");
    setActionNotice("");
    try {
      await createGearIssueReport(token, {
        targetType: "kit",
        targetId: detail.kit.id,
        issueType,
        linkedShootId: detail.active_checkout?.linked_shoot_id ?? null,
        linkedLocationId: detail.active_checkout?.linked_location_id ?? null,
        sourceCheckoutId: detail.active_checkout?.id ?? null,
        note: issueNote.trim() || null
      });
      setActionNotice("Kit issue report saved.");
      setIssueNote("");
      setIssueType("broken");
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't save this Kit issue.");
    } finally {
      setReportingIssue(false);
    }
  }
}

function HistorySection({ title, emptyMessage, children }: { title: string; emptyMessage: string; children: ReactNode[] }) {
  return <OperationalDetailSection title={title} summary={emptyMessage.includes("No ") ? undefined : ""}><div className="gear-history-list">{children.length ? children : <div className="empty-state">{emptyMessage}</div>}</div></OperationalDetailSection>;
}

function AlertSection({
  token,
  alerts,
  canResolveGearAlerts,
  onRefresh,
  setActionError,
  setActionNotice,
  setServiceActionId,
  serviceActionId
}: {
  token: string;
  alerts: GearAlertSummary[];
  canResolveGearAlerts: boolean;
  onRefresh: () => Promise<void>;
  setActionError: (value: string) => void;
  setActionNotice: (value: string) => void;
  setServiceActionId: (value: string) => void;
  serviceActionId: string;
}) {
  if (!alerts.length) {
    return <div className="empty-state">No open Gear alerts are active for this record right now.</div>;
  }

  return (
    <div className="gear-history-list">
      {alerts.map((alert) => (
        <article key={alert.id} className="request-card">
          <strong>{mapAlertLabel(alert.alert_type)}</strong>
          <div className="muted">Opened {formatDateTime(alert.first_triggered_at)}{alert.due_at ? ` | Due ${formatDateTime(alert.due_at)}` : ""}</div>
          <div className="muted">{alert.linked_shoot_title || alert.linked_location_name || "No linked Shoot or Location saved."}</div>
          {alert.resolution_note ? <div className="muted">{alert.resolution_note}</div> : null}
          {canResolveGearAlerts ? (
            <div className="page-intro-actions page-intro-actions--compact">
              <button
                className="secondary-button"
                disabled={serviceActionId === alert.id}
                onClick={() => void handleResolve(alert.id, alert.alert_type)}
              >
                {serviceActionId === alert.id ? "Resolving..." : `Resolve ${mapAlertLabel(alert.alert_type)}`}
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );

  async function handleResolve(alertId: string, alertType: GearAlertSummary["alert_type"]) {
    setServiceActionId(alertId);
    setActionError("");
    setActionNotice("");
    try {
      await resolveGearAlert(token, { alertId });
      setActionNotice(`${mapAlertLabel(alertType)} resolved.`);
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn't resolve this Gear alert.");
    } finally {
      setServiceActionId("");
    }
  }
}

function HistoryCard({ title, subtitle, detail }: { title: string; subtitle: string; detail: string }) {
  return <article className="request-card"><strong>{title}</strong><div className="muted">{subtitle}</div><div className="muted">{detail}</div></article>;
}

function ServiceRecordCard({
  record,
  canManageGearIssues,
  serviceActionId,
  onUpdateStatus
}: {
  record: GearServiceRepairSummary;
  canManageGearIssues: boolean;
  serviceActionId: string;
  onUpdateStatus: (status: string) => Promise<void>;
}) {
  return (
    <article className="request-card">
      <strong>{humanizeIssueType(record.issue_type)}</strong>
      <div className="muted">
        {mapServiceStatusLabel(record.status)} | Reported {formatDateTime(record.opened_at)} by {record.reported_by_name}
      </div>
      <div className="muted">
        {record.linked_shoot_title || record.linked_location_name || "No linked Shoot or Location"}
        {record.source_surface ? ` | ${humanizeLabel(record.source_surface)}` : ""}
      </div>
      <div className="muted">{record.note || "No note recorded."}</div>
      {record.resolved_at ? <div className="muted">Resolved {formatDateTime(record.resolved_at)}{record.resolved_by_name ? ` by ${record.resolved_by_name}` : ""}</div> : null}
      {canManageGearIssues ? (
        <div className="page-intro-actions page-intro-actions--compact">
          {SERVICE_STATUS_ACTIONS.map((action) => (
            <button
              key={`${record.id}-${action.status}`}
              className="secondary-button"
              disabled={serviceActionId === record.id || record.status === action.status}
              onClick={() => void onUpdateStatus(action.status)}
            >
              {serviceActionId === record.id ? "Updating..." : action.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function buildSummaryCards(dashboard: GearDashboardView | null) {
  const summary = dashboard?.summary;
  return [
    { label: "Total Assets", value: summary?.total_assets ?? "-", summary: "Individually tracked Asset records in the active registry." },
    { label: "Total Kits", value: summary?.total_kits ?? "-", summary: "Self-contained Kit records with tracked contents." },
    { label: "Available", value: summary?.available ?? "-", summary: "Ready to assign or check out now." },
    { label: "Assigned", value: summary?.assigned ?? "-", summary: "Reserved or standing-owned without implying physical custody." },
    { label: "Checked Out", value: summary?.checked_out ?? "-", summary: "Physically out and in active custody." },
    { label: "In Office", value: summary?.in_office ?? "-", summary: "Back at the studio or logged at a Home Location." },
    { label: "In Transit", value: summary?.in_transit ?? "-", summary: "Moving between office and field handoffs." },
    { label: "Needs Repair", value: summary?.needs_repair ?? "-", summary: "Broken or incomplete and waiting for service triage." },
    { label: "Under Repair", value: summary?.under_repair ?? "-", summary: "Already in active service or repair handling." },
    { label: "Missing", value: summary?.missing ?? "-", summary: "Actively missing and needing follow-through." },
    { label: "Overdue Return", value: summary?.overdue_returns ?? "-", summary: "Still open past the 48-hour post-shoot window." },
    { label: "Recently Returned", value: summary?.recently_returned ?? "-", summary: "Returned during the last 7 days." },
    { label: "Tile Tracker Attention", value: summary?.tile_tracker_attention ?? "-", summary: "Inactive or unassigned tracker linkage from current manual data." }
  ];
}

function buildReportSummaryCards(report: GearMonthlyReportView | null) {
  const summary = report?.summary;
  return [
    { label: "Missing Gear Alert", value: summary?.missing_items ?? "-", summary: "Open missing items that still need leadership follow-through." },
    { label: "Overdue Return", value: summary?.overdue_returns ?? "-", summary: "Still out past the allowed post-shoot return window." },
    { label: "Needs Repair", value: summary?.unresolved_repairs ?? "-", summary: "Open Service / Repair Record items still unresolved." },
    { label: "Missing 30+ Days", value: summary?.missing_over_30_days ?? "-", summary: "Long-running missing items needing immediate cleanup." },
    { label: "Current Custody", value: summary?.current_custody ?? "-", summary: "Active reservations and checkouts still in flight." },
    { label: "Custody Activity", value: summary?.recent_custody_activity ?? "-", summary: "Recent checkouts, returns, and substitution events." },
    { label: "Scan Activity", value: summary?.recent_scan_activity ?? "-", summary: "QR scan activity captured in the selected month." },
    { label: "Tile Attention", value: summary?.tile_attention_items ?? "-", summary: "Missing or inactive Tile linkage needing follow-up." }
  ];
}

function buildQueueMeta(item: GearInventoryQueueItem): OperationalPreviewChip[] {
  const chips: OperationalPreviewChip[] = [
    item.current_custodian_name ? { label: item.current_custodian_name, tone: "info" } : { label: "No Current Custodian", tone: "warning" }
  ];
  if (item.last_seen_with_name) {
    chips.push({ label: `Last Seen With ${item.last_seen_with_name}`, tone: "neutral" });
  }
  if (item.expected_return_at) {
    chips.push({ label: `Due ${formatShortDate(item.expected_return_at)}`, tone: item.status === "checked_out" ? "warning" : "neutral" });
  } else if (item.event_at) {
    chips.push({ label: formatShortDate(item.event_at), tone: "neutral" });
  }
  if (item.linked_shoot_title || item.linked_location_name) {
    chips.push({ label: item.linked_shoot_title || item.linked_location_name || "No linked Shoot", tone: "neutral" });
  }
  return chips;
}

function buildReportQueueMeta(item: GearMonthlyReportItem | GearInventoryQueueItem): OperationalPreviewChip[] {
  const chips: OperationalPreviewChip[] = [];
  const reportItem = item as Partial<GearMonthlyReportItem>;
  const queueItem = item as Partial<GearInventoryQueueItem>;
  if (item.current_custodian_name) {
    chips.push({ label: item.current_custodian_name, tone: "info" });
  }
  if (item.last_seen_with_name) {
    chips.push({ label: `Last Seen With ${item.last_seen_with_name}`, tone: "neutral" });
  }
  if (reportItem.due_at || queueItem.expected_return_at) {
    chips.push({ label: `Due ${formatShortDate(reportItem.due_at ?? queueItem.expected_return_at ?? "")}`, tone: "warning" });
  } else if (item.event_at) {
    chips.push({ label: formatShortDate(item.event_at), tone: "neutral" });
  }
  if (item.linked_shoot_title || item.linked_location_name) {
    chips.push({ label: item.linked_shoot_title || item.linked_location_name || "No linked Shoot", tone: "neutral" });
  }
  return chips;
}

function buildAssetMeta(asset: GearAssetListItem): OperationalPreviewChip[] {
  return [
    { label: asset.internal_asset_id, tone: "info" },
    { label: asset.home_location_name || "No Home Location", tone: "neutral" },
    { label: asset.current_kit_name || "Standalone Asset", tone: "neutral" }
  ];
}

function buildAssetFlags(asset: GearAssetListItem) {
  const flags: OperationalPreviewChip[] = [];
  if (asset.current_custodian_name) flags.push({ label: asset.current_custodian_name, tone: "info" });
  if (asset.overdue_return) flags.push({ label: "Overdue Return", tone: "critical" });
  if (asset.open_service_count) flags.push({ label: `${asset.open_service_count} repair`, tone: "warning" });
  if (!asset.tile_tracker_id || asset.tile_tracker_active === false) flags.push({ label: "Tile attention", tone: "warning" });
  return flags;
}

function buildKitMeta(kit: GearKitListItem): OperationalPreviewChip[] {
  return [
    { label: kit.internal_kit_id, tone: "info" },
    { label: kit.assigned_user_name || "No standing owner", tone: "neutral" },
    { label: `${kit.required_asset_count}/${kit.asset_count} required`, tone: "neutral" }
  ];
}

function buildKitFlags(kit: GearKitListItem) {
  const flags: OperationalPreviewChip[] = [];
  if (kit.current_custodian_name) flags.push({ label: kit.current_custodian_name, tone: "info" });
  if (kit.overdue_return) flags.push({ label: "Overdue Return", tone: "critical" });
  if (kit.open_service_count) flags.push({ label: `${kit.open_service_count} repair`, tone: "warning" });
  if (!kit.tile_tracker_id) flags.push({ label: "Tile attention", tone: "warning" });
  return flags;
}

function buildDetailCardsForAsset(asset: GearAssetListItem) {
  return [
    { label: "Serial Number", value: asset.serial_number || "Not recorded" },
    { label: "QR Code ID", value: asset.qr_code_id || "Not linked" },
    { label: "Tile Tracker", value: asset.tile_tracker_id ? `${asset.tile_tracker_id}${asset.tile_tracker_active === false ? " | inactive" : ""}` : "Not linked" },
    { label: "Current Kit", value: asset.current_kit_name || "Standalone Asset" },
    { label: "Home Location", value: asset.home_location_name || "No Home Location" },
    { label: "Current Custodian", value: asset.current_custodian_name || "No Current Custodian" },
    { label: "Last Seen With", value: asset.last_seen_with_name || "No Last Seen With value" },
    { label: "Last Scan", value: formatScanLabel(asset.last_scanned_at, asset.last_scanned_by_name) },
    { label: "Notes", value: asset.notes || "No internal notes saved." }
  ].map((item) => <article key={item.label} className="request-card"><strong>{item.label}</strong><div className="muted">{item.value}</div></article>);
}

function buildDetailCardsForKit(kit: GearKitListItem) {
  return [
    { label: "Assigned User", value: kit.assigned_user_name || "No standing owner" },
    { label: "Current Custodian", value: kit.current_custodian_name || "No Current Custodian" },
    { label: "Home Location", value: kit.home_location_name || "No Home Location" },
    { label: "Tile Tracker", value: kit.tile_tracker_id || "Not linked" },
    { label: "Last Seen With", value: kit.last_seen_with_name || "No Last Seen With value" },
    { label: "Last Scan", value: formatScanLabel(kit.last_scanned_at, kit.last_scanned_by_name) },
    { label: "Assignment Note", value: kit.assignment_note || "No assignment note saved." },
    { label: "Required Contents", value: `${kit.required_asset_count} of ${kit.asset_count}` },
    { label: "Notes", value: kit.notes || "No internal notes saved." }
  ].map((item) => <article key={item.label} className="request-card"><strong>{item.label}</strong><div className="muted">{item.value}</div></article>);
}

function buildCheckoutCards(checkout: GearActiveCheckoutSummary | null) {
  if (!checkout) {
    return [<div key="empty" className="empty-state">No active checkout or reservation is open right now.</div>];
  }
  return [
    { label: "Checkout Status", value: humanizeLabel(checkout.status) },
    { label: "Current Custodian", value: checkout.checked_out_to_user_name || "No Current Custodian" },
    { label: "Linked Shoot", value: checkout.linked_shoot_title || "No linked Shoot" },
    { label: "Linked Location", value: checkout.linked_location_name || "No linked Location" },
    { label: "Reserved At", value: formatDateTime(checkout.reserved_at) },
    { label: "Checked Out At", value: checkout.checked_out_at ? formatDateTime(checkout.checked_out_at) : "Not marked checked out yet" },
    { label: "Expected Return", value: checkout.expected_return_at ? formatDateTime(checkout.expected_return_at) : "Not scheduled" },
    { label: "Checkout Note", value: checkout.checkout_note || "No checkout note saved." }
  ].map((item) => <article key={item.label} className="request-card"><strong>{item.label}</strong><div className="muted">{item.value}</div></article>);
}

function parseGearHash(): RouteState {
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  const view = params.get("view");
  return {
    view: view === "assets" || view === "kits" || view === "reports" ? view : "dashboard",
    assetId: params.get("asset"),
    kitId: params.get("kit")
  };
}

function pushGearRoute(route: RouteState, next: Partial<RouteState>) {
  const merged = { ...route, ...next };
  const params = new URLSearchParams();
  if (merged.view !== "dashboard") params.set("view", merged.view);
  if (merged.assetId) params.set("asset", merged.assetId);
  if (merged.kitId) params.set("kit", merged.kitId);
  window.location.hash = params.toString() ? `#gear?${params.toString()}` : "#gear";
}

function summarizeAsset(asset: GearAssetListItem) {
  return summarizeText(asset.notes, `${asset.manufacturer || "Unknown maker"} ${asset.model || ""}`.trim() || "No manufacturer or model captured yet.");
}

function summarizeKit(kit: GearKitListItem) {
  return summarizeText(kit.notes, kit.assignment_note || `${kit.required_asset_count} required contents on file.`);
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeGearStatus(value: GearStatus) {
  return humanizeLabel(value);
}

function humanizeIssueType(value: string) {
  if (value === "damage") {
    return "Damaged";
  }
  if (value === "not_working") {
    return "Not Working";
  }
  if (value === "tile_inactive") {
    return "Tile Inactive";
  }
  return humanizeLabel(value);
}

function mapAlertLabel(value: GearAlertSummary["alert_type"]) {
  if (value === "overdue_return") {
    return "Overdue Return";
  }
  if (value === "missing_gear") {
    return "Missing Gear Alert";
  }
  return humanizeLabel(value);
}

function mapServiceStatusLabel(value: string) {
  if (value === "open" || value === "under_review") {
    return "Needs Repair";
  }
  if (value === "in_service") {
    return "Under Repair";
  }
  if (value === "resolved" || value === "closed") {
    return "Repaired / Ready";
  }
  return humanizeLabel(value);
}

function mapGearTone(status: GearStatus) {
  if (status === "missing") return "critical" as const;
  if (status === "needs_repair" || status === "under_repair" || status === "in_transit") return "warning" as const;
  if (status === "checked_out") return "info" as const;
  if (status === "available" || status === "in_office") return "success" as const;
  return "neutral" as const;
}

function summarizeText(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length <= 120 ? text : `${text.slice(0, 117).trimEnd()}...`;
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function getReportItemAnchor(item: GearMonthlyReportItem | GearInventoryQueueItem) {
  const reportItem = item as Partial<GearMonthlyReportItem>;
  const queueItem = item as Partial<GearInventoryQueueItem>;
  return reportItem.event_at ?? queueItem.event_at ?? reportItem.due_at ?? queueItem.expected_return_at ?? "current";
}

function formatScanLabel(timestamp: string | null | undefined, byName: string | null | undefined) {
  if (!timestamp) {
    return "No scan history yet";
  }
  return `${formatDateTime(timestamp)}${byName ? ` by ${byName}` : ""}`;
}
