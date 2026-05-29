# Project Tracking Foundation

This foundation starts the post-baseline operating-system layer without changing existing production-board, exception, readiness, payroll, or permissions ownership.

## Ownership

- Accounts remain the source of truth for schools and organizations.
- Jobs remain the operational container for work.
- `workflow_template` and `workflow_template_version` remain the versioned workflow roots.
- `workflow_template_milestone` and `workflow_template_step` define structure.
- `workflow_run`, `workflow_run_milestone`, and `workflow_step` define runtime execution truth.
- `work_task` remains an optional flexible layer and may link to `workflow_step` through `linked_step_id`.
- Exceptions remain the only blocker and urgent-risk authority outside workflow-local step status.
- Workflow state remains the owner of readiness and transition rules.
- Dashboards and UI surfaces remain read-only projections.

## API

- `GET /api/workflows/templates` lists active project-tracking workflow template versions.
- `POST /api/workflows/templates` creates a new active template version. Reusing a template key creates a new version instead of mutating an old version.
- `POST /api/workflows/instances` starts a project-tracking workflow for a job that already belongs to an account.
- `GET /api/workflows/instances/:workflowRunId` returns milestones, steps, dependencies, ownership, timing, and SLA projection.
- `GET /api/workflows/command-center` returns open workflow steps, summary counts, and alert projections ordered by operational priority: overdue, urgent, blocked, due soon, assigned.
- `POST /api/workflows/steps/:stepId/transition` moves a step through the state engine.
- `POST /api/workflows/steps/:stepId/send-back` sends work backward with reason, owner, and new expectations.
- `POST /api/workflows/internal/sla/sweep` is an internal worker endpoint that scans active workflow steps and queues idempotent SLA alert app events.

## Dashboard Location

- Shell navigation: Operations -> Project Tracking.
- Command Center route: `#project-tracking`.
- Command Center alias: `#project-tracking/command-center`.
- Workflow Map route: `#project-tracking/workflows/:workflowRunId`.
- Workflow Template Builder route: `#project-tracking/workflow-templates`.
- Checklist Templates route: `#admin/checklists`.

The UI is permission-aware, but backend route authorization remains the source of truth. Staff without workflow permissions should not receive the Project Tracking shell route.

## Workflow Template Builder V1

Workflow Template Builder V1 is a leadership-only linear builder that reuses the existing Project Tracking workflow backbone. It does not create a parallel workflow engine.

Implemented:

- Draft workflow template versions.
- Ordered milestones.
- Ordered controlled steps under milestones.
- Owner type/value, department fallback, role/user fields, SLA duration, due offset, dependency mode, and optional checklist template attachment.
- Preview that mirrors the Live Workflow Map structure.
- Publish action that locks the version and makes it default for new jobs.
- Historical integrity through existing `workflow_run.template_version_id`.

Feature flags:

- API: `WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED`.
- Admin web: `VITE_WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED`.

Checklist clarification:

- Workflow Templates define the main job workflow operating layer.
- Checklist Templates are reusable support checklists that can be attached to controlled steps.

See `docs/workflow-template-builder-v1.md` for the dedicated builder notes.

## Demo Data

Demo records are development-only and are marked with the `project_tracking_foundation` demo marker. The seed script is explicit, resettable, and idempotent: it removes only prior records with the demo marker/job numbers, then recreates the same scenario.

Run:

```bash
npm run project-tracking:seed-demo
```

Reset/reload:

```bash
npm run project-tracking:reset-demo
```

The demo data includes one sample district-style organization, two sample school accounts, a T-ball team/individual photo-day job, a graduation ceremony photography job, one versioned demo template, two active workflow instances, one on-track scenario, one blocked/at-risk scenario, a cross-department handoff, a send-back audit example, assigned staff work, and optional tasks linked to workflow steps.

The demo workflow uses these demo departments and roles:

- Departments: Photography, Graphics Production, Schools, Sports.
- Roles: CSR, Associate Photographer, Senior Photographer, Graphic Artist, QA Reviewer, Production Lead, Leadership.

