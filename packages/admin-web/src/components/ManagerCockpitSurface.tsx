import { useEffect, useMemo, useState } from "react";
import { getManagerCockpit } from "../services/homeDashboard";
import { updateProductionProject } from "../services/productionProjects";
import { OperationalDetailSection } from "./OperationalDetailSection";
import { OperationalPreviewCard } from "./OperationalPreviewCard";
import type { ManagerCockpitQueue, ManagerCockpitQueueItem, ManagerCockpitResponse, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function ManagerCockpitSurface({ token, currentUser }: Props) {
  const [date, setDate] = useState(getLocalDateString());
  const [payload, setPayload] = useState<ManagerCockpitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getManagerCockpit(token, date)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPayload(response);
        setError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "We couldn't load the manager cockpit right now.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [date, token]);

  const summaryCards = useMemo(
    () =>
      payload
        ? [
            { label: "Open Actions", value: payload.summary.total_open, detail: "All ranked queue items in one manager cockpit." },
            { label: "Needs Staffing", value: payload.summary.needs_staffing, detail: "Open staffing pressure and lead gaps." },
            { label: "Needs Follow-Up", value: payload.summary.needs_follow_up, detail: "Accounts waiting on outreach or next steps." },
            { label: "Production Intake", value: payload.summary.needs_project_setup, detail: "Triggered production work still missing ownership or kickoff." },
            { label: "Overdue Tasks", value: payload.summary.overdue_project_tasks, detail: "Production checklist work already past due." },
            { label: "Payroll / Compliance", value: payload.summary.needs_payroll_compliance_review, detail: "Blocking payroll and compliance review items." }
          ]
        : [],
    [payload]
  );

  async function runProjectAction(projectId: string, patch: Parameters<typeof updateProductionProject>[2]) {
    setBusyProjectId(projectId);
    setError("");
    try {
      await updateProductionProject(token, projectId, patch);
      const refreshed = await getManagerCockpit(token, date);
      setPayload(refreshed);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "We couldn't update that project queue item right now.");
    } finally {
      setBusyProjectId(null);
    }
  }

  return (
    <section className="panel dashboard-panel dashboard-panel--compact">
      <div className="dashboard-panel__header">
        <div>
          <div className="eyebrow">Manager Queue</div>
          <div className="section-title">Manager Cockpit</div>
          <p className="section-subtitle">Keep open staffing, directory, production, and payroll pressure in one compact queue surface.</p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <label className="filter-field">
            <span>Anchor Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
      </div>

      {loading && !payload ? <div className="empty-state empty-state--panel">Loading the manager cockpit...</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {payload ? (
        <>
          <div className="metrics-grid metrics-grid--compact">
            {summaryCards.map((card) => (
              <article key={card.label} className="metric-card metric-card--compact">
                <div className="metric-card__label">{card.label}</div>
                <strong className="metric-card__value">{card.value}</strong>
                <div className="muted">{card.detail}</div>
              </article>
            ))}
          </div>

          <div className="dashboard-stack">
            {payload.queues.map((queue, index) => (
              <OperationalDetailSection
                key={queue.id}
                title={`${queue.label} (${queue.count})`}
                summary={queue.summary}
                badge={queue.count ? `${queue.count} open` : "Clear"}
                compact
                defaultOpen={queue.count > 0 && index === 0}
              >
                <ManagerQueueBody queue={queue} currentUser={currentUser} busyProjectId={busyProjectId} onProjectAction={runProjectAction} />
              </OperationalDetailSection>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function ManagerQueueBody({
  queue,
  currentUser,
  busyProjectId,
  onProjectAction
}: {
  queue: ManagerCockpitQueue;
  currentUser: SessionUser;
  busyProjectId: string | null;
  onProjectAction: (projectId: string, patch: Parameters<typeof updateProductionProject>[2]) => Promise<void>;
}) {
  if (!queue.items.length) {
    return <div className="empty-state empty-state--panel">No actions are open in this queue right now.</div>;
  }

  return (
    <div className="ops-preview-list">
      {queue.items.map((item) => (
        item.entity_kind === "project" && item.entity_id ? (
          <div key={item.id} className="ops-preview-action-card">
            <OperationalPreviewCard
              density="compact"
              eyebrow={humanizeQueueKind(queue.id)}
              title={item.title}
              summary={item.summary}
              owner={item.owner_label}
              statusLabel={item.status_label}
              statusTone={item.status_tone}
              meta={item.due_label ? [{ label: item.due_label, tone: "info" }] : []}
              flags={item.flags.map((flag) => ({ label: flag.label, tone: flag.tone }))}
              nextAction={item.next_action}
              onClick={() => {
                window.location.hash = item.action_hash;
              }}
            />
            <ProjectQueueActions
              item={item}
              currentUser={currentUser}
              busy={busyProjectId === item.entity_id}
              onProjectAction={onProjectAction}
            />
          </div>
        ) : (
          <OperationalPreviewCard
            key={item.id}
            density="compact"
            eyebrow={humanizeQueueKind(queue.id)}
            title={item.title}
            summary={item.summary}
            owner={item.owner_label}
            statusLabel={item.status_label}
            statusTone={item.status_tone}
            meta={item.due_label ? [{ label: item.due_label, tone: "info" }] : []}
            flags={item.flags.map((flag) => ({ label: flag.label, tone: flag.tone }))}
            nextAction={item.next_action}
            onClick={() => {
              window.location.hash = item.action_hash;
            }}
          />
        )
      ))}
    </div>
  );
}

function ProjectQueueActions({
  item,
  currentUser,
  busy,
  onProjectAction
}: {
  item: ManagerCockpitQueueItem;
  currentUser: SessionUser;
  busy: boolean;
  onProjectAction: (projectId: string, patch: Parameters<typeof updateProductionProject>[2]) => Promise<void>;
}) {
  const projectId = item.entity_id;
  const [followUpDate, setFollowUpDate] = useState(getLocalDateString());
  const [note, setNote] = useState("");
  if (!projectId) {
    return null;
  }

  return (
    <div className="ops-preview-action-bar">
      <label className="filter-field filter-field--compact">
        <span>Follow-Up</span>
        <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} disabled={busy} />
      </label>
      <label className="filter-field filter-field--compact filter-field--action-note">
        <span>Note</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional action note" disabled={busy} />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void onProjectAction(projectId, { owner_user_id: currentUser.id, latest_note: note || "Claimed from the manager cockpit." })}
      >
        Assign To Me
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void onProjectAction(projectId, { follow_up_date: followUpDate, latest_note: note || "Follow-up date updated from the manager cockpit." })}
      >
        Set Follow-Up
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void onProjectAction(projectId, { snoozed_until: addDays(getLocalDateString(), 2), latest_note: note || "Snoozed from the manager cockpit." })}
      >
        Snooze 2 Days
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void onProjectAction(projectId, { status: "completed", latest_note: note || "Completed from the manager cockpit." })}
      >
        Complete
      </button>
    </div>
  );
}

function humanizeQueueKind(value: ManagerCockpitQueue["id"]) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
