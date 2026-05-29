import type { PoolClient } from "pg";
import type {
  ChecklistAssignmentRoleKey,
  ChecklistBlockingLevel,
  ChecklistConditionEffect,
  ChecklistConditionLogic,
  ChecklistInstanceStatus,
  ChecklistItemType,
  ChecklistReminderType,
  JobDepartmentType,
  WorkflowBlockResourceType
} from "../../domain/jobTruth/index.js";
import type { ChecklistAssignmentDefaults } from "../../types/checklists.js";
import type { AuthUser } from "../../types/auth.js";
import type { ChecklistTemplateVersionInput } from "./checklistService.js";
import { publishChecklistTemplateVersion, saveChecklistTemplateDraft } from "./checklistService.js";

type SeedReminderRuleDefinition = {
  reminder_type: ChecklistReminderType;
  offset_minutes: number;
  delivery_channel?: "in_app" | "email";
  escalation_role?: string | null;
};

type SeedWorkflowBlockRuleDefinition = {
  name: string;
  resourceType: WorkflowBlockResourceType;
  fromStage?: string | null;
  toStage: string;
  requiredTemplateCode: string;
  requiredInstanceStatus?: ChecklistInstanceStatus;
  approvalRequired?: boolean;
  blockingLevel?: ChecklistBlockingLevel;
  allowOverride?: boolean;
  departmentType?: JobDepartmentType | null;
};

type SeedChecklistTemplateDefinition = {
  key: string;
  template: ChecklistTemplateVersionInput;
  reminderRules?: SeedReminderRuleDefinition[];
};

type ChecklistSeedResult = {
  templateIdsByCode: Record<string, string>;
  publishedVersionIdsByCode: Record<string, string>;
  template_count: number;
  version_count: number;
  workflow_rule_count: number;
  reminder_rule_count: number;
};

type ChecklistConditionDefinition = NonNullable<
  ChecklistTemplateVersionInput["sections"][number]["items"][number]["conditions"]
>[number];

type ChecklistItemDefinition = ChecklistTemplateVersionInput["sections"][number]["items"][number];
type ChecklistSectionDefinition = ChecklistTemplateVersionInput["sections"][number];

function option(label: string, value: string) {
  return { label, value };
}

function dueRule(
  anchorKey:
    | "triggered_at"
    | "job_scheduled_start_at"
    | "job_scheduled_end_at"
    | "shoot_showtime"
    | "shoot_start_at"
    | "shoot_end_at"
    | "production_due_at"
    | "production_release_due_at"
    | "production_delivery_deadline_at",
  offsets: {
    offset_minutes?: number;
    offset_hours?: number;
    offset_days?: number;
  }
) {
  return {
    anchor_key: anchorKey,
    ...offsets
  };
}

function assignmentDefaults(
  owner: ChecklistAssignmentRoleKey | null | undefined,
  reviewer?: ChecklistAssignmentRoleKey | null,
  approver?: ChecklistAssignmentRoleKey | null
): ChecklistAssignmentDefaults {
  return {
    owner_assignment_role: owner ?? null,
    reviewer_assignment_role: reviewer ?? null,
    approver_assignment_role: approver ?? null
  };
}

function condition(
  sourceItemKey: string,
  effect: ChecklistConditionEffect,
  expectedValueJson: unknown,
  options: {
    comparison_operator?: string;
    logic_operator?: ChecklistConditionLogic;
    condition_group_key?: string;
  } = {}
): ChecklistConditionDefinition {
  return {
    source_item_key: sourceItemKey,
    effect,
    expected_value_json: expectedValueJson,
    comparison_operator: options.comparison_operator ?? "equals",
    logic_operator: options.logic_operator ?? "AND",
    condition_group_key: options.condition_group_key ?? "default"
  };
}

function showAndRequireWhen(
  sourceItemKey: string,
  expectedValueJson: unknown,
  options: {
    comparison_operator?: string;
    condition_group_key?: string;
  } = {}
): ChecklistConditionDefinition[] {
  return [
    condition(sourceItemKey, "show", expectedValueJson, options),
    condition(sourceItemKey, "require", expectedValueJson, options)
  ];
}

function buildItem(
  itemType: ChecklistItemType,
  itemKey: string,
  label: string,
  options: Partial<ChecklistItemDefinition> = {}
): ChecklistItemDefinition {
  return {
    item_key: itemKey,
    label,
    item_type: itemType,
    help_text: options.help_text ?? null,
    required: options.required ?? false,
    proof_required: options.proof_required ?? false,
    validation_json: options.validation_json ?? {},
    options_json: options.options_json ?? [],
    conditions: options.conditions ?? [],
    sort_order: options.sort_order
  };
}

function checkboxItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("checkbox", itemKey, label, { required: true, ...options });
}

function yesNoItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("yes_no", itemKey, label, { required: true, ...options });
}

function textItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("text", itemKey, label, options);
}

function textareaItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("textarea", itemKey, label, options);
}

function numberItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("number", itemKey, label, options);
}

