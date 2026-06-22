import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../../api";
import {
  createDateChangeRequest,
  decideDateChange,
  getDateChangeRequest,
  listDateChangeRequestsForShoot,
  recordDateChangeAlternative,
  runDateChangeFeasibility,
  transitionDateChange,
  type DateChangeEvent,
  type DateChangeRequest
} from "../../services/dateChangeApi";

// June 18 — auditable Shoot date-change workflow UI. The original booked date is read-only; creating
// a request never mutates the Shoot; approval (leadership-only, server-enforced) applies the canonical
// change and preserves the original date in history. Equipment feasibility is honestly "unavailable".

type Props = {
  token: string;
  shootId: string;
  originalDate: string;
  canApprove?: boolean;
  /** Open a specific request by id (deep link from Schedule / Urgent Window / Leadership / CSR). */
  focusRequestId?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  feasibility_review: "Feasibility Review",
  alternatives_required: "Alternatives Required",
  awaiting_client: "Awaiting Client",
  approved: "Approved",
  declined: "Declined",
  canceled: "Canceled",
  completed: "Completed"
};

export function DateChangeRequestPanel({ token, shootId, originalDate, canApprove, focusRequestId }: Props) {
  const [requests, setRequests] = useState<DateChangeRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(focusRequestId ?? null);
  const [detail, setDetail] = useState<{ request: DateChangeRequest; events: DateChangeEvent[] } | null>(null);
  const [requestedDate, setRequestedDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    try {
      const res = await listDateChangeRequestsForShoot(token, shootId);
      setRequests(res.requests);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load date-change requests.");
    }
  }, [token, shootId]);

  const loadDetail = useCallback(
    async (id: string) => {
      const res = await getDateChangeRequest(token, id);
      setDetail(res);
    },
    [token]
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const submit = useCallback(async () => {
    if (!requestedDate) {
      setError("Choose a requested date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await createDateChangeRequest(token, { shoot_id: shootId, requested_shoot_date: requestedDate, request_reason: reason || null });
      setRequestedDate("");
      setReason("");
      await loadList();
      setSelectedId(res.request.id);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't create the request.");
    } finally {
      setBusy(false);
    }
  }, [token, shootId, requestedDate, reason, loadList]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        await fn();
        if (selectedId) await loadDetail(selectedId);
        await loadList();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : "That action couldn't be completed.");
      } finally {
        setBusy(false);
      }
    },
    [selectedId, loadDetail, loadList]
  );

  const req = detail?.request;

  return (
    <section className="date-change-panel request-card" aria-label="Shoot date-change requests">
      <div className="directory-card__header">
        <div>
          <strong>Date-change requests</strong>
          <div className="muted">The original booked date is preserved; a request never moves the shoot until approved.</div>
        </div>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      <form
        className="date-change-panel__create"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="directory-field">
          <span>Original booked date</span>
          <input aria-label="Original booked date" value={originalDate} readOnly />
        </label>
        <label className="directory-field">
          <span>Requested date</span>
          <input type="date" aria-label="Requested date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Reason</span>
          <input aria-label="Request reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. gym double-booked" />
        </label>
        <button type="submit" disabled={busy}>Submit date-change request</button>
      </form>

      {requests.length ? (
        <ul className="date-change-panel__list" aria-label="Existing date-change requests">
          {requests.map((r) => (
            <li key={r.id}>
              <button type="button" className="directory-link-button" aria-pressed={selectedId === r.id} onClick={() => setSelectedId(r.id)}>
                <span>{r.original_shoot_date?.slice(0, 10)} → {r.requested_shoot_date?.slice(0, 10)}</span>
                <span className="meta-pill">{STATUS_LABEL[r.current_status] ?? r.current_status}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state empty-state--panel">No date-change requests for this shoot.</div>
      )}

      {req ? (
        <div className="date-change-panel__detail" aria-label={`Date-change request ${req.id}`}>
          <dl className="date-change-panel__fields">
            <div><dt>Status</dt><dd>{STATUS_LABEL[req.current_status] ?? req.current_status}</dd></div>
            <div><dt>Original date</dt><dd>{req.original_shoot_date?.slice(0, 10)}</dd></div>
            <div><dt>Requested date</dt><dd>{req.requested_shoot_date?.slice(0, 10)}</dd></div>
            <div><dt>Reason</dt><dd>{req.request_reason ?? "—"}</dd></div>
            <div><dt>Staffing feasibility</dt><dd>{req.staffing_result}</dd></div>
            <div><dt>Capacity feasibility</dt><dd>{req.capacity_result}</dd></div>
            <div><dt>Schedule conflict</dt><dd>{req.schedule_conflict_result}</dd></div>
            <div><dt>Equipment / camera</dt><dd>{req.equipment_result === "unavailable" ? "Unavailable (no canonical source)" : req.equipment_result}</dd></div>
            <div><dt>Decision</dt><dd>{req.decision ?? "—"}</dd></div>
            <div><dt>Final date</dt><dd>{req.final_shoot_date?.slice(0, 10) ?? "—"}</dd></div>
          </dl>

          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => runDateChangeFeasibility(token, req.id))}>Run feasibility</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => recordDateChangeAlternative(token, req.id, { type: "later_picture_day" }))}>Record alternative</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => transitionDateChange(token, req.id, "awaiting_client"))}>Await client</button>
            {canApprove ? (
              <>
                <button type="button" disabled={busy} onClick={() => void act(() => decideDateChange(token, req.id, "approved"))}>Approve</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => decideDateChange(token, req.id, "declined"))}>Decline</button>
              </>
            ) : null}
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void act(() => decideDateChange(token, req.id, "canceled"))}>Cancel</button>
          </div>

          <div className="date-change-panel__history">
            <strong>History</strong>
            <ul aria-label="Date-change history">
              {(detail?.events ?? []).map((ev) => (
                <li key={ev.id}>
                  <span className="muted">{ev.created_at?.slice(0, 19).replace("T", " ")}</span> · {ev.event_type}
                  {ev.to_status ? <> → {STATUS_LABEL[ev.to_status] ?? ev.to_status}</> : null}
                  {ev.reason ? <span className="muted"> — {ev.reason}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
