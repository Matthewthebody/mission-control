export type AgreementType =
  | "schools"
  | "sports"
  | "events"
  | "studio_client"
  | "nda"
  | "image_release";

export type AgreementStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "partially_signed"
  | "signed"
  | "countersigned"
  | "active"
  | "expiring_soon"
  | "expired"
  | "replaced"
  | "cancelled";

export type AgreementFileType = "pdf" | "image" | "document" | "other";

export type AgreementLinkedEntityType = "organization" | "client_account" | "organization_contact" | "shoot_location";

export type AgreementActivityType =
  | "created"
  | "metadata_updated"
  | "status_changed"
  | "file_uploaded"
  | "file_marked_current"
  | "legacy_file_registered"
  | "prior_agreement_linked"
  | "replacement_linked"
  | "note_added"
  | "template_created"
  | "template_updated"
  | "draft_created_from_template"
  | "signer_added"
  | "signer_updated"
  | "reminder_sent"
  | "renewal_draft_created"
  | "version_created"
  | "version_superseded"
  | "sent_via_provider"
  | "provider_sync_updated"
  | "provider_send_failed"
  | "provider_sync_failed"
  | "provider_viewed"
  | "provider_signed"
  | "provider_countersigned"
  | "provider_voided"
  | "provider_cancelled"
  | "provider_reminder_sent"
  | "final_signed_file_registered";

export type AgreementLifecycleBucket =
  | "active"
  | "pending_signature"
  | "expiring_soon"
  | "expired"
  | "replaced_archived";

export type AgreementSignerType = "external" | "internal" | "countersigner";
export type AgreementSignerStatus = "pending" | "viewed" | "signed" | "replaced" | "cancelled";

export type AgreementExternalProviderName = "provider_stub" | "dropbox_sign";
export type AgreementProviderEventDirection = "outbound" | "inbound";
export type AgreementProviderEventType =
  | "send_requested"
  | "sent"
  | "reminder_requested"
  | "reminder_sent"
  | "sync_requested"
  | "sync_updated"
  | "viewed"
  | "signed"
  | "countersigned"
  | "completed_package_registered"
  | "voided"
  | "cancelled"
  | "send_failed"
  | "sync_failed";
export type AgreementProviderLifecycleBucket =
  | "not_sent"
  | "queued_to_send"
  | "sent_unsigned"
  | "viewed_not_signed"
  | "partially_signed"
  | "countersign_pending"
  | "completed"
  | "issue";
export type AgreementProviderSyncHealth = "clear" | "warning" | "error";

export type AgreementVersionStage =
  | "draft"
  | "revised"
  | "signed"
  | "countersigned_final"
  | "legacy_import";

export type AgreementReminderType =
  | "unsigned_3_day"
  | "unsigned_7_day"
  | "unsigned_30_day"
  | "expiration_6_month"
  | "expiration_90_day"
  | "expiration_30_day"
  | "manual_follow_up";

export type AgreementReminderChannel = "email" | "internal_notice";
export type AgreementReminderStatus = "queued" | "sent" | "skipped" | "cancelled";

export type AgreementWarningCode =
  | "no_active_agreement"
  | "pending_unsigned_agreement"
  | "expiring_agreement"
  | "expired_agreement"
  | "renewal_needed"
  | "upcoming_shoot_risk";

export type AgreementWarningSeverity = "clear" | "warning" | "major";

