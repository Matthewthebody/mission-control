import type {
  DirectoryActiveStatus,
  DirectoryCommunicationOutcome,
  DirectoryContactRoleCategory,
  DirectoryContactRelationshipRole,
  DirectoryContactStatus,
  DirectoryDecisionInfluence,
  DirectoryDuplicateReviewDecision,
  DirectoryFreshnessState,
  DirectoryOperationalImportance,
  DirectoryRelationshipFollowUpStatus,
  DirectoryRelationshipHealthState,
  DirectoryRelationshipMemoryStatus,
  DirectoryRelationshipMemoryType,
  DirectoryRelationshipMemoryVisibility,
  DirectoryRelationshipOwnershipState,
  DirectoryRelationshipStrength,
  SchoolContactCategory,
  SchoolRelationshipHealthState,
  SchoolRuleType,
  DirectoryTouchpointCategory,
  DirectoryTouchpointChannel,
  DirectoryTouchpointPlanStatus,
  OrganizationAccountType,
  OrganizationLocation,
  OrganizationRecentShoot,
  OrganizationUpcomingShoot
} from "../../types";

export type DirectoryView = "organizations" | "contacts" | "locations";
export type DirectoryWorkspaceTab = "profile" | "relationships" | "operations" | "touchpoints" | "linked_shoots" | "duplicates";

export const ACCOUNT_TYPE_OPTIONS: Array<{ value: OrganizationAccountType | "all"; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "schools_underclass_portraits", label: "School District / School" },
  { value: "schools_events", label: "School Event Organization" },
  { value: "sports", label: "Sports Association" },
  { value: "events", label: "Event Organization" },
  { value: "studio", label: "Studio" },
  { value: "headshots", label: "Specialty / In-Studio" },
  { value: "commercial", label: "Commercial" },
  { value: "internal", label: "Company Team" }
];

export const ACTIVE_STATUS_OPTIONS: Array<{ value: DirectoryActiveStatus | "all"; label: string }> = [
  { value: "active", label: "Active only" },
  { value: "inactive", label: "Archived only" },
  { value: "all", label: "All statuses" }
];

