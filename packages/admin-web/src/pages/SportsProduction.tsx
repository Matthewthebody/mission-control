import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import {
  DetailPreviewPanel,
  SavedViewBar,
  StatusPill,
  formatDate,
  humanizeToken,
  statusTone,
  useHashRouteSnapshot
} from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { buildProductionProjectsHash } from "../services/productionProjects";
import { listSportsProduction } from "../services/sportsApi";
import type { SportsProductionItemSummary, SportsProductionResponse } from "../sportsTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type ViewKey = "all" | "proof_queue" | "specialty_products" | "qa_review" | "blocked";

function viewMatches(item: SportsProductionItemSummary, view: ViewKey) {
  if (view === "blocked") {
    return item.status === "blocked" || Boolean(item.blocked_reason);
  }
  if (view === "qa_review") {
    return item.qa_status?.includes("qa") ?? false;
  }
  if (view === "proof_queue") {
    return item.proof_required || item.approval_required;
  }
  return true;
}

export function SportsProduction({ token }: Props) {
  const { params } = useHashRouteSnapshot();
  const [payload, setPayload] = useState<SportsProductionResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeView = (params.get("view") as ViewKey | null) ?? "all";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSportsProduction(token)
      .then((response) => {
        if (!cancelled) {
          setPayload(response);
          setSelectedId(response.items[0]?.id ?? null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load sports graphics workflow right now.");
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

  const filteredItems = useMemo(
    () => (payload?.items ?? []).filter((item) => viewMatches(item, activeView)),
    [activeView, payload?.items]
  );
  const selected = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading sports graphics" summary="Opening the sports-filtered graphics, proof, and specialty product queue." />;
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports Graphics"
        summary="Sports-owned graphics workflow view across canonical downstream items, proof cycles, specialty products, blocked work, and client approval pressure."
        meta={
          payload
            ? [
                { label: `${payload.summary.total} production items`, tone: "info" },
                { label: `${payload.summary.blocked} blocked`, tone: payload.summary.blocked ? "warning" : "success" }
              ]
            : []
        }
      />

      <section className="panel sports-overview-toolbar">
        <SavedViewBar
          views={[
            { key: "all", label: "All Graphics" },
            { key: "proof_queue", label: "Proof Queue" },
            { key: "specialty_products", label: "Specialty Products" },
            { key: "qa_review", label: "QA Review" },
            { key: "blocked", label: "Blocked Items" }
          ]}
          activeKey={activeView}
          onSelect={(key) => {
            window.location.hash = key === "all" ? "#sports/graphics" : `#sports/graphics?view=${key}`;
          }}
        />
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {!filteredItems.length ? (
        <WorkspaceEmptyState title="No sports production items in this view" summary="Published sports jobs create canonical downstream shells. This view narrows the queue without creating a second production system." />
      ) : (
        <div className="sports-split-pane">
          <section className="panel sports-master-table">
            <div className="sports-master-table__header">
            <strong>Sports Graphics Queue</strong>
              <span>{filteredItems.length} items</span>
            </div>
            <div className="sports-master-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Assigned To</th>
                    <th>Due</th>
                    <th>Proof</th>
                    <th>QA</th>
                    <th>Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className={item.id === selected?.id ? "is-selected" : ""} onClick={() => setSelectedId(item.id)}>
                      <td>
                        <div className="sports-table__primary">{item.title}</div>
                        <div className="sports-table__secondary">{humanizeToken(item.production_type)}</div>
                      </td>
                      <td><StatusPill label={humanizeToken(item.status)} tone={statusTone(item.status)} /></td>
                      <td>{item.assigned_to_name ?? "Unassigned"}</td>
                      <td>{formatDate(item.due_date)}</td>
                      <td>{item.proof_required ? "Required" : "Not required"}</td>
                      <td>{humanizeToken(item.qa_status)}</td>
                      <td>{item.blocked_reason ?? "Clear"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <DetailPreviewPanel
            title={selected?.title ?? "Select a production item"}
            subtitle={selected ? `${selected.assigned_to_name ?? "No owner"} | due ${formatDate(selected.due_date)}` : "Keep the sports queue visible while you inspect the downstream work."}
            actions={
              selected ? (
                <WorkspaceActionBar align="end">
                  <button
                    type="button"
                    onClick={() => {
                      window.location.hash = buildProductionProjectsHash({ projectId: selected.id });
                    }}
                  >
                    Open Graphics Workflow
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      if (selected.linked_shoot_id) {
                        window.location.hash = `#sports/shoots/${selected.linked_shoot_id}`;
                      }
                    }}
                  >
                    Open Linked Shoot
                  </button>
                </WorkspaceActionBar>
              ) : null
            }
          >
            {selected ? (
              <div className="sports-preview-stack">
                <div className="sports-preview-status-row">
                  <StatusPill label={humanizeToken(selected.status)} tone={statusTone(selected.status)} />
                  <StatusPill label={selected.proof_required ? "Proof Required" : "Proof Not Required"} tone={selected.proof_required ? "warning" : "neutral"} />
                  <StatusPill label={selected.approval_required ? "Approval Required" : "No Approval Gate"} tone={selected.approval_required ? "warning" : "neutral"} />
                </div>
                <div className="sports-preview-field-grid">
                  <div>
                    <span>Delivery Deadline</span>
                    <strong>{formatDate(selected.delivery_deadline)}</strong>
                  </div>
                  <div>
                    <span>Files</span>
                    <strong>
                      {(selected.file_count_received ?? 0)}/{selected.file_count_expected ?? "TBD"}
                    </strong>
                  </div>
                </div>
                <section className="sports-detail-card">
                  <h4>Blocked Reason</h4>
                  <p>{selected.blocked_reason ?? "No active blocker on the canonical production record."}</p>
                </section>
                <section className="sports-detail-card">
                  <h4>Proof Cycles In View</h4>
                  <div className="sports-mini-list">
                    {(payload?.proof_cycles ?? [])
                      .filter((cycle) => cycle.production_item_id === selected.id)
                      .slice(0, 6)
                      .map((cycle) => (
                        <div key={cycle.id} className="sports-mini-list__item">
                          <strong>{cycle.approver_contact_name ?? "Approver pending"}</strong>
                          <span>{humanizeToken(cycle.status)} | due {formatDate(cycle.due_date)}</span>
                        </div>
                      ))}
                  </div>
                </section>
                <section className="sports-detail-card">
                  <h4>Specialty Products In View</h4>
                  <div className="sports-mini-list">
                    {(payload?.specialty_products ?? [])
                      .filter((product) => product.production_item_id === selected.id)
                      .slice(0, 6)
                      .map((product) => (
                        <div key={product.id} className="sports-mini-list__item">
                          <strong>{product.title}</strong>
                          <span>{product.quantity} | {humanizeToken(product.status)}</span>
                        </div>
                      ))}
                  </div>
                </section>
              </div>
            ) : (
              <WorkspaceEmptyState title="Select a production item" summary="The filtered sports production queue will keep this rail focused on the selected downstream work item." compact />
            )}
          </DetailPreviewPanel>
        </div>
      )}
    </section>
  );
}
