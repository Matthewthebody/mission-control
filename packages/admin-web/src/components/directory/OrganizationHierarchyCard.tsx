import type { OrganizationDetail } from "../../types";
import { labelForActiveStatus } from "./directoryOptions";

// Phase 4 Slice 5 — canonical District ↔ School hierarchy surface. Reads the hierarchy that
// the organization detail already returns (parent_organization_name on the summary,
// child_organizations on the detail) so a District shows the Schools that roll up to it and a
// School shows (and can open) its parent District. A School account with no parent District is
// flagged "Review Required" — the legacy free-text district was never reconciled to a record.

type Props = {
  detail: OrganizationDetail;
  isSchoolAccount: boolean;
  onSelectOrganization: (organizationId: string) => void;
};

export function OrganizationHierarchyCard({ detail, isSchoolAccount, onSelectOrganization }: Props) {
  const organization = detail.organization;
  const isDistrict = organization.client_entity_kind === "parent_organization";
  const children = detail.child_organizations ?? [];
  const parentId = organization.parent_organization_id ?? null;
  const parentName = organization.parent_organization_name ?? null;
  const parentlessSchool = isSchoolAccount && !isDistrict && !parentId;

  return (
    <article className="request-card organization-hierarchy-card">
      <div className="directory-card__header">
        <div>
          <strong>{isDistrict ? "District Hierarchy" : "Account Hierarchy"}</strong>
          <div className="muted">
            {isDistrict
              ? "Schools and accounts that roll up to this District in the canonical directory."
              : "Where this account sits in the canonical District → School hierarchy."}
          </div>
        </div>
        <span className="meta-pill">{isDistrict ? "Parent organization" : "Account"}</span>
      </div>

      {isDistrict ? (
        <div className="directory-section-stack">
          <div className="directory-chip-row">
            <span className="meta-pill">{children.length} linked school{children.length === 1 ? "" : "s"}</span>
          </div>
          {children.length ? (
            <ul className="organization-hierarchy-children" aria-label="Schools in this district">
              {children.map((child) => (
                <li key={child.id}>
                  <button type="button" className="directory-link-button" onClick={() => onSelectOrganization(child.id)}>
                    <span>{child.display_name}</span>
                    <span className="muted">{labelForActiveStatus(child.active_status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No schools are linked to this District yet. Attach a school by setting its Parent District.</p>
          )}
        </div>
      ) : (
        <div className="directory-section-stack">
          {parentId ? (
            <div className="directory-mini-card">
              <span className="directory-mini-card__label">Parent district</span>
              <button type="button" className="directory-link-button" onClick={() => onSelectOrganization(parentId)}>
                <span>{parentName ?? "Open parent district"}</span>
                <span className="muted">Open</span>
              </button>
            </div>
          ) : parentlessSchool ? (
            <div className="organization-hierarchy-review" role="status">
              <span className="meta-pill meta-pill--warning">Review required</span>
              <p className="muted">
                This school has no parent District in the canonical directory. Set its Parent District so it rolls up correctly — the
                legacy free-text district was never reconciled to a record.
              </p>
            </div>
          ) : (
            <p className="muted">This account is not part of a District hierarchy.</p>
          )}
        </div>
      )}
    </article>
  );
}
