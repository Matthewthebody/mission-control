import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import {
  DetailPreviewPanel,
  RiskBadge,
  StatusPill,
  WatchFlagList,
  formatDate,
  humanizeToken,
  statusTone,
  useHashRouteSnapshot
} from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceFilterToolbar } from "../components/workspace/WorkspaceFilterToolbar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader } from "../components/workspace/WorkspacePageHeader";
import { getSportsAccountDetail, listSportsAccounts } from "../services/sportsApi";
import type { SportsAccountDetailResponse, SportsAccountSummary } from "../sportsTypes";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

function matchesSearch(item: SportsAccountSummary, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    item.organization_name.toLowerCase().includes(normalized) ||
    (item.account_owner_name ?? "").toLowerCase().includes(normalized) ||
    item.active_seasons.some((season) => season.toLowerCase().includes(normalized))
  );
}

export function SportsAccounts({ token }: Props) {
  const { params } = useHashRouteSnapshot();
  const [items, setItems] = useState<SportsAccountSummary[]>([]);
  const [detail, setDetail] = useState<SportsAccountDetailResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("organization"));
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSportsAccounts(token)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setItems(response.items);
        const preferredId =
          params.get("organization") && response.items.some((item) => item.id === params.get("organization"))
            ? params.get("organization")
            : response.items[0]?.id ?? null;
        setSelectedId(preferredId);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load sports accounts right now.");
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
  }, [params, token]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getSportsAccountDetail(token, selectedId)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
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
  }, [selectedId, token]);

  const filtered = useMemo(() => items.filter((item) => matchesSearch(item, search)), [items, search]);

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading sports accounts" summary="Opening sports-filtered shared accounts and account health signals." />;
  }

  return (
    <section className="sports-workspace">
      <WorkspacePageHeader
        eyebrow="Sports"
        title="Sports Accounts"
        summary="Sports-filtered account management built on the shared organization backbone, with account health, shoot history, and open escalation context."
        meta={[{ label: `${items.length} active sports accounts`, tone: "info" }]}
      />

      <WorkspaceFilterToolbar className="sports-filter-toolbar">
        <label className="filter-field filter-field--wide">
          <span>Search Accounts</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Organization, owner, or season" />
        </label>
      </WorkspaceFilterToolbar>

      {error ? <div className="error-banner">{error}</div> : null}

      {!filtered.length ? (
        <WorkspaceEmptyState title="No sports accounts match this search" summary="Published sports jobs drive the account list, so new accounts appear here as the department starts working them." />
      ) : (
        <div className="sports-split-pane">
          <section className="panel sports-master-table">
            <div className="sports-master-table__header">
              <strong>Shared Organizations Filtered For Sports</strong>
              <span>{filtered.length} accounts</span>
            </div>
            <div className="sports-master-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Owner</th>
                    <th>Health</th>
                    <th>Active Seasons</th>
                    <th>Active Shoots</th>
                    <th>Next Shoot</th>
                    <th>Issues</th>
                    <th>Revenue Share</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selectedId ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedId(item.id);
                        window.location.hash = `#sports/accounts?organization=${item.id}`;
                      }}
                    >
                      <td>
                        <div className="sports-table__primary">{item.organization_name}</div>
                        <div className="sports-table__secondary">{humanizeToken(item.account_type)}</div>
                      </td>
                      <td>{item.account_owner_name ?? "Unassigned"}</td>
                      <td><RiskBadge level={item.health_status} /></td>
                      <td>{item.active_seasons.length ? item.active_seasons.map(humanizeToken).join(", ") : "None"}</td>
                      <td>{item.active_shoots_count}</td>
                      <td>{formatDate(item.next_shoot_date)}</td>
                      <td>{item.open_issues}</td>
                      <td>{item.revenue_share_enabled ? "Enabled" : "Off"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <DetailPreviewPanel
            title={detail?.account.organization_name ?? "Select an account"}
            subtitle={detail ? `${humanizeToken(detail.account.account_type)} | ${detail.account.account_owner_name ?? "Owner pending"}` : "Keep the account list visible while you inspect shared relationship context."}
            actions={
              detail ? (
                <WorkspaceActionBar align="end">
                  <button type="button" onClick={() => (window.location.hash = detail.account.linked_organization_hash)}>
                    Open Shared Account
                  </button>
                </WorkspaceActionBar>
              ) : null
            }
          >
            {detailLoading ? (
              <WorkspaceLoadingBlock title="Loading account detail" summary="Pulling shared contacts, locations, sports history, and open issues." />
            ) : detail ? (
              <div className="sports-preview-stack">
                <div className="sports-preview-status-row">
                  <RiskBadge level={detail.account.health_status} />
                  <StatusPill label={`${detail.account.active_shoots_count} active jobs`} tone="info" />
                  <StatusPill label={detail.account.revenue_share_enabled ? "Revenue Share On" : "Revenue Share Off"} tone={detail.account.revenue_share_enabled ? "warning" : "neutral"} />
                </div>
                <div className="sports-preview-field-grid">
                  <div>
                    <span>Next Shoot</span>
                    <strong>{formatDate(detail.account.next_shoot_date)}</strong>
                  </div>
                  <div>
                    <span>Last Touchpoint</span>
                    <strong>{formatDate(detail.account.last_touchpoint)}</strong>
                  </div>
                </div>
                <section className="sports-detail-card">
                  <h4>Contacts</h4>
                  {detail.contacts.length ? (
                    <div className="sports-mini-list">
                      {detail.contacts.map((contact) => (
                        <div key={contact.id} className="sports-mini-list__item">
                          <strong>{contact.full_name}</strong>
                          <span>{contact.title ?? contact.role_category ?? "Contact"}</span>
                          <span>{contact.approval_owner ? "Approval owner" : contact.billing_contact ? "Billing contact" : "Shared contact"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <WorkspaceEmptyState title="No sports-linked contacts yet" summary="Shared contacts will surface here as sports jobs link them." compact />
                  )}
                </section>
                <section className="sports-detail-card">
                  <h4>Linked Locations</h4>
                  {detail.linked_locations.length ? (
                    <div className="sports-mini-list">
                      {detail.linked_locations.map((location) => (
                        <div key={location.id} className="sports-mini-list__item">
                          <strong>{location.name}</strong>
                          <span>{location.address ?? "Address pending"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <WorkspaceEmptyState title="No linked locations yet" summary="Shared location history will appear here once sports jobs publish against a facility." compact />
                  )}
                </section>
                <section className="sports-detail-card">
                  <h4>Upcoming Shoots</h4>
                  {detail.upcoming_shoots.length ? (
                    <div className="sports-mini-list">
                      {detail.upcoming_shoots.map((shoot) => (
                        <button key={shoot.id} type="button" className="sports-mini-list__item sports-mini-list__item--button" onClick={() => (window.location.hash = `#sports/shoots/${shoot.id}`)}>
                          <strong>{shoot.title}</strong>
                          <span>{formatDate(shoot.shoot_date)} | {shoot.location_name ?? "Location pending"}</span>
                          <span>{humanizeToken(shoot.shoot_status)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <WorkspaceEmptyState title="No upcoming shoots" summary="Future sports jobs for this account will appear here." compact />
                  )}
                </section>
                <section className="sports-detail-card">
                  <h4>Open Escalations</h4>
                  <WatchFlagList
                    items={detail.open_escalations}
                    emptyTitle="No open escalations"
                    emptyDescription="Account-level sports issues and open escalations will appear here."
                  />
                </section>
              </div>
            ) : (
              <WorkspaceEmptyState title="Select an account" summary="Shared account context, upcoming jobs, locations, contacts, and open issues will appear here." compact />
            )}
          </DetailPreviewPanel>
        </div>
      )}
    </section>
  );
}