export const CONTACT_STATUS_OPTIONS: Array<{ value: DirectoryContactStatus | "all"; label: string }> = [
  { value: "all", label: "All contact states" },
  { value: "active", label: "Active" },
  { value: "needs_review", label: "Needs Review" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" }
];

export const CONTACT_ROLE_CATEGORY_OPTIONS: Array<{ value: DirectoryContactRoleCategory | "all"; label: string }> = [
  { value: "all", label: "All role categories" },
  { value: "district_leadership", label: "District Leadership" },
  { value: "school_leadership", label: "School Leadership" },
  { value: "school_administration", label: "School Administration" },
  { value: "yearbook_publications", label: "Yearbook / Publications" },
  { value: "athletics_activities", label: "Athletics / Activities" },
  { value: "day_of_logistics", label: "Day-of Logistics" },
  { value: "data_roster", label: "Data / Roster" },
  { value: "finance_billing", label: "Finance / Billing" },
  { value: "technology_systems", label: "Technology / Systems" },
  { value: "front_office_secretary", label: "Front Office / Secretary" },
  { value: "facilities_building_access", label: "Facilities / Building Access" },
  { value: "vendor_external_partner", label: "Vendor / External Partner" },
  { value: "other", label: "Other" }
];

export const OPERATIONAL_IMPORTANCE_OPTIONS: Array<{ value: DirectoryOperationalImportance | "all"; label: string }> = [
  { value: "all", label: "All importance levels" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" }
];

export const DECISION_INFLUENCE_OPTIONS: Array<{ value: DirectoryDecisionInfluence | "all"; label: string }> = [
  { value: "all", label: "All influence types" },
  { value: "decision_maker", label: "Decision Maker" },
  { value: "approver", label: "Approver" },
  { value: "recommender", label: "Recommender" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "day_to_day_operator", label: "Day-to-Day Operator" },
  { value: "logistics_owner", label: "Logistics Owner" },
  { value: "billing_owner", label: "Billing Owner" },
  { value: "informational_only", label: "Informational Only" }
];

export const RELATIONSHIP_STRENGTH_OPTIONS: Array<{ value: DirectoryRelationshipStrength; label: string }> = [
  { value: "introduced", label: "Introduced" },
  { value: "working_relationship", label: "Working Relationship" },
  { value: "strong_relationship", label: "Strong Relationship" },
  { value: "trusted_relationship", label: "Trusted Relationship" },
  { value: "unknown", label: "Unknown / No Active Relationship" }
];

export const OWNERSHIP_STATE_OPTIONS: Array<{ value: DirectoryRelationshipOwnershipState | "all"; label: string }> = [
  { value: "all", label: "All ownership states" },
  { value: "owned", label: "Owned" },
  { value: "shared", label: "Shared" },
  { value: "unassigned", label: "Unassigned" },
  { value: "needs_reassignment", label: "Needs Reassignment" }
];

export const DIRECTORY_VIEW_OPTIONS: Array<{ value: DirectoryView; label: string }> = [
  { value: "organizations", label: "Organizations" },
  { value: "contacts", label: "Contacts" },
  { value: "locations", label: "Locations" }
];

export const WORKSPACE_TAB_OPTIONS: Array<{ value: DirectoryWorkspaceTab; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "relationships", label: "Relationships" },
  { value: "operations", label: "Operations" },
  { value: "touchpoints", label: "Continuity" },
  { value: "linked_shoots", label: "Linked Shoots" },
  { value: "duplicates", label: "Duplicates" }
];

export const RELATIONSHIP_ROLE_OPTIONS: Array<{ value: DirectoryContactRelationshipRole; label: string }> = [
  { value: "general", label: "General" },
  { value: "planning", label: "Planning" },
  { value: "billing", label: "Billing" },
  { value: "decision_maker", label: "Decision Maker" },
  { value: "day_of", label: "Day Of" },
  { value: "operations", label: "Operations" },
  { value: "other", label: "Other" }
];

export const TOUCHPOINT_CHANNEL_OPTIONS: Array<{ value: DirectoryTouchpointChannel; label: string }> = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "text", label: "Text" },
  { value: "meeting", label: "Meeting" },
  { value: "onsite", label: "Onsite" },
  { value: "note", label: "Note" },
  { value: "picture_day_conversation", label: "Picture Day Conversation" },
  { value: "internal_debrief", label: "Internal Debrief" },
  { value: "portal_message", label: "Portal Message" },
  { value: "other", label: "Other" }
];

export const TOUCHPOINT_CATEGORY_OPTIONS: Array<{ value: DirectoryTouchpointCategory; label: string }> = [
  { value: "planning", label: "Planning" },
  { value: "pre_shoot_confirmation", label: "Pre-Shoot Confirmation" },
  { value: "day_of_readiness", label: "Day-of Readiness" },
  { value: "post_shoot_follow_up", label: "Post-Shoot Follow-Up" },
  { value: "yearbook_deliverables", label: "Yearbook / Deliverables" },
  { value: "customer_issue_resolution", label: "Customer Issue Resolution" },
  { value: "relationship_maintenance", label: "Relationship Maintenance" },
  { value: "renewal_contract", label: "Renewal / Contract" },
  { value: "billing_finance", label: "Billing / Finance" },
  { value: "operational_change", label: "Operational Change" },
  { value: "thank_you_appreciation", label: "Thank You / Appreciation" },
  { value: "executive_leadership_checkin", label: "Executive / Leadership Check-In" }
];

export const COMMUNICATION_OUTCOME_OPTIONS: Array<{ value: DirectoryCommunicationOutcome; label: string }> = [
  { value: "informational_only", label: "Informational Only" },
  { value: "confirmed", label: "Confirmed" },
  { value: "waiting_on_customer", label: "Waiting on Customer" },
  { value: "waiting_on_internal_team", label: "Waiting on Internal Team" },
  { value: "follow_up_needed", label: "Follow-Up Needed" },
  { value: "resolved", label: "Resolved" },
  { value: "escalated", label: "Escalated" },
  { value: "relationship_building", label: "Relationship Building" },
  { value: "problem_identified", label: "Problem Identified" }
];

