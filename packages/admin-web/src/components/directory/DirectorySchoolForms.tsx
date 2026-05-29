import { useMemo, useState } from "react";
import type {
  SchoolContactCategoriesUpdateInput,
  SchoolProfileUpdateInput,
  SchoolRuleCreateInput,
  SchoolRuleUpdateInput
} from "../../services/organizationApi";
import type {
  DirectoryActiveStatus,
  DirectoryOwnerOption,
  OrganizationContact,
  OrganizationLocation,
  SchoolProfile,
  SchoolRule,
  SchoolRuleType
} from "../../types";
import {
  ACTIVE_STATUS_OPTIONS,
  SCHOOL_CONTACT_CATEGORY_OPTIONS,
  SCHOOL_RELATIONSHIP_HEALTH_OPTIONS,
  SCHOOL_RULE_TYPE_OPTIONS,
  labelForSchoolRuleType
} from "./directoryOptions";

type FormProps = {
  onCancel: () => void;
  submitting?: boolean;
  error?: string;
};

type SchoolProfileFormProps = FormProps & {
  initialValue?: SchoolProfile | null;
  ownerOptions: DirectoryOwnerOption[];
  locations: OrganizationLocation[];
  submitLabel: string;
  onSubmit: (input: SchoolProfileUpdateInput) => Promise<void> | void;
};

type SchoolContactCategoriesFormProps = FormProps & {
  contact: OrganizationContact;
  submitLabel: string;
  onSubmit: (input: SchoolContactCategoriesUpdateInput) => Promise<void> | void;
};

type SchoolRuleFormProps = FormProps & {
  initialValue?: SchoolRule | null;
  submitLabel: string;
  onSubmit: (input: SchoolRuleCreateInput | SchoolRuleUpdateInput) => Promise<void> | void;
};

type SchoolNoteFormProps = FormProps & {
  submitLabel: string;
  onSubmit: (input: { summary: string; detail?: string | null }) => Promise<void> | void;
};

type StructuredPair = {
  id: string;
  key: string;
  value: string;
};

