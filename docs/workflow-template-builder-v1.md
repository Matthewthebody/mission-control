# Workflow Template Builder V1

Workflow Template Builder V1 is the leadership-managed template surface for Project Tracking. It reuses the existing workflow backbone instead of creating a second workflow engine.

## Where It Lives

- Dashboard route: `#project-tracking/workflow-templates`
- Related command center: `#project-tracking`
- Live workflow map: `#project-tracking/workflows/:workflowRunId`
- Checklist template library: `#admin/checklists`

## What Was Reused

- Existing `workflow_template`, `workflow_template_version`, `workflow_template_milestone`, `workflow_template_step`, and `workflow_template_step_dependency` tables.
- Existing runtime workflow instances, milestones, controlled steps, dependencies, SLA state, audit/event behavior, and app_event/outbox foundation.
- Existing Checklist Templates remain the reusable support-checklist system.

## Builder Behavior

- Leadership users can create a draft workflow template version.
- Draft versions can receive ordered milestones.
- Draft versions can receive ordered controlled steps under milestones.
- Controlled steps include owner type/value, department fallback, role/user fields, required/skippable/blocking flags, SLA duration, due offset, dependency mode, and optional checklist template attachment.
- Publishing a draft marks that version as `published` for the UI and stores it as the existing runtime `active` status.
- Publishing makes the new version the default for new jobs.
- Existing workflow runs remain tied to their original `template_version_id`.
- Published versions are locked; editing requires a new draft version.

## Checklist Template Clarification

Checklist templates are reusable support checklists. Full job workflows are built in Workflow Templates using milestones, controlled steps, owners, SLAs, and dependencies.

## Feature Flag

- API flag: `WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED`
- Admin-web flag: `VITE_WORKFLOW_TEMPLATE_BUILDER_V1_ENABLED`
- Default: enabled for local/demo development.
- Disabled behavior: builder endpoints return disabled and the UI route shows a safe disabled state. Existing Project Tracking continues to work.

## Permissions

Workflow Template Builder is leadership/template-manager only.

Allowed:
- `workflow.template.manage`
- `director_admin`
- `leadership`
- `super_admin`

Not allowed:
- staff who can only view workflows
- staff who can only execute assigned workflow steps
- regular photographers/associates without template-management access

## API Endpoints

- `GET /api/workflows/template-builder/templates`
- `POST /api/workflows/template-builder/templates`
- `GET /api/workflows/template-builder/templates/:templateId`
- `POST /api/workflows/template-builder/versions/:templateVersionId/milestones`
- `POST /api/workflows/template-builder/versions/:templateVersionId/steps`
- `GET /api/workflows/template-builder/versions/:templateVersionId/preview`
- `POST /api/workflows/template-builder/versions/:templateVersionId/publish`
- `POST /api/workflows/template-builder/versions/:templateVersionId/archive`

## Workflow Map Polish

The live Workflow Map now separates:

- Job
- Account
- Workflow
- Organization / District availability
- Job Type
- Template Version
- Current Milestone
- Current Step
- Owner
- SLA State

This fixes the prior issue where job/account context was buried in one combined workflow title.

## Not Implemented Yet

- Drag-and-drop workflow canvas.
- Advanced branching workflow builder.
- Full job-creation template picker.
- Teams delivery.
- Outlook delivery.
- External alert dispatch.
- Full reporting suite.
- Full template analytics.

## Demo Data Note

This pass does not broadly clean or reset Project Tracking demo data. If local demo data contains noisy SLA rows from previous test/demo runs, run a dedicated demo-data cleanup/reseed pass before a leadership demo.
