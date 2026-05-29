import { useEffect, useMemo, useRef, useState } from "react";
import {
  createOrganizationAgreementFromTemplateRecord,
  createOrganizationAgreementRecord,
  createOrganizationAgreementRenewalDraft,
  createOrganizationAgreementTemplateRecord,
  sendOrganizationAgreementForSignature,
  sendOrganizationAgreementReminder,
  syncOrganizationAgreementProviderStatus,
  updateOrganizationAgreementRecord,
  uploadOrganizationAgreementFile
} from "../services/organizationApi";
import type {
  AgreementActivityType,
  AgreementFileType,
  AgreementLifecycleBucket,
  AgreementProviderLifecycleBucket,
  AgreementRecord,
  AgreementReminderType,
  AgreementSignerStatus,
  AgreementSignerType,
  AgreementStatus,
  AgreementType,
  AgreementVersionStage,
  AgreementWarningSeverity,
  OrganizationDetail
} from "../types";
import { OperationalDetailSection } from "./OperationalDetailSection";
import { OperationalPreviewCard } from "./OperationalPreviewCard";

type Props = {
  token: string;
  detail: OrganizationDetail;
  canManage: boolean;
  onDetailUpdated: (detail: OrganizationDetail) => void;
};

type SignerFormState = {
  contact_id: string;
  signer_name: string;
  signer_email: string;
  signer_role: string;
  signer_order: number;
  signer_type: AgreementSignerType;
  status: AgreementSignerStatus;
};

type AgreementFormState = {
  agreement_title: string;
  agreement_type: AgreementType;
  status: AgreementStatus;
  primary_contact_id: string;
  description: string;
  contract_value: string;
  revenue_share_terms: string;
  effective_date: string;
  expiration_date: string;
  renewal_date: string;
  notice_deadline: string;
  auto_renew: boolean;
  sent_at: string;
  viewed_at: string;
  signed_at: string;
  countersigned_at: string;
  prior_agreement_id: string;
  replaced_by_agreement_id: string;
  linked_contact_ids: string[];
  linked_location_ids: string[];
  signers: SignerFormState[];
  note: string;
};

type TemplateFormState = {
  template_name: string;
  agreement_type: AgreementType;
  active_status: boolean;
  template_body: string;
  template_file_reference: string;
  merge_fields: string;
};

type TemplateDraftFormState = {
  template_id: string;
  agreement_title: string;
  primary_contact_id: string;
  description: string;
  contract_value: string;
  revenue_share_terms: string;
  effective_date: string;
  expiration_date: string;
  renewal_date: string;
  notice_deadline: string;
  auto_renew: boolean;
  linked_contact_ids: string[];
  linked_location_ids: string[];
  signers: SignerFormState[];
  note: string;
};

type RenewalFormState = {
  agreement_title: string;
  effective_date: string;
  expiration_date: string;
  renewal_date: string;
  notice_deadline: string;
  auto_renew: boolean;
  note: string;
};

type ReminderFormState = {
  reminder_type: AgreementReminderType;
  note: string;
};

type AgreementOperationalView = "all" | "needs_signature" | "expiring_soon" | "renewals_needed" | "upcoming_shoot_risk";

type FileUploadState = {
  version_label: string;
  version_stage: AgreementVersionStage;
  activity_note: string;
  is_current: boolean;
  legacy_upload: boolean;
  file: File | null;
};

const AGREEMENT_TYPE_OPTIONS: Array<{ value: AgreementType | "all"; label: string }> = [
  { value: "all", label: "All Types" },
  { value: "schools", label: "Schools" },
  { value: "sports", label: "Sports" },
  { value: "events", label: "Events" },
  { value: "studio_client", label: "Studio / Client Agreements" },
  { value: "nda", label: "NDAs" },
  { value: "image_release", label: "Image Release Agreements" }
];

const AGREEMENT_STATUS_OPTIONS: Array<{ value: AgreementStatus | "all"; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "viewed", label: "Viewed" },
  { value: "partially_signed", label: "Partially Signed" },
  { value: "signed", label: "Signed" },
  { value: "countersigned", label: "Countersigned" },
  { value: "active", label: "Active" },
  { value: "expiring_soon", label: "Expiring Soon" },
  { value: "expired", label: "Expired" },
  { value: "replaced", label: "Replaced" },
  { value: "cancelled", label: "Cancelled" }
];

const LIFECYCLE_OPTIONS: Array<{ value: AgreementLifecycleBucket | "all"; label: string }> = [
  { value: "all", label: "All Buckets" },
  { value: "active", label: "Active" },
  { value: "pending_signature", label: "Pending Signature" },
  { value: "expiring_soon", label: "Expiring Soon" },
  { value: "expired", label: "Expired" },
  { value: "replaced_archived", label: "Replaced / Archived" }
];

const PROVIDER_LIFECYCLE_OPTIONS: Array<{ value: AgreementProviderLifecycleBucket | "issue" | "all"; label: string }> = [
  { value: "all", label: "All Send States" },
  { value: "sent_unsigned", label: "Sent But Unsigned" },
  { value: "viewed_not_signed", label: "Viewed Not Signed" },
  { value: "partially_signed", label: "Partially Signed" },
  { value: "countersign_pending", label: "Countersign Pending" },
  { value: "issue", label: "Send / Sync Issue" }
];

const SIGNER_TYPE_OPTIONS: Array<{ value: AgreementSignerType; label: string }> = [
  { value: "external", label: "External Signer" },
  { value: "internal", label: "Internal Signer" },
  { value: "countersigner", label: "Countersigner" }
];

const SIGNER_STATUS_OPTIONS: Array<{ value: AgreementSignerStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "viewed", label: "Viewed" },
  { value: "signed", label: "Signed" },
  { value: "replaced", label: "Replaced" },
  { value: "cancelled", label: "Cancelled" }
];

const VERSION_STAGE_OPTIONS: Array<{ value: AgreementVersionStage; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "revised", label: "Revised" },
  { value: "signed", label: "Signed" },
  { value: "countersigned_final", label: "Countersigned Final" },
  { value: "legacy_import", label: "Legacy Import" }
];

const REMINDER_TYPE_OPTIONS: Array<{ value: AgreementReminderType; label: string }> = [
  { value: "unsigned_3_day", label: "Unsigned 3 Day" },
  { value: "unsigned_7_day", label: "Unsigned 7 Day" },
  { value: "unsigned_30_day", label: "Unsigned 30 Day" },
  { value: "expiration_6_month", label: "Expiration 6 Month" },
  { value: "expiration_90_day", label: "Expiration 90 Day" },
  { value: "expiration_30_day", label: "Expiration 30 Day" },
  { value: "manual_follow_up", label: "Manual Follow-Up" }
];

const EMPTY_FILE_UPLOAD: FileUploadState = {
  version_label: "",
  version_stage: "revised",
  activity_note: "",
  is_current: true,
  legacy_upload: false,
  file: null
};

