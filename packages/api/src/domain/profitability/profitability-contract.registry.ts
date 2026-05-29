import type {
  ProfitabilityApiSurfaceProposal,
  ProfitabilityDefinition,
  ProfitabilityMetricKey,
  ProfitabilityIdentityRule,
  ProfitabilityImportContract,
  ProfitabilityPermissionMatrixRow,
  ProfitabilityPhase0Contract,
  ProfitabilityRecalcTrigger,
  ProfitabilitySchemaTableProposal,
  ProfitabilitySourceOfTruthRule
} from "./profitability-phase0-contract.js";

export const PROFITABILITY_DICTIONARY: ProfitabilityDefinition[] = [
  {
    key: "gross_revenue",
    label: "Gross Revenue",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Imported billed revenue before credits, write-offs, or contra adjustments.",
    formula_summary: "Sum of imported revenue lines mapped to the target scope before adjustments."
  },
  {
    key: "adjusted_revenue",
    label: "Adjusted Revenue",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Gross Revenue after credits, discounts, write-offs, and approved revenue adjustments.",
    formula_summary: "Gross Revenue minus approved contra-revenue adjustments."
  },
  {
    key: "net_operating_revenue",
    label: "Net Operating Revenue",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Adjusted Revenue attributable to operating delivery after excluding non-operating pass-through lines.",
    formula_summary: "Adjusted Revenue minus excluded pass-through or non-operating revenue lines."
  },
  {
    key: "direct_job_cost",
    label: "Direct Job Cost",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Direct labor, lab/print, shipping, remake, reshoot, and other directly attributable job costs.",
    formula_summary: "Sum of mapped direct expense entries plus approved direct labor allocation."
  },
  {
    key: "contribution_margin",
    label: "Contribution Margin",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Operating contribution remaining after direct job cost but before allocated overhead.",
    formula_summary: "Net Operating Revenue minus Direct Job Cost."
  },
  {
    key: "allocated_overhead_cost",
    label: "Allocated Overhead Cost",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Overhead assigned through explicit allocation rules and allocation runs.",
    formula_summary: "Sum of allocation outputs for the snapshot scope and calculation version."
  },
  {
    key: "fully_loaded_margin",
    label: "Fully Loaded Margin",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Margin after direct job cost and allocated overhead cost.",
    formula_summary: "Contribution Margin minus Allocated Overhead Cost."
  },
  {
    key: "profit_per_subject",
    label: "Profit Per Subject",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Fully loaded margin normalized by delivered subject count.",
    formula_summary: "Fully Loaded Margin divided by delivered subject count when subject count is greater than zero."
  },
  {
    key: "profit_per_labor_hour",
    label: "Profit Per Labor Hour",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Fully loaded margin normalized by approved paid labor hours.",
    formula_summary: "Fully Loaded Margin divided by approved paid labor hours when hours are greater than zero."
  },
  {
    key: "customer_service_burden_cost",
    label: "Customer Service Burden Cost",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Imported or allocated support burden cost tied to service load for the job or account.",
    formula_summary: "Mapped support burden import total or allocation result for the scope."
  },
  {
    key: "remake_cost",
    label: "Remake Cost",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Direct cost attributable to remake work linked back to the original job.",
    formula_summary: "Sum of remake-tagged direct cost lines mapped to the original job lineage."
  },
  {
    key: "reshoot_cost",
    label: "Reshoot Cost",
    visibility: "leadership_only",
    unit: "currency",
    aggregation_levels: ["job", "account", "season", "division", "dashboard"],
    definition: "Direct cost attributable to reshoot work linked back to the original job.",
    formula_summary: "Sum of reshoot-tagged direct cost lines mapped to the original job lineage."
  },
  {
    key: "operational_burden_score",
    label: "Operational Burden Score",
    visibility: "leadership_only",
    unit: "score",
    aggregation_levels: ["job", "account", "season", "division", "staff", "location", "dashboard"],
    definition: "Weighted non-dollar burden score from issues, remakes, reshoots, service burden, and execution exceptions.",
    formula_summary: "Versioned weighted score from approved operational burden inputs; no hidden formula drift."
  },
  {
    key: "on_time_rate",
    label: "On-Time Rate",
    visibility: "employee_safe",
    unit: "percentage",
    aggregation_levels: ["staff", "dashboard"],
    definition: "Share of assigned work completed without late or no-show attendance states.",
    formula_summary: "On-time completed assignments divided by total completed assignments in scope."
  },
  {
    key: "clock_exception_rate",
    label: "Clock Exception Rate",
    visibility: "employee_safe",
    unit: "percentage",
    aggregation_levels: ["staff", "dashboard"],
    definition: "Rate of shifts carrying missed punches, late clock-ins, or correction-required attendance exceptions.",
    formula_summary: "Exception-bearing shifts divided by total assigned shifts in scope."
  },
  {
    key: "setup_photo_completion_rate",
    label: "Setup Photo Completion Rate",
    visibility: "employee_safe",
    unit: "percentage",
    aggregation_levels: ["staff", "dashboard"],
    definition: "Rate of required Setup Photo completion on covered Shoots.",
    formula_summary: "Completed required Setup Photos divided by required Setup Photo opportunities."
  },
  {
    key: "post_shoot_evaluation_completion_rate",
    label: "Post-Shoot Evaluation Completion Rate",
    visibility: "employee_safe",
    unit: "percentage",
    aggregation_levels: ["staff", "dashboard"],
    definition: "Rate of required Post-Shoot Evaluation completion.",
    formula_summary: "Submitted required Post-Shoot Evaluations divided by required Post-Shoot Evaluation opportunities."
  },
  {
    key: "issue_free_shoot_rate",
    label: "Issue-Free Shoot Rate",
    visibility: "employee_safe",
    unit: "percentage",
    aggregation_levels: ["staff", "dashboard"],
    definition: "Rate of completed Shoots without issue, remake, or reshoot burden linked to the assignment.",
    formula_summary: "Issue-free completed Shoots divided by completed Shoots in scope."
  },
  {
    key: "remake_follow_up_count",
    label: "Remake Follow-Up Count",
    visibility: "employee_safe",
    unit: "count",
    aggregation_levels: ["staff", "dashboard"],
    definition: "Count of follow-up remake items linked to completed work in the reporting window.",
    formula_summary: "Count of remake-linked follow-up records mapped to the staff scope."
  },
  {
    key: "qa_return_for_fix_rate",
    label: "QA Return-For-Fix Rate",
    visibility: "employee_safe",
    unit: "percentage",
    aggregation_levels: ["staff", "dashboard"],
    definition: "Rate of QA return-for-fix outcomes where valid QA linkage exists.",
    formula_summary: "Return-for-fix outcomes divided by QA-reviewed items in scope."
  },
  {
    key: "shoot_complexity_signal",
    label: "Shoot Complexity Signal",
    visibility: "employee_safe",
    unit: "signal",
    aggregation_levels: ["job", "staff", "dashboard"],
    definition: "Role-safe signal summarizing staffing, logistics, setup burden, and historical issue density.",
    formula_summary: "Versioned signal derived from non-financial burden inputs only."
  },
  {
    key: "shoot_readiness_signal",
    label: "Shoot Readiness Signal",
    visibility: "employee_safe",
    unit: "signal",
    aggregation_levels: ["job", "staff", "dashboard"],
    definition: "Role-safe readiness signal based on prep completion, required media, notes, and unresolved compliance items.",
    formula_summary: "Versioned signal derived from operational readiness inputs only."
  }
];
export const PROFITABILITY_SOURCE_OF_TRUTH_MATRIX: ProfitabilitySourceOfTruthRule[] = [
  {
    subject: "Shoot scheduling, staffing, assignment, and status",
    owner: "operational",
    source_entities: ["shoot", "work_shift", "status_event", "schedule projections"],
    notes: "Profitability may consume these inputs but must never rewrite them."
  },
  {
    subject: "Employee identity, authority, and role context",
    owner: "operational",
    source_entities: ["app_user", "user_authority_assignment", "user_job_function_profile"],
    notes: "Used for staff rollups, permission boundaries, and coaching scope."
  },
  {
    subject: "Paid time, corrections, lunch, overtime, and mileage eligibility",
    owner: "operational",
    source_entities: ["time_session", "time_segment", "clock_event", "exception_request", "approval_record", "employee_pay_profile"],
    notes: "Profitability reads approved time-state results only; it does not set payroll truth."
  },
  {
    subject: "Execution quality and recurring readiness context",
    owner: "operational",
    source_entities: ["post_shoot_evaluation", "resource_library_item", "time_clock_compliance_flag"],
    notes: "Feeds burden, coaching, and readiness signals without mutating source workflow history."
  },
  {
    subject: "Revenue, lab cost, shipping, support burden, specialty feeds",
    owner: "imported",
    source_entities: ["revenue imports", "expense imports", "support burden imports"],
    notes: "Raw imports stay immutable and separately stored from calculated snapshots."
  },
  {
    subject: "Profitability snapshots, recommendations, and coaching outputs",
    owner: "derived",
    source_entities: ["profitability snapshots", "recommendation flags", "coaching flags", "dashboard metric snapshots"],
    notes: "Derived domain output only; never silently mutates operational or imported source data."
  }
];

