# Phase-One Account Portal MVP Runtime Plan

## Purpose
This file locks the runtime owner and exact route plan for the bounded phase-one account-facing portal MVP.

The goal is not to launch a broad portal product. The goal is to give the existing contract a concrete runtime owner so implementation can stay narrow.

## Runtime Owner
- Backend owner service: `packages/api/src/services/microsoft365ClientPortal.ts`
- Access owner record: `microsoft_client_portal_access_grant`
- Job route owner record: `microsoft_client_portal_project_link`
- Internal diagnostics route: `/api/admin/system/microsoft-client-portal`
- Internal management routes:
  - `/api/integrations/microsoft/client-portal/access-grants`
  - `/api/integrations/microsoft/client-portal/projects`

Runtime ownership rules:
- Access remains app-owned through explicit account-linked and job-linked grants.
- Job route ownership remains app-owned through explicit project links.
- Portal pages are projections of canonical Mission Control records.
- The portal does not become a top-level internal workspace.

## Auth And Access Boundary
- Auth provider: `entra_external_id`
- Account access owner: `microsoft_client_portal_access_grant`
- Job access owner: `microsoft_client_portal_project_link`
- Access is granted only through explicit app-owned records, not inferred from email threads, file shares, or internal shell membership.
- Disabling or revoking a grant removes portal visibility without changing Mission Control ownership of the underlying records.

## Phase-One MVP Route Plan
Account-scoped entry:
- `/projects`
  - Shows only linked jobs the signed-in external contact can access.
  - This is a project picker, not a CRM account workspace.

Job-linked routes:
- `/projects/{portal_project_key}/status`
  - Default project route.
  - Shows portal-safe job status, next milestone, visible blockers, and approved change state.
- `/projects/{portal_project_key}/schedule`
  - Shows portal-safe event timing and schedule changes.
- `/projects/{portal_project_key}/files`
  - Shows curated deliverables, requested files, and approved file visibility.
- `/projects/{portal_project_key}/history`
  - Shows client-safe change history and submission history.

Compatibility alias:
- `/projects/{portal_project_key}` resolves to `/projects/{portal_project_key}/status`

Shell boundary:
- The external `/projects/...` portal routes live outside the internal admin-web hash shell.
- The internal admin-web `#projects` route remains the Graphics workspace and is not the account-facing portal.

## Phase-One Data Sources
- `status`: Job, Workflow Run, Approval, Exception, Acknowledgement
- `schedule`: Event, Staff Assignment, Schedule projection
- `files`: File, Record Resource, Sync Object
- `history`: Activity Log, Submission History, Approval

## In Phase One Now
- explicit account-linked access grants
- explicit job-linked project links
- project entry route
- status route
- schedule route
- files route
- history route

## Minimum Runtime Modules
- Backend:
  - `packages/api/src/services/microsoft365ClientPortal.ts`
  - `packages/api/src/types/microsoft365ClientPortal.ts`
  - `/api/admin/system/microsoft-client-portal`
  - `/api/integrations/microsoft/client-portal/access-grants`
  - `/api/integrations/microsoft/client-portal/projects`
- Frontend:
  - `packages/admin-web/src/navigation.ts`
  - `packages/admin-web/src/app.tsx`

## Deferred
- CRM behavior
- free-form messaging or inbox behavior
- workflow editing from the portal
- broad self-service scheduling changes
- billing and finance surfaces
- later-phase required-items, upload, and help expansions beyond this MVP
