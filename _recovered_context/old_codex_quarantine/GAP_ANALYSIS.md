# Gap Analysis

## Audit Scope

This analysis is based on the current repository structure and product reality in:

- `packages/admin-web/src/app.tsx`
- Home, My Work, Scheduling, Attendance, Production, Profitability, Directory, Sales, Customer Service, and leadership surfaces
- backend routes for dashboard, schedule, attendance, employee, organizations, production, profitability, outlook, integrations, and zendesk
- current authority tiers and job-function profiles in `packages/api/src/authz/authority.ts`

## What Exists Today

### Main Product Surfaces

- `Home` / dashboard
- `My Work`
- `Scheduling`
- `Live Shoots`
- `Production`
- `Alerts`
- `Approvals`
- `Customer Service`
- `Organizations`
- `Contacts`
- `Locations`
- `Attendance`
- `Labor`
- `Payroll Review`
- `Compliance`
- `Sales Pipeline`
- `Profitability`
- `Reports`
- `Outlook Integration`
- `Gear`
- `Training`
- `Status Board`
- security and access surfaces

### Current Workflow Backbone Already In Code

The strongest assignment-to-completion path today is:

1. schedule and staffing are created and published
2. employee opens `My Work`
3. employee opens shift detail
4. employee clocks in or out, acknowledges notes, marks running late, requests missed punch correction, and submits post-shoot evaluation
5. attendance, compliance, payroll, and mileage review happen in manager-facing attendance surfaces
6. shoot completion and issue flags can trigger production follow-through

That is already a meaningful operational backbone.

## Strongest Implemented Areas

### 1. Dashboard and queue-first leadership model

Strong alignment:

- `HomePulseSurface`
- `ManagerCockpitSurface`
- role-aware shell sections
- urgent watch, today, attendance awareness, production snapshot, business context

Why it is strong:

- the product already understands that the front door is a live operational surface, not a report list
- the dashboard already uses compact cards with drill-in instead of giant dense pages

### 2. Schedule and staffing operations

Strong alignment:

- unified schedule calendar and board
- staffing templates
- staffing assignment and publish
- move schedule item
- schedule event editing
- Outlook push and resync

Why it is strong:

- schedule clarity is already treated as a first-class operating problem
- scheduling is already closer to an operations workspace than a passive calendar

### 3. Employee assignment-day experience

Strong alignment:

- `My Work`
- `EmployeeShiftDetailPanel`
- notes acknowledgment
- running late
- missed punch request
- post-shoot evaluation
- live refresh on schedule and attendance changes

Why it is strong:

- the code already contains the right product instinct: day-of work should be simple, focused, and action-oriented

### 4. Attendance and compliance foundations

Strong alignment:

- punch creation
- location check
- end-of-day confirmation
- missed punch workflow
- attendance exception workflow
- compliance flags
- payroll review
- mileage reimbursement review

Why it is strong:

- accountability is already modeled in structured operations, not just notes

### 5. Production workflow foundations

Strong alignment:

- production stages
- peer review and QA states
- triggered creation from shoot completion and post-shoot issues
- Home production snapshot
- manager cockpit project queue actions

Why it is strong:

- the product already moved away from generic project language toward production work

### 6. Directory as an operational system

Strong alignment:

- contacts are first-class
- relationship history is current and previous over time
- staged CSV import exists
- duplicate review stays explicit
- directory operations hub already links back into operations

## Weakest Or Most Fragmented Areas

### 1. The dashboard is strong for leadership, but not yet the universal role-based front door

Current state:

- leadership and managers have richer dashboard surfaces
- employee experience has `My Work`, but not the same universal dashboard concept
- non-field departments still rely on a mix of module-specific pages

Impact:

- the product truth says everyone should understand their day from one front door
- today that is only partially true

### 2. Assignment-to-completion is present, but split across multiple manager surfaces

Current split:

- scheduling handles publish and assignment
- My Work handles day-of field action
- Attendance handles compliance, payroll, and mileage review
- Production handles post-shoot digital work

Impact:

- the backbone exists, but it is not yet expressed as one coherent operating workflow

### 3. Mileage is still not a clean first-class employee flow

Current state:

- employee post-shoot evaluation includes `submit_for_mileage`
- separate mileage APIs also exist on shoots
- manager review exists in attendance

Impact:

- mileage is operationally important, but still feels like an attached subsystem instead of a backbone step

### 4. Communication and change visibility remain fragmented

Current state:

- notifications
- alerts
- manager cockpit
- attendance exceptions
- customer service
- touchpoints
- reports

Impact:

- the app has many signals, but not yet one clearly governed "what changed and what needs follow-through" layer

### 5. People Ops is split across too many separate leadership routes

Current state:

