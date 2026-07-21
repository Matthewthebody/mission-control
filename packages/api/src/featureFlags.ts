import { config } from "./config.js";

function readBooleanFlag(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return raw === "true";
}

export const featureFlags = {
  get centralJobIntakeV1() {
    return readBooleanFlag("CENTRAL_JOB_INTAKE_V1_ENABLED", config.CENTRAL_JOB_INTAKE_V1_ENABLED);
  },
  get jobCloseoutV1() {
    return readBooleanFlag("JOB_CLOSEOUT_V1_ENABLED", config.JOB_CLOSEOUT_V1_ENABLED);
  },
  get intakeEngagementReuseV1() {
    return readBooleanFlag("INTAKE_ENGAGEMENT_REUSE_V1_ENABLED", config.INTAKE_ENGAGEMENT_REUSE_V1_ENABLED);
  },
  get mileageAnswerPendingV1() {
    return readBooleanFlag("MILEAGE_ANSWER_PENDING_V1_ENABLED", config.MILEAGE_ANSWER_PENDING_V1_ENABLED);
  },
  get complianceWorkspaceV1() {
    return readBooleanFlag("COMPLIANCE_WORKSPACE_V1_ENABLED", config.COMPLIANCE_WORKSPACE_V1_ENABLED);
  },
  get coreFoundationDiagnostics() {
    return readBooleanFlag("CORE_FOUNDATION_DIAGNOSTICS_ENABLED", config.CORE_FOUNDATION_DIAGNOSTICS_ENABLED);
  },
  get coreWorkflowEngine() {
    return readBooleanFlag("CORE_FOUNDATION_WORKFLOW_ENGINE_ENABLED", config.CORE_FOUNDATION_WORKFLOW_ENGINE_ENABLED);
  },
  get workflowTemplateBuilderV1() {
    return readBooleanFlag("WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED", config.WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED);
  },
  get coreOperationalEvents() {
    return readBooleanFlag("CORE_FOUNDATION_OPERATIONAL_EVENTS_ENABLED", config.CORE_FOUNDATION_OPERATIONAL_EVENTS_ENABLED);
  },
  get coreGlobalSearch() {
    return readBooleanFlag("CORE_FOUNDATION_GLOBAL_SEARCH_ENABLED", config.CORE_FOUNDATION_GLOBAL_SEARCH_ENABLED);
  },
  get coreActivityTimeline() {
    return readBooleanFlag("CORE_FOUNDATION_ACTIVITY_TIMELINE_ENABLED", config.CORE_FOUNDATION_ACTIVITY_TIMELINE_ENABLED);
  },
  get coreAdminConfiguration() {
    return readBooleanFlag("CORE_FOUNDATION_ADMIN_CONFIGURATION_ENABLED", config.CORE_FOUNDATION_ADMIN_CONFIGURATION_ENABLED);
  },
  get coreApprovalFramework() {
    return readBooleanFlag("CORE_FOUNDATION_APPROVAL_FRAMEWORK_ENABLED", config.CORE_FOUNDATION_APPROVAL_FRAMEWORK_ENABLED);
  },
  get coreReporting() {
    return readBooleanFlag("CORE_FOUNDATION_REPORTING_ENABLED", config.CORE_FOUNDATION_REPORTING_ENABLED);
  },
  get communicationDiagnostics() {
    return readBooleanFlag("COMMUNICATIONS_DIAGNOSTICS_ENABLED", config.COMMUNICATIONS_DIAGNOSTICS_ENABLED);
  },
  get communicationIdentityLinking() {
    return readBooleanFlag("COMMUNICATION_IDENTITY_LINKING_ENABLED", config.COMMUNICATION_IDENTITY_LINKING_ENABLED);
  },
  get communicationInAppActions() {
    return readBooleanFlag("COMMUNICATION_IN_APP_ACTIONS_ENABLED", config.COMMUNICATION_IN_APP_ACTIONS_ENABLED);
  },
  get communicationHistory() {
    return readBooleanFlag("COMMUNICATION_HISTORY_ENABLED", config.COMMUNICATION_HISTORY_ENABLED);
  },
  get communicationProactiveRules() {
    return readBooleanFlag("COMMUNICATION_PROACTIVE_RULES_ENABLED", config.COMMUNICATION_PROACTIVE_RULES_ENABLED);
  },
  get communicationPostCallFollowUp() {
    return readBooleanFlag("COMMUNICATION_POST_CALL_FOLLOW_UP_ENABLED", config.COMMUNICATION_POST_CALL_FOLLOW_UP_ENABLED);
  },
  get communicationPreCallContext() {
    return readBooleanFlag("COMMUNICATION_PRE_CALL_CONTEXT_ENABLED", config.COMMUNICATION_PRE_CALL_CONTEXT_ENABLED);
  },
  get microsoftTeamsEmbeddedCommunications() {
    return readBooleanFlag(
      "MICROSOFT_TEAMS_EMBEDDED_COMMUNICATIONS_ENABLED",
      config.MICROSOFT_TEAMS_EMBEDDED_COMMUNICATIONS_ENABLED
    );
  },
  get microsoftEntraAuth() {
    return readBooleanFlag("MICROSOFT_ENTRA_AUTH_ENABLED", config.MICROSOFT_ENTRA_AUTH_ENABLED);
  },
  get microsoftOutlookSync() {
    return readBooleanFlag("MICROSOFT_OUTLOOK_SYNC_ENABLED", config.MICROSOFT_OUTLOOK_SYNC_ENABLED);
  },
  get microsoftTeamsAlerts() {
    return readBooleanFlag("TEAMS_OPERATIONAL_ALERTS_ENABLED", config.TEAMS_OPERATIONAL_ALERTS_ENABLED);
  },
  get microsoftTeamsCommunications() {
    return readBooleanFlag("MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED", config.MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED);
  },
  get microsoftTeamsMeetings() {
    return readBooleanFlag("MICROSOFT_TEAMS_MEETINGS_ENABLED", config.MICROSOFT_TEAMS_MEETINGS_ENABLED);
  },
  get microsoftTeamsSearch() {
    return readBooleanFlag(
      "MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED",
      config.MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED
    );
  },
  get microsoftTeamsPersonalApp() {
    return readBooleanFlag("MICROSOFT_TEAMS_PERSONAL_APP_ENABLED", config.MICROSOFT_TEAMS_PERSONAL_APP_ENABLED);
  }
} as const;
