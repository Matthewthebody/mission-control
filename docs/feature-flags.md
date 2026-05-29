# Feature Flags

Mission Control feature flags should be discoverable, default-safe, and documented before a feature becomes pilot-visible.

## Current Registry

| Feature | Backend flag | Frontend flag | Default | Controls | Pilot/demo state | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Workflow Template Builder V1 | `WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED` | `VITE_WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED` | enabled | Leadership workflow template builder, preview, publish/archive API and UI | enabled | V1 is a linear builder, not a visual graph editor. |
| Job Closeout V1 | `JOB_CLOSEOUT_V1_ENABLED` | `VITE_JOB_CLOSEOUT_V1_ENABLED` | enabled outside production | Post-shoot evaluations, shoot check-ins, mileage review foundation, report snapshots | enabled for pilot review | Production should explicitly set desired state. |
| Compliance Workspace V1 | `COMPLIANCE_WORKSPACE_V1_ENABLED` | `VITE_COMPLIANCE_WORKSPACE_V1_ENABLED` | enabled | Leadership compliance review workspace for closeout, payroll, mileage, and attendance blockers | enabled | Read-oriented workspace; actions reuse existing attendance/review paths. |
| Central Job Intake V1 | `CENTRAL_JOB_INTAKE_V1_ENABLED` | `VITE_CENTRAL_JOB_INTAKE_V1_ENABLED` | disabled | Central job intake/import paths | optional | Keep disabled unless that workflow is being reviewed. |
| Core Global Search | `CORE_FOUNDATION_GLOBAL_SEARCH_ENABLED` | none currently | enabled | Global search API and search-backed discovery | enabled | Search must stay bounded and permission-aware. |
| Core Reporting | `CORE_FOUNDATION_REPORTING_ENABLED` | none currently | enabled | Reporting foundation and diagnostics | enabled | Report outputs must remain schema-governed. |
| Communications diagnostics | `COMMUNICATIONS_DIAGNOSTICS_ENABLED` | none currently | enabled | Communication diagnostics surfaces | internal only | Do not overstate delivery readiness. |
| Communications history | `COMMUNICATION_HISTORY_ENABLED` | none currently | enabled | Communication history support | internal only | Not a Communications V1 launch flag by itself. |
| Communications proactive rules | `COMMUNICATION_PROACTIVE_RULES_ENABLED` | none currently | enabled | Rule scaffolding for proactive comms | internal only | Future-ready; do not imply active delivery. |
| Microsoft Teams communications | `MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED` | none currently | disabled | Teams communication delivery capabilities | disabled unless explicitly configured | Future-ready only unless Graph/bot config is live. |
| Teams operational alerts | `TEAMS_OPERATIONAL_ALERTS_ENABLED` | none currently | disabled | Teams operational alert delivery | disabled unless explicitly configured | App events/outbox can be ready without Teams delivery being active. |
| Microsoft Outlook sync | `MICROSOFT_OUTLOOK_SYNC_ENABLED` | none currently | disabled | Outlook calendar/mail sync paths | disabled unless explicitly configured | Requires OAuth/encryption config. |
| Microsoft Teams meetings | `MICROSOFT_TEAMS_MEETINGS_ENABLED` | none currently | disabled | Teams meeting creation | disabled unless explicitly configured | Future-ready integration. |
| Concierge Search | `CORE_FOUNDATION_GLOBAL_SEARCH_ENABLED` plus Concierge routes | none currently | enabled | Search-backed concierge and global search foundations | enabled in integrated baseline | Keep performance bounded; do not rely on Concierge for pilot-critical flows unless explicitly reviewed. |

## Rules

- Production defaults should fail closed for integration delivery.
- Pilot/demo features should be explicit in `.env`.
- UI visibility should match API availability when practical.
- A disabled feature should show a safe unavailable state or hide the route.
- Flags should not be used to skip release-blocking tests silently.

## Recommended Follow-Up

- Add a read-only admin/system endpoint that lists effective feature flag states without exposing secrets.
- Add owners and retirement dates for temporary flags.
- Move frontend-only flag documentation into the admin shell once a system settings view exists.
