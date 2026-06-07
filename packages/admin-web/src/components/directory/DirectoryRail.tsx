import { useEffect, useMemo, useState } from "react";
import type {
  DirectoryContactRoleCategory,
  DirectoryContactStatus,
  DirectoryActiveStatus,
  DirectoryDecisionInfluence,
  DirectoryContactSummary,
  DirectoryLocationSummary,
  DirectoryOperationalImportance,
  DirectoryOwnerOption,
  DirectoryRelationshipOwnershipState,
  OrganizationAccountType,
  OrganizationSummary
} from "../../types";
import {
  ACCOUNT_TYPE_OPTIONS,
  ACTIVE_STATUS_OPTIONS,
  CONTACT_ROLE_CATEGORY_OPTIONS,
  CONTACT_STATUS_OPTIONS,
  DECISION_INFLUENCE_OPTIONS,
  DIRECTORY_VIEW_OPTIONS,
  DirectoryView,
  OPERATIONAL_IMPORTANCE_OPTIONS,
  OWNERSHIP_STATE_OPTIONS,
  buildLocationAddress,
  labelForAccountType,
  labelForActiveStatus,
  labelForContactStatus,
  labelForOperationalImportance,
  labelForRelationshipRole
} from "./directoryOptions";
import { DirectoryAvatar } from "./DirectoryAvatar";

type ContactAudience = "all" | "company" | "external";

type Props = {
  view: DirectoryView;
  search: string;
  accountType: OrganizationAccountType | "all";
  activeStatus: DirectoryActiveStatus | "all";
  contactStatus: DirectoryContactStatus | "all";
  roleCategory: DirectoryContactRoleCategory | "all";
  operationalImportance: DirectoryOperationalImportance | "all";
  decisionInfluence: DirectoryDecisionInfluence | "all";
  primaryInternalOwnerUserId: string;
  relationshipOwnershipState: DirectoryRelationshipOwnershipState | "all";
  hasPhotoOnly: boolean;
  hasLogoOnly: boolean;
  needsReviewOnly: boolean;
  myContactsOnly: boolean;
  ownerOptions: DirectoryOwnerOption[];
  organizations: OrganizationSummary[];
  contacts: DirectoryContactSummary[];
  locations: DirectoryLocationSummary[];
  contactAudience: ContactAudience;
  companyDirectoryCount: number;
  externalDirectoryCount: number;
  loading: boolean;
  activeOrganizationId: string | null;
  activeContactId: string | null;
  activeLocationId: string | null;
  canManage: boolean;
  onViewChange: (view: DirectoryView) => void;
  onSearchChange: (value: string) => void;
  onAccountTypeChange: (value: OrganizationAccountType | "all") => void;
  onActiveStatusChange: (value: DirectoryActiveStatus | "all") => void;
  onContactStatusChange: (value: DirectoryContactStatus | "all") => void;
  onRoleCategoryChange: (value: DirectoryContactRoleCategory | "all") => void;
  onOperationalImportanceChange: (value: DirectoryOperationalImportance | "all") => void;
  onDecisionInfluenceChange: (value: DirectoryDecisionInfluence | "all") => void;
  onPrimaryInternalOwnerChange: (value: string) => void;
  onRelationshipOwnershipStateChange: (value: DirectoryRelationshipOwnershipState | "all") => void;
  onHasPhotoOnlyChange: (value: boolean) => void;
  onHasLogoOnlyChange: (value: boolean) => void;
  onNeedsReviewOnlyChange: (value: boolean) => void;
  onMyContactsOnlyChange: (value: boolean) => void;
  onContactAudienceChange: (value: ContactAudience) => void;
  onSelectOrganization: (organizationId: string) => void;
  onSelectContact: (contactId: string) => void;
  onSelectLocation: (locationId: string) => void;
  onImportContacts: () => void;
  onCreateOrganization: () => void;
  onCreateContact: () => void;
  onCreateLocation: () => void;
};