- Attendance
- Labor
- Payroll Review
- Compliance
- approvals and notifications in parallel

Impact:

- the data model is promising, but the experience is more fragmented than the operating-system goal

### 6. Production is now more truthful, but still not fully anchored to "every shoot leads to production work"

Current state:

- trigger-based production creation exists
- production links to a single shoot today
- manual production creation still exists

Impact:

- the product truth says production is the digital backend work caused by shoots
- current code supports that direction, but not yet as a universal invariant

### 7. Profitability is visible, but still early in data depth

Current state:

- workspace exists
- watch and burden views exist
- production burden and profitability watch signals connect
- imported profitability data is sparse

Impact:

- strong direction, but not yet a deep operating workspace for margin and contract health

### 8. The role model is technically rich but not yet product-simple

Current state:

- authority tiers
- job function profiles
- legacy role compatibility
- employee-only shell gating

Impact:

- strong foundation for security
- harder to explain in plain product language without a clear permission matrix

### 9. Some operations knowledge still lives in route sprawl rather than fewer stronger workspaces

Examples:

- schedule, live shoots, attendance, compliance, payroll, labor, alerts, approvals

Impact:

- the system is powerful, but still risks feeling like many connected tools instead of one operating system

### 10. Integrations exist, but the product-level operating contract is not fully explicit

Existing integrations:

- Outlook
- Zendesk
- integration sync operations
- webhook intake for Monday, Microsoft Graph, and agreement signature providers

Impact:

- the app can reduce switching
- but it still needs clearer product rules for which system is authoritative for which step

## Product Truth Alignment

| Product truth | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Dashboard is the most important screen | Partially aligned | `Dashboard.tsx`, `HomePulseSurface`, `ManagerCockpitSurface` | universal role-based dashboard is not fully normalized across all roles |
| Assignment to completion is the backbone | Partially aligned | `MyWork`, `EmployeeShiftDetailPanel`, schedule, attendance, production triggers | backbone exists across modules, but is not yet expressed as one coherent product contract |
| Fragmentation is the main problem to eliminate | Partially aligned | many modules consolidated into one app | still fragmented across too many leadership and review routes |
| Schedule, work, attendance, mileage, accountability, communication, follow-through should run through the app | Partially aligned | schedule, punches, exceptions, production, directory, profitability all exist | mileage and communication still feel split; some follow-through lives in parallel surfaces |
| Product should feel like a real leadership and operations system | Aligned | operations shell, Home, manager cockpit, production, directory, profitability | needs tighter consolidation and clearer prioritization to reduce route sprawl |

## What Feels Fragmented And Should Be Consolidated

### Consolidate in phase 1

- Attendance, Labor, Payroll Review, and Compliance into one People Ops operating workspace
- manager-facing follow-through signals into dashboard lanes instead of separate hunting
- mileage into the assignment-to-completion workflow instead of separate mental models
- production as the post-shoot digital work system, not a catch-all task surface
- customer-service and directory relationship knowledge back into dashboard and operating context

### Keep but do not over-expand yet

- Profitability
- Sales Pipeline
- Reports
- Outlook integration administration
- Gear
- Training

These matter, but they should support the two anchors instead of becoming co-equal product centers in phase 1.

## What Should Be Deferred

- white-label abstractions
- client or external portals as a primary design center
- a generic PM or CRM platform
- a full communications hub replacing email or Zendesk
- multi-shoot production grouping if it destabilizes production triggers
- deep profitability math without reliable populated data

## Top 10 Product Misalignments Or Risks

1. The dashboard is not yet the same front-door concept for leadership, managers, and employees.
2. The assignment-to-completion workflow is implemented across code, but not yet unified in product language or route structure.
3. Mileage submission and review are operationally important but still mentally separate from the main employee workflow.
4. Follow-through signals are spread across alerts, approvals, exceptions, notifications, cockpit, and production.
5. People Ops review work is split across multiple routes that should read as one operating workspace.
6. Production is much better aligned than before, but the product does not yet enforce "every shoot results in production visibility" as a universal business rule.
7. Profitability is now visible, but current data depth may cause the page to feel thinner than leadership expects.
8. The app still has too many strong secondary routes relative to the operating-system goal of fewer, stronger screens.
9. The permission model is robust but not yet expressed in product language simple enough for rollout, training, and governance.
10. Integrations exist, but the authoritative source-of-truth boundaries between this app, Outlook, Captura, and Zendesk are still not explicit enough.

## Assumptions

- Captura remains the system of record for core e-commerce and photo-commerce in phase 1.
- Outlook continues to matter for calendar interoperability, but this app should become the operational view of schedule truth.
- Zendesk remains active for customer service, but this app should increasingly surface the operational consequences of ticket pressure.
- Digital production remains internal operational work, not a client-facing workflow.
