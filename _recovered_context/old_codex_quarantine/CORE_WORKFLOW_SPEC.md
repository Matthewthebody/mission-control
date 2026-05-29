# Core Workflow Spec

## Backbone Definition

The assignment-to-completion workflow is the backbone of the product.

It begins when work is scheduled and assigned.
It is not done when the shoot ends.
It is done when:

- attendance and time are resolved
- mileage and exceptions are handled
- post-shoot issues are captured
- production follow-through is visible
- QA and release are complete where required

## Core Workflow Stages

| Stage | Primary actors | System purpose | Primary surfaces |
| --- | --- | --- | --- |
| 1. Plan and staff | leadership, operations managers | create the work, assign staff, detect gaps | Scheduling, staffing dashboard |
| 2. Publish assignment | managers | make the work official and visible to staff | Scheduling, My Work |
| 3. Confirm and prepare | employee, lead photographer | review notes, location, timing, resources, changes | My Work, shift detail |
| 4. Travel and arrival | employee, lead photographer | confirm lateness, arrival state, and context | My Work, attendance services |
| 5. On-site execution | employee, lead photographer | perform the work with visible assignment context | My Work, shift detail |
| 6. Wrap and end-of-day | employee | clock out, confirm end-of-day state, submit follow-through | My Work, attendance |
| 7. Exception and payroll review | managers, leadership | review late, missed punch, mileage, lunch, compliance items | Attendance, People Ops |
| 8. Production handoff | managers, production leads | create or confirm digital post-shoot production work | Production |
| 9. Digital production | production team | complete backend production tasks | Production |
| 10. Peer review and QA/QC | reviewer, QA owner, production lead | review, request changes, approve, prepare release | Production |
| 11. Release and closure | production lead, leadership as needed | mark released, capture final follow-through, close loops | Production, Dashboard |

## State Model

### Assignment state

- drafted
- staffed
- published
- acknowledged
- in progress
- wrapped
- needs review
- closed

### Attendance state

- not started
- clocked in
- running late
- missing punch
- exception submitted
- under review
- resolved

### Production state

- not started
- in production
- needs peer review
- changes requested
- QA approved
- ready for release
- released

## Required Data By Stage

### 1. Plan and staff

Required data:

- shoot or assignment date
- location
- arrival and start times
- staffing template or role needs
- lead coverage
- department
- publish status

### 2. Publish assignment

Required data:

- assigned users
- role on assignment
- published schedule visibility
- pre-service notes
- linked location and contact context

### 3. Confirm and prepare

Required data:

- employee sees exact assignment time
- address and map context
- required notes and attachments
- role expectations
- trade and PTO state if relevant

### 4. Travel and arrival

Required data:

- clock context
- geo or location validation where required
- running late status
- work-state capture when needed

### 5. On-site execution

Required data:

- on-shift status
- active notes
- staffing role
- key location and contact context
- issue capture path

### 6. Wrap and end-of-day

Required data:

- clock-out
- end-of-day confirmation
- post-shoot evaluation
- issue flag
- mileage submission intent
- vehicle type where needed

### 7. Exception and payroll review

Required data:

- exception type
- reason code
- requested values
- approver
- notes
- final resolution
- payroll and compliance impact

### 8. Production handoff

Required data:

- linked shoot
- production reason
- created-from-trigger or manual reason
- owner
- due and follow-up dates
- category and stage

### 9. Digital production

Required data:

- task list
- task owners
- due dates
- reviewer assignments
- blockers or change reasons

### 10. Peer review and QA/QC

Required data:

- peer reviewer
- final QC reviewer
- review status
- change-request notes
- approval note

### 11. Release and closure

Required data:

- release-ready state
- release date
- release owner
- closure note where relevant

## Required Handoffs

### Staffing to employee

Handoff must include:

- assignment visibility
- exact time
- exact place
- role
- notes

### Employee to manager review

Handoff must include:

- attendance outcome
- exceptions
- missed punch issues
- late-arrival signals
- post-shoot evaluation

### Shoot to production

Handoff must include:

- linked shoot
- trigger reason
- issue or wrap reason
- owner and due visibility

### Production to release

Handoff must include:

- production owner
- reviewer
- QA status
- final release readiness

## Approvals And Exceptions

### Attendance exceptions

Cases:

- late arrivals
- missed punch
- manual time adjustment
- no-lunch challenge
- break override

Rule:

- employee can submit
- manager or authorized approver reviews
- resolution must be auditable

### Schedule exceptions

Cases:

- trade requests
- PTO requests
- staffing conflicts
- publish overrides

### Production exceptions

Cases:

- changes requested
- blocked waiting on source material
- overdue reviewer or QC queue

## Audit Requirements

Every backbone stage should leave an auditable trail for:

- who changed the state
- when it changed
- why it changed
- which record or linked object it affected
- whether the step was system-triggered or manual

This is especially important for:

- time edits
- attendance exceptions
- staffing publish
- production trigger creation
- QA and release changes

## Edge Cases That Must Be Supported

### Attendance and late arrival

- employee knows they will be late before shift start
- employee forgets to clock in
- shift ends but end-of-day state is not confirmed
- lead photographer needs limited approval scope for their shoot only

### Mileage

- employee flags mileage at wrap time
- manager can review mileage reimbursement candidates
- mileage remains tied to actual work context, not detached forms

### Follow-through

- a shoot completes with no issues but still needs production wrap
- a shoot completes with issues and needs remediation
- uploaded issue evidence creates production follow-up
- a production item changes owner or reviewer midstream

### Staffing

- assignment conflicts need override
- published staffing still lacks lead coverage
- multiple departments operate on the same day with different rules

## Product Rule

If a feature does not improve either:

- dashboard clarity
- assignment-to-completion execution

it should be questioned for phase 1.