export function DirectoryRail({
  view,
  search,
  accountType,
  activeStatus,
  contactStatus,
  roleCategory,
  operationalImportance,
  decisionInfluence,
  primaryInternalOwnerUserId,
  relationshipOwnershipState,
  hasPhotoOnly,
  hasLogoOnly,
  needsReviewOnly,
  myContactsOnly,
  ownerOptions,
  organizations,
  contacts,
  locations,
  contactAudience,
  companyDirectoryCount,
  externalDirectoryCount,
  loading,
  activeOrganizationId,
  activeContactId,
  activeLocationId,
  canManage,
  onViewChange,
  onSearchChange,
  onAccountTypeChange,
  onActiveStatusChange,
  onContactStatusChange,
  onRoleCategoryChange,
  onOperationalImportanceChange,
  onDecisionInfluenceChange,
  onPrimaryInternalOwnerChange,
  onRelationshipOwnershipStateChange,
  onHasPhotoOnlyChange,
  onHasLogoOnlyChange,
  onNeedsReviewOnlyChange,
  onMyContactsOnlyChange,
  onContactAudienceChange,
  onSelectOrganization,
  onSelectContact,
  onSelectLocation,
  onImportContacts,
  onCreateOrganization,
  onCreateContact,
  onCreateLocation
}: Props) {
  const totalPeopleCount = companyDirectoryCount + externalDirectoryCount;
  const visibleResultCount = view === "organizations" ? organizations.length : view === "contacts" ? contacts.length : locations.length;
  const resultLabel = view === "organizations" ? "organizations" : view === "contacts" ? "contacts" : "locations";
  const activeAdvancedFilterCount = useMemo(() => {
    let count = 0;
    if (contactStatus !== "all") count += 1;
    if (roleCategory !== "all") count += 1;
    if (operationalImportance !== "all") count += 1;
    if (decisionInfluence !== "all") count += 1;
    if (primaryInternalOwnerUserId) count += 1;
    if (relationshipOwnershipState !== "all") count += 1;
    if (myContactsOnly) count += 1;
    if (needsReviewOnly) count += 1;
    if (hasPhotoOnly) count += 1;
    if (hasLogoOnly) count += 1;
    return count;
  }, [
    contactStatus,
    decisionInfluence,
    hasLogoOnly,
    hasPhotoOnly,
    myContactsOnly,
    needsReviewOnly,
    operationalImportance,
    primaryInternalOwnerUserId,
    relationshipOwnershipState,
    roleCategory
  ]);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(() => view === "contacts" && activeAdvancedFilterCount > 0);

  useEffect(() => {
    if (view !== "contacts") {
      setAdvancedFiltersOpen(false);
      return;
    }
    if (activeAdvancedFilterCount > 0) {
      setAdvancedFiltersOpen(true);
    }
  }, [activeAdvancedFilterCount, view]);

  return (
    <aside className="request-card directory-rail">
      <div className="directory-rail__header">
        <div>
          <p className="eyebrow">Directory</p>
          <h3>{headingForView(view)}</h3>
          <p className="muted">{descriptionForView(view)}</p>
        </div>
        {canManage ? (
          <div className="page-intro-actions page-intro-actions--compact">
            {view === "organizations" ? (
              <>
                <button type="button" onClick={onCreateOrganization}>
                  New organization
                </button>
                <button type="button" className="secondary-button" onClick={onCreateContact}>
                  New contact
                </button>
                <button type="button" className="secondary-button" onClick={onCreateLocation}>
                  New location
                </button>
              </>
            ) : null}
            {view === "contacts" ? (
              <>
                <button type="button" onClick={onImportContacts}>
                  Import Contacts
                </button>
                <button type="button" className="secondary-button" onClick={onCreateContact}>
                  New contact
                </button>
              </>
            ) : null}
            {view === "locations" ? (
              <>
                <button type="button" onClick={onCreateLocation}>
                  New location
                </button>
                <button type="button" className="secondary-button" onClick={onCreateContact}>
                  New contact
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="directory-rail__filters directory-rail__filters--primary">
        <label className="directory-field directory-field--wide">
          <span>Search clients, organizations, contacts, and locations</span>
          <input
            aria-label="Search directory"
            placeholder={searchPlaceholderForView(view)}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <label className="directory-field">
          <span>Account type</span>
          <select value={accountType} onChange={(event) => onAccountTypeChange(event.target.value as OrganizationAccountType | "all")}>
            {ACCOUNT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Status</span>
          <select value={activeStatus} onChange={(event) => onActiveStatusChange(event.target.value as DirectoryActiveStatus | "all")}>
            {ACTIVE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {view === "contacts" ? (
        <>
          <div className="directory-rail__advanced-toggle-row">
            <button
              type="button"
              className="secondary-button directory-rail__advanced-toggle"
              aria-expanded={advancedFiltersOpen}
              aria-controls="directory-contact-advanced-filters"
              onClick={() => setAdvancedFiltersOpen((current) => !current)}
            >
              {advancedFiltersOpen ? "Hide advanced filters" : "Show advanced filters"}
            </button>
            <span className="muted">
              {activeAdvancedFilterCount > 0
                ? `${activeAdvancedFilterCount} advanced filter${activeAdvancedFilterCount === 1 ? "" : "s"} active`
                : "Keep the rail compact until you need deeper contact targeting."}
            </span>
          </div>
          {advancedFiltersOpen ? (
            <div id="directory-contact-advanced-filters" className="directory-rail__filters directory-rail__filters--advanced">
              <label className="directory-field">
                <span>Contact state</span>
                <select value={contactStatus} onChange={(event) => onContactStatusChange(event.target.value as DirectoryContactStatus | "all")}>
                  {CONTACT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="directory-field">
                <span>Role category</span>
                <select value={roleCategory} onChange={(event) => onRoleCategoryChange(event.target.value as DirectoryContactRoleCategory | "all")}>
                  {CONTACT_ROLE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="directory-field">
                <span>Importance</span>
                <select
                  value={operationalImportance}
                  onChange={(event) => onOperationalImportanceChange(event.target.value as DirectoryOperationalImportance | "all")}
                >
                  {OPERATIONAL_IMPORTANCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="directory-field">
                <span>Influence</span>
                <select value={decisionInfluence} onChange={(event) => onDecisionInfluenceChange(event.target.value as DirectoryDecisionInfluence | "all")}>
                  {DECISION_INFLUENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="directory-field">
                <span>Primary owner</span>
                <select value={primaryInternalOwnerUserId} onChange={(event) => onPrimaryInternalOwnerChange(event.target.value)}>
                  <option value="">All owners</option>
                  {ownerOptions.map((owner) => (
                    <option key={owner.user_id} value={owner.user_id}>
                      {owner.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="directory-field">
                <span>Ownership</span>
                <select
                  value={relationshipOwnershipState}
                  onChange={(event) => onRelationshipOwnershipStateChange(event.target.value as DirectoryRelationshipOwnershipState | "all")}
                >
                  {OWNERSHIP_STATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="directory-field directory-field--checkbox">
                <input type="checkbox" checked={myContactsOnly} onChange={(event) => onMyContactsOnlyChange(event.target.checked)} />
                <span>My contacts only</span>
              </label>
              <label className="directory-field directory-field--checkbox">
                <input type="checkbox" checked={needsReviewOnly} onChange={(event) => onNeedsReviewOnlyChange(event.target.checked)} />
                <span>Needs review</span>
              </label>
              <label className="directory-field directory-field--checkbox">
                <input type="checkbox" checked={hasPhotoOnly} onChange={(event) => onHasPhotoOnlyChange(event.target.checked)} />
                <span>Has photo</span>
              </label>
              <label className="directory-field directory-field--checkbox">
                <input type="checkbox" checked={hasLogoOnly} onChange={(event) => onHasLogoOnlyChange(event.target.checked)} />
                <span>Has logo</span>
              </label>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="report-tab-row">
        {DIRECTORY_VIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={view === option.value ? "is-active" : ""}
            onClick={() => onViewChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view === "contacts" ? (
        <div className="directory-quick-filters">
          <button
            type="button"
            className={`directory-quick-filters__button${contactAudience === "all" ? " is-active" : ""}`}
            onClick={() => onContactAudienceChange("all")}
          >
            All People <span className="muted">({totalPeopleCount})</span>
          </button>
          <button
            type="button"
            className={`directory-quick-filters__button${contactAudience === "company" ? " is-active" : ""}`}
            onClick={() => onContactAudienceChange("company")}
          >
            Company Directory <span className="muted">({companyDirectoryCount})</span>
          </button>
          <button
            type="button"
            className={`directory-quick-filters__button${contactAudience === "external" ? " is-active" : ""}`}
            onClick={() => onContactAudienceChange("external")}
          >
            Client Contacts <span className="muted">({externalDirectoryCount})</span>
          </button>
        </div>
      ) : null}

      {loading ? <div className="empty-state empty-state--panel">Refreshing the directory workspace...</div> : null}

      {!loading ? (
        <div className="directory-rail__list">
          <div className="directory-rail__results">
            <strong>
              {visibleResultCount} {resultLabel}
            </strong>
            <span className="muted">
              {view === "organizations"
                ? "Organization records"
                : view === "contacts"
                  ? "Contact records"
                  : "Location records"}
            </span>
          </div>
          {view === "organizations"
            ? organizations.map((organization) => (
                <button
                  key={organization.id}
                  type="button"
                  className={`directory-rail__item${activeOrganizationId === organization.id ? " is-active" : ""}`}
                  onClick={() => onSelectOrganization(organization.id)}
                >
                  <div className="directory-rail__identity">
                    <DirectoryAvatar name={organization.display_name} imageUrl={organization.logo_url} kind="organization" size="sm" />
                    <div>
                      <strong>{organization.display_name}</strong>
                      <div className="muted">{labelForAccountType(organization.account_type)}</div>
                    </div>
                  </div>
                  <div className="directory-rail__meta">
                    <span>{organization.contact_count} contacts</span>
                    <span>{organization.location_count} locations</span>
                    <span>{labelForActiveStatus(organization.active_status)}</span>
                  </div>
                </button>
              ))
            : null}

          {view === "contacts"
            ? contacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  className={`directory-rail__item${activeContactId === contact.id ? " is-active" : ""}`}
                  onClick={() => onSelectContact(contact.id)}
                >
                  <div className="directory-rail__identity">
                    <DirectoryAvatar name={contact.full_name} imageUrl={contact.photo_url} size="sm" />
                    <div>
                      <strong>{contact.full_name}</strong>
                      <div className="muted">
                        {contact.title || "No title"} - {contact.organization_display_name}
                      </div>
                      <div className="muted directory-rail__submeta">
                        {contact.email || contact.phone || "No direct contact method on file"}
                      </div>
                    </div>
                  </div>
                  <div className="directory-rail__meta">
                    <span>{labelForRelationshipRole(contact.relationship_role)}</span>
                    <span>{labelForContactStatus(contact.contact_status ?? "active")}</span>
                    <span>{labelForOperationalImportance(contact.operational_importance ?? "normal")}</span>
                    {contact.organization_account_type === "internal" ? <span>Coworker</span> : null}
                    {contact.is_primary ? <span>Primary</span> : null}
                    {contact.ownership_state === "unassigned" ? <span>Ownerless</span> : null}
                    {contact.freshness_state === "needs_review" ? <span>Needs Review</span> : null}
                  </div>
                </button>
              ))
            : null}

          {view === "locations"
            ? locations.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  className={`directory-rail__item${activeLocationId === location.id ? " is-active" : ""}`}
                  onClick={() => onSelectLocation(location.id)}
                >
                  <strong>{location.location_name}</strong>
                  <div className="muted">
                    {location.organization_display_name} - {buildLocationAddress(location)}
                  </div>
                  <div className="directory-rail__meta">
                    <span>{labelForAccountType(location.organization_account_type)}</span>
                    <span>{labelForActiveStatus(location.active_status)}</span>
                    <span>{location.contact_links?.length ?? 0} linked</span>
                  </div>
                </button>
              ))
            : null}

          {(view === "organizations" && organizations.length === 0) ||
          (view === "contacts" && contacts.length === 0) ||
          (view === "locations" && locations.length === 0) ? (
            <div className="empty-state empty-state--panel">Nothing matches the current directory filters yet.</div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function headingForView(view: DirectoryView) {
  switch (view) {
    case "contacts":
      return "Contacts";
    case "locations":
      return "Locations";
    default:
      return "Organizations";
  }
}

function descriptionForView(view: DirectoryView) {
  switch (view) {
    case "contacts":
      return "Find a person, see who they belong to, and open the full record only when you need detail.";
    case "locations":
      return "Find a place, confirm the related organization, and open the record when location detail matters.";
    default:
      return "Find the school, sports organization, client, or account before opening the full record.";
  }
}

function searchPlaceholderForView(view: DirectoryView) {
  return "Search for a school, sports org, contact, or location...";
}
