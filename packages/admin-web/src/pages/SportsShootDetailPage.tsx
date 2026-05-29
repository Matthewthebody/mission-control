import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiClientError } from "../api";
import { ResourceLibraryPanel } from "../components/ResourceLibraryPanel";
import { ShootStaffingCommand } from "../components/ShootStaffingCommand";
import {
  ChangeLogTimeline,
  RiskBadge,
  StatusPill,
  WatchFlagList,
  formatDate,
  formatDateTime,
  formatTimeRange,
  humanizeToken,
  statusTone,
  useHashRouteSnapshot
} from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import { canManageSportsFinance, canViewSportsFinance } from "../permissions";
import { buildProductionProjectsHash } from "../services/productionProjects";
import {
  createSportsProofCycleRecord,
  createSportsProductItemRecord,
  createSportsTeamUnitRecord,
  createSportsWatchFlagRecord,
  deleteSportsTeamUnitRecord,
  getSportsShootDetail,
  updateSportsProofCycleRecord,
  updateSportsProductItemRecord,
  updateSportsReadinessItemRecord,
  updateSportsTeamUnitRecord,
  updateSportsWatchFlagRecord
} from "../services/sportsApi";
import { confirmShootReadyToShoot, createShootStatusEvent, getShootDetail } from "../services/shootApi";
import type {
  SportsProofCycleInput,
  SportsProductItemInput,
  SportsReadinessChecklistItemRecord,
  SportsShootDetailResponse,
  SportsSpecialtyProductItemRecord,
  SportsTeamUnitInput,
  SportsTeamUnitRecord,
  SportsWatchFlagInput,
  SportsWatchFlagRecord
} from "../sportsTypes";
import type { SessionUser, ShootDetail } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type SportsDetailTab =
  | "summary"
  | "readiness"
  | "staffing"
  | "teams"
  | "production"
  | "proofs"
  | "products"
  | "financial"
  | "activity";

const TABS: Array<{ key: SportsDetailTab; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "readiness", label: "Readiness" },
  { key: "staffing", label: "Staffing" },
  { key: "teams", label: "Teams" },
  { key: "production", label: "Production" },
  { key: "proofs", label: "Proofs" },
  { key: "products", label: "Products" },
  { key: "financial", label: "Financial" },
  { key: "activity", label: "Activity" }
];

function parseShootId(path: string) {
  const match = path.match(/^sports\/shoots\/([^/?]+)/i);
  return match?.[1] ?? null;
}

function getActiveTab(value: string | null, canViewFinance: boolean): SportsDetailTab {
  if (value === "financial" && !canViewFinance) {
    return "summary";
  }
  return TABS.some((tab) => tab.key === value) ? (value as SportsDetailTab) : "summary";
}

function buildDetailHash(shootId: string, tab: SportsDetailTab) {
  return tab === "summary" ? `#sports/shoots/${shootId}` : `#sports/shoots/${shootId}?tab=${tab}`;
}