export function OrganizationAgreementsPanel({ token, detail, canManage, onDetailUpdated }: Props) {
  const [search, setSearch] = useState("");
  const [agreementType, setAgreementType] = useState<AgreementType | "all">("all");
  const [agreementStatus, setAgreementStatus] = useState<AgreementStatus | "all">("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<AgreementLifecycleBucket | "all">("all");
  const [providerLifecycleFilter, setProviderLifecycleFilter] = useState<AgreementProviderLifecycleBucket | "issue" | "all">("all");
  const [operationalView, setOperationalView] = useState<AgreementOperationalView>("all");
  const [selectedAgreementId, setSelectedAgreementId] = useState<string | null>(detail.agreements[0]?.id ?? null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [showTemplateDraftForm, setShowTemplateDraftForm] = useState(false);
  const [createForm, setCreateForm] = useState<AgreementFormState>(() => emptyAgreementForm(detail));
  const [editForm, setEditForm] = useState<AgreementFormState>(() =>
    detail.agreements[0] ? buildAgreementForm(detail.agreements[0]) : emptyAgreementForm(detail)
  );
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm());
  const [templateDraftForm, setTemplateDraftForm] = useState<TemplateDraftFormState>(() => emptyTemplateDraftForm(detail));
  const [renewalForm, setRenewalForm] = useState<RenewalFormState>(emptyRenewalForm());
  const [reminderForm, setReminderForm] = useState<ReminderFormState>({ reminder_type: "manual_follow_up", note: "" });
  const [fileUpload, setFileUpload] = useState<FileUploadState>(EMPTY_FILE_UPLOAD);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [sendingForSignature, setSendingForSignature] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState(false);
  const [creatingRenewal, setCreatingRenewal] = useState(false);
  const [error, setError] = useState("");
  const upcomingShootRiskRef = useRef<HTMLDivElement | null>(null);

  const agreements = useMemo(() => {
    const normalizedSearch = normalizeAgreementText(search);
    return detail.agreements.filter((agreement) => {
      const matchesType = agreementType === "all" || agreement.agreement_type === agreementType;
      const matchesStatus = agreementStatus === "all" || agreement.status === agreementStatus;
      const matchesLifecycle = lifecycleFilter === "all" || agreement.lifecycle_bucket === lifecycleFilter;
      const matchesOperationalView =
        operationalView === "all"
          ? true
          : operationalView === "needs_signature"
            ? agreement.lifecycle_bucket === "pending_signature"
            : operationalView === "expiring_soon"
              ? agreement.lifecycle_bucket === "expiring_soon"
              : operationalView === "renewals_needed"
                ? agreement.warning_codes.includes("renewal_needed")
                : true;
      const matchesProviderLifecycle =
        providerLifecycleFilter === "all"
          ? true
          : providerLifecycleFilter === "issue"
            ? agreement.provider_sync_health === "error"
            : agreement.provider_lifecycle_bucket === providerLifecycleFilter;
      const matchesSearch =
        !normalizedSearch ||
        normalizeAgreementText(
          [
            agreement.agreement_title,
            agreement.primary_contact_name ?? "",
            agreement.description ?? "",
            agreement.warning_summary ?? "",
            agreement.source_template_name ?? "",
            agreement.external_status ?? "",
            agreement.external_provider_name ?? ""
          ].join(" ")
        ).includes(normalizedSearch);
      return matchesType && matchesStatus && matchesLifecycle && matchesOperationalView && matchesProviderLifecycle && matchesSearch;
    });
  }, [agreementStatus, agreementType, detail.agreements, lifecycleFilter, operationalView, providerLifecycleFilter, search]);

  const selectedAgreement = useMemo(
    () => agreements.find((agreement) => agreement.id === selectedAgreementId) ?? agreements[0] ?? null,
    [agreements, selectedAgreementId]
  );

  useEffect(() => {
    if (!agreements.some((agreement) => agreement.id === selectedAgreementId)) {
      setSelectedAgreementId(agreements[0]?.id ?? null);
    }
  }, [agreements, selectedAgreementId]);

  useEffect(() => {
    setCreateForm(emptyAgreementForm(detail));
    setTemplateDraftForm(emptyTemplateDraftForm(detail));
  }, [detail]);

  useEffect(() => {
    if (!selectedAgreement) {
      return;
    }
    setEditForm(buildAgreementForm(selectedAgreement));
    setRenewalForm(buildRenewalForm(selectedAgreement));
    setReminderForm({ reminder_type: selectedAgreement.due_reminders[0] ?? "manual_follow_up", note: "" });
    setFileUpload({
      ...EMPTY_FILE_UPLOAD,
      version_label: `${selectedAgreement.agreement_title} Revision`,
      version_stage:
        selectedAgreement.status === "countersigned"
          ? "countersigned_final"
          : selectedAgreement.status === "signed"
            ? "signed"
            : "revised"
    });
  }, [selectedAgreement]);

  async function handleCreateAgreement() {
    setSaving(true);
    try {
      const payload = await createOrganizationAgreementRecord(token, detail.organization.id, buildAgreementPayload(createForm));
      onDetailUpdated(payload);
      setShowCreateForm(false);
      setCreateForm(emptyAgreementForm(payload));
      setSelectedAgreementId(payload.agreements[0]?.id ?? null);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't create that Agreement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAgreement() {
    if (!selectedAgreement) {
      return;
    }
    setSaving(true);
    try {
      const payload = await updateOrganizationAgreementRecord(
        token,
        detail.organization.id,
        selectedAgreement.id,
        buildAgreementPayload(editForm, true)
      );
      onDetailUpdated(payload);
      setSelectedAgreementId(selectedAgreement.id);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save that Agreement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateTemplate() {
    setSaving(true);
    try {
      const payload = await createOrganizationAgreementTemplateRecord(token, detail.organization.id, {
        template_name: templateForm.template_name.trim(),
        agreement_type: templateForm.agreement_type,
        active_status: templateForm.active_status,
        template_body: templateForm.template_body || null,
        template_file_reference: templateForm.template_file_reference || null,
        merge_fields: templateForm.merge_fields
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      });
      onDetailUpdated(payload);
      setTemplateForm(emptyTemplateForm());
      setShowTemplateForm(false);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't save that Agreement template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateDraftFromTemplate() {
    setSaving(true);
    try {
      const payload = await createOrganizationAgreementFromTemplateRecord(token, detail.organization.id, {
        template_id: templateDraftForm.template_id,
        agreement_title: templateDraftForm.agreement_title || null,
        primary_contact_id: templateDraftForm.primary_contact_id || null,
        description: templateDraftForm.description || null,
        contract_value: templateDraftForm.contract_value.trim() ? Number(templateDraftForm.contract_value) : null,
        revenue_share_terms: templateDraftForm.revenue_share_terms || null,
        effective_date: templateDraftForm.effective_date || null,
        expiration_date: templateDraftForm.expiration_date || null,
        renewal_date: templateDraftForm.renewal_date || null,
        notice_deadline: templateDraftForm.notice_deadline || null,
        auto_renew: templateDraftForm.auto_renew,
        signers: buildSignerPayload(templateDraftForm.signers),
        linked_contact_ids: templateDraftForm.linked_contact_ids.filter(Boolean),
        linked_location_ids: templateDraftForm.linked_location_ids.filter(Boolean),
        note: templateDraftForm.note || null
      });
      onDetailUpdated(payload);
      const newestDraft = payload.agreements.find((agreement) => agreement.source_template_id === templateDraftForm.template_id);
      setSelectedAgreementId(newestDraft?.id ?? payload.agreements[0]?.id ?? null);
      setTemplateDraftForm(emptyTemplateDraftForm(payload));
      setShowTemplateDraftForm(false);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "We couldn't create that Agreement draft from the template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadAgreementFile() {
    if (!selectedAgreement || !fileUpload.file) {
      return;
    }
    setUploading(true);
    try {
      const payload = await uploadOrganizationAgreementFile(token, detail.organization.id, selectedAgreement.id, fileUpload.file, {
        version_label: fileUpload.version_label || null,
        version_stage: fileUpload.version_stage,
        activity_note: fileUpload.activity_note || null,
        is_current: fileUpload.is_current,
        legacy_upload: fileUpload.legacy_upload
      });
      onDetailUpdated(payload);
      setSelectedAgreementId(selectedAgreement.id);
      setFileUpload(EMPTY_FILE_UPLOAD);
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "We couldn't upload that Agreement version.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSendForSignature() {
    if (!selectedAgreement) {
      return;
    }
    setSendingForSignature(true);
    try {
      const currentVersionId = selectedAgreement.versions.find((version) => version.is_current)?.id ?? null;
      const payload = await sendOrganizationAgreementForSignature(token, detail.organization.id, selectedAgreement.id, {
        agreement_version_id: currentVersionId,
        note: "Queued from Contracts & Agreements"
      });
      onDetailUpdated(payload);
      setSelectedAgreementId(selectedAgreement.id);
      setError("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "We couldn't queue that Agreement for signature.");
    } finally {
      setSendingForSignature(false);
    }
  }

  async function handleSyncProvider() {
    if (!selectedAgreement) {
      return;
    }
    setSyncingProvider(true);
    try {
      const payload = await syncOrganizationAgreementProviderStatus(token, detail.organization.id, selectedAgreement.id, {
        note: "Manual provider refresh from Contracts & Agreements"
      });
      onDetailUpdated(payload);
      setSelectedAgreementId(selectedAgreement.id);
      setError("");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "We couldn't refresh the provider status right now.");
    } finally {
      setSyncingProvider(false);
    }
  }

  async function handleSendReminder(reminderType?: AgreementReminderType) {
    if (!selectedAgreement) {
      return;
    }
    setSendingReminder(true);
    try {
      const payload = await sendOrganizationAgreementReminder(token, detail.organization.id, selectedAgreement.id, {
        reminder_type: reminderType ?? reminderForm.reminder_type,
        channels: ["email", "internal_notice"],
        note: reminderForm.note || null
      });
      onDetailUpdated(payload);
      setSelectedAgreementId(selectedAgreement.id);
      setReminderForm((current) => ({ ...current, note: "" }));
      setError("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "We couldn't send that Agreement reminder.");
    } finally {
      setSendingReminder(false);
    }
  }

  async function handleCreateRenewalDraft() {
    if (!selectedAgreement) {
      return;
    }
    setCreatingRenewal(true);
    try {
      const payload = await createOrganizationAgreementRenewalDraft(token, detail.organization.id, selectedAgreement.id, {
        agreement_title: renewalForm.agreement_title || null,
        effective_date: renewalForm.effective_date || null,
        expiration_date: renewalForm.expiration_date || null,
        renewal_date: renewalForm.renewal_date || null,
        notice_deadline: renewalForm.notice_deadline || null,
        auto_renew: renewalForm.auto_renew,
        note: renewalForm.note || null
      });
      onDetailUpdated(payload);
      const renewalDraft = payload.agreements.find((agreement) => agreement.prior_agreement_id === selectedAgreement.id);
      setSelectedAgreementId(renewalDraft?.id ?? selectedAgreement.id);
      setError("");
    } catch (renewalError) {
      setError(renewalError instanceof Error ? renewalError.message : "We couldn't create that renewal draft.");
    } finally {
      setCreatingRenewal(false);
    }
  }

  function activateOperationalView(view: AgreementOperationalView) {
    const nextView = operationalView === view ? "all" : view;
    setOperationalView(nextView);
    if (view === "upcoming_shoot_risk" && nextView === "upcoming_shoot_risk") {
      upcomingShootRiskRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="dashboard-stack">
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="metrics-grid workspace-summary-strip">
        <AgreementSummaryCard label="Active" value={detail.agreement_summary.active} tone="success" />
        <AgreementSummaryCard label="Pending Signature" value={detail.agreement_summary.pending_signature} tone="warning" />
        <AgreementSummaryCard label="Expiring Soon" value={detail.agreement_summary.expiring_soon} tone="warning" />
        <AgreementSummaryCard label="Expired" value={detail.agreement_summary.expired} tone="critical" />
        <AgreementSummaryCard label="Replaced / Archived" value={detail.agreement_summary.replaced_archived} tone="neutral" />
      </div>

      <div className="request-card">
        <strong>Contracts & Agreements Summary</strong>
        <div className="muted">{detail.placeholders.agreement_summary}</div>
        {detail.agreement_summary.warnings.length ? (
          <div className="dashboard-stack">
            {detail.agreement_summary.warnings.map((warning) => (
              <div key={`${warning.code}-${warning.summary}`} className="metric-row">
                <span className={`metric-pill metric-pill--${toneClassForWarning(warning.severity)}`}>{humanizeWarningSeverity(warning.severity)}</span>
                <span>{warning.summary}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="metric-pill">Coverage looks stable for this account.</div>
        )}
      </div>

      <OperationalDetailSection
        title="Contract Follow-Up Views"
        summary="Quickly pivot into signature follow-up, renewal work, and upcoming shoot risk without blocking scheduling."
        defaultOpen
      >
        <div className="detail-two-column">
          <OperationalPreviewCard
            eyebrow="Dashboard View"
            title="Needs Signature"
            summary="Focus the agreement list on records still waiting for signature follow-through."
            statusLabel={`${detail.agreement_summary.pending_signature} pending`}
            statusTone={detail.agreement_summary.pending_signature ? "warning" : "neutral"}
            nextAction="Review pending agreements"
            selected={operationalView === "needs_signature"}
            onClick={() => activateOperationalView("needs_signature")}
          />
          <OperationalPreviewCard
            eyebrow="Dashboard View"
            title="Expiring Soon"
            summary="Review agreements approaching expiration so renewal work starts before the account slips into risk."
            statusLabel={`${detail.agreement_summary.expiring_soon} expiring`}
            statusTone={detail.agreement_summary.expiring_soon ? "warning" : "neutral"}
            nextAction="Review expiring agreements"
            selected={operationalView === "expiring_soon"}
            onClick={() => activateOperationalView("expiring_soon")}
          />
          <OperationalPreviewCard
            eyebrow="Dashboard View"
            title="Renewals Needed"
            summary="Focus on agreements inside the renewal window using tracked renewal, notice-deadline, and expiration anchors."
            statusLabel={`${detail.agreement_summary.renewals_needed} renewal${detail.agreement_summary.renewals_needed === 1 ? "" : "s"}`}
            statusTone={detail.agreement_summary.renewals_needed ? "warning" : "neutral"}
            nextAction="Create renewal drafts"
            selected={operationalView === "renewals_needed"}
            onClick={() => activateOperationalView("renewals_needed")}
          />
          <OperationalPreviewCard
            eyebrow="Dashboard View"
            title="Upcoming Shoots with Agreement Risk"
            summary="Jump to the upcoming shoot risk lane when an account is missing active coverage, is unsigned, or has already expired."
            statusLabel={`${detail.agreement_summary.upcoming_shoot_risk_count} shoot${detail.agreement_summary.upcoming_shoot_risk_count === 1 ? "" : "s"}`}
            statusTone={detail.agreement_summary.upcoming_shoot_risk_count ? "critical" : "neutral"}
            nextAction="Review shoot risk"
            selected={operationalView === "upcoming_shoot_risk"}
            onClick={() => activateOperationalView("upcoming_shoot_risk")}
          />
        </div>
      </OperationalDetailSection>

      {detail.upcoming_shoot_agreement_risks.length || operationalView === "upcoming_shoot_risk" ? (
        <div ref={upcomingShootRiskRef}>
          <OperationalDetailSection
            title="Upcoming Shoots With Agreement Risk"
            summary="Scheduling is still allowed, but these upcoming shoots need contract follow-up before the date gets too close."
            defaultOpen
          >
            {detail.upcoming_shoot_agreement_risks.length ? (
              <div className="detail-two-column">
                {detail.upcoming_shoot_agreement_risks.map((risk) => (
                  <article key={risk.shoot_id} className="request-card">
                    <strong>{risk.title}</strong>
                    <div className="muted">
                      {risk.shoot_code} | {formatDateValue(risk.shoot_date)}
                    </div>
                    <div className="muted">{risk.summary}</div>
                    <div className={`metric-pill metric-pill--${toneClassForWarning(risk.severity)}`}>{humanizeWarningSeverity(risk.severity)}</div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">No upcoming shoots currently carry agreement risk for this account.</div>
            )}
          </OperationalDetailSection>
        </div>
      ) : null}

      <section className="panel workspace-toolbar">
        <div className="workspace-toolbar__group">
          <label className="filter-field filter-field--wide">
            <span>Search Agreements</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, signer, template, renewal, or warning" />
          </label>
          <label className="filter-field">
            <span>Type</span>
            <select value={agreementType} onChange={(event) => setAgreementType(event.target.value as AgreementType | "all")}>
              {AGREEMENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Status</span>
            <select value={agreementStatus} onChange={(event) => setAgreementStatus(event.target.value as AgreementStatus | "all")}>
              {AGREEMENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Bucket</span>
            <select value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value as AgreementLifecycleBucket | "all")}>
              {LIFECYCLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Send State</span>
            <select
              value={providerLifecycleFilter}
              onChange={(event) => setProviderLifecycleFilter(event.target.value as AgreementProviderLifecycleBucket | "issue" | "all")}
            >
              {PROVIDER_LIFECYCLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {canManage ? (
          <div className="workspace-toolbar__actions">
            <button className="secondary-button" onClick={() => setShowTemplateForm((value) => !value)}>
              {showTemplateForm ? "Close Template" : "New Template"}
            </button>
            <button className="secondary-button" onClick={() => setShowTemplateDraftForm((value) => !value)}>
              {showTemplateDraftForm ? "Close Template Draft" : "Draft From Template"}
            </button>
            <button className="secondary-button" onClick={() => setShowCreateForm((value) => !value)}>
              {showCreateForm ? "Close New Agreement" : "New Agreement"}
            </button>
          </div>
        ) : null}
      </section>

      <OperationalDetailSection
        title="Agreement Templates"
        summary="Templates centralize recurring agreement language so leadership can draft faster with cleaner merge data and version lineage."
        defaultOpen={showTemplateForm || showTemplateDraftForm}
      >
        {canManage ? (
          <div className="detail-two-column">
            {showTemplateForm ? (
              <div className="request-card">
                <strong>Create Agreement Template</strong>
                <div className="field-grid">
                  <label className="filter-field">
                    <span>Template Name</span>
                    <input value={templateForm.template_name} onChange={(event) => setTemplateForm((current) => ({ ...current, template_name: event.target.value }))} />
                  </label>
                  <label className="filter-field">
                    <span>Agreement Type</span>
                    <select value={templateForm.agreement_type} onChange={(event) => setTemplateForm((current) => ({ ...current, agreement_type: event.target.value as AgreementType }))}>
                      {AGREEMENT_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Merge Fields</span>
                    <input value={templateForm.merge_fields} onChange={(event) => setTemplateForm((current) => ({ ...current, merge_fields: event.target.value }))} placeholder="organization_name, contact_name, effective_date" />
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Template Body</span>
                    <textarea rows={5} value={templateForm.template_body} onChange={(event) => setTemplateForm((current) => ({ ...current, template_body: event.target.value }))} placeholder="Use merge fields like {{organization_name}} and {{contact_name}}." />
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Template File Reference</span>
                    <input value={templateForm.template_file_reference} onChange={(event) => setTemplateForm((current) => ({ ...current, template_file_reference: event.target.value }))} />
                  </label>
                </div>
                <div className="dashboard-stack">
                  <label>
                    <input type="checkbox" checked={templateForm.active_status} onChange={(event) => setTemplateForm((current) => ({ ...current, active_status: event.target.checked }))} /> Template is active
                  </label>
                </div>
                <div className="access-actions">
                  <button disabled={saving || templateForm.template_name.trim().length < 2} onClick={() => void handleCreateTemplate()}>
                    {saving ? "Saving..." : "Save Template"}
                  </button>
                </div>
              </div>
            ) : null}

            {showTemplateDraftForm ? (
              <div className="request-card">
                <strong>Create Draft From Template</strong>
                <div className="field-grid">
                  <label className="filter-field">
                    <span>Template</span>
                    <select value={templateDraftForm.template_id} onChange={(event) => setTemplateDraftForm((current) => ({ ...current, template_id: event.target.value }))}>
                      <option value="">Select a template</option>
                      {detail.agreement_templates.filter((template) => template.active_status).map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.template_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Draft Title</span>
                    <input value={templateDraftForm.agreement_title} onChange={(event) => setTemplateDraftForm((current) => ({ ...current, agreement_title: event.target.value }))} />
                  </label>
                  <label className="filter-field">
                    <span>Primary Contact</span>
                    <select value={templateDraftForm.primary_contact_id} onChange={(event) => setTemplateDraftForm((current) => ({ ...current, primary_contact_id: event.target.value }))}>
                      <option value="">No primary contact yet</option>
                      {detail.contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Contract Value</span>
                    <input value={templateDraftForm.contract_value} onChange={(event) => setTemplateDraftForm((current) => ({ ...current, contract_value: event.target.value }))} />
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Description / Notes</span>
                    <textarea rows={3} value={templateDraftForm.description} onChange={(event) => setTemplateDraftForm((current) => ({ ...current, description: event.target.value }))} />
                  </label>
                </div>
                <SignerEditor detail={detail} signers={templateDraftForm.signers} onChange={(signers) => setTemplateDraftForm((current) => ({ ...current, signers }))} />
                <div className="access-actions">
                  <button disabled={saving || !templateDraftForm.template_id} onClick={() => void handleCreateDraftFromTemplate()}>
                    {saving ? "Creating..." : "Create Draft"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="detail-two-column">
          {detail.agreement_templates.map((template) => (
            <article key={template.id} className="request-card">
              <strong>{template.template_name}</strong>
              <div className="muted">{humanizeAgreementType(template.agreement_type)}</div>
              <div className="muted">{template.merge_fields.length ? template.merge_fields.join(", ") : "No merge fields saved yet"}</div>
              <div className="muted">Updated {formatDateTimeValue(template.updated_at)}</div>
              <div className={`metric-pill${template.active_status ? " metric-pill--success" : ""}`}>{template.active_status ? "Active Template" : "Inactive Template"}</div>
            </article>
          ))}
        </div>
        {!detail.agreement_templates.length ? <div className="empty-state">No Agreement templates are saved yet.</div> : null}
      </OperationalDetailSection>

      {showCreateForm && canManage ? (
        <AgreementEditorCard
          title="Create Agreement"
          summary="Store a new Agreement record here, anchor it to this Organization, attach the right signers, and keep lifecycle dates structured from the start."
          detail={detail}
          form={createForm}
          onChange={setCreateForm}
          onSubmit={() => void handleCreateAgreement()}
          saving={saving}
          submitLabel="Save Agreement"
        />
      ) : null}

      <div className="board-layout">
        <div className="dashboard-stack">
          {agreements.map((agreement) => (
            <OperationalPreviewCard
              key={agreement.id}
              eyebrow={humanizeAgreementType(agreement.agreement_type)}
              title={agreement.agreement_title}
              summary={
                <>
                  <div>{agreement.primary_contact_name || "No primary Contact linked yet."}</div>
                  <div className="muted">
                    {agreement.warning_summary ||
                      (agreement.expiration_date
                        ? `Expires ${formatDateValue(agreement.expiration_date)}`
                        : agreement.effective_date
                          ? `Effective ${formatDateValue(agreement.effective_date)}`
                          : "No key dates saved yet")}
                  </div>
                </>
              }
              statusLabel={humanizeAgreementStatus(agreement.status)}
              statusTone={toneForLifecycle(agreement.lifecycle_bucket)}
              meta={[
                { label: humanizeLifecycleBucket(agreement.lifecycle_bucket), tone: toneForLifecycle(agreement.lifecycle_bucket) },
                {
                  label: humanizeProviderLifecycleBucket(agreement.provider_lifecycle_bucket),
                  tone: toneForProviderLifecycle(agreement.provider_lifecycle_bucket, agreement.provider_sync_health)
                },
                ...(agreement.contract_value ? [{ label: formatCurrency(agreement.contract_value), tone: "neutral" as const }] : []),
                ...(agreement.source_template_name ? [{ label: agreement.source_template_name, tone: "info" as const }] : [])
              ]}
              flags={[
                ...(agreement.signers.length ? [{ label: `${agreement.signers.length} signer${agreement.signers.length === 1 ? "" : "s"}`, tone: "info" as const }] : []),
                ...(agreement.versions.length ? [{ label: `${agreement.versions.length} version${agreement.versions.length === 1 ? "" : "s"}`, tone: "neutral" as const }] : []),
                ...(agreement.warning_summary ? [{ label: humanizeWarningSeverity(agreement.warning_severity), tone: toneForWarning(agreement.warning_severity) }] : []),
                ...(agreement.provider_error_state ? [{ label: "Provider Issue", tone: "critical" as const }] : []),
                ...(agreement.auto_renew ? [{ label: "Auto-renew", tone: "warning" as const }] : [])
              ]}
              nextAction={
                agreement.provider_lifecycle_bucket === "not_sent" || agreement.provider_lifecycle_bucket === "queued_to_send"
                  ? "Send for signature"
                  : agreement.lifecycle_bucket === "pending_signature"
                    ? "Send reminder"
                    : agreement.provider_lifecycle_bucket === "issue"
                      ? "Review provider issue"
                      : agreement.lifecycle_bucket === "expiring_soon"
                        ? "Create renewal draft"
                        : agreement.warning_summary
                          ? "Review warning state"
                          : "Review metadata and versions"
              }
              selected={agreement.id === selectedAgreement?.id}
              onClick={() => setSelectedAgreementId(agreement.id)}
            />
          ))}
          {!agreements.length ? <div className="empty-state">No Agreements match the current filters for this Organization.</div> : null}
        </div>

        <div className="dashboard-stack">
          {selectedAgreement ? (
            <>
              <div className="request-card">
                <strong>Agreement Warning State</strong>
                <div className="muted">{selectedAgreement.warning_summary || "No active warning is attached to this Agreement right now."}</div>
                <div className="detail-two-column">
                  <div className={`metric-pill metric-pill--${toneClassForWarning(selectedAgreement.warning_severity)}`}>
                    {humanizeWarningSeverity(selectedAgreement.warning_severity)}
                  </div>
                  <div className="muted">{selectedAgreement.warning_codes.length ? selectedAgreement.warning_codes.join(", ") : "No warning codes"}</div>
                </div>
              </div>

              <OperationalDetailSection
                title="Signature Lifecycle"
                summary="Mission Control stays authoritative while the provider handles delivery and signatures."
                defaultOpen
              >
                <div className="request-card">
                  <div className="detail-two-column">
                    <div>
                      <strong>{humanizeProviderLifecycleBucket(selectedAgreement.provider_lifecycle_bucket)}</strong>
                      <div className="muted">
                        {selectedAgreement.external_provider_name
                          ? `${humanizeProviderName(selectedAgreement.external_provider_name)} | ${selectedAgreement.external_status || "awaiting sync"}`
                          : "This Agreement has not been sent through an e-sign provider yet."}
                      </div>
                    </div>
                    <div className={`metric-pill metric-pill--${toneClassForProviderLifecycle(selectedAgreement.provider_lifecycle_bucket, selectedAgreement.provider_sync_health)}`}>
                      {selectedAgreement.provider_sync_health === "error"
                        ? "Sync Issue"
                        : selectedAgreement.provider_sync_health === "warning"
                          ? "Needs Attention"
                          : "Healthy"}
                    </div>
                  </div>
                  <div className="field-grid">
                    <div className="filter-field">
                      <span>Provider</span>
                      <strong>{selectedAgreement.external_provider_name ? humanizeProviderName(selectedAgreement.external_provider_name) : "Not sent yet"}</strong>
                    </div>
                    <div className="filter-field">
                      <span>Envelope / Request</span>
                      <strong>{selectedAgreement.external_envelope_id || "Not created yet"}</strong>
                    </div>
                    <div className="filter-field">
                      <span>Last Provider Sync</span>
                      <strong>{formatDateTimeValue(selectedAgreement.last_provider_sync_at)}</strong>
                    </div>
                    <div className="filter-field">
                      <span>Provider Issue</span>
                      <strong>{selectedAgreement.provider_error_state || "No active provider error"}</strong>
                    </div>
                  </div>
                  {canManage ? (
                    <div className="access-actions">
                      <button
                        disabled={
                          sendingForSignature ||
                          (!selectedAgreement.signers.some((signer) => Boolean(signer.signer_email)) ||
                            !selectedAgreement.versions.some((version) => version.is_current || version.files.length))
                        }
                        onClick={() => void handleSendForSignature()}
                      >
                        {sendingForSignature ? "Queueing..." : "Send for Signature"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={syncingProvider || !selectedAgreement.external_envelope_id}
                        onClick={() => void handleSyncProvider()}
                      >
                        {syncingProvider ? "Refreshing..." : "Refresh Provider Status"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="dashboard-stack">
                  {selectedAgreement.signers.map((signer) => (
                    <article key={signer.id} className="request-card">
                      <div className="detail-two-column">
                        <div>
                          <strong>{signer.signer_name}</strong>
                          <div className="muted">{signer.signer_email || "No email saved"}</div>
                        </div>
                        <div className="metric-row">
                          <span className="metric-pill">{humanizeSignerType(signer.signer_type)}</span>
                          <span className={`metric-pill metric-pill--${toneClassForSignerStatus(signer.status)}`}>{humanizeSignerStatus(signer.status)}</span>
                        </div>
                      </div>
                      <div className="muted">
                        Provider status: {signer.external_status || "Not synced yet"} | Viewed {formatDateTimeValue(signer.viewed_at)} | Signed{" "}
                        {formatDateTimeValue(signer.signed_at)}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="dashboard-stack">
                  {selectedAgreement.provider_events.slice(0, 8).map((event) => (
                    <article key={event.id} className="request-card">
                      <strong>{humanizeProviderEventType(event.event_type)}</strong>
                      <div className="muted">
                        {humanizeProviderName(event.provider_name)} | {event.provider_status || "no provider status"} | {formatDateTimeValue(event.occurred_at)}
                      </div>
                    </article>
                  ))}
                </div>
                {!selectedAgreement.provider_events.length ? <div className="empty-state">No provider lifecycle events have been logged yet.</div> : null}
              </OperationalDetailSection>

              <AgreementEditorCard
                title="Agreement Detail"
                summary="Leadership can manage lifecycle metadata, signer coverage, linked account context, and reminder-ready dates here without burying contracts inside the general Resource Library."
                detail={detail}
                form={editForm}
                onChange={setEditForm}
                onSubmit={() => void handleSaveAgreement()}
                saving={saving}
                submitLabel="Save Agreement Changes"
              />

              <OperationalDetailSection title="Version History" summary={`${selectedAgreement.versions.length} version${selectedAgreement.versions.length === 1 ? "" : "s"} are tracked on this Agreement.`} defaultOpen>
                <div className="dashboard-stack">
                  {selectedAgreement.versions.map((version) => (
                    <article key={version.id} className="request-card">
                      <strong>{version.version_label}</strong>
                      <div className="muted">
                        Version {version.version_number} | {humanizeVersionStage(version.version_stage)} | {formatDateTimeValue(version.created_at)}
                      </div>
                      {version.is_current ? <div className="metric-pill metric-pill--success">Current Version</div> : null}
                    </article>
                  ))}
                </div>
                {!selectedAgreement.versions.length ? <div className="empty-state">No Agreement versions are tracked yet.</div> : null}
                {canManage ? (
                  <div className="request-card">
                    <strong>Upload New Version</strong>
                    <div className="field-grid">
                      <label className="filter-field filter-field--wide">
                        <span>Agreement File</span>
                        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx" onChange={(event) => setFileUpload((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} />
                      </label>
                      <label className="filter-field">
                        <span>Version Label</span>
                        <input value={fileUpload.version_label} onChange={(event) => setFileUpload((current) => ({ ...current, version_label: event.target.value }))} />
                      </label>
                      <label className="filter-field">
                        <span>Version Stage</span>
                        <select value={fileUpload.version_stage} onChange={(event) => setFileUpload((current) => ({ ...current, version_stage: event.target.value as AgreementVersionStage }))}>
                          {VERSION_STAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="access-actions">
                      <button disabled={uploading || !fileUpload.file} onClick={() => void handleUploadAgreementFile()}>
                        {uploading ? "Uploading..." : "Upload Agreement Version"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </OperationalDetailSection>

              <OperationalDetailSection title="Reminder History" summary={`${selectedAgreement.reminders.length} reminder event${selectedAgreement.reminders.length === 1 ? "" : "s"} logged on this Agreement.`} defaultOpen>
                {canManage ? (
                  <div className="request-card">
                    <strong>Send / Resend Reminder</strong>
                    <div className="field-grid">
                      <label className="filter-field">
                        <span>Reminder Type</span>
                        <select value={reminderForm.reminder_type} onChange={(event) => setReminderForm((current) => ({ ...current, reminder_type: event.target.value as AgreementReminderType }))}>
                          {REMINDER_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="filter-field filter-field--wide">
                        <span>Reminder Note</span>
                        <input value={reminderForm.note} onChange={(event) => setReminderForm((current) => ({ ...current, note: event.target.value }))} />
                      </label>
                    </div>
                    <div className="access-actions">
                      <button disabled={sendingReminder} onClick={() => void handleSendReminder()}>
                        {sendingReminder ? "Sending..." : "Send / Resend Reminder"}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="dashboard-stack">
                  {selectedAgreement.reminders.map((reminder) => (
                    <article key={reminder.id} className="request-card">
                      <strong>{humanizeReminderType(reminder.reminder_type)}</strong>
                      <div className="muted">{reminder.recipient_name || reminder.recipient_email || "Internal follow-up"}</div>
                      <div className="muted">{formatDateTimeValue(reminder.sent_at || reminder.created_at)}</div>
                    </article>
                  ))}
                </div>
                {!selectedAgreement.reminders.length ? <div className="empty-state">No reminder activity has been logged yet.</div> : null}
              </OperationalDetailSection>

              <OperationalDetailSection title="Renewal & Replacement" summary="Renewal drafts preserve lineage instead of overwriting document history." defaultOpen>
                <div className="field-grid">
                  <label className="filter-field filter-field--wide">
                    <span>Renewal Title</span>
                    <input value={renewalForm.agreement_title} onChange={(event) => setRenewalForm((current) => ({ ...current, agreement_title: event.target.value }))} />
                  </label>
                  <label className="filter-field">
                    <span>Effective Date</span>
                    <input type="date" value={renewalForm.effective_date} onChange={(event) => setRenewalForm((current) => ({ ...current, effective_date: event.target.value }))} />
                  </label>
                  <label className="filter-field">
                    <span>Expiration Date</span>
                    <input type="date" value={renewalForm.expiration_date} onChange={(event) => setRenewalForm((current) => ({ ...current, expiration_date: event.target.value }))} />
                  </label>
                </div>
                {canManage ? (
                  <div className="access-actions">
                    <button disabled={creatingRenewal} onClick={() => void handleCreateRenewalDraft()}>
                      {creatingRenewal ? "Creating..." : "Create Renewal Draft"}
                    </button>
                  </div>
                ) : null}
              </OperationalDetailSection>
            </>
          ) : (
            <div className="empty-state empty-state--panel">Select an Agreement to review signers, versions, reminders, and renewal state.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgreementSummaryCard({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "critical" | "neutral";
}) {
  const toneClass = tone === "critical" ? "warning" : tone === "neutral" ? "identity" : tone;
  return (
    <article className="panel stat-card">
      <div className="eyebrow">{label}</div>
      <strong>{value}</strong>
      <div className={`metric-pill metric-pill--${toneClass}`}>{value === 1 ? "1 agreement" : `${value} agreements`}</div>
    </article>
  );
}

function AgreementEditorCard({
  title,
  summary,
  detail,
  form,
  onChange,
  onSubmit,
  saving,
  submitLabel
}: {
  title: string;
  summary: string;
  detail: OrganizationDetail;
  form: AgreementFormState;
  onChange: (next: AgreementFormState) => void;
  onSubmit: () => void;
  saving: boolean;
  submitLabel: string;
}) {
  const remainingAgreements = detail.agreements.filter((agreement) => agreement.agreement_title !== form.agreement_title);

  return (
    <div className="request-card">
      <strong>{title}</strong>
      <div className="muted">{summary}</div>
      <div className="field-grid">
        <label className="filter-field filter-field--wide">
          <span>Agreement Title</span>
          <input value={form.agreement_title} onChange={(event) => onChange({ ...form, agreement_title: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Agreement Type</span>
          <select value={form.agreement_type} onChange={(event) => onChange({ ...form, agreement_type: event.target.value as AgreementType })}>
            {AGREEMENT_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Status</span>
          <select value={form.status} onChange={(event) => onChange({ ...form, status: event.target.value as AgreementStatus })}>
            {AGREEMENT_STATUS_OPTIONS.filter((option) => option.value !== "all").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Primary Contact</span>
          <select value={form.primary_contact_id} onChange={(event) => onChange({ ...form, primary_contact_id: event.target.value })}>
            <option value="">No primary contact yet</option>
            {detail.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Contract Value</span>
          <input value={form.contract_value} onChange={(event) => onChange({ ...form, contract_value: event.target.value })} />
        </label>
        <label className="filter-field filter-field--wide">
          <span>Revenue Share Terms</span>
          <input value={form.revenue_share_terms} onChange={(event) => onChange({ ...form, revenue_share_terms: event.target.value })} />
        </label>
        <label className="filter-field filter-field--wide">
          <span>Description / Notes</span>
          <textarea rows={3} value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Effective Date</span>
          <input type="date" value={form.effective_date} onChange={(event) => onChange({ ...form, effective_date: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Expiration Date</span>
          <input type="date" value={form.expiration_date} onChange={(event) => onChange({ ...form, expiration_date: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Renewal Date</span>
          <input type="date" value={form.renewal_date} onChange={(event) => onChange({ ...form, renewal_date: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Notice Deadline</span>
          <input type="date" value={form.notice_deadline} onChange={(event) => onChange({ ...form, notice_deadline: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Prior Agreement</span>
          <select value={form.prior_agreement_id} onChange={(event) => onChange({ ...form, prior_agreement_id: event.target.value })}>
            <option value="">No prior agreement</option>
            {remainingAgreements.map((agreement) => (
              <option key={agreement.id} value={agreement.id}>
                {agreement.agreement_title}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Replacement Agreement</span>
          <select value={form.replaced_by_agreement_id} onChange={(event) => onChange({ ...form, replaced_by_agreement_id: event.target.value })}>
            <option value="">No replacement linked</option>
            {remainingAgreements.map((agreement) => (
              <option key={agreement.id} value={agreement.id}>
                {agreement.agreement_title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SignerEditor detail={detail} signers={form.signers} onChange={(signers) => onChange({ ...form, signers })} />
      <div className="access-actions">
        <button disabled={saving || form.agreement_title.trim().length < 2} onClick={onSubmit}>
          {saving ? "Saving..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

function SignerEditor({
  detail,
  signers,
  onChange
}: {
  detail: OrganizationDetail;
  signers: SignerFormState[];
  onChange: (signers: SignerFormState[]) => void;
}) {
  return (
    <article className="request-card">
      <div className="detail-two-column">
        <div>
          <strong>Signers & Countersigners</strong>
          <div className="muted">Support one signer or multiple signers, plus internal countersign coverage when leadership needs it.</div>
        </div>
        <div className="access-actions">
          <button className="secondary-button" onClick={() => onChange([...signers, buildDefaultSigner("", "", "")])}>
            Add Signer
          </button>
        </div>
      </div>
      <div className="dashboard-stack">
        {signers.map((signer, index) => (
          <div key={`${signer.contact_id}-${index}`} className="request-card">
            <div className="field-grid">
              <label className="filter-field">
                <span>Linked Contact</span>
                <select value={signer.contact_id} onChange={(event) => onChange(updateSigner(signers, index, { contact_id: event.target.value }))}>
                  <option value="">No linked contact</option>
                  {detail.contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Signer Name</span>
                <input value={signer.signer_name} onChange={(event) => onChange(updateSigner(signers, index, { signer_name: event.target.value }))} />
              </label>
              <label className="filter-field">
                <span>Email</span>
                <input value={signer.signer_email} onChange={(event) => onChange(updateSigner(signers, index, { signer_email: event.target.value }))} />
              </label>
              <label className="filter-field">
                <span>Signer Type</span>
                <select value={signer.signer_type} onChange={(event) => onChange(updateSigner(signers, index, { signer_type: event.target.value as AgreementSignerType }))}>
                  {SIGNER_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Status</span>
                <select value={signer.status} onChange={(event) => onChange(updateSigner(signers, index, { status: event.target.value as AgreementSignerStatus }))}>
                  {SIGNER_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>
      {!signers.length ? <div className="empty-state">No signers are attached yet.</div> : null}
    </article>
  );
}

function emptyAgreementForm(detail: OrganizationDetail): AgreementFormState {
  return {
    agreement_title: "",
    agreement_type: "schools",
    status: "draft",
    primary_contact_id: detail.contacts[0]?.id ?? "",
    description: "",
    contract_value: "",
    revenue_share_terms: "",
    effective_date: "",
    expiration_date: "",
    renewal_date: "",
    notice_deadline: "",
    auto_renew: false,
    sent_at: "",
    viewed_at: "",
    signed_at: "",
    countersigned_at: "",
    prior_agreement_id: "",
    replaced_by_agreement_id: "",
    linked_contact_ids: [],
    linked_location_ids: [],
    signers: detail.contacts[0] ? [buildDefaultSigner(detail.contacts[0].full_name, detail.contacts[0].email ?? "", detail.contacts[0].id)] : [],
    note: ""
  };
}

function buildAgreementForm(agreement: AgreementRecord): AgreementFormState {
  return {
    agreement_title: agreement.agreement_title,
    agreement_type: agreement.agreement_type,
    status: agreement.status,
    primary_contact_id: agreement.primary_contact_id ?? "",
    description: agreement.description ?? "",
    contract_value: agreement.contract_value?.toString() ?? "",
    revenue_share_terms: agreement.revenue_share_terms ?? "",
    effective_date: agreement.effective_date ?? "",
    expiration_date: agreement.expiration_date ?? "",
    renewal_date: agreement.renewal_date ?? "",
    notice_deadline: agreement.notice_deadline ?? "",
    auto_renew: Boolean(agreement.auto_renew),
    sent_at: "",
    viewed_at: "",
    signed_at: "",
    countersigned_at: "",
    prior_agreement_id: agreement.prior_agreement_id ?? "",
    replaced_by_agreement_id: agreement.replaced_by_agreement_id ?? "",
    linked_contact_ids: agreement.links.filter((link) => link.linked_entity_type === "organization_contact").map((link) => link.linked_entity_id),
    linked_location_ids: agreement.links.filter((link) => link.linked_entity_type === "shoot_location").map((link) => link.linked_entity_id),
    signers: agreement.signers.map((signer, index) => ({
      contact_id: signer.contact_id ?? "",
      signer_name: signer.signer_name,
      signer_email: signer.signer_email ?? "",
      signer_role: signer.signer_role ?? "",
      signer_order: signer.signer_order ?? index + 1,
      signer_type: signer.signer_type,
      status: signer.status
    })),
    note: ""
  };
}

function buildAgreementPayload(form: AgreementFormState, includeNote = false) {
  const payload = {
    agreement_title: form.agreement_title.trim(),
    agreement_type: form.agreement_type,
    status: form.status,
    primary_contact_id: form.primary_contact_id || null,
    description: form.description || null,
    contract_value: form.contract_value.trim() ? Number(form.contract_value) : null,
    revenue_share_terms: form.revenue_share_terms || null,
    effective_date: form.effective_date || null,
    expiration_date: form.expiration_date || null,
    renewal_date: form.renewal_date || null,
    notice_deadline: form.notice_deadline || null,
    auto_renew: form.auto_renew,
    sent_at: form.sent_at || null,
    viewed_at: form.viewed_at || null,
    signed_at: form.signed_at || null,
    countersigned_at: form.countersigned_at || null,
    prior_agreement_id: form.prior_agreement_id || null,
    replaced_by_agreement_id: form.replaced_by_agreement_id || null,
    signers: buildSignerPayload(form.signers),
    linked_contact_ids: form.linked_contact_ids.filter(Boolean),
    linked_location_ids: form.linked_location_ids.filter(Boolean)
  };
  return includeNote ? { ...payload, note: form.note || null } : payload;
}

function buildSignerPayload(signers: SignerFormState[]) {
  return signers
    .filter((signer) => signer.signer_name.trim())
    .map((signer, index) => ({
      contact_id: signer.contact_id || null,
      signer_name: signer.signer_name.trim(),
      signer_email: signer.signer_email.trim() || null,
      signer_role: signer.signer_role.trim() || null,
      signer_order: signer.signer_order || index + 1,
      signer_type: signer.signer_type,
      status: signer.status
    }));
}

function emptyTemplateForm(): TemplateFormState {
  return {
    template_name: "",
    agreement_type: "schools",
    active_status: true,
    template_body: "",
    template_file_reference: "",
    merge_fields: "organization_name, contact_name, effective_date"
  };
}

function emptyTemplateDraftForm(detail: OrganizationDetail): TemplateDraftFormState {
  return {
    template_id: detail.agreement_templates[0]?.id ?? "",
    agreement_title: "",
    primary_contact_id: detail.contacts[0]?.id ?? "",
    description: "",
    contract_value: "",
    revenue_share_terms: "",
    effective_date: "",
    expiration_date: "",
    renewal_date: "",
    notice_deadline: "",
    auto_renew: false,
    linked_contact_ids: [],
    linked_location_ids: [],
    signers: detail.contacts[0] ? [buildDefaultSigner(detail.contacts[0].full_name, detail.contacts[0].email ?? "", detail.contacts[0].id)] : [],
    note: ""
  };
}

function emptyRenewalForm(): RenewalFormState {
  return {
    agreement_title: "",
    effective_date: "",
    expiration_date: "",
    renewal_date: "",
    notice_deadline: "",
    auto_renew: false,
    note: ""
  };
}

function buildRenewalForm(agreement: AgreementRecord): RenewalFormState {
  return {
    agreement_title: `${agreement.agreement_title} Renewal`,
    effective_date: agreement.renewal_date ?? agreement.effective_date ?? "",
    expiration_date: agreement.expiration_date ?? "",
    renewal_date: agreement.renewal_date ?? "",
    notice_deadline: agreement.notice_deadline ?? "",
    auto_renew: Boolean(agreement.auto_renew),
    note: ""
  };
}

function buildDefaultSigner(name: string, email: string, contactId: string): SignerFormState {
  return {
    contact_id: contactId,
    signer_name: name,
    signer_email: email,
    signer_role: "",
    signer_order: 1,
    signer_type: "external",
    status: "pending"
  };
}

function updateSigner(signers: SignerFormState[], index: number, patch: Partial<SignerFormState>) {
  return signers.map((signer, signerIndex) => (signerIndex === index ? { ...signer, ...patch } : signer));
}

function normalizeAgreementText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatDateValue(value?: string | null) {
  if (!value) {
    return "Not set";
  }
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString();
}

function formatDateTimeValue(value?: string | null) {
  if (!value) {
    return "Not set";
  }
  return new Date(value).toLocaleString();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function humanizeAgreementType(value: AgreementType) {
  return AGREEMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function humanizeAgreementStatus(value: AgreementStatus) {
  return AGREEMENT_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function humanizeLifecycleBucket(value: AgreementLifecycleBucket) {
  return LIFECYCLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function humanizeVersionStage(value: AgreementVersionStage) {
  return VERSION_STAGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function humanizeReminderType(value: AgreementReminderType) {
  return REMINDER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function humanizeSignerType(value: AgreementSignerType) {
  return SIGNER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function humanizeSignerStatus(value: AgreementSignerStatus) {
  return SIGNER_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function humanizeProviderName(value: string) {
  switch (value) {
    case "provider_stub":
      return "Provider Stub";
    case "dropbox_sign":
      return "Dropbox Sign";
    default:
      return value;
  }
}

function humanizeProviderLifecycleBucket(value: AgreementProviderLifecycleBucket) {
  switch (value) {
    case "queued_to_send":
      return "Queued To Send";
    case "sent_unsigned":
      return "Sent But Unsigned";
    case "viewed_not_signed":
      return "Viewed Not Signed";
    case "partially_signed":
      return "Partially Signed";
    case "countersign_pending":
      return "Countersign Pending";
    case "completed":
      return "Completed";
    case "issue":
      return "Provider Issue";
    default:
      return "Not Sent";
  }
}

function humanizeProviderEventType(value: string) {
  switch (value) {
    case "send_requested":
      return "Send Requested";
    case "reminder_requested":
      return "Reminder Requested";
    case "reminder_sent":
      return "Reminder Sent";
    case "sync_requested":
      return "Sync Requested";
    case "sync_updated":
      return "Sync Updated";
    case "completed_package_registered":
      return "Final Package Registered";
    case "send_failed":
      return "Send Failed";
    case "sync_failed":
      return "Sync Failed";
    default:
      return value.replace(/_/g, " ");
  }
}

function humanizeWarningSeverity(value: AgreementWarningSeverity) {
  switch (value) {
    case "major":
      return "Major Warning";
    case "warning":
      return "Warning";
    default:
      return "Clear";
  }
}

function toneForLifecycle(value: AgreementLifecycleBucket) {
  switch (value) {
    case "active":
      return "success";
    case "pending_signature":
    case "expiring_soon":
      return "warning";
    case "expired":
      return "critical";
    default:
      return "neutral";
  }
}

function toneForWarning(value: AgreementWarningSeverity) {
  switch (value) {
    case "major":
      return "critical" as const;
    case "warning":
      return "warning" as const;
    default:
      return "success" as const;
  }
}

function toneForProviderLifecycle(value: AgreementProviderLifecycleBucket, health: "clear" | "warning" | "error") {
  if (health === "error" || value === "issue") {
    return "warning" as const;
  }
  if (["queued_to_send", "sent_unsigned", "viewed_not_signed", "partially_signed", "countersign_pending"].includes(value)) {
    return "warning" as const;
  }
  if (value === "completed") {
    return "success" as const;
  }
  return "neutral" as const;
}

function toneClassForProviderLifecycle(value: AgreementProviderLifecycleBucket, health: "clear" | "warning" | "error") {
  if (health === "error" || value === "issue") {
    return "critical";
  }
  if (["queued_to_send", "sent_unsigned", "viewed_not_signed", "partially_signed", "countersign_pending"].includes(value)) {
    return "warning";
  }
  if (value === "completed") {
    return "success";
  }
  return "neutral";
}

function toneClassForSignerStatus(value: AgreementSignerStatus) {
  switch (value) {
    case "signed":
      return "success";
    case "viewed":
      return "warning";
    case "cancelled":
    case "replaced":
      return "neutral";
    default:
      return "warning";
  }
}

function toneClassForWarning(value: AgreementWarningSeverity) {
  switch (value) {
    case "major":
      return "critical";
    case "warning":
      return "warning";
    default:
      return "success";
  }
}
