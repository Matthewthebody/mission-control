export type AdminSettingScopeType =
  | "global"
  | "department"
  | "workflow_type"
  | "shoot_type"
  | "job_type"
  | "account"
  | "location"
  | "role";

export type AdminSettingValueType = "number" | "boolean" | "text" | "enum" | "time_range" | "color" | "json";
export type AdminSettingStatus = "approved" | "pending_approval" | "rejected" | "superseded" | "archived";

export type AdminSettingValueRecord = {
  id: string;
  setting_key: string;
  scope_type: AdminSettingScopeType;
  scope_id: string | null;
  scope_label: string | null;
  value: boolean | number | string | Record<string, unknown> | null;
  value_type: AdminSettingValueType;
  status: AdminSettingStatus;
  requires_approval: boolean;
  is_override: boolean;
  effective_at: string;
  expires_at: string | null;
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reason: string;
  impact_snapshot: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AdminSettingsWorkspace = {
  generated_at: string;
  scope_hierarchy: AdminSettingScopeType[];
  summary_strip: Array<{
    id: string;
    label: string;
    value: number;
    detail: string;
    tone: "neutral" | "good" | "warning" | "danger";
  }>;
  categories: Array<{
    id: string;
    label: string;
    description: string;
    setting_count: number;
    pending_count: number;
    override_count: number;
  }>;
  settings: Array<{
    definition: {
      key: string;
      label: string;
      description: string;
      why_it_matters: string;
      category: string;
      default_value: boolean | number | string | Record<string, unknown>;
      value_type: AdminSettingValueType;
      allowed_scopes: AdminSettingScopeType[];
      impacted_modules: string[];
      editor_group: string;
      protected_change: boolean;
      override_capable: boolean;
      enum_values: string[];
      help_text: string | null;
      who_can_edit: string;
    };
    global_value: AdminSettingValueRecord | null;
    active_overrides: AdminSettingValueRecord[];
    pending_changes: AdminSettingValueRecord[];
    history: AdminSettingValueRecord[];
  }>;
  template_summaries: Array<{
    id: string;
    label: string;
    owner_module: string;
    count: number;
    route_hash: string;
    summary: string;
  }>;
  pending_approvals: AdminSettingValueRecord[];
  scheduled_future_changes: AdminSettingValueRecord[];
  stale_overrides: AdminSettingValueRecord[];
  recent_changes: AdminSettingValueRecord[];
  integration_health_issues: Array<{
    id: string;
    title: string;
    detail: string;
    tone: "neutral" | "warning" | "danger";
    action_hash: string | null;
  }>;
  data_health_warnings: Array<{
    id: string;
    title: string;
    detail: string;
    tone: "neutral" | "warning" | "danger";
    action_hash: string | null;
  }>;
};

export type AdminSettingPreview = {
  generated_at: string;
  setting_key: string;
  scope_type: AdminSettingScopeType;
  scope_id: string | null;
  scope_label: string | null;
  impact_summary: string;
  counts: Record<string, number>;
  freshness: {
    state: "live" | "recently_updated" | "daily_computed";
    label: string;
  };
};

export type AdminSettingChangeInput = {
  setting_key: string;
  scope_type: AdminSettingScopeType;
  scope_id?: string | null;
  scope_label?: string | null;
  value: unknown;
  effective_at?: string | null;
  expires_at?: string | null;
  reason: string;
};

export type AdminSettingPreviewInput = Pick<
  AdminSettingChangeInput,
  "setting_key" | "scope_type" | "scope_id" | "scope_label" | "value"
>;