export const PROFITABILITY_IDENTITY_RULES: ProfitabilityIdentityRule[] = [
  {
    identity: "job_id",
    canonical_source: "Shoot.id",
    profitability_alias: "job_id",
    mapping_rule: "Always map profitability job identity to the canonical Shoot id. Never create a parallel profitability job identifier for the same Shoot.",
    fallback_rule: "No fallback fuzzy job creation. Unmapped lines stay unmapped until explicit mapping exists.",
    notes: "Primary business reference should also carry Shoot.shoot_code for import reconciliation."
  },
  {
    identity: "account_id",
    canonical_source: "Organization.id",
    profitability_alias: "account_id",
    mapping_rule: "Account identity is the canonical Organization id, even if legacy imported systems call it account or client.",
    fallback_rule: "Fallback to explicit mapping table only; do not infer from freeform name similarity in Phase 1.",
    notes: "This keeps profitability aligned with canonical Organization naming."
  },
  {
    identity: "season_id",
    canonical_source: "Derived profitability dimension key",
    profitability_alias: "season_id",
    mapping_rule: "Season identity is derived from a versioned season calendar rule-set using Shoot date, department, and service line.",
    fallback_rule: "If season cannot be resolved, mark the snapshot stale and hold the row in validation review.",
    notes: "There is no first-class season table in the current repo, so the domain must own the dimension explicitly."
  },
  {
    identity: "division_id",
    canonical_source: "Derived profitability dimension key",
    profitability_alias: "division_id",
    mapping_rule: "Division identity is derived from department plus normalized service-line mapping, not ad hoc report labels.",
    fallback_rule: "Unknown division must remain explicit and reviewable; no silent bucketing.",
    notes: "Prevents flat reporting drift across schools, sports, studio, events, and commercial work."
  },
  {
    identity: "staff_id",
    canonical_source: "app_user.id",
    profitability_alias: "staff_id",
    mapping_rule: "Staff identity always points to the canonical employee user id.",
    fallback_rule: "Unmapped imported staff references require explicit mapping before staff rollups are considered trusted.",
    notes: "Protects employee-safe projections from identity duplication."
  },
  {
    identity: "location_id",
    canonical_source: "shoot_location.id",
    profitability_alias: "location_id",
    mapping_rule: "Location identity uses canonical Location ids from the existing directory.",
    fallback_rule: "If imported data references an unknown location, keep it unmapped and route it to validation review.",
    notes: "Supports Recurring Location Intelligence linkage."
  },
  {
    identity: "Revenue line to job mapping",
    canonical_source: "Imported source line plus profitability source mapping",
    profitability_alias: "revenue_job_mapping",
    mapping_rule: "Map by explicit external job key to Shoot.shoot_code or Shoot.id through a versioned source mapping table.",
    fallback_rule: "Manual review only; no fuzzy matching on title text in Phase 1.",
    notes: "Trust in the math depends on explicit lineage."
  },
  {
    identity: "Expense line to job mapping",
    canonical_source: "Imported source line plus profitability source mapping",
    profitability_alias: "expense_job_mapping",
    mapping_rule: "Map by explicit external job key, shipment reference, or approved import mapping configuration.",
    fallback_rule: "Keep unmapped until reviewed; do not silently smear cost across jobs.",
    notes: "Critical for contribution margin trust."
  },
  {
    identity: "Remake linkage",
    canonical_source: "Operational issue/remake lineage",
    profitability_alias: "original_job_id",
    mapping_rule: "Every remake or reshoot cost must reference the original Shoot id through explicit lineage columns or mapping rows.",
    fallback_rule: "If original job is unknown, classify as unlinked burden and hold out of original-job margin until reconciled.",
    notes: "Prevents burying remake cost in the wrong season or account."
  },
  {
    identity: "District-level overhead split",
    canonical_source: "Versioned allocation rule set",
    profitability_alias: "district_overhead_split_rule",
    mapping_rule: "District/account family overhead splits are owned by explicit allocation rules keyed by Organization grouping.",
    fallback_rule: "No freeform spreadsheet override without logged rule version and audit trail.",
    notes: "Allocation trust must be reproducible."
  }
];

