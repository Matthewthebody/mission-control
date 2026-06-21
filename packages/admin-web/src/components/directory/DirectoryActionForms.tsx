import { useMemo, useState } from "react";
import type {
  DirectoryDuplicateReviewCreateInput,
  DirectoryRelationshipAttachInput,
  DirectoryTouchpointCreateInput,
  OrganizationContactCreateInput,
  OrganizationCreateInput,
  OrganizationLocationCreateInput
} from "../../services/organizationApi";
import type {
  DirectoryContactSummary,
  DirectoryOwnerOption,
  DirectoryTouchpointChannel,
  OrganizationAccountType,
  OrganizationContact,
  OrganizationLocation,
  OrganizationRecentShoot,
  OrganizationUpcomingShoot
} from "../../types";
import {
  ACCOUNT_TYPE_OPTIONS,
  CONTACT_ROLE_CATEGORY_OPTIONS,
  CONTACT_STATUS_OPTIONS,
  DECISION_INFLUENCE_OPTIONS,
  OPERATIONAL_IMPORTANCE_OPTIONS,
  RELATIONSHIP_ROLE_OPTIONS,
  RELATIONSHIP_STRENGTH_OPTIONS,
  TOUCHPOINT_CHANNEL_OPTIONS,
  buildShootLabel
} from "./directoryOptions";
import { ParentDistrictSelector } from "./ParentDistrictSelector";

type FormProps = {
  onCancel: () => void;
  submitting?: boolean;
  error?: string;
};

type OrganizationEditorFormProps = FormProps & {
  initialValue?: Partial<OrganizationCreateInput>;
  ownerOptions?: DirectoryOwnerOption[];
  // Phase 4 Slice 5 — when a token is supplied the canonical searchable Parent-District
  // selector is used; districtOptions remains a static fallback for callers without one.
  token?: string;
  initialParentDistrictName?: string | null;
  districtOptions?: Array<{ id: string; display_name: string }>;
  submitLabel: string;
  onUploadLogo?: (file: File) => Promise<string>;
  onSubmit: (input: OrganizationCreateInput, context: OrganizationEditorSubmitContext) => Promise<void> | void;
};

export type OrganizationPrimaryContactDraft = {
  name: string;
  title: string;
  email: string;
  phone: string;
  preferredContactMethod: string;
};

export type OrganizationEditorSubmitContext = {
  primaryContact: OrganizationPrimaryContactDraft | null;
  // Phase 4 Slice 6 — canonical brand patch + optional first service term, applied by the
  // caller after the organization is created/updated (brand → PATCH /:id/brand; term →
  // POST /:id/service-terms). Both null when the operator left them blank.
  brand: OrganizationBrandDraft | null;
  initialServiceTerm: OrganizationInitialServiceTermDraft | null;
};

type ContactEditorFormProps = FormProps & {
  initialValue?: Partial<OrganizationContactCreateInput & OrganizationContact>;
  ownerOptions?: DirectoryOwnerOption[];
  submitLabel: string;
  onUploadPhoto?: (file: File) => Promise<string>;
  onSubmit: (input: OrganizationContactCreateInput) => Promise<void> | void;
};

type LocationEditorFormProps = FormProps & {
  initialValue?: Partial<OrganizationLocationCreateInput>;
  submitLabel: string;
  onSubmit: (input: OrganizationLocationCreateInput) => Promise<void> | void;
};

type TouchpointComposerFormProps = FormProps & {
  contacts: OrganizationContact[];
  locations: OrganizationLocation[];
  shoots: Array<OrganizationRecentShoot | OrganizationUpcomingShoot>;
  initialContactId?: string | null;
  onSubmit: (input: DirectoryTouchpointCreateInput) => Promise<void> | void;
};

type OrganizationContactLinkFormProps = FormProps & {
  contacts: DirectoryContactSummary[];
  existingContactIds: string[];
  initialContactId?: string | null;
  onSubmit: (input: DirectoryRelationshipAttachInput) => Promise<void> | void;
};

type LocationAttachFormProps = FormProps & {
  contact: OrganizationContact;
  locations: OrganizationLocation[];
  onSubmit: (locationId: string, input: DirectoryRelationshipAttachInput) => Promise<void> | void;
};

type ShootAttachFormProps = FormProps & {
  contact: OrganizationContact;
  shoots: Array<OrganizationRecentShoot | OrganizationUpcomingShoot>;
  onSubmit: (shootId: string, input: DirectoryRelationshipAttachInput) => Promise<void> | void;
};

