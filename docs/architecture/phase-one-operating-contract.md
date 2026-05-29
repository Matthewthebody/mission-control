# Mission Control Phase-One Operating Contract

## 1. Mission
Mission Control is the operational system of record for Kemmetmueller Photography. It exists to help the team see the full picture, know what to do next, and run the business from one trusted source of truth.

## 2. Phase-One Scope
Phase one locks the operating model for:

- Schools
- Sports
- Studios
- Graphics

Phase one covers:

- canonical records
- workflow execution
- staffing and schedule visibility
- task ownership
- exceptions
- record-linked communications
- acknowledgements
- approvals
- files
- sync state
- minimal account-facing admin portal visibility

Phase one does not authorize new core object types, new department-specific workflow vocabularies, or new top-level workspaces outside this contract.

## 3. Product Positions
- Mission Control is the operational system of record.
- Departments are entry points, not separate apps.
- Accounts are not departments.
- Shoot type is metadata and template logic, not hierarchy.
- Microsoft 365 is a connected backbone, not the system of record.
- Communications is not a standalone parallel workspace.
- No new page may introduce a new core object or new workflow vocabulary outside this contract.

## 4. Canonical Core Objects
Phase one first-class objects are:

- Organization
- Account
- Contact
- Job
- Event
- Staff Assignment
- Task
- Workflow Template
- Workflow Run
- Resource Kit
- Exception
- File
- Sync Object
- Acknowledgement
- Approval
- User
- Role
- Department
- Activity Log

## 5. Hierarchy Rules
- Use `Organization -> Account -> Job -> Event` when a meaningful parent organization exists.
- Use `Account -> Job -> Event` when a meaningful parent organization does not exist.
- Do not invent alternate hierarchy shapes per department without updating this contract.
- Graphics is an internal department lens. It is not a separate client-account hierarchy.
- Departments do not define the client hierarchy.
- Jobs are operational records.
- Events are the scheduled occurrences inside jobs.

## 6. Canonical Operating Spine
The canonical phase-one operating spine is:

`Job -> Event -> Staff Assignment -> Task`

These objects attach around that spine:

- Files
- Exceptions
- Sync Objects
- Acknowledgements
- Approvals

The following are derived views, not primary objects:

- dashboards
- watchlists
- queue buckets
- schedule board groupings
- urgency cards
- executive rollups

## 7. Workflow Rules
- Every new Job must be created from a Workflow Template or from an approved draft path that resolves into a Workflow Template before publish.
- Every published Job must have one Workflow Run.
- Workflow Runs generate Tasks and Events.
- Owner defaults, dependencies, date offsets, acknowledgement rules, approval checkpoints, and resource kit bindings come from the Workflow Template.
- Current owner and next owner must be derivable from the Workflow Run and open required work.
- Team-assigned work remains open until claimed.
- Claiming team-assigned work creates the acknowledgement and ownership record.

## 8. Exception Rules
- `Exceptions` is the canonical product term.
- `watch`, `watchlist`, `urgent watch`, and similar labels are compatibility aliases only.
- Exceptions must cover at minimum:
  - staffing gaps
  - missing data
  - missing files
  - handoff failures
  - blocked approvals
  - failed syncs
  - ignored required acknowledgements
  - production blockers
  - schedule changes affecting active work
- Exceptions must be record-linked to a Job, Event, Task, Workflow Run, Sync Object, or Approval target.
- Exceptions must carry severity, owner, status, and resolution history.

## 9. Communications Boundary
- Communications must be record-linked to Accounts, Jobs, Events, Tasks, Workflow Runs, or Exceptions.
- Communications may be launched from shared utilities, but the underlying record linkage is mandatory.
- Communications is not a standalone parallel operational workspace with its own object model.
- No major top-level operator route may present Communications as a separate system of record.
- Email templates, mail merge, send, reply, and follow-up actions are allowed only when tied to a canonical record and logged.
- Admin diagnostics may expose delivery health, moderation, and rollout controls, but those diagnostics do not make Communications a standalone workspace.

