import type {
  DirectoryContactDetailResponse,
  DirectoryDuplicateReviewRecord,
  DirectoryRelationshipContinuityBundle,
  DirectoryRelationshipFollowUpRecord,
  DirectoryRelationshipMemoryRecord,
  DirectoryTouchpointRecord,
  DirectoryTouchpointPlan,
  OrganizationContact,
  OrganizationDetail,
  OrganizationLocation,
  OrganizationOperationsHub,
  SessionUser
} from "../../types";
import { DirectoryContinuityTab } from "./DirectoryContinuityTab";
import { DirectoryRelationshipHistory } from "./DirectoryRelationshipHistory";
import { DirectoryOperationsTab } from "./DirectoryOperationsTab";
import {
  DirectoryView,
  DirectoryWorkspaceTab,
  WORKSPACE_TAB_OPTIONS,
  buildLocationAddress,
  buildShootLabel,
  formatDateLabel,
  formatDateTimeLabel,
  labelForAccountType,
  labelForActiveStatus,
  labelForContactStatus,
  labelForDecisionInfluence,
  labelForDuplicateDecision,
  labelForFreshnessState,
  labelForOperationalImportance,
  labelForOwnershipState,
  labelForRelationshipRole,
  labelForRelationshipStrength,
  labelForRoleCategory,
  labelForSchoolRelationshipHealth,
  labelForTouchpointChannel,
  summarizeText
} from "./directoryOptions";
import { DirectoryAvatar } from "./DirectoryAvatar";
import { DirectoryRelationshipMap, type DirectoryRelationshipMapEdge, type DirectoryRelationshipMapNode } from "./DirectoryRelationshipMap";
import { SchoolDetailPanel } from "./SchoolDetailPanel";
import { CommunicationHistoryPanel } from "../CommunicationHistoryPanel";
import { PreCallContextPanel } from "../PreCallContextPanel";
import { RecordResourcesPanel } from "../RecordResourcesPanel";
import { buildLocationPreCallContext, buildOrganizationPreCallContext } from "../../services/preCallContextBuilders";
import { TeamsCommunicationPanel } from "../TeamsCommunicationPanel";
import { TeamsMeetingPanel } from "../TeamsMeetingPanel";

type Props = {
  token: string;
  currentUser: SessionUser;
  view: DirectoryView;
  detail: OrganizationDetail | null;
  contactDetail: DirectoryContactDetailResponse | null;
  loading: boolean;
  contactDetailLoading: boolean;
  error: string;
  contactDetailError: string;
  continuity: DirectoryRelationshipContinuityBundle | null;
  continuityLoading: boolean;
  continuityError: string;
  activeTab: DirectoryWorkspaceTab;
  canManage: boolean;
  canManageSchoolFoundation: boolean;
  touchpoints: DirectoryTouchpointRecord[];
  duplicateReviews: DirectoryDuplicateReviewRecord[];
  duplicateReviewsLoading: boolean;
  operationsHub: OrganizationOperationsHub | null;
  operationsHubLoading: boolean;
  selectedContactId: string | null;
  selectedLocationId: string | null;
  actionBusy: boolean;
  onTabChange: (tab: DirectoryWorkspaceTab) => void;
  onSelectContact: (contactId: string) => void;
  onSelectLocation: (locationId: string) => void;
  onSelectOrganization: (organizationId: string) => void;
  onOpenImportContacts: () => void;
  onCreateContact: () => void;
  onLinkExistingContact: () => void;
  onCreateLocation: () => void;
  onEditOrganization: () => void;
  onEditSchoolProfile: () => void;
  onEditSchoolContactCategories: (contact: OrganizationContact) => void;
  onCreateSchoolRule: () => void;
  onEditSchoolRule: (rule: NonNullable<OrganizationDetail["school_rules"]>[number]) => void;
  onCreateSchoolNote: () => void;
  onEditContact: (contact: OrganizationContact) => void;
  onToggleContactStatus: (contact: OrganizationContact) => void;
  onMakeContactPrimary: (contact: OrganizationContact) => void;
  onLogTouchpoint: (contact?: OrganizationContact | null) => void;
  onAttachContactToLocation: (contact: OrganizationContact) => void;
  onAttachContactToShoot: (contact: OrganizationContact) => void;
  onEditLocation: (location: OrganizationLocation) => void;
  onToggleLocationStatus: (location: OrganizationLocation) => void;
  onDetachContactFromLocation: (locationId: string, contactId: string) => void;
  onCreateDuplicateReview: (contact?: OrganizationContact | null) => void;
  onUpdateDuplicateReview: (
    review: DirectoryDuplicateReviewRecord,
    update: { status?: "open" | "resolved" | "dismissed"; decision?: "pending" | "keep_separate" | "merge_candidate" | "merged_later" }
  ) => void;
  onCreateTouchpointPlan: (contact?: OrganizationContact | null) => void;
  onCreateRelationshipMemory: (contact?: OrganizationContact | null) => void;
  onCreateRelationshipFollowUp: (contact?: OrganizationContact | null) => void;
  onUpdateTouchpointPlan: (
    plan: DirectoryTouchpointPlan,
    input: { status?: "planned" | "completed" | "skipped" | "cancelled"; completion_note?: string | null; skipped_reason?: string | null; cancelled_reason?: string | null }
  ) => void;
  onUpdateRelationshipMemory: (
    memory: DirectoryRelationshipMemoryRecord,
    input: { status?: "active" | "needs_review" | "archived"; last_confirmed_at?: string | null }
  ) => void;
  onUpdateRelationshipFollowUp: (
    followUp: DirectoryRelationshipFollowUpRecord,
    input: { status?: "open" | "in_progress" | "completed" | "cancelled"; resolution_note?: string | null }
  ) => void;
};

