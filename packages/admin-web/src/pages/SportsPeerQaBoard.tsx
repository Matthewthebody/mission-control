import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import {
  DetailPreviewPanel,
  StatusPill,
  formatDate,
  formatDateTime,
  humanizeToken,
  statusTone
} from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import { listSportsPeerQaBoard } from "../services/sportsApi";
import type { SportsPeerQaBoardResponse, SportsPeerQaChecklistItem, SportsPeerQaJob, SportsPeerQaStatus } from "../sportsTypes";

type Props = {
  token: string;
};

const STATUS_LABELS: Record<SportsPeerQaStatus, string> = {
  ready_for_owner_qa: "Ready for Owner QA",
  owner_qa_in_progress: "Owner QA in Progress",
  ready_for_peer_qa: "Ready for Peer QA",
  peer_qa_in_progress: "Peer QA in Progress",
  corrections_needed: "Corrections Needed",
  corrections_complete: "Corrections Complete",
  ready_for_spencer_review: "Ready for Spencer Review",
  blocked_waiting: "Blocked / Waiting",
  approved_for_release: "Approved for Release",
  released_complete: "Released / Complete"
};

const COUNT_KEYS: Array<{ key: SportsPeerQaStatus; label: string }> = [
  { key: "ready_for_owner_qa", label: "Owner QA" },
  { key: "ready_for_peer_qa", label: "Peer QA" },
  { key: "corrections_needed", label: "Corrections" },
  { key: "ready_for_spencer_review", label: "Spencer" },
  { key: "blocked_waiting", label: "Blocked" },
  { key: "approved_for_release", label: "Approved" }
];

function statusToneForQa(status: SportsPeerQaStatus) {
  if (status === "corrections_needed" || status === "blocked_waiting") {
    return "danger";
  }
  if (status === "ready_for_peer_qa" || status === "ready_for_spencer_review") {
    return "warning";
  }
  if (status === "approved_for_release" || status === "released_complete") {
    return "success";
  }
  return statusTone(status);
}

function checklistProgress(items: SportsPeerQaChecklistItem[]) {
  const applicable = items.filter((item) => item.applies !== false);
  if (!applicable.length) {
    return "No checks";
  }
  return `${applicable.filter((item) => item.complete).length}/${applicable.length}`;
}

function ChecklistSection({ title, items }: { title: string; items: SportsPeerQaChecklistItem[] }) {
  return (
    <section className="sports-detail-card sports-detail-card--nested">
      <div className="sports-detail-card__header">
        <div>
          <h4>{title}</h4>
          <p>{checklistProgress(items)} complete</p>
        </div>
      </div>
      <div className="sports-qa-checklist">
        {items.length ? (
          items.map((item) => (
            <div key={`${title}-${item.label}`} className={item.complete ? "sports-qa-checklist__item is-complete" : "sports-qa-checklist__item"}>
              <span>{item.complete ? "Pass" : item.applies === false ? "N/A" : "Open"}</span>
              <strong>{item.label}</strong>
            </div>
          ))
        ) : (
          <p>No checks recorded yet.</p>
        )}
      </div>
    </section>
  );
}

