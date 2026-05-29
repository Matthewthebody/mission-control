# Schools Workflow Automation Parity

This inventory captures the Schools workflow gaps Jessica called out: Mission Control should centralize Schools status without becoming a generic monday.com clone, and it cannot remove automations the team already depends on.

## Current Mission Control Support

| Area | Current state | Notes |
| --- | --- | --- |
| Central Schools dashboard | Supported V1 | Schools Dashboard now defaults to a curated, low-noise view: Total Active School Jobs, Due Today, Overdue, Jobs Due in the Next 7 Days, and ID Card Tracker. It intentionally avoids a card for every job type/status. |
| Live job workflow | Supported V1 | A school job can open into a live workflow showing current step, next action, current department, waiting-for context, deadline, last updated, handoff history, family communication, ID/admin work, and closeout. |
| Schools-to-Production handoff | Durable V1 | Schools can send a live workflow to Production, Production can accept/claim/mark waiting/complete/return, and those transitions are persisted with audit history. |
| Production Queue V1 | Supported V1 | Production Queue V1 is fed only by cross-department workflow handoffs into Production. It is intentionally narrow and does not replace the full Production operating system yet. |
| Monday board import | Partial | Schools Hub has Monday import/admin surfaces and external sync metadata for board/group context. Mission Control does not yet replace all monday.com automations. |
| Workflow templates | Partial | Workflow Template Builder V1 supports linear milestones, controlled steps, role/queue-oriented assignment setup, due rules, dependencies, preview, publish, and archive. It is not a full visual automation builder. |
| Workflow instance safety | Supported | Existing workflow runs stay tied to their original template version. Published versions are locked for historical safety. |
| Template copy/edit safety | Improved | UI now makes duplication into an editable draft explicit so leaders can edit a copy instead of overwriting the source template by default. |
| Outlook calendar backbone | Scaffolded | Outlook delegated read/preview and explicit sync seams exist elsewhere in Mission Control. Schools-specific Outlook event review queue is not live yet. |
| App events/outbox | Scaffolded | Workflow events queue internally. Teams/Outlook dispatch remains future-ready, not active delivery. |
| ID Card Tracker | Dashboard V1 | Schools Dashboard shows ID/admin-related status for the demo path. A dedicated full ID card workflow model remains future work. |
| Yearbook | Out of scope | Yearbook workflows/statuses/templates are intentionally not changed in this pass. |

## Monday.com Automation Types To Preserve

| Automation need | Example if-then rule | Current Mission Control status | Gap before replacement |
| --- | --- | --- | --- |
| Calendar intake | When an Outlook calendar event is created, then create a Schools workflow review item. | Not live for Schools | Need delegated Outlook review queue with suggested school/account/template/date/owner. |
| Calendar-to-template suggestion | When an Outlook event is linked to a school, then suggest a workflow template. | Not live for Schools | Need matching heuristics and human approval. |
| Overdue escalation | When a due date is missed, then mark item at risk and notify the right team. | Partial | Deadline/risk flags exist; Teams/Outlook delivery is not live. |
| Step handoff | When a step is ready for another department, then move it through an auditable handoff. | Supported V1 for Schools-to-Production | Durable handoff V1 covers Schools-to-Production-to-Schools. Other departments still need follow-up slices. |
| Gallery follow-up | When gallery status changes to Sent to Families, then create follow-up and notify main school contact. | Partial | Gallery risk/work items exist; customer notification delivery is not live. |
| Missing information | When required information is missing before a deadline, then create an exception. | Partial | Schools Hub can track missing/blocked work, but full rule inventory is not complete. |
| Owner change notification | When owner changes, then notify the new owner. | Not live | Needs notification provider contract and audit log trail. |
| Status transition | When status changes, then trigger the next workflow action. | Partial | Template/instance model supports future rules; plain-English rule builder is not implemented. |
| Role escalation | When an item becomes overdue, then escalate according to role rules. | Partial | Need role escalation matrix and delivery path. |

## Outlook Schools Review Queue Target

The first safe Outlook-backed Schools workflow surface should be a review queue, not automatic writeback.

Each queue row should show:

- Outlook event title/date/calendar.
- Suggested school/account match.
- Suggested workflow template.
- Suggested job date.
- Suggested owner.
- Actions: Create Workflow, Link to Existing, Ignore.

Security boundaries:

- Use delegated Outlook access where the existing architecture expects delegated access.
- Do not introduce app-only Microsoft access for this workflow without a separate security review.
- Keep Mission Control as the system of record for jobs/workflows.
- Treat Outlook as the calendar backbone and visibility/source signal, not a second workflow database.

## Workflow Template Safety Rules

- A Workflow Template is a reusable recipe.
- A Workflow Instance is the running workflow for a specific school/job.
- Editing a template should create a copy or a new version by default.
- Published versions stay locked.
- Active workflow instances must not change unless leadership explicitly applies a template update.

## Gallery Milestone Definition

Gallery completion is not the end of the whole job. A gallery milestone is complete when:

- Images are in a gallery for each student.
- Correct information is attached.
- The gallery is sent to families.
- The main school contact is notified.

This milestone may occur in the middle of a larger workflow.

## Follow-Up Work

- Validate Production Queue V1 language and actions with Spencer before expanding it.
- Add full staff assignment, workload visibility, and assignment history after queue-first handoffs are accepted.
- Build the Schools Outlook review queue with safe delegated calendar matching.
- Add plain-English if-then automation inventory UI after the workflow model is stable.
- Add delete/reorder/update endpoints for template steps if leadership needs true in-place draft editing.
- Add role escalation rules and delivery audit logs before replacing monday.com automations.
- Validate every monday.com board automation with Jessica before cutover.

## Do Not Promise Yet

- Full monday.com replacement.
- Full Production or Graphics operating system.
- Full staff assignment or workload balancing.
- Teams or Outlook workflow delivery.
- Scheduler, payroll, mileage, or automation completeness.
- Dedicated full ID Card workflow model.
