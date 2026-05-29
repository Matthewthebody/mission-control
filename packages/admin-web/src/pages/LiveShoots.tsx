import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch } from "../api";
import { OperationsLaneStrip } from "../components/OperationsLaneStrip";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import { ShootDetailDrawer } from "../components/ShootDetailDrawer";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { canAccessAlertsHub, canAccessApprovalsHub, canAccessGraphicsWorkspace } from "../permissions";
import type {
  AlertSocketPayload,
  LiveShootQueueEntry,
  LiveShootQueueResponse,
  SessionUser,
  ShootDetail,
  ShootSummary,
  StatusEventSocketPayload
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
  realtimeStatus: "connecting" | "connected" | "error";
  workspaceMode?: "operations" | "photography";
};

export function LiveShoots({ token, currentUser, socket, realtimeStatus, workspaceMode = "operations" }: Props) {
  const [date, setDate] = useState(getLocalDateString());
  const [search, setSearch] = useState("");
  const [routeShootId, setRouteShootId] = useState<string | null>(() => parseShootQueueHash());
  const [queue, setQueue] = useState<LiveShootQueueResponse | null>(null);
  const [selectedShootSummary, setSelectedShootSummary] = useState<ShootSummary | null>(null);
  const [selectedShootDetail, setSelectedShootDetail] = useState<ShootDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const routeBase = workspaceMode === "photography" ? "#photography/shoots" : "#operations/shoots";
  const scheduleHash = workspaceMode === "photography" ? "#photography/calendar" : "#schedule";
  const workspaceEyebrow = workspaceMode === "photography" ? "Photography Workspace" : "Operations Workspace";
  const workspaceTitle = workspaceMode === "photography" ? "Shoot Execution Queue" : "Shoot Management Queue";
  const workspaceSummary =
    workspaceMode === "photography"
      ? "Photography owns field execution, readiness, pre-service, and travel clarity. Work every shoot from the same dense queue instead of bouncing between schedule, readiness, and contact views."
      : "Work every shoot by action needed instead of hunting through a flat list. Leadership gets one queue for staffing pressure, review work, cleanly scheduled jobs, and historical follow-through.";

  async function load(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setLoading(true);
    }
    try {
      const nextQueue = await apiFetch<LiveShootQueueResponse>(`/api/shoots/live-queue?date=${date}`, token);
      const nextEntries = flattenQueueEntries(nextQueue);
      setQueue(nextQueue);
      setSelectedShootSummary((current) => (current ? nextEntries.find((entry) => entry.shoot.id === current.id)?.shoot ?? null : null));
      setSelectedShootDetail((current) => (current && nextEntries.some((entry) => entry.shoot.id === current.id) ? current : null));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "We couldn't load the shoots queue for this date.");
    } finally {
      if (!options.quiet) {
        setLoading(false);
      }
    }
  }

  async function openShootWorkspace(shoot: ShootSummary) {
    const targetHash = `${routeBase}?shoot=${shoot.id}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    setSelectedShootSummary(shoot);
    setSelectedShootDetail((current) => (current?.id === shoot.id ? current : null));
    setDetailLoading(true);
    setDetailError("");
    try {
      const detail = await apiFetch<ShootDetail>(`/api/shoots/${shoot.id}`, token);
      setSelectedShootDetail(detail);
    } catch (loadError) {
      setSelectedShootDetail(null);
      setDetailError(loadError instanceof Error ? loadError.message : "We couldn't load that shoot workspace.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshSelectedShoot(shootId: string) {
    try {
      const detail = await apiFetch<ShootDetail>(`/api/shoots/${shootId}`, token);
      setSelectedShootDetail(detail);
      setDetailError("");
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "We couldn't refresh that shoot workspace.");
    }
  }

  function closeShootWorkspace() {
    if (
      window.location.hash.startsWith("#shoots?") ||
      window.location.hash.startsWith("#operations/shoots?") ||
      window.location.hash.startsWith("#photography/shoots?")
    ) {
      window.location.hash = routeBase;
    }
    setSelectedShootSummary(null);
    setSelectedShootDetail(null);
    setDetailLoading(false);
    setDetailError("");
  }

  useEffect(() => {
    const sync = () => {
      setRouteShootId(parseShootQueueHash());
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    void load();
  }, [date, token]);

  useEffect(() => {
    if (!selectedShootSummary) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeShootWorkspace();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedShootSummary]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2500);
    const onStatus = (payload: StatusEventSocketPayload) => {
      setLiveMessage(`Live update: ${payload.type} for ${payload.shoot_code}`);
      void load({ quiet: true });
      if (payload.shoot_id && selectedShootSummary?.id === payload.shoot_id) {
        void refreshSelectedShoot(payload.shoot_id);
      }
      clearLiveMessage();
    };
    const onAlert = (payload: AlertSocketPayload) => {
      setLiveMessage(`Alert created: ${payload.alert_type} for ${payload.shoot_code}`);
      void load({ quiet: true });
      if (payload.shoot_id && selectedShootSummary?.id === payload.shoot_id) {
        void refreshSelectedShoot(payload.shoot_id);
      }
      clearLiveMessage();
    };
    const onScheduleChanged = (payload: StatusEventSocketPayload) => {
      setLiveMessage(
        payload.shoot_code ? `Live update: schedule changed for ${payload.shoot_code}` : "Live update: schedule changed."
      );
      void load({ quiet: true });
      if (payload.shoot_id && selectedShootSummary?.id === payload.shoot_id) {
        void refreshSelectedShoot(payload.shoot_id);
      }
      clearLiveMessage();
    };
    socket.on("status_event", onStatus);
    socket.on("alert_created", onAlert);
    socket.on("schedule_changed", onScheduleChanged);
    return () => {
      socket.off("status_event", onStatus);
      socket.off("alert_created", onAlert);
      socket.off("schedule_changed", onScheduleChanged);
    };
  }, [date, selectedShootSummary?.id, socket, token]);

  const allQueueEntries = useMemo(() => flattenQueueEntries(queue), [queue]);

  useEffect(() => {
    if (!routeShootId) {
      return;
    }
    const targetEntry = allQueueEntries.find((entry) => entry.shoot.id === routeShootId);
    if (targetEntry) {
      if (selectedShootSummary?.id !== targetEntry.shoot.id) {
        void openShootWorkspace(targetEntry.shoot);
      }
      return;
    }
    if (selectedShootSummary?.id === routeShootId || detailLoading) {
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    void apiFetch<ShootDetail>(`/api/shoots/${routeShootId}`, token)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setSelectedShootSummary(detail);
        setSelectedShootDetail(detail);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDetailError(loadError instanceof Error ? loadError.message : "We couldn't load that shoot workspace.");
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
  }, [allQueueEntries, routeShootId, selectedShootSummary?.id]);

  const filteredSections = useMemo(
    () =>
      (queue?.sections ?? []).map((section) => ({
        ...section,
        items: search.trim() ? section.items.filter((entry) => matchesSearch(entry, search)) : section.items
      })),
    [queue, search]
  );

  const summaryCounts = {
    inView: filteredSections.reduce((count, section) => count + section.items.length, 0),
    needsStaffing: filteredSections.find((section) => section.id === "needs_staffing")?.items.length ?? 0,
    needsReview: filteredSections.find((section) => section.id === "needs_review")?.items.length ?? 0,
    completed: filteredSections.find((section) => section.id === "completed")?.items.length ?? 0
  };

  const selectedEntry = selectedShootSummary ? allQueueEntries.find((entry) => entry.shoot.id === selectedShootSummary.id) ?? null : null;
  const operationsLinks = [
    { id: "alerts", label: "Alerts", visible: canAccessAlertsHub(currentUser), onClick: () => { window.location.hash = "#dashboard/alerts"; } },
      { id: "projects", label: "Production", visible: canAccessGraphicsWorkspace(currentUser), onClick: () => { window.location.hash = "#production"; } },
    { id: "approvals", label: "Approvals", visible: canAccessApprovalsHub(currentUser), onClick: () => { window.location.hash = "#approvals"; } }
  ].filter((link) => link.visible).map(({ visible: _visible, ...link }) => link);

  return (
    <div className="workspace-shell">
      <section className="page-intro page-intro--workspace panel">
        <div className="page-intro__body">
          <div className="eyebrow">{workspaceEyebrow}</div>
          <h2>{workspaceTitle}</h2>
          <p>{workspaceSummary}</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <div className={`status-pill status-pill--${realtimeStatus}`}>Realtime {realtimeStatus}</div>
          <button
            className="secondary-button"
            onClick={() => {
              window.location.hash = scheduleHash;
            }}
          >
            Open Schedule
          </button>
        </div>
      </section>

      {workspaceMode === "operations" ? (
        <section className="panel sports-boundary-card">
          <div className="sports-boundary-card__copy">
            <div className="eyebrow">Sports Workspace</div>
            <h3>Sports intake and follow-through now live in Sports</h3>
            <p>
              Operations keeps the same-day live queue. New Sports jobs, Sports imports, and Sports-specific
              relationship/proof/product workflows belong in the Sports tab so this route does not become a
              disguised Sports clone.
            </p>
          </div>
          <WorkspaceActionBar align="start">
            <button type="button" onClick={() => (window.location.hash = "#sports")}>
              Open Sports
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/jobs")}>
              Open Sports Jobs
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#sports/jobs/import")}>
              Import Sports Jobs
            </button>
          </WorkspaceActionBar>
        </section>
      ) : (
        <section className="panel sports-boundary-card">
          <div className="sports-boundary-card__copy">
            <div className="eyebrow">Photography Routing</div>
            <h3>Photography is now the field-execution owner</h3>
            <p>
              Shoots, readiness, travel, and pre-service now belong in Photography. Operations keeps cross-functional oversight instead of owning a second field board.
            </p>
          </div>
          <WorkspaceActionBar align="start">
            <button type="button" onClick={() => (window.location.hash = "#photography/readiness")}>
              Open Readiness
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#photography/travel")}>
              Open Travel
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#operations/today")}>
              Open Today
            </button>
          </WorkspaceActionBar>
        </section>
      )}

      <OperationsLaneStrip
        title={workspaceMode === "photography" ? "Keep field execution inside Photography" : "Keep shoot work inside Operations"}
        summary={
          workspaceMode === "photography"
            ? "Photography owns shoot execution while staying connected to the shared schedule, staffing pressure, and production follow-through."
            : "Shoots stay connected to the visual calendar, staffing pressure, and production follow-through instead of living as a separate queue island."
        }
        lanes={[
          {
            id: "calendar",
            label: "Calendar",
            summary: "Open the calendar-first operations board for same-day rhythm and linked shoots.",
            tone: "info",
            onClick: () => {
              window.location.hash = scheduleHash;
            }
          },
          {
            id: "needs-staffing",
            label: "Needs Staffing",
            summary: "Jump straight into staffing control when lead coverage or open slots need action.",
            badge: summaryCounts.needsStaffing ? `${summaryCounts.needsStaffing} open` : null,
            tone: summaryCounts.needsStaffing ? "warning" : "neutral",
            onClick: () => {
              window.location.hash = workspaceMode === "photography" ? "#photography/staffing" : "#operations/staffing?area=staffing";
            }
          },
          {
            id: "shoots",
            label: "Shoots Queue",
            summary: "Work every active shoot by bucket, next action, and readiness state.",
            active: true,
            badge: `${summaryCounts.inView} in view`,
            tone: "warning",
            onClick: () => {
              window.location.hash = routeBase;
            }
          }
        ]}
        links={operationsLinks}
      />

      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <label className="filter-field">
            <span>Queue Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Find Shoot</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by code, title, location, lead, or contact"
            />
          </label>
        </div>
        <div className="workspace-toolbar__actions">
            <button className="secondary-button" onClick={() => void load()}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          {search ? (
            <button className="secondary-button" onClick={() => setSearch("")}>
              Clear Search
            </button>
          ) : null}
        </div>
      </section>

      <section className="metrics-grid workspace-summary-strip">
        <article className="stat-card panel">
          <div className="eyebrow">Shoots In View</div>
          <strong>{summaryCounts.inView}</strong>
          <span className="muted">Every shoot on the selected date stays in one leadership queue.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Needs Staffing</div>
          <strong>{summaryCounts.needsStaffing}</strong>
          <span className="muted">Open headcount or lead coverage still needs action.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Needs Review</div>
          <strong>{summaryCounts.needsReview}</strong>
          <span className="muted">Exceptions, sync concerns, or readiness warnings are still open.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Completed / Archived</div>
          <strong>{summaryCounts.completed}</strong>
          <span className="muted">Historical shoots stay available without crowding the active queue.</span>
        </article>
      </section>

      {error ? (
        <div className="inline-banner-actions">
          <div className="error-banner">{error}</div>
          <button className="secondary-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}
      {liveMessage ? <div className="live-banner">{liveMessage}</div> : null}
      {loading && !queue ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading shoots</div>
          <p className="section-subtitle">Pulling the active shoot queue, drill-in context, and leadership review state for the selected date.</p>
        </section>
      ) : null}

      <section className="shoots-queue-grid">
        {filteredSections.map((section) => (
          <section key={section.id} className="panel shoot-queue-section">
            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">{section.title}</div>
                <p className="section-subtitle">{section.summary}</p>
              </div>
              <span className="metric-pill">{section.items.length}</span>
            </div>
            {section.items.length ? (
              <div className="ops-preview-list">
                {section.items.map((entry) => (
                  <OperationalPreviewCard
                    key={entry.shoot.id}
                    eyebrow={humanizeDepartment(entry.shoot.department)}
                    title={entry.shoot.title}
                    summary={entry.summary_string}
                    owner={entry.owner_label}
                    statusLabel={entry.status_label}
                    statusTone={entry.status_tone}
                    meta={[
                      { label: entry.staffing_summary.label, tone: entry.staffing_summary.tone },
                      { label: entry.sync_summary.label, tone: entry.sync_summary.tone }
                    ]}
                    flags={entry.key_flags.map((flag) => ({ label: flag.label, tone: flag.tone }))}
                    nextAction={entry.next_action}
                    selected={selectedShootSummary?.id === entry.shoot.id}
                    onClick={() => {
                      void openShootWorkspace(entry.shoot);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state empty-state--panel">{section.empty_state}</div>
            )}
          </section>
        ))}
      </section>

      <ShootDetailDrawer
        token={token}
        currentUser={currentUser}
        shootSummary={selectedShootSummary}
        shoot={selectedShootDetail}
        loading={detailLoading}
        error={detailError}
        queueLabel={selectedEntry?.bucket_label ?? null}
        nextAction={selectedEntry?.next_action ?? null}
        onUpdated={async (detail) => {
          setSelectedShootSummary(detail);
          setSelectedShootDetail(detail);
          await load({ quiet: true });
        }}
        onClose={closeShootWorkspace}
      />
    </div>
  );
}

function flattenQueueEntries(queue: LiveShootQueueResponse | null): LiveShootQueueEntry[] {
  return queue?.sections.flatMap((section) => section.items) ?? [];
}

function matchesSearch(entry: LiveShootQueueEntry, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }

  const haystack = [
    entry.shoot.shoot_code,
    entry.shoot.title,
    entry.shoot.organization_display_name,
    entry.shoot.location_name,
    entry.shoot.location_address,
    entry.shoot.lead_name,
    entry.shoot.primary_contact_name,
    entry.shoot.secondary_contact_name,
    ...(entry.shoot.additional_contacts?.map((contact) => contact.full_name) ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function humanizeDepartment(value?: string | null): string {
  if (!value) {
    return "Shoot";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseShootQueueHash() {
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  return params.get("shoot");
}
