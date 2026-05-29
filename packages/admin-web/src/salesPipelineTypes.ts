export type SalesPipelineType = "schools" | "sports";
export type SalesOpportunityType = "new" | "renewal" | "expansion";
export type SalesOpportunityStage =
  | "lead"
  | "contacted"
  | "meeting_scheduled"
  | "proposal_sent"
  | "follow_up"
  | "negotiation"
  | "contract_sent"
  | "won"
  | "lost"
  | "dormant";
export type SalesOpportunityStatus = "active" | "dormant" | "won" | "lost";
export type SalesOpportunityAttentionState = "standard" | "warning" | "critical";
export type SalesPipelineAlertType = "missing_next_action" | "inactive_opportunity" | "meeting_scheduled";
export type SalesPipelineAlertStatus = "open" | "resolved";
export type SalesPipelineAlertSeverity = "warning" | "major" | "critical";
export type SalesEmailTemplateKey =
  | "proposal_email"
  | "contract_follow_up"
  | "renewal_outreach"
  | "onboarding_message"
  | "post_shoot_follow_up";
export type SalesEmailTriggerType = "manual" | "automated";
export type SalesEmailCommunicationStatus = "queued" | "sent" | "skipped" | "failed";
export type SalesEmailEventType = "queued" | "sent" | "skipped" | "failed";

export type SalesPipelineOwnerOption = {
  id: string;
  full_name: string;
  email: string;
  authority_tier: string;
  primary_job_function_profile: string;
  department: string;
};

export type SalesOpportunitySummary = {
  id: string;
  organization_id: string;
  organization_display_name: string;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  opportunity_type: SalesOpportunityType;
  pipeline_type: SalesPipelineType;
  stage: SalesOpportunityStage;
  estimated_value: number | null;
  next_action_date: string | null;
  last_touch_date: string;
  last_verified_contact_date: string | null;
  notes: string | null;
  status: SalesOpportunityStatus;
  follow_up_date: string | null;
  resurface_ready: boolean;
  next_action_missing: boolean;
  next_action_overdue: boolean;
  open_alert_count: number;
  attention_state: SalesOpportunityAttentionState;
  created_at: string;
  updated_at: string;
};

export type SalesPipelineAlertRecord = {
  id: string;
  alert_type: SalesPipelineAlertType;
  status: SalesPipelineAlertStatus;
  severity: SalesPipelineAlertSeverity;
  dedupe_key: string;
  pipeline_type: SalesPipelineType | null;
  opportunity_id: string | null;
  organization_id: string | null;
  agreement_id: string | null;
  linked_shoot_id: string | null;
  title: string;
  message: string;
  due_at: string | null;
  first_triggered_at: string;
  last_triggered_at: string;
  first_notified_at: string | null;
  last_notified_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SalesPipelineAutomationSummary = {
  missing_next_action: number;
  inactive_opportunities: number;
  meeting_scheduled: number;
  contract_reminders_due: number;
  renewals_due: number;
  upcoming_shoot_risk: number;
  pending_unsigned_accounts: number;
  accounts_missing_active_agreement: number;
};

export type SalesEmailTemplateRecord = {
  id: string;
  template_key: SalesEmailTemplateKey;
  template_name: string;
  subject_template: string;
  body_template: string;
  merge_fields: string[];
  active_status: boolean;
  automation_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type SalesEmailCommunicationEventRecord = {
  id: string;
  communication_id: string;
  event_type: SalesEmailEventType;
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
  created_at: string;
};

export type SalesEmailCommunicationRecord = {
  id: string;
  template_id: string | null;
  template_key: SalesEmailTemplateKey | null;
  template_name: string | null;
  opportunity_id: string | null;
  organization_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  trigger_type: SalesEmailTriggerType;
  status: SalesEmailCommunicationStatus;
  subject: string;
  body: string;
  queued_at: string;
  sent_at: string | null;
  last_delivery_attempt_at: string | null;
  delivery_provider: string | null;
  delivery_reference: string | null;
  provider_error_state: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  events: SalesEmailCommunicationEventRecord[];
};

export type SalesOpportunityStageRuleState = {
  proposal_sent_blockers: string[];
  contract_sent_blockers: string[];
  won_blockers: string[];
  has_signed_agreement_on_file: boolean;
  signed_agreement_count: number;
};

export type SalesOpportunityDetail = {
  opportunity: SalesOpportunitySummary;
  stage_rules: SalesOpportunityStageRuleState;
  alerts: SalesPipelineAlertRecord[];
  email_templates?: SalesEmailTemplateRecord[];
  communications?: SalesEmailCommunicationRecord[];
};

export type SalesPipelineStageColumn = {
  stage: SalesOpportunityStage;
  label: string;
  opportunities: SalesOpportunitySummary[];
};

export type SalesPipelineSummary = {
  active: number;
  dormant: number;
  won: number;
  lost: number;
  resurfacing_soon: number;
  overdue_next_actions: number;
};

export type SalesPipelineLane = {
  pipeline_type: SalesPipelineType;
  label: string;
  summary: SalesPipelineSummary;
  resurfacing_soon: SalesOpportunitySummary[];
  stage_columns: SalesPipelineStageColumn[];
};

export type SalesPipelineBoardView = {
  generated_at: string;
  allowed_pipeline_types: SalesPipelineType[];
  summary: SalesPipelineSummary;
  automation_summary: SalesPipelineAutomationSummary;
  automation_alerts: SalesPipelineAlertRecord[];
  pipelines: SalesPipelineLane[];
};

export type SalesOpportunityListView = {
  allowed_pipeline_types: SalesPipelineType[];
  summary: SalesPipelineSummary & {
    total: number;
  };
  automation_summary: SalesPipelineAutomationSummary;
  automation_alerts: SalesPipelineAlertRecord[];
  opportunities: SalesOpportunitySummary[];
};