export const RELATIONSHIP_MEMORY_TYPE_OPTIONS: Array<{ value: DirectoryRelationshipMemoryType; label: string }> = [
  { value: "communication_preference", label: "Communication Preference" },
  { value: "operational_expectation", label: "Operational Expectation" },
  { value: "cadence_timing_preference", label: "Cadence / Timing Preference" },
  { value: "escalation_preference", label: "Escalation Preference" },
  { value: "day_of_coordination_preference", label: "Day-of Coordination Preference" },
  { value: "yearbook_deliverable_preference", label: "Yearbook / Deliverable Preference" },
  { value: "relationship_sensitivity", label: "Relationship Sensitivity" },
  { value: "appreciation_hospitality_note", label: "Appreciation / Hospitality Note" },
  { value: "other", label: "Other" }
];

export const RELATIONSHIP_MEMORY_VISIBILITY_OPTIONS: Array<{ value: DirectoryRelationshipMemoryVisibility; label: string }> = [
  { value: "assignment_relevant", label: "Assignment Relevant" },
  { value: "manager_plus", label: "Manager Plus" },
  { value: "leadership_only", label: "Leadership Only" }
];

export const DUPLICATE_REVIEW_DECISION_OPTIONS: Array<{ value: DirectoryDuplicateReviewDecision; label: string }> = [
  { value: "pending", label: "Pending review" },
  { value: "keep_separate", label: "Keep separate" },
  { value: "merge_candidate", label: "Merge candidate" },
  { value: "merged_later", label: "Merged later" }
];

export const SCHOOL_RELATIONSHIP_HEALTH_OPTIONS: Array<{ value: SchoolRelationshipHealthState; label: string }> = [
  { value: "healthy", label: "Healthy" },
  { value: "needs_attention", label: "Needs Attention" },
  { value: "fragile", label: "Fragile" },
  { value: "at_risk", label: "At Risk" },
  { value: "unknown", label: "Unknown" }
];

export const SCHOOL_CONTACT_CATEGORY_OPTIONS: Array<{ value: SchoolContactCategory; label: string }> = [
  { value: "principal", label: "Principal" },
  { value: "secretary", label: "Secretary" },
  { value: "district_contact", label: "District Contact" },
  { value: "photo_day_contact", label: "Photo Day Contact" },
  { value: "yearbook_contact", label: "Yearbook Contact" },
  { value: "billing_contact", label: "Billing Contact" },
  { value: "athletics_contact", label: "Athletics Contact" },
  { value: "graduation_contact", label: "Graduation Contact" },
  { value: "other", label: "Other" }
];

export const SCHOOL_RULE_TYPE_OPTIONS: Array<{ value: SchoolRuleType; label: string }> = [
  { value: "additional_language_needs", label: "Additional Language Needs" },
  { value: "qr_organization_rules", label: "QR Organization Rules" },
  { value: "hat_policy", label: "Hat Policy" },
  { value: "additional_shoot_rules", label: "Additional Shoot Rules" },
  { value: "punch_id_rules", label: "Punch / ID Rules" },
  { value: "sticker_counts", label: "Sticker Counts" },
  { value: "subject_directory_requirements", label: "Subject Directory Requirements" },
  { value: "subject_directory_counts", label: "Subject Directory Counts" },
  { value: "yearbook_participation", label: "Yearbook Participation" },
  { value: "delivery_preferences", label: "Delivery Preferences" },
  { value: "mailing_preferences", label: "Mailing Preferences" },
  { value: "special_handling", label: "Special Handling" }
];