export const PROFITABILITY_PERMISSIONS_MATRIX: ProfitabilityPermissionMatrixRow[] = [
  {
    audience: "Super Admin",
    leadership_projection_access: "Full view, export, override, and restatement access.",
    employee_projection_access: "Full view for validation.",
    import_access: "Full import config, dry run, apply, and mapping repair access.",
    override_access: "Full override and audit review.",
    notes: "System-level governance only, not the default daily operator."
  },
  {
    audience: "Leadership",
    leadership_projection_access: "Full leadership profitability views with dollars and recommendation visibility.",
    employee_projection_access: "Can inspect employee-safe projections for review.",
    import_access: "Can review imports, dry runs, validation issues, and approved refreshes.",
    override_access: "Can create or approve profitability overrides with audit logging.",
    notes: "Primary audience for Phase 1 and Phase 2."
  },
  {
    audience: "Director Admin",
    leadership_projection_access: "Leadership profitability views in assigned operating scope.",
    employee_projection_access: "Can inspect employee-safe projections for coaching review.",
    import_access: "Can review mapped imports and validation issues in assigned scope.",
    override_access: "Can request or enter scoped overrides with audit logging.",
    notes: "Department-level operations owner."
  },
  {
    audience: "Read-Only Viewer",
    leadership_projection_access: "No default profitability access in Phase 0.",
    employee_projection_access: "No default profitability access in Phase 0.",
    import_access: "None.",
    override_access: "None.",
    notes: "Exclude until leadership approves explicit profitability sharing."
  },
  {
    audience: "Standard Employee / Supervisor",
    leadership_projection_access: "None.",
    employee_projection_access: "Planned for Phase 3 employee-safe projections only.",
    import_access: "None.",
    override_access: "None.",
    notes: "No dollar visibility and no Phase 0 route access."
  }
];