type DuplicateReviewFormProps = FormProps & {
  contacts: OrganizationContact[];
  initialPrimaryContactId?: string | null;
  onSubmit: (input: DirectoryDuplicateReviewCreateInput) => Promise<void> | void;
};

const ORGANIZATION_RELATIONSHIP_STATUS_OPTIONS = ["Active", "Prospect", "Returning Client", "At Risk", "Inactive"];
const FALLBACK_INTERNAL_OWNERS = ["Jessica", "Josh", "Spencer", "Dylan", "Greta", "Jared", "Matthew"];
const CONTACT_METHOD_OPTIONS = ["", "Email", "Phone", "Text", "No preference"];

export function OrganizationEditorForm({
  initialValue,
  ownerOptions = [],
  token,
  initialParentDistrictName,
  districtOptions = [],
  submitLabel,
  onUploadLogo,
  onSubmit,
  onCancel,
  submitting,
  error
}: OrganizationEditorFormProps) {
  const [canonicalName, setCanonicalName] = useState(initialValue?.canonical_name ?? "");
  const [displayName, setDisplayName] = useState(initialValue?.display_name ?? initialValue?.canonical_name ?? "");
  const [logoUrl, setLogoUrl] = useState(initialValue?.logo_url ?? "");
  const [accountType, setAccountType] = useState<OrganizationAccountType>(initialValue?.account_type ?? "schools_underclass_portraits");
  const [relationshipStatus, setRelationshipStatus] = useState(initialValue?.active_status === "inactive" ? "Inactive" : "Active");
  const [internalOwner, setInternalOwner] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactTitle, setPrimaryContactTitle] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [primaryContactPhone, setPrimaryContactPhone] = useState("");
  const [preferredContactMethod, setPreferredContactMethod] = useState("");
  const [logoStatus, setLogoStatus] = useState("");
  const [logoNotes, setLogoNotes] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [mascot, setMascot] = useState("");
  const [website, setWebsite] = useState(initialValue?.website ?? "");
  const [mainPhone, setMainPhone] = useState(initialValue?.main_phone ?? "");
  // Phase 4 canonical hierarchy fields.
  const [entityKind, setEntityKind] = useState<"account" | "parent_organization">(initialValue?.client_entity_kind ?? "account");
  const [parentDistrictId, setParentDistrictId] = useState(initialValue?.parent_organization_id ?? "");
  const [parentDistrictName, setParentDistrictName] = useState<string | null>(initialParentDistrictName ?? null);
  const [teamNotes, setTeamNotes] = useState(initialValue?.notes ?? "");
  const [operationsNotes, setOperationsNotes] = useState("");
  // Phase 4 Slice 6 — optional first service term, offered only when creating a school account.
  const [initialTermLabel, setInitialTermLabel] = useState("");
  const [initialTermType, setInitialTermType] = useState<"school_year" | "season" | "custom">("school_year");
  const [initialTermStart, setInitialTermStart] = useState("");
  const [initialTermEnd, setInitialTermEnd] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const ownerSelectOptions = ownerOptions.length ? ownerOptions.map((owner) => owner.full_name) : FALLBACK_INTERNAL_OWNERS;
  const isCreateMode = !initialValue;
  const offerInitialTerm = isCreateMode && entityKind === "account" && accountType.startsWith("schools");

  async function handleLogoSelected(file: File | null) {
    if (!file || !onUploadLogo) {
      return;
    }
    setUploadError("");
    setUploadingLogo(true);
    try {
      const nextUrl = await onUploadLogo(file);
      setLogoUrl(nextUrl);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : "We couldn't upload that logo right now.");
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        const primaryContact: OrganizationPrimaryContactDraft | null =
          primaryContactName.trim() ||
          primaryContactTitle.trim() ||
          primaryContactEmail.trim() ||
          primaryContactPhone.trim() ||
          preferredContactMethod.trim()
            ? {
                name: primaryContactName.trim(),
                title: primaryContactTitle.trim(),
                email: primaryContactEmail.trim(),
                phone: primaryContactPhone.trim(),
                preferredContactMethod: preferredContactMethod.trim()
              }
            : null;
        void onSubmit({
          canonical_name: canonicalName.trim(),
          display_name: displayName.trim() || canonicalName.trim(),
          logo_url: logoUrl.trim() || null,
          account_type: accountType,
          active_status: relationshipStatus === "Inactive" ? "inactive" : "active",
          aliases: initialValue?.aliases ?? [],
          // Phase 4: Website / Main Phone / hierarchy are canonical fields, not notes.
          website: website.trim() || null,
          main_phone: mainPhone.trim() || null,
          client_entity_kind: entityKind,
          parent_organization_id: entityKind === "parent_organization" ? null : parentDistrictId.trim() || null,
          notes: buildOrganizationNotes({
            relationshipStatus,
            internalOwner,
            teamNotes,
            operationsNotes
          })
        }, {
          primaryContact,
          brand: buildOrganizationBrandDraft({ primaryColor, secondaryColor, mascot, logoStatus, logoNotes }),
          initialServiceTerm:
            offerInitialTerm && initialTermLabel.trim()
              ? {
                  period_type: initialTermType,
                  period_label: initialTermLabel.trim(),
                  start_date: initialTermStart || null,
                  end_date: initialTermEnd || null
                }
              : null
        });
      }}
    >
      <fieldset className="directory-form__section">
        <legend>Basic Info</legend>
        <div className="directory-form__grid">
          <label className="directory-field">
            <span>Organization Name</span>
            <input value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} required />
          </label>
          <label className="directory-field">
            <span>Short Name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="directory-field">
            <span>Account Type</span>
            <select value={accountType} onChange={(event) => setAccountType(event.target.value as OrganizationAccountType)} required>
              {ACCOUNT_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="directory-field">
            <span>Entity Kind</span>
            <select
              aria-label="Entity Kind"
              value={entityKind}
              onChange={(event) => setEntityKind(event.target.value as "account" | "parent_organization")}
            >
              <option value="account">School / Account</option>
              <option value="parent_organization">District (parent organization)</option>
            </select>
          </label>
          {entityKind === "account" ? (
            <label className="directory-field">
              <span>Parent District</span>
              {token ? (
                <ParentDistrictSelector
                  token={token}
                  value={parentDistrictId}
                  initialName={parentDistrictName}
                  onChange={(districtId, districtName) => {
                    setParentDistrictId(districtId);
                    setParentDistrictName(districtName);
                  }}
                />
              ) : (
                <select aria-label="Parent District" value={parentDistrictId} onChange={(event) => setParentDistrictId(event.target.value)}>
                  <option value="">— None —</option>
                  {districtOptions.map((district) => (
                    <option key={district.id} value={district.id}>
                      {district.display_name}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ) : null}
          <label className="directory-field">
            <span>Status</span>
            <select value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value)}>
              {ORGANIZATION_RELATIONSHIP_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="directory-field directory-field--wide">
            <span>Logo</span>
            <input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="Paste an image URL or upload a file" />
            <div className="directory-upload-row">
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  void handleLogoSelected(event.target.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
              {uploadingLogo ? <span className="muted">Uploading logo...</span> : null}
            </div>
          </label>
          <label className="directory-field">
            <span>Logo Status</span>
            <select value={logoStatus} onChange={(event) => setLogoStatus(event.target.value)}>
              <option value="">Not recorded</option>
              <option value="Current">Current</option>
              <option value="Needs New Logo">Needs New Logo</option>
              <option value="Needs Review">Needs Review</option>
              <option value="Missing Logo">Missing Logo</option>
            </select>
          </label>
          <label className="directory-field directory-field--wide">
            <span>Logo Notes</span>
            <textarea value={logoNotes} onChange={(event) => setLogoNotes(event.target.value)} rows={2} placeholder="Example: Use athletic logo, not district seal." />
          </label>
          <label className="directory-field">
            <span>Internal Owner</span>
            <select value={internalOwner} onChange={(event) => setInternalOwner(event.target.value)}>
              <option value="">Not assigned</option>
              {ownerSelectOptions.map((ownerName) => (
                <option key={ownerName} value={ownerName}>
                  {ownerName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="directory-form__section">
        <legend>Primary Contact</legend>
        <p className="muted">Who is the main person connected to this organization?</p>
        <div className="directory-form__grid">
          <label className="directory-field">
            <span>Contact Name</span>
            <input value={primaryContactName} onChange={(event) => setPrimaryContactName(event.target.value)} />
          </label>
          <label className="directory-field">
            <span>Role / Title</span>
            <input value={primaryContactTitle} onChange={(event) => setPrimaryContactTitle(event.target.value)} />
          </label>
          <label className="directory-field">
            <span>Email</span>
            <input type="email" value={primaryContactEmail} onChange={(event) => setPrimaryContactEmail(event.target.value)} />
          </label>
          <label className="directory-field">
            <span>Phone</span>
            <input value={primaryContactPhone} onChange={(event) => setPrimaryContactPhone(event.target.value)} />
          </label>
          <label className="directory-field">
            <span>Preferred Contact Method</span>
            <select value={preferredContactMethod} onChange={(event) => setPreferredContactMethod(event.target.value)}>
              {CONTACT_METHOD_OPTIONS.map((option) => (
                <option key={option || "none"} value={option}>
                  {option || "No preference"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="directory-form__section">
        <legend>Brand</legend>
        <div className="directory-form__grid">
          <label className="directory-field">
            <span>Primary Color</span>
            <input value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} placeholder="Example: Navy" />
          </label>
          <label className="directory-field">
            <span>Secondary Color</span>
            <input value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value)} placeholder="Example: Gold" />
          </label>
          <label className="directory-field">
            <span>Mascot</span>
            <input value={mascot} onChange={(event) => setMascot(event.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="directory-form__section">
        <legend>Notes</legend>
        <div className="directory-form__grid">
          <label className="directory-field">
            <span>Website</span>
            {/* Phase 4.1: accept scheme-less input (school.org) — the server normalizes it to a
                canonical https URL on write (normalizeWebsite). type="url" would reject it. */}
            <input type="text" inputMode="url" value={website} placeholder="school.org" onChange={(event) => setWebsite(event.target.value)} />
          </label>
          <label className="directory-field">
            <span>Main Phone</span>
            <input value={mainPhone} onChange={(event) => setMainPhone(event.target.value)} />
          </label>
          <label className="directory-field directory-field--wide">
            <span>Team Notes</span>
            <textarea value={teamNotes} onChange={(event) => setTeamNotes(event.target.value)} rows={3} />
          </label>
          <label className="directory-field directory-field--wide">
            <span>Operations Notes</span>
            <textarea value={operationsNotes} onChange={(event) => setOperationsNotes(event.target.value)} rows={3} />
          </label>
        </div>
      </fieldset>

      {offerInitialTerm ? (
        <fieldset className="directory-form__section">
          <legend>First Service Term</legend>
          <p className="muted">Optionally start the school-year/season service record now. You can roll it over each year later.</p>
          <div className="directory-form__grid">
            <label className="directory-field">
              <span>Term Type</span>
              <select aria-label="Initial term type" value={initialTermType} onChange={(event) => setInitialTermType(event.target.value as "school_year" | "season" | "custom")}>
                <option value="school_year">School Year</option>
                <option value="season">Season</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="directory-field">
              <span>Period Label</span>
              <input aria-label="Initial term label" value={initialTermLabel} placeholder="2026–2027" onChange={(event) => setInitialTermLabel(event.target.value)} />
            </label>
            <label className="directory-field">
              <span>Start Date</span>
              <input type="date" aria-label="Initial term start date" value={initialTermStart} onChange={(event) => setInitialTermStart(event.target.value)} />
            </label>
            <label className="directory-field">
              <span>End Date</span>
              <input type="date" aria-label="Initial term end date" value={initialTermEnd} onChange={(event) => setInitialTermEnd(event.target.value)} />
            </label>
          </div>
        </fieldset>
      ) : null}

      {uploadError ? <p className="directory-form__error">{uploadError}</p> : null}
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || uploadingLogo || !canonicalName.trim()}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function buildOrganizationNotes(input: {
  relationshipStatus: string;
  internalOwner: string;
  teamNotes: string;
  operationsNotes: string;
}) {
  const sections: string[] = [];
  if (input.teamNotes.trim()) {
    sections.push(input.teamNotes.trim());
  }
  // Phase 4: Website / Main Phone are canonical columns (Slice 1) and brand
  // (colors / mascot / logo status / logo notes / logo date) is canonical brand truth
  // (Slice 3/6) written through PATCH /:id/brand — neither is packed into notes anymore.
  // Only operational, non-structured context (status, owner, operations notes) stays here.
  const details = [
    ["Status", input.relationshipStatus],
    ["Internal Owner", input.internalOwner],
    ["Operations Notes", input.operationsNotes]
  ]
    .map(([label, value]) => [label, value.trim()] as const)
    .filter(([, value]) => value);
  if (details.length) {
    sections.push(`Directory Details:\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}`);
  }
  return sections.length ? sections.join("\n\n") : null;
}

// Map the human logo-status select to the canonical logo_status enum (Slice 3 columns).
const LOGO_STATUS_TO_CANONICAL: Record<string, "current" | "outdated" | "pending_review" | "unavailable"> = {
  Current: "current",
  "Needs New Logo": "outdated",
  "Needs Review": "pending_review",
  "Missing Logo": "unavailable"
};

export type OrganizationBrandDraft = {
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
  mascot: string | null;
  brand_status: "known" | "unknown" | "not_available" | "not_applicable" | null;
  logo_status: "current" | "outdated" | "pending_review" | "unavailable" | null;
  logo_note: string | null;
};

// Build a canonical brand patch from the form's brand inputs; returns null when nothing
// brand-related was entered (so we never fire an empty brand PATCH).
function buildOrganizationBrandDraft(input: {
  primaryColor: string;
  secondaryColor: string;
  mascot: string;
  logoStatus: string;
  logoNotes: string;
}): OrganizationBrandDraft | null {
  const primary = input.primaryColor.trim();
  const secondary = input.secondaryColor.trim();
  const mascot = input.mascot.trim();
  const logoNote = input.logoNotes.trim();
  const logoStatus = LOGO_STATUS_TO_CANONICAL[input.logoStatus] ?? null;
  if (!primary && !secondary && !mascot && !logoNote && !logoStatus) {
    return null;
  }
  return {
    brand_primary_color: primary || null,
    brand_secondary_color: secondary || null,
    mascot: mascot || null,
    brand_status: primary || secondary || mascot ? "known" : null,
    logo_status: logoStatus,
    logo_note: logoNote || null
  };
}

export type OrganizationInitialServiceTermDraft = {
  period_type: "school_year" | "season" | "custom";
  period_label: string;
  start_date: string | null;
  end_date: string | null;
};

export function ContactEditorForm({
  initialValue,
  ownerOptions = [],
  submitLabel,
  onUploadPhoto,
  onSubmit,
  onCancel,
  submitting,
  error
}: ContactEditorFormProps) {
  const [firstName, setFirstName] = useState(initialValue?.first_name ?? "");
  const [lastName, setLastName] = useState(initialValue?.last_name ?? "");
  const [preferredName, setPreferredName] = useState(initialValue?.preferred_name ?? "");
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [departmentProgram, setDepartmentProgram] = useState(initialValue?.department_program ?? "");
  const [phone, setPhone] = useState(initialValue?.phone ?? "");
  const [email, setEmail] = useState(initialValue?.email ?? "");
  const [photoUrl, setPhotoUrl] = useState(initialValue?.photo_url ?? "");
  const [contactStatus, setContactStatus] = useState(initialValue?.contact_status ?? "active");
  const [roleCategory, setRoleCategory] = useState(initialValue?.role_category ?? "other");
  const [operationalImportance, setOperationalImportance] = useState(initialValue?.operational_importance ?? "normal");
  const [decisionInfluence, setDecisionInfluence] = useState(initialValue?.decision_influence ?? "informational_only");
  const [primaryInternalOwnerUserId, setPrimaryInternalOwnerUserId] = useState(initialValue?.primary_internal_owner?.user_id ?? "");
  const [backupInternalOwnerUserId, setBackupInternalOwnerUserId] = useState(initialValue?.backup_internal_owner?.user_id ?? "");
  const [relationshipStrength, setRelationshipStrength] = useState(initialValue?.relationship_strength ?? "unknown");
  const [handoffReady, setHandoffReady] = useState(Boolean(initialValue?.handoff_ready));
  const [lastConfirmedAt, setLastConfirmedAt] = useState(initialValue?.last_confirmed_at ?? "");
  const [uncertaintyFlag, setUncertaintyFlag] = useState(Boolean(initialValue?.uncertainty_flag));
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [validationError, setValidationError] = useState("");

  async function handlePhotoSelected(file: File | null) {
    if (!file || !onUploadPhoto) {
      return;
    }
    setUploadError("");
    setUploadingPhoto(true);
    try {
      const nextUrl = await onUploadPhoto(file);
      setPhotoUrl(nextUrl);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : "We couldn't upload that photo right now.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (primaryInternalOwnerUserId && backupInternalOwnerUserId && primaryInternalOwnerUserId === backupInternalOwnerUserId) {
          setValidationError("Choose different people for the primary and backup relationship owners.");
          return;
        }
        setValidationError("");
        void onSubmit({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          preferred_name: preferredName.trim() || null,
          title: title.trim() || null,
          department_program: departmentProgram.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          photo_url: photoUrl.trim() || null,
          contact_status: contactStatus,
          role_category: roleCategory,
          operational_importance: operationalImportance,
          decision_influence: decisionInfluence,
          primary_internal_owner_user_id: primaryInternalOwnerUserId || null,
          backup_internal_owner_user_id: backupInternalOwnerUserId || null,
          relationship_strength: relationshipStrength,
          handoff_ready: handoffReady,
          last_confirmed_at: lastConfirmedAt || null,
          uncertainty_flag: uncertaintyFlag,
          notes: notes.trim() || null
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field">
          <span>First name</span>
          <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
        </label>
        <label className="directory-field">
          <span>Last name</span>
          <input value={lastName} onChange={(event) => setLastName(event.target.value)} required />
        </label>
        <label className="directory-field">
          <span>Preferred name</span>
          <input value={preferredName} onChange={(event) => setPreferredName(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Role or title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Department or program</span>
          <input value={departmentProgram} onChange={(event) => setDepartmentProgram(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Phone</span>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <label className="directory-field">
          <span>Headshot or photo</span>
          <input value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Contact state</span>
          <select value={contactStatus} onChange={(event) => setContactStatus(event.target.value as typeof contactStatus)}>
            {CONTACT_STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Role category</span>
          <select value={roleCategory} onChange={(event) => setRoleCategory(event.target.value as typeof roleCategory)}>
            {CONTACT_ROLE_CATEGORY_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Operational importance</span>
          <select
            value={operationalImportance}
            onChange={(event) => setOperationalImportance(event.target.value as typeof operationalImportance)}
          >
            {OPERATIONAL_IMPORTANCE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Decision influence</span>
          <select value={decisionInfluence} onChange={(event) => setDecisionInfluence(event.target.value as typeof decisionInfluence)}>
            {DECISION_INFLUENCE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Relationship strength</span>
          <select value={relationshipStrength} onChange={(event) => setRelationshipStrength(event.target.value as typeof relationshipStrength)}>
            {RELATIONSHIP_STRENGTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Primary internal owner</span>
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
        <label className="directory-field">
          <span>Last confirmed</span>
          <input type="date" value={lastConfirmedAt} onChange={(event) => setLastConfirmedAt(event.target.value)} />
        </label>
        <label className="directory-field directory-field--checkbox">
          <input type="checkbox" checked={handoffReady} onChange={(event) => setHandoffReady(event.target.checked)} />
          <span>Handoff ready</span>
        </label>
        <label className="directory-field directory-field--checkbox">
          <input type="checkbox" checked={uncertaintyFlag} onChange={(event) => setUncertaintyFlag(event.target.checked)} />
          <span>Mark as uncertain / needs review</span>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Upload headshot</span>
          <div className="directory-upload-row">
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                void handlePhotoSelected(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            {uploadingPhoto ? <span className="muted">Uploading photo...</span> : null}
          </div>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Operational note</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
        </label>
      </div>
      {uploadError ? <p className="directory-form__error">{uploadError}</p> : null}
      {validationError ? <p className="directory-form__error">{validationError}</p> : null}
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || uploadingPhoto || !firstName.trim() || !lastName.trim()}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function LocationEditorForm({ initialValue, submitLabel, onSubmit, onCancel, submitting, error }: LocationEditorFormProps) {
  const [locationName, setLocationName] = useState(initialValue?.location_name ?? "");
  const [addressLine1, setAddressLine1] = useState(initialValue?.address_line_1 ?? "");
  const [addressLine2, setAddressLine2] = useState(initialValue?.address_line_2 ?? "");
  const [city, setCity] = useState(initialValue?.city ?? "");
  const [state, setState] = useState(initialValue?.state ?? "MN");
  const [zip, setZip] = useState(initialValue?.zip ?? "");
  const [mapsLabel, setMapsLabel] = useState(initialValue?.maps_label ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          location_name: locationName.trim(),
          address_line_1: addressLine1.trim(),
          address_line_2: addressLine2.trim() || null,
          city: city.trim(),
          state: state.trim(),
          zip: zip.trim(),
          maps_label: mapsLabel.trim() || null,
          notes: notes.trim() || null
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field">
          <span>Location name</span>
          <input value={locationName} onChange={(event) => setLocationName(event.target.value)} required />
        </label>
        <label className="directory-field">
          <span>Maps label</span>
          <input value={mapsLabel} onChange={(event) => setMapsLabel(event.target.value)} />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Address line 1</span>
          <input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Address line 2</span>
          <input value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>City</span>
          <input value={city} onChange={(event) => setCity(event.target.value)} required />
        </label>
        <label className="directory-field">
          <span>State</span>
          <input value={state} onChange={(event) => setState(event.target.value)} required />
        </label>
        <label className="directory-field">
          <span>ZIP</span>
          <input value={zip} onChange={(event) => setZip(event.target.value)} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Location notes</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !locationName.trim() || !addressLine1.trim() || !city.trim() || !state.trim() || !zip.trim()}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function TouchpointComposerForm({
  contacts,
  locations,
  shoots,
  initialContactId,
  onSubmit,
  onCancel,
  submitting,
  error
}: TouchpointComposerFormProps) {
  const [contactId, setContactId] = useState(initialContactId ?? "");
  const [locationId, setLocationId] = useState("");
  const [shootId, setShootId] = useState("");
  const [channel, setChannel] = useState<DirectoryTouchpointChannel>("call");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState("");
  const [occurredAt, setOccurredAt] = useState(toLocalDateTimeInputValue(new Date().toISOString()));
  const [followUpDate, setFollowUpDate] = useState("");

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
          summary: summary.trim(),
          outcome: outcome.trim() || null,
          occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
          follow_up_date: followUpDate || null
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field">
          <span>Channel</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value as DirectoryTouchpointChannel)}>
            {TOUCHPOINT_CHANNEL_OPTIONS.map((option) => (
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
          <span>Shoot</span>
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
          <span>Summary</span>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} required />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Outcome</span>
          <textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} rows={2} />
        </label>
        <label className="directory-field">
          <span>Occurred at</span>
          <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
        </label>
        <label className="directory-field">
          <span>Follow-up date</span>
          <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !summary.trim()}>
          {submitting ? "Saving..." : "Log touchpoint"}
        </button>
      </div>
    </form>
  );
}

export function OrganizationContactLinkForm({
  contacts,
  existingContactIds,
  initialContactId,
  onSubmit,
  onCancel,
  submitting,
  error
}: OrganizationContactLinkFormProps) {
  const availableContacts = useMemo(
    () => contacts.filter((contact) => !existingContactIds.includes(contact.id) || contact.id === initialContactId),
    [contacts, existingContactIds, initialContactId]
  );
  const [contactId, setContactId] = useState(initialContactId ?? availableContacts[0]?.id ?? "");
  const [relationshipRole, setRelationshipRole] = useState<DirectoryRelationshipAttachInput["relationship_role"]>("planning");
  const [isPrimary, setIsPrimary] = useState(false);

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          contact_id: contactId,
          relationship_role: relationshipRole,
          is_primary: isPrimary
        });
      }}
    >
      <div className="directory-form__grid">
        <label className="directory-field directory-field--wide">
          <span>Existing contact</span>
          <select value={contactId} onChange={(event) => setContactId(event.target.value)} required>
            <option value="" disabled>
              Choose a contact
            </option>
            {availableContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.full_name} - {contact.organization_display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Relationship role</span>
          <select
            value={relationshipRole}
            onChange={(event) => setRelationshipRole(event.target.value as DirectoryRelationshipAttachInput["relationship_role"])}
          >
            {RELATIONSHIP_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--checkbox">
          <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
          <span>Mark as primary relationship</span>
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !contactId}>
          {submitting ? "Saving..." : "Link contact"}
        </button>
      </div>
    </form>
  );
}

export function LocationAttachForm({ contact, locations, onSubmit, onCancel, submitting, error }: LocationAttachFormProps) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [relationshipRole, setRelationshipRole] = useState<DirectoryRelationshipAttachInput["relationship_role"]>("day_of");
  const [isPrimary, setIsPrimary] = useState(false);

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(locationId, {
          contact_id: contact.id,
          relationship_role: relationshipRole,
          is_primary: isPrimary
        });
      }}
    >
      <p className="muted">Attach {contact.full_name} to a location and preserve the relationship role instead of burying it in notes.</p>
      <div className="directory-form__grid">
        <label className="directory-field directory-field--wide">
          <span>Location</span>
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)} required>
            <option value="" disabled>
              Choose a location
            </option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.location_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Relationship role</span>
          <select
            value={relationshipRole}
            onChange={(event) => setRelationshipRole(event.target.value as DirectoryRelationshipAttachInput["relationship_role"])}
          >
            {RELATIONSHIP_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--checkbox">
          <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
          <span>Make primary for this location</span>
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !locationId}>
          {submitting ? "Saving..." : "Attach to location"}
        </button>
      </div>
    </form>
  );
}

export function ShootAttachForm({ contact, shoots, onSubmit, onCancel, submitting, error }: ShootAttachFormProps) {
  const [shootId, setShootId] = useState(shoots[0]?.id ?? "");
  const [relationshipRole, setRelationshipRole] = useState<DirectoryRelationshipAttachInput["relationship_role"]>("day_of");
  const [isPrimary, setIsPrimary] = useState(false);

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(shootId, {
          contact_id: contact.id,
          relationship_role: relationshipRole,
          is_primary: isPrimary
        });
      }}
    >
      <p className="muted">Attach {contact.full_name} to an upcoming or recent shoot so day-of ownership is visible instead of implied.</p>
      <div className="directory-form__grid">
        <label className="directory-field directory-field--wide">
          <span>Shoot</span>
          <select value={shootId} onChange={(event) => setShootId(event.target.value)} required>
            <option value="" disabled>
              Choose a shoot
            </option>
            {shoots.map((shoot) => (
              <option key={shoot.id} value={shoot.id}>
                {buildShootLabel(shoot)}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field">
          <span>Relationship role</span>
          <select
            value={relationshipRole}
            onChange={(event) => setRelationshipRole(event.target.value as DirectoryRelationshipAttachInput["relationship_role"])}
          >
            {RELATIONSHIP_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--checkbox">
          <input type="checkbox" checked={isPrimary} onChange={(event) => setIsPrimary(event.target.checked)} />
          <span>Make primary for this shoot</span>
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={submitting || !shootId}>
          {submitting ? "Saving..." : "Attach to shoot"}
        </button>
      </div>
    </form>
  );
}

export function DuplicateReviewForm({
  contacts,
  initialPrimaryContactId,
  onSubmit,
  onCancel,
  submitting,
  error
}: DuplicateReviewFormProps) {
  const [primaryContactId, setPrimaryContactId] = useState(initialPrimaryContactId ?? contacts[0]?.id ?? "");
  const availableSuspectedContacts = useMemo(
    () => contacts.filter((contact) => contact.id !== (initialPrimaryContactId ?? primaryContactId)),
    [contacts, initialPrimaryContactId, primaryContactId]
  );
  const [suspectedDuplicateContactId, setSuspectedDuplicateContactId] = useState(availableSuspectedContacts[0]?.id ?? "");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <form
      className="directory-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          primary_contact_id: initialPrimaryContactId ?? primaryContactId,
          suspected_duplicate_contact_id: suspectedDuplicateContactId,
          summary: summary.trim(),
          notes: notes.trim() || null
        });
      }}
    >
      <div className="directory-form__grid">
        {!initialPrimaryContactId ? (
          <label className="directory-field">
            <span>Primary record</span>
            <select value={primaryContactId} onChange={(event) => setPrimaryContactId(event.target.value)} required>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="directory-field">
          <span>Suspected duplicate</span>
          <select value={suspectedDuplicateContactId} onChange={(event) => setSuspectedDuplicateContactId(event.target.value)} required>
            <option value="" disabled>
              Choose a contact
            </option>
            {availableSuspectedContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="directory-field directory-field--wide">
          <span>Summary</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            placeholder="Why these records look like the same person"
            required
          />
        </label>
        <label className="directory-field directory-field--wide">
          <span>Notes</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
      </div>
      {error ? <p className="directory-form__error">{error}</p> : null}
      <div className="directory-form__actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !(initialPrimaryContactId ?? primaryContactId) || !suspectedDuplicateContactId || !summary.trim()}
        >
          {submitting ? "Saving..." : "Create duplicate review"}
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
