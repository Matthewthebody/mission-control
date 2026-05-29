import { useEffect, useMemo, useState } from "react";
import { OverlayPanel } from "../OverlayPanel";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import {
  ContactLookupField,
  DuplicateWarningPanel,
  IntakeActionBar,
  JobRoutingSection,
  LocationLookupField,
  NotesSection,
  OrganizationLookupField,
  ProductionStaffingSection,
  ReadinessPreviewPanel,
  ScheduleSection,
  SchoolsDetailSection,
  SportsDetailSection
} from "./JobIntakeFields";
import type {
  CentralJobDepartment,
  CentralJobDraftResponse,
  CentralJobDuplicateResult,
  CentralJobReadinessEvaluation,
  CentralJobSmartPasteEntityCandidate,
  CentralJobSmartPasteFieldInference,
  CentralJobSmartPasteParseResult,
  CentralJobValidationResult
} from "../../jobIntakeTypes";
import {
  createCentralJobDraft,
  extractCentralJobFormErrors,
  getCentralJobOrganizationDefaults,
  parseCentralJobIntakeText,
  previewCentralJobDuplicates,
  publishCentralJobDraft,
  updateCentralJobDraft
} from "../../services/centralJobIntakeApi";
import { getOrganizationDetail, listDirectoryOwnerOptions, listOrganizations } from "../../services/organizationApi";
import type { DirectoryOwnerOption, OrganizationDetail, OrganizationSummary, SessionUser } from "../../types";
import {
  applyParsedPayloadToForm,
  buildIntakePayload,
  buildLocalAutoTitle,
  countFieldErrors,
  createInitialFormState,
  type JobIntakeSharedFormState
} from "./jobIntakeFormState";

type Props = {
  open: boolean;
  token: string;
  currentUser: SessionUser;
  defaultDepartment: CentralJobDepartment;
  launchLabel: string;
  onClose: () => void;
  onPublished?: (jobId: string) => void;
};

type EntityConfirmationKey = "organization" | "location" | "primary_contact";

const LEADERSHIP_OVERRIDE_TIERS = new Set(["super_admin", "leadership", "director_admin", "supervisor"]);

function confidenceLabel(confidence: CentralJobSmartPasteFieldInference["confidence_band"]) {
  return confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : "Low confidence";
}

function formatParsedValue(field: CentralJobSmartPasteFieldInference) {
  if (field.display_value) {
    return field.display_value;
  }
  if (Array.isArray(field.value)) {
    return field.value.join(", ");
  }
  return field.value == null ? "No value" : String(field.value);
}

function buildPendingConfirmations(parseResult: CentralJobSmartPasteParseResult | null) {
  return {
    organization: Boolean(parseResult?.unresolved_entities.organization?.requires_confirmation),
    location: Boolean(parseResult?.unresolved_entities.location?.requires_confirmation),
    primary_contact: Boolean(parseResult?.unresolved_entities.primary_contact?.requires_confirmation)
  };
}

function entityCandidateValue(candidate: CentralJobSmartPasteEntityCandidate | null) {
  return candidate?.value ?? "";
}