export const PROFITABILITY_IMPORT_CONTRACTS: ProfitabilityImportContract[] = [
  {
    source: "revenue_summary",
    description: "Imported billed revenue and revenue adjustments by job or account.",
    required_mapping_keys: ["external_source_name", "external_job_key", "external_account_key"],
    required_fields: ["occurred_at", "gross_amount", "adjustment_amount", "currency_code"],
    dry_run_supported: true,
    lineage_fields: ["file_name", "batch_reference", "row_number", "source_line_hash"]
  },
  {
    source: "lab_cost",
    description: "Lab, print, and fulfillment cost import.",
    required_mapping_keys: ["external_job_key", "external_account_key"],
    required_fields: ["occurred_at", "cost_amount", "expense_category", "vendor_reference"],
    dry_run_supported: true,
    lineage_fields: ["file_name", "batch_reference", "row_number", "source_line_hash"]
  },
  {
    source: "shipping_cost",
    description: "Shipping and delivery cost import.",
    required_mapping_keys: ["external_job_key", "external_account_key"],
    required_fields: ["occurred_at", "cost_amount", "shipment_reference"],
    dry_run_supported: true,
    lineage_fields: ["file_name", "batch_reference", "row_number", "source_line_hash"]
  },
  {
    source: "support_burden",
    description: "Support burden import from customer service workload summaries.",
    required_mapping_keys: ["external_account_key", "external_job_key"],
    required_fields: ["occurred_at", "burden_units", "burden_cost", "burden_reason"],
    dry_run_supported: true,
    lineage_fields: ["file_name", "batch_reference", "row_number", "source_line_hash"]
  },
  {
    source: "specialty_revenue",
    description: "Specialty revenue feed for product/program-specific lines.",
    required_mapping_keys: ["external_job_key", "external_account_key", "program_code"],
    required_fields: ["occurred_at", "gross_amount", "program_code"],
    dry_run_supported: true,
    lineage_fields: ["file_name", "batch_reference", "row_number", "source_line_hash"]
  },
  {
    source: "yearbook_revenue",
    description: "Yearbook-specific revenue or cost feed.",
    required_mapping_keys: ["external_job_key", "external_account_key", "yearbook_reference"],
    required_fields: ["occurred_at", "gross_amount", "cost_amount"],
    dry_run_supported: true,
    lineage_fields: ["file_name", "batch_reference", "row_number", "source_line_hash"]
  }
];

