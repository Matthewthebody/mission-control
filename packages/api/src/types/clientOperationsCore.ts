export type ClientOperationsEntityName =
  | "Organization"
  | "Contact"
  | "Location"
  | "Shoot"
  | "Resource Library Item"
  | "Agreement"
  | "Post-Shoot Evaluation"
  | "Recurring Location Intelligence"
  | "Time Session"
  | "Time Segment"
  | "Asset"
  | "Kit";

export type ClientOperationsSystemName =
  | "Time Clock / Labor Tracking"
  | "Gear / Equipment"
  | "Alerts / Notifications"
  | "Reporting / Dashboards";

export type ClientOperationsRoleGroup =
  | "Leadership"
  | "Schools department"
  | "Sports department"
  | "Customer service"
  | "Assistant managers"
  | "Photographers";

export type ClientOperationsWarningCode =
  | "missing_active_agreement"
  | "upcoming_shoot_without_signed_agreement"
  | "missing_setup_photos"
  | "missing_post_shoot_evaluation"
  | "mileage_blocked_missing_evaluation"
  | "gear_not_returned"
  | "assigned_but_missing_employee"
  | "likely_present_missing_clock_in";

export type ClientOperationsCanonicalEntity = {
  entity: ClientOperationsEntityName;
  canonical_owner: string;
  description: string;
  source_of_truth_rule: string;
  notes: string;
};

export type ClientOperationsRelationshipRule = {
  from_entity: ClientOperationsEntityName;
  to_entity: ClientOperationsEntityName;
  cardinality: string;
  relationship_rule: string;
  ownership_rule: string;
  notes: string;
};

export type ClientOperationsConnectedSystemRule = {
  system: ClientOperationsSystemName;
  canonical_entities_used: ClientOperationsEntityName[];
  source_of_truth_rule: string;
  projection_rule: string;
  notes: string;
};

export type ClientOperationsPermissionStrategyRow = {
  role_group: ClientOperationsRoleGroup;
  create_scope: string[];
  manage_scope: string[];
  default_view_scope: string;
  restrictions: string[];
};

export type ClientOperationsActivityLogRule = {
  event_family: string;
  shared_activity_log: boolean;
  module_specific_log: string | null;
  primary_scope_entities: ClientOperationsEntityName[];
  notes: string;
};

export type ClientOperationsDocumentMediaRule = {
  subject: string;
  canonical_storage_model: string;
  module_surfaces: string[];
  access_rule: string;
  notes: string;
};

export type ClientOperationsSearchRule = {
  facet: string;
  canonical_sources: string[];
  expected_behavior: string;
  notes: string;
};

export type ClientOperationsWarningSurfaceRule = {
  warning_code: ClientOperationsWarningCode;
  originating_systems: string[];
  primary_surfaces: string[];
  escalation_rule: string;
  notes: string;
};

export type ClientOperationsInformationArchitecture = {
  top_level_navigation: string[];
  operations_sections: string[];
  client_organization_sections: string[];
  notes: string[];
};

export type ClientOperationsNamingRule = {
  term: ClientOperationsEntityName | string;
  definition: string;
  aliases_to_avoid: string[];
  notes: string;
};

export type ClientOperationsFutureProofingRule = {
  capability: string;
  architectural_support: string;
  notes: string;
};

export type ClientOperationsCoreContract = {
  domain_name: string;
  architecture_choice: string;
  north_star: string;
  canonical_entities: ClientOperationsCanonicalEntity[];
  relationship_rules: ClientOperationsRelationshipRule[];
  connected_systems: ClientOperationsConnectedSystemRule[];
  permissions_strategy: ClientOperationsPermissionStrategyRow[];
  activity_log_strategy: ClientOperationsActivityLogRule[];
  file_document_media_strategy: ClientOperationsDocumentMediaRule[];
  search_strategy: ClientOperationsSearchRule[];
  warning_strategy: ClientOperationsWarningSurfaceRule[];
  information_architecture: ClientOperationsInformationArchitecture;
  naming_dictionary: ClientOperationsNamingRule[];
  future_proofing: ClientOperationsFutureProofingRule[];
  reviewer_handoff: string[];
};
