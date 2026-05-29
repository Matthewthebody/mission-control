import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { buildShellRouteHash } from "../navigation";
import { canAccessApprovalsHub, canAccessEmployeeMyWork, canAccessRoute, canAccessTeamsCommunicationSurface } from "../permissions";
import type {
  EmployeeMyWorkResponse,
  EmployeeNotificationRecord,
  EmployeeShiftPreview
} from "../services/employeeExperience";
import { fetchEmployeeMyWork } from "../services/employeeExperience";
import { getOperationalApprovalWorkspace } from "../services/operationalApprovals";
import { getStaffingDashboard } from "../services/scheduleStaffing";
import type { OperationalApprovalWorkspace, SessionUser, StaffingDashboardResponse } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  onOpenConcierge: (initialQuery?: string) => void;
};

type LoadableState<T> =
  | { status: "loading"; data: null; error: string }
  | { status: "ready"; data: T; error: string }
  | { status: "error"; data: null; error: string };

function createLoadingState<T>(): LoadableState<T> {
  return { status: "loading", data: null, error: "" };
}

function localDateInputValue(date = new Date()) {
  const offsetMinutes = date.getTimezoneOffset();
  return new Date(date.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(diffMinutes) < 60) {
    return diffMinutes >= 0 ? `in ${diffMinutes}m` : `${Math.abs(diffMinutes)}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return diffHours >= 0 ? `in ${diffHours}h` : `${Math.abs(diffHours)}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return diffDays >= 0 ? `in ${diffDays}d` : `${Math.abs(diffDays)}d ago`;
}

function navigateToHash(hash: string) {
  window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
}

function pickShiftHash(shift: EmployeeShiftPreview) {
  if (shift.shoot_id) {
    return `#schedule?shoot=${encodeURIComponent(shift.shoot_id)}`;
  }
  return buildShellRouteHash("dashboard-my-day");
}

function pickNotificationHash(notification: EmployeeNotificationRecord) {
  return notification.deep_link && notification.deep_link.startsWith("#")
    ? notification.deep_link
    : buildShellRouteHash("dashboard-alerts");
}

function ModuleShell({
  title,
  subtitle,
  tone = "neutral",
  actionLabel,
  actionHash,
  children
}: {
  title: string;
  subtitle: string;
  tone?: "neutral" | "info" | "warning" | "critical";
  actionLabel?: string;
  actionHash?: string | null;
  children: ReactNode;
}) {
  return (
    <section className={`panel teams-home__module teams-home__module--${tone}`}>
      <div className="teams-home__module-header">
        <div>
          <div className="eyebrow">Teams Home</div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {actionLabel && actionHash ? (
          <button type="button" className="secondary-button" onClick={() => navigateToHash(actionHash)}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function ModuleLoading({ label }: { label: string }) {
  return <div className="teams-home__state">Loading {label.toLowerCase()}...</div>;
}

function ModuleError({ message }: { message: string }) {
  return <div className="teams-home__state teams-home__state--error">{message}</div>;
}

function MetricList({
  items
}: {
  items: Array<{ label: string; value: string | number; tone?: "neutral" | "info" | "warning" | "critical" }>;
}) {
  return (
    <div className="teams-home__metrics">
      {items.map((item) => (
        <div key={item.label} className={`teams-home__metric${item.tone ? ` teams-home__metric--${item.tone}` : ""}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function TeamsHomePage({ token, currentUser, onOpenConcierge }: Props) {
  const anchorDate = useMemo(() => localDateInputValue(), []);
  const [myWorkState, setMyWorkState] = useState<LoadableState<EmployeeMyWorkResponse>>(() =>
    createLoadingState<EmployeeMyWorkResponse>()
  );
  const [approvalsState, setApprovalsState] = useState<LoadableState<OperationalApprovalWorkspace>>(() =>
    createLoadingState<OperationalApprovalWorkspace>()
  );
  const [staffingState, setStaffingState] = useState<LoadableState<StaffingDashboardResponse>>(() =>
    createLoadingState<StaffingDashboardResponse>()
  );

  const canSeeMyWork = canAccessEmployeeMyWork(currentUser);
  const canSeeApprovals = canAccessApprovalsHub(currentUser);
  const canSeeStaffing =
    canAccessRoute(currentUser, "operations-staffing") || canAccessRoute(currentUser, "studios-staffing");
  const canSeeCommunications = canAccessTeamsCommunicationSurface(currentUser);
  const staffingHash = canAccessRoute(currentUser, "studios-staffing")
    ? buildShellRouteHash("studios-staffing")
    : buildShellRouteHash("operations-staffing");

  useEffect(() => {
    let cancelled = false;
    if (!canSeeMyWork) {
      setMyWorkState({
        status: "error",
        data: null,
        error: "Your current role does not have access to the daily work surface."
      });
      return;
    }
    setMyWorkState(createLoadingState<EmployeeMyWorkResponse>());
    void fetchEmployeeMyWork(token, anchorDate)
      .then((response) => {
        if (!cancelled) {
          setMyWorkState({ status: "ready", data: response, error: "" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMyWorkState({
            status: "error",
            data: null,
            error: "We couldn't load your jobs, schedule, and updates right now."
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [anchorDate, canSeeMyWork, token]);

  useEffect(() => {
    let cancelled = false;
    if (!canSeeApprovals) {
      setApprovalsState({
        status: "error",
        data: null,
        error: "Approvals are not assigned to your role today."
      });
      return;
    }
    setApprovalsState(createLoadingState<OperationalApprovalWorkspace>());
    void getOperationalApprovalWorkspace(token)
      .then((response) => {
        if (!cancelled) {
          setApprovalsState({ status: "ready", data: response, error: "" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApprovalsState({
            status: "error",
            data: null,
            error: "We couldn't load your approvals and pending follow-through."
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canSeeApprovals, token]);

  useEffect(() => {
    let cancelled = false;
    if (!canSeeStaffing) {
      setStaffingState({
        status: "error",
        data: null,
        error: "Staffing alerts are hidden for your current role."
      });
      return;
    }
    setStaffingState(createLoadingState<StaffingDashboardResponse>());
    void getStaffingDashboard(token, anchorDate)
      .then((response) => {
        if (!cancelled) {
          setStaffingState({ status: "ready", data: response, error: "" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStaffingState({
            status: "error",
            data: null,
            error: "We couldn't load staffing alerts right now."
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [anchorDate, canSeeStaffing, token]);

  const myWork = myWorkState.status === "ready" ? myWorkState.data : null;
  const approvals = approvalsState.status === "ready" ? approvalsState.data : null;
  const staffing = staffingState.status === "ready" ? staffingState.data : null;
  const topShifts = myWork?.shifts.slice(0, 3) ?? [];
  const updates = myWork?.notifications.slice(0, 5) ?? [];

  return (
    <div className="teams-home">
      <section className="panel teams-home__hero">
        <div className="teams-home__hero-copy">
          <div className="eyebrow">Teams Personal App</div>
          <h1>
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},{" "}
            {currentUser.fullName.split(" ")[0]}.
          </h1>
          <p>
            This Teams home keeps the daily essentials in one place while Mission Control stays authoritative:
            assignments, today's schedule, tasks and approvals, staffing pressure, quick search, and the updates that
            matter most.
          </p>
        </div>
        <MetricList
          items={[
            { label: "Department", value: currentUser.department || "General", tone: "info" },
            { label: "Role", value: currentUser.primaryJobFunctionProfile.replace(/_/g, " "), tone: "neutral" },
            {
              label: "Trust",
              value: currentUser.sessionTrust.identityProvider === "microsoft_entra" ? "Microsoft linked" : "Session ready",
              tone: "info"
            }
          ]}
        />
      </section>

      <div className="teams-home__grid">
        <ModuleShell
          title="My Jobs / Assignments"
          subtitle="Upcoming work you own or need to be ready for."
          actionLabel="Open My Work"
          actionHash={buildShellRouteHash("dashboard-my-day")}
        >
          {myWorkState.status === "loading" ? <ModuleLoading label="assignments" /> : null}
          {myWorkState.status === "error" ? <ModuleError message={myWorkState.error} /> : null}
          {myWork ? (
            <>
              <MetricList
                items={[
                  { label: "Today", value: myWork.summary.shifts_today, tone: "info" },
                  { label: "Upcoming", value: myWork.summary.upcoming_shifts, tone: "neutral" },
                  {
                    label: "Attention Needed",
                    value: myWork.summary.attention_needed_count,
                    tone: myWork.summary.attention_needed_count > 0 ? "warning" : "neutral"
                  }
                ]}
              />
              {topShifts.length ? (
                <div className="teams-home__list">
                  {topShifts.map((shift) => (
                    <button
                      key={shift.id}
                      type="button"
                      className="teams-home__list-item"
                      onClick={() => navigateToHash(pickShiftHash(shift))}
                    >
                      <strong>{shift.shoot_title || shift.title}</strong>
                      <span>
                        {[formatDateTime(shift.starts_at), shift.location_name, shift.staffing_role].filter(Boolean).join(" | ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="teams-home__state">No assignments are scheduled in your current window.</div>
              )}
            </>
          ) : null}
        </ModuleShell>

        <ModuleShell
          title="Today's Schedule"
          subtitle="Your day at a glance, with the next timing checkpoint front and center."
          actionLabel="Open Schedule"
          actionHash={buildShellRouteHash("dashboard-my-schedule")}
          tone="info"
        >
          {myWorkState.status === "loading" ? <ModuleLoading label="schedule" /> : null}
          {myWorkState.status === "error" ? <ModuleError message={myWorkState.error} /> : null}
          {myWork ? (
            <>
              <MetricList
                items={[
                  {
                    label: "Next Shift",
                    value: myWork.summary.next_shift_label || "No shift queued",
                    tone: myWork.summary.next_shift_label ? "info" : "neutral"
                  },
                  { label: "Clocked In", value: myWork.summary.clocked_in_shift_count, tone: "neutral" },
                  {
                    label: "Late / Exceptions",
                    value: myWork.summary.late_or_exception_count,
                    tone: myWork.summary.late_or_exception_count > 0 ? "warning" : "neutral"
                  }
                ]}
              />
              <div className="teams-home__subcopy">
                Use the full schedule workspace when you need shift-level timing, route details, or deeper calendar
                context.
              </div>
            </>
          ) : null}
        </ModuleShell>

        <ModuleShell
          title="My Tasks / Approvals"
          subtitle="Approvals stay visible when they belong to you; everyone else still gets a compact follow-through view."
          actionLabel={canSeeApprovals ? "Open Approvals" : "Open My Work"}
          actionHash={canSeeApprovals ? buildShellRouteHash("people-ops-approvals") : buildShellRouteHash("dashboard-my-day")}
          tone={canSeeApprovals ? "warning" : "neutral"}
        >
          {canSeeApprovals ? (
            approvalsState.status === "loading" ? (
              <ModuleLoading label="approvals" />
            ) : approvalsState.status === "error" ? (
              <ModuleError message={approvalsState.error} />
            ) : approvals ? (
              <>
                <MetricList
                  items={[
                    {
                      label: "Awaiting My Decision",
                      value: approvals.summary.awaiting_my_decision,
                      tone: approvals.summary.awaiting_my_decision > 0 ? "warning" : "neutral"
                    },
                    {
                      label: "Overdue",
                      value: approvals.summary.overdue,
                      tone: approvals.summary.overdue > 0 ? "critical" : "neutral"
                    },
                    {
                      label: "Blocking",
                      value: approvals.summary.pending_blocking,
                      tone: approvals.summary.pending_blocking > 0 ? "critical" : "neutral"
                    }
                  ]}
                />
                <div className="teams-home__list">
                  {approvals.awaiting_my_decision.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="teams-home__list-item"
                      onClick={() => navigateToHash(buildShellRouteHash("people-ops-approvals"))}
                    >
                      <strong>{item.request_title}</strong>
                      <span>
                        {[item.status_label, item.source_entity_label, item.current_approver_role_group_label].filter(Boolean).join(" | ")}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null
          ) : myWorkState.status === "loading" ? (
            <ModuleLoading label="follow-through items" />
          ) : myWorkState.status === "error" ? (
            <ModuleError message={myWorkState.error} />
          ) : myWork ? (
            <>
              <MetricList
                items={[
                  {
                    label: "Pending Trades",
                    value: myWork.summary.pending_trade_requests,
                    tone: myWork.summary.pending_trade_requests > 0 ? "warning" : "neutral"
                  },
                  {
                    label: "Closeout Due",
                    value: myWork.summary.closeout_due_count,
                    tone: myWork.summary.closeout_due_count > 0 ? "warning" : "neutral"
                  },
                  {
                    label: "Mileage Reviews",
                    value: myWork.summary.mileage_review_count,
                    tone: myWork.summary.mileage_review_count > 0 ? "info" : "neutral"
                  }
                ]}
              />
              <div className="teams-home__subcopy">
                Your role does not need the shared approvals desk today, so this card stays focused on personal
                follow-through.
              </div>
            </>
          ) : null}
        </ModuleShell>

        {canSeeStaffing ? (
          <ModuleShell
            title="Staffing Alerts"
            subtitle="High-signal coverage and conflict pressure that should be reviewed quickly."
            actionLabel="Open Staffing"
            actionHash={staffingHash}
            tone="critical"
          >
            {staffingState.status === "loading" ? <ModuleLoading label="staffing alerts" /> : null}
            {staffingState.status === "error" ? <ModuleError message={staffingState.error} /> : null}
            {staffing ? (
              <>
                <MetricList
                  items={[
                    {
                      label: "Open Slots",
                      value: staffing.summary.open_staffing_slots,
                      tone: staffing.summary.open_staffing_slots > 0 ? "critical" : "neutral"
                    },
                    {
                      label: "Understaffed",
                      value: staffing.summary.understaffed_shoots,
                      tone: staffing.summary.understaffed_shoots > 0 ? "warning" : "neutral"
                    },
                    {
                      label: "Conflict Warnings",
                      value: staffing.summary.conflict_warnings,
                      tone: staffing.summary.conflict_warnings > 0 ? "warning" : "neutral"
                    }
                  ]}
                />
                <div className="teams-home__list">
                  {[...staffing.open_coverage.slice(0, 2), ...staffing.missing_lead.slice(0, 1)].map((item) => (
                    <button
                      key={`${item.shoot_id}-${item.next_action}`}
                      type="button"
                      className="teams-home__list-item"
                      onClick={() => navigateToHash(`#schedule/staffing?shoot=${encodeURIComponent(item.shoot_id)}`)}
                    >
                      <strong>{item.title}</strong>
                      <span>{[item.location_label, item.time_label, item.shoot_date].filter(Boolean).join(" | ")}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </ModuleShell>
        ) : null}

        <ModuleShell title="Quick Search" subtitle="Jump into Kemmetmueller Concierge without leaving Teams." tone="info">
          <div className="teams-home__quick-actions">
            <button type="button" onClick={() => onOpenConcierge()}>
              Ask Concierge anything...
            </button>
            <button type="button" className="secondary-button" onClick={() => onOpenConcierge("today's schedule")}>
              Today's schedule
            </button>
            <button type="button" className="secondary-button" onClick={() => onOpenConcierge("staffing conflicts")}>
              Staffing conflicts
            </button>
            <button type="button" className="secondary-button" onClick={() => onOpenConcierge("overdue production items")}>
              Overdue production
            </button>
          </div>
        </ModuleShell>

        {canSeeCommunications ? (
          <ModuleShell
            title="Teams Entry Points"
            subtitle="Open the focused Teams utility for human-facing record actions, urgent issues, and deep links back into Mission Control."
            actionLabel="Open Actions"
            actionHash={buildShellRouteHash("teams-communications")}
            tone="info"
          >
            <MetricList
              items={[
                { label: "Messaging", value: "Teams", tone: "info" },
                { label: "Meetings", value: "Linked", tone: "neutral" },
                { label: "Deep Links", value: "Ready", tone: "neutral" }
              ]}
            />
            <div className="teams-home__subcopy">
              Use the Teams actions utility when you need a reviewed Teams destination, a linked meeting, or a quick jump
              into the underlying job or task screen.
            </div>
          </ModuleShell>
        ) : null}

        <ModuleShell
          title="Recent Important Updates"
          subtitle="Unread or recent changes that deserve a fast second look."
          actionLabel="Open Notifications"
          actionHash={buildShellRouteHash("dashboard-alerts")}
        >
          {myWorkState.status === "loading" ? <ModuleLoading label="updates" /> : null}
          {myWorkState.status === "error" ? <ModuleError message={myWorkState.error} /> : null}
          {myWork ? (
            updates.length ? (
              <div className="teams-home__list">
                {updates.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    className="teams-home__list-item teams-home__list-item--notification"
                    onClick={() => navigateToHash(pickNotificationHash(notification))}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                    <small>{[notification.priority, formatRelativeTime(notification.created_at)].filter(Boolean).join(" | ")}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="teams-home__state">No urgent updates are waiting on you right now.</div>
            )
          ) : null}
        </ModuleShell>
      </div>
    </div>
  );
}