export const PROFITABILITY_RECALC_TRIGGERS: ProfitabilityRecalcTrigger[] = [
  {
    trigger: "Revenue import completed",
    source_event: "profitability.import.applied:revenue",
    scope: "job",
    job_type: "profitability.snapshot.refresh-range",
    stale_marking_behavior: "Mark affected jobs, accounts, seasons, and dashboard snapshots stale until refresh succeeds."
  },
  {
    trigger: "Expense import completed",
    source_event: "profitability.import.applied:expense",
    scope: "job",
    job_type: "profitability.snapshot.refresh-range",
    stale_marking_behavior: "Mark affected jobs and derived rollups stale."
  },
  {
    trigger: "Approved time records changed",
    source_event: "time_session.updated or exception_request.approved",
    scope: "job",
    job_type: "profitability.snapshot.refresh",
    stale_marking_behavior: "Mark linked jobs and staff rollups stale."
  },
  {
    trigger: "Staffing or assignment changed",
    source_event: "work_shift.updated",
    scope: "job",
    job_type: "profitability.snapshot.refresh",
    stale_marking_behavior: "Mark linked job, staff, and dashboard snapshots stale."
  },
  {
    trigger: "Post-Shoot Evaluation changed",
    source_event: "post_shoot_evaluation.submitted",
    scope: "job",
    job_type: "profitability.coaching-flags.refresh",
    stale_marking_behavior: "Mark coaching flags and burden scores stale."
  },
  {
    trigger: "Issue or remake linkage changed",
    source_event: "issue.updated or remake.linked",
    scope: "job",
    job_type: "profitability.recommendations.refresh",
    stale_marking_behavior: "Mark original job lineage and recommendation rows stale."
  },
  {
    trigger: "Allocation rule changed",
    source_event: "profitability.allocation_rule.updated",
    scope: "date_range",
    job_type: "profitability.snapshot.refresh-range",
    stale_marking_behavior: "Mark all impacted date-range rollups stale and require rebuild with new allocation version."
  },
  {
    trigger: "Override entered or restated",
    source_event: "profitability.override.updated",
    scope: "job",
    job_type: "profitability.snapshot.refresh",
    stale_marking_behavior: "Mark the targeted scope stale and preserve prior snapshot versions."
  }
];

