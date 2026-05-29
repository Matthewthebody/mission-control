import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "../api";
import { buildShellRouteHash } from "../navigation";
import { canAccessRoute, hasPermission } from "../permissions";
import { getBrowserLocation } from "../services/browserLocation";
import { submitEmployeePunch } from "../services/employeeExperience";
import {
  getGlobalTimeClockState,
  TIME_CLOCK_STATE_CHANGED_EVENT,
  type TimeClockShellControlState,
  type TimeClockShellShiftPreview
} from "../services/timeClockApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type BrowserLocation = Awaited<ReturnType<typeof getBrowserLocation>>;

type PunchConfirmationState = {
  kind: "missing_location_permission" | "office_drive_outside_context" | "photography_permission";
  title: string;
  message: string;
  confirmLabel: string;
  notePlaceholder: string;
  reasonCode: string | null;
  confirmedOutsideContext: boolean;
  confirmedPermission: boolean;
};

export function GlobalPunchControl({ token, currentUser }: Props) {
  const [controlState, setControlState] = useState<TimeClockShellControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  const [confirmationState, setConfirmationState] = useState<PunchConfirmationState | null>(null);
  const [confirmationNotes, setConfirmationNotes] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  async function refreshNow() {
    const next = await getGlobalTimeClockState(token);
    setControlState(next);
    setError("");
    setSyncing(false);
    setLoading(false);
  }

  async function submitPunch(options: {
    location: BrowserLocation;
    confirmedOutsideContext?: boolean;
    confirmedPermission?: boolean;
    reasonCode?: string | null;
    notes?: string | null;
  }) {
    if (!controlState?.action?.enabled || !controlState.action.direction) {
      return;
    }

    await submitEmployeePunch(token, {
      shift_id: controlState.action.shift_id,
      shoot_id: controlState.action.shoot_id,
      direction: controlState.action.direction,
      client_timestamp: new Date().toISOString(),
      latitude: options.location?.latitude ?? null,
      longitude: options.location?.longitude ?? null,
      accuracy_meters: options.location?.accuracy ?? null,
      client_event_id: crypto.randomUUID(),
      approver_user_id: null,
      reason_code: options.reasonCode ?? null,
      notes: options.notes ?? null,
      source: "header_punch_control",
      work_state: controlState.action.work_state ?? null,
      confirmed_outside_context: options.confirmedOutsideContext ?? false,
      confirmed_permission: options.confirmedPermission ?? false
    });
    setConfirmationState(null);
    setConfirmationNotes("");
    await refreshNow();
  }

  useEffect(() => {
    if (!hasPermission(currentUser, "time.clock")) {
      return;
    }

    let cancelled = false;

    async function refresh() {
      try {
        const next = await getGlobalTimeClockState(token);
        if (!cancelled) {
          setControlState(next);
          setError("");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "We couldn't load your time clock state.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSyncing(false);
        }
      }
    }

    void refresh();
    const handleFocus = () => {
      void refresh();
    };
    const handleChanged = () => {
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener(TIME_CLOCK_STATE_CHANGED_EVENT, handleChanged);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(TIME_CLOCK_STATE_CHANGED_EVENT, handleChanged);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentUser, token]);

  useEffect(() => {
    if (!hasPermission(currentUser, "time.clock")) {
      return;
    }

    const refreshIntervalMs = controlState?.state === "active" || controlState?.state === "action_needed" ? 30_000 : 60_000;
    const interval = window.setInterval(() => {
      void refreshNow();
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [controlState?.state, currentUser, token]);

  useEffect(() => {
    if (controlState?.state !== "active") {
      return;
    }
    const interval = window.setInterval(() => {
      setElapsedNow(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [controlState?.state]);

  useEffect(() => {
    if (!panelOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [panelOpen]);

  if (!hasPermission(currentUser, "time.clock")) {
    return null;
  }

  async function handlePrimaryAction() {
    if (!controlState?.action?.enabled || !controlState.action.direction) {
      return;
    }

    setSyncing(true);
    setError("");
    setConfirmationState(null);
    try {
      const location = await getBrowserLocation();
      if (controlState.action.direction === "in" && !location) {
        setConfirmationState(buildMissingLocationConfirmation(controlState.action.work_state));
        setConfirmationNotes("");
        setSyncing(false);
        return;
      }
      await submitPunch({
        location,
        confirmedOutsideContext: false,
        confirmedPermission: false,
        reasonCode: null,
        notes: null
      });
    } catch (nextError) {
      const confirmation = resolvePunchConfirmationRequirement(nextError);
      if (confirmation) {
        setConfirmationState(confirmation);
        setConfirmationNotes("");
        setSyncing(false);
        return;
      }
      setSyncing(false);
      setError(nextError instanceof Error ? nextError.message : "We couldn't update your time clock.");
    }
  }

  async function handleConfirmationSubmit() {
    if (!confirmationState) {
      return;
    }

    setSyncing(true);
    setError("");
    try {
      await submitPunch({
        location: null,
        confirmedOutsideContext: confirmationState.confirmedOutsideContext,
        confirmedPermission: confirmationState.confirmedPermission,
        reasonCode: confirmationState.reasonCode,
        notes: confirmationNotes.trim() || null
      });
    } catch (nextError) {
      const confirmation = resolvePunchConfirmationRequirement(nextError);
      if (confirmation) {
        setConfirmationState(confirmation);
      } else {
        setConfirmationState(null);
        setError(nextError instanceof Error ? nextError.message : "We couldn't update your time clock.");
      }
      setSyncing(false);
    }
  }

  const tone = resolveTone(controlState, loading, syncing, error);
  const title = resolveTitle(controlState, loading, syncing, error);
  const secondaryLine = resolveSecondaryLine(controlState, elapsedNow, loading, syncing, error);
  const primaryDrillIn = resolvePrimaryDrillInRoute(currentUser);
  const scheduleDrillIn = resolveScheduleDrillInRoute(currentUser);
  const currentShift = controlState?.active_shift ?? controlState?.next_shift ?? null;

  return (
    <div ref={rootRef} className="global-punch-control">
      <button
        type="button"
        className={`global-punch-control__trigger global-punch-control__trigger--${tone}`}
        aria-label={`Global time clock control: ${title}`}
        aria-expanded={panelOpen}
        aria-controls="global-punch-panel"
        title={controlState?.helper_text ?? "Open time clock quick actions"}
        onClick={() => setPanelOpen((value) => !value)}
      >
        <span className="global-punch-control__signal" aria-hidden="true" />
        <span className="global-punch-control__copy">
          <strong>{title}</strong>
          <span>{secondaryLine}</span>
        </span>
      </button>

      {panelOpen ? (
        <section id="global-punch-panel" className="panel global-punch-control__panel" aria-label="Time clock quick actions">
          <div className="global-punch-control__panel-header">
            <div>
              <div className="eyebrow">Time Clock</div>
              <h3>{title}</h3>
            </div>
            <button type="button" className="secondary-button" onClick={() => setPanelOpen(false)}>
              Close
            </button>
          </div>

          <p className="global-punch-control__panel-summary">
            {controlState?.helper_text ??
              (loading ? "Checking your live time clock status." : "Open your time clock status and quick actions.")}
          </p>

          {controlState?.review?.label ? (
            <div className="global-punch-control__review-note">{controlState.review.label}</div>
          ) : null}

          {currentShift ? (
            <div className="global-punch-control__shift-card">
              <strong>{currentShift.title}</strong>
              <span>{formatShiftTimeRange(currentShift)}</span>
              <span>{currentShift.location_name ?? humanizeShiftKind(currentShift.shift_kind)}</span>
            </div>
          ) : null}

          <div className="global-punch-control__actions">
            {confirmationState ? (
              <div className="global-punch-control__confirmation">
                <div className="global-punch-control__review-note">
                  <strong>{confirmationState.title}</strong>
                  <span>{confirmationState.message}</span>
                </div>
                <label className="filter-field filter-field--wide">
                  <span>Optional review note</span>
                  <textarea
                    rows={3}
                    value={confirmationNotes}
                    onChange={(event) => setConfirmationNotes(event.target.value)}
                    placeholder={confirmationState.notePlaceholder}
                  />
                </label>
                <div className="global-punch-control__confirmation-actions">
                  <button
                    type="button"
                    className={`global-punch-control__primary-action global-punch-control__primary-action--${tone}`}
                    disabled={syncing}
                    onClick={() => void handleConfirmationSubmit()}
                  >
                    {syncing ? "Syncing..." : confirmationState.confirmLabel}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={syncing}
                    onClick={() => {
                      setConfirmationState(null);
                      setConfirmationNotes("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : controlState?.action?.enabled && controlState.action.label ? (
              <button
                type="button"
                className={`global-punch-control__primary-action global-punch-control__primary-action--${tone}`}
                disabled={syncing}
                onClick={handlePrimaryAction}
              >
                {syncing ? "Syncing..." : controlState.action.label}
              </button>
            ) : (
              <div className="global-punch-control__action-note">
                Quick punch actions only appear when there is a live shift context. Use the deeper workspace for manual reviews.
              </div>
            )}

            <div className="global-punch-control__link-row">
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = primaryDrillIn.hash)}>
                {primaryDrillIn.label}
              </button>
              {scheduleDrillIn ? (
                <button type="button" className="secondary-button" onClick={() => (window.location.hash = scheduleDrillIn.hash)}>
                  {scheduleDrillIn.label}
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="global-punch-control__error">
              <span>{error}</span>
              <button
                type="button"
                className="secondary-button"
                onClick={async () => {
                  setLoading(true);
                  try {
                    await refreshNow();
                  } catch (nextError) {
                    setError(nextError instanceof Error ? nextError.message : "Retry failed.");
                    setSyncing(false);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Retry
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function resolvePrimaryDrillInRoute(user: SessionUser) {
  if (canAccessRoute(user, "dashboard-my-day")) {
    return { hash: buildShellRouteHash("dashboard-my-day"), label: "Open My Day" };
  }
  if (canAccessRoute(user, "operations-attendance")) {
    return { hash: buildShellRouteHash("operations-attendance"), label: "Open Attendance" };
  }
  return { hash: buildShellRouteHash("dashboard"), label: "Open Home" };
}

function resolveScheduleDrillInRoute(user: SessionUser) {
  if (canAccessRoute(user, "operations-attendance") && canAccessRoute(user, "operations-schedule")) {
    return { hash: buildShellRouteHash("operations-schedule"), label: "Open Schedule" };
  }
  if (canAccessRoute(user, "dashboard-my-schedule")) {
    return { hash: buildShellRouteHash("dashboard-my-schedule"), label: "Open Schedule" };
  }
  if (canAccessRoute(user, "operations-schedule")) {
    return { hash: buildShellRouteHash("operations-schedule"), label: "Open Schedule" };
  }
  return null;
}

function resolveTone(
  controlState: TimeClockShellControlState | null,
  loading: boolean,
  syncing: boolean,
  error: string
) {
  if (syncing) {
    return "syncing";
  }
  if (loading) {
    return "loading";
  }
  if (error) {
    return "warning";
  }
  if (controlState?.emphasis === "red") {
    return "red";
  }
  if (controlState?.emphasis === "green") {
    return "green";
  }
  if (controlState?.emphasis === "amber") {
    return "warning";
  }
  return "neutral";
}

function resolveTitle(
  controlState: TimeClockShellControlState | null,
  loading: boolean,
  syncing: boolean,
  error: string
) {
  if (syncing) {
    return "Syncing...";
  }
  if (loading) {
    return "Loading Time Clock";
  }
  if (error) {
    return "Time Clock Offline";
  }
  return controlState?.label ?? "Time Clock";
}

function resolveSecondaryLine(
  controlState: TimeClockShellControlState | null,
  elapsedNow: number,
  loading: boolean,
  syncing: boolean,
  error: string
) {
  if (syncing) {
    return "Submitting your punch update";
  }
  if (loading) {
    return "Checking live punch state";
  }
  if (error) {
    return "Retry to refresh live punch status";
  }
  if (!controlState) {
    return "No live time clock state was returned";
  }
  if (controlState.state === "active" && controlState.time_clock_state.current_segment_started_at) {
    return `${formatElapsed(controlState.time_clock_state.current_segment_started_at, elapsedNow)} active`;
  }
  if (controlState.state === "off_shift") {
    return controlState.next_shift ? "No punch needed yet" : "No punch action needed";
  }
  if (controlState.state === "ended_today") {
    return "Your latest session for today is closed";
  }
  return controlState.helper_text;
}

function formatElapsed(startedAt: string, elapsedNow: number) {
  const totalSeconds = Math.max(0, Math.floor((elapsedNow - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
}

function formatShiftTimeRange(shift: TimeClockShellShiftPreview) {
  return `${formatClockTime(shift.starts_at)} - ${formatClockTime(shift.ends_at)}`;
}

function formatClockTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function humanizeShiftKind(value: string) {
  if (value === "office") {
    return "Office time";
  }
  if (value === "studio") {
    return "Studio time";
  }
  if (value === "training") {
    return "Training";
  }
  return "Assignment";
}

function buildMissingLocationConfirmation(workState: TimeClockShellControlState["action"]["work_state"]): PunchConfirmationState {
  const officeDrive = workState === "office_drive";
  return {
    kind: "missing_location_permission",
    title: "Location confirmation required",
    message: officeDrive
      ? "Mission Control could not read your location. Continue only if you are intentionally starting Office/Drive time, and expect this punch to be flagged for review."
      : "Mission Control could not read your location. Continue only if you are at the right assignment and have permission to start now. This punch will be flagged for review.",
    confirmLabel: officeDrive ? "Continue Office/Drive Start" : "Continue Without Location",
    notePlaceholder: "Add a short note if leadership should understand why location could not be captured.",
    reasonCode: "gps_issue",
    confirmedOutsideContext: officeDrive,
    confirmedPermission: !officeDrive
  };
}

function resolvePunchConfirmationRequirement(error: unknown): PunchConfirmationState | null {
  if (!(error instanceof ApiClientError)) {
    return null;
  }

  const details =
    error.details && typeof error.details === "object"
      ? (error.details as {
          code?: string;
          suggested_reason_code?: string | null;
        })
      : null;
  const suggestedReasonCode = details?.suggested_reason_code ?? null;

  if (
    details?.code === "office_drive_confirmation_required" ||
    error.message.includes("Starting Office/Drive outside the studio or linked Shoot context requires confirmation.")
  ) {
    return {
      kind: "office_drive_outside_context",
      title: "Confirm office or drive time",
      message:
        "You are starting Office/Drive time outside the normal studio or linked Shoot context. Continue only if this is expected prep or travel time. Mission Control will flag it for review.",
      confirmLabel: "Confirm Office/Drive Start",
      notePlaceholder: "Add the shortest useful context for review.",
      reasonCode: suggestedReasonCode,
      confirmedOutsideContext: true,
      confirmedPermission: false
    };
  }

  if (
    details?.code === "photography_confirmation_required" ||
    error.message.includes("Photography clock-in outside the Shoot geofence or before the allowed pre-show window requires confirmation that you have permission.")
  ) {
    return {
      kind: "photography_permission",
      title: "Confirm photography punch",
      message:
        "This photography clock-in is outside the normal Shoot location or timing window. Continue only if you have permission to start anyway. Mission Control will flag it for review.",
      confirmLabel: "I Have Permission",
      notePlaceholder: "Add a short reason if the location or timing needs manager context.",
      reasonCode: suggestedReasonCode ?? "outside_geofence",
      confirmedOutsideContext: false,
      confirmedPermission: true
    };
  }

  return null;
}
