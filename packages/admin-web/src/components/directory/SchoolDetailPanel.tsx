import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { OrganizationContact, OrganizationDetail, SchoolActivityLog, SchoolRule } from "../../types";
import {
  formatDateLabel,
  formatDateTimeLabel,
  labelForActiveStatus,
  labelForContactStatus,
  labelForOperationalImportance,
  labelForRoleCategory,
  labelForSchoolContactCategory,
  labelForSchoolRelationshipHealth,
  labelForSchoolRuleType,
  summarizeText
} from "./directoryOptions";

type SchoolDetailTab = "overview" | "contacts" | "rules" | "timeline" | "notes";

type Props = {
  detail: OrganizationDetail;
  canManageSchoolFoundation: boolean;
  actionBusy: boolean;
  selectedContactId?: string | null;
  onSelectContact: (contactId: string) => void;
  onEditContact: (contact: OrganizationContact) => void;
  onEditSchoolProfile: () => void;
  onEditSchoolContactCategories: (contact: OrganizationContact) => void;
  onCreateSchoolRule: () => void;
  onEditSchoolRule: (rule: SchoolRule) => void;
  onCreateSchoolNote: () => void;
};

const SCHOOL_DETAIL_TABS: Array<{ value: SchoolDetailTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "contacts", label: "Contacts" },
  { value: "rules", label: "Rules / Settings" },
  { value: "timeline", label: "Timeline" },
  { value: "notes", label: "Notes" }
];

