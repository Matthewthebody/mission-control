import type { OrganizationDetail, SchoolServiceTermRecord } from "../../types";

// Phase 4 Slice F — canonical directory context for job intake. When the linked account is a
// School (or District) the operator sees the canonical hierarchy (parent District, or child
// schools for a District) and the current school-year/season service term, read from the
// canonical records by id. A School with no parent District is flagged "Review required".
// This is read-only context: the operator still resolves location/contact by canonical id in
// the pickers; the term is surfaced so required values are confirmed, not silently snapshotted.

type Props = {
  organizationDetail: OrganizationDetail | null;
  currentServiceTerm: SchoolServiceTermRecord | null;
  loadingServiceTerm: boolean;
};

function periodTypeLabel(value: SchoolServiceTermRecord["period_type"]): string {
  if (value === "school_year") return "School Year";
  if (value === "season") return "Season";
  return "Custom";
}

export function JobIntakeCanonicalContext({ organizationDetail, currentServiceTerm, loadingServiceTerm }: Props) {
  if (!organizationDetail) {
    return null;
  }
  const org = organizationDetail.organization;
  const isDistrict = org.client_entity_kind === "parent_organization";
  const isSchoolAccount = org.account_type.startsWith("schools") && !isDistrict;
  if (!isDistrict && !isSchoolAccount) {
    return null;
  }
  const parentlessSchool = isSchoolAccount && !org.parent_organization_id;

  return (
    <div className="job-intake__canonical-context" role="group" aria-label="Canonical directory context">
      <div className="job-intake__canonical-context-row">
        <span className="job-intake__canonical-context-label">Canonical hierarchy</span>
        {isDistrict ? (
          <span>
            District · {organizationDetail.child_organizations?.length ?? 0} school
            {(organizationDetail.child_organizations?.length ?? 0) === 1 ? "" : "s"} roll up
          </span>
        ) : org.parent_organization_id ? (
          <span>District: {org.parent_organization_name ?? "Linked district"}</span>
        ) : (
          <span className="job-intake__canonical-context-warning">Review required — no parent district linked</span>
        )}
      </div>
      {isSchoolAccount ? (
        <div className="job-intake__canonical-context-row">
          <span className="job-intake__canonical-context-label">Current service term</span>
          {loadingServiceTerm ? (
            <span>Loading…</span>
          ) : currentServiceTerm ? (
            <span>
              {currentServiceTerm.period_label} ({periodTypeLabel(currentServiceTerm.period_type)})
              {currentServiceTerm.confirmation_state === "unconfirmed" ? " — needs review" : ""}
            </span>
          ) : (
            <span>No current term set</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
