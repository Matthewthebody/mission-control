import { useMemo, useState } from "react";
import type { OrganizationContact } from "../../types";
import { formatDateLabel, labelForAccountType, labelForRelationshipRole } from "./directoryOptions";

type Props = {
  contact: OrganizationContact;
  onOpenOrganization?: (organizationId: string) => void;
};

export function DirectoryRelationshipHistory({ contact, onOpenOrganization }: Props) {
  const relationships = contact.relationship_history ?? [];
  const [stateFilter, setStateFilter] = useState<"all" | "current" | "previous">("all");
  const [accountFilter, setAccountFilter] = useState<"all" | "internal" | "external">("all");

  const filteredRelationships = useMemo(
    () =>
      relationships.filter((relationship) => {
        if (stateFilter !== "all" && relationship.relationship_state !== stateFilter) {
          return false;
        }
        if (accountFilter === "internal" && relationship.organization_account_type !== "internal") {
          return false;
        }
        if (accountFilter === "external" && relationship.organization_account_type === "internal") {
          return false;
        }
        return true;
      }),
    [accountFilter, relationships, stateFilter]
  );
  const currentRelationships = filteredRelationships.filter((relationship) => relationship.relationship_state === "current");
  const previousRelationships = filteredRelationships.filter((relationship) => relationship.relationship_state === "previous");

  return (
    <section className="request-card">
      <div className="directory-card__header">
        <div>
          <strong>Relationship History</strong>
          <div className="muted">
            Show where this person works now, where they worked before, and what role they held at each organization.
          </div>
        </div>
        <div className="directory-chip-row">
          {[
            { id: "all", label: "All movement" },
            { id: "current", label: "Current only" },
            { id: "previous", label: "Previous only" }
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className={`secondary-button directory-history-filter${stateFilter === option.id ? " directory-history-filter--active" : ""}`}
              onClick={() => setStateFilter(option.id as "all" | "current" | "previous")}
            >
              {option.label}
            </button>
          ))}
          {[
            { id: "all", label: "All accounts" },
            { id: "internal", label: "Company only" },
            { id: "external", label: "Client only" }
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className={`secondary-button directory-history-filter${accountFilter === option.id ? " directory-history-filter--active" : ""}`}
              onClick={() => setAccountFilter(option.id as "all" | "internal" | "external")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!relationships.length ? (
        <div className="empty-state empty-state--panel">No relationship history is saved for this contact yet.</div>
      ) : (
        <div className="directory-history-grid">
          <article className="request-card directory-history-column">
            <div className="directory-card__header">
              <div>
                <strong>Current Organizations</strong>
                <div className="muted">Keep active school, district, league, or account relationships visible first.</div>
              </div>
            </div>
            <div className="directory-section-stack">
              {currentRelationships.map((relationship) => (
                <article key={relationship.id} className="directory-history-card">
                  <div className="directory-card__header">
                    <div>
                      <strong>{relationship.organization_display_name}</strong>
                      <div className="muted">{labelForAccountType(relationship.organization_account_type)}</div>
                    </div>
                    {onOpenOrganization ? (
                      <button type="button" className="secondary-button" onClick={() => onOpenOrganization(relationship.organization_id)}>
                        Open account
                      </button>
                    ) : null}
                  </div>
                  <div className="directory-chip-row">
                    <span className="meta-pill">{labelForRelationshipRole(relationship.relationship_role)}</span>
                    <span className="meta-pill">Current</span>
                    {relationship.is_primary ? <span className="meta-pill">Primary</span> : null}
                  </div>
                  <div className="muted">{formatRelationshipWindow(relationship.start_date, relationship.end_date, true)}</div>
                </article>
              ))}
              {!currentRelationships.length ? <div className="empty-state">No current organization relationships on file.</div> : null}
            </div>
          </article>

          <article className="request-card directory-history-column">
            <div className="directory-card__header">
              <div>
                <strong>Previous Organizations</strong>
                <div className="muted">Movement stays readable as a timeline instead of being buried in notes.</div>
              </div>
            </div>
            <div className="directory-history-list">
              {previousRelationships.map((relationship) => (
                <div key={relationship.id} className="directory-history-list__item">
                  <div className="directory-history-list__dot" />
                  <div className="directory-history-list__content">
                    <div className="directory-card__header">
                      <div>
                        <strong>{relationship.organization_display_name}</strong>
                        <div className="muted">{labelForRelationshipRole(relationship.relationship_role)} · {labelForAccountType(relationship.organization_account_type)}</div>
                      </div>
                      {onOpenOrganization ? (
                        <button type="button" className="secondary-button" onClick={() => onOpenOrganization(relationship.organization_id)}>
                          Open account
                        </button>
                      ) : null}
                    </div>
                    <div className="directory-chip-row">
                      <span className="meta-pill">Previous</span>
                      {relationship.is_primary ? <span className="meta-pill">Primary then</span> : null}
                    </div>
                    <div className="muted">{formatRelationshipWindow(relationship.start_date, relationship.end_date, false)}</div>
                  </div>
                </div>
              ))}
              {!previousRelationships.length ? <div className="empty-state">No previous organization relationships on file.</div> : null}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

function formatRelationshipWindow(startDate: string | null, endDate: string | null, isCurrent: boolean) {
  if (startDate && endDate) {
    return `${formatDateLabel(startDate)} to ${formatDateLabel(endDate)}`;
  }
  if (isCurrent && startDate) {
    return `Current since ${formatDateLabel(startDate)}`;
  }
  if (!isCurrent && endDate) {
    return `Ended ${formatDateLabel(endDate)}`;
  }
  if (startDate) {
    return `Started ${formatDateLabel(startDate)}`;
  }
  return isCurrent ? "Current relationship" : "Previous relationship";
}