function ReleasePacket({ job }: { job: SportsPeerQaJob }) {
  const packet = job.release_packet;
  const rows = [
    ["Owner QA complete", packet.owner_qa_complete],
    ["Peer QA complete", packet.peer_qa_complete],
    ["Corrections resolved", packet.corrections_resolved],
    ["Spencer review complete", packet.spencer_review_complete],
    ["Price sheet / release setup confirmed", packet.price_sheet_confirmed],
    ["Team images confirmed", packet.team_images_confirmed],
    ["Individual galleries confirmed", packet.individual_galleries_confirmed],
    ["Buddy photos complete", packet.buddy_photos_complete],
    ["Virtual teams complete", packet.virtual_teams_complete],
    ["Known exceptions documented", packet.known_exceptions_documented],
    ["Approved for release", packet.approved_for_release]
  ];
  return (
    <section className="sports-detail-card sports-detail-card--nested">
      <div className="sports-detail-card__header">
        <div>
          <h4>Ready-for-release packet</h4>
          <p>{job.approved_for_release_at ? `Approved ${formatDateTime(job.approved_for_release_at)}` : "Release confidence snapshot"}</p>
        </div>
      </div>
      <div className="sports-preview-field-grid">
        {rows.map(([label, value]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <strong>{value === null ? "N/A" : value ? "Yes" : "No"}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SportsPeerQaBoard({ token }: Props) {
  const [payload, setPayload] = useState<SportsPeerQaBoardResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSportsPeerQaBoard(token)
      .then((response) => {
        if (!cancelled) {
          setPayload(response);
          setSelectedId(response.items[0]?.id ?? null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load the Sports peer QA board right now.");
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
  }, [token]);

  const selected = useMemo(() => payload?.items.find((item) => item.id === selectedId) ?? payload?.items[0] ?? null, [payload?.items, selectedId]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading Sports peer QA" summary="Opening owner QA, peer QA, corrections, blockers, and release readiness." />;
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports Peer-to-Peer QA Board"
        summary="Track Sports jobs through owner QA, peer review, corrections, blockers, and final release readiness."
        meta={[
          { label: `${payload?.summary.total ?? 0} QA jobs`, tone: "info" },
          { label: `${payload?.summary.blocked ?? 0} blocked`, tone: payload?.summary.blocked ? "warning" : "success" }
        ]}
      />

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel sports-qa-positioning">
        <WorkspaceSectionHeader
          title="Sports QA is not Schools handoff"
          summary="Sports Peer-to-Peer QA is about production quality, exceptions, blockers, and release confidence. Schools workflows stay focused on deadlines, gallery communication, yearbook/gallery handoff, and school-specific follow-up."
        />
      </section>

      {payload ? (
        <div className="sports-kpi-grid sports-qa-count-grid">
          {COUNT_KEYS.map((item) => (
            <button key={item.key} type="button" className="sports-qa-count-card" onClick={() => setSelectedId(payload.items.find((job) => job.qa_status === item.key)?.id ?? selectedId)}>
              <span>{item.label}</span>
              <strong>{payload.summary[item.key]}</strong>
            </button>
          ))}
        </div>
      ) : null}

      {!payload?.items.length ? (
        <WorkspaceEmptyState title="No Sports QA jobs yet" summary="Sports production items with peer QA metadata will appear here without mixing in Schools jobs." />
      ) : (
        <div className="sports-split-pane">
          <section className="panel sports-master-table">
            <div className="sports-master-table__header">
              <strong>Sports QA queue</strong>
              <span>{payload.items.length} items</span>
            </div>
            <div className="sports-master-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Organization</th>
                    <th>Shoot</th>
                    <th>Status</th>
                    <th>Job Type</th>
                    <th>Owner</th>
                    <th>Peer</th>
                    <th>Spencer</th>
                    <th>Who has the ball</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.items.map((job) => (
                    <tr key={job.id} className={job.id === selected?.id ? "is-selected" : ""} onClick={() => setSelectedId(job.id)}>
                      <td>
                        <div className="sports-table__primary">{job.job_name}</div>
                        <div className="sports-table__secondary">{job.correction_category ?? job.known_exceptions ?? "Open detail"}</div>
                      </td>
                      <td>{job.organization_name ?? "Sports client"}</td>
                      <td>{formatDate(job.shoot_date)}</td>
                      <td><StatusPill label={STATUS_LABELS[job.qa_status]} tone={statusToneForQa(job.qa_status)} /></td>
                      <td>{humanizeToken(job.sports_job_type)}</td>
                      <td>{job.owner_name ?? "Unassigned"}</td>
                      <td>{job.peer_reviewer_name ?? "Unassigned"}</td>
                      <td>{job.final_reviewer_name ?? "Spencer"}</td>
                      <td>{job.blocker_owner ?? (job.qa_status === "corrections_needed" ? job.owner_name ?? "Production owner" : job.qa_status === "ready_for_spencer_review" ? "Spencer" : "Sports")}</td>
                      <td>{formatDateTime(job.last_updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <DetailPreviewPanel
            title={selected?.job_name ?? "Select a Sports QA job"}
            subtitle={selected ? `${selected.organization_name ?? "Sports client"} | ${STATUS_LABELS[selected.qa_status]}` : "Review owner QA, peer QA, corrections, blockers, and release readiness."}
            actions={
              selected ? (
                <WorkspaceActionBar align="end">
                  <button type="button" onClick={() => (window.location.hash = `#sports/jobs/${selected.job_id}`)}>
                    Open Job
                  </button>
                  <button type="button" className="secondary-button" onClick={() => (window.location.hash = `#sports/graphics?item=${selected.production_item_id}`)}>
                    Open Production
                  </button>
                </WorkspaceActionBar>
              ) : null
            }
          >
            {selected ? (
              <div className="sports-preview-stack">
                <div className="sports-preview-status-row">
                  <StatusPill label={STATUS_LABELS[selected.qa_status]} tone={statusToneForQa(selected.qa_status)} />
                  <StatusPill label={humanizeToken(selected.sports_job_type)} tone="info" />
                  <StatusPill label={selected.blocker_reason ? "Blocked" : "No Active Blocker"} tone={selected.blocker_reason ? "danger" : "success"} />
                </div>

                <section className="sports-detail-card sports-detail-card--nested">
                  <div className="sports-detail-card__header">
                    <div>
                      <h4>Job summary</h4>
                      <p>{selected.known_exceptions ?? "No known exception documented."}</p>
                    </div>
                  </div>
                  <div className="sports-preview-field-grid">
                    <div><span>Department</span><strong>Sports</strong></div>
                    <div><span>Shoot Date</span><strong>{formatDate(selected.shoot_date)}</strong></div>
                    <div><span>Owner / Artist</span><strong>{selected.owner_name ?? "Unassigned"}</strong></div>
                    <div><span>Peer Reviewer</span><strong>{selected.peer_reviewer_name ?? "Unassigned"}</strong></div>
                    <div><span>Final Reviewer</span><strong>{selected.final_reviewer_name ?? "Spencer"}</strong></div>
                    <div><span>Job Type</span><strong>{humanizeToken(selected.sports_job_type)}</strong></div>
                  </div>
                </section>

                <ChecklistSection title="Owner QA checklist" items={selected.owner_checklist} />
                <ChecklistSection title="Peer QA checklist" items={selected.peer_checklist} />
                <ChecklistSection title="Conditional Sports checks" items={selected.conditional_checklist} />

                <section className="sports-detail-card sports-detail-card--nested">
                  <div className="sports-detail-card__header">
                    <div>
                      <h4>Corrections</h4>
                      <p>{selected.correction_category ? humanizeToken(selected.correction_category) : "No correction category active."}</p>
                    </div>
                  </div>
                  <p>{selected.correction_notes ?? "No correction notes recorded."}</p>
                </section>

                <section className="sports-detail-card sports-detail-card--nested">
                  <div className="sports-detail-card__header">
                    <div>
                      <h4>Blocker</h4>
                      <p>{selected.blocker_reason ? humanizeToken(selected.blocker_reason) : "No blocker active."}</p>
                    </div>
                  </div>
                  <div className="sports-preview-field-grid">
                    <div><span>Blocker Owner</span><strong>{selected.blocker_owner ?? "Clear"}</strong></div>
                    <div><span>Notes</span><strong>{selected.blocker_notes ?? "No blocker notes"}</strong></div>
                  </div>
                </section>

                <ReleasePacket job={selected} />
              </div>
            ) : (
              <WorkspaceEmptyState title="Select a QA job" summary="Pick a Sports job to inspect the QA packet." compact />
            )}
          </DetailPreviewPanel>
        </div>
      )}
    </section>
  );
}
