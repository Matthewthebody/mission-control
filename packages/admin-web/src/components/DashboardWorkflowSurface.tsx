import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import type { ComplianceWorkspaceListPayload } from "../complianceTypes";
import { listComplianceWorkspace } from "../services/complianceApi";
import { canAccessComplianceWorkspace, canManageAttendanceWorkspace, canViewWorkflowSnapshot } from "../permissions";
import { OperationalDetailSection } from "./OperationalDetailSection";
import { OperationalPreviewCard } from "./OperationalPreviewCard";
import type { OperationsDashboard, SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

export function DashboardWorkflowSurface({ token, currentUser }: Props) {
  const [date, setDate] = useState(getLocalDateString());
  const [operations, setOperations] = useState<OperationsDashboard | null>(null);
  const [compliance, setCompliance] = useState<ComplianceWorkspaceListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canSeeWorkflow = canViewWorkflowSnapshot(currentUser);
  const canSeeReviewDesk = canAccessComplianceWorkspace(currentUser);

  useEffect(() => {
    if (!canSeeWorkflow) {
      setOperations(null);
      setCompliance(null);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      apiFetch<OperationsDashboard>(`/api/dashboard/operations?date=${date}`, token),
      canSeeReviewDesk
        ? listComplianceWorkspace(token, {
            date,
            window: "today",
            status: "unresolved"
          }).catch(() => null)
        : Promise.resolve(null)
    ])
      .then(([operationsPayload, compliancePayload]) => {
        if (cancelled) {
          return;
        }
        setOperations(operationsPayload);
        setCompliance(compliancePayload);
        setError("");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "We couldn't load assignment workflow visibility right now.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canSeeReviewDesk, canSeeWorkflow, date, token]);

  if (!canSeeWorkflow) {
    return null;
  }

  const summaryCards = useMemo(() => {
    if (!operations) {
      return [];
    }

    const attendanceRiskCount =
      Number(operations.summary.late_warning_count ?? 0) +
      Number(operations.summary.no_show_suspected_count ?? 0) +
      Number(operations.summary.no_shows ?? 0);
    const followThroughCount = compliance?.summary.missing_closeout_count ?? 0;
    const mileageOrPayrollCount =
      (compliance?.summary.mileage_blocking_count ?? 0) + (compliance?.summary.payroll_blocking_count ?? 0);

    return [
      {
        label: "Assigned Today",
        value: operations.summary.scheduled_employees,
        detail: `${operations.summary.clocked_in_employees} clocked in now`,
        actionHash: "#operations/schedule"
      },
      {
        label: "Attendance Risk",
        value: attendanceRiskCount,
        detail: attendanceRiskCount ? "Late, no-show, or unresolved attendance pressure." : "No same-day attendance escalations are open.",
        actionHash: "#operations/attendance"
      },
      {
        label: "Follow-Through",
        value: followThroughCount,
        detail: followThroughCount ? "Closeout, setup, or end-of-day work is still open." : "No missing closeout items are blocking the day.",
        actionHash: "#project-tracking"
      },
      {
        label: "Mileage / Payroll",
        value: mileageOrPayrollCount,
        detail: mileageOrPayrollCount ? "Mileage or payroll review still needs attention." : "Mileage and payroll blockers look clear right now.",
        actionHash: mileageOrPayrollCount ? "#employees/payroll" : "#operations/attendance"
      }
    ];
  }, [compliance, operations]);

  const atRiskShifts = useMemo(() => {
    if (!operations) {
      return [];
    }
    return operations.shifts
      .filter(
        (shift) =>
          isAttendanceRisk(shift.attendance_state ?? null) ||
          Number(shift.open_exception_count ?? 0) > 0 ||
          String(shift.latest_approval_state ?? "") === "pending"
      )
      .slice(0, 4);
  }, [operations]);

  const followThroughRows = useMemo(() => {
    if (!compliance) {
      return [];
    }
    return compliance.rows
      .filter((row) =>
        [
          "missing_setup_photo",
          "missing_post_shoot_evaluation",
          "mileage_blocked_missing_post_shoot_evaluation",
          "unresolved_end_of_day_confirmation"
        ].includes(row.issue_type)
      )
      .slice(0, 4);
  }, [compliance]);

  return (
    <section className="panel dashboard-panel dashboard-panel--compact">
      <div className="dashboard-panel__header">
        <div>
          <div className="eyebrow">Daily Workflow Snapshot</div>
          <div className="section-title">Assignment To Completion</div>
          <p className="section-subtitle">
            Home keeps the daily briefing compact. Open Project Tracking when you need the full shared project board.
          </p>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <label className="filter-field">
            <span>Anchor Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
      </div>

      {loading && !operations ? <div className="empty-state empty-state--panel">Loading assignment workflow visibility...</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {operations ? (
        <>
          <div className="metrics-grid metrics-grid--compact dashboard-workflow-metrics">
            {summaryCards.map((card) => (
              <button
                key={card.label}
                type="button"
                className="metric-card metric-card--button metric-card--compact"
                onClick={() => {
                  window.location.hash = card.actionHash;
                }}
              >
                <div className="metric-card__label">{card.label}</div>
                <strong className="metric-card__value">{card.value}</strong>
                <div className="muted">{card.detail}</div>
              </button>
            ))}
          </div>

          <div className="dashboard-stack">
            <OperationalDetailSection
              title="At Risk Right Now"
              summary="The assignments most likely to create same-day confusion, lateness, or correction work."
              badge={atRiskShifts.length ? `${atRiskShifts.length} open` : "Clear"}
              compact
              defaultOpen={Boolean(atRiskShifts.length)}
            >
              <div className="ops-preview-list">
                {atRiskShifts.map((shift) => (
                  <OperationalPreviewCard
                    key={shift.id}
                    density="compact"
                    eyebrow="Attendance watch"
                    title={shift.shoot_code ?? shift.title}
                    summary={`${shift.assigned_user_name} | ${shift.location_name ?? "Location pending"} | ${formatShortTime(shift.starts_at)} - ${formatShortTime(shift.ends_at)}`}
                    owner={shift.manager_name ?? "Manager pending"}
                    statusLabel={buildShiftRiskLabel(shift)}
                    statusTone={buildShiftRiskTone(shift)}
                    flags={[
                      ...(Number(shift.open_exception_count ?? 0) > 0
                        ? [{ label: `${shift.open_exception_count} open note${Number(shift.open_exception_count) === 1 ? "" : "s"}`, tone: "warning" as const }]
                        : []),
                      ...(String(shift.latest_approval_state ?? "") === "pending"
                        ? [{ label: "Pending punch review", tone: "warning" as const }]
                        : [])
                    ]}
                    nextAction="Open attendance review"
                    onClick={() => {
                      window.location.hash = canManageAttendanceWorkspace(currentUser) ? "#operations/attendance" : "#dashboard/my-day";
                    }}
                  />
                ))}
                {!atRiskShifts.length ? <div className="empty-state empty-state--panel">No assignments are showing same-day attendance or correction pressure.</div> : null}
              </div>
            </OperationalDetailSection>

            <OperationalDetailSection
              title="Follow-Through Queue"
              summary="Closeout, mileage, and end-of-day items that still need operational follow-through."
              badge={followThroughRows.length ? `${followThroughRows.length} open` : "Clear"}
              compact
              defaultOpen={!atRiskShifts.length && Boolean(followThroughRows.length)}
            >
              <div className="ops-preview-list">
                {followThroughRows.map((row) => (
                  <OperationalPreviewCard
                    key={row.id}
                    density="compact"
                    eyebrow="Follow-through"
                    title={row.employee_name ?? row.issue_label}
                    summary={row.message}
                    owner={row.organization_display_name ?? row.location_name ?? "Operations"}
                    statusLabel={row.issue_label}
                    statusTone={row.payroll_blocking || row.urgency === "urgent" ? "critical" : "warning"}
                    meta={row.shoot_code ? [{ label: row.shoot_code, tone: "info" }] : []}
                    flags={[
                      ...(row.payroll_blocking ? [{ label: "Payroll blocking", tone: "critical" as const }] : []),
                      ...(row.mileage_blocking ? [{ label: "Mileage blocking", tone: "warning" as const }] : [])
                    ]}
                    nextAction="Open Project Tracking"
                    onClick={() => {
                      window.location.hash = "#project-tracking";
                    }}
                  />
                ))}
                {!followThroughRows.length ? <div className="empty-state empty-state--panel">No closeout or mileage follow-through items are open for this date.</div> : null}
              </div>
            </OperationalDetailSection>
          </div>
        </>
      ) : null}
    </section>
  );
}

function isAttendanceRisk(value: string | null) {
  return ["late_warning", "late", "missed_clock_in", "missed_clock_out", "no_show_suspected"].includes(String(value ?? ""));
}

function buildShiftRiskLabel(shift: OperationsDashboard["shifts"][number]) {
  if (shift.attendance_state) {
    return shift.attendance_state.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
  }
  if (String(shift.latest_approval_state ?? "") === "pending") {
    return "Pending review";
  }
  if (Number(shift.open_exception_count ?? 0) > 0) {
    return "Exception open";
  }
  return "Needs review";
}

function buildShiftRiskTone(shift: OperationsDashboard["shifts"][number]) {
  if (["no_show_suspected", "missed_clock_in", "missed_clock_out"].includes(String(shift.attendance_state ?? ""))) {
    return "critical" as const;
  }
  if (isAttendanceRisk(shift.attendance_state ?? null) || Number(shift.open_exception_count ?? 0) > 0) {
    return "warning" as const;
  }
  return "info" as const;
}

function formatShortTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
