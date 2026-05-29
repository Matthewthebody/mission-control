import { useState } from "react";
import type {
  DirectoryRelationshipFollowUpCreateInput,
  DirectoryRelationshipMemoryCreateInput,
  DirectoryTouchpointCreateInput,
  DirectoryTouchpointPlanCreateInput
} from "../../services/organizationApi";
import type {
  DirectoryOwnerOption,
  DirectoryTouchpointPlan,
  DirectoryTouchpointPlanTemplate,
  OrganizationContact,
  OrganizationLocation,
  OrganizationRecentShoot,
  OrganizationUpcomingShoot
} from "../../types";
import {
  COMMUNICATION_OUTCOME_OPTIONS,
  RELATIONSHIP_MEMORY_TYPE_OPTIONS,
  RELATIONSHIP_MEMORY_VISIBILITY_OPTIONS,
  TOUCHPOINT_CATEGORY_OPTIONS,
  TOUCHPOINT_CHANNEL_OPTIONS,
  buildShootLabel,
  labelForTouchpointPlanStatus
} from "./directoryOptions";

type FormProps = {
  onCancel: () => void;
  submitting?: boolean;
  error?: string;
};

type SharedContextProps = {
  contacts: OrganizationContact[];
  locations: OrganizationLocation[];
  shoots: Array<OrganizationRecentShoot | OrganizationUpcomingShoot>;
  ownerOptions: DirectoryOwnerOption[];
  touchpointPlans?: DirectoryTouchpointPlan[];
  touchpointTemplates?: DirectoryTouchpointPlanTemplate[];
  initialContactId?: string | null;
};