export const PROFITABILITY_SCHEMA_PROPOSAL: ProfitabilitySchemaTableProposal[] = [
  {
    table: "profitability_calculation_version",
    purpose: "Versioned formula and rule-set metadata for reproducibility.",
    key_columns: ["id", "version_tag", "effective_from", "definition_hash"],
    notes: "Every snapshot points at an explicit calculation version."
  },
  {
    table: "profitability_import_run",
    purpose: "Import batch history, dry runs, and lineage.",
    key_columns: ["id", "source_type", "run_mode", "status", "started_at", "completed_at"],
    notes: "Never mix dry-run and applied results."
  },
  {
    table: "profitability_import_validation_issue",
    purpose: "Row-level validation failures and mapping gaps.",
    key_columns: ["id", "import_run_id", "severity", "issue_code", "source_line_hash"],
    notes: "Admin review queue depends on this table."
  },
  {
    table: "profitability_revenue_entry",
    purpose: "Immutable imported revenue lines.",
    key_columns: ["id", "import_run_id", "external_source_name", "source_line_hash", "job_id", "account_id"],
    notes: "Store raw imported values separately from calculated values."
  },
  {
    table: "profitability_expense_entry",
    purpose: "Immutable imported expense and burden lines.",
    key_columns: ["id", "import_run_id", "expense_type", "source_line_hash", "job_id", "account_id"],
    notes: "Supports lab, shipping, support burden, remake, and reshoot cost lineage."
  },
  {
    table: "profitability_source_mapping",
    purpose: "Explicit import-to-domain mapping and manual repairs.",
    key_columns: ["id", "source_type", "external_key", "job_id", "account_id", "mapping_status"],
    notes: "No silent fuzzy mapping in Phase 1."
  },
  {
    table: "profitability_allocation_rule",
    purpose: "Configured overhead and burden allocation rules.",
    key_columns: ["id", "rule_name", "scope_type", "allocation_method", "effective_from"],
    notes: "District-level and division-level splits live here."
  },
  {
    table: "profitability_allocation_run",
    purpose: "Versioned record of rule application against a date range or scope.",
    key_columns: ["id", "rule_id", "calculation_version_id", "date_range_start", "date_range_end"],
    notes: "Supports reproducible restatements."
  },
  {
    table: "profitability_snapshot",
    purpose: "Versioned snapshot rows by job, account, season, division, staff, or location.",
    key_columns: ["id", "snapshot_scope", "scope_id", "calculation_version_id", "snapshot_status", "captured_at"],
    notes: "Never overwrite prior trusted snapshots without versioning."
  },
  {
    table: "profitability_override",
    purpose: "Logged overrides and restatements with reason and actor.",
    key_columns: ["id", "target_scope", "target_id", "override_type", "reason", "created_by"],
    notes: "All overrides must be inspectable and auditable."
  },
  {
    table: "profitability_coaching_flag",
    purpose: "Employee-safe coaching and readiness signals derived from profitability drivers.",
    key_columns: ["id", "staff_id", "job_id", "flag_type", "severity", "snapshot_id"],
    notes: "No direct dollar fields allowed in this table."
  },
  {
    table: "profitability_recommendation_flag",
    purpose: "Leadership recommendations and burden-driver flags.",
    key_columns: ["id", "scope_type", "scope_id", "recommendation_type", "severity", "snapshot_id"],
    notes: "Supports leadership queueing without exposing raw base tables to clients."
  },
  {
    table: "profitability_dashboard_metric_snapshot",
    purpose: "Cached dashboard projection rows for fast leadership and employee-safe dashboards.",
    key_columns: ["id", "audience", "metric_key", "scope_type", "scope_id", "snapshot_id"],
    notes: "Protects dashboard latency and keeps projections explicit."
  }
];