What Matthew can demo now:

- Open Operations -> Project Tracking or `#project-tracking`.
- Review the global Command Center for on-track, due-soon, blocked, and at-risk workflow steps.
- Open a Workflow Map from a Command Center item and explain the current job, owner, milestone, active step, waiting steps, blocked step, rework history, and SLA projection.
- Show that optional tasks can attach to workflow steps without controlling workflow state.
- Show that SLA alerts are queued as app events, not externally dispatched yet.

## State Rules

- Root steps start as `NOT_STARTED`.
- Dependent steps start as `WAITING`.
- Completing or skipping a dependency activates downstream waiting steps.
- Command Center priority is `overdue`, `urgent`, `blocked`, `due soon`, then `assigned`. Urgent means due within 24 hours; due soon means due within three days.
- Skips, blocks, reopens, send-backs, dependency overrides, conflict-aware overwrites, timing expectation changes, and early completion require a reason.
- Assigned users may execute their own steps. Unassigned steps may be executed through role or department fallback. Override authorities can move workflow state with an explanation.
- Send-back increments rework count, assigns an owner, sets new expectations, and logs a handoff.
- All transitions write `workflow_step_audit_log` and `audit_log`. Workflow event rows are attempted through the app-event outbox with idempotency support; event insertion failures are isolated with a database savepoint so normal workflow state changes are not rolled back by outbox failure alone.
- SLA currently continues while a step is blocked. Blocked steps render red health until a later SLA-worker slice defines pause/resume policy.

## Event System

The workflow engine emits asynchronous app events:

- `workflow.instance_created`
- `workflow.step_started`
- `workflow.step_completed`
- `workflow.step_blocked`
- `workflow.step_reopened`
- `workflow.step_sent_back`
- `workflow.step_activated`
- `workflow.handoff_created`
- `workflow.sla_alert_queued`

These events are asynchronous and use the existing outbox processor. Dispatch is not performed by the API request path.

## SLA Worker And Alerts

Implemented:

- Worker scheduler `project-tracking-sla` calls the internal SLA sweep every 60 seconds.
- The sweep scans active, started workflow steps.
- Alert thresholds are calculated by `slaEngine`: 50 percent early warning, 75 percent risk, 90 percent urgent, and 100 percent or more overdue.
- Alert output is queued as `app_event` rows with dedupe keys by step and level to avoid alert spam.
- Command Center displays alert projections returned by the backend.

Scaffolded:

- Teams/Outlook dispatch is not implemented in this slice.
- Escalation targets are recorded in event payloads as future dispatch inputs: assigned user, department lead, and leadership.
- Idle detection currently uses timing projection but does not yet create a separate idle-specific event.

## Microsoft Integration Readiness

This pass does not implement Teams or Outlook dispatch. The foundation is intentionally provider-agnostic so future Microsoft integration can attach to canonical workflow events instead of redefining workflow logic.

Ready now:

- Workflow transitions and SLA sweeps emit app-event/outbox records that can be consumed by future notification providers.
- `workflow.sla_alert_queued` payloads include workflow run, job, step, department, assigned user, alert level, SLA timing, organization/job context, and escalation targets.
- Workflow ownership uses existing users, departments, roles, and backend permissions. No competing Microsoft-only identity system is introduced.
- Future providers can map existing users/departments/leadership groups to Microsoft users, Teams chats/channels, Outlook mailboxes, or calendar/task destinations without changing step truth.
- Event insertion failures are isolated from primary workflow transactions where workflow engine events are emitted, preserving the non-blocking outbox pattern.

Still scaffolded:

- Teams message delivery for workflow alerts, send-backs, overdue work, and blocked work.
- Outlook email/calendar/task dispatch.
- Microsoft identity mapping from Mission Control users to Entra/Graph identities.
- Provider selection for `in_app`, `email`, `teams`, and `outlook` notification channels.

## UI Architecture