export function DirectoryCommunicationLogForm({
  contacts,
  locations,
  shoots,
  ownerOptions,
  touchpointPlans = [],
  initialContactId = null,
  onCancel,
  onSubmit,
  submitting,
  error
}: FormProps &
  SharedContextProps & {
    onSubmit: (input: DirectoryTouchpointCreateInput) => Promise<void> | void;
  }) {
  const [contactId, setContactId] = useState(initialContactId ?? "");
  const [locationId, setLocationId] = useState("");
  const [shootId, setShootId] = useState("");
  const [touchpointPlanId, setTouchpointPlanId] = useState("");
  const [channel, setChannel] = useState<DirectoryTouchpointCreateInput["channel"]>("call");
  const [category, setCategory] = useState<NonNullable<DirectoryTouchpointCreateInput["category"]>>("planning");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeState, setOutcomeState] = useState<NonNullable<DirectoryTouchpointCreateInput["outcome_state"]>>("confirmed");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [occurredAt, setOccurredAt] = useState(toLocalDateTimeInputValue(new Date().toISOString()));
  const [followUpNeeded, setFollowUpNeeded] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpOwnerUserId, setFollowUpOwnerUserId] = useState("");
  const [relationshipMemorySuggested, setRelationshipMemorySuggested] = useState(false);
  const [memoryType, setMemoryType] = useState<NonNullable<DirectoryTouchpointCreateInput["memory_type"]>>("communication_preference");
  const [memorySummary, setMemorySummary] = useState("");
  const [memoryWhyItMatters, setMemoryWhyItMatters] = useState("");
  const [memoryVisibility, setMemoryVisibility] = useState<NonNullable<DirectoryTouchpointCreateInput["memory_visibility"]>>("assignment_relevant");
  const [attachmentReference, setAttachmentReference] = useState("");

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          contact_id: contactId || null,
          location_id: locationId || null,
          shoot_id: shootId || null,
          channel,
          category,
          subject: subject.trim() || null,
          summary: summary.trim(),
          outcome: outcome.trim() || null,
          outcome_state: outcomeState || null,
          owner_user_id: ownerUserId || null,
          occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
          follow_up_needed: followUpNeeded,
          follow_up_date: followUpNeeded ? followUpDate || null : null,
          follow_up_owner_user_id: followUpNeeded ? followUpOwnerUserId || ownerUserId || null : null,
          relationship_memory_suggested: relationshipMemorySuggested,
          attachment_reference: attachmentReference.trim() || null,
          touchpoint_plan_id: touchpointPlanId || null,
          memory_type: relationshipMemorySuggested ? memoryType : null,
          memory_summary: relationshipMemorySuggested ? memorySummary.trim() || null : null,
          memory_why_it_matters: relationshipMemorySuggested ? memoryWhyItMatters.trim() || null : null,
          memory_visibility: relationshipMemorySuggested ? memoryVisibility : null
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field">
          <span>Communication type</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
            {TOUCHPOINT_CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Touchpoint category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
            {TOUCHPOINT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Contact</span>
          <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">No contact selected</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Owner</span>
          <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
            <option value="">Current user</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What was this interaction about?" />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Summary</span>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Outcome</span>
          <textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} rows={2} />
        </label>
        <label className="directory-field">
          <span>Outcome state</span>
          <select value={outcomeState} onChange={(event) => setOutcomeState(event.target.value as typeof outcomeState)}>
            {COMMUNICATION_OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Occurred at</span>
          <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Location</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">No location linked</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.location_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Linked shoot</span>
          <select value={shootId} onChange={(event) => setShootId(event.target.value)}>
            <option value="">No shoot linked</option>
            {shoots.map((shoot) => (
              <option key={shoot.id} value={shoot.id}>
                {buildShootLabel(shoot)}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Planned touchpoint</span>
          <select value={touchpointPlanId} onChange={(event) => setTouchpointPlanId(event.target.value)}>
            <option value="">No planned touchpoint linked</option>
            {touchpointPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title} - {labelForTouchpointPlanStatus(plan.status)}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Attachment / reference</span>
          <input value={attachmentReference} onChange={(event) => setAttachmentReference(event.target.value)} placeholder="Optional file path or reference" />
        </label>
        <label className="directory-field directory-field--checkbox">
          <input type="checkbox" checked={followUpNeeded} onChange={(event) => setFollowUpNeeded(event.target.checked)} />
          <span>Follow-up needed</span>
        </label>
        {followUpNeeded ? (
          <>
            <label className="directory-field">
              <span>Follow-up due</span>
              <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
            </label>
            <label className="directory-field">
              <span>Follow-up owner</span>
              <select value={followUpOwnerUserId} onChange={(event) => setFollowUpOwnerUserId(event.target.value)}>
                <option value="">Use communication owner</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.user_id} value={owner.user_id}>
                    {owner.full_name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label className="directory-field directory-field--checkbox">
          <input
            type="checkbox"
            checked={relationshipMemorySuggested}
            onChange={(event) => setRelationshipMemorySuggested(event.target.checked)}
          />
          <span>Promote reusable relationship memory</span>
        </label>
        {relationshipMemorySuggested ? (
          <>
            <label className="directory-field">
              <span>Memory type</span>
              <select value={memoryType} onChange={(event) => setMemoryType(event.target.value as typeof memoryType)}>
                {RELATIONSHIP_MEMORY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="directory-field">
              <span>Visibility</span>
              <select value={memoryVisibility} onChange={(event) => setMemoryVisibility(event.target.value as typeof memoryVisibility)}>
                {RELATIONSHIP_MEMORY_VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="directory-field directory-field--wide">
              <span>Memory summary</span>
              <input value={memorySummary} onChange={(event) => setMemorySummary(event.target.value)} />
            </label>
            <label className="directory-field directory-field--wide">
              <span>Why it matters</span>
              <textarea value={memoryWhyItMatters} onChange={(event) => setMemoryWhyItMatters(event.target.value)} rows={2} />
            </label>
          </>
        ) : null}
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !summary.trim()}>
          {submitting ? "Saving..." : "Log communication"}
        </button>
      </div>
    </form>
  );
}

export function DirectoryTouchpointPlanForm({
  contacts,
  locations,
  shoots,
  ownerOptions,
  touchpointTemplates = [],
  initialContactId = null,
  onCancel,
  onSubmit,
  submitting,
  error
}: FormProps &
  SharedContextProps & {
    onSubmit: (input: DirectoryTouchpointPlanCreateInput) => Promise<void> | void;
  }) {
  const [contactId, setContactId] = useState(initialContactId ?? "");
  const [locationId, setLocationId] = useState("");
  const [shootId, setShootId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [category, setCategory] = useState<DirectoryTouchpointPlanCreateInput["category"]>("planning");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [backupOwnerUserId, setBackupOwnerUserId] = useState("");
  const [dueAt, setDueAt] = useState(toLocalDateTimeInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()));

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          template_id: templateId || null,
          contact_id: contactId || null,
          location_id: locationId || null,
          linked_shoot_id: shootId || null,
          category,
          title: title.trim(),
          summary: summary.trim() || null,
          owner_user_id: ownerUserId || null,
          backup_owner_user_id: backupOwnerUserId || null,
          due_at: new Date(dueAt).toISOString()
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field directory-field--wide">
          <span>Template</span>
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">Manual touchpoint</option>
            {touchpointTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.template_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
            {TOUCHPOINT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Owner</span>
          <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
            <option value="">Current user</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Backup owner</span>
          <select value={backupOwnerUserId} onChange={(event) => setBackupOwnerUserId(event.target.value)}>
            <option value="">No backup owner</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Due at</span>
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Summary</span>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} />
        </label>
        <label className="directory-field">
          <span>Contact</span>
          <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">No contact selected</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Location</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">No location linked</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.location_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Linked shoot</span>
          <select value={shootId} onChange={(event) => setShootId(event.target.value)}>
            <option value="">No shoot linked</option>
            {shoots.map((shoot) => (
              <option key={shoot.id} value={shoot.id}>
                {buildShootLabel(shoot)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !title.trim()}>
          {submitting ? "Saving..." : "Create touchpoint"}
        </button>
      </div>
    </form>
  );
}

export function DirectoryRelationshipMemoryForm({
  contacts,
  locations,
  initialContactId = null,
  onCancel,
  onSubmit,
  submitting,
  error
}: FormProps &
  Pick<SharedContextProps, "contacts" | "locations" | "initialContactId"> & {
    onSubmit: (input: DirectoryRelationshipMemoryCreateInput) => Promise<void> | void;
  }) {
  const [contactId, setContactId] = useState(initialContactId ?? "");
  const [locationId, setLocationId] = useState("");
  const [memoryType, setMemoryType] = useState<DirectoryRelationshipMemoryCreateInput["memory_type"]>("communication_preference");
  const [summary, setSummary] = useState("");
  const [whyItMatters, setWhyItMatters] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [visibility, setVisibility] = useState<NonNullable<DirectoryRelationshipMemoryCreateInput["visibility"]>>("assignment_relevant");
  const [lastConfirmedAt, setLastConfirmedAt] = useState("");

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          contact_id: contactId || null,
          location_id: locationId || null,
          memory_type: memoryType,
          summary: summary.trim(),
          why_it_matters: whyItMatters.trim(),
          source_label: sourceLabel.trim() || null,
          visibility,
          last_confirmed_at: lastConfirmedAt || null
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field">
          <span>Memory type</span>
          <select value={memoryType} onChange={(event) => setMemoryType(event.target.value as typeof memoryType)}>
            {RELATIONSHIP_MEMORY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Visibility</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}>
            {RELATIONSHIP_MEMORY_VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Last confirmed</span>
          <input type="date" value={lastConfirmedAt} onChange={(event) => setLastConfirmedAt(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Contact</span>
          <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">No contact selected</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Location</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">No location linked</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.location_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Summary</span>
          <input value={summary} onChange={(event) => setSummary(event.target.value)} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Why it matters</span>
          <textarea value={whyItMatters} onChange={(event) => setWhyItMatters(event.target.value)} rows={3} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Source</span>
          <input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="Where this was learned" />
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !summary.trim() || !whyItMatters.trim()}>
          {submitting ? "Saving..." : "Create memory"}
        </button>
      </div>
    </form>
  );
}

export function DirectoryRelationshipFollowUpForm({
  contacts,
  locations,
  shoots,
  ownerOptions,
  initialContactId = null,
  onCancel,
  onSubmit,
  submitting,
  error
}: FormProps &
  SharedContextProps & {
    onSubmit: (input: DirectoryRelationshipFollowUpCreateInput) => Promise<void> | void;
  }) {
  const [contactId, setContactId] = useState(initialContactId ?? "");
  const [locationId, setLocationId] = useState("");
  const [shootId, setShootId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [backupOwnerUserId, setBackupOwnerUserId] = useState("");
  const [dueAt, setDueAt] = useState(toLocalDateTimeInputValue(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()));

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          contact_id: contactId || null,
          location_id: locationId || null,
          linked_shoot_id: shootId || null,
          title: title.trim(),
          summary: summary.trim() || null,
          owner_user_id: ownerUserId || null,
          backup_owner_user_id: backupOwnerUserId || null,
          due_at: new Date(dueAt).toISOString()
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field directory-field--wide">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Summary</span>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} />
        </label>
        <label className="directory-field">
          <span>Owner</span>
          <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
            <option value="">Current user</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Backup owner</span>
          <select value={backupOwnerUserId} onChange={(event) => setBackupOwnerUserId(event.target.value)}>
            <option value="">No backup owner</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Due at</span>
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Contact</span>
          <select value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">No contact selected</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Location</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">No location linked</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.location_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Linked shoot</span>
          <select value={shootId} onChange={(event) => setShootId(event.target.value)}>
            <option value="">No shoot linked</option>
            {shoots.map((shoot) => (
              <option key={shoot.id} value={shoot.id}>
                {buildShootLabel(shoot)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !title.trim()}>
          {submitting ? "Saving..." : "Create follow-up"}
        </button>
      </div>
    </form>
  );
}

function toLocalDateTimeInputValue(value: string) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
