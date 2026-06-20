import { useEffect, useMemo, useState } from "react";
import { OverlayPanel } from "../OverlayPanel";
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
  CentralJobIntakeInput,
  CentralJobReadinessEvaluation,
  CentralJobValidationResult
} from "../../jobIntakeTypes";
import {
  createCentralJobDraft,
  extractCentralJobFormErrors,
  getCentralJobDraft,
  getCentralJobOrganizationDefaults,
  previewCentralJobDuplicates,
  publishCentralJobDraft,
  updateCentralJobDraft
} from "../../services/centralJobIntakeApi";
import { getOrganizationDetail, listDirectoryOwnerOptions, listOrganizations, listSchoolServiceTerms } from "../../services/organizationApi";
import type { DirectoryOwnerOption, OrganizationDetail, OrganizationSummary, SchoolServiceTermRecord, SessionUser } from "../../types";
import { JobIntakeCanonicalContext } from "./JobIntakeCanonicalContext";
import {
  buildIntakePayload,
  buildFormStateFromDraftResponse,
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
  resumeDraftId?: string | null;
  onClose: () => void;
  onPublished?: (jobId: string) => void;
};

const LEADERSHIP_OVERRIDE_TIERS = new Set(["super_admin", "leadership", "director_admin", "supervisor"]);