export function labelForAccountType(value: OrganizationAccountType) {
  return ACCOUNT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForActiveStatus(value: DirectoryActiveStatus) {
  return value === "active" ? "Active" : "Archived";
}

export function labelForRelationshipRole(value?: DirectoryContactRelationshipRole | null) {
  if (!value) {
    return "General";
  }
  return RELATIONSHIP_ROLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForContactStatus(value?: DirectoryContactStatus | null) {
  if (!value) {
    return "Active";
  }
  return CONTACT_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForRoleCategory(value?: DirectoryContactRoleCategory | null) {
  if (!value) {
    return "Other";
  }
  return CONTACT_ROLE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForOperationalImportance(value?: DirectoryOperationalImportance | null) {
  if (!value) {
    return "Normal";
  }
  return OPERATIONAL_IMPORTANCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForDecisionInfluence(value?: DirectoryDecisionInfluence | null) {
  if (!value) {
    return "Informational Only";
  }
  return DECISION_INFLUENCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForRelationshipStrength(value?: DirectoryRelationshipStrength | null) {
  if (!value) {
    return "Unknown / No Active Relationship";
  }
  return RELATIONSHIP_STRENGTH_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForOwnershipState(value?: DirectoryRelationshipOwnershipState | null) {
  if (!value) {
    return "Owned";
  }
  return OWNERSHIP_STATE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForFreshnessState(value?: DirectoryFreshnessState | null) {
  switch (value) {
    case "fresh":
      return "Fresh";
    case "aging":
      return "Aging";
    case "needs_review":
      return "Needs Review";
    default:
      return "Needs Review";
  }
}

export function labelForSchoolRelationshipHealth(value?: SchoolRelationshipHealthState | null) {
  if (!value) {
    return "Unknown";
  }
  return SCHOOL_RELATIONSHIP_HEALTH_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForSchoolContactCategory(value?: SchoolContactCategory | null) {
  if (!value) {
    return "Other";
  }
  return SCHOOL_CONTACT_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForSchoolRuleType(value?: SchoolRuleType | null) {
  if (!value) {
    return "School Rule";
  }
  return SCHOOL_RULE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForTouchpointChannel(value: DirectoryTouchpointChannel) {
  return TOUCHPOINT_CHANNEL_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForTouchpointCategory(value?: DirectoryTouchpointCategory | null) {
  if (!value) {
    return "General";
  }
  return TOUCHPOINT_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForCommunicationOutcome(value?: DirectoryCommunicationOutcome | null) {
  if (!value) {
    return "No outcome logged";
  }
  return COMMUNICATION_OUTCOME_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForTouchpointPlanStatus(value: DirectoryTouchpointPlanStatus) {
  switch (value) {
    case "due_soon":
      return "Due Soon";
    case "overdue":
      return "Overdue";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
  }
}

export function labelForRelationshipMemoryType(value: DirectoryRelationshipMemoryType) {
  return RELATIONSHIP_MEMORY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForRelationshipMemoryVisibility(value: DirectoryRelationshipMemoryVisibility) {
  return RELATIONSHIP_MEMORY_VISIBILITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForRelationshipMemoryStatus(value: DirectoryRelationshipMemoryStatus) {
  switch (value) {
    case "needs_review":
      return "Needs Review";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
  }
}

export function labelForRelationshipFollowUpStatus(value: DirectoryRelationshipFollowUpStatus) {
  switch (value) {
    case "in_progress":
      return "In Progress";
    case "overdue":
      return "Overdue";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
  }
}

export function labelForRelationshipHealthState(value: DirectoryRelationshipHealthState) {
  switch (value) {
    case "needs_attention":
      return "Needs Attention";
    case "at_risk":
      return "At Risk";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
  }
}

export function labelForDuplicateDecision(value: DirectoryDuplicateReviewDecision) {
  return DUPLICATE_REVIEW_DECISION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function formatDateLabel(value?: string | null) {
  if (!value) {
    return "Not scheduled";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function formatDateTimeLabel(value?: string | null) {
  if (!value) {
    return "Not logged";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function buildLocationAddress(location: Pick<OrganizationLocation, "address_display" | "address_line_1" | "city" | "state" | "zip">) {
  if (location.address_display?.trim()) {
    return location.address_display;
  }
  return [location.address_line_1, location.city, location.state, location.zip].filter(Boolean).join(", ") || "Address not set";
}

export function summarizeText(value?: string | null, fallback = "No note saved yet.") {
  const text = value?.trim();
  if (!text) {
    return fallback;
  }
  if (text.length <= 140) {
    return text;
  }
  return `${text.slice(0, 137).trimEnd()}...`;
}

export function buildShootLabel(shoot: OrganizationRecentShoot | OrganizationUpcomingShoot) {
  return `${shoot.title} - ${formatDateLabel(shoot.shoot_date)}${shoot.location_name ? ` - ${shoot.location_name}` : ""}`;
}