export function SchoolDetailPanel({
  detail,
  canManageSchoolFoundation,
  actionBusy,
  selectedContactId,
  onSelectContact,
  onEditContact,
  onEditSchoolProfile,
  onEditSchoolContactCategories,
  onCreateSchoolRule,
  onEditSchoolRule,
  onCreateSchoolNote
}: Props) {
  const [activeTab, setActiveTab] = useState<SchoolDetailTab>("overview");

  useEffect(() => {
    setActiveTab("overview");
  }, [detail.organization.id]);

  const schoolProfile = detail.school_profile ?? null;
  const schoolRules = detail.school_rules ?? [];
  const schoolActivity = detail.school_activity ?? [];
  const schoolContacts = useMemo(
    () =>
      [...detail.contacts].sort((left, right) => {
        const leftScore = (left.school_contact_categories?.length ?? 0) * 10 + (left.is_primary ? 3 : 0);
        const rightScore = (right.school_contact_categories?.length ?? 0) * 10 + (right.is_primary ? 3 : 0);
        return rightScore - leftScore;
      }),
    [detail.contacts]
  );
  const noteEntries = schoolActivity.filter((entry) => entry.activity_type === "note_added");

  return (
    <section className="request-card school-detail-panel">
      <div className="directory-card__header">
        <div>
          <strong>School Detail</strong>
          <div className="muted">
            Keep canonical school truth, operational contacts, structured rules, and timeline history together in one readable surface.
          </div>
        </div>
        {canManageSchoolFoundation ? (
          <div className="page-intro-actions page-intro-actions--compact">
            <button type="button" onClick={onEditSchoolProfile} disabled={actionBusy}>
              Edit school profile
            </button>
            <button type="button" className="secondary-button" onClick={onCreateSchoolNote} disabled={actionBusy}>
              Add note
            </button>
          </div>
        ) : (
          <span className="meta-pill">Read-only school foundation</span>
        )}
      </div>

      <div className="metrics-grid metrics-grid--compact">
        <article className="metric-card">
          <div className="metric-card__label">District</div>
          <strong className="metric-card__value">{schoolProfile?.district_name || "Not set"}</strong>
          <div className="muted">{schoolProfile?.school_type || "School type not set"}</div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label">School Year</div>
          <strong className="metric-card__value">{schoolProfile?.school_year_label || "Not set"}</strong>
          <div className="muted">{labelForActiveStatus(detail.organization.active_status)}</div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label">Relationship Health</div>
          <strong className="metric-card__value">
            {labelForSchoolRelationshipHealth(schoolProfile?.relationship_health_state)}
          </strong>
          <div className="muted">{schoolProfile?.relationship_summary || "No health summary saved."}</div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label">Structured Rules</div>
          <strong className="metric-card__value">{schoolRules.length}</strong>
          <div className="muted">{schoolContacts.filter((contact) => (contact.school_contact_categories?.length ?? 0) > 0).length} categorized contacts</div>
        </article>
      </div>

      <div className="report-tab-row">
        {SCHOOL_DETAIL_TABS.map((tab) => (
          <button key={tab.value} type="button" className={activeTab === tab.value ? "is-active" : ""} onClick={() => setActiveTab(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="detail-grid">
          <article className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>School Profile</strong>
                <div className="muted">Canonical school identity, ownership, and reusable high-level operating context.</div>
              </div>
            </div>
            <div className="directory-chip-row">
              <span className="meta-pill">{detail.organization.display_name}</span>
              <span className="meta-pill">{schoolProfile?.district_name || "District not set"}</span>
              <span className="meta-pill">{schoolProfile?.school_type || "Type not set"}</span>
              <span className="meta-pill">{schoolProfile?.school_year_label || "Year not set"}</span>
            </div>
            <p>{summarizeText(schoolProfile?.relationship_summary, "No school relationship summary is saved yet.")}</p>
            <div className="directory-card-grid">
              <div className="directory-mini-card">
                <span className="directory-mini-card__label">Primary owner</span>
                <strong>{schoolProfile?.primary_internal_owner?.full_name ?? "Unassigned"}</strong>
              </div>
              <div className="directory-mini-card">
                <span className="directory-mini-card__label">Backup owner</span>
                <strong>{schoolProfile?.backup_internal_owner?.full_name ?? "No backup owner"}</strong>
              </div>
              <div className="directory-mini-card">
                <span className="directory-mini-card__label">Primary location</span>
                <strong>{schoolProfile?.primary_location_name ?? "Not set"}</strong>
              </div>
              <div className="directory-mini-card">
                <span className="directory-mini-card__label">Last updated</span>
                <strong>{schoolProfile?.updated_at ? formatDateLabel(schoolProfile.updated_at) : "Not tracked"}</strong>
              </div>
            </div>
            <div className="directory-chip-row">
              {(schoolProfile?.tags ?? []).map((tag) => (
                <span key={tag} className="meta-pill">
                  {tag}
                </span>
              ))}
              {!(schoolProfile?.tags ?? []).length ? <span className="meta-pill">No school tags</span> : null}
            </div>
          </article>

          <article className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>Operational Notes</strong>
                <div className="muted">Keep canonical school notes visible without mixing them into workflow timelines.</div>
              </div>
            </div>
            <p>{summarizeText(schoolProfile?.notes, "No canonical school note is saved yet.")}</p>
            {noteEntries.length ? (
              <div className="directory-link-list">
                {noteEntries.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="directory-link-row">
                    <div>
                      <strong>{entry.summary}</strong>
                      <div className="muted">{formatDateTimeLabel(entry.created_at)}</div>
                    </div>
                    <span className="meta-pill">{entry.actor_name ?? "System"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No timeline notes have been added yet.</p>
            )}
          </article>
        </div>
      ) : null}

      {activeTab === "contacts" ? (
        <div className="directory-section-stack">
          {schoolContacts.map((contact) => (
            <article
              key={contact.id}
              className={`request-card directory-entity-card${selectedContactId === contact.id ? " is-selected" : ""}`}
            >
              <div className="directory-card__header">
                <div>
                  <strong>{contact.full_name}</strong>
                  <div className="muted">
                    {contact.title || "No title"}
                    {contact.email ? ` - ${contact.email}` : ""}
                  </div>
                </div>
                <div className="page-intro-actions page-intro-actions--compact">
                  <button type="button" className="secondary-button" onClick={() => onSelectContact(contact.id)}>
                    {selectedContactId === contact.id ? "Focused" : "Focus"}
                  </button>
                  {canManageSchoolFoundation ? (
                    <>
                      <button type="button" className="secondary-button" onClick={() => onEditSchoolContactCategories(contact)} disabled={actionBusy}>
                        Edit school roles
                      </button>
                      <button type="button" className="secondary-button" onClick={() => onEditContact(contact)} disabled={actionBusy}>
                        Edit contact
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="directory-chip-row">
                <span className="meta-pill">{labelForContactStatus(contact.contact_status)}</span>
                <span className="meta-pill">{labelForRoleCategory(contact.role_category)}</span>
                <span className="meta-pill">{labelForOperationalImportance(contact.operational_importance)}</span>
                {(contact.school_contact_categories ?? []).map((category) => (
                  <span key={category} className="meta-pill">
                    {labelForSchoolContactCategory(category)}
                  </span>
                ))}
                {!(contact.school_contact_categories ?? []).length ? <span className="meta-pill">No school categories</span> : null}
              </div>
              <p>{summarizeText(contact.notes, "No contact note saved yet.")}</p>
            </article>
          ))}
          {!schoolContacts.length ? <div className="empty-state empty-state--panel">No school contacts are linked yet.</div> : null}
        </div>
      ) : null}

      {activeTab === "rules" ? (
        <div className="directory-section-stack">
          <div className="directory-card__header">
            <div>
              <strong>Rules and Settings</strong>
              <div className="muted">Store school-specific operating rules as structured data, not a giant note block.</div>
            </div>
            {canManageSchoolFoundation ? (
              <button type="button" onClick={onCreateSchoolRule} disabled={actionBusy}>
                Add rule
              </button>
            ) : null}
          </div>
          {schoolRules.map((rule) => (
            <article key={rule.id} className="request-card">
              <div className="directory-card__header">
                <div>
                  <strong>{rule.title}</strong>
                  <div className="muted">{labelForSchoolRuleType(rule.rule_type)}</div>
                </div>
                <div className="page-intro-actions page-intro-actions--compact">
                  <span className="meta-pill">{labelForActiveStatus(rule.active_status)}</span>
                  {canManageSchoolFoundation ? (
                    <button type="button" className="secondary-button" onClick={() => onEditSchoolRule(rule)} disabled={actionBusy}>
                      Edit rule
                    </button>
                  ) : null}
                </div>
              </div>
              <p>{summarizeText(rule.summary, "No rule summary is saved yet.")}</p>
              <div className="school-structured-list">
                {Object.entries(rule.structured_value ?? {}).map(([key, value]) => renderStructuredSetting(key, value))}
                {!Object.keys(rule.structured_value ?? {}).length ? (
                  <div className="directory-mini-card">
                    <span className="directory-mini-card__label">Structured settings</span>
                    <strong>No named settings captured yet</strong>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {!schoolRules.length ? (
            <div className="empty-state empty-state--panel">No structured school rules have been added yet.</div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "timeline" ? (
        <div className="directory-section-stack">
          {schoolActivity.map((entry) => (
            <article key={entry.id} className="request-card">
              <div className="directory-card__header">
                <div>
                  <strong>{entry.summary}</strong>
                  <div className="muted">{labelForSchoolActivityType(entry.activity_type)}</div>
                </div>
                <div className="directory-chip-row">
                  <span className="meta-pill">{entry.actor_name ?? "System"}</span>
                  <span className="meta-pill">{formatDateTimeLabel(entry.created_at)}</span>
                </div>
              </div>
              {entry.detail ? <p>{entry.detail}</p> : null}
            </article>
          ))}
          {!schoolActivity.length ? (
            <div className="empty-state empty-state--panel">No school timeline activity has been recorded yet.</div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "notes" ? (
        <div className="directory-section-stack">
          <article className="request-card">
            <div className="directory-card__header">
              <div>
                <strong>Canonical School Note</strong>
                <div className="muted">The stable school-level note that should stay attached to the school profile.</div>
              </div>
            </div>
            <p>{summarizeText(schoolProfile?.notes, "No canonical school note is saved yet.")}</p>
          </article>
          {noteEntries.map((entry) => (
            <article key={entry.id} className="request-card">
              <div className="directory-card__header">
                <div>
                  <strong>{entry.summary}</strong>
                  <div className="muted">{formatDateTimeLabel(entry.created_at)}</div>
                </div>
                <span className="meta-pill">{entry.actor_name ?? "System"}</span>
              </div>
              {entry.detail ? <p>{entry.detail}</p> : null}
            </article>
          ))}
          {!noteEntries.length ? (
            <div className="empty-state empty-state--panel">No school timeline notes have been added yet.</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function labelForSchoolActivityType(value: SchoolActivityLog["activity_type"]) {
  switch (value) {
    case "profile_created":
      return "Profile Created";
    case "profile_updated":
      return "Profile Updated";
    case "contact_categories_updated":
      return "Contact Categories Updated";
    case "rule_created":
      return "Rule Created";
    case "rule_updated":
      return "Rule Updated";
    case "note_added":
      return "Note Added";
    case "automation_generated":
      return "Automation Generated";
    case "automation_escalated":
      return "Automation Escalated";
    case "automation_trigger_received":
      return "Automation Trigger Received";
    default:
      return value;
  }
}

function renderStructuredSetting(key: string, value: unknown): ReactElement {
  const label = humanizeStructuredKey(key);

  if (Array.isArray(value)) {
    return (
      <div key={key} className="directory-mini-card directory-structured-setting">
        <span className="directory-mini-card__label">{label}</span>
        {value.length ? (
          <div className="directory-chip-row">
            {value.map((entry, index) => (
              <span key={`${key}-${index}`} className="meta-pill">
                {formatStructuredScalar(entry)}
              </span>
            ))}
          </div>
        ) : (
          <strong>Not set</strong>
        )}
      </div>
    );
  }

  if (isStructuredObject(value)) {
    return (
      <div key={key} className="directory-mini-card directory-structured-setting">
        <span className="directory-mini-card__label">{label}</span>
        <div className="directory-structured-sublist">
          {Object.entries(value).map(([nestedKey, nestedValue]) => (
            <div key={`${key}-${nestedKey}`} className="directory-structured-subitem">
              <span className="directory-structured-subitem__label">{humanizeStructuredKey(nestedKey)}</span>
              <strong>{formatStructuredScalar(nestedValue)}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div key={key} className="directory-mini-card directory-structured-setting">
      <span className="directory-mini-card__label">{label}</span>
      {typeof value === "boolean" ? (
        <div className="directory-chip-row">
          <span className={`meta-pill${value ? "" : " meta-pill--muted"}`}>{value ? "Yes" : "No"}</span>
        </div>
      ) : (
        <strong>{formatStructuredScalar(value)}</strong>
      )}
    </div>
  );
}

function formatStructuredScalar(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.length ? value.map((entry) => formatStructuredScalar(entry)).join(", ") : "Not set";
  }
  if (isStructuredObject(value)) {
    return "Structured values captured";
  }
  return String(value);
}

function humanizeStructuredKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isStructuredObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