export function QuickCreateJobDrawer({
  open,
  token,
  currentUser,
  defaultDepartment,
  launchLabel,
  resumeDraftId = null,
  onClose,
  onPublished
}: Props) {
  const [form, setForm] = useState<JobIntakeSharedFormState>(() => createInitialFormState(defaultDepartment, currentUser.id));
  const [draftId, setDraftId] = useState<string | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<DirectoryOwnerOption[]>([]);
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [organizationResults, setOrganizationResults] = useState<OrganizationSummary[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<OrganizationSummary | null>(null);
  const [organizationDetail, setOrganizationDetail] = useState<OrganizationDetail | null>(null);
  // Phase 4 Slice F — canonical current service term for the selected school account.
  const [currentServiceTerm, setCurrentServiceTerm] = useState<SchoolServiceTermRecord | null>(null);
  const [loadingServiceTerm, setLoadingServiceTerm] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState<CentralJobDuplicateResult | null>(null);
  const [readiness, setReadiness] = useState<CentralJobReadinessEvaluation | null>(null);
  const [publishValidation, setPublishValidation] = useState<CentralJobValidationResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [notice, setNotice] = useState("");
  const [softWarningAcknowledged, setSoftWarningAcknowledged] = useState(false);
  const [titleWasEdited, setTitleWasEdited] = useState(false);

  const canUseHardDuplicateOverride = useMemo(
    () => LEADERSHIP_OVERRIDE_TIERS.has(currentUser.authorityTier),
    [currentUser.authorityTier]
  );

  const organizationName = organizationDetail?.organization.display_name ?? selectedOrganization?.display_name ?? null;
  const locationOptions = organizationDetail?.locations ?? [];
  const contactOptions = organizationDetail?.contacts ?? [];
  const hasDraft = Boolean(draftId);
  const publishDisabledMessage =
    duplicateResult?.hard_block && !canUseHardDuplicateOverride
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
    setCurrentServiceTerm(null);
    setDuplicateResult(null);
    setReadiness(null);
    setPublishValidation(null);
    setFieldErrors({});
    setFormErrors([]);
    setNotice("");
    setSoftWarningAcknowledged(false);
    setTitleWasEdited(false);
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
    if (!open || !resumeDraftId) {
      return;
    }
    let cancelled = false;
    setLoadingDraft(true);
    setFieldErrors({});
    setFormErrors([]);
    setNotice("");
    void getCentralJobDraft(token, resumeDraftId)
      .then(async (response) => {
        if (cancelled) {
          return;
        }
        setDraftId(response.job.id);
        setForm(buildFormStateFromDraftResponse(response, defaultDepartment, currentUser.id));
        setReadiness(response.readiness);
        setPublishValidation(response.publish_validation);
        setTitleWasEdited(Boolean(response.job.title?.trim()));
        setOrganizationSearch(response.job.organization_display_name ?? response.job.unresolved_organization_name ?? "");
        setLocationSearch(response.job.location_display_name ?? response.job.unresolved_location_name ?? "");
        setContactSearch(response.job.primary_contact_name ?? response.job.unresolved_primary_contact_name ?? "");
        if (response.job.organization_id) {
          const detail = await getOrganizationDetail(token, response.job.organization_id);
          if (cancelled) {
            return;
          }
          setSelectedOrganization(detail.organization);
          setOrganizationDetail(detail);
          void loadCurrentServiceTerm(detail.organization);
        } else {
          setSelectedOrganization(null);
          setOrganizationDetail(null);
          setCurrentServiceTerm(null);
        }
        await runDuplicatePreview(response.job.id);
        if (!cancelled) {
          setNotice(`Resumed draft ${response.job.title}.`);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const parsed = extractCentralJobFormErrors(error);
        setFieldErrors(parsed.fieldErrors);
        setFormErrors(parsed.formErrors);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDraft(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, defaultDepartment, open, resumeDraftId, token]);

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

  async function loadCurrentServiceTerm(organization: OrganizationSummary) {
    // Only school accounts carry school-year/season service terms.
    if (!organization.account_type.startsWith("schools") || organization.client_entity_kind === "parent_organization") {
      setCurrentServiceTerm(null);
      return;
    }
    setLoadingServiceTerm(true);
    try {
      const response = await listSchoolServiceTerms(token, organization.id);
      setCurrentServiceTerm(response.service_terms.find((term) => term.status === "current") ?? null);
    } catch {
      setCurrentServiceTerm(null);
    } finally {
      setLoadingServiceTerm(false);
    }
  }

  async function handleOrganizationSelect(organization: OrganizationSummary) {
    setSelectedOrganization(organization);
    setOrganizationDetail(null);
    setCurrentServiceTerm(null);
    setOrganizationSearch(organization.display_name);
    setLocationSearch("");
    setContactSearch("");
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
      unresolved_location_name: "",
      primary_contact_id: "",
      unresolved_primary_contact_name: ""
    }));
    setLoadingDefaults(true);
    try {
      const [detail, defaults] = await Promise.all([
        getOrganizationDetail(token, organization.id),
        getCentralJobOrganizationDefaults(token, organization.id, form.department)
      ]);
      setOrganizationDetail(detail);
      void loadCurrentServiceTerm(organization);
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

  function buildPayload(): CentralJobIntakeInput {
    return buildIntakePayload(form, "manual");
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

  async function persistDraft(options: { quietNotice?: boolean } = {}) {
    setSaving(true);
    setFieldErrors({});
    setFormErrors([]);
    try {
      const payload = buildPayload();
      const response = draftId
        ? await updateCentralJobDraft(token, draftId, payload)
        : await createCentralJobDraft(token, payload);
      applyDraftResponse(response);
      await runDuplicatePreview(response.job.id);
      if (!options.quietNotice) {
        setNotice(`${response.job.title} saved as a draft.`);
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
      ariaLabel={`${launchLabel} quick create job intake`}
      onClose={onClose}
      overlayClassName="job-intake-drawer-overlay"
      contentClassName="job-intake-drawer"
    >
      <div className="job-intake-drawer__layout">
        <header className="panel job-intake-drawer__header">
          <div>
            <div className="eyebrow">{launchLabel}</div>
            <h2>Quick Create</h2>
            <p>
              Start a canonical {form.department === "schools" ? "school" : "sports"} job draft here. Save Draft and
              Publish both hit the same shared intake backend.
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
            summary="Pulling owner options and shared lookup context for the quick-create drawer."
          />
        ) : null}

        {loadingDraft ? (
          <WorkspaceLoadingBlock
            title="Loading saved draft"
            summary="Pulling the saved draft, linked directory context, and duplicate preview back into the intake drawer."
          />
        ) : null}

        <div className="job-intake-drawer__sections" aria-busy={loadingDraft}>
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
                  onUnresolvedChange={(value) =>
                    handleFormChange((current) => ({ ...current, unresolved_organization_name: value }))
                  }
                  loading={loadingOrganizations}
                  results={organizationResults}
                  selectedOrganization={selectedOrganization}
                  onSelectOrganization={(organization) => {
                    void handleOrganizationSelect(organization);
                  }}
                  required
                  helperText="Resolve the real organization when possible. Use a placeholder only for draft intake."
                  errors={[
                    ...(fieldErrors.organization_id ?? []),
                    ...(fieldErrors.unresolved_organization_name ?? [])
                  ]}
                />
                <LocationLookupField
                  label="Location"
                  searchValue={locationSearch}
                  onSearchChange={setLocationSearch}
                  unresolvedValue={form.unresolved_location_name}
                  onUnresolvedChange={(value) =>
                    handleFormChange((current) => ({ ...current, unresolved_location_name: value }))
                  }
                  options={locationOptions}
                  selectedLocationId={form.location_id}
                  onSelectLocation={(value) => handleFormChange((current) => ({ ...current, location_id: value }))}
                  helperText={loadingDefaults ? "Applying organization defaults..." : undefined}
                  errors={[...(fieldErrors.location_id ?? []), ...(fieldErrors.unresolved_location_name ?? [])]}
                />
                <ContactLookupField
                  label="Primary Contact"
                  searchValue={contactSearch}
                  onSearchChange={setContactSearch}
                  unresolvedValue={form.unresolved_primary_contact_name}
                  onUnresolvedChange={(value) =>
                    handleFormChange((current) => ({ ...current, unresolved_primary_contact_name: value }))
                  }
                  options={contactOptions}
                  selectedContactId={form.primary_contact_id}
                  onSelectContact={(value) =>
                    handleFormChange((current) => ({ ...current, primary_contact_id: value }))
                  }
                  errors={[
                    ...(fieldErrors.primary_contact_id ?? []),
                    ...(fieldErrors.unresolved_primary_contact_name ?? [])
                  ]}
                />
              </div>
              <JobIntakeCanonicalContext
                organizationDetail={organizationDetail}
                currentServiceTerm={currentServiceTerm}
                loadingServiceTerm={loadingServiceTerm}
              />
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
            onProductionRequiredChange={(value) =>
              handleFormChange((current) => ({ ...current, production_required: value }))
            }
            staffingRequired={form.staffing_required}
            onStaffingRequiredChange={(value) => handleFormChange((current) => ({ ...current, staffing_required: value }))}
            staffingEstimate={form.staffing_estimate}
            onStaffingEstimateChange={(value) => handleFormChange((current) => ({ ...current, staffing_estimate: value }))}
            deliveryType={form.delivery_type}
            onDeliveryTypeChange={(value) => handleFormChange((current) => ({ ...current, delivery_type: value }))}
            groupingRule={form.production_grouping_rule}
            onGroupingRuleChange={(value) =>
              handleFormChange((current) => ({ ...current, production_grouping_rule: value }))
            }
            fieldErrors={fieldErrors}
            issueCount={productionIssueCount}
          />

          <NotesSection
            internalNotes={form.internal_notes}
            onInternalNotesChange={(value) => handleFormChange((current) => ({ ...current, internal_notes: value }))}
            clientNotes={form.client_notes}
            onClientNotesChange={(value) => handleFormChange((current) => ({ ...current, client_notes: value }))}
            specialInstructions={form.special_instructions}
            onSpecialInstructionsChange={(value) =>
              handleFormChange((current) => ({ ...current, special_instructions: value }))
            }
            rawSourceText={form.raw_source_text}
            onRawSourceTextChange={(value) => handleFormChange((current) => ({ ...current, raw_source_text: value }))}
            fieldErrors={fieldErrors}
            issueCount={notesIssueCount}
          />

          <DuplicateWarningPanel
            duplicateResult={duplicateResult}
            softWarningAcknowledged={softWarningAcknowledged}
            onSoftWarningAcknowledgedChange={setSoftWarningAcknowledged}
            duplicateOverrideNote={form.duplicate_override_note}
            onDuplicateOverrideNoteChange={(value) =>
              handleFormChange((current) => ({ ...current, duplicate_override_note: value }))
            }
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