export interface AgreementFileRecord {
  id: string;
  agreement_id: string;
  agreement_version_id: string | null;
  file_type: AgreementFileType;
  file_name: string;
  storage_reference: string;
  file_url: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  version_label: string | null;
  is_current: boolean;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

export interface AgreementLinkRecord {
  id: string;
  agreement_id: string;
  linked_entity_type: AgreementLinkedEntityType;
  linked_entity_id: string;
  relationship_type: string;
  label: string | null;
  secondary_label: string | null;
  created_at: string;
}

export interface AgreementActivityRecord {
  id: string;
  agreement_id: string;
  activity_type: AgreementActivityType;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  timestamp: string;
  note: string | null;
  metadata: Record<string, unknown>;
}

export interface AgreementTemplateRecord {
  id: string;
  template_name: string;
  agreement_type: AgreementType;
  active_status: boolean;
  template_body: string | null;
  template_file_reference: string | null;
  merge_fields: string[];
  created_by_user_id: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgreementSignerRecord {
  id: string;
  agreement_id: string;
  contact_id: string | null;
  signer_name: string;
  signer_email: string | null;
  signer_role: string | null;
  signer_order: number | null;
  signer_type: AgreementSignerType;
  status: AgreementSignerStatus;
  external_recipient_id: string | null;
  external_status: string | null;
  last_provider_sync_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgreementProviderEventRecord {
  id: string;
  agreement_id: string;
  signer_id: string | null;
  provider_name: string;
  external_envelope_id: string | null;
  external_recipient_id: string | null;
  direction: AgreementProviderEventDirection;
  event_type: AgreementProviderEventType;
  provider_status: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface AgreementVersionRecord {
  id: string;
  agreement_id: string;
  version_number: number;
  version_label: string;
  version_stage: AgreementVersionStage;
  prior_version_id: string | null;
  source_template_id: string | null;
  source_template_name: string | null;
  rendered_body: string | null;
  merge_snapshot: Record<string, unknown>;
  is_current: boolean;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  files: AgreementFileRecord[];
}

export interface AgreementReminderRecord {
  id: string;
  agreement_id: string;
  signer_id: string | null;
  reminder_type: AgreementReminderType;
  reminder_channel: AgreementReminderChannel;
  status: AgreementReminderStatus;
  follow_up_state: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  due_at: string | null;
  sent_at: string | null;
  triggered_by_user_id: string | null;
  triggered_by_name: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgreementAccountWarningRecord {
  code: AgreementWarningCode;
  severity: AgreementWarningSeverity;
  summary: string;
}

export interface AgreementUpcomingShootRisk {
  shoot_id: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  severity: AgreementWarningSeverity;
  summary: string;
  organization_id: string | null;
  organization_display_name: string | null;
  agreement_status: AgreementStatus | null;
}

export interface AgreementRecord {
  id: string;
  agreement_title: string;
  agreement_type: AgreementType;
  status: AgreementStatus;
  lifecycle_bucket: AgreementLifecycleBucket;
  organization_id: string | null;
  organization_display_name: string | null;
  client_account_id: string | null;
  client_account_display_name: string | null;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  source_template_id: string | null;
  source_template_name: string | null;
  description: string | null;
  contract_value: number | null;
  revenue_share_terms: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  renewal_date: string | null;
  notice_deadline: string | null;
  auto_renew: boolean | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  countersigned_at: string | null;
  internal_countersigner_user_id: string | null;
  internal_countersigner_name: string | null;
  created_by_user_id: string;
  created_by_name: string | null;
  updated_by_user_id: string;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  replaced_by_agreement_id: string | null;
  replaced_by_agreement_title: string | null;
  prior_agreement_id: string | null;
  prior_agreement_title: string | null;
  signers: AgreementSignerRecord[];
  versions: AgreementVersionRecord[];
  files: AgreementFileRecord[];
  links: AgreementLinkRecord[];
  reminders: AgreementReminderRecord[];
  due_reminders: AgreementReminderType[];
  warning_codes: AgreementWarningCode[];
  warning_severity: AgreementWarningSeverity;
  warning_summary: string | null;
  external_provider_name: AgreementExternalProviderName | null;
  external_envelope_id: string | null;
  external_status: string | null;
  last_provider_sync_at: string | null;
  provider_error_state: string | null;
  provider_metadata: Record<string, unknown>;
  provider_lifecycle_bucket: AgreementProviderLifecycleBucket;
  provider_sync_health: AgreementProviderSyncHealth;
  provider_events: AgreementProviderEventRecord[];
  activity_log: AgreementActivityRecord[];
}

export interface OrganizationAgreementSummary {
  total: number;
  active: number;
  pending_signature: number;
  expiring_soon: number;
  expired: number;
  replaced_archived: number;
  renewals_needed: number;
  accounts_missing_active: number;
  upcoming_shoot_risk_count: number;
  has_active_agreement: boolean;
  has_pending_signature: boolean;
  has_expiring_soon: boolean;
  has_expired: boolean;
  needs_attention: boolean;
  warning_severity: AgreementWarningSeverity;
  warnings: AgreementAccountWarningRecord[];
}

export interface AgreementAccess {
  can_view: boolean;
  can_manage: boolean;
}