export function DirectoryWorkspace({
  token,
  currentUser,
  view,
  detail,
  contactDetail,
  loading,
  contactDetailLoading,
  error,
  contactDetailError,
  continuity,
  continuityLoading,
  continuityError,
  activeTab,
  canManage,
  canManageSchoolFoundation,
  touchpoints,
  duplicateReviews,
  duplicateReviewsLoading,
  operationsHub,
  operationsHubLoading,
  selectedContactId,
  selectedLocationId,
  actionBusy,
  onTabChange,
  onSelectContact,
  onSelectLocation,
  onSelectOrganization,
  onOpenImportContacts,
  onCreateContact,
  onLinkExistingContact,
  onCreateLocation,
  onEditOrganization,
  onEditSchoolProfile,
  onEditSchoolContactCategories,
  onCreateSchoolRule,
  onEditSchoolRule,
  onCreateSchoolNote,
  onEditContact,
  onToggleContactStatus,
  onMakeContactPrimary,
  onLogTouchpoint,
  onAttachContactToLocation,
  onAttachContactToShoot,
  onEditLocation,
  onToggleLocationStatus,
  onDetachContactFromLocation,
  onCreateDuplicateReview,
  onUpdateDuplicateReview,
  onCreateTouchpointPlan,
  onCreateRelationshipMemory,
  onCreateRelationshipFollowUp,
  onUpdateTouchpointPlan,
  onUpdateRelationshipMemory,
  onUpdateRelationshipFollowUp
}: Props) {
  const fallbackContact = detail?.contacts.find((contact) => contact.id === selectedContactId) ?? detail?.contacts[0] ?? null;
  const selectedContact =
    view === "contacts" && contactDetail && (!selectedContactId || contactDetail.contact.id === selectedContactId)
      ? contactDetail.contact
      : fallbackContact;
  const selectedLocation = detail?.locations.find((location) => location.id === selectedLocationId) ?? detail?.locations[0] ?? null;
  const contactTouchpoints =
    view === "contacts" && selectedContact
      ? contactDetail && contactDetail.contact.id === selectedContact.id
        ? contactDetail.touchpoints
        : touchpoints.filter((touchpoint) => touchpoint.contact_id === selectedContact.id)
      : [];
  const visibleTouchpoints = view === "contacts" && selectedContact ? contactTouchpoints : touchpoints;
  const selectedContactTouchpoint =
    view === "contacts"
      ? contactTouchpoints[0] ?? null
      : (selectedContact ? touchpoints.find((touchpoint) => touchpoint.contact_id === selectedContact.id) : null) ?? touchpoints[0] ?? null;
  const visibleTabs = WORKSPACE_TAB_OPTIONS.filter((tab) => canManage || tab.value !== "duplicates");

  if (loading) {
    return <div className="request-card empty-state empty-state--panel">Loading the trusted directory record...</div>;
  }

  if (error) {
    return <div className="request-card empty-state empty-state--panel">{error}</div>;
  }

  if (!detail) {
    return <div className="request-card empty-state empty-state--panel">Choose an organization or contact to open its trusted directory record.</div>;
  }

  const contactMaintenanceSignals = selectedContact?.maintenance_signals ?? [];
  const organizationMaintenanceSignals = detail.contacts.flatMap((contact) => contact.maintenance_signals ?? []).slice(0, 6);
  const groupedContacts = groupContactsByRoleCategory(detail.contacts);
  const selectedLocationContacts =
    selectedLocation?.contact_links?.length
      ? detail.contacts.filter((contact) =>
          selectedLocation.contact_links?.some((link) => link.contact_id === contact.id)
        )
      : detail.contacts.filter((contact) => contact.primary_location_id === selectedLocation?.id);
  const mapData = buildRelationshipMap({
    detail,
    view,
    selectedContact,
    selectedLocation,
    locationContacts: selectedLocationContacts
  });
  const isSchoolOrganization = view === "organizations" && isSchoolAccountType(detail.organization.account_type);
  const preciseRelatedWorkItems = buildPreciseRelatedWorkItems(operationsHub, view, selectedContact?.id ?? null, selectedLocation?.id ?? null);
  const primaryRelatedWorkItem = preciseRelatedWorkItems[0] ?? null;

  return (
    <section className="directory-workspace">
      <div className="request-card directory-workspace__hero">
        <div className="directory-workspace__hero-content">
          <DirectoryAvatar
            name={view === "contacts" && selectedContact ? selectedContact.full_name : detail.organization.display_name}
            imageUrl={view === "contacts" && selectedContact ? selectedContact.photo_url : detail.organization.logo_url}
            kind={view === "contacts" ? "contact" : "organization"}
            size="lg"
          />
          <div>
            <p className="eyebrow">
              {view === "contacts"
                ? selectedContact?.organization_id === detail.organization.id && detail.organization.account_type === "internal"
                  ? "Company Directory Record"
                  : "Contact Record"
                : view === "locations"
                  ? "Location Record"
                  : "Organization Record"}
            </p>
            <h2>{view === "contacts" && selectedContact ? selectedContact.full_name : detail.organization.display_name}</h2>
            <p className="muted">
              {view === "contacts" && selectedContact
                ? `${selectedContact.title || "No title on file"} - ${detail.organization.display_name}. Confirm who this person is, who owns the relationship, what needs follow-up, and which organization they are tied to.`
                : "Confirm the account, relationship owner, primary contacts, locations, references, and related work without turning Directory into a second project tracker."}
            </p>
          </div>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <button type="button" className="secondary-button" onClick={() => { window.location.hash = "#project-tracking"; }}>
            View in Project Tracking
          </button>
          <button type="button" className="secondary-button" onClick={() => { window.location.hash = "#needs-attention"; }}>
            Open Needs Attention
          </button>
          {canManage ? (
            <>
              {view === "contacts" ? (
                <button type="button" className="secondary-button" onClick={onOpenImportContacts}>
                  Import Contacts
                </button>
              ) : null}
              {view === "contacts" && selectedContact ? (
                <button type="button" onClick={() => onEditContact(selectedContact)}>
                  Edit contact
                </button>
              ) : (
                <button type="button" onClick={onEditOrganization}>
                  Edit organization
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => onLogTouchpoint(selectedContact)}>
                Log communication
              </button>
            </>
          ) : null}
        </div>
      </div>

      <DirectoryRelatedWorkPanel
        view={view}
        organizationName={detail.organization.display_name}
        selectedContact={selectedContact}
        selectedLocation={selectedLocation}
        operationsHub={operationsHub}
        operationsHubLoading={operationsHubLoading}
        preciseItems={preciseRelatedWorkItems}
        primaryItem={primaryRelatedWorkItem}
        onOpenOrganization={() => onSelectOrganization(detail.organization.id)}
        onOpenOperations={() => onTabChange("operations")}
      />

      {view === "contacts" && contactDetailError ? (
        <div className="feedback-strip feedback-strip--warning">
          <div className="feedback-strip__content">
            <strong>Full contact detail is temporarily unavailable</strong>
            <div>{contactDetailError}</div>
          </div>
        </div>
      ) : null}

      {view === "contacts" && contactMaintenanceSignals.length ? (
        <section className="directory-signal-strip">
          {contactMaintenanceSignals.map((signal) => (
            <article
              key={signal.code}
              className={`request-card directory-signal-card directory-signal-card--${signal.severity === "critical" ? "critical" : signal.severity === "warning" ? "warning" : "info"}`}
            >
              <strong>{signal.label}</strong>
              <p>{signal.detail}</p>
            </article>
          ))}
        </section>
      ) : null}

      {view !== "contacts" && organizationMaintenanceSignals.length ? (
        <section className="directory-signal-strip">
          {organizationMaintenanceSignals.slice(0, 3).map((signal, index) => (
            <article
              key={`${signal.code}-${index}`}
              className={`request-card directory-signal-card directory-signal-card--${signal.severity === "critical" ? "critical" : signal.severity === "warning" ? "warning" : "info"}`}
            >
              <strong>{signal.label}</strong>
              <p>{signal.detail}</p>
            </article>
          ))}
        </section>
      ) : null}

      {view === "organizations" ? (
        <RecordResourcesPanel
          token={token}
          objectType="organization"
          objectId={detail.organization.id}
          summary="Keep SOPs, contracts, setup references, and support documents attached to the organization record."
        />
      ) : null}

      {view === "organizations" ? (
        <TeamsCommunicationPanel
          token={token}
          currentUser={currentUser}
          objectType="organization"
          objectId={detail.organization.id}
          title="Organization Teams Messaging"
          summary="Open the linked Teams destination or send a short internal update tied to this organization relationship."
        />
      ) : null}

      {view === "organizations" ? (
        <TeamsMeetingPanel
          token={token}
          currentUser={currentUser}
          objectType="organization"
          objectId={detail.organization.id}
          title="Organization Teams Meeting"
          summary="Create or join the internal Teams meeting linked to this organization when planning needs a live handoff."
          renderPreCallContext={(meetingView) => (
            <PreCallContextPanel
              token={token}
              definition={buildOrganizationPreCallContext(detail, touchpoints, meetingView)}
            />
          )}
        />
      ) : null}

      {view === "organizations" ? (
        <CommunicationHistoryPanel
          token={token}
          currentUser={currentUser}
          objectType="organization"
          objectId={detail.organization.id}
          title="Organization Communication History"
          summary="Show the latest Teams messaging and meeting metadata tied to this organization without mixing it into client-facing touchpoint history."
        />
      ) : null}

      {view === "locations" && selectedLocation ? (
        <RecordResourcesPanel
          token={token}
          objectType="location"
          objectId={selectedLocation.id}
          title="Location Resources"
          summary="Keep room references, access photos, site notes, and support documents attached to the focused location."
        />
      ) : null}

      {view === "locations" && selectedLocation ? (
        <TeamsCommunicationPanel
          token={token}
          currentUser={currentUser}
          objectType="location"
          objectId={selectedLocation.id}
          title="Location Teams Messaging"
          summary="Open the linked Teams destination or send a short internal update tied to this location's day-of context."
        />
      ) : null}

      {view === "locations" && selectedLocation ? (
        <TeamsMeetingPanel
          token={token}
          currentUser={currentUser}
          objectType="location"
          objectId={selectedLocation.id}
          title="Location Teams Meeting"
          summary="Start or join a Teams call tied to this location when site access, setup, or room coordination needs a quick handoff."
          renderPreCallContext={(meetingView) => (
            <PreCallContextPanel
              token={token}
              definition={buildLocationPreCallContext(detail, selectedLocation, selectedLocationContacts, meetingView)}
            />
          )}
        />
      ) : null}

      {view === "locations" && selectedLocation ? (
        <CommunicationHistoryPanel
          token={token}
          currentUser={currentUser}
          objectType="location"
          objectId={selectedLocation.id}
          title="Location Communication History"
          summary="Show the latest Teams message and meeting metadata tied to this location so room-level coordination stays visible on the record."
        />
      ) : null}

      {view === "contacts" && selectedContact ? (
        <div className="metrics-grid metrics-grid--compact">
          <article className="metric-card">
            <div className="metric-card__label">Operational Role</div>
            <strong className="metric-card__value">{labelForRoleCategory(selectedContact.role_category)}</strong>
            <div className="muted">{labelForRelationshipRole(selectedContact.relationship_role)}{selectedContact.is_primary ? " - Primary account contact" : ""}</div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Importance & Influence</div>
            <strong className="metric-card__value">{labelForOperationalImportance(selectedContact.operational_importance)}</strong>
            <div className="muted">{labelForDecisionInfluence(selectedContact.decision_influence)}</div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Relationship Owner</div>
            <strong className="metric-card__value">{selectedContact.primary_internal_owner?.full_name ?? "Unassigned"}</strong>
            <div className="muted">
              {selectedContact.backup_internal_owner?.full_name
                ? `Backup: ${selectedContact.backup_internal_owner.full_name}`
                : "No backup owner yet"}
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Freshness</div>
            <strong className="metric-card__value">{labelForFreshnessState(selectedContact.freshness_state)}</strong>
            <div className="muted">
              {selectedContact.last_confirmed_at ? `Last confirmed ${formatDateLabel(selectedContact.last_confirmed_at)}` : "No confirmed date yet"}
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Direct Contact</div>
            <strong className="metric-card__value">{selectedContact.email || selectedContact.phone || "Needs update"}</strong>
            <div className="muted">{selectedContact.phone && selectedContact.email ? selectedContact.phone : selectedContact.email || "Add a direct method in edit contact"}</div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Who Knows Them</div>
            <strong className="metric-card__value">
              {selectedContact.strongest_internal_relationship?.full_name ?? selectedContact.last_spoke_with?.full_name ?? "Not visible yet"}
            </strong>
            <div className="muted">
              {selectedContact.last_spoke_with?.last_interaction_at
                ? `Last meaningful interaction ${formatDateLabel(selectedContact.last_spoke_with.last_interaction_at)}`
                : contactDetailLoading
                  ? "Refreshing touchpoint history for this person..."
                  : "No confirmed internal relationship yet."}
            </div>
          </article>
        </div>
      ) : (
        <div className="metrics-grid metrics-grid--compact">
          <article className="metric-card">
            <div className="metric-card__label">{isSchoolOrganization ? "District" : "Account Type"}</div>
            <strong className="metric-card__value">
              {isSchoolOrganization ? detail.school_profile?.district_name || "Not set" : labelForAccountType(detail.organization.account_type)}
            </strong>
            <div className="muted">
              {isSchoolOrganization
                ? detail.school_profile?.school_type || labelForActiveStatus(detail.organization.active_status)
                : labelForActiveStatus(detail.organization.active_status)}
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">{isSchoolOrganization ? "School Year" : "Contacts"}</div>
            <strong className="metric-card__value">
              {isSchoolOrganization ? detail.school_profile?.school_year_label || "Not set" : detail.contacts.length}
            </strong>
            <div className="muted">
              {isSchoolOrganization
                ? `${detail.contacts.filter((contact) => (contact.school_contact_categories?.length ?? 0) > 0).length} categorized contacts`
                : `${detail.contacts.filter((contact) => contact.is_primary).length} primary relationships`}
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">{isSchoolOrganization ? "School Health" : "Locations"}</div>
            <strong className="metric-card__value">
              {isSchoolOrganization
                ? detail.school_profile
                  ? labelForSchoolRelationshipHealth(detail.school_profile.relationship_health_state)
                  : "unknown"
                : detail.locations.length}
            </strong>
            <div className="muted">
              {isSchoolOrganization
                ? detail.school_profile?.relationship_summary || "No health summary saved"
                : `${detail.locations.filter((location) => location.active_status === "active").length} active locations`}
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">{isSchoolOrganization ? "School Rules" : "Communications"}</div>
            <strong className="metric-card__value">{isSchoolOrganization ? detail.school_rules?.length ?? 0 : touchpoints.length}</strong>
            <div className="muted">
              {isSchoolOrganization
                ? `${detail.school_activity?.length ?? 0} timeline entries`
                : detail.next_shoot
                  ? `Next shoot ${formatDateLabel(detail.next_shoot.shoot_date)}`
                  : "No next shoot linked"}
            </div>
          </article>
        </div>
      )}

      <div className="report-tab-row">
        {visibleTabs.map((tab) => (
          <button key={tab.value} type="button" className={activeTab === tab.value ? "is-active" : ""} onClick={() => onTabChange(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" ? (
        <div className="detail-grid">
          {view === "contacts" && selectedContact ? (
            <>
              <article className="request-card">
                <div className="directory-card__header">
                  <div>
                    <strong>Contact Record</strong>
                    <div className="muted">Operational identity, ownership, and the fastest path to the right person.</div>
                  </div>
                </div>
                <div className="directory-profile-media">
                  <DirectoryAvatar name={selectedContact.full_name} imageUrl={selectedContact.photo_url} size="md" />
                  <div>
                    <strong>{selectedContact.preferred_name || selectedContact.full_name}</strong>
                    <div className="muted">{selectedContact.title || "No title on file"}</div>
                    <div className="muted">{selectedContact.department_program || detail.organization.display_name}</div>
                  </div>
                </div>
                <div className="directory-chip-row">
                  <span className="meta-pill">{labelForContactStatus(selectedContact.contact_status)}</span>
                  <span className="meta-pill">{labelForOperationalImportance(selectedContact.operational_importance)}</span>
                  <span className="meta-pill">{labelForDecisionInfluence(selectedContact.decision_influence)}</span>
                  <span className="meta-pill">{labelForOwnershipState(selectedContact.ownership_state)}</span>
                  <span className="meta-pill">{labelForRelationshipStrength(selectedContact.relationship_strength)}</span>
                </div>
                <p>{summarizeText(selectedContact.notes, "No operational note is saved for this contact yet.")}</p>
                <div className="directory-card-grid">
                  <div className="directory-mini-card">
                    <span className="directory-mini-card__label">Primary owner</span>
                    <strong>{selectedContact.primary_internal_owner?.full_name ?? "Unassigned"}</strong>
                  </div>
                  <div className="directory-mini-card">
                    <span className="directory-mini-card__label">Backup owner</span>
                    <strong>{selectedContact.backup_internal_owner?.full_name ?? "None assigned"}</strong>
                  </div>
                  <div className="directory-mini-card">
                    <span className="directory-mini-card__label">Last confirmed</span>
                    <strong>{selectedContact.last_confirmed_at ? formatDateLabel(selectedContact.last_confirmed_at) : "Not confirmed"}</strong>
                  </div>
                </div>
              </article>

              <article className="request-card">
                <div className="directory-card__header">
                  <div>
                    <strong>Who Knows Who</strong>
                    <div className="muted">Surface who owns the relationship, who else has recent context, and where backup is missing.</div>
                  </div>
                </div>
                <div className="directory-card-grid">
                  <div className="directory-mini-card">
                    <span className="directory-mini-card__label">Strongest internal relationship</span>
                    <strong>{selectedContact.strongest_internal_relationship?.full_name ?? "Not captured yet"}</strong>
                  </div>
                  <div className="directory-mini-card">
                    <span className="directory-mini-card__label">Last spoke with</span>
                    <strong>{selectedContact.last_spoke_with?.full_name ?? "No recent owner touchpoint"}</strong>
                  </div>
                  <div className="directory-mini-card">
                    <span className="directory-mini-card__label">Freshness</span>
                    <strong>{labelForFreshnessState(selectedContact.freshness_state)}</strong>
                  </div>
                </div>
                {selectedContact.additional_internal_connected_staff?.length ? (
                  <div className="directory-chip-row">
                    {selectedContact.additional_internal_connected_staff.slice(0, 5).map((connection) => (
                      <span key={connection.user_id} className="meta-pill">
                        {connection.full_name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No additional internal relationship context is captured yet.</p>
                )}
              </article>
            </>
          ) : (
            <>
              {isSchoolOrganization ? (
                <SchoolDetailPanel
                  detail={detail}
                  canManageSchoolFoundation={canManageSchoolFoundation}
                  actionBusy={actionBusy}
                  selectedContactId={selectedContactId}
                  onSelectContact={onSelectContact}
                  onEditContact={onEditContact}
                  onEditSchoolProfile={onEditSchoolProfile}
                  onEditSchoolContactCategories={onEditSchoolContactCategories}
                  onCreateSchoolRule={onCreateSchoolRule}
                  onEditSchoolRule={onEditSchoolRule}
                  onCreateSchoolNote={onCreateSchoolNote}
                />
              ) : (
                <>
                  <article className="request-card">
                    <div className="directory-card__header">
                      <div>
                        <strong>{view === "locations" ? "Location Snapshot" : "Organization Snapshot"}</strong>
                        <div className="muted">
                          {view === "locations"
                            ? "Keep the location context, top operational contacts, and memory cues easy to scan."
                            : "Keep the summary short, then let deeper work happen in tabs."}
                        </div>
                      </div>
                    </div>
                    {detail.organization.logo_url ? (
                      <div className="directory-profile-media">
                        <DirectoryAvatar name={detail.organization.display_name} imageUrl={detail.organization.logo_url} kind="organization" size="md" />
                        <div className="muted">Brand image or logo linked for this organization.</div>
                      </div>
                    ) : null}
                    {view === "locations" && selectedLocation ? (
                      <>
                        <div className="directory-chip-row">
                          <span className="meta-pill">{selectedLocation.location_name}</span>
                          <span className="meta-pill">{buildLocationAddress(selectedLocation)}</span>
                          <span className="meta-pill">{selectedLocationContacts.length} mapped contacts</span>
                        </div>
                        <p>{summarizeText(selectedLocation.notes, "No location operating note is saved yet.")}</p>
                      </>
                    ) : (
                      <>
                        <div className="directory-chip-row">
                          {detail.organization.aliases.map((alias) => (
                            <span key={alias} className="meta-pill">
                              {alias}
                            </span>
                          ))}
                          {!detail.organization.aliases.length ? <span className="meta-pill">No aliases</span> : null}
                        </div>
                        <p>{summarizeText(detail.organization.notes, "No team note is saved for this organization yet.")}</p>
                      </>
                    )}
                  </article>

                  <article className="request-card">
                    <div className="directory-card__header">
                      <div>
                        <strong>Relationship Risk</strong>
                        <div className="muted">Keep stale, ownerless, or high-importance contacts visible before they become day-of surprises.</div>
                      </div>
                    </div>
                    <div className="directory-card-grid">
                      <div className="directory-mini-card">
                        <span className="directory-mini-card__label">Critical contacts</span>
                        <strong>{detail.contacts.filter((contact) => contact.operational_importance === "critical").length}</strong>
                      </div>
                      <div className="directory-mini-card">
                        <span className="directory-mini-card__label">Needs review</span>
                        <strong>{detail.contacts.filter((contact) => contact.freshness_state === "needs_review").length}</strong>
                      </div>
                      <div className="directory-mini-card">
                        <span className="directory-mini-card__label">Ownerless or stale</span>
                        <strong>{detail.contacts.filter((contact) => (contact.maintenance_signals ?? []).length > 0).length}</strong>
                      </div>
                    </div>
                  </article>
                </>
              )}
            </>
          )}
        </div>
      ) : null}

      {activeTab === "relationships" ? (
        <div className="directory-section-stack">
          {view === "contacts" && selectedContact ? (
            <DirectoryRelationshipHistory contact={selectedContact} onOpenOrganization={onSelectOrganization} />
          ) : null}

          <DirectoryRelationshipMap
            title={view === "contacts" ? "Relationship Map View" : view === "locations" ? "Location Relationship Map" : "Organization Relationship Map"}
            subtitle={
              view === "contacts"
                ? "Use the contact-first view to see who owns the relationship, which location they support, and how the account is structured."
                : "Keep district, school, contact, and owner structure visually understandable without pretending every reporting line is perfectly known."
            }
            nodes={mapData.nodes}
            edges={mapData.edges}
          />

          <section className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>{view === "locations" ? "Location Role Sections" : "Organization Role Sections"}</strong>
                <div className="muted">
                  Group contacts by the job they actually perform so crews can tell who to call for what without tribal knowledge.
                </div>
              </div>
            </div>
            <div className="directory-card-grid">
              {(view === "locations" ? groupContactsByRoleCategory(selectedLocationContacts) : groupedContacts)
                .slice(0, 6)
                .map(([role, contactsForRole]) => (
                  <article key={role} className="directory-mini-card">
                    <span className="directory-mini-card__label">{labelForRoleCategory(role)}</span>
                    <strong>{contactsForRole[0]?.full_name ?? "No contact assigned"}</strong>
                    <div className="muted">
                      {contactsForRole.length > 1 ? `${contactsForRole.length} contacts in this group` : contactsForRole[0]?.title || "Needs owner coverage"}
                    </div>
                  </article>
                ))}
              {!(view === "locations" ? selectedLocationContacts.length : detail.contacts.length) ? (
                <div className="empty-state empty-state--panel">No grouped role coverage is available yet.</div>
              ) : null}
            </div>
          </section>

          <section className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>Contacts</strong>
                <div className="muted">Make actions obvious: edit, touchpoint, attach, and primary ownership are first-class.</div>
              </div>
              {canManage ? (
                <div className="page-intro-actions page-intro-actions--compact">
                  <button type="button" onClick={onCreateContact}>
                    New contact
                  </button>
                  <button type="button" className="secondary-button" onClick={onLinkExistingContact}>
                    Link existing contact
                  </button>
                </div>
              ) : null}
            </div>

            <div className="directory-card-grid">
              {detail.contacts.map((contact) => (
                <article key={contact.id} className={`request-card directory-entity-card${selectedContact?.id === contact.id ? " is-selected" : ""}`}>
                  <div className="directory-card__header">
                    <div className="directory-card__identity">
                      <DirectoryAvatar name={contact.full_name} imageUrl={contact.photo_url} size="md" />
                      <div>
                        <strong>{contact.full_name}</strong>
                        <div className="muted">{contact.title || "No title"}{contact.email ? ` - ${contact.email}` : ""}</div>
                        <div className="muted">{contact.phone || "No phone on file"}</div>
                      </div>
                    </div>
                    <button type="button" className="secondary-button" onClick={() => onSelectContact(contact.id)}>
                      {selectedContact?.id === contact.id ? "Focused" : "Focus"}
                    </button>
                  </div>
                  <div className="directory-chip-row">
                    <span className="meta-pill">{labelForRelationshipRole(contact.relationship_role)}</span>
                    <span className="meta-pill">{labelForRoleCategory(contact.role_category)}</span>
                    <span className="meta-pill">{labelForOperationalImportance(contact.operational_importance)}</span>
                    <span className="meta-pill">{labelForContactStatus(contact.contact_status)}</span>
                    {detail.organization.account_type === "internal" ? <span className="meta-pill">Coworker</span> : null}
                    {contact.is_primary ? <span className="meta-pill">Primary</span> : null}
                    {contact.ownership_state ? <span className="meta-pill">{labelForOwnershipState(contact.ownership_state)}</span> : null}
                  </div>
                  <p>{summarizeText(contact.notes, "No contact note saved yet.")}</p>
                  <div className="directory-card-grid">
                    <div className="directory-mini-card">
                      <span className="directory-mini-card__label">Primary owner</span>
                      <strong>{contact.primary_internal_owner?.full_name ?? "Unassigned"}</strong>
                    </div>
                    <div className="directory-mini-card">
                      <span className="directory-mini-card__label">Backup owner</span>
                      <strong>{contact.backup_internal_owner?.full_name ?? "No backup owner"}</strong>
                    </div>
                    <div className="directory-mini-card">
                      <span className="directory-mini-card__label">Freshness</span>
                      <strong>{labelForFreshnessState(contact.freshness_state)}</strong>
                    </div>
                  </div>
                  {canManage ? (
                    <div className="request-card__actions">
                      <button type="button" className="secondary-button" onClick={() => onEditContact(contact)} disabled={actionBusy}>
                        Edit {contact.full_name}
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onLogTouchpoint(contact)} disabled={actionBusy}>
                        Log communication for {contact.full_name}
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onAttachContactToLocation(contact)} disabled={actionBusy}>
                        Attach {contact.full_name} to a location
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onAttachContactToShoot(contact)} disabled={actionBusy}>
                        Attach {contact.full_name} to a shoot
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onMakeContactPrimary(contact)} disabled={actionBusy}>
                        Mark {contact.full_name} primary
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onToggleContactStatus(contact)} disabled={actionBusy}>
                        {contact.active_status === "active" ? `Archive ${contact.full_name}` : `Reactivate ${contact.full_name}`}
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onCreateDuplicateReview(contact)} disabled={actionBusy}>
                        Review duplicate for {contact.full_name}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>Locations</strong>
                <div className="muted">Attach contacts at the relationship layer so day-of ownership is visible and maintainable.</div>
              </div>
              {canManage ? (
                <div className="page-intro-actions page-intro-actions--compact">
                  <button type="button" onClick={onCreateLocation}>
                    New location
                  </button>
                  {selectedContact ? (
                    <button type="button" className="secondary-button" onClick={() => onAttachContactToLocation(selectedContact)}>
                      Link {selectedContact.full_name}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="directory-card-grid">
              {detail.locations.map((location) => (
                <article key={location.id} className={`request-card directory-entity-card${selectedLocation?.id === location.id ? " is-selected" : ""}`}>
                  <div className="directory-card__header">
                    <div>
                      <strong>{location.location_name}</strong>
                      <div className="muted">{buildLocationAddress(location)}</div>
                    </div>
                    <button type="button" className="secondary-button" onClick={() => onSelectLocation(location.id)}>
                      {selectedLocation?.id === location.id ? "Focused" : "Focus"}
                    </button>
                  </div>
                  <div className="directory-chip-row">
                    <span className="meta-pill">{labelForActiveStatus(location.active_status)}</span>
                    <span className="meta-pill">{location.contact_links?.length ?? 0} linked contacts</span>
                  </div>
                  <p>{summarizeText(location.notes, "No location note saved yet.")}</p>
                  <div className="directory-link-list">
                    {(location.contact_links ?? []).map((link) => (
                      <div key={`${location.id}-${link.contact_id}`} className="directory-link-row">
                        <div>
                          <strong>{link.full_name}</strong>
                          <div className="muted">
                            {labelForRelationshipRole(link.relationship_role)}
                            {link.is_primary ? " - Primary" : ""}
                          </div>
                        </div>
                        {canManage ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => onDetachContactFromLocation(location.id, link.contact_id)}
                            disabled={actionBusy}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {!location.contact_links?.length ? <div className="empty-state">No contacts linked to this location yet.</div> : null}
                  </div>
                  {canManage ? (
                    <div className="request-card__actions">
                      <button type="button" className="secondary-button" onClick={() => onEditLocation(location)} disabled={actionBusy}>
                        Edit {location.location_name}
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onToggleLocationStatus(location)} disabled={actionBusy}>
                        {location.active_status === "active" ? `Archive ${location.location_name}` : `Reactivate ${location.location_name}`}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "operations" ? (
        operationsHubLoading ? (
          <div className="request-card empty-state empty-state--panel">Loading the operations summary...</div>
        ) : (
          <DirectoryOperationsTab
            operationsHub={operationsHub}
            canManage={canManage}
            onLogTouchpoint={() => onLogTouchpoint(selectedContact)}
            onCreateContact={onCreateContact}
            onLinkExistingContact={onLinkExistingContact}
          />
        )
      ) : null}

      {activeTab === "touchpoints" ? (
        <DirectoryContinuityTab
          view={view}
          selectedContact={selectedContact}
          continuity={continuity}
          continuityLoading={continuityLoading}
          continuityError={continuityError}
          canManage={canManage}
          onLogCommunication={() => onLogTouchpoint(selectedContact)}
          onCreateTouchpointPlan={() => onCreateTouchpointPlan(selectedContact)}
          onCreateFollowUp={() => onCreateRelationshipFollowUp(selectedContact)}
          onCreateMemory={() => onCreateRelationshipMemory(selectedContact)}
          onUpdateTouchpointPlan={onUpdateTouchpointPlan}
          onUpdateFollowUp={onUpdateRelationshipFollowUp}
          onUpdateMemory={onUpdateRelationshipMemory}
        />
      ) : null}

      {activeTab === "linked_shoots" ? (
        <section className="request-card">
          <div className="directory-card__header">
            <div>
              <strong>Linked Shoots</strong>
              <div className="muted">
                {selectedContact
                  ? `Use the focused contact to attach day-of ownership to a shoot without leaving the directory.`
                  : "Pick a contact in Relationships first, then attach that person to the right shoot."}
              </div>
            </div>
            {canManage && selectedContact ? (
              <button type="button" onClick={() => onAttachContactToShoot(selectedContact)}>
                Attach {selectedContact.full_name} to a shoot
              </button>
            ) : null}
          </div>
          <div className="directory-card-grid">
            {detail.next_shoot ? (
              <article className="request-card directory-entity-card">
                <strong>Upcoming shoot</strong>
                <p>{buildShootLabel(detail.next_shoot)}</p>
              </article>
            ) : null}
            {detail.recent_shoots.map((shoot) => (
              <article key={shoot.id} className="request-card directory-entity-card">
                <strong>{shoot.title}</strong>
                <div className="muted">{buildShootLabel(shoot)}</div>
              </article>
            ))}
            {!detail.next_shoot && !detail.recent_shoots.length ? (
              <div className="empty-state empty-state--panel">No linked shoots are available for this organization yet.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === "duplicates" ? (
        duplicateReviewsLoading ? (
          <div className="request-card empty-state empty-state--panel">Loading duplicate review coverage...</div>
        ) : (
          <section className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>Duplicate Reviews</strong>
                <div className="muted">This phase ships safe review scaffolding only. Merge execution still stays out of the UI until the backend path is safer.</div>
              </div>
              {canManage ? (
                <button type="button" onClick={() => onCreateDuplicateReview(selectedContact)}>
                  Create duplicate review
                </button>
              ) : null}
            </div>
            <div className="directory-section-stack">
              {duplicateReviews.map((review) => (
                <article key={review.id} className="request-card">
                  <div className="directory-card__header">
                    <div>
                      <strong>{review.primary_contact_name || "Unknown"} vs {review.suspected_duplicate_contact_name || "Unknown"}</strong>
                      <div className="muted">Opened {formatDateTimeLabel(review.created_at)}</div>
                    </div>
                    <div className="directory-chip-row">
                      <span className="meta-pill">{review.status}</span>
                      <span className="meta-pill">{labelForDuplicateDecision(review.decision)}</span>
                    </div>
                  </div>
                  <p>{review.summary}</p>
                  {review.notes ? <p className="muted">{review.notes}</p> : null}
                  {canManage ? (
                    <div className="request-card__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onUpdateDuplicateReview(review, { status: "resolved", decision: "keep_separate" })}
                        disabled={actionBusy}
                      >
                        Keep separate
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onUpdateDuplicateReview(review, { status: "resolved", decision: "merge_candidate" })}
                        disabled={actionBusy}
                      >
                        Mark merge candidate
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onUpdateDuplicateReview(review, { status: "dismissed", decision: review.decision })}
                        disabled={actionBusy}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
              {!duplicateReviews.length ? <div className="empty-state empty-state--panel">No duplicate reviews are open for this organization right now.</div> : null}
            </div>
          </section>
        )
      ) : null}
    </section>
  );
}

type DirectoryRelatedWorkItem = {
  id: string;
  title: string;
  summary: string;
  ownerLabel: string;
  dueLabel: string | null;
  actionHash: string;
  tone: OrganizationOperationsHub["queues"]["projects"]["items"][number]["tone"];
  sourceLabel: string;
};

function DirectoryRelatedWorkPanel({
  view,
  organizationName,
  selectedContact,
  selectedLocation,
  operationsHub,
  operationsHubLoading,
  preciseItems,
  primaryItem,
  onOpenOrganization,
  onOpenOperations
}: {
  view: DirectoryView;
  organizationName: string;
  selectedContact: OrganizationContact | null;
  selectedLocation: OrganizationLocation | null;
  operationsHub: OrganizationOperationsHub | null;
  operationsHubLoading: boolean;
  preciseItems: DirectoryRelatedWorkItem[];
  primaryItem: DirectoryRelatedWorkItem | null;
  onOpenOrganization: () => void;
  onOpenOperations: () => void;
}) {
  const hasLoadedOperations = Boolean(operationsHub);
  const heading =
    view === "contacts"
      ? "Relationship Context"
      : view === "locations"
        ? "Location Work Links"
        : "Related Work Links";
  const summary =
    view === "contacts"
      ? "Directory owns the person and relationship. Project Tracking owns active work, next owners, due dates, blockers, and recent changes."
      : view === "locations"
        ? "Directory owns the place and setup context. Only open exact work when the existing record exposes a real link."
        : "Directory owns the account record. Open exact linked work only when the existing operations data provides a real route.";

  return (
    <section className="request-card directory-related-work" aria-label="Directory related work links">
      <div className="directory-card__header">
        <div>
          <strong>{heading}</strong>
          <div className="muted">{summary}</div>
        </div>
        <div className="page-intro-actions page-intro-actions--compact">
          <button type="button" className="secondary-button" onClick={() => { window.location.hash = "#project-tracking"; }}>
            Open Project Tracking
          </button>
          {view !== "organizations" ? (
            <button type="button" className="secondary-button" onClick={onOpenOrganization}>
              Open organization
            </button>
          ) : null}
        </div>
      </div>

      {operationsHubLoading ? (
        <div className="empty-state empty-state--panel">Checking existing related-work links...</div>
      ) : preciseItems.length ? (
        <div className="directory-related-work__grid">
          {preciseItems.map((item) => (
            <article key={`${item.sourceLabel}:${item.id}`} className={`directory-related-work-card directory-related-work-card--${item.tone}`}>
              <div>
                <span className="meta-pill">{item.sourceLabel}</span>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
              </div>
              <div className="directory-related-work-card__meta">
                <span>{item.ownerLabel}</span>
                {item.dueLabel ? <span>{item.dueLabel}</span> : null}
              </div>
              <button type="button" className="secondary-button" onClick={() => { window.location.hash = item.actionHash; }}>
                {item.actionHash.startsWith("#project-tracking/workflows/") ? "Open in Project Tracking" : "Open related work"}
              </button>
            </article>
          ))}
        </div>
      ) : view === "contacts" ? (
        <div className="directory-related-work__honest-state">
          <strong>Connected organization: {organizationName}</strong>
          <p>
            {selectedContact
              ? `${selectedContact.full_name} does not have a direct work link in this Directory record yet. Use the organization record for shared work context.`
              : "This contact record does not expose a direct work link yet."}
          </p>
          {primaryItem ? (
            <button type="button" className="secondary-button" onClick={() => { window.location.hash = primaryItem.actionHash; }}>
              View organization work
            </button>
          ) : null}
        </div>
      ) : view === "locations" ? (
        <div className="directory-related-work__honest-state">
          <strong>{selectedLocation?.location_name ?? "Location"} stays directory-focused</strong>
          <p>No direct work link is available from this location record yet. Open the organization or Project Tracking for the full work spine.</p>
        </div>
      ) : hasLoadedOperations ? (
        <div className="directory-related-work__honest-state">
          <strong>No direct work link yet</strong>
          <p>No precise related-work route is available from this organization record right now. Project Tracking remains the full work spine.</p>
        </div>
      ) : (
        <div className="directory-related-work__honest-state">
          <strong>Related work loads from Operations</strong>
          <p>Open the Operations tab to check existing project, follow-up, and review links for this organization. No active-work count is assumed here.</p>
          <button type="button" className="secondary-button" onClick={onOpenOperations}>
            Open Operations tab
          </button>
        </div>
      )}
    </section>
  );
}

function buildPreciseRelatedWorkItems(
  operationsHub: OrganizationOperationsHub | null,
  view: DirectoryView,
  contactId: string | null,
  locationId: string | null
): DirectoryRelatedWorkItem[] {
  if (!operationsHub) {
    return [];
  }

  const projectItems = operationsHub.queues.projects.items
    .filter((item) => {
      if (view === "contacts") {
        return Boolean(contactId && item.related_contact_id === contactId);
      }
      if (view === "locations") {
        return Boolean(locationId && item.related_location_id === locationId);
      }
      return true;
    })
    .map((item): DirectoryRelatedWorkItem => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      ownerLabel: item.owner_label,
      dueLabel: item.due_label,
      actionHash: item.action_hash,
      tone: item.tone,
      sourceLabel: item.action_hash.startsWith("#project-tracking/workflows/") ? "Project Tracking" : "Linked production"
    }));

  const timelineItems = operationsHub.timeline
    .filter((item) => item.kind === "project" && item.action_hash)
    .filter((item) => {
      if (view === "contacts") {
        return Boolean(contactId && item.related_contact_id === contactId);
      }
      if (view === "locations") {
        return Boolean(locationId && item.related_location_id === locationId);
      }
      return true;
    })
    .map((item): DirectoryRelatedWorkItem => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      ownerLabel: item.owner_label,
      dueLabel: item.due_label,
      actionHash: item.action_hash ?? "#project-tracking",
      tone: item.tone,
      sourceLabel: item.action_hash?.startsWith("#project-tracking/workflows/") ? "Project Tracking" : "Linked production"
    }));

  const seen = new Set<string>();
  return [...projectItems, ...timelineItems]
    .filter((item) => {
      const key = `${item.actionHash}:${item.title}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function isSchoolAccountType(accountType: OrganizationDetail["organization"]["account_type"]) {
  return accountType === "schools_underclass_portraits" || accountType === "schools_events";
}

function groupContactsByRoleCategory(contacts: OrganizationContact[]) {
  const groups = new Map<NonNullable<OrganizationContact["role_category"]> | "other", OrganizationContact[]>();
  for (const contact of contacts) {
    const key = contact.role_category ?? "other";
    const list = groups.get(key) ?? [];
    list.push(contact);
    groups.set(key, list);
  }
  return [...groups.entries()].sort((left, right) => right[1].length - left[1].length);
}

function buildRelationshipMap(input: {
  detail: OrganizationDetail;
  view: DirectoryView;
  selectedContact: OrganizationContact | null;
  selectedLocation: OrganizationLocation | null;
  locationContacts: OrganizationContact[];
}): { nodes: DirectoryRelationshipMapNode[]; edges: DirectoryRelationshipMapEdge[] } {
  const nodes: DirectoryRelationshipMapNode[] = [
    {
      id: input.detail.organization.id,
      kind: "organization",
      label: input.detail.organization.display_name,
      subtitle: labelForAccountType(input.detail.organization.account_type),
      badge: input.view === "organizations" ? "Current focus" : null,
      imageUrl: input.detail.organization.logo_url
    }
  ];
  const edges: DirectoryRelationshipMapEdge[] = [];

  if (input.selectedContact) {
    nodes.push({
      id: input.selectedContact.id,
      kind: "contact",
      label: input.selectedContact.full_name,
      subtitle: input.selectedContact.title || labelForRoleCategory(input.selectedContact.role_category),
      badge: labelForOperationalImportance(input.selectedContact.operational_importance),
      imageUrl: input.selectedContact.photo_url
    });
    edges.push({
      id: `${input.detail.organization.id}-${input.selectedContact.id}`,
      from: input.detail.organization.id,
      to: input.selectedContact.id,
      label: input.selectedContact.is_primary ? "Primary Contact" : labelForRelationshipRole(input.selectedContact.relationship_role)
    });

    if (input.selectedContact.primary_internal_owner) {
      nodes.push({
        id: input.selectedContact.primary_internal_owner.user_id,
        kind: "owner",
        label: input.selectedContact.primary_internal_owner.full_name,
        subtitle: input.selectedContact.primary_internal_owner.department,
        badge: "Primary Owner"
      });
      edges.push({
        id: `${input.selectedContact.primary_internal_owner.user_id}-${input.selectedContact.id}`,
        from: input.selectedContact.primary_internal_owner.user_id,
        to: input.selectedContact.id,
        label: "Internal Owner"
      });
    }
    if (input.selectedContact.backup_internal_owner) {
      nodes.push({
        id: input.selectedContact.backup_internal_owner.user_id,
        kind: "owner",
        label: input.selectedContact.backup_internal_owner.full_name,
        subtitle: input.selectedContact.backup_internal_owner.department,
        badge: "Backup Owner"
      });
      edges.push({
        id: `${input.selectedContact.backup_internal_owner.user_id}-${input.selectedContact.id}`,
        from: input.selectedContact.backup_internal_owner.user_id,
        to: input.selectedContact.id,
        label: "Backup Relationship"
      });
    }
    for (const locationName of input.selectedContact.linked_location_names ?? []) {
      const location = input.detail.locations.find((entry) => entry.location_name === locationName);
      if (!location) {
        continue;
      }
      nodes.push({
        id: location.id,
        kind: "location",
        label: location.location_name,
        subtitle: buildLocationAddress(location),
        badge: "Linked Site"
      });
      edges.push({
        id: `${input.selectedContact.id}-${location.id}`,
        from: input.selectedContact.id,
        to: location.id,
        label: "Day-of Contact For"
      });
    }
  } else if (input.selectedLocation) {
    nodes.push({
      id: input.selectedLocation.id,
      kind: "location",
      label: input.selectedLocation.location_name,
      subtitle: buildLocationAddress(input.selectedLocation),
      badge: "Focused Location"
    });
    edges.push({
      id: `${input.detail.organization.id}-${input.selectedLocation.id}`,
      from: input.detail.organization.id,
      to: input.selectedLocation.id,
      label: "School / Location"
    });
    for (const contact of input.locationContacts.slice(0, 4)) {
      nodes.push({
        id: contact.id,
        kind: "contact",
        label: contact.full_name,
        subtitle: contact.title || labelForRoleCategory(contact.role_category),
        badge: contact.is_primary ? "Primary" : labelForRelationshipRole(contact.relationship_role),
        imageUrl: contact.photo_url
      });
      edges.push({
        id: `${contact.id}-${input.selectedLocation.id}`,
        from: contact.id,
        to: input.selectedLocation.id,
        label: "Works This Site"
      });
    }
  } else {
    for (const contact of input.detail.contacts.slice(0, 4)) {
      nodes.push({
        id: contact.id,
        kind: "contact",
        label: contact.full_name,
        subtitle: contact.title || labelForRoleCategory(contact.role_category),
        badge: contact.is_primary ? "Primary" : labelForOperationalImportance(contact.operational_importance),
        imageUrl: contact.photo_url
      });
      edges.push({
        id: `${input.detail.organization.id}-${contact.id}`,
        from: input.detail.organization.id,
        to: contact.id,
        label: contact.is_primary ? "Primary Contact" : labelForRelationshipRole(contact.relationship_role)
      });
      if (contact.primary_internal_owner) {
        nodes.push({
          id: contact.primary_internal_owner.user_id,
          kind: "owner",
          label: contact.primary_internal_owner.full_name,
          subtitle: contact.primary_internal_owner.department,
          badge: "Owner"
        });
        edges.push({
          id: `${contact.primary_internal_owner.user_id}-${contact.id}`,
          from: contact.primary_internal_owner.user_id,
          to: contact.id,
          label: "Internal Owner"
        });
      }
    }
    for (const location of input.detail.locations.slice(0, 3)) {
      nodes.push({
        id: location.id,
        kind: "location",
        label: location.location_name,
        subtitle: buildLocationAddress(location),
        badge: `${location.contact_links?.length ?? 0} linked`
      });
      edges.push({
        id: `${input.detail.organization.id}-${location.id}`,
        from: input.detail.organization.id,
        to: location.id,
        label: "School / Location"
      });
    }
  }

  return {
    nodes: dedupeRelationshipNodes(nodes),
    edges
  };
}

function dedupeRelationshipNodes(nodes: DirectoryRelationshipMapNode[]) {
  const seen = new Set<string>();
  const deduped: DirectoryRelationshipMapNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    deduped.push(node);
  }
  return deduped;
}