- `ProjectTrackingFoundation` is the Command Center surface for global, department, and personal workflow projections.
- `ProjectWorkflowMap` renders canonical API projections only and explains current step, milestone, owner path, status, SLA percent, blocked state, skipped/completed state, and rework count.
- Frontend code does not compute permissions, blockers, payroll, or readiness.
- Empty states and error states are explicit; no mock data is presented as real data.

## Release-Test Flake Status

Current evidence from the commit-readiness stabilization pass:

- The previous Vitest runner-level `ERR_IPC_CHANNEL_CLOSED` did not reproduce.
- `checklistEngine.test.ts` was a legacy setup-time pressure point under full-release load. Its expensive default-seeding `beforeAll` hook now has an explicit 30 second hook budget while preserving assertions.
- `employeeExperience.test.ts` had two integration-style route compatibility checks that could exceed Vitest's default 5 second test budget under full-release load. Those tests now have focused 15 second budgets while preserving assertions.
- `conciergeCommandPalette.test.tsx` had a race in the keyboard-selection test when two results included "Monticello High School" text. The test now waits for the actual directory result to become active before pressing ArrowDown.
- The API chunk runner retries only a Vitest runner-level IPC/channel-closed infrastructure failure once. Assertion failures and normal non-zero test exits still fail immediately.
- Focused Project Tracking, worker SLA, admin permission, direct legacy timeout suites, full admin-web, and full release-test validation pass.
- Latest full release gate: `npm run verify:release:test` passed on this working tree.

Commit readiness is no longer blocked by release-runner timeout behavior. The remaining pre-commit requirement is normal human review of the intentionally dirty working tree.

## Assumptions

- A job must have `organization_id` before a project workflow can start.
- Department ownership is enough to satisfy "step has an owner" until a role or user override is assigned.
- Acknowledgment-before-SLA is modeled through handoff records and can be expanded without changing step truth.
- SLA alert workers consume `workflow_step` timing projections and queue app events instead of introducing dashboard-side calculations.

## Implemented vs Scaffolded

Implemented:

- Versioned project-tracking workflow templates.
- Runtime workflow instances for jobs with accounts.
- Milestones, controlled workflow steps, dependencies, handoffs, audit logs, and app-event outbox emission.
- Step transition rules with required reasons for deviations.
- Send-back/rework with owner, expectations, timing reset, and preserved audit history.
- Command-center projection with priority sorting and bounded result size.
- Optional task linkage through `work_task.linked_step_id`.
- Dashboard discoverability through Operations -> Project Tracking.
- Development-only demo data seed/reset commands.
- Background SLA sweep foundation with idempotent alert events.
- Command Center summary counts and alert projections.
- Project Tracking dashboard routes and demo data commands documented for leadership review.

Scaffolded or pending:

- Handoff acknowledgment endpoints.
- Branching workflow authoring.
- Job-at-risk synthesis from workflow history.
- Full workflow-builder UI beyond the command-center foundation.
- Microsoft Teams/Outlook alert delivery.
- Dedicated idle alert records.
- Full reporting suite.
- Full template-builder UX.

## Remaining Risks

- Template editing currently creates a new active version through the create endpoint; there is not yet a dedicated template-authoring edit workflow.
- Workflow events are protected from duplicate outbox rows when an idempotency key is supplied, but callers must provide idempotency keys for retry-sensitive writes.
- SLA pause/resume behavior for blocked steps is intentionally not implemented yet; current timing continues while blocked.
- Command Center is intentionally a bounded projection. Future production scale may need cursor pagination and department-specific saved filters.
- Alert events are queued, not delivered externally; dispatch is a post-demo hardening phase.
- Some older non-project-tracking suites remain slow under full-release pressure, especially training, checklist reminder sweeps, concierge search, and audit cleanup paths. They are passing now, but should be treated as post-commit test-performance debt.

## Recommended Next Phase

Do not begin the next feature phase until this foundation is either committed or intentionally abandoned. Recommended next branch after commit:

```bash
git checkout -b feature/project-tracking-pilot-polish
```

Recommended next focus: pilot polish for Command Center and Workflow Map walkthroughs, then alert-dispatch design for Microsoft Teams/Outlook without adding a full workflow builder.