export function SchoolProfileForm({
  initialValue,
  ownerOptions,
  locations,
  submitLabel,
  onSubmit,
  onCancel,
  submitting,
  error
}: SchoolProfileFormProps) {
  const [districtName, setDistrictName] = useState(initialValue?.district_name ?? "");
  const [schoolType, setSchoolType] = useState(initialValue?.school_type ?? "");
  const [schoolYearLabel, setSchoolYearLabel] = useState(initialValue?.school_year_label ?? "");
  const [primaryInternalOwnerUserId, setPrimaryInternalOwnerUserId] = useState(
    initialValue?.primary_internal_owner?.user_id ?? ""
  );
  const [backupInternalOwnerUserId, setBackupInternalOwnerUserId] = useState(
    initialValue?.backup_internal_owner?.user_id ?? ""
  );
  const [relationshipHealthState, setRelationshipHealthState] = useState(
    initialValue?.relationship_health_state ?? "unknown"
  );
  const [relationshipSummary, setRelationshipSummary] = useState(initialValue?.relationship_summary ?? "");
  const [primaryLocationId, setPrimaryLocationId] = useState(initialValue?.primary_location_id ?? "");
  const [tags, setTags] = useState((initialValue?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [validationError, setValidationError] = useState("");

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          primaryInternalOwnerUserId &&
          backupInternalOwnerUserId &&
          primaryInternalOwnerUserId === backupInternalOwnerUserId
        ) {
          setValidationError("Choose different people for the primary and backup school owners.");
          return;
        }
        setValidationError("");
        void onSubmit({
          district_name: districtName.trim() || null,
          school_type: schoolType.trim() || null,
          school_year_label: schoolYearLabel.trim() || null,
          primary_internal_owner_user_id: primaryInternalOwnerUserId || null,
          backup_internal_owner_user_id: backupInternalOwnerUserId || null,
          relationship_health_state: relationshipHealthState,
          relationship_summary: relationshipSummary.trim() || null,
          primary_location_id: primaryLocationId || null,
          tags: tags
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          notes: notes.trim() || null
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field">
          <span>District</span>
          <input value={districtName} onChange={(event) => setDistrictName(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>School type</span>
          <input value={schoolType} onChange={(event) => setSchoolType(event.target.value)} placeholder="High school, middle school, district office..." />
        </label>
        <label className="directory-field">
          <span>School year</span>
          <input value={schoolYearLabel} onChange={(event) => setSchoolYearLabel(event.target.value)} placeholder="2026-2027" />
        </label>
        <label className="directory-field">
          <span>Relationship health</span>
          <select
            value={relationshipHealthState}
            onChange={(event) => setRelationshipHealthState(event.target.value as typeof relationshipHealthState)}
          >
            {SCHOOL_RELATIONSHIP_HEALTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Primary school owner</span>
          <select value={primaryInternalOwnerUserId} onChange={(event) => setPrimaryInternalOwnerUserId(event.target.value)}>
            <option value="">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Backup owner</span>
          <select value={backupInternalOwnerUserId} onChange={(event) => setBackupInternalOwnerUserId(event.target.value)}>
            <option value="">No backup owner</option>
            {ownerOptions.map((owner) => (
              <option key={owner.user_id} value={owner.user_id}>
                {owner.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Primary location</span>
          <select value={primaryLocationId} onChange={(event) => setPrimaryLocationId(event.target.value)}>
            <option value="">No primary location selected</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.location_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Relationship summary</span>
          <textarea
            value={relationshipSummary}
            onChange={(event) => setRelationshipSummary(event.target.value)}
            rows={3}
            placeholder="What matters about this school relationship right now?"
          />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Tags</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Graduation, yearbook, high-volume, portal-heavy" />
        </label>
        <label className="directory-field directory-field--wide">
          <span>School notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder="Short canonical note for this school's operating profile."
          />
        </label>
      </div>
      {validationError ? <p className="directory-form__error">{validationError}</p> : null}
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function SchoolContactCategoriesForm({
  contact,
  submitLabel,
  onSubmit,
  onCancel,
  submitting,
  error
}: SchoolContactCategoriesFormProps) {
  const [selectedCategories, setSelectedCategories] = useState(contact.school_contact_categories ?? []);

  function toggleCategory(category: (typeof SCHOOL_CONTACT_CATEGORY_OPTIONS)[number]["value"]) {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((value) => value !== category) : [...current, category]
    );
  }

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ school_contact_categories: selectedCategories });
      }}
    >
      <p className="muted">
        Keep {contact.full_name}'s school-specific operational roles structured instead of hiding them in a general note.
      </p>
      <div className="directory-form__grid">
        {SCHOOL_CONTACT_CATEGORY_OPTIONS.map((option) => (
          <label key={option.value} className="directory-field directory-field--checkbox">
            <input
              type="checkbox"
              checked={selectedCategories.includes(option.value)}
              onChange={() => toggleCategory(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function SchoolRuleForm({
  initialValue,
  submitLabel,
  onSubmit,
  onCancel,
  submitting,
  error
}: SchoolRuleFormProps) {
  const [ruleType, setRuleType] = useState<SchoolRuleType>(
    initialValue?.rule_type ?? "additional_shoot_rules"
  );
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [summary, setSummary] = useState(initialValue?.summary ?? "");
  const [activeStatus, setActiveStatus] = useState<DirectoryActiveStatus>(initialValue?.active_status ?? "active");
  const [sortOrder, setSortOrder] = useState(String(initialValue?.sort_order ?? 0));
  const [structuredPairs, setStructuredPairs] = useState<StructuredPair[]>(() =>
    buildStructuredPairs(initialValue?.structured_value ?? {})
  );

  const structuredValue = useMemo(() => {
    const next: Record<string, unknown> = {};
    for (const pair of structuredPairs) {
      const key = pair.key.trim();
      const value = pair.value.trim();
      if (!key || !value) {
        continue;
      }
      next[key] = value;
    }
    return next;
  }, [structuredPairs]);

  function updateStructuredPair(id: string, field: "key" | "value", value: string) {
    setStructuredPairs((current) =>
      current.map((pair) => (pair.id === id ? { ...pair, [field]: value } : pair))
    );
  }

  function addStructuredPair() {
    setStructuredPairs((current) => [...current, { id: `${Date.now()}-${current.length}`, key: "", value: "" }]);
  }

  function removeStructuredPair(id: string) {
    setStructuredPairs((current) => (current.length === 1 ? current : current.filter((pair) => pair.id !== id)));
  }

  const isEditing = Boolean(initialValue?.id);

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        const payload = {
          title: title.trim() || null,
          summary: summary.trim() || null,
          active_status: activeStatus,
          structured_value: Object.keys(structuredValue).length ? structuredValue : null,
          sort_order: Number.parseInt(sortOrder || "0", 10) || 0
        };
        void onSubmit(isEditing ? payload : { rule_type: ruleType, ...payload });
      }}
    >
      <div className="directory-form__grid">
        {isEditing ? (
          <label className="directory-field directory-field--wide">
            <span>Rule type</span>
            <input value={labelForSchoolRuleType(ruleType)} readOnly />
          </label>
        ) : (
          <label className="directory-field directory-field--wide">
            <span>Rule type</span>
            <select value={ruleType} onChange={(event) => setRuleType(event.target.value as SchoolRuleType)}>
              {SCHOOL_RULE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="directory-field">
          <span>Rule title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short rule heading" />
        </label>
        <label className="directory-field">
          <span>Status</span>
          <select value={activeStatus} onChange={(event) => setActiveStatus(event.target.value as DirectoryActiveStatus)}>
            {ACTIVE_STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Sort order</span>
          <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} min="0" />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Summary</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            placeholder="Short operational summary for crews and office staff."
          />
        </label>
      </div>
      <section className="request-card school-form-structured-block">
        <div className="directory-card__header">
          <div>
            <strong>Structured settings</strong>
            <div className="muted">Capture rule details as named values instead of burying them in plain text.</div>
          </div>
          <button type="button" className="secondary-button" onClick={addStructuredPair}>
            Add field
          </button>
        </div>
        <div className="directory-section-stack">
          {structuredPairs.map((pair) => (
            <div key={pair.id} className="school-structured-row">
              <label className="directory-field">
                <span>Field</span>
                <input value={pair.key} onChange={(event) => updateStructuredPair(pair.id, "key", event.target.value)} />
              </label>
              <label className="directory-field">
                <span>Value</span>
                <input value={pair.value} onChange={(event) => updateStructuredPair(pair.id, "value", event.target.value)} />
              </label>
              <button type="button" className="secondary-button" onClick={() => removeStructuredPair(pair.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function SchoolNoteForm({ submitLabel, onSubmit, onCancel, submitting, error }: SchoolNoteFormProps) {
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          summary: summary.trim(),
          detail: detail.trim() || null
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field directory-field--wide">
          <span>Note summary</span>
          <input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="What changed or what should the team know?"
            required
          />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Detail</span>
          <textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            rows={4}
            placeholder="Add extra context for future school operations review."
          />
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !summary.trim()}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function buildStructuredPairs(structuredValue: Record<string, unknown>) {
  const entries = Object.entries(structuredValue);
  if (!entries.length) {
    return [{ id: "pair-0", key: "", value: "" }];
  }
  return entries.map(([key, value], index) => ({
    id: `pair-${index}`,
    key,
    value: String(value ?? "")
  }));
}