function selectItem(itemKey: string, label: string, optionsJson: unknown[], options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("select", itemKey, label, { options_json: optionsJson, ...options });
}

function multiSelectItem(itemKey: string, label: string, optionsJson: unknown[], options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("multi_select", itemKey, label, { options_json: optionsJson, ...options });
}

function photoUploadItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("photo_upload", itemKey, label, {
    required: true,
    proof_required: true,
    ...options
  });
}

function fileUploadItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("file_upload", itemKey, label, {
    required: true,
    proof_required: true,
    ...options
  });
}

function userPickerItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("user_picker", itemKey, label, options);
}

function signatureItem(itemKey: string, label: string, options: Partial<ChecklistItemDefinition> = {}) {
  return buildItem("signature", itemKey, label, options);
}

function section(
  sectionKey: string,
  title: string,
  description: string,
  items: ChecklistItemDefinition[]
): ChecklistSectionDefinition {
  return {
    section_key: sectionKey,
    title,
    description,
    items
  };
}

function sharedChecklistReminders(options: {
  beforeDueMinutes?: number;
  atDueMinutes?: number;
  overdueMinutes?: number;
  escalationMinutes?: number;
  escalationRole?: string | null;
}) {
  const rules: SeedReminderRuleDefinition[] = [];
  if (Number.isFinite(options.beforeDueMinutes)) {
    rules.push({ reminder_type: "before_due", offset_minutes: Number(options.beforeDueMinutes), delivery_channel: "in_app" });
  }
  if (Number.isFinite(options.atDueMinutes)) {
    rules.push({ reminder_type: "at_due", offset_minutes: Number(options.atDueMinutes), delivery_channel: "in_app" });
  }
  if (Number.isFinite(options.overdueMinutes)) {
    rules.push({ reminder_type: "overdue", offset_minutes: Number(options.overdueMinutes), delivery_channel: "email" });
  }
  if (Number.isFinite(options.escalationMinutes) && options.escalationRole) {
    rules.push({
      reminder_type: "escalation",
      offset_minutes: Number(options.escalationMinutes),
      delivery_channel: "email",
      escalation_role: options.escalationRole
    });
  }
  return rules;
}

const DEFAULT_WORKFLOW_BLOCK_RULE_DEFINITIONS: SeedWorkflowBlockRuleDefinition[] = [
  {
    name: "Shoot Readiness required before Ready",
    resourceType: "shoot",
    fromStage: "CONFIRMED",
    toStage: "READY",
    requiredTemplateCode: "shoot_readiness",
    requiredInstanceStatus: "submitted",
    blockingLevel: "hard_block"
  },
  {
    name: "Pre-Service Meeting required before Live",
    resourceType: "shoot",
    fromStage: "READY",
    toStage: "LIVE",
    requiredTemplateCode: "pre_service_meeting",
    requiredInstanceStatus: "submitted",
    blockingLevel: "hard_block"
  },
  {
    name: "End-of-Shoot Wrap required before Shoot Complete",
    resourceType: "shoot",
    fromStage: "LIVE",
    toStage: "SHOOT_COMPLETE",
    requiredTemplateCode: "end_of_shoot_wrap",
    requiredInstanceStatus: "submitted",
    blockingLevel: "hard_block"
  },
  {
    name: "Production Intake required before Editing",
    resourceType: "production_item",
    toStage: "IN_PRODUCTION",
    requiredTemplateCode: "production_intake_file_receipt",
    requiredInstanceStatus: "submitted",
    blockingLevel: "hard_block"
  },
  {
    name: "Artist Self-QA required before QA",
    resourceType: "production_item",
    toStage: "READY_FOR_QA",
    requiredTemplateCode: "artist_self_qa",
    requiredInstanceStatus: "submitted",
    blockingLevel: "hard_block"
  },
  {
    name: "Peer Review required before Upload",
    resourceType: "production_item",
    toStage: "READY_FOR_UPLOAD",
    requiredTemplateCode: "peer_review_sign_off",
    requiredInstanceStatus: "approved",
    approvalRequired: true,
    blockingLevel: "hard_block"
  },
  {
    name: "Captura Upload QA required before Ready for Release",
    resourceType: "production_item",
    toStage: "READY_FOR_RELEASE",
    requiredTemplateCode: "captura_upload_qa",
    requiredInstanceStatus: "submitted",
    blockingLevel: "hard_block"
  },
  {
    name: "Final Release Checklist required before Released",
    resourceType: "production_item",
    toStage: "RELEASED",
    requiredTemplateCode: "final_release_checklist",
    requiredInstanceStatus: "approved",
    approvalRequired: true,
    blockingLevel: "hard_block"
  }
];

