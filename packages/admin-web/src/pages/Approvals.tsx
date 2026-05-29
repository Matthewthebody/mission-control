import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { OperationalDetailSection } from "../components/OperationalDetailSection";
import { OperationalPreviewCard } from "../components/OperationalPreviewCard";
import {
  applyOperationalApprovalDecision,
  getOperationalApprovalDetail,
  getOperationalApprovalWorkspace
} from "../services/operationalApprovals";
import {
  canManageAttendanceWorkspace,
  canReadAuditLogs,
  canReadNotifications,
  canRequestPto,
  canRequestTrade,
  canReviewPtoRecord,
  canReviewTradeRecord
} from "../permissions";
import type {
  AttendanceExceptionRecord,
  AuditLogEntry,
  AvailabilityRequestRecord,
  IntegrationSyncOperationRecord,
  OperationalApprovalDetail,
  OperationalApprovalRequestSummary,
  OperationalApprovalWorkspace,
  OpsNotificationRecord,
  SessionUser
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

type AlertRecord = {
  id: string;
  shoot_id?: string | null;
  shoot_code?: string | null;
  alert_type: string;
  message: string;
  status: string;
  created_at: string;
};

type ShiftChoice = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  shoot_code?: string | null;
  shoot_title?: string | null;
  location_name?: string | null;
  staffing_role?: string | null;
  satisfies_lead_coverage?: boolean;
};

type TradeCandidate = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  authority_tier?: string | null;
  primary_job_function_profile?: string | null;
  level_rank: number;
  roles: string[];
  has_conflict: boolean;
  conflict_summary?: string | null;
  conflict_code?: string | null;
};