## 10. Sync Boundary
- Microsoft 365 supports identity, calendar coordination, and communication execution around the app.
- Mission Control remains the source of truth for operational records.
- Sync behavior must have:
  - explicit owner
  - explicit state
  - visible failures
  - retry handling
  - activity history
- No magic sync behavior is allowed.
- Sync Objects are first-class records and must represent external linkage and sync state explicitly.

## 11. Minimal Account-Facing Admin Portal Boundary
Phase one includes a narrow account-facing portal MVP with:

- schedule
- status
- files
- change history

Portal boundary rules:

- the portal is account-linked and job-linked, not a top-level internal operator workspace
- portal data is a controlled projection of canonical Mission Control records
- portal actions must stay scoped to approved account-facing visibility and controlled requests
- the portal must not become a parallel CRM, inbox, or workflow-editing surface
- the runtime owner is `microsoft365_client_portal`, backed by explicit `microsoft_client_portal_access_grant` and `microsoft_client_portal_project_link` records
- the external portal route plan lives at `/projects` and `/projects/{portal_project_key}/*`, outside the internal admin-web hash shell
- the internal admin-web `#projects` route remains the Graphics workspace and must not be treated as the account-facing portal

Phase-one runtime ownership is defined in:

[phase-one-account-portal-mvp-runtime-plan.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/phase-one-account-portal-mvp-runtime-plan.md)

Phase one excludes:

- broad self-service workflow editing
- uncontrolled scheduling
- free-form messaging sprawl
- general CRM behavior
- deep billing or finance features

## 12. Phase-One Screens
Primary phase-one product surfaces are:

- Home
- My Work
- Departments
- Accounts
- Jobs
- Schedule
- Tasks
- Exceptions
- Admin

Supporting phase-one surfaces may exist only as bounded utilities:

- record-linked communication launchers and focused communication action pages
- account-facing portal entry points scoped to the minimal portal MVP

Department landing pages must exist for:

- Schools
- Sports
- Studios
- Graphics

Department pages may vary by filters and metrics, but not by core object model.

## 13. Naming Rules
Canonical names:

- Studios
- Graphics
- Exceptions
- Job
- Event
- Staff Assignment
- Task
- Workflow Template
- Workflow Run
- Sync Object

Disallowed as new primary vocabulary:

- Photography as a top-level department name
- Production as a top-level department name when the actual intent is Graphics
- Watch
- Watchlist
- Urgent Watch
- page-specific names for core workflow stages that are not backed by shared workflow definitions

## 14. Route Ownership Rules
- Department routes own department landing views only.
- Operations routes own shared record workspaces.
- My Work owns personal execution visibility.
- Admin owns templates, integrations, reference data, settings, and permissions.
- Communications may exist as record-linked launchers or utilities, not as a parallel object-owning workspace.
- Scaffold-only, placeholder, or shell-only routes must not remain visible as first-class product destinations.
- Hidden compatibility aliases may remain temporarily if they redirect or resolve into canonical routes without introducing alternate truths.

## 15. Compatibility Migration Rules
The following compatibility mappings are approved temporarily for runtime stability:

- `Photography -> Studios`
- `Production -> Graphics`
- `Watchlist/Watch/Urgent Watch -> Exceptions`

The live inventory of active reset-era aliases and deprecated seams is maintained in:
- [reset-compatibility-register.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/reset-compatibility-register.md)

Migration rules:

- old routes may remain as hidden aliases temporarily
- new primary labels, docs, and navigation must use canonical names
- new code must not introduce old names as primary route labels or product vocabulary
- old names may remain only where required for compatibility, analytics continuity, or staged migration
- when an alias remains, the canonical owner route must be clear

## 16. Enforcement Rules
- Pages do not define the model. The model defines the pages.
- New surfaces must consume canonical objects or approved derived views only.
- Department-specific logic must live in templates, filters, policies, and metrics, not in alternate data models.
- Any proposed exception to this contract requires an explicit update to this file.

## 17. Acceptance Criteria
Acceptance criteria for the near-term implementation phases are defined in:

[phase-one-acceptance-criteria.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/phase-one-acceptance-criteria.md)
