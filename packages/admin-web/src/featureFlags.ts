function parseBooleanFlag(value: string | undefined, fallback = false) {
  if (value == null) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(normalized);
}

export const featureFlags = {
  // ON by default since 2026-07-13 (owner-ratified E21): the intake cascade is
  // the ONE front door — Jessica gets her create button. Opt out per env.
  centralJobIntakeV1: parseBooleanFlag(import.meta.env.VITE_CENTRAL_JOB_INTAKE_V1_ENABLED, true),
  workflowTemplateBuilderV1: parseBooleanFlag(import.meta.env.VITE_WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED, true),
  jobCloseoutV1: parseBooleanFlag(import.meta.env.VITE_JOB_CLOSEOUT_V1_ENABLED, !import.meta.env.PROD),
  complianceWorkspaceV1: parseBooleanFlag(import.meta.env.VITE_COMPLIANCE_WORKSPACE_V1_ENABLED, true)
} as const;