export const PROFITABILITY_API_SURFACE_PROPOSAL: ProfitabilityApiSurfaceProposal[] = [
  {
    route_group: "/api/profitability/contracts",
    audience: "leadership",
    endpoints: ["GET /api/profitability/contracts"],
    includes_financial_fields: false,
    notes: "Phase 0 contract inspection endpoint only."
  },
  {
    route_group: "/api/profitability/leadership",
    audience: "leadership",
    endpoints: [
      "GET /api/profitability/leadership/overview",
      "GET /api/profitability/leadership/jobs",
      "GET /api/profitability/leadership/accounts",
      "GET /api/profitability/leadership/seasons",
      "GET /api/profitability/leadership/divisions",
      "GET /api/profitability/leadership/recommendations"
    ],
    includes_financial_fields: true,
    notes: "Leadership-only projection layer. No raw snapshot table access from clients."
  },
  {
    route_group: "/api/profitability/admin",
    audience: "admin",
    endpoints: [
      "POST /api/profitability/admin/imports/dry-run",
      "POST /api/profitability/admin/imports/apply",
      "POST /api/profitability/admin/rebuild",
      "GET /api/profitability/admin/import-runs",
      "GET /api/profitability/admin/validation-issues",
      "GET /api/profitability/admin/snapshots/:id/lineage"
    ],
    includes_financial_fields: true,
    notes: "Admin validation and inspection endpoints for Phase 1."
  },
  {
    route_group: "/api/profitability/employee",
    audience: "employee_safe",
    endpoints: [
      "GET /api/profitability/employee/my-scorecard",
      "GET /api/profitability/employee/upcoming-readiness",
      "GET /api/profitability/employee/improvement-signals",
      "GET /api/profitability/employee/follow-ups"
    ],
    includes_financial_fields: false,
    notes: "Phase 3 employee-safe projection layer only. No dollars, rates, or margin fields."
  }
];

const ROLLOUT_PHASES = [
  {
    phase: "Phase 0",
    scope: "Architecture and contracts",
    exit_criteria: [
      "Metric definitions approved by leadership.",
      "Identity and import linkage rules approved.",
      "No ambiguity remains about leadership vs employee-safe visibility."
    ]
  },
  {
    phase: "Phase 1",
    scope: "Core engine, admin only",
    exit_criteria: [
      "Historical recalculation works for the approved pilot window.",
      "Any number can be traced back to its raw inputs and calculation version.",
      "No restricted fields leak outside admin routes."
    ]
  },
  {
    phase: "Phase 2",
    scope: "Leadership dashboard",
    exit_criteria: [
      "Leadership can identify best and worst jobs quickly.",
      "Managers can explain why a job performed well or poorly.",
      "Recommendation noise is acceptable."
    ]
  },
  {
    phase: "Phase 3",
    scope: "Employee-safe surfaces",
    exit_criteria: [
      "Employee signals improve readiness and execution without exposing dollars.",
      "Managers agree the language is supportive and useful.",
      "Field-leak tests prove no financial data reaches employee clients."
    ]
  },
  {
    phase: "Phase 4",
    scope: "Automation and hardening",
    exit_criteria: [
      "Imports and recalculations run safely without fragile babysitting.",
      "Stale snapshots and failed mappings are visible and actionable.",
      "Rebuilds remain idempotent."
    ]
  },
  {
    phase: "Phase 5",
    scope: "Advanced intelligence",
    exit_criteria: [
      "Scenario and planning outputs sit on trusted historical profitability math.",
      "Pricing/planning guidance is auditable and explainable."
    ]
  }
] as const;