type TradeRequest = {
  id: string;
  shift_id: string;
  requester_user_id: string;
  requester_name: string;
  requested_with_user_id?: string | null;
  requested_with_name?: string | null;
  approver_user_id?: string | null;
  approver_name?: string | null;
  manager_user_id?: string | null;
  shift_title?: string | null;
  shoot_code?: string | null;
  shoot_title?: string | null;
  department?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  staffing_role?: string | null;
  satisfies_lead_coverage?: boolean;
  status: "pending_recipient" | "recipient_declined" | "pending_manager" | "approved" | "denied" | "canceled";
  reason: string;
  same_day_exception_eligible: boolean;
  requested_with_conflict?: boolean;
  conflict_summary?: string | null;
  recipient_notes?: string | null;
  manager_notes?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type PTORequest = AvailabilityRequestRecord;

type PendingAction =
  | {
      kind: "trade-respond";
      tradeId: string;
      status: "accepted" | "declined";
      title: string;
      body: string;
      tone?: "default" | "danger";
    }
  | {
      kind: "trade-review";
      tradeId: string;
      status: "approved" | "denied";
      title: string;
      body: string;
      tone?: "default" | "danger";
    }
  | {
      kind: "trade-cancel";
      tradeId: string;
      title: string;
      body: string;
      tone?: "default" | "danger";
    }
  | {
      kind: "pto-review";
      requestId: string;
      status: "approved" | "rejected";
      title: string;
      body: string;
      tone?: "default" | "danger";
    }
  | {
      kind: "pto-cancel";
      requestId: string;
      title: string;
      body: string;
      tone?: "default" | "danger";
    };

const PTO_EXPORT_FILENAME = "pto-export.csv";

export function Approvals({ token, currentUser, socket }: Props) {
  const [date, setDate] = useState(getLocalDateString());
  const [tradeRequests, setTradeRequests] = useState<TradeRequest[]>([]);
  const [ptoRequests, setPtoRequests] = useState<PTORequest[]>([]);
  const [myShifts, setMyShifts] = useState<ShiftChoice[]>([]);
  const [tradeCandidates, setTradeCandidates] = useState<TradeCandidate[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [exceptions, setExceptions] = useState<AttendanceExceptionRecord[]>([]);
  const [notifications, setNotifications] = useState<OpsNotificationRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [syncOperations, setSyncOperations] = useState<IntegrationSyncOperationRecord[]>([]);
  const [operationalApprovals, setOperationalApprovals] = useState<OperationalApprovalWorkspace | null>(null);
  const [selectedOperationalApprovalId, setSelectedOperationalApprovalId] = useState("");
  const [selectedOperationalApproval, setSelectedOperationalApproval] = useState<OperationalApprovalDetail | null>(null);
  const [operationalApprovalLoading, setOperationalApprovalLoading] = useState(false);
  const [operationalApprovalDecisionBusy, setOperationalApprovalDecisionBusy] = useState(false);
  const [operationalApprovalNote, setOperationalApprovalNote] = useState("");
  const [operationalApprovalDelegateUserId, setOperationalApprovalDelegateUserId] = useState("");
  const [selectedRecipientTradeId, setSelectedRecipientTradeId] = useState("");
  const [selectedManagerTradeId, setSelectedManagerTradeId] = useState("");
  const [selectedMyTradeId, setSelectedMyTradeId] = useState("");
  const [selectedPtoId, setSelectedPtoId] = useState("");
  const [selectedExceptionId, setSelectedExceptionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingPTO, setSubmittingPTO] = useState(false);
  const [submittingTrade, setSubmittingTrade] = useState(false);
  const [downloadingPTOExport, setDownloadingPTOExport] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [ptoForm, setPtoForm] = useState({
    requested_on: getLocalDateString(),
    request_unit: "full_day" as "half_day" | "full_day",
    reason: ""
  });
  const [tradeForm, setTradeForm] = useState({
    shift_id: "",
    requested_with_user_id: "",
    reason: ""
  });

  const canReviewAttendance = canManageAttendanceWorkspace(currentUser);
  const canRequestTradeRecords = canRequestTrade(currentUser);
  const canRequestPTO = canRequestPto(currentUser);
  const canReadNotificationsForUser = canReadNotifications(currentUser);
  const canReadAudit = canReadAuditLogs(currentUser);
  const isLeadershipControl = ["super_admin", "leadership", "director_admin"].includes(currentUser.authorityTier);
  const canActOnTrade = (trade: TradeRequest) =>
    canReviewTradeRecord(currentUser, trade.approver_user_id, trade.requester_user_id, trade.requested_with_user_id);
  const canActOnPto = (request: PTORequest) => canReviewPtoRecord(currentUser, request.approver_user_id, request.user_id);

  async function load() {
    setLoading(true);
    try {
      const rangeEnd = addDays(date, 30);
      const [tradeRows, ptoRows, shiftRows, alertRows, exceptionRows, notificationRows, auditRows, syncRows, operationalApprovalRows] = await Promise.all([
        apiFetch<TradeRequest[]>("/api/shifts/trade-requests/list", token).catch(() => []),
        apiFetch<PTORequest[]>("/api/shifts/pto-requests/list", token).catch(() => []),
        canRequestTradeRecords
          ? apiFetch<ShiftChoice[]>(`/api/shifts?assigned_user_id=${encodeURIComponent(currentUser.id)}&date_from=${date}&date_to=${rangeEnd}`, token).catch(() => [])
          : Promise.resolve([]),
        apiFetch<AlertRecord[]>("/api/alerts?status=open", token).catch(() => []),
        apiFetch<AttendanceExceptionRecord[]>(`/api/attendance/exceptions?date=${date}&status=open`, token).catch(() => []),
        canReadNotificationsForUser ? apiFetch<OpsNotificationRecord[]>("/api/notifications", token).catch(() => []) : Promise.resolve([]),
        canReadAudit ? apiFetch<AuditLogEntry[]>("/api/access/audit-logs", token).catch(() => []) : Promise.resolve([]),
        isLeadershipControl ? apiFetch<IntegrationSyncOperationRecord[]>("/api/integrations/sync-operations", token).catch(() => []) : Promise.resolve([]),
        getOperationalApprovalWorkspace(token).catch(() => null)
      ]);

      setTradeRequests(tradeRows);
      setPtoRequests(ptoRows);
      setMyShifts(shiftRows.filter((shift) => shift.status !== "cancelled"));
      setAlerts(alertRows);
      setExceptions(exceptionRows);
      setNotifications(notificationRows);
      setAuditLogs(auditRows);
      setSyncOperations(syncRows);
      setOperationalApprovals(operationalApprovalRows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load the approval center.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [date, token]);

  useEffect(() => {
    if (!tradeForm.shift_id) {
      setTradeForm((current) => ({ ...current, shift_id: myShifts[0]?.id ?? "" }));
      return;
    }
    if (!myShifts.some((shift) => shift.id === tradeForm.shift_id)) {
      setTradeForm((current) => ({
        ...current,
        shift_id: myShifts[0]?.id ?? "",
        requested_with_user_id: ""
      }));
    }
  }, [myShifts, tradeForm.shift_id]);

  useEffect(() => {
    if (!tradeForm.shift_id || !canRequestTradeRecords) {
      setTradeCandidates([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const candidates = await apiFetch<TradeCandidate[]>(`/api/shifts/${tradeForm.shift_id}/trade-candidates`, token);
        if (!cancelled) {
          setTradeCandidates(candidates);
          setTradeForm((current) => ({
            ...current,
            requested_with_user_id:
              current.requested_with_user_id && candidates.some((candidate) => candidate.id === current.requested_with_user_id)
                ? current.requested_with_user_id
                : candidates.find((candidate) => !candidate.has_conflict)?.id ?? ""
          }));
        }
      } catch {
        if (!cancelled) {
          setTradeCandidates([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tradeForm.shift_id, canRequestTradeRecords, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2500);
    const onRefresh = () => {
      setLiveMessage("Live update: approval queues refreshed.");
      void load();
      clearLiveMessage();
    };

    socket.on("alert_created", onRefresh);
    socket.on("attendance_changed", onRefresh);
    socket.on("notification_created", onRefresh);
    socket.on("schedule_changed", onRefresh);
    socket.on("integration_event", onRefresh);
    return () => {
      socket.off("alert_created", onRefresh);
      socket.off("attendance_changed", onRefresh);
      socket.off("notification_created", onRefresh);
      socket.off("schedule_changed", onRefresh);
      socket.off("integration_event", onRefresh);
    };
  }, [socket, token, date]);

  const recipientQueue = useMemo(
    () => tradeRequests.filter((trade) => trade.status === "pending_recipient" && trade.requested_with_user_id === currentUser.id),
    [tradeRequests, currentUser.id]
  );
  const managerTradeQueue = useMemo(
    () =>
      tradeRequests.filter(
        (trade) =>
          trade.status === "pending_manager" &&
          canActOnTrade(trade)
      ),
    [tradeRequests, currentUser.id, currentUser.permissions, currentUser.authorityTier]
  );
  const myTradeRequests = useMemo(
    () => tradeRequests.filter((trade) => trade.requester_user_id === currentUser.id),
    [tradeRequests, currentUser.id]
  );
  const ptoReviewQueue = useMemo(
    () =>
      ptoRequests.filter(
        (request) =>
          (request.status === "submitted" || request.status === "needs_review") &&
          canActOnPto(request)
      ),
    [ptoRequests, currentUser.id, currentUser.permissions, currentUser.authorityTier]
  );
  const myPtoRequests = useMemo(() => ptoRequests.filter((request) => request.user_id === currentUser.id), [ptoRequests, currentUser.id]);
  const syncRiskRows = useMemo(
    () => syncOperations.filter((operation) => operation.status === "failed" || operation.status === "conflict").slice(0, 8),
    [syncOperations]
  );
  const dangerousAuditRows = useMemo(
    () =>
      auditLogs
        .filter((row) => row.action.startsWith("dangerous_action.") || row.action === "schedule.shift.deleted" || row.action === "shoot.delete")
        .slice(0, 8),
    [auditLogs]
  );
  const controlSummary = {
    recipient: recipientQueue.length,
    review: managerTradeQueue.length + ptoReviewQueue.length,
    mine:
      myTradeRequests.filter((trade) => ["pending_recipient", "pending_manager"].includes(trade.status)).length +
      myPtoRequests.filter((request) => ["submitted", "needs_review"].includes(request.status)).length,
    controls: syncRiskRows.length + dangerousAuditRows.length
  };
  const operationalAwaitingDecision = operationalApprovals?.awaiting_my_decision ?? [];
  const operationalSubmittedByMe = operationalApprovals?.submitted_by_me ?? [];
  const operationalOverdue = operationalApprovals?.overdue ?? [];
  const operationalEscalated = operationalApprovals?.escalated ?? [];
  const operationalApprovalList = useMemo(
    () => [
      ...operationalAwaitingDecision,
      ...operationalOverdue,
      ...operationalEscalated,
      ...operationalSubmittedByMe
    ].filter((value, index, array) => array.findIndex((candidate) => candidate.id === value.id) === index),
    [operationalAwaitingDecision, operationalEscalated, operationalOverdue, operationalSubmittedByMe]
  );

  useEffect(() => {
    setSelectedRecipientTradeId((current) => selectExistingOrFirst(current, recipientQueue));
  }, [recipientQueue]);
  useEffect(() => {
    setSelectedManagerTradeId((current) => selectExistingOrFirst(current, managerTradeQueue));
  }, [managerTradeQueue]);
  useEffect(() => {
    setSelectedMyTradeId((current) => selectExistingOrFirst(current, myTradeRequests));
  }, [myTradeRequests]);
  useEffect(() => {
    setSelectedPtoId((current) => selectExistingOrFirst(current, myPtoRequests.length ? myPtoRequests : ptoReviewQueue));
  }, [myPtoRequests, ptoReviewQueue]);
  useEffect(() => {
    setSelectedExceptionId((current) => selectExistingOrFirst(current, exceptions));
  }, [exceptions]);
  useEffect(() => {
    setSelectedOperationalApprovalId((current) => selectExistingOrFirst(current, operationalApprovalList));
  }, [operationalApprovalList]);
  useEffect(() => {
    if (!selectedOperationalApprovalId) {
      setSelectedOperationalApproval(null);
      setOperationalApprovalNote("");
      setOperationalApprovalDelegateUserId("");
      return;
    }
    let cancelled = false;
    setOperationalApprovalLoading(true);
    void getOperationalApprovalDetail(token, selectedOperationalApprovalId)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setSelectedOperationalApproval(payload);
        setOperationalApprovalNote("");
        setOperationalApprovalDelegateUserId(payload.candidate_approvers[0]?.id ?? "");
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "We couldn't load that approval request.");
      })
      .finally(() => {
        if (!cancelled) {
          setOperationalApprovalLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOperationalApprovalId, token]);

  const selectedShift = myShifts.find((shift) => shift.id === tradeForm.shift_id) ?? null;
  const selectedTradeCandidate = tradeCandidates.find((candidate) => candidate.id === tradeForm.requested_with_user_id) ?? null;
  const selectedRecipientTrade = recipientQueue.find((trade) => trade.id === selectedRecipientTradeId) ?? recipientQueue[0] ?? null;
  const selectedManagerTrade = managerTradeQueue.find((trade) => trade.id === selectedManagerTradeId) ?? managerTradeQueue[0] ?? null;
  const selectedMyTrade = myTradeRequests.find((trade) => trade.id === selectedMyTradeId) ?? myTradeRequests[0] ?? null;
  const selectedPto = [...myPtoRequests, ...ptoReviewQueue].find((request) => request.id === selectedPtoId) ?? myPtoRequests[0] ?? ptoReviewQueue[0] ?? null;
  const selectedException = exceptions.find((item) => item.id === selectedExceptionId) ?? exceptions[0] ?? null;

  async function submitPTORequest() {
    setSubmittingPTO(true);
    setError("");
    setNotice("");
    try {
      await apiFetch("/api/shifts/pto-requests", token, {
        method: "POST",
        body: JSON.stringify({
          requested_on: ptoForm.requested_on,
          request_unit: ptoForm.request_unit,
          reason: ptoForm.reason || null
        })
      });
      setNotice("Availability request submitted.");
      setPtoForm({ requested_on: getLocalDateString(), request_unit: "full_day", reason: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't submit that availability request.");
    } finally {
      setSubmittingPTO(false);
    }
  }

  async function submitTradeRequest() {
    if (!tradeForm.shift_id || !tradeForm.requested_with_user_id) {
      setError("Choose a shift and a replacement teammate before sending a trade request.");
      return;
    }
    setSubmittingTrade(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/shifts/${tradeForm.shift_id}/trade-requests`, token, {
        method: "POST",
        body: JSON.stringify({
          requested_with_user_id: tradeForm.requested_with_user_id,
          reason: tradeForm.reason
        })
      });
      setNotice("Trade request sent to the recipient.");
      setTradeForm((current) => ({
        ...current,
        requested_with_user_id: tradeCandidates.find((candidate) => !candidate.has_conflict)?.id ?? "",
        reason: ""
      }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send that trade request.");
    } finally {
      setSubmittingTrade(false);
    }
  }

  async function downloadPtoExport() {
    setDownloadingPTOExport(true);
    setError("");
    try {
      const response = await fetch("/api/shifts/pto-requests/export", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "PTO export failed");
      }
      const csv = await response.text();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = PTO_EXPORT_FILENAME;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("PTO export downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't download the PTO export.");
    } finally {
      setDownloadingPTOExport(false);
    }
  }

  async function runOperationalApprovalAction(action: "approve" | "reject" | "send_back" | "cancel" | "resubmit" | "delegate") {
    if (!selectedOperationalApproval) {
      return;
    }
    setOperationalApprovalDecisionBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await applyOperationalApprovalDecision(token, selectedOperationalApproval.request.id, {
        action,
        note: operationalApprovalNote.trim() || null,
        delegate_to_user_id: action === "delegate" ? operationalApprovalDelegateUserId || null : null
      });
      setSelectedOperationalApproval(payload);
      setNotice(`Operational approval updated: ${payload.request.status_label}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update that approval request.");
    } finally {
      setOperationalApprovalDecisionBusy(false);
    }
  }

  async function executePendingAction() {
    if (!pendingAction) {
      return;
    }
    try {
      if (pendingAction.kind === "trade-respond") {
        await apiFetch(`/api/shifts/trade-requests/${pendingAction.tradeId}/respond`, token, {
          method: "POST",
          body: JSON.stringify({ status: pendingAction.status })
        });
        setNotice(pendingAction.status === "accepted" ? "Trade accepted and routed to manager review." : "Trade declined.");
      } else if (pendingAction.kind === "trade-review") {
        await apiFetch(`/api/shifts/trade-requests/${pendingAction.tradeId}/review`, token, {
          method: "POST",
          body: JSON.stringify({ status: pendingAction.status })
        });
        setNotice(pendingAction.status === "approved" ? "Trade approved." : "Trade denied.");
      } else if (pendingAction.kind === "trade-cancel") {
        await apiFetch(`/api/shifts/trade-requests/${pendingAction.tradeId}/cancel`, token, { method: "POST" });
        setNotice("Trade request canceled.");
      } else if (pendingAction.kind === "pto-review") {
        await apiFetch(`/api/shifts/pto-requests/${pendingAction.requestId}/review`, token, {
          method: "POST",
          body: JSON.stringify({ status: pendingAction.status })
        });
        setNotice(pendingAction.status === "approved" ? "PTO request approved." : "PTO request denied.");
      } else if (pendingAction.kind === "pto-cancel") {
        await apiFetch(`/api/shifts/pto-requests/${pendingAction.requestId}/cancel`, token, { method: "POST" });
        setNotice("Availability request cancelled.");
      }
      setPendingAction(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't complete that action.");
      setPendingAction(null);
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Approvals & Controls</div>
          <h2>Approval Command Center</h2>
          <p>Preview the queue first, open the detail only when needed, and keep PTO, shift trades, attendance risk, and sync-control signals in one place.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Operator: {currentUser.fullName}</div>
          <label className="filter-field">
            <span>Reference Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button className="secondary-button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {isLeadershipControl ? (
            <button className="secondary-button" onClick={() => void downloadPtoExport()} disabled={downloadingPTOExport}>
              {downloadingPTOExport ? "Exporting..." : "Export PTO CSV"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Recipient Queue</div>
          <strong>{controlSummary.recipient}</strong>
          <span className="muted">Trades waiting on a recipient answer.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Manager Review</div>
          <strong>{controlSummary.review}</strong>
          <span className="muted">PTO and accepted trades waiting on final approval.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">My Open Requests</div>
          <strong>{controlSummary.mine}</strong>
          <span className="muted">Submitted PTO or active trade requests you can still track or cancel.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Control Watch</div>
          <strong>{controlSummary.controls}</strong>
          <span className="muted">Failed syncs and dangerous-action activity that need leadership eyes.</span>
        </article>
      </section>

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Awaiting My Decision</div>
          <strong>{operationalApprovals?.summary.awaiting_my_decision ?? 0}</strong>
          <span className="muted">Operational approvals routed to you right now.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Blocking Requests</div>
          <strong>{operationalApprovals?.summary.pending_blocking ?? 0}</strong>
          <span className="muted">Protected Scheduling and Production actions waiting on approval.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Overdue</div>
          <strong>{operationalApprovals?.summary.overdue ?? 0}</strong>
          <span className="muted">Approval requests that are past SLA.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Escalated</div>
          <strong>{operationalApprovals?.summary.escalated ?? 0}</strong>
          <span className="muted">Requests that need leadership or follow-up attention.</span>
        </article>
      </section>

      {notice ? <section className="panel feedback-strip feedback-strip--success">{notice}</section> : null}
      {liveMessage ? <section className="panel feedback-strip feedback-strip--info">{liveMessage}</section> : null}
      {error ? <section className="panel feedback-strip feedback-strip--danger">{error}</section> : null}
      {loading ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading approval center</div>
          <p className="section-subtitle">Pulling PTO, trade routing, attendance exceptions, notifications, and sync control signals.</p>
        </section>
      ) : null}

      <section className="panel dashboard-panel">
        <div className="section-title">Operational Approval Inbox</div>
        <p className="section-subtitle">Scheduling and Production exceptions stay here as blocking operational decisions with SLA timing, escalation, and audit history.</p>

        {operationalApprovalList.length ? (
          <div className="preview-detail-layout">
            <div className="ops-preview-list">
              {operationalApprovalList.map((approval) => (
                <OperationalPreviewCard
                  key={approval.id}
                  eyebrow={approval.source_module}
                  title={approval.request_title}
                  summary={approval.request_summary ?? approval.reason}
                  owner={approval.current_approver_name ?? approval.current_approver_role_group_label ?? "Routing pending"}
                  statusLabel={approval.status_label}
                  statusTone={
                    approval.status === "approved"
                      ? "success"
                      : approval.status === "rejected" || approval.escalated
                        ? "critical"
                        : approval.overdue
                          ? "warning"
                          : "neutral"
                  }
                  flags={[
                    ...(approval.blocking ? [{ label: "Blocking", tone: "critical" as const }] : []),
                    ...(approval.overdue ? [{ label: "Overdue", tone: "warning" as const }] : []),
                    ...(approval.escalated ? [{ label: "Escalated", tone: "critical" as const }] : []),
                    ...(approval.source_entity_label ? [{ label: approval.source_entity_label, tone: "neutral" as const }] : [])
                  ]}
                  nextAction={approval.can_decide ? "Review decision" : approval.can_resubmit ? "Respond with clarification" : "View history"}
                  selected={selectedOperationalApprovalId === approval.id}
                  onClick={() => setSelectedOperationalApprovalId((current) => (current === approval.id ? "" : approval.id))}
                />
              ))}
            </div>
            <aside className="preview-detail-panel">
              {operationalApprovalLoading ? (
                <div className="empty-state">Loading approval detail.</div>
              ) : selectedOperationalApproval ? (
                <>
                  <div className="preview-detail-panel__header">
                    <div>
                      <div className="eyebrow">Operational Approval</div>
                      <strong>{selectedOperationalApproval.request.request_title}</strong>
                    </div>
                    <span className="meta-pill">{selectedOperationalApproval.request.status_label}</span>
                  </div>

                  <div className="dashboard-summary-list">
                    <div className="dashboard-summary-row">
                      <span className="muted">Submitted by</span>
                      <strong>{selectedOperationalApproval.request.requested_by_name ?? "Unknown requester"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Current approver</span>
                      <strong>{selectedOperationalApproval.request.current_approver_name ?? selectedOperationalApproval.request.current_approver_role_group_label ?? "Routing pending"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">SLA</span>
                      <strong>{selectedOperationalApproval.request.sla_due_at ? new Date(selectedOperationalApproval.request.sla_due_at).toLocaleString() : "No SLA"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Source</span>
                      <strong>{selectedOperationalApproval.request.source_entity_label ?? selectedOperationalApproval.request.source_entity_id}</strong>
                    </div>
                  </div>

                  <OperationalDetailSection title="Request" summary="Current state, requested state, and the reason captured when the protected action was blocked." defaultOpen>
                    <div className="dashboard-summary-list">
                      <div className="dashboard-summary-row">
                        <span className="muted">Summary</span>
                        <strong>{selectedOperationalApproval.request.request_summary ?? "No summary provided"}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Reason</span>
                        <strong>{selectedOperationalApproval.request.reason}</strong>
                      </div>
                    </div>
                    <label className="filter-field filter-field--wide">
                      <span>Decision / Clarification Note</span>
                      <textarea
                        rows={3}
                        value={operationalApprovalNote}
                        onChange={(event) => setOperationalApprovalNote(event.target.value)}
                        placeholder="Capture approval notes, rationale, or clarification."
                      />
                    </label>
                    {selectedOperationalApproval.candidate_approvers.length ? (
                      <label className="filter-field">
                        <span>Delegate To</span>
                        <select
                          value={operationalApprovalDelegateUserId}
                          onChange={(event) => setOperationalApprovalDelegateUserId(event.target.value)}
                        >
                          {selectedOperationalApproval.candidate_approvers.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.label}
                              {candidate.detail ? ` • ${candidate.detail}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <div className="preview-detail-panel__actions">
                      {selectedOperationalApproval.request.can_decide ? (
                        <>
                          <button
                            className="primary-button"
                            disabled={operationalApprovalDecisionBusy}
                            onClick={() => void runOperationalApprovalAction("approve")}
                          >
                            {operationalApprovalDecisionBusy ? "Saving..." : "Approve"}
                          </button>
                          <button
                            className="secondary-button"
                            disabled={operationalApprovalDecisionBusy}
                            onClick={() => void runOperationalApprovalAction("reject")}
                          >
                            Reject
                          </button>
                          <button
                            className="secondary-button"
                            disabled={operationalApprovalDecisionBusy || !operationalApprovalNote.trim()}
                            onClick={() => void runOperationalApprovalAction("send_back")}
                          >
                            Send Back
                          </button>
                        </>
                      ) : null}
                      {selectedOperationalApproval.request.can_delegate && selectedOperationalApproval.candidate_approvers.length ? (
                        <button
                          className="secondary-button"
                          disabled={operationalApprovalDecisionBusy || !operationalApprovalDelegateUserId}
                          onClick={() => void runOperationalApprovalAction("delegate")}
                        >
                          Delegate
                        </button>
                      ) : null}
                      {selectedOperationalApproval.request.can_resubmit ? (
                        <button
                          className="secondary-button"
                          disabled={operationalApprovalDecisionBusy || !operationalApprovalNote.trim()}
                          onClick={() => void runOperationalApprovalAction("resubmit")}
                        >
                          Resubmit
                        </button>
                      ) : null}
                      {selectedOperationalApproval.request.can_cancel ? (
                        <button
                          className="secondary-button"
                          disabled={operationalApprovalDecisionBusy}
                          onClick={() => void runOperationalApprovalAction("cancel")}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </OperationalDetailSection>

                  <OperationalDetailSection
                    title={`Approval Steps (${selectedOperationalApproval.steps.length})`}
                    summary="Sequential routing stays visible so operators know exactly where a decision is waiting."
                  >
                    <div className="dashboard-summary-list">
                      {selectedOperationalApproval.steps.map((step) => (
                        <div key={step.id} className="dashboard-summary-row">
                          <span className="muted">
                            Step {step.step_order}: {step.approver_role_group_label}
                          </span>
                          <strong>{step.approver_name ?? step.status_label}</strong>
                        </div>
                      ))}
                    </div>
                  </OperationalDetailSection>

                  <OperationalDetailSection
                    title={`Activity History (${selectedOperationalApproval.events.length})`}
                    summary="Every routing, decision, escalation, and clarification event is persisted for audit and reporting."
                  >
                    <div className="dashboard-summary-list">
                      {selectedOperationalApproval.events.map((event) => (
                        <div key={event.id} className="dashboard-summary-row">
                          <span className="muted">{event.actor_name ?? "System"} • {new Date(event.created_at).toLocaleString()}</span>
                          <strong>{event.summary}</strong>
                        </div>
                      ))}
                    </div>
                  </OperationalDetailSection>
                </>
              ) : (
                <div className="empty-state">Select an operational approval to review routing, decisions, and audit history.</div>
              )}
            </aside>
          </div>
        ) : (
          <div className="empty-state">No operational approvals are open right now.</div>
        )}
      </section>

      <section className="dashboard-layout">
        <div className="dashboard-stack">
          {(canRequestPTO || canRequestTradeRecords) ? (
            <section className="panel dashboard-panel">
              <div className="section-title">Request Center</div>
              <p className="section-subtitle">Employees can file PTO or request a shift trade here without opening deeper admin screens.</p>

              {canRequestPTO ? (
                <OperationalDetailSection title="Request PTO" summary="Half day is fixed at 4.0 hours. Full day is fixed at 7.5 hours." defaultOpen>
                  <div className="field-grid">
                    <label className="filter-field">
                      <span>Date</span>
                      <input
                        type="date"
                        value={ptoForm.requested_on}
                        onChange={(event) => setPtoForm((current) => ({ ...current, requested_on: event.target.value }))}
                      />
                    </label>
                    <label className="filter-field">
                      <span>Unit</span>
                      <select
                        value={ptoForm.request_unit}
                        onChange={(event) =>
                          setPtoForm((current) => ({
                            ...current,
                            request_unit: event.target.value as "half_day" | "full_day"
                          }))
                        }
                      >
                        <option value="full_day">Full day • 7.5 hours</option>
                        <option value="half_day">Half day • 4.0 hours</option>
                      </select>
                    </label>
                    <label className="filter-field filter-field--wide">
                      <span>Reason</span>
                      <textarea
                        rows={3}
                        value={ptoForm.reason}
                        onChange={(event) => setPtoForm((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Optional note for the approver"
                      />
                    </label>
                  </div>
                  <div className="feedback-strip feedback-strip--warning">
                    Mission Control tracks PTO requests and exports them separately, but your pay stub remains the source of truth for paid PTO availability.
                  </div>
                  <div className="preview-detail-panel__actions">
                    <button className="primary-button" type="button" disabled={submittingPTO} onClick={() => void submitPTORequest()}>
                      {submittingPTO ? "Submitting..." : "Submit PTO Request"}
                    </button>
                  </div>
                </OperationalDetailSection>
              ) : null}

              {canRequestTradeRecords ? (
                <OperationalDetailSection title="Request Shift Trade" summary="Choose one of your shifts and send it to an eligible replacement.">
                  <div className="field-grid">
                    <label className="filter-field">
                      <span>Shift</span>
                      <select
                        value={tradeForm.shift_id}
                        onChange={(event) =>
                          setTradeForm((current) => ({
                            ...current,
                            shift_id: event.target.value,
                            requested_with_user_id: ""
                          }))
                        }
                      >
                        {myShifts.length ? null : <option value="">No eligible shifts found</option>}
                        {myShifts.map((shift) => (
                          <option key={shift.id} value={shift.id}>
                            {shift.title} • {formatShiftWindow(shift.starts_at, shift.ends_at)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="filter-field">
                      <span>Replacement</span>
                      <select
                        value={tradeForm.requested_with_user_id}
                        onChange={(event) => setTradeForm((current) => ({ ...current, requested_with_user_id: event.target.value }))}
                        disabled={!tradeForm.shift_id}
                      >
                        {tradeCandidates.length ? null : <option value="">No eligible replacements available</option>}
                        {tradeCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id} disabled={candidate.has_conflict}>
                            {candidate.full_name}
                            {candidate.has_conflict ? " • conflict" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="filter-field filter-field--wide">
                      <span>Reason</span>
                      <textarea
                        rows={3}
                        value={tradeForm.reason}
                        onChange={(event) => setTradeForm((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Explain why the swap is needed"
                      />
                    </label>
                  </div>
                  {selectedShift ? (
                    <div className="dashboard-summary-list">
                      <div className="dashboard-summary-row">
                        <span className="muted">Shift</span>
                        <strong>{selectedShift.title}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Window</span>
                        <strong>{formatShiftWindow(selectedShift.starts_at, selectedShift.ends_at)}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Coverage risk</span>
                        <strong>{selectedShift.satisfies_lead_coverage ? "Touches lead coverage" : "Standard staffing coverage"}</strong>
                      </div>
                    </div>
                  ) : null}
                  {selectedTradeCandidate?.conflict_summary ? <div className="feedback-strip feedback-strip--warning">{selectedTradeCandidate.conflict_summary}</div> : null}
                  <div className="preview-detail-panel__actions">
                    <button className="primary-button" type="button" disabled={submittingTrade} onClick={() => void submitTradeRequest()}>
                      {submittingTrade ? "Sending..." : "Send Trade Request"}
                    </button>
                  </div>
                </OperationalDetailSection>
              ) : null}
            </section>
          ) : null}

          <section className="panel dashboard-panel">
            <div className="section-title">My Requests</div>
            <p className="section-subtitle">Open items stay condensed by default. Expand only when you need the full context or a cancellation action.</p>

            <OperationalDetailSection title="My Trade Requests" summary="Track recipient and manager routing without opening the schedule view.">
              {myTradeRequests.length ? (
                <div className="preview-detail-layout">
                  <div className="ops-preview-list">
                    {myTradeRequests.map((trade) => (
                      <OperationalPreviewCard
                        key={trade.id}
                        eyebrow={trade.shoot_code ?? "Trade"}
                        title={trade.shift_title ?? trade.shoot_title ?? "Shift trade"}
                        summary={formatTradeSummary(trade)}
                        owner={trade.requested_with_name ?? "Replacement pending"}
                        statusLabel={humanizeLabel(trade.status)}
                        statusTone={tradeStatusTone(trade.status)}
                        flags={buildTradeFlags(trade)}
                        nextAction={trade.status === "pending_recipient" ? "Await recipient" : trade.status === "pending_manager" ? "Await manager" : "View outcome"}
                        selected={selectedMyTradeId === trade.id}
                        onClick={() => setSelectedMyTradeId((current) => (current === trade.id ? "" : trade.id))}
                      />
                    ))}
                  </div>
                  <aside className="preview-detail-panel">
                    {selectedMyTrade ? (
                      <>
                        <div className="preview-detail-panel__header">
                          <div>
                            <div className="eyebrow">My Trade Request</div>
                            <strong>{selectedMyTrade.shift_title ?? selectedMyTrade.shoot_title ?? "Shift trade"}</strong>
                          </div>
                          <span className="meta-pill">{humanizeLabel(selectedMyTrade.status)}</span>
                        </div>
                        <div className="dashboard-summary-list">
                          <div className="dashboard-summary-row">
                            <span className="muted">Replacement</span>
                            <strong>{selectedMyTrade.requested_with_name ?? "Pending selection"}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Approver</span>
                            <strong>{selectedMyTrade.approver_name ?? "Not routed yet"}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Requested</span>
                            <strong>{new Date(selectedMyTrade.created_at).toLocaleString()}</strong>
                          </div>
                        </div>
                        <OperationalDetailSection title="Trade Context" summary="Request, recipient, and manager notes">
                          <div className="dashboard-summary-list">
                            <div className="dashboard-summary-row">
                              <span className="muted">Reason</span>
                              <strong>{selectedMyTrade.reason || "No reason provided"}</strong>
                            </div>
                            {selectedMyTrade.recipient_notes ? (
                              <div className="dashboard-summary-row">
                                <span className="muted">Recipient notes</span>
                                <strong>{selectedMyTrade.recipient_notes}</strong>
                              </div>
                            ) : null}
                            {selectedMyTrade.manager_notes ? (
                              <div className="dashboard-summary-row">
                                <span className="muted">Manager notes</span>
                                <strong>{selectedMyTrade.manager_notes}</strong>
                              </div>
                            ) : null}
                            {selectedMyTrade.conflict_summary ? (
                              <div className="dashboard-summary-row">
                                <span className="muted">Conflict</span>
                                <strong>{selectedMyTrade.conflict_summary}</strong>
                              </div>
                            ) : null}
                          </div>
                        </OperationalDetailSection>
                        {canCancelTrade(selectedMyTrade, currentUser.id) ? (
                          <div className="preview-detail-panel__actions">
                            <button
                              className="secondary-button"
                              onClick={() =>
                                setPendingAction({
                                  kind: "trade-cancel",
                                  tradeId: selectedMyTrade.id,
                                  title: "Cancel this trade request?",
                                  body: "This will keep the record for audit purposes but stop the trade from moving forward.",
                                  tone: "danger"
                                })
                              }
                            >
                              Cancel Request
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="empty-state">You have no trade requests in the system yet.</div>
                    )}
                  </aside>
                </div>
              ) : (
                <div className="empty-state">You have no trade requests yet.</div>
              )}
            </OperationalDetailSection>

            <OperationalDetailSection title="My PTO Requests" summary="Submitted, approved, denied, and canceled PTO stays visible for audit and payroll export context.">
              {myPtoRequests.length ? (
                <div className="preview-detail-layout">
                  <div className="ops-preview-list">
                    {myPtoRequests.map((request) => (
                      <OperationalPreviewCard
                        key={request.id}
                        eyebrow="PTO"
                        title={`${request.request_unit === "half_day" ? "Half day" : "Full day"} • ${request.requested_on}`}
                        summary={request.reason || "No reason provided"}
                        owner={request.approver_name ?? "Pending routing"}
                        statusLabel={humanizeLabel(request.status)}
                        statusTone={ptoStatusTone(request.status)}
                        meta={[{ label: `${request.requested_hours} hours` }]}
                        nextAction={request.status === "submitted" ? "Await decision" : "View outcome"}
                        selected={selectedPtoId === request.id}
                        onClick={() => setSelectedPtoId((current) => (current === request.id ? "" : request.id))}
                      />
                    ))}
                  </div>
                  <aside className="preview-detail-panel">
                    {selectedPto ? (
                      <>
                        <div className="preview-detail-panel__header">
                          <div>
                            <div className="eyebrow">My PTO Request</div>
                            <strong>{selectedPto.requested_on}</strong>
                          </div>
                          <span className="meta-pill">{humanizeLabel(selectedPto.status)}</span>
                        </div>
                        <div className="dashboard-summary-list">
                          <div className="dashboard-summary-row">
                            <span className="muted">Unit</span>
                            <strong>{selectedPto.request_unit === "half_day" ? "Half day" : "Full day"}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Hours</span>
                            <strong>{selectedPto.requested_hours}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Approver</span>
                            <strong>{selectedPto.approver_name ?? "Pending routing"}</strong>
                          </div>
                        </div>
                        <OperationalDetailSection title="Request Note" summary="Employee context and approver note">
                          <div className="dashboard-summary-list">
                            <div className="dashboard-summary-row">
                              <span className="muted">Reason</span>
                              <strong>{selectedPto.reason || "No reason provided"}</strong>
                            </div>
                            {selectedPto.notes ? (
                              <div className="dashboard-summary-row">
                                <span className="muted">Decision note</span>
                                <strong>{selectedPto.notes}</strong>
                              </div>
                            ) : null}
                          </div>
                        </OperationalDetailSection>
                        {canCancelPTO(selectedPto, currentUser.id) ? (
                          <div className="preview-detail-panel__actions">
                            <button
                              className="secondary-button"
                              onClick={() =>
                                setPendingAction({
                                  kind: "pto-cancel",
                                  requestId: selectedPto.id,
                                  title: "Cancel this PTO request?",
                                  body: "The request will be marked as canceled and preserved for audit history.",
                                  tone: "danger"
                                })
                              }
                            >
                              Cancel PTO Request
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="empty-state">You have no PTO requests yet.</div>
                    )}
                  </aside>
                </div>
              ) : (
                <div className="empty-state">You have no PTO requests yet.</div>
              )}
            </OperationalDetailSection>
          </section>

          <section className="panel dashboard-panel">
            <div className="section-title">Needs Your Action</div>
            <p className="section-subtitle">Recipient decisions and manager reviews stay in separate queues so the next owner is always obvious.</p>

            <OperationalDetailSection title="Recipient Queue" summary="These trades are waiting on a recipient answer." defaultOpen>
              {recipientQueue.length ? (
                <div className="preview-detail-layout">
                  <div className="ops-preview-list">
                    {recipientQueue.map((trade) => (
                      <OperationalPreviewCard
                        key={trade.id}
                        eyebrow={trade.shoot_code ?? "Trade"}
                        title={trade.requester_name}
                        summary={trade.shift_title ?? trade.shoot_title ?? "Shift trade"}
                        owner={formatTradeWindow(trade)}
                        statusLabel="Pending Recipient"
                        statusTone="warning"
                        flags={buildTradeFlags(trade)}
                        nextAction="Accept or decline"
                        selected={selectedRecipientTradeId === trade.id}
                        onClick={() => setSelectedRecipientTradeId((current) => (current === trade.id ? "" : trade.id))}
                      />
                    ))}
                  </div>
                  <aside className="preview-detail-panel">
                    {selectedRecipientTrade ? (
                      <>
                        <div className="preview-detail-panel__header">
                          <div>
                            <div className="eyebrow">Recipient Decision</div>
                            <strong>{selectedRecipientTrade.shift_title ?? selectedRecipientTrade.shoot_title ?? "Trade request"}</strong>
                          </div>
                          <span className="meta-pill">Pending Recipient</span>
                        </div>
                        <div className="dashboard-summary-list">
                          <div className="dashboard-summary-row">
                            <span className="muted">Requested by</span>
                            <strong>{selectedRecipientTrade.requester_name}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Window</span>
                            <strong>{formatTradeWindow(selectedRecipientTrade)}</strong>
                          </div>
                          <div className="dashboard-summary-row">
                            <span className="muted">Coverage</span>
                            <strong>{selectedRecipientTrade.satisfies_lead_coverage ? "Touches lead coverage" : "Standard staffing swap"}</strong>
                          </div>
                        </div>
                        <OperationalDetailSection title="Trade Reason" summary="What the requester submitted" defaultOpen>
                          <p>{selectedRecipientTrade.reason || "No reason provided."}</p>
                          {selectedRecipientTrade.conflict_summary ? <div className="feedback-strip feedback-strip--warning">{selectedRecipientTrade.conflict_summary}</div> : null}
                        </OperationalDetailSection>
                        <div className="preview-detail-panel__actions">
                          <button
                            className="secondary-button"
                            onClick={() =>
                              setPendingAction({
                                kind: "trade-respond",
                                tradeId: selectedRecipientTrade.id,
                                status: "declined",
                                title: "Decline this trade?",
                                body: "This ends the workflow immediately. No manager review will happen after a recipient decline.",
                                tone: "danger"
                              })
                            }
                          >
                            Decline
                          </button>
                          <button
                            className="primary-button"
                            onClick={() =>
                              setPendingAction({
                                kind: "trade-respond",
                                tradeId: selectedRecipientTrade.id,
                                status: "accepted",
                                title: "Accept this trade?",
                                body: "Accepting sends the trade to manager approval. Nothing changes on the schedule until that approval happens."
                              })
                            }
                          >
                            Accept
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="empty-state">No recipient actions are waiting for you.</div>
                    )}
                  </aside>
                </div>
              ) : (
                <div className="empty-state">No trade recipient actions are waiting right now.</div>
              )}
            </OperationalDetailSection>

            <OperationalDetailSection title="Manager Approval Queue" summary="Accepted trades and submitted PTO stay separate until final approval." defaultOpen>
              {(managerTradeQueue.length || ptoReviewQueue.length) ? (
                <div className="dashboard-stack">
                  {managerTradeQueue.length ? (
                    <div className="preview-detail-layout">
                      <div className="ops-preview-list">
                        {managerTradeQueue.map((trade) => (
                          <OperationalPreviewCard
                            key={trade.id}
                            eyebrow={trade.shoot_code ?? "Trade"}
                            title={trade.requester_name}
                            summary={trade.shift_title ?? trade.shoot_title ?? "Shift trade"}
                            owner={trade.approver_name ?? "Manager review"}
                            statusLabel="Pending Manager"
                            statusTone="warning"
                            flags={buildTradeFlags(trade)}
                            nextAction={canActOnTrade(trade) ? "Approve or deny" : "Review only"}
                            selected={selectedManagerTradeId === trade.id}
                            onClick={() => setSelectedManagerTradeId((current) => (current === trade.id ? "" : trade.id))}
                          />
                        ))}
                      </div>
                      <aside className="preview-detail-panel">
                        {selectedManagerTrade ? (
                          <>
                            <div className="preview-detail-panel__header">
                              <div>
                                <div className="eyebrow">Manager Trade Review</div>
                                <strong>{selectedManagerTrade.shift_title ?? selectedManagerTrade.shoot_title ?? "Trade request"}</strong>
                              </div>
                              <span className="meta-pill">Pending Manager</span>
                            </div>
                            <div className="dashboard-summary-list">
                              <div className="dashboard-summary-row">
                                <span className="muted">Requester</span>
                                <strong>{selectedManagerTrade.requester_name}</strong>
                              </div>
                              <div className="dashboard-summary-row">
                                <span className="muted">Recipient</span>
                                <strong>{selectedManagerTrade.requested_with_name ?? "Not set"}</strong>
                              </div>
                              <div className="dashboard-summary-row">
                                <span className="muted">Coverage</span>
                                <strong>{selectedManagerTrade.satisfies_lead_coverage ? "Lead coverage risk" : "Standard staffing swap"}</strong>
                              </div>
                            </div>
                            <OperationalDetailSection title="Trade Notes" summary="Requester, recipient, and conflict context" defaultOpen>
                              <div className="dashboard-summary-list">
                                <div className="dashboard-summary-row">
                                  <span className="muted">Reason</span>
                                  <strong>{selectedManagerTrade.reason || "No reason provided"}</strong>
                                </div>
                                {selectedManagerTrade.recipient_notes ? (
                                  <div className="dashboard-summary-row">
                                    <span className="muted">Recipient notes</span>
                                    <strong>{selectedManagerTrade.recipient_notes}</strong>
                                  </div>
                                ) : null}
                                {selectedManagerTrade.conflict_summary ? (
                                  <div className="dashboard-summary-row">
                                    <span className="muted">Conflict</span>
                                    <strong>{selectedManagerTrade.conflict_summary}</strong>
                                  </div>
                                ) : null}
                              </div>
                            </OperationalDetailSection>
                            {canActOnTrade(selectedManagerTrade) ? (
                              <div className="preview-detail-panel__actions">
                                <button
                                  className="secondary-button"
                                  onClick={() =>
                                    setPendingAction({
                                      kind: "trade-review",
                                      tradeId: selectedManagerTrade.id,
                                      status: "denied",
                                      title: "Deny this trade?",
                                      body: "This ends the trade without changing the schedule.",
                                      tone: "danger"
                                    })
                                  }
                                >
                                  Deny
                                </button>
                                <button
                                  className="primary-button"
                                  onClick={() =>
                                    setPendingAction({
                                      kind: "trade-review",
                                      tradeId: selectedManagerTrade.id,
                                      status: "approved",
                                      title: "Approve this trade?",
                                      body: "Approving finalizes the reassignment and updates the schedule."
                                    })
                                  }
                                >
                                  Approve
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="empty-state">No trade reviews are waiting for approval.</div>
                        )}
                      </aside>
                    </div>
                  ) : null}

                  {ptoReviewQueue.length ? (
                    <div className="ops-preview-list">
                      {ptoReviewQueue.map((request) => (
                        <div key={request.id} className="preview-detail-panel">
                          <div className="preview-detail-panel__header">
                            <div>
                              <div className="eyebrow">PTO Review</div>
                              <strong>{request.user_name}</strong>
                            </div>
                            <span className="meta-pill">{request.requested_on}</span>
                          </div>
                          <div className="dashboard-summary-list">
                            <div className="dashboard-summary-row">
                              <span className="muted">Unit</span>
                              <strong>{request.request_unit === "half_day" ? "Half day" : "Full day"}</strong>
                            </div>
                            <div className="dashboard-summary-row">
                              <span className="muted">Hours</span>
                              <strong>{request.requested_hours}</strong>
                            </div>
                            <div className="dashboard-summary-row">
                              <span className="muted">Reason</span>
                              <strong>{request.reason || "No reason provided"}</strong>
                            </div>
                          </div>
                          {canActOnPto(request) ? (
                            <div className="preview-detail-panel__actions">
                              <button
                                className="secondary-button"
                                onClick={() =>
                                  setPendingAction({
                                    kind: "pto-review",
                                    requestId: request.id,
                                    status: "rejected",
                                    title: "Reject this PTO request?",
                                    body: "Rejection does not require a comment and preserves the full request record.",
                                    tone: "danger"
                                  })
                                }
                              >
                                Reject
                              </button>
                              <button
                                className="primary-button"
                                onClick={() =>
                                  setPendingAction({
                                    kind: "pto-review",
                                    requestId: request.id,
                                    status: "approved",
                                    title: "Approve this PTO request?",
                                    body: "Approving keeps PTO separate from worked time and includes it in export."
                                  })
                                }
                              >
                                Approve
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state">Nothing is waiting on manager approval right now.</div>
              )}
            </OperationalDetailSection>
          </section>
        </div>

        <aside className="panel dashboard-sidebar">
          <div className="section-title">Attendance And Risk Watch</div>
          <p className="section-subtitle">Unresolved attendance and alert signals stay visible here without crowding the approval queue.</p>

          <div className="ops-preview-list">
            {exceptions.map((exception) => (
              <OperationalPreviewCard
                key={exception.id}
                eyebrow={humanizeLabel(exception.exception_type)}
                title={exception.user_name ?? "Team member"}
                summary={exception.shift_title ?? exception.shoot_code ?? "Attendance exception"}
                owner={exception.manager_name ?? exception.requested_approver_name ?? "Routing pending"}
                statusLabel={humanizeLabel(exception.status)}
                statusTone={exception.status === "approved" ? "success" : exception.status === "open" ? "warning" : "critical"}
                nextAction={canReviewAttendance ? "Review on time screen" : "Monitor"}
                selected={selectedExceptionId === exception.id}
                onClick={() => setSelectedExceptionId((current) => (current === exception.id ? "" : exception.id))}
              />
            ))}
            {!exceptions.length ? <div className="empty-state">No open attendance exceptions are attached to this date.</div> : null}
          </div>

          {selectedException ? (
            <div className="preview-detail-panel">
              <div className="preview-detail-panel__header">
                <div>
                  <div className="eyebrow">Attendance Context</div>
                  <strong>{selectedException.user_name ?? "Team member"}</strong>
                </div>
                <span className="meta-pill">{humanizeLabel(selectedException.status)}</span>
              </div>
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Shift</span>
                  <strong>{selectedException.shift_title ?? selectedException.shoot_code ?? "Attendance item"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Approver</span>
                  <strong>{selectedException.requested_approver_name ?? selectedException.approved_by_name ?? "Pending"}</strong>
                </div>
              </div>
              <OperationalDetailSection title="Exception Detail" summary="Notes and correction payloads">
                <div className="dashboard-summary-list">
                  <div className="dashboard-summary-row">
                    <span className="muted">Notes</span>
                    <strong>{selectedException.notes ?? selectedException.reason_code ?? "No additional notes provided"}</strong>
                  </div>
                  {selectedException.requested_value ? (
                    <div className="dashboard-summary-row">
                      <span className="muted">Requested value</span>
                      <strong>{JSON.stringify(selectedException.requested_value)}</strong>
                    </div>
                  ) : null}
                </div>
              </OperationalDetailSection>
              <div className="preview-detail-panel__actions">
                <button className="secondary-button" onClick={() => { window.location.hash = "#time"; }}>
                  Open Time & Attendance
                </button>
              </div>
            </div>
          ) : null}

          <section className="sidebar-section">
            <OperationalDetailSection
              title="Operational Risk And Controls"
              summary="Sync failures, dangerous actions, notifications, and linked alerts stay available here without taking over the approval queue."
              defaultOpen={Boolean(syncRiskRows.length || dangerousAuditRows.length)}
            >
              <div className="dashboard-stack">
                <section>
                  <div className="section-title">Control Watch</div>
            <div className="notification-list">
              {syncRiskRows.map((operation) => (
                <article key={operation.id} className={`notification-card notification-card--${operation.status === "failed" ? "critical" : "warning"}`}>
                  <strong>{humanizeLabel(operation.provider)} {humanizeLabel(operation.status)}</strong>
                  <div className="muted">
                    {humanizeLabel(operation.entity_type)} • {humanizeLabel(operation.operation_type)}
                  </div>
                  <div className="muted">{operation.last_error ?? operation.conflict_summary ?? "Sync issue needs review."}</div>
                </article>
              ))}
              {dangerousAuditRows.map((row) => (
                <article key={row.id} className="notification-card notification-card--warning">
                  <strong>{humanizeLabel(row.action)}</strong>
                  <div className="muted">{row.actor_name ?? row.actor_email ?? "Unknown actor"}</div>
                  <div className="muted">{new Date(row.created_at).toLocaleString()}</div>
                </article>
              ))}
              {!syncRiskRows.length && !dangerousAuditRows.length ? <div className="empty-state">No sync failures or dangerous-action signals are active.</div> : null}
            </div>
                </section>

                <section>
                  <div className="section-title">Recent Notifications</div>
            <div className="notification-list">
              {notifications.slice(0, 5).map((notification) => (
                <article key={notification.id} className={`notification-card notification-card--${notification.priority}`}>
                  <strong>{notification.title}</strong>
                  <div className="muted">{notification.body}</div>
                </article>
              ))}
              {!notifications.length ? <div className="empty-state">No approval-related notifications are in view.</div> : null}
            </div>
                </section>

                <section>
                  <div className="section-title">Open Alerts</div>
            <div className="notification-list">
              {alerts.slice(0, 5).map((alert) => (
                <article key={alert.id} className="notification-card notification-card--warning">
                  <strong>{alert.shoot_code ?? humanizeLabel(alert.alert_type)}</strong>
                  <div className="muted">{alert.message}</div>
                  <div className="muted">{new Date(alert.created_at).toLocaleString()}</div>
                </article>
              ))}
              {!alerts.length ? <div className="empty-state">No open alerts are attached to the approval center.</div> : null}
            </div>
                </section>
              </div>
            </OperationalDetailSection>
          </section>
        </aside>
      </section>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.title ?? ""}
        body={pendingAction?.body ?? ""}
        confirmLabel={getConfirmLabel(pendingAction)}
        tone={pendingAction?.tone ?? "default"}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void executePendingAction()}
      />
    </>
  );
}

function canCancelTrade(trade: TradeRequest, userId: string) {
  return trade.requester_user_id === userId && (trade.status === "pending_recipient" || trade.status === "pending_manager");
}

function canCancelPTO(request: PTORequest, userId: string) {
  return (
    request.user_id === userId &&
    ["draft", "submitted", "approved", "needs_review"].includes(request.status) &&
    request.starts_on >= getLocalDateString()
  );
}

function selectExistingOrFirst<T extends { id: string }>(current: string, rows: T[]) {
  return rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "";
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShiftWindow(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt || !endsAt) {
    return "Time pending";
  }
  return `${new Date(startsAt).toLocaleString()} - ${new Date(endsAt).toLocaleTimeString()}`;
}

function formatTradeWindow(trade: Pick<TradeRequest, "starts_at" | "ends_at">) {
  return formatShiftWindow(trade.starts_at ?? null, trade.ends_at ?? null);
}

function formatTradeSummary(trade: TradeRequest) {
  return `${trade.requested_with_name ?? "Recipient pending"} | ${formatTradeWindow(trade)}`;
}

function formatAvailabilityWindow(request: PTORequest) {
  const start = request.starts_on;
  const end = request.ends_on;
  if (start === end) {
    return start;
  }
  return `${start} to ${end}`;
}

function formatAvailabilityUnit(request: PTORequest) {
  if (!request.all_day && request.start_time && request.end_time) {
    return `${request.start_time} to ${request.end_time}`;
  }
  if (request.request_type === "multi_day_off") {
    return "Multi-day";
  }
  return request.request_unit === "half_day" ? "Half day" : "Full day";
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function tradeStatusTone(status: TradeRequest["status"]) {
  if (status === "approved") {
    return "success" as const;
  }
  if (status === "denied" || status === "recipient_declined" || status === "canceled") {
    return "critical" as const;
  }
  return "warning" as const;
}

function ptoStatusTone(status: PTORequest["status"]) {
  if (status === "approved") {
    return "success" as const;
  }
  if (status === "rejected" || status === "cancelled_by_employee" || status === "cancelled_by_manager_admin") {
    return "critical" as const;
  }
  return "warning" as const;
}

function buildTradeFlags(trade: TradeRequest) {
  return [
    ...(trade.same_day_exception_eligible ? [{ label: "Same day", tone: "warning" as const }] : []),
    ...(trade.satisfies_lead_coverage || trade.staffing_role === "lead_photographer" || trade.staffing_role === "senior_photographer"
      ? [{ label: "Lead coverage risk", tone: "critical" as const }]
      : []),
    ...(trade.requested_with_conflict || trade.conflict_summary ? [{ label: "Conflict warning", tone: "critical" as const }] : [])
  ];
}

function getConfirmLabel(action: PendingAction | null) {
  if (!action) {
    return "Confirm";
  }
  switch (action.kind) {
    case "trade-respond":
      return action.status === "accepted" ? "Accept Trade" : "Decline Trade";
    case "trade-review":
      return action.status === "approved" ? "Approve Trade" : "Deny Trade";
    case "trade-cancel":
      return "Cancel Trade";
    case "pto-review":
      return action.status === "approved" ? "Approve Request" : "Reject Request";
    case "pto-cancel":
      return "Cancel Request";
    default:
      return "Confirm";
  }
}