const DEFAULT_CHECKLIST_TEMPLATE_DEFINITIONS: SeedChecklistTemplateDefinition[] = [
  {
    key: "shoot_readiness",
    template: {
      name: "Shoot Readiness",
      code: "shoot_readiness",
      description:
        "Operational readiness gate before a shoot can move into Ready. Confirms schedule, access, staffing, data, and sorting logic are truly prepared.",
      department_type: null,
      scope_type: "shoot",
      trigger_type: "shoot_status_transition",
      due_rule_json: dueRule("shoot_showtime", { offset_hours: -24 }),
      approval_required: false,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("readiness_owner", "department_manager", null),
      summary: "Confirm the date, access, staffing, roster/data packet, and department-specific sorting logic before the team is marked ready.",
      sections: [
        section("schedule_access", "Schedule and Access", "Lock the logistics before the crew is told the shoot is ready.", [
          checkboxItem("schedule_access_confirmed", "Client-approved schedule, arrival window, and access instructions are confirmed.", {
            help_text: "Use this only after the current day-of timeline and access plan match the customer-facing plan."
          }),
          yesNoItem("special_access_constraints", "Does this shoot have special access, parking, or security constraints?", {
            help_text: "Examples: locked doors, badge escort, elevator window, shared staging area, or restricted parking."
          }),
          textareaItem("special_access_details", "Describe the special access constraints and the mitigation plan.", {
            help_text: "Include who owns the workaround and where the crew will find the final instructions.",
            conditions: showAndRequireWhen("special_access_constraints", true),
            validation_json: { min_length: 20 }
          }),
          fileUploadItem("logistics_packet_proof", "Upload the current logistics packet, confirmation email, or site instructions.", {
            help_text: "Attach the document the crew should rely on if questions come up on site."
          })
        ]),
        section("staffing_and_data", "Staffing and Data", "Make sure the crew and the data that drives sorting are both actually usable.", [
          checkboxItem("lead_and_staff_confirmed", "Lead assignment and minimum staffing coverage are confirmed."),
          checkboxItem("roster_or_data_present", "Required roster, lookup data, or subject list is present and usable.", {
            help_text: "If the job does not require roster data, use the notes below to document why."
          }),
          selectItem(
            "sorting_logic_type",
            "Which downstream sorting logic applies to this shoot?",
            [
              option("Standard single-gallery flow", "standard"),
              option("Grade / advisor / homeroom sorting", "grade_advisor_homeroom"),
              option("Team / roster sorting", "team_roster"),
              option("Custom or hybrid grouping", "custom")
            ],
            {
              required: true,
              help_text: "Pick the logic production should expect after handoff."
            }
          ),
          textareaItem("sorting_logic_notes", "Capture the sorting or roster logic production must follow.", {
            help_text: "Include grade/advisor mappings, homeroom rules, roster cut points, or custom naming notes.",
            conditions: [
              condition("sorting_logic_type", "show", "standard", { comparison_operator: "not_equals", condition_group_key: "non_standard" }),
              condition("sorting_logic_type", "require", "standard", { comparison_operator: "not_equals", condition_group_key: "non_standard" })
            ],
            validation_json: { min_length: 12 }
          })
        ]),
        section("client_alignment", "Client Alignment", "Catch any remaining risk before the team is marked ready.", [
          yesNoItem("client_risk_flagged", "Is there any known client-facing or operational risk that day-of staff should know about?"),
          textareaItem("client_risk_notes", "Describe the risk, the workaround, and who owns communication.", {
            conditions: showAndRequireWhen("client_risk_flagged", true),
            validation_json: { min_length: 20 }
          })
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 360,
      overdueMinutes: 0,
      escalationMinutes: 180,
      escalationRole: "department_manager"
    })
  },
  {
    key: "pre_service_meeting",
    template: {
      name: "Pre-Service Meeting",
      code: "pre_service_meeting",
      description:
        "Crew alignment checklist completed immediately before the team goes live. Captures roll call, service priorities, safety, and final setup proof.",
      department_type: null,
      scope_type: "shoot",
      trigger_type: "shoot_status_transition",
      due_rule_json: dueRule("shoot_showtime", { offset_minutes: -45 }),
      approval_required: false,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("context_owner", "department_manager", null),
      summary: "Confirm the crew brief happened, the service plan is understood, and the live setup matches the plan before the shoot starts.",
      sections: [
        section("crew_roll_call", "Crew Roll Call", "Verify the people on site are the people expected to execute the shoot.", [
          checkboxItem("crew_roll_call_complete", "Crew roll call is complete and all critical positions are covered."),
          yesNoItem("coverage_gap_flagged", "Is any key role or support coverage missing right now?"),
          textareaItem("coverage_gap_plan", "Document the coverage gap, the temporary plan, and the owner of the follow-up.", {
            conditions: showAndRequireWhen("coverage_gap_flagged", true),
            validation_json: { min_length: 20 }
          })
        ]),
        section("service_plan", "Service Plan", "Make sure the lead brief covered how the day should actually run.", [
          checkboxItem("briefing_complete", "The lead reviewed the service plan, pacing, and escalation path with the crew."),
          checkboxItem("safety_access_reviewed", "Safety, access, and setup constraints were reviewed with the crew."),
          checkboxItem("handoff_expectations_reviewed", "File handoff, naming, and post-shoot wrap expectations were reviewed.")
        ]),
        section("proof", "Meeting Proof", "Leave behind lightweight evidence that the crew started from the same plan.", [
          photoUploadItem("meeting_photo", "Upload a crew meeting, first setup, or station-ready photo.", {
            help_text: "One clear image is enough if it shows the crew or the live-ready station."
          })
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 60,
      atDueMinutes: 0,
      escalationMinutes: 60,
      escalationRole: "department_manager"
    })
  },
  {
    key: "on_site_setup_verification",
    template: {
      name: "On-Site Setup Verification",
      code: "on_site_setup_verification",
      description:
        "Fast on-site verification checklist used once the team is live to confirm setup, signage, test images, and traffic flow still match the plan.",
      department_type: null,
      scope_type: "shoot",
      trigger_type: "shoot_status_transition",
      due_rule_json: dueRule("shoot_start_at", { offset_minutes: 15 }),
      approval_required: false,
      blocking_level: "soft_block",
      assignment_defaults_json: assignmentDefaults("context_owner", "department_manager", null),
      summary: "Capture proof that stations, signage, and first-subject flow are actually working once the team is on site.",
      sections: [
        section("station_readiness", "Station Readiness", "Check what the first subjects will actually experience.", [
          checkboxItem("camera_station_ready", "Camera stations are powered, tested, and ready for subjects."),
          checkboxItem("signage_and_flow_ready", "Signage, queue flow, and category placement are set up as planned."),
          checkboxItem("first_subject_test_complete", "A first-subject or first-record test confirmed the intended workflow.")
        ]),
        section("onsite_exceptions", "On-Site Exceptions", "Catch issues early instead of waiting for end-of-shoot notes.", [
          yesNoItem("setup_issue_found", "Did the team find an on-site setup issue that affects service quality or throughput?"),
          textareaItem("setup_issue_notes", "Describe the issue, impact, and what the team changed on site.", {
            conditions: showAndRequireWhen("setup_issue_found", true),
            validation_json: { min_length: 20 }
          })
        ]),
        section("proof", "Setup Proof", "Make the setup easy to verify later without adding much friction.", [
          photoUploadItem("setup_proof", "Upload a station, signage, or first-subject proof photo.", {
            help_text: "Pick the single image that best shows the setup the crew is actually using."
          })
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 15,
      overdueMinutes: 0,
      escalationMinutes: 45,
      escalationRole: "department_manager"
    })
  },
  {
    key: "end_of_shoot_wrap",
    template: {
      name: "End-of-Shoot Wrap",
      code: "end_of_shoot_wrap",
      description:
        "Required wrap checklist before the shoot can be marked complete. Captures counts, handoff, client exceptions, and post-shoot evaluation.",
      department_type: null,
      scope_type: "shoot",
      trigger_type: "shoot_complete",
      due_rule_json: dueRule("shoot_end_at", { offset_minutes: 30 }),
      approval_required: false,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("context_owner", "department_manager", null),
      summary: "Record expected versus actual capture counts, file handoff status, client issues, and the post-shoot evaluation before closing the shoot.",
      sections: [
        section("counts_and_handoff", "Counts and Handoff", "The handoff record should stand on its own for production.", [
          numberItem("expected_file_count", "Expected file count or expected capture volume.", {
            required: true,
            validation_json: { minimum: 1, integer: true }
          }),
          numberItem("actual_file_count", "Actual file count or actual capture volume handed off.", {
            required: true,
            validation_json: { minimum: 0, integer: true }
          }),
          yesNoItem("handoff_complete", "Is the file handoff complete and accessible to production right now?"),
          textareaItem("handoff_gap_reason", "Explain what is missing from handoff, when it will land, and who owns it.", {
            conditions: showAndRequireWhen("handoff_complete", false),
            validation_json: { min_length: 20 }
          }),
          fileUploadItem("handoff_packet_proof", "Upload the handoff proof, transfer receipt, or manifest.", {
            help_text: "This should be the fastest artifact production can trust if counts are questioned later."
          })
        ]),
        section("client_and_field_notes", "Client and Field Notes", "Capture issues while they are still fresh.", [
          yesNoItem("client_issue_flagged", "Did any client-facing issue, service miss, or exception occur on site?"),
          textareaItem("client_issue_notes", "Summarize the issue, client impact, and what follow-up is required.", {
            conditions: showAndRequireWhen("client_issue_flagged", true),
            validation_json: { min_length: 20 }
          }),
          textareaItem("post_shoot_eval", "Post-shoot evaluation summary and recommendations for the next time.", {
            required: true,
            validation_json: { min_length: 30 }
          })
        ]),
        section("wrap_proof_section", "Wrap Proof", "Leave behind lightweight evidence of the final wrap state.", [
          photoUploadItem("wrap_proof", "Upload a wrap photo of the final station state, packed media, or file-transfer screen.")
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 15,
      overdueMinutes: 0,
      escalationMinutes: 120,
      escalationRole: "department_manager"
    })
  },
  {
    key: "production_intake_file_receipt",
    template: {
      name: "Production Intake / File Receipt",
      code: "production_intake_file_receipt",
      description:
        "Structural intake gate before editing begins. Confirms files, naming, storage, roster/data, and specialty output expectations are understood.",
      department_type: null,
      scope_type: "production_item",
      trigger_type: "production_status_transition",
      due_rule_json: dueRule("triggered_at", { offset_hours: 2 }),
      approval_required: false,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("production_owner", "production_manager", null),
      summary: "Confirm counts, structure, naming, source storage, roster/data integrity, and specialty output requirements before production starts work.",
      sections: [
        section("core_intake", "Core Intake QC", "Structural checks that must be true before production editing starts.", [
          checkboxItem("expected_files_present", "Expected files are present for this production item."),
          checkboxItem("folder_structure_correct", "Folder structure is correct for downstream processing."),
          checkboxItem("naming_correct", "Naming is correct, consistent, and matches the expected conventions."),
          checkboxItem("source_files_correct_place", "Source files are stored in the correct source location."),
          checkboxItem("roster_or_data_present", "Required roster, lookup data, or job metadata is present.")
        ]),
        section("mismatch_and_exceptions", "Mismatches and Exceptions", "Call out what needs a manual follow-up right away.", [
          numberItem("expected_file_count", "Expected file count from the field or intake manifest.", {
            required: true,
            validation_json: { minimum: 1, integer: true }
          }),
          numberItem("actual_file_count", "Actual file count received in intake.", {
            required: true,
            validation_json: { minimum: 0, integer: true }
          }),
          yesNoItem("file_count_match", "Do the expected and actual file counts match?"),
          textareaItem("file_count_mismatch_reason", "Explain the file mismatch, known missing groups, and next action.", {
            conditions: showAndRequireWhen("file_count_match", false),
            validation_json: { min_length: 20 }
          }),
          multiSelectItem(
            "deliverable_paths_confirmed",
            "Which downstream outputs or release paths are expected from this intake?",
            [
              option("Gallery / online proofing", "gallery"),
              option("Yearbook / adviser export", "yearbook_export"),
              option("ID package", "id_package"),
              option("Banner / specialty design", "banners_specialty"),
              option("Vendor print batch", "vendor_print_batch")
            ],
            {
              required: true,
              help_text: "Pick every deliverable path that production should keep in view from intake onward."
            }
          )
        ]),
        section("proof", "Receipt Proof", "Capture one durable proof that intake happened against the right source.", [
          fileUploadItem("intake_proof", "Upload the intake receipt, transfer proof, or source index screenshot.")
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 60,
      overdueMinutes: 0,
      escalationMinutes: 120,
      escalationRole: "production_manager"
    })
  },
  {
    key: "artist_self_qa",
    template: {
      name: "Artist Self-QA",
      code: "artist_self_qa",
      description:
        "Creator-side QA gate before peer review. Requires a documented sample size, creator confirmation, and issue notes when the work is not ready.",
      department_type: null,
      scope_type: "production_item",
      trigger_type: "production_status_transition",
      due_rule_json: dueRule("production_due_at", { offset_hours: -8 }),
      approval_required: false,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("production_owner", "peer_reviewer", null),
      summary: "The creator documents a minimum sample review, verifies core quality questions, and confirms the work is ready for peer review.",
      sections: [
        section("creator_sample", "Creator Sample Review", "The creator should leave behind enough context for the reviewer to trust what was checked.", [
          numberItem("sample_percent", "Percentage of the work visually reviewed by the creator.", {
            required: true,
            validation_json: { minimum: 30, maximum: 100, integer: true },
            help_text: "Large jobs require at least a 30 percent sample."
          }),
          photoUploadItem("sample_proof", "Upload a sample proof image or annotated screenshot from creator review.", {
            help_text: "One clear sample is enough if it represents the reviewed work."
          })
        ]),
        section("creator_questions", "Required Creator QA Questions", "These are the baseline questions the creator must answer before asking for peer review.", [
          yesNoItem("files_complete_and_stored_correctly", "Are files complete, correctly named, and stored correctly?"),
          yesNoItem("color_density_brightness_consistent", "Do color, density, and brightness look correct and consistent?"),
          yesNoItem("sorting_and_roster_links_correct", "Are sorting, category placement, and roster links correct?"),
          yesNoItem("templates_and_release_settings_correct", "Are templates, price sheets, vendor outputs, and release settings correct?"),
          selectItem(
            "creator_ready_decision",
            "Approve this item for peer review or mark it as not ready yet.",
            [option("Ready for peer review", "ready"), option("Needs more work", "needs_more_work")],
            { required: true }
          ),
          textareaItem("creator_ready_notes", "Document any caveats, known issues, or why the item is not ready yet.", {
            conditions: showAndRequireWhen("creator_ready_decision", "needs_more_work"),
            validation_json: { min_length: 20 }
          })
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 240,
      overdueMinutes: 0,
      escalationMinutes: 240,
      escalationRole: "production_manager"
    })
  },
  {
    key: "peer_review_sign_off",
    template: {
      name: "Peer Review Sign-Off",
      code: "peer_review_sign_off",
      description:
        "Independent peer review gate before upload work can continue. Records the reviewer sample, structural verification, and send-back reason when the item fails.",
      department_type: null,
      scope_type: "production_item",
      trigger_type: "production_status_transition",
      due_rule_json: dueRule("production_due_at", { offset_hours: -4 }),
      approval_required: true,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("production_owner", "peer_reviewer", "peer_reviewer"),
      summary: "Peer review carries operational weight: the reviewer must check the required questions, attach proof, and either approve the item or send it back with a reason and issue category.",
      sections: [
        section("review_sample", "Peer Review Sample", "Capture the sample size and evidence of what the reviewer actually checked.", [
          numberItem("visual_sample_percent", "Percentage of the work visually reviewed by the peer reviewer.", {
            required: true,
            validation_json: { minimum: 10, maximum: 100, integer: true },
            help_text: "Peer review requires at least a 10 percent visual sample."
          }),
          checkboxItem("structural_verification", "Structural verification of key operational items is complete."),
          photoUploadItem("peer_review_sample_proof", "Upload a peer review sample or annotated proof.")
        ]),
        section("review_questions", "Required Peer Review Questions", "Every question below must be answered before the reviewer can decide.", [
          yesNoItem("review_files_complete", "Are files complete, correctly named, and stored correctly?"),
          yesNoItem("review_color_consistency", "Do color, density, and brightness look correct and consistent?"),
          yesNoItem("review_sorting_and_roster", "Are sorting, category placement, and roster links correct?"),
          yesNoItem("review_templates_and_release", "Are templates, price sheets, vendor outputs, and release settings correct?"),
          selectItem(
            "peer_decision",
            "Approve for the next stage or send back for rework.",
            [option("Approve for next stage", "approve"), option("Send back for rework", "send_back")],
            { required: true }
          ),
          selectItem(
            "issue_category",
            "If this item is sent back, what category best describes the issue?",
            [
              option("Color / density / brightness", "color"),
              option("Sorting / roster / category placement", "sorting"),
              option("Template / price sheet / release settings", "template_release"),
              option("File completeness / structure / naming", "file_structure"),
              option("Specialty or vendor output", "specialty_vendor"),
              option("Other", "other")
            ],
            {
              required: false,
              conditions: showAndRequireWhen("peer_decision", "send_back")
            }
          ),
          textareaItem("send_back_reason", "Enter the send-back reason and what must change before the next review.", {
            conditions: showAndRequireWhen("peer_decision", "send_back"),
            validation_json: { min_length: 20 }
          })
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 180,
      overdueMinutes: 0,
      escalationMinutes: 180,
      escalationRole: "production_manager"
    })
  },
  {
    key: "captura_upload_qa",
    template: {
      name: "Captura Upload QA",
      code: "captura_upload_qa",
      description:
        "Post-upload QA gate used before the item can move into release-ready status. Focuses on placement, sorting, release settings, and category logic in the live upload context.",
      department_type: null,
      scope_type: "production_item",
      trigger_type: "upload_verified",
      due_rule_json: dueRule("production_release_due_at", { offset_hours: -2 }),
      approval_required: false,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("production_owner", "release_reviewer", null),
      summary: "Verify the uploaded experience before release: placement, sorting, templates, pricing, category logic, and release settings must all check out.",
      sections: [
        section("upload_sample", "Upload Spot Check", "The reviewer should leave enough proof to trust the upload QA pass.", [
          numberItem("upload_sample_percent", "Percentage of the uploaded work spot-checked after upload.", {
            required: true,
            validation_json: { minimum: 5, maximum: 100, integer: true },
            help_text: "Final upload QA requires at least a five percent spot check."
          }),
          photoUploadItem("upload_proof", "Upload a screenshot or proof of the verified live upload.")
        ]),
        section("upload_questions", "Required Upload QA Questions", "These checks focus on the live release surface, not just the source files.", [
          yesNoItem("placement_verified", "Are placement, sorting, and gallery or category ordering correct?"),
          yesNoItem("gallery_logic_verified", "Are category logic, roster links, and grouping rules correct?"),
          yesNoItem("template_and_price_sheet_verified", "Are templates, price sheets, and specialty output settings correct?"),
          yesNoItem("release_settings_verified", "Are release settings and customer-facing permissions correct?"),
          yesNoItem("vendor_output_verified", "Are any vendor or specialty outputs staged correctly for the next step?")
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 120,
      overdueMinutes: 0,
      escalationMinutes: 120,
      escalationRole: "production_manager"
    })
  },
  {
    key: "final_release_checklist",
    template: {
      name: "Final Release Checklist",
      code: "final_release_checklist",
      description:
        "Final gated release checklist used before an item is released. Documents final reviewer sign-off, release proof, and specialty or vendor readiness.",
      department_type: null,
      scope_type: "production_item",
      trigger_type: "release_review",
      due_rule_json: dueRule("production_release_due_at", { offset_minutes: -30 }),
      approval_required: true,
      blocking_level: "hard_block",
      assignment_defaults_json: assignmentDefaults("production_owner", "release_reviewer", "release_reviewer"),
      summary: "Final release requires one last controlled pass across templates, pricing, outputs, and release settings before the item is marked released.",
      sections: [
        section("release_surface", "Release Surface", "Check the exact customer-facing or vendor-facing release configuration.", [
          yesNoItem("release_placement_sorting_correct", "Are placement, sorting, gallery category logic, and subject grouping correct on the release surface?"),
          yesNoItem("release_templates_and_pricing_correct", "Are templates, price sheets, and release settings correct for this release?"),
          yesNoItem("release_vendor_outputs_correct", "Are vendor outputs, specialty exports, and print files correct and ready?")
        ]),
        section("release_proof", "Final Release Proof", "Capture proof that the release-ready surface was actually reviewed.", [
          photoUploadItem("release_surface_proof", "Upload a final release screenshot or proof artifact."),
          signatureItem("release_reviewer_signature", "Release reviewer signature and sign-off.", {
            required: true,
            help_text: "Use the name or signature format your team treats as the final release acknowledgement."
          })
        ]),
        section("release_exceptions", "Release Exceptions", "If anything was overridden, leave the context in the checklist.", [
          yesNoItem("release_exception_flagged", "Was any release exception or managed risk accepted for this item?"),
          textareaItem("release_exception_notes", "Document the accepted exception, approval context, and follow-up owner.", {
            conditions: showAndRequireWhen("release_exception_flagged", true),
            validation_json: { min_length: 20 }
          })
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 60,
      overdueMinutes: 0,
      escalationMinutes: 60,
      escalationRole: "production_manager"
    })
  },
  {
    key: "incident_escalation_report",
    template: {
      name: "Incident / Escalation Report",
      code: "incident_escalation_report",
      description:
        "Structured incident report used when a field or production issue needs formal documentation, follow-up ownership, and manager sign-off.",
      department_type: null,
      scope_type: "shoot",
      trigger_type: "manual",
      due_rule_json: dueRule("triggered_at", { offset_hours: 1 }),
      approval_required: true,
      blocking_level: "soft_block",
      assignment_defaults_json: assignmentDefaults("context_owner", "department_manager", "department_manager"),
      summary: "Document the issue, impact, immediate containment, customer communication, and follow-up owner whenever a shoot or escalation event needs a durable record.",
      sections: [
        section("incident_core", "Incident Core", "Capture what happened clearly enough that follow-up can happen without another interview.", [
          selectItem(
            "incident_type",
            "What type of incident or escalation is this?",
            [
              option("Client or service issue", "client_service"),
              option("Staffing or coverage issue", "staffing"),
              option("Equipment or file issue", "equipment_files"),
              option("Safety or access issue", "safety_access"),
              option("Production or release issue", "production_release"),
              option("Other", "other")
            ],
            { required: true }
          ),
          selectItem(
            "impact_level",
            "How severe was the impact?",
            [
              option("Low", "low"),
              option("Medium", "medium"),
              option("High", "high"),
              option("Critical", "critical")
            ],
            { required: true }
          ),
          textareaItem("incident_summary", "What happened, when did it happen, and what was affected?", {
            required: true,
            validation_json: { min_length: 30 }
          })
        ]),
        section("containment_and_comms", "Containment and Communication", "Make it clear what changed in the moment and who still needs a follow-up.", [
          yesNoItem("client_notified", "Was the client or external contact notified during the incident window?"),
          textareaItem("client_notification_notes", "Capture what was communicated and any promised follow-up.", {
            conditions: showAndRequireWhen("client_notified", true),
            validation_json: { min_length: 20 }
          }),
          textareaItem("containment_plan", "What immediate containment action was taken, and what still remains?", {
            required: true,
            validation_json: { min_length: 20 }
          }),
          userPickerItem("follow_up_owner", "Who owns the next follow-up action?", {
            required: true
          }),
          textItem("follow_up_eta", "Expected follow-up ETA or next review checkpoint.", {
            required: true
          })
        ]),
        section("proof_and_signoff", "Proof and Sign-Off", "Attach the artifact that best explains the incident.", [
          fileUploadItem("incident_proof", "Upload the supporting proof, screenshot, or report attachment.", {
            help_text: "If the incident is verbal only, attach the written summary sent to the team."
          })
        ])
      ]
    },
    reminderRules: sharedChecklistReminders({
      beforeDueMinutes: 30,
      overdueMinutes: 0,
      escalationMinutes: 60,
      escalationRole: "department_manager"
    })
  }
];

function buildWorkflowRuleKey(resourceType: WorkflowBlockResourceType, templateCode: string, toStage: string) {
  return `${resourceType}:${templateCode}:${toStage}`;
}

async function upsertWorkflowBlockRule(
  client: PoolClient,
  tenantId: string,
  input: SeedWorkflowBlockRuleDefinition
) {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text AS id
      FROM workflow_block_rules
      WHERE tenant_id = $1
        AND resource_type = $2::workflow_block_resource_type
        AND coalesce(from_stage, '') = coalesce($3, '')
        AND to_stage = $4
        AND required_template_code = $5
      LIMIT 1
    `,
    [tenantId, input.resourceType, input.fromStage ?? null, input.toStage, input.requiredTemplateCode]
  );

  if (existing.rows[0]?.id) {
    await client.query(
      `
        UPDATE workflow_block_rules
        SET name = $3,
            department_type = $4::job_department_type,
            required_instance_status = $5::checklist_instance_status_type,
            approval_required = $6,
            blocking_level = $7::checklist_blocking_level_type,
            allow_override = $8,
            active_status = true,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        tenantId,
        existing.rows[0].id,
        input.name,
        input.departmentType ?? null,
        input.requiredInstanceStatus ?? "submitted",
        input.approvalRequired ?? false,
        input.blockingLevel ?? "hard_block",
        input.allowOverride ?? false
      ]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO workflow_block_rules (
        tenant_id,
        name,
        department_type,
        resource_type,
        from_stage,
        to_stage,
        required_template_code,
        required_instance_status,
        approval_required,
        blocking_level,
        allow_override,
        active_status
      )
      VALUES ($1,$2,$3::job_department_type,$4::workflow_block_resource_type,$5,$6,$7,$8::checklist_instance_status_type,$9,$10::checklist_blocking_level_type,$11,true)
      RETURNING id::text AS id
    `,
    [
      tenantId,
      input.name,
      input.departmentType ?? null,
      input.resourceType,
      input.fromStage ?? null,
      input.toStage,
      input.requiredTemplateCode,
      input.requiredInstanceStatus ?? "submitted",
      input.approvalRequired ?? false,
      input.blockingLevel ?? "hard_block",
      input.allowOverride ?? false
    ]
  );

  return inserted.rows[0]?.id ?? null;
}

async function syncReminderRules(
  client: PoolClient,
  tenantId: string,
  templateId: string,
  templateVersionId: string,
  rules: SeedReminderRuleDefinition[] = []
) {
  await client.query(
    `
      DELETE FROM checklist_reminder_rules
      WHERE tenant_id = $1
        AND template_id = $2
        AND template_version_id = $3
    `,
    [tenantId, templateId, templateVersionId]
  );

  for (const rule of rules) {
    await client.query(
      `
        INSERT INTO checklist_reminder_rules (
          tenant_id,
          template_id,
          template_version_id,
          department_type,
          scope_type,
          reminder_type,
          offset_minutes,
          delivery_channel,
          escalation_role,
          active_status
        )
        VALUES ($1,$2,$3,NULL,NULL,$4::checklist_reminder_type,$5,$6::alert_delivery_channel_type,$7,true)
      `,
      [
        tenantId,
        templateId,
        templateVersionId,
        rule.reminder_type,
        rule.offset_minutes,
        rule.delivery_channel ?? "in_app",
        rule.escalation_role ?? null
      ]
    );
  }

  return rules.length;
}

export async function seedChecklistTemplates(client: PoolClient, auth: AuthUser): Promise<ChecklistSeedResult> {
  const templateIdsByCode: Record<string, string> = {};
  const publishedVersionIdsByCode: Record<string, string> = {};
  let reminderRuleCount = 0;

  for (const definition of DEFAULT_CHECKLIST_TEMPLATE_DEFINITIONS) {
    const code = definition.template.code ?? definition.key;
    const existingTemplate = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM checklist_templates
        WHERE tenant_id = $1
          AND code = $2
        LIMIT 1
      `,
      [auth.tenantId, code]
    );

    const draft = await saveChecklistTemplateDraft(client, auth, existingTemplate.rows[0]?.id ?? null, definition.template);
    const draftVersion = draft.versions.find((version) => version.status === "draft") ?? draft.versions[0];
    const published = await publishChecklistTemplateVersion(client, auth, draft.id, draftVersion.id);
    const activeVersion = published.versions.find((version) => version.status === "published") ?? published.versions[0];

    templateIdsByCode[code] = published.id;
    publishedVersionIdsByCode[code] = activeVersion.id;
    reminderRuleCount += await syncReminderRules(client, auth.tenantId, published.id, activeVersion.id, definition.reminderRules ?? []);
  }

  for (const rule of DEFAULT_WORKFLOW_BLOCK_RULE_DEFINITIONS) {
    await upsertWorkflowBlockRule(client, auth.tenantId, rule);
  }

  return {
    templateIdsByCode,
    publishedVersionIdsByCode,
    template_count: DEFAULT_CHECKLIST_TEMPLATE_DEFINITIONS.length,
    version_count: Object.keys(publishedVersionIdsByCode).length,
    workflow_rule_count: DEFAULT_WORKFLOW_BLOCK_RULE_DEFINITIONS.length,
    reminder_rule_count: reminderRuleCount
  };
}

export async function seedChecklistDefaults(client: PoolClient, auth: AuthUser) {
  return seedChecklistTemplates(client, auth);
}

export { DEFAULT_CHECKLIST_TEMPLATE_DEFINITIONS, DEFAULT_WORKFLOW_BLOCK_RULE_DEFINITIONS, buildWorkflowRuleKey };