export function getProfitabilityPhase0Contract(): ProfitabilityPhase0Contract {
  return {
    domain_name: "Profitability",
    architecture_choice:
      "Bounded domain inside Mission Control with separate services, worker jobs, and protected projection layers. No standalone app in Phase 1.",
    dictionary: PROFITABILITY_DICTIONARY,
    source_of_truth_matrix: PROFITABILITY_SOURCE_OF_TRUTH_MATRIX,
    identity_rules: PROFITABILITY_IDENTITY_RULES,
    permissions_matrix: PROFITABILITY_PERMISSIONS_MATRIX,
    import_contracts: PROFITABILITY_IMPORT_CONTRACTS,
    recalc_triggers: PROFITABILITY_RECALC_TRIGGERS,
    schema_proposal: PROFITABILITY_SCHEMA_PROPOSAL,
    api_surface_proposal: PROFITABILITY_API_SURFACE_PROPOSAL,
    snapshot_strategy: {
      live_source_policy: "All dashboards read cached projections or snapshots. Front-end clients never read raw profitability tables directly.",
      snapshot_tables: ["profitability_snapshot", "profitability_dashboard_metric_snapshot", "profitability_recommendation_flag", "profitability_coaching_flag"],
      versioning_strategy: "Every snapshot row points to a calculation version and preserves prior runs for restatement and audit.",
      stale_marking_strategy: "When upstream operational or imported data changes, impacted scopes are marked stale until the appropriate refresh job succeeds."
    },
    calculation_lifecycle: {
      versioning: "Every formula set, allocation rule set, and recommendation rule set must carry a version tag and effective range.",
      reproducibility: "Any leadership number must be traceable to raw imported entries, operational inputs, calculation version, allocation run, and overrides.",
      override_policy: "Overrides never rewrite raw source lines. They append logged override rows and trigger restated snapshots.",
      backfill_policy: "Initial backfill covers a defined 3-6 month window and is replayable by date range."
    },
    audit_and_observability_plan: {
      audit_events: [
        "import_run.created",
        "import_run.applied",
        "import_validation_issue.created",
        "profitability.override.created",
        "profitability.override.reverted",
        "profitability.snapshot.rebuilt",
        "profitability.permission_denied",
        "profitability.restatement.created"
      ],
      operational_metrics: [
        "import error count",
        "mapping mismatch count",
        "stale snapshot count",
        "recalc queue backlog",
        "recommendation refresh age",
        "employee-safe projection leak test status"
      ],
      traceability_requirements: [
        "Dashboard number must link to snapshot id and calculation version.",
        "Snapshot must link to import runs, allocation runs, and overrides used.",
        "Permission-denied attempts on profitability routes must be auditable."
      ]
    },
    rollout_plan: {
      phases: ROLLOUT_PHASES.map((phase) => ({
        phase: phase.phase,
        scope: phase.scope,
        exit_criteria: [...phase.exit_criteria]
      }))
    },
    backfill_plan: {
      initial_window: "Last 3 to 6 months of completed Shoots, approved time data, and imported revenue/cost feeds.",
      sequencing: [
        "Backfill canonical mapping tables first.",
        "Backfill raw import entries second.",
        "Run direct-cost and allocation rebuild third.",
        "Validate example jobs with leadership before wider dashboard rollout."
      ],
      safety_notes: [
        "Never overwrite prior snapshots without versioning.",
        "Keep restatements explicit and audit logged.",
        "Unmapped lines must remain visible as validation issues, not silently dropped."
      ]
    }
  };
}

export function getLeadershipProfitabilityMetricKeys() {
  return PROFITABILITY_DICTIONARY.filter((entry) => entry.visibility === "leadership_only").map(
    (entry) => entry.key
  );
}

export function getEmployeeSafeProfitabilityMetricKeys() {
  return PROFITABILITY_DICTIONARY.filter((entry) => entry.visibility === "employee_safe").map(
    (entry) => entry.key
  );
}

export function getProfitabilityMetricDefinition(
  metricKey: ProfitabilityMetricKey
): ProfitabilityDefinition {
  const definition = PROFITABILITY_DICTIONARY.find((entry) => entry.key === metricKey);

  if (!definition) {
    throw new Error(`Unknown profitability metric definition: ${metricKey}`);
  }

  return definition;
}

export function listProfitabilityMetricDefinitions(): ProfitabilityDefinition[] {
  return [...PROFITABILITY_DICTIONARY];
}