export function SmartPasteJobDrawer({ open, token, currentUser, defaultDepartment, launchLabel, onClose, onPublished }: Props) {
  const [form, setForm] = useState<JobIntakeSharedFormState>(() => createInitialFormState(defaultDepartment, currentUser.id));
  const [draftId, setDraftId] = useState<string | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<DirectoryOwnerOption[]>([]);
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [organizationResults, setOrganizationResults] = useState<OrganizationSummary[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<OrganizationSummary | null>(null);
  const [organizationDetail, setOrganizationDetail] = useState<OrganizationDetail | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<CentralJobDuplicateResult | null>(null);
  const [readiness, setReadiness] = useState<CentralJobReadinessEvaluation | null>(null);
  const [publishValidation, setPublishValidation] = useState<CentralJobValidationResult | null>(null);
  const [parseResult, setParseResult] = useState<CentralJobSmartPasteParseResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [notice, setNotice] = useState("");
  const [softWarningAcknowledged, setSoftWarningAcknowledged] = useState(false);
  const [titleWasEdited, setTitleWasEdited] = useState(false);
  const [pendingConfirmations, setPendingConfirmations] = useState<Record<EntityConfirmationKey, boolean>>({
    organization: false,
    location: false,
    primary_contact: false
  });

  const canUseHardDuplicateOverride = useMemo(
    () => LEADERSHIP_OVERRIDE_TIERS.has(currentUser.authorityTier),
    [currentUser.authorityTier]
  );

  const organizationName = organizationDetail?.organization.display_name ?? selectedOrganization?.display_name ?? null;
  const locationOptions = organizationDetail?.locations ?? [];
  const contactOptions = organizationDetail?.contacts ?? [];
  const hasDraft = Boolean(draftId);
  const hasPendingConfirmations = Object.values(pendingConfirmations).some(Boolean);
  const publishDisabledMessage = hasPendingConfirmations
    ? "Confirm or clear the low-confidence linked-record candidates before publishing."
    : duplicateResult?.hard_block && !canUseHardDuplicateOverride
      ? "A lead or admin must override this hard duplicate before publishing."
      : duplicateResult?.soft_warning && !softWarningAcknowledged
        ? "Acknowledge the likely duplicate warning before publishing this job."
        : null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(createInitialFormState(defaultDepartment, currentUser.id));
    setDraftId(null);
    setOwnerOptions([]);
    setOrganizationSearch("");
    setLocationSearch("");
    setContactSearch("");
    setOrganizationResults([]);
    setSelectedOrganization(null);
    setOrganizationDetail(null);
    setDuplicateResult(null);
    setReadiness(null);
    setPublishValidation(null);
    setParseResult(null);
    setFieldErrors({});
    setFormErrors([]);
    setNotice("");
    setSoftWarningAcknowledged(false);
    setTitleWasEdited(false);
    setPendingConfirmations({
      organization: false,
      location: false,
      primary_contact: false
    });
  }, [currentUser.id, defaultDepartment, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoadingOwners(true);
    void listDirectoryOwnerOptions(token)
      .then((response) => {
        if (!cancelled) {
          setOwnerOptions(response.owners);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFormErrors((current) =>
            current.includes("We couldn't load owner options right now.")
              ? current
              : [...current, "We couldn't load owner options right now."]
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOwners(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const query = organizationSearch.trim();
    if (query.length < 2) {
      setOrganizationResults(selectedOrganization ? [selectedOrganization] : []);
      setLoadingOrganizations(false);
      return;
    }
    let cancelled = false;
    setLoadingOrganizations(true);
    void listOrganizations(token, { search: query, activeStatus: "active" })
      .then((response) => {
        if (!cancelled) {
          setOrganizationResults(response.organizations);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFormErrors((current) =>
            current.includes("We couldn't search organizations right now.")
              ? current
              : [...current, "We couldn't search organizations right now."]
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOrganizations(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, organizationSearch, selectedOrganization, token]);

  useEffect(() => {
    if (!open || titleWasEdited) {
      return;
    }
    setForm((current) => ({ ...current, job_title: buildLocalAutoTitle(current, organizationName, { respectExplicit: false }) }));
  }, [
    form.department,
    form.job_type,
    form.start_date,
    form.delivery_due_date,
    form.school_detail.school_job_type,
    form.sports_detail.sports_job_type,
    form.sports_detail.sport_name,
    form.unresolved_organization_name,
    open,
    organizationName,
    titleWasEdited
  ]);

  const routingIssueCount = countFieldErrors(fieldErrors, ["job_type", "job_owner_user_id", "job_title"]);
  const organizationIssueCount = countFieldErrors(fieldErrors, [
    "organization_id",
    "unresolved_organization_name",
    "location_id",
    "unresolved_location_name",
    "primary_contact_id",
    "unresolved_primary_contact_name"
  ]);
  const scheduleIssueCount = countFieldErrors(fieldErrors, ["start_date", "start_time", "timezone", "delivery_due_date"]);
  const schoolIssueCount = countFieldErrors(fieldErrors, [
    "school_detail.school_job_type",
    "school_detail.roster_status",
    "school_detail.id_sort_method",
    "school_detail.yearbook_due_date"
  ]);
  const sportsIssueCount = countFieldErrors(fieldErrors, [
    "sports_detail.sports_job_type",
    "sports_detail.sport_name",
    "sports_detail.specialty_product_types"
  ]);
  const productionIssueCount = countFieldErrors(fieldErrors, ["staffing_estimate"]);
  const notesIssueCount = countFieldErrors(fieldErrors, ["internal_notes"]);
  const parseIssueCount = (parseResult?.warnings.length ?? 0) + Object.values(pendingConfirmations).filter(Boolean).length;

  async function handleOrganizationSelect(organization: OrganizationSummary) {
    setPendingConfirmations((current) => ({ ...current, organization: false }));
    setSelectedOrganization(organization);
    setOrganizationDetail(null);
    setOrganizationSearch(organization.display_name);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.organization_id;
      delete next.unresolved_organization_name;
      delete next.location_id;
      delete next.primary_contact_id;
      return next;
    });
    setForm((current) => ({
      ...current,
      organization_id: organization.id,
      unresolved_organization_name: "",
      location_id: "",
      primary_contact_id: ""
    }));
    setLoadingDefaults(true);
    try {
      const [detail, defaults] = await Promise.all([
        getOrganizationDetail(token, organization.id),
        getCentralJobOrganizationDefaults(token, organization.id, form.department)
      ]);
      setOrganizationDetail(detail);
      setForm((current) => ({
        ...current,
        account_owner_user_id: defaults.account_owner_user_id ?? current.account_owner_user_id,
        location_id: defaults.default_location_id ?? current.location_id,
        unresolved_location_name: defaults.default_location_id ? "" : current.unresolved_location_name,
        primary_contact_id: defaults.default_primary_contact_id ?? current.primary_contact_id,
        unresolved_primary_contact_name: defaults.default_primary_contact_id ? "" : current.unresolved_primary_contact_name,
        timezone: defaults.timezone || current.timezone,
        production_required: defaults.production_required,
        staffing_required: defaults.staffing_required
      }));
      setNotice(`Organization defaults loaded for ${defaults.organization_name}.`);
    } catch (error) {
      const parsed = extractCentralJobFormErrors(error);
      setFieldErrors(parsed.fieldErrors);
      setFormErrors(parsed.formErrors);
    } finally {
      setLoadingDefaults(false);
    }
  }

  function handleFormChange(updater: (current: JobIntakeSharedFormState) => JobIntakeSharedFormState) {
    setForm((current) => updater(current));
    setDuplicateResult(null);
    setSoftWarningAcknowledged(false);
    setNotice("");
  }

  function applyDraftResponse(response: CentralJobDraftResponse) {
    setDraftId(response.job.id);
    setReadiness(response.readiness);
    setPublishValidation(response.publish_validation);
    if (!titleWasEdited) {
      setForm((current) => ({
        ...current,
        job_title: response.job.title,
        account_owner_user_id: response.job.account_owner_user_id ?? current.account_owner_user_id,
        job_owner_user_id: response.job.job_owner_user_id ?? current.job_owner_user_id,
        timezone: response.job.timezone || current.timezone
      }));
    }
  }

  async function runDuplicatePreview(nextDraftId: string) {
    try {
      const result = await previewCentralJobDuplicates(token, nextDraftId);
      setDuplicateResult(result);
      setSoftWarningAcknowledged(false);
      return result;
    } catch (error) {
      const parsed = extractCentralJobFormErrors(error);
      setFormErrors(parsed.formErrors);
      if (parsed.duplicateResult) {
        setDuplicateResult(parsed.duplicateResult);
      }
      return null;
    }
  }

  function assertManualConfirmations() {
    if (!hasPendingConfirmations) {
      return true;
    }
    const needs = [];
    if (pendingConfirmations.organization) {
      needs.push("organization");
    }
    if (pendingConfirmations.location) {
      needs.push("location");
    }
    if (pendingConfirmations.primary_contact) {
      needs.push("primary contact");
    }
    setFormErrors([
      `Confirm the low-confidence ${needs.join(", ")} candidate${needs.length === 1 ? "" : "s"} before saving or publishing.`
    ]);
    return false;
  }

  async function persistDraft(options: { quietNotice?: boolean } = {}) {
    if (!assertManualConfirmations()) {
      return null;
    }
    setSaving(true);
    setFieldErrors({});
    setFormErrors([]);
    try {
      const payload = buildIntakePayload(form, "smart_paste");
      const response = draftId
        ? await updateCentralJobDraft(token, draftId, payload)
        : await createCentralJobDraft(token, payload);
      applyDraftResponse(response);
      await runDuplicatePreview(response.job.id);
      if (!options.quietNotice) {
        setNotice(`${response.job.title} saved as a smart-paste draft.`);
      }
      return response;
    } catch (error) {
      const parsed = extractCentralJobFormErrors(error);
      setFieldErrors(parsed.fieldErrors);
      setFormErrors(parsed.formErrors);
      if (parsed.duplicateResult) {
        setDuplicateResult(parsed.duplicateResult);
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!assertManualConfirmations()) {
      return;
    }
    setPublishing(true);
    setFieldErrors({});
    setFormErrors([]);
    try {
      const response = await persistDraft({ quietNotice: true });
      if (!response) {
        return;
      }
      const duplicates = await runDuplicatePreview(response.job.id);
      if (duplicates?.soft_warning && !softWarningAcknowledged) {
        setFormErrors(["Review the likely duplicate warning and acknowledge it before publishing."]);
        return;
      }
      const result = await publishCentralJobDraft(token, response.job.id, {
        duplicate_override_note: form.duplicate_override_note.trim() || null
      });
      setNotice(`${result.intake.job.title} published.`);
      onPublished?.(result.intake.job.id);
      onClose();
    } catch (error) {
      const parsed = extractCentralJobFormErrors(error);
      setFieldErrors(parsed.fieldErrors);
      setFormErrors(parsed.formErrors);
      if (parsed.duplicateResult) {
        setDuplicateResult(parsed.duplicateResult);
      }
    } finally {
      setPublishing(false);
    }
  }

  async function handleParse() {
    const rawText = form.raw_source_text.trim();
    if (!rawText) {
      setFormErrors(["Paste the request text before running Smart Paste."]);
      return;
    }
    setParsing(true);
    setFieldErrors({});
    setFormErrors([]);
    setNotice("");
    try {
      const result = await parseCentralJobIntakeText(token, {
        raw_text: rawText,
        department_hint: defaultDepartment
      });
      setParseResult(result);
      setPendingConfirmations(buildPendingConfirmations(result));
      setSelectedOrganization(null);
      setOrganizationDetail(null);
      setForm((current) => applyParsedPayloadToForm(current, result.parsed_input, defaultDepartment));
      setOrganizationSearch(entityCandidateValue(result.unresolved_entities.organization));
      setLocationSearch(entityCandidateValue(result.unresolved_entities.location));
      setContactSearch(entityCandidateValue(result.unresolved_entities.primary_contact));
      setNotice("Smart Paste mapped the raw request into the shared intake form. Review the low-confidence items before saving.");
    } catch (error) {
      const parsed = extractCentralJobFormErrors(error);
      setFieldErrors(parsed.fieldErrors);
      setFormErrors(parsed.formErrors);
    } finally {
      setParsing(false);
    }
  }

  const displayOwnerOptions = useMemo(() => {
    if (ownerOptions.some((owner) => owner.user_id === currentUser.id)) {
      return ownerOptions;
    }
    return [
      ...ownerOptions,
      {
        user_id: currentUser.id,
        full_name: currentUser.fullName,
        email: currentUser.email,
        department: currentUser.department,
        status: currentUser.status
      }
    ];
  }, [currentUser.department, currentUser.email, currentUser.fullName, currentUser.id, currentUser.status, ownerOptions]);

  if (!open) {
    return null;
  }

  return (
    <OverlayPanel
      open={open}
      ariaLabel={`${launchLabel} smart paste job intake`}
      onClose={onClose}
      overlayClassName="job-intake-drawer-overlay"
      contentClassName="job-intake-drawer"
    >
      <div className="job-intake-drawer__layout">
        <header className="panel job-intake-drawer__header">
          <div>
            <div className="eyebrow">{launchLabel}</div>
            <h2>Smart Paste</h2>
            <p>
              Paste rough request text from email, chat, or notes. Smart Paste maps it into the same canonical intake
              structure, but it never auto-publishes and never silently creates linked records.
            </p>
          </div>
          <div className="job-intake-drawer__header-meta">
            <span className={`job-intake-launcher-card__badge job-intake-launcher-card__badge--${form.department}`}>
              {form.department === "schools" ? "Schools default" : "Sports default"}
            </span>
            {hasDraft ? <span className="workspace-page-header__meta-pill">Draft active</span> : null}
          </div>
        </header>

        {formErrors.length ? (
          <div className="error-banner" role="alert">
            {formErrors.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        ) : null}
        {notice ? <div className="job-intake__notice-banner">{notice}</div> : null}

        {loadingOwners && !displayOwnerOptions.length ? (
          <WorkspaceLoadingBlock
            title="Loading intake references"
            summary="Pulling owner options and shared lookup context for the Smart Paste drawer."
          />
        ) : null}

        <div className="job-intake-drawer__sections">
          <section className={`panel job-intake__section${parseIssueCount > 0 ? " job-intake__section--attention" : ""}`}>
            <WorkspaceSectionHeader
              title="Smart Paste Source"
              summary="Paste rough intake text here, then parse it into the same job draft structure used by Quick Create."
              badge={
                parseIssueCount > 0 ? (
                  <span className="job-intake__issue-badge">{parseIssueCount} issue{parseIssueCount === 1 ? "" : "s"}</span>
                ) : null
              }
            />
            <div className="job-intake__section-body">
              <label className="filter-field filter-field--wide">
                <span>Raw Request Text</span>
                <textarea
                  className="job-intake__parse-textarea"
                  rows={8}
                  value={form.raw_source_text}
                  onChange={(event) => handleFormChange((current) => ({ ...current, raw_source_text: event.target.value }))}
                  placeholder="Paste copied request text from email, chat, or operator notes."
                />
              </label>
              <WorkspaceActionBar align="start" className="job-intake__parse-actions">
                <button type="button" onClick={() => void handleParse()} disabled={parsing || !form.raw_source_text.trim()}>
                  {parsing ? "Parsing..." : "Parse"}
                </button>
              </WorkspaceActionBar>
              {parseResult?.warnings.length ? (
                <div className="job-intake__warning-strip" role="status">
                  {parseResult.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel job-intake__section">
            <WorkspaceSectionHeader
              title="Mapping Preview"
              summary={
                parseResult
                  ? "These are the fields Smart Paste inferred. Low-confidence items stay visible until a person confirms them."
                  : "Run Smart Paste to preview which fields were inferred before saving."
              }
            />
            <div className="job-intake__section-body">
              {parseResult?.inferred_fields.length ? (
                <div className="job-intake__parse-preview-list">
                  {parseResult.inferred_fields.map((field) => (
                    <article key={`${field.field}-${field.label}`} className="job-intake__parse-preview-item">
                      <div className="job-intake__parse-preview-head">
                        <strong>{field.label}</strong>
                        <span className={`job-intake__confidence-badge job-intake__confidence-badge--${field.confidence_band}`}>
                          {confidenceLabel(field.confidence_band)}
                        </span>
                      </div>
                      <div>{formatParsedValue(field)}</div>
                      {field.source_span?.text ? <div className="job-intake__helper">From: "{field.source_span.text}"</div> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="job-intake__helper">No mapped fields yet. Paste a request and run Smart Paste first.</div>
              )}
            </div>
          </section>

          <section className={`panel job-intake__section${hasPendingConfirmations ? " job-intake__section--warning" : ""}`}>
            <WorkspaceSectionHeader
              title="Unresolved Entity Matching"
              summary="Linked records never get created silently here. Confirm placeholders or resolve the canonical organization, location, and contact yourself."
            />
            <div className="job-intake__section-body">
              <div className="job-intake__entity-review-list">
                {(["organization", "location", "primary_contact"] as const).map((key) => {
                  const candidate = parseResult?.unresolved_entities[key] ?? null;
                  const resolvedValue =
                    key === "organization"
                      ? selectedOrganization?.display_name || form.unresolved_organization_name
                      : key === "location"
                        ? locationOptions.find((locationOption) => locationOption.id === form.location_id)?.location_name ||
                          form.unresolved_location_name
                        : contactOptions.find((contactOption) => contactOption.id === form.primary_contact_id)?.full_name ||
                          form.unresolved_primary_contact_name;
                  const isResolvedToRecord =
                    key === "organization" ? Boolean(form.organization_id) : key === "location" ? Boolean(form.location_id) : Boolean(form.primary_contact_id);
                  const pending = pendingConfirmations[key];
                  return (
                    <article key={key} className={`job-intake__entity-review-card${pending ? " is-pending" : ""}`}>
                      <div className="job-intake__parse-preview-head">
                        <strong>
                          {key === "organization" ? "Organization" : key === "location" ? "Location" : "Primary Contact"}
                        </strong>
                        {candidate ? (
                          <span className={`job-intake__confidence-badge job-intake__confidence-badge--${candidate.confidence_band}`}>
                            {confidenceLabel(candidate.confidence_band)}
                          </span>
                        ) : (
                          <span className="job-intake__confidence-badge job-intake__confidence-badge--neutral">No candidate</span>
                        )}
                      </div>
                      <div>{candidate?.value ?? "No parsed candidate"}</div>
                      <div className="job-intake__helper">
                        {isResolvedToRecord
                          ? `Resolved to canonical record: ${resolvedValue || "Selected"}`
                          : resolvedValue
                            ? pending
                              ? `Placeholder pending confirmation: ${resolvedValue}`
                              : `Placeholder confirmed: ${resolvedValue}`
                            : "Still unresolved."}
                      </div>
                      {candidate?.requires_confirmation && pending ? (
                        <div className="job-intake__entity-review-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setPendingConfirmations((current) => ({ ...current, [key]: false }));
                              setNotice(`Confirmed ${key.replace("_", " ")} placeholder from Smart Paste.`);
                            }}
                          >
                            Keep Placeholder
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setPendingConfirmations((current) => ({ ...current, [key]: false }));
                              if (key === "organization") {
                                handleFormChange((current) => ({
                                  ...current,
                                  organization_id: "",
                                  unresolved_organization_name: ""
                                }));
                                setOrganizationSearch("");
                              }
                              if (key === "location") {
                                handleFormChange((current) => ({
                                  ...current,
                                  location_id: "",
                                  unresolved_location_name: ""
                                }));
                                setLocationSearch("");
                              }
                              if (key === "primary_contact") {
                                handleFormChange((current) => ({
                                  ...current,
                                  primary_contact_id: "",
                                  unresolved_primary_contact_name: ""
                                }));
                                setContactSearch("");
                              }
                            }}
                          >
                            Clear Candidate
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <JobRoutingSection
            department={form.department}
            departmentLocked
            jobType={form.job_type}
            onJobTypeChange={(value) => handleFormChange((current) => ({ ...current, job_type: value }))}
            jobTitle={form.job_title}
            onJobTitleChange={(value) => {
              setTitleWasEdited(true);
              handleFormChange((current) => ({ ...current, job_title: value }));
            }}
            onResetAutoTitle={() => {
              setTitleWasEdited(false);
              handleFormChange((current) => ({
                ...current,
                job_title: buildLocalAutoTitle(current, organizationName, { respectExplicit: false })
              }));
            }}
            canResetAutoTitle={titleWasEdited}
            jobOwnerUserId={form.job_owner_user_id}
            onJobOwnerChange={(value) => handleFormChange((current) => ({ ...current, job_owner_user_id: value }))}
            ownerOptions={displayOwnerOptions}
            priority={form.priority}
            onPriorityChange={(value) => handleFormChange((current) => ({ ...current, priority: value }))}
            fieldErrors={fieldErrors}
            issueCount={routingIssueCount}
          />

          <section className={`panel job-intake__section${organizationIssueCount > 0 ? " job-intake__section--attention" : ""}`}>
            <WorkspaceSectionHeader
              title="Organization / Location / Contacts"
              summary="Resolve the linked account, location, and primary contact whenever possible. Draft placeholders are allowed until the real records are known."
              badge={organizationIssueCount > 0 ? <span className="job-intake__issue-badge">{organizationIssueCount} issue{organizationIssueCount === 1 ? "" : "s"}</span> : null}
            />
            <div className="job-intake__section-body">
              <div className="field-grid job-intake__grid">
                <OrganizationLookupField
                  department={form.department}
                  label="Organization"
                  searchValue={organizationSearch}
                  onSearchChange={setOrganizationSearch}
                  unresolvedValue={form.unresolved_organization_name}
                  onUnresolvedChange={(value) => {
                    setPendingConfirmations((current) => ({ ...current, organization: false }));
                    handleFormChange((current) => ({ ...current, unresolved_organization_name: value }));
                  }}
                  loading={loadingOrganizations}
                  results={organizationResults}
                  selectedOrganization={selectedOrganization}
                  onSelectOrganization={(organization) => {
                    void handleOrganizationSelect(organization);
                  }}
                  required
                  helperText="Resolve the real organization when possible. Use a placeholder only for draft intake."
                  errors={[...(fieldErrors.organization_id ?? []), ...(fieldErrors.unresolved_organization_name ?? [])]}
                />
                <LocationLookupField
                  label="Location"
                  searchValue={locationSearch}
                  onSearchChange={setLocationSearch}
                  unresolvedValue={form.unresolved_location_name}
                  onUnresolvedChange={(value) => {
                    setPendingConfirmations((current) => ({ ...current, location: false }));
                    handleFormChange((current) => ({ ...current, unresolved_location_name: value }));
                  }}
                  options={locationOptions}
                  selectedLocationId={form.location_id}
                  onSelectLocation={(value) => {
                    setPendingConfirmations((current) => ({ ...current, location: false }));
                    handleFormChange((current) => ({ ...current, location_id: value }));
                  }}
                  helperText={loadingDefaults ? "Applying organization defaults..." : undefined}
                  errors={[...(fieldErrors.location_id ?? []), ...(fieldErrors.unresolved_location_name ?? [])]}
                />
                <ContactLookupField
                  label="Primary Contact"
                  searchValue={contactSearch}
                  onSearchChange={setContactSearch}
                  unresolvedValue={form.unresolved_primary_contact_name}
                  onUnresolvedChange={(value) => {
                    setPendingConfirmations((current) => ({ ...current, primary_contact: false }));
                    handleFormChange((current) => ({ ...current, unresolved_primary_contact_name: value }));
                  }}
                  options={contactOptions}
                  selectedContactId={form.primary_contact_id}
                  onSelectContact={(value) => {
                    setPendingConfirmations((current) => ({ ...current, primary_contact: false }));
                    handleFormChange((current) => ({ ...current, primary_contact_id: value }));
                  }}
                  errors={[...(fieldErrors.primary_contact_id ?? []), ...(fieldErrors.unresolved_primary_contact_name ?? [])]}
                />
              </div>
            </div>
          </section>

          <ScheduleSection
            startDate={form.start_date}
            onStartDateChange={(value) => handleFormChange((current) => ({ ...current, start_date: value }))}
            startTime={form.start_time}
            onStartTimeChange={(value) => handleFormChange((current) => ({ ...current, start_time: value }))}
            endTime={form.end_time}
            onEndTimeChange={(value) => handleFormChange((current) => ({ ...current, end_time: value }))}
            timezone={form.timezone}
            onTimezoneChange={(value) => handleFormChange((current) => ({ ...current, timezone: value }))}
            dateOnly={form.date_only}
            onDateOnlyChange={(value) => handleFormChange((current) => ({ ...current, date_only: value }))}
            deliveryDueDate={form.delivery_due_date}
            onDeliveryDueDateChange={(value) => handleFormChange((current) => ({ ...current, delivery_due_date: value }))}
            fieldErrors={fieldErrors}
            issueCount={scheduleIssueCount}
          />

          {form.department === "schools" ? (
            <SchoolsDetailSection
              values={form.school_detail}
              onChange={(field, value) =>
                handleFormChange((current) => ({
                  ...current,
                  school_detail: {
                    ...current.school_detail,
                    [field]: value
                  }
                }))
              }
              fieldErrors={fieldErrors}
              issueCount={schoolIssueCount}
            />
          ) : (
            <SportsDetailSection
              values={form.sports_detail}
              onChange={(field, value) =>
                handleFormChange((current) => ({
                  ...current,
                  sports_detail: {
                    ...current.sports_detail,
                    [field]: value
                  }
                }))
              }
              fieldErrors={fieldErrors}
              issueCount={sportsIssueCount}
            />
          )}

          <ProductionStaffingSection
            productionRequired={form.production_required}
            onProductionRequiredChange={(value) => handleFormChange((current) => ({ ...current, production_required: value }))}
            staffingRequired={form.staffing_required}
            onStaffingRequiredChange={(value) => handleFormChange((current) => ({ ...current, staffing_required: value }))}
            staffingEstimate={form.staffing_estimate}
            onStaffingEstimateChange={(value) => handleFormChange((current) => ({ ...current, staffing_estimate: value }))}
            deliveryType={form.delivery_type}
            onDeliveryTypeChange={(value) => handleFormChange((current) => ({ ...current, delivery_type: value }))}
            groupingRule={form.production_grouping_rule}
            onGroupingRuleChange={(value) => handleFormChange((current) => ({ ...current, production_grouping_rule: value }))}
            fieldErrors={fieldErrors}
            issueCount={productionIssueCount}
          />

          <NotesSection
            internalNotes={form.internal_notes}
            onInternalNotesChange={(value) => handleFormChange((current) => ({ ...current, internal_notes: value }))}
            clientNotes={form.client_notes}
            onClientNotesChange={(value) => handleFormChange((current) => ({ ...current, client_notes: value }))}
            specialInstructions={form.special_instructions}
            onSpecialInstructionsChange={(value) => handleFormChange((current) => ({ ...current, special_instructions: value }))}
            rawSourceText={form.raw_source_text}
            onRawSourceTextChange={(value) => handleFormChange((current) => ({ ...current, raw_source_text: value }))}
            fieldErrors={fieldErrors}
            issueCount={notesIssueCount}
            showRawSourceText={false}
            helperText="Attachments stay visible as a later-phase seam. The pasted source text stays in the dedicated Smart Paste section above and is preserved on the job."
          />

          <DuplicateWarningPanel
            duplicateResult={duplicateResult}
            softWarningAcknowledged={softWarningAcknowledged}
            onSoftWarningAcknowledgedChange={setSoftWarningAcknowledged}
            duplicateOverrideNote={form.duplicate_override_note}
            onDuplicateOverrideNoteChange={(value) => handleFormChange((current) => ({ ...current, duplicate_override_note: value }))}
            canUseHardDuplicateOverride={canUseHardDuplicateOverride}
          />

          <ReadinessPreviewPanel readiness={readiness} publishValidation={publishValidation} />
        </div>

        <IntakeActionBar
          hasDraft={hasDraft}
          saving={saving}
          publishing={publishing}
          publishDisabled={Boolean(publishDisabledMessage)}
          publishDisabledMessage={publishDisabledMessage}
          onSaveDraft={() => {
            void persistDraft();
          }}
          onPublish={() => {
            void handlePublish();
          }}
          onClose={onClose}
        />
      </div>
    </OverlayPanel>
  );
}