function SummaryField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sports-detail-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailCard({
  title,
  summary,
  actions,
  children
}: {
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel sports-detail-card">
      <div className="sports-detail-card__header">
        <div>
          <h3>{title}</h3>
          {summary ? <p>{summary}</p> : null}
        </div>
        {actions ? <div className="sports-detail-card__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function groupReadiness(items: SportsReadinessChecklistItemRecord[]) {
  const grouped = new Map<string, SportsReadinessChecklistItemRecord[]>();
  for (const item of items) {
    const bucket = grouped.get(item.section) ?? [];
    bucket.push(item);
    grouped.set(item.section, bucket);
  }
  return [...grouped.entries()].map(([section, sectionItems]) => [
    section,
    sectionItems.slice().sort((left, right) => left.sort_order - right.sort_order)
  ]) as Array<[string, SportsReadinessChecklistItemRecord[]]>;
}

function promptTeamInput(existing?: SportsTeamUnitRecord): SportsTeamUnitInput | null {
  const teamName = window.prompt("Team name", existing?.team_name ?? "");
  if (!teamName?.trim()) {
    return null;
  }
  const estimated = window.prompt(
    "Estimated subject count",
    existing?.estimated_subject_count != null ? String(existing.estimated_subject_count) : ""
  );
  const specialtyNotes = window.prompt("Specialty notes", existing?.specialty_notes ?? "");
  const bannerRequired = window.confirm(
    existing?.banner_required ? "Keep banner required?" : "Does this team require banner work?"
  );
  return {
    team_name: teamName.trim(),
    display_order: existing?.display_order ?? 0,
    age_group: existing?.age_group ?? null,
    division: existing?.division ?? null,
    estimated_subject_count: estimated ? Number(estimated) : existing?.estimated_subject_count ?? null,
    actual_subject_count: existing?.actual_subject_count ?? null,
    scheduled_slot_start: existing?.scheduled_slot_start ?? null,
    scheduled_slot_end: existing?.scheduled_slot_end ?? null,
    banner_required: bannerRequired,
    specialty_notes: specialtyNotes?.trim() ? specialtyNotes.trim() : null,
    status: existing?.status ?? "planned",
    coach_contact_id: existing?.coach_contact_id ?? null,
    proof_owner_contact_id: existing?.proof_owner_contact_id ?? null
  };
}

function promptWatchFlagInput(existing?: SportsWatchFlagRecord): SportsWatchFlagInput | null {
  const title = window.prompt("Watch flag title", existing?.title ?? "");
  if (!title?.trim()) {
    return null;
  }
  const description = window.prompt("Description", existing?.description ?? "");
  const severity = window.prompt(
    "Severity (low, medium, high, critical)",
    existing?.severity ?? "medium"
  );
  return {
    title: title.trim(),
    description: description?.trim() ? description.trim() : null,
    severity: severity?.trim() || existing?.severity || "medium",
    flag_type: existing?.flag_type ?? "sports_issue",
    status: existing?.status ?? "open",
    owner_user_id: existing?.owner_user_id ?? null,
    due_at: existing?.due_at ?? null
  };
}

function promptProofInput(
  detail: SportsShootDetailResponse,
  existing?: SportsShootDetailResponse["proof_cycles"][number]
): SportsProofCycleInput | null {
  const dueDate = window.prompt(
    "Proof due date (YYYY-MM-DD)",
    existing?.due_date ?? detail.summary.proof_due_date ?? ""
  );
  const notes = window.prompt("Proof notes", existing?.notes ?? "");
  return {
    production_item_id: existing?.production_item_id ?? detail.production_items[0]?.id ?? null,
    team_unit_id: existing?.team_unit_id ?? detail.teams[0]?.id ?? null,
    approver_contact_id: existing?.approver_contact_id ?? null,
    status: existing?.status ?? "not_started",
    sent_at: existing?.sent_at ?? null,
    viewed_at: existing?.viewed_at ?? null,
    approved_at: existing?.approved_at ?? null,
    revision_count: existing?.revision_count ?? 0,
    due_date: dueDate?.trim() ? dueDate.trim() : null,
    last_follow_up_at: existing?.last_follow_up_at ?? null,
    notes: notes?.trim() ? notes.trim() : null
  };
}

function promptProductInput(
  detail: SportsShootDetailResponse,
  existing?: SportsSpecialtyProductItemRecord
): SportsProductItemInput | null {
  const title = window.prompt("Product title", existing?.title ?? "");
  if (!title?.trim()) {
    return null;
  }
  const productType = window.prompt("Product type", existing?.product_type ?? "banner");
  if (!productType?.trim()) {
    return null;
  }
  const quantity = window.prompt("Quantity", existing?.quantity != null ? String(existing.quantity) : "1");
  return {
    production_item_id: existing?.production_item_id ?? detail.production_items[0]?.id ?? null,
    team_unit_id: existing?.team_unit_id ?? detail.teams[0]?.id ?? null,
    product_type: productType.trim(),
    title: title.trim(),
    quantity: quantity ? Number(quantity) : existing?.quantity ?? 1,
    status: existing?.status ?? "queued",
    approval_required: existing?.approval_required ?? false,
    approved_at: existing?.approved_at ?? null,
    assigned_to_user_id: existing?.assigned_to_user_id ?? null,
    vendor_name: existing?.vendor_name ?? null,
    due_date: existing?.due_date ?? null,
    delivered_at: existing?.delivered_at ?? null,
    notes: existing?.notes ?? null
  };
}

async function getBrowserLocation() {
  if (!("geolocation" in navigator)) {
    return null;
  }
  return await new Promise<{ latitude: number; longitude: number; accuracy: number | null } | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null
        }),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

export function SportsShootDetailPage({ token, currentUser }: Props) {
  const { path, params } = useHashRouteSnapshot();
  const shootId = useMemo(() => parseShootId(path), [path]);
  const canViewFinance = canViewSportsFinance(currentUser);
  const canManageFinance = canManageSportsFinance(currentUser);
  const activeTab = getActiveTab(params.get("tab"), canViewFinance);
  const [detail, setDetail] = useState<SportsShootDetailResponse | null>(null);
  const [canonicalShoot, setCanonicalShoot] = useState<ShootDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canonicalError, setCanonicalError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!shootId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    setCanonicalError("");
    void Promise.allSettled([getSportsShootDetail(token, shootId), getShootDetail(token, shootId)])
      .then((results) => {
        if (cancelled) {
          return;
        }
        const sportsResult = results[0];
        if (sportsResult.status === "rejected") {
          throw sportsResult.reason;
        }
        setDetail(sportsResult.value);
        if (results[1].status === "fulfilled") {
          setCanonicalShoot(results[1].value);
        } else {
          setCanonicalShoot(null);
          setCanonicalError("The shared shoot detail could not be loaded. Sports detail is still available.");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDetail(null);
          setCanonicalShoot(null);
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load this sports shoot right now.");
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
  }, [shootId, token]);

  async function reloadAll() {
    if (!shootId) {
      return;
    }
    const nextDetail = await getSportsShootDetail(token, shootId);
    setDetail(nextDetail);
    try {
      const nextShoot = await getShootDetail(token, shootId);
      setCanonicalShoot(nextShoot);
      setCanonicalError("");
    } catch {
      setCanonicalShoot(null);
      setCanonicalError("The shared shoot detail could not be refreshed.");
    }
  }

  async function applyMutation(
    runner: () => Promise<SportsShootDetailResponse>,
    successMessage: string,
    syncCanonical = false
  ) {
    setSaving(true);
    setError("");
    try {
      const next = await runner();
      setDetail(next);
      setNotice(successMessage);
      if (syncCanonical) {
        void reloadAll();
      }
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "We couldn't save that sports update.");
    } finally {
      setSaving(false);
    }
  }

  if (!shootId) {
    return (
      <section className="sports-workspace">
        <WorkspacePageHeader eyebrow="Sports" title="Sports Shoot Detail" summary="A valid Sports shoot id was not provided in the route." />
        <WorkspaceEmptyState
          title="No sports shoot selected"
          summary="Open Sports Shoots first, then choose a row to enter the Sports shoot command center."
          actions={<button type="button" onClick={() => (window.location.hash = "#sports/shoots")}>Back To Sports Shoots</button>}
        />
      </section>
    );
  }

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading sports shoot detail" summary="Opening readiness, staffing, production, proof, product, and account context." />;
  }

  if (!detail) {
    return (
      <section className="sports-workspace">
        <WorkspacePageHeader eyebrow="Sports" title="Sports Shoot Detail" summary="The requested Sports detail workspace is unavailable." />
        <WorkspaceEmptyState
          title="Sports shoot unavailable"
          summary={error || "We couldn't open that Sports shoot right now."}
          actions={<button type="button" onClick={() => window.location.reload()}>Retry</button>}
        />
      </section>
    );
  }

  const summary = detail.summary;
  const currentAssignment = detail.staffing.people.find((person) => person.user_id === currentUser.id) ?? null;
  const canUseDayOfActions = Boolean(currentAssignment || detail.permissions.can_manage_staffing);
  const visibleTabs = TABS.filter((tab) => tab.key !== "financial" || canViewFinance);

  return (
    <section className="sports-workspace sports-detail-workspace">
      <WorkspacePageHeader
        eyebrow="Sports / Shoot Detail"
        title={`${summary.job_number ?? summary.shoot_code} - ${summary.title}`}
        summary={`${summary.organization_name ?? "Account pending"} | ${formatDate(summary.shoot_date)} | ${formatTimeRange(summary.start_time, summary.end_time)}`}
        className="sports-detail-summary-bar"
        meta={[
          { label: humanizeToken(summary.shoot_status), tone: statusTone(summary.shoot_status) === "danger" ? "critical" : (statusTone(summary.shoot_status) as "neutral" | "info" | "success" | "warning") },
          { label: `Readiness ${humanizeToken(summary.readiness_status)}`, tone: statusTone(summary.readiness_status) === "danger" ? "critical" : (statusTone(summary.readiness_status) as "neutral" | "info" | "success" | "warning") },
          { label: `Proof ${humanizeToken(summary.proof_status)}`, tone: statusTone(summary.proof_status) === "danger" ? "critical" : (statusTone(summary.proof_status) as "neutral" | "info" | "success" | "warning") },
          { label: `Production ${humanizeToken(summary.production_status)}`, tone: statusTone(summary.production_status) === "danger" ? "critical" : (statusTone(summary.production_status) as "neutral" | "info" | "success" | "warning") },
          { label: `Staffing ${humanizeToken(summary.staffing_status)}`, tone: statusTone(summary.staffing_status) === "danger" ? "critical" : (statusTone(summary.staffing_status) as "neutral" | "info" | "success" | "warning") }
        ]}
        actions={
          <WorkspaceActionBar align="end">
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/shoots")}>
              Back To Board
            </button>
            <button type="button" className="secondary-button" disabled={!detail.linked_context.organization_history_hash} onClick={() => detail.linked_context.organization_history_hash && (window.location.hash = detail.linked_context.organization_history_hash)}>
              Account History
            </button>
            <button type="button" className="secondary-button" disabled={!detail.linked_context.production_hash} onClick={() => detail.linked_context.production_hash && (window.location.hash = detail.linked_context.production_hash)}>
              Canonical Production
            </button>
          </WorkspaceActionBar>
        }
      />

      <section className="panel sports-detail-toolbar">
        <div className="sports-detail-toolbar__summary">
          <div className="sports-detail-toolbar__badges">
            <RiskBadge level={summary.risk_status} />
            <StatusPill label={summary.proof_required ? "Proof Required" : "No Proof Gate"} tone={summary.proof_required ? "warning" : "neutral"} />
            <StatusPill label={summary.specialty_products_enabled ? "Specialty Products" : "Standard Delivery"} tone={summary.specialty_products_enabled ? "warning" : "neutral"} />
            <StatusPill label={summary.revenue_share_enabled ? "Revenue Share Enabled" : "Standard Billing"} tone={summary.revenue_share_enabled ? "warning" : "neutral"} />
          </div>
          <p>Sports owns relationship management, proof approvals, staffing volatility, specialty product follow-through, and client-facing risk here.</p>
        </div>
        <nav className="sports-detail-tabs" aria-label="Sports shoot detail tabs">
          {visibleTabs.map((tab) => (
            <button key={tab.key} type="button" className={`sports-detail-tab${activeTab === tab.key ? " is-active" : ""}`} onClick={() => (window.location.hash = buildDetailHash(shootId, tab.key))}>
              {tab.label}
            </button>
          ))}
        </nav>
      </section>

      {notice ? <div className="sports-callout sports-callout--success">{notice}</div> : null}
      {error ? <div className="sports-callout sports-callout--critical">{error}</div> : null}
      {canonicalError ? <div className="sports-callout sports-callout--warning">{canonicalError}</div> : null}

      {activeTab === "summary" ? (
        <div className="sports-detail-grid">
          <div className="sports-detail-grid__main">
            <DetailCard title="Client Snapshot" summary="Shared account, location, contact, and scheduling context stays visible without forking the canonical shoot record.">
              <div className="sports-detail-field-grid">
                <SummaryField label="Organization" value={summary.organization_name ?? "Unresolved account"} />
                <SummaryField label="Primary Location" value={summary.location_name ?? "Location pending"} />
                <SummaryField label="Primary Contact" value={summary.primary_contact_name ?? "Contact pending"} />
                <SummaryField label="Approval Owner" value={detail.client_snapshot.approval_contact_name ?? "Approval owner pending"} />
                <SummaryField label="Job Owner" value={summary.account_owner_name ?? "Owner pending"} />
                <SummaryField label="Lead Photographer" value={summary.lead_photographer_name ?? "Lead pending"} />
                <SummaryField label="Sport / Season" value={`${humanizeToken(summary.sport_type)} | ${humanizeToken(summary.season)}`} />
                <SummaryField label="Next Shoot Day" value={formatDate(detail.job_days[0]?.shoot_date ?? summary.shoot_date)} />
              </div>
            </DetailCard>
            <DetailCard title="Open Watch Flags" actions={detail.permissions.can_manage_department ? <button type="button" onClick={() => void (async () => {
              const input = promptWatchFlagInput();
              if (!input) return;
              await applyMutation(() => createSportsWatchFlagRecord(token, shootId, input), "Watch flag added.");
            })()}>Add Watch Flag</button> : null}>
              <WatchFlagList items={detail.watch_flags.filter((flag) => flag.status !== "resolved" && flag.status !== "dismissed")} emptyTitle="No unresolved sports watch flags" emptyDescription="Sports watch flags surface relationship and execution risk here." onSelect={(flag) => {
                void (async () => {
                  const input = promptWatchFlagInput(flag);
                  if (!input) return;
                  await applyMutation(() => updateSportsWatchFlagRecord(token, shootId, flag.id, input), "Watch flag updated.");
                })();
              }} />
            </DetailCard>
            <DetailCard title="Notes And Instructions">
              <div className="sports-note-list">
                <div><strong>Internal Notes</strong><p>{detail.notes.internal_notes ?? "No internal notes recorded yet."}</p></div>
                <div><strong>Client Expectations</strong><p>{detail.notes.client_expectations_notes ?? detail.notes.client_notes ?? "No client expectation notes recorded yet."}</p></div>
                <div><strong>Setup / Access</strong><p>{detail.notes.setup_notes ?? "No setup notes recorded."}</p><p>{detail.notes.access_notes ?? "No access notes recorded."}</p></div>
              </div>
            </DetailCard>
            {canonicalShoot?.resource_library ? (
              <DetailCard title="Attachments">
                <ResourceLibraryPanel token={token} library={canonicalShoot.resource_library} scopeLabel="Shoot" defaultTab="media" />
              </DetailCard>
            ) : null}
          </div>
          <aside className="sports-detail-grid__side">
            <DetailCard title="Readiness Health">
              <div className={`sports-callout sports-callout--${detail.readiness.blocker_count ? "critical" : detail.readiness.warning_count ? "warning" : "success"}`}>
                <strong>{detail.readiness.percent_complete}% complete</strong>
                <span>{detail.readiness.blocker_count} blockers | {detail.readiness.warning_count} warnings</span>
              </div>
              <WorkspaceActionBar align="start">
                <button type="button" className="secondary-button" onClick={() => (window.location.hash = buildDetailHash(shootId, "readiness"))}>Open Readiness</button>
                <button type="button" className="secondary-button" onClick={() => (window.location.hash = buildDetailHash(shootId, "staffing"))}>Open Staffing</button>
              </WorkspaceActionBar>
            </DetailCard>
            <DetailCard title="Job Days">
              {detail.job_days.length ? (
                <div className="sports-mini-list">
                  {detail.job_days.map((day) => (
                    <div key={day.id} className="sports-mini-list__item">
                      <strong>Day {day.day_index + 1} - {formatDate(day.shoot_date)}</strong>
                      <span>{formatTimeRange(day.start_time, day.end_time)} | {day.location_name ?? "Location pending"}</span>
                      <span>{humanizeToken(day.status)}</span>
                    </div>
                  ))}
                </div>
              ) : <WorkspaceEmptyState title="No job days recorded" summary="Published sports jobs will list their field days here." compact />}
            </DetailCard>
            <DetailCard title="Recent Changes">
              <ChangeLogTimeline items={detail.activity.slice(0, 8)} />
            </DetailCard>
          </aside>
        </div>
      ) : null}

      {activeTab === "readiness" ? (
        <DetailCard title="Readiness Checklist" summary="Published but blocked is distinct from actually ready to shoot. Required blockers must be complete before Sports should trust the job.">
          {groupReadiness(detail.readiness.items).map(([section, items]) => (
            <section key={section} className="sports-readiness-group">
              <WorkspaceSectionHeader title={humanizeToken(section)} summary={`${items.filter((item) => item.is_complete).length}/${items.length} complete`} />
              <div className="sports-readiness-list">
                {items.map((item) => (
                  <div key={item.id} className={`sports-readiness-item${item.is_complete ? " is-complete" : ""}${item.is_blocker ? " is-blocker" : ""}`}>
                    <div className="sports-readiness-item__copy">
                      <div className="sports-readiness-item__title-row">
                        <strong>{item.label}</strong>
                        {item.is_blocker ? <StatusPill label="Blocker" tone="danger" /> : null}
                        <StatusPill label={item.is_complete ? "Complete" : "Open"} tone={item.is_complete ? "success" : "warning"} />
                      </div>
                      <div className="sports-readiness-item__meta">
                        <span>{humanizeToken(item.code)}</span>
                        <span>{item.completed_at ? formatDateTime(item.completed_at) : "Not completed yet"}</span>
                        <span>{item.completed_by_name ?? "No completer recorded"}</span>
                      </div>
                      {item.notes ? <p>{item.notes}</p> : null}
                    </div>
                    {detail.permissions.can_manage_department ? (
                      <WorkspaceActionBar align="end">
                        <button type="button" className="secondary-button" disabled={saving} onClick={() => {
                          const nextNotes = window.prompt(`Update notes for ${item.label}`, item.notes ?? "");
                          if (nextNotes == null) return;
                          void applyMutation(() => updateSportsReadinessItemRecord(token, shootId, item.id, { is_complete: item.is_complete, notes: nextNotes || null }), `${item.label} notes updated.`, true);
                        }}>
                          {item.notes ? "Edit Note" : "Add Note"}
                        </button>
                        <button type="button" disabled={saving} onClick={() => void applyMutation(() => updateSportsReadinessItemRecord(token, shootId, item.id, { is_complete: !item.is_complete, notes: item.notes }), item.is_complete ? `${item.label} reopened.` : `${item.label} marked complete.`, true)}>
                          {item.is_complete ? "Reopen" : "Mark Complete"}
                        </button>
                      </WorkspaceActionBar>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </DetailCard>
      ) : null}

      {activeTab === "staffing" ? (
        <div className="sports-detail-grid">
          <div className="sports-detail-grid__main">
            <DetailCard title="Day-Of Readiness">
              <div className="sports-detail-field-grid">
                <SummaryField label="Assigned Crew" value={`${detail.staffing.assigned_count}/${detail.staffing.required_count || 0}`} />
                <SummaryField label="Lead Photographer" value={detail.staffing.lead_photographer_name ?? "Lead pending"} />
                <SummaryField label="Lead Ready" value={detail.staffing.lead_ready.confirmed ? `Confirmed ${formatDateTime(detail.staffing.lead_ready.confirmed_at)}` : "Pending"} />
                <SummaryField label="Current User" value={currentAssignment?.role_on_job ?? "Not assigned"} />
              </div>
              <div className="sports-action-card-row">
                <section className="sports-action-card">
                  <h4>Lead Ready</h4>
                  <p>Use the shared ready-to-work signal instead of a Sports-only override.</p>
                  <WorkspaceActionBar align="start">
                    <button type="button" disabled={!canonicalShoot?.ready_to_shoot?.show_action || saving} onClick={() => void (async () => {
                      const location = await getBrowserLocation();
                      const issueNote = window.prompt("Optional note or exception reason", "");
                      try {
                        await confirmShootReadyToShoot(token, shootId, {
                          exception_reason: issueNote?.trim() || null,
                          note: issueNote?.trim() || null,
                          latitude: location?.latitude ?? null,
                          longitude: location?.longitude ?? null,
                          accuracy_meters: location?.accuracy ?? null,
                          device_context: { client: "admin_web", surface: "sports_detail_page" }
                        });
                        await reloadAll();
                        setNotice("Lead ready signal captured.");
                      } catch (mutationError) {
                        setError(mutationError instanceof Error ? mutationError.message : "We couldn't save the ready signal.");
                      }
                    })()}>
                      Ready To Work
                    </button>
                  </WorkspaceActionBar>
                </section>
                <section className="sports-action-card">
                  <h4>Field Events</h4>
                  <p>Arrival, setup, and check-in still write into the shared shoot event stream.</p>
                  <WorkspaceActionBar align="start">
                    <button type="button" className="secondary-button" disabled={!canUseDayOfActions || saving} onClick={() => void (async () => {
                      const location = await getBrowserLocation();
                      try {
                        await createShootStatusEvent(token, shootId, { type: "CLOCK_IN", captured_at: new Date().toISOString(), location_lat: location?.latitude ?? null, location_lng: location?.longitude ?? null, metadata: { surface: "sports_detail_page" } });
                        await reloadAll();
                        setNotice("Check-in captured.");
                      } catch (mutationError) {
                        setError(mutationError instanceof Error ? mutationError.message : "We couldn't save the check-in.");
                      }
                    })()}>Check In</button>
                    <button type="button" className="secondary-button" disabled={!canUseDayOfActions || saving} onClick={() => void createShootStatusEvent(token, shootId, { type: "ARRIVED", captured_at: new Date().toISOString(), metadata: { surface: "sports_detail_page" } }).then(() => reloadAll()).then(() => setNotice("Arrival captured.")).catch((mutationError) => setError(mutationError instanceof Error ? mutationError.message : "We couldn't save arrival."))}>Arrived</button>
                    <button type="button" className="secondary-button" disabled={!canUseDayOfActions || saving} onClick={() => void createShootStatusEvent(token, shootId, { type: "SETUP_COMPLETE", captured_at: new Date().toISOString(), metadata: { surface: "sports_detail_page" } }).then(() => reloadAll()).then(() => setNotice("Setup-complete captured.")).catch((mutationError) => setError(mutationError instanceof Error ? mutationError.message : "We couldn't save setup complete."))}>Setup Complete</button>
                    <button type="button" className="secondary-button" disabled={!canUseDayOfActions || saving} onClick={() => void createShootStatusEvent(token, shootId, { type: "CLOCK_OUT", captured_at: new Date().toISOString(), metadata: { surface: "sports_detail_page" } }).then(() => reloadAll()).then(() => setNotice("Check-out captured.")).catch((mutationError) => setError(mutationError instanceof Error ? mutationError.message : "We couldn't save check-out."))}>Check Out</button>
                  </WorkspaceActionBar>
                </section>
              </div>
            </DetailCard>
            <DetailCard title="Shared Staffing Planner" summary="Use the same canonical staffing control surface as the rest of Mission Control.">
              <ShootStaffingCommand token={token} shootId={shootId} canPublish={detail.permissions.can_manage_staffing} onNotice={(message) => { setNotice(message); void reloadAll(); }} onError={(message) => setError(message)} onUpdated={() => { void reloadAll(); }} />
            </DetailCard>
          </div>
          <aside className="sports-detail-grid__side">
            <DetailCard title="Check-In Roster">
              {detail.staffing.people.length ? (
                <div className="sports-roster-list">
                  {detail.staffing.people.map((person) => (
                    <div key={person.shift_id} className="sports-roster-card">
                      <div className="sports-roster-card__title-row"><strong>{person.user_name ?? "Open slot"}</strong><StatusPill label={humanizeToken(person.assignment_status)} tone={statusTone(person.assignment_status)} /></div>
                      <div className="sports-roster-card__meta"><span>{person.role_on_job ?? "Role pending"}</span><span>{person.check_in_at ? formatDateTime(person.check_in_at) : "Not checked in"}</span><span>{person.check_out_at ? formatDateTime(person.check_out_at) : "No check-out"}</span></div>
                    </div>
                  ))}
                </div>
              ) : <WorkspaceEmptyState title="No staffing assignments yet" summary="Assign the lead photographer and crew through the shared staffing planner." compact />}
            </DetailCard>
          </aside>
        </div>
      ) : null}

      {activeTab === "teams" ? (
        <DetailCard title="Team Units" actions={detail.permissions.can_manage_department ? <button type="button" disabled={saving} onClick={() => {
          const input = promptTeamInput();
          if (!input) return;
          void applyMutation(() => createSportsTeamUnitRecord(token, shootId, input), "Team unit added.");
        }}>Add Team Unit</button> : null}>
          {detail.teams.length ? (
            <div className="sports-card-grid">
              {detail.teams.map((team) => (
                <section key={team.id} className="sports-detail-card sports-detail-card--nested">
                  <div className="sports-detail-card__header">
                    <div><h3>{team.team_name}</h3><p>{humanizeToken(team.status)} | {formatTimeRange(team.scheduled_slot_start, team.scheduled_slot_end)}</p></div>
                    {detail.permissions.can_manage_department ? (
                      <WorkspaceActionBar align="end">
                        <button type="button" className="secondary-button" disabled={saving} onClick={() => {
                          const input = promptTeamInput(team);
                          if (!input) return;
                          void applyMutation(() => updateSportsTeamUnitRecord(token, shootId, team.id, input), "Team unit updated.");
                        }}>Edit</button>
                        <button type="button" className="secondary-button" disabled={saving} onClick={() => {
                          if (!window.confirm(`Remove ${team.team_name}?`)) return;
                          void applyMutation(() => deleteSportsTeamUnitRecord(token, shootId, team.id), `${team.team_name} removed.`);
                        }}>Remove</button>
                      </WorkspaceActionBar>
                    ) : null}
                  </div>
                  <div className="sports-detail-field-grid">
                    <SummaryField label="Coach" value={team.coach_contact_name ?? "Coach pending"} />
                    <SummaryField label="Proof Owner" value={team.proof_owner_contact_name ?? "Proof owner pending"} />
                    <SummaryField label="Estimated Subjects" value={team.estimated_subject_count ?? "Unknown"} />
                    <SummaryField label="Actual Subjects" value={team.actual_subject_count ?? "Not recorded"} />
                  </div>
                  {team.specialty_notes ? <div className="sports-inline-note"><strong>Specialty Notes</strong><p>{team.specialty_notes}</p></div> : null}
                </section>
              ))}
            </div>
          ) : <WorkspaceEmptyState title="No team units yet" summary="Add teams or slot groupings as soon as Sports knows the event structure." />}
        </DetailCard>
      ) : null}

      {activeTab === "production" ? (
        <DetailCard title="Sports Production Follow-Through" summary="Sports owns the filtered view here; deeper project editing still routes to the canonical Production workspace.">
          {detail.production_items.length ? (
            <div className="sports-card-grid">
              {detail.production_items.map((item) => (
                <section key={item.id} className="sports-detail-card sports-detail-card--nested">
                  <div className="sports-detail-card__header">
                    <div><h3>{item.title}</h3><p>{humanizeToken(item.production_type)} | due {formatDate(item.due_date)}</p></div>
                    <WorkspaceActionBar align="end">
                      <StatusPill label={humanizeToken(item.status)} tone={statusTone(item.status)} />
                      <button type="button" className="secondary-button" onClick={() => (window.location.hash = buildProductionProjectsHash({ projectId: item.id }))}>Open Canonical Production</button>
                    </WorkspaceActionBar>
                  </div>
                  <div className="sports-detail-field-grid">
                    <SummaryField label="Assigned To" value={item.assigned_to_name ?? "Unassigned"} />
                    <SummaryField label="QA Status" value={humanizeToken(item.qa_status)} />
                    <SummaryField label="Files" value={`${item.file_count_received ?? 0}/${item.file_count_expected ?? "TBD"}`} />
                    <SummaryField label="Vendor" value={item.vendor_name ?? "No vendor"} />
                  </div>
                  {item.blocked_reason ? <div className="sports-callout sports-callout--critical">{item.blocked_reason}</div> : null}
                </section>
              ))}
            </div>
          ) : <WorkspaceEmptyState title="No production items yet" summary="Published sports jobs seed downstream production shells automatically." />}
        </DetailCard>
      ) : null}

      {activeTab === "proofs" ? (
        <DetailCard title="Proof Cycles" actions={detail.permissions.can_manage_department || detail.permissions.can_manage_production ? <button type="button" disabled={saving} onClick={() => {
          const input = promptProofInput(detail);
          if (!input) return;
          void applyMutation(() => createSportsProofCycleRecord(token, shootId, input), "Proof cycle added.");
        }}>Create Proof Cycle</button> : null}>
          {detail.proof_cycles.length ? (
            <div className="sports-card-grid">
              {detail.proof_cycles.map((cycle) => (
                <section key={cycle.id} className="sports-detail-card sports-detail-card--nested">
                  <div className="sports-detail-card__header">
                    <div><h3>{cycle.team_unit_name ?? cycle.production_item_title ?? "Proof Cycle"}</h3><p>{cycle.approver_contact_name ?? "Approver pending"} | due {formatDate(cycle.due_date)}</p></div>
                    <WorkspaceActionBar align="end">
                      <StatusPill label={humanizeToken(cycle.status)} tone={statusTone(cycle.status)} />
                      {(detail.permissions.can_manage_department || detail.permissions.can_manage_production) ? <button type="button" className="secondary-button" disabled={saving} onClick={() => {
                        const input = promptProofInput(detail, cycle);
                        if (!input) return;
                        void applyMutation(() => updateSportsProofCycleRecord(token, shootId, cycle.id, input), "Proof cycle updated.");
                      }}>Edit</button> : null}
                    </WorkspaceActionBar>
                  </div>
                  <div className="sports-detail-field-grid">
                    <SummaryField label="Sent" value={cycle.sent_at ? formatDateTime(cycle.sent_at) : "Not sent"} />
                    <SummaryField label="Viewed" value={cycle.viewed_at ? formatDateTime(cycle.viewed_at) : "Not viewed"} />
                    <SummaryField label="Approved" value={cycle.approved_at ? formatDateTime(cycle.approved_at) : "Not approved"} />
                    <SummaryField label="Revisions" value={cycle.revision_count} />
                  </div>
                </section>
              ))}
            </div>
          ) : <WorkspaceEmptyState title="No proof cycles yet" summary="Create a proof cycle when Sports needs explicit approval tracking." />}
        </DetailCard>
      ) : null}

      {activeTab === "products" ? (
        <DetailCard title="Specialty Products" actions={detail.permissions.can_manage_department || detail.permissions.can_manage_production ? <button type="button" disabled={saving} onClick={() => {
          const input = promptProductInput(detail);
          if (!input) return;
          void applyMutation(() => createSportsProductItemRecord(token, shootId, input), "Specialty product added.");
        }}>Add Product Item</button> : null}>
          {detail.specialty_products.length ? (
            <div className="sports-card-grid">
              {detail.specialty_products.map((product) => (
                <section key={product.id} className="sports-detail-card sports-detail-card--nested">
                  <div className="sports-detail-card__header">
                    <div><h3>{product.title}</h3><p>{humanizeToken(product.product_type)} | qty {product.quantity}</p></div>
                    <WorkspaceActionBar align="end">
                      <StatusPill label={humanizeToken(product.status)} tone={statusTone(product.status)} />
                      {(detail.permissions.can_manage_department || detail.permissions.can_manage_production) ? <button type="button" className="secondary-button" disabled={saving} onClick={() => {
                        const input = promptProductInput(detail, product);
                        if (!input) return;
                        void applyMutation(() => updateSportsProductItemRecord(token, shootId, product.id, input), "Specialty product updated.");
                      }}>Edit</button> : null}
                    </WorkspaceActionBar>
                  </div>
                  <div className="sports-detail-field-grid">
                    <SummaryField label="Team" value={product.team_unit_name ?? "No team split"} />
                    <SummaryField label="Vendor" value={product.vendor_name ?? "Internal / TBD"} />
                    <SummaryField label="Due Date" value={formatDate(product.due_date)} />
                    <SummaryField label="Delivered" value={product.delivered_at ? formatDateTime(product.delivered_at) : "Not delivered"} />
                  </div>
                </section>
              ))}
            </div>
          ) : <WorkspaceEmptyState title="No specialty products yet" summary="Add banners, sponsor graphics, posters, or other specialty output when the sports job actually needs them." />}
        </DetailCard>
      ) : null}

      {activeTab === "financial" && canViewFinance ? (
        <DetailCard title="Financial Snapshot" summary="Financial visibility is permissioned. Sports managers can see invoice state and revenue-share posture without exposing hidden cost or margin data to everyone.">
          <div className="sports-detail-field-grid">
            <SummaryField label="Invoice Status" value={humanizeToken(detail.financial_summary?.invoice_status ?? "pending")} />
            <SummaryField label="Payment Status" value={humanizeToken(detail.financial_summary?.payment_status ?? "pending")} />
            <SummaryField label="Revenue Share" value={detail.financial_summary?.revenue_share_enabled ? "Enabled" : "Off"} />
            <SummaryField label="Pricing Profile" value={detail.financial_summary?.pricing_profile_name ?? "Not set"} />
            <SummaryField label="Estimated Revenue" value={detail.financial_summary?.estimated_revenue != null ? `$${detail.financial_summary.estimated_revenue}` : "Not set"} />
            <SummaryField label="Actual Revenue" value={detail.financial_summary?.actual_revenue != null ? `$${detail.financial_summary.actual_revenue}` : "Not set"} />
            <SummaryField label="Estimated Cost" value={canManageFinance ? detail.financial_summary?.estimated_cost != null ? `$${detail.financial_summary.estimated_cost}` : "Not set" : "Restricted"} />
            <SummaryField label="Actual Cost" value={canManageFinance ? detail.financial_summary?.actual_cost != null ? `$${detail.financial_summary.actual_cost}` : "Not set" : "Restricted"} />
          </div>
          {detail.financial_summary?.notes ? <div className="sports-inline-note"><strong>Notes</strong><p>{detail.financial_summary.notes}</p></div> : null}
        </DetailCard>
      ) : null}

      {activeTab === "activity" ? (
        <div className="sports-detail-grid">
          <div className="sports-detail-grid__main">
            <DetailCard title="Sports Activity Feed">
              <ChangeLogTimeline items={detail.activity} />
            </DetailCard>
          </div>
          <aside className="sports-detail-grid__side">
            <DetailCard title="Field Event Log">
              {canonicalShoot?.status_events?.length ? (
                <div className="sports-mini-list">
                  {canonicalShoot.status_events.map((event) => (
                    <div key={event.id} className="sports-mini-list__item">
                      <strong>{humanizeToken(event.type)}</strong>
                      <span>{formatDateTime(event.captured_at)}</span>
                      <span>{event.geofence_status ?? "No geofence status"}</span>
                    </div>
                  ))}
                </div>
              ) : <WorkspaceEmptyState title="No field events yet" summary="Check-in, arrival, and setup-complete events will appear here." compact />}
            </DetailCard>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
