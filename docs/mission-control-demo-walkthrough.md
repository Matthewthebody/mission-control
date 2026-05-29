# Mission Control Demo Walkthrough

Use this flow for internal review after running:

```bash
npm run seed:mission-control-demo
```

The demo seed is development-only and uses demo-owned markers such as `mission_control_demo_v1`, `project_tracking_foundation`, and `client_command_center_v1`. Default demo views are intentionally curated so Jessica and Spencer can review the working path without noisy generated records.

## 1. Schools Dashboard

Say:

> This is the Schools team's daily view. It stays intentionally simple: active school jobs, what is due today, what is overdue, the next seven days of work, and the ID Card Tracker.

Show:

- Total Active School Jobs, Due Today, and Overdue.
- Jobs Due in the Next 7 Days.
- Lakeview Elementary Retake Day.
- ID Card Tracker.

Call out that this is not the global dashboard and not the workflow template editor. It is the Schools department view.

## 2. Live Job Workflow

Open Lakeview Elementary Retake Day.

Say:

> This is the live job workflow. This is where the team can see the current step, what is needed next, where the job is, and how it moves to Production and back.

Show:

- Job summary.
- Readiness state.
- Current department.
- Current step.
- Next action.
- Waiting For.
- Next deadline.
- Last updated.
- Recently completed step.
- Schools setup and prep steps.
- Production handoff and return.
- Family communication.
- ID/admin work.
- Closeout.
- Handoff history and recent audit events.

Honest caveat: readiness labels are derived from the live workflow state. Handoffs and queue-first claims are persisted in V1, but full staff assignment history and workload balancing are future work.

## 3. Production Queue V1

Say:

> This is Spencer's focused V1 Production queue. It only shows work sent to Production through a live workflow handoff.

Show:

- Ready for Production.
- Needs Assignment.
- Waiting on Info.
- Handoff-backed queue rows.
- Accept.
- Claim.
- Mark Missing Info.
- Mark Production Complete.
- Return to Schools.

Call out that Production Queue V1 is not the full Production operating system yet. It proves the durable Schools-to-Production-to-Schools loop.

## 4. Project Dashboard

Say:

> Project Dashboard is the company-wide overview. It helps leadership see where live work stands, but the actual progress updates happen inside the live job workflow.

Show:

- Curated project rows.
- Current Step.
- Next Deadline.
- Waiting On.
- Status.
- Queue intelligence: why the job surfaced, who owns the lane, next action, and what clears it.
- Open Job Workflow for linked workflows.
- Open Job Detail or Review in Schools for non-workflow rows.

Avoid presenting Project Dashboard as the primary work surface.

## 5. Workflow Template Builder

Say:

> Workflow Templates are recipes for how a type of job should work. Live Job Workflow is the running instance for one real job.

Show:

- Template picker.
- Duplicate template to edit.
- Original protected / Editing a copy language.
- Compact step list.
- Inline Add Step / Add Stage.
- Role or queue-style assignment settings.

Honest caveat: Workflow Template Builder V1 is a linear recipe editor. It is not a full visual automation builder.

### Tuesday workflow-recipe test path

Use this path when Jessica or Spencer is specifically reviewing template editability.

Show:

- Select a protected or published workflow template.
- Point to the Original protected / duplicate-before-edit language.
- Click Duplicate template to edit.
- Confirm the new copy shows Editing a copy and draft controls enabled.
- Edit one draft step name or owner/queue field inline.
- Move a draft step up and down.
- Remove one safe draft step.
- Try removing a step that another step depends on and call out the blocked dependency message.
- Confirm the protected original remains unchanged.

Ask Jessica:

- Does this feel like a workflow recipe you could safely adjust?
- Are the step fields and department/queue labels the right language?
- Does duplicate-before-edit make sense?
- What would make this easier than Monday.com without adding noise?

Ask Spencer:

- Does the queue/department language match how Production or Graphics thinks about work?
- Which steps should route into Production or Graphics?
- What handoff labels are missing or confusing?

## 6. Job Closeout

Say:

> Job Closeout captures post-job notes, issues, data quality, and follow-up after the work is done.

Show:

- Demo closeout.
- Notes or issue capture.
- Follow-up context.

Honest caveat: closeout reporting exists for review, but do not describe full scheduler or payroll automation as live unless separately verified.

## 7. Client Command Center

Say:

> Client Command Center keeps organizations, accounts, contacts, and client context together so the team does not have to hunt across systems.

Show:

- Realistic demo organizations.
- Accounts.
- Contacts.
- Relationship context.

Keep this short during the Jessica/Spencer demo unless they ask for client-data depth.

## Tuesday Department Queue Paths

### Jessica Schools path

Show:

- Open Project Dashboard.
- Open the Schools work queue.
- Point to Current Step, Step Team, Owner / Assignment, Waiting On, Risk / Blocker, Next Deadline, and Queue Intelligence.
- Use the lane reason text to explain why each row is in Schools.
- Use the queue intelligence text to explain what needs to happen next and what would clear the row.
- Open a job or workflow map from the row.

Ask:

- Can you tell what work is in Schools' lane?
- Can you tell what is waiting and what needs action?
- Is the next click obvious?

### Spencer Production / Graphics path

Show:

- Open Production Queue V1 and the relevant Production / Graphics queue surface.
- Point to rows routed by current step department and rows routed by assigned queue.
- Use the lane reason text to explain cross-lane routing, such as Schools work currently sitting in the Production queue.
- Use Queue Intelligence to explain the owner lane, next action, and clear condition.
- Open the job or workflow map from the row.

Ask:

- Can you tell why this job appears in Production or Graphics?
- Can you tell who owns the next move?
- Can you tell what clears the work from the lane?
- Are Waiting On, Risk / Blocker, and due-state labels useful enough for morning triage?

### Prep Readiness path

Show:

- Open Prep Readiness Queue.
- Point to Blocked, Needs Review, Ready, Missing Location, and Missing Prep Recipient filters.
- Point to the preview-only language: no email, SMS, automation, or outbound records are created here.
- Open a job or client record from the fix links.

Ask:

- Does this feel like a safe preflight queue?
- Are the missing-data reasons actionable?
- Which gaps should be fixed first before picture day?

## Matthew Review Path

Use this path before Jessica or Spencer sees the build:

- Open Project Dashboard and confirm it can be explained as the company-wide operating board in under 30 seconds.
- Open Workflow Template Builder and confirm protected templates, draft copies, edit controls, move controls, and remove guardrails are understandable.
- Open Schools Dashboard and confirm Jessica's curated path is still low-noise.
- Open Production Queue V1 and confirm Spencer's handoff-backed queue is still focused.
- Open Prep Readiness Queue and confirm the page reads as non-sending preflight work, not outreach automation.
- Open one workflow-backed job from Project Dashboard or Production Queue and confirm the destination makes sense.

Ask yourself:

- Can I explain what is real and what is V1 without apologizing?
- Can I tell what feedback I need from Jessica and Spencer?
- Are there any generated test records, placeholder labels, or stale local data rows that would distract from the demo?
- Is there any page that implies Teams, Outlook, SMS, payroll, scheduler, or automation is already live?

## What Not To Demo Yet

- Do not demo Teams, Outlook, Twilio, SMS sending, email sending, scheduler automation, payroll, mileage, or Zendesk as live Mission Control capabilities.
- Do not present Production Queue V1 as the full Production operating system.
- Do not present Prep Readiness Queue as sending, scheduling, or recording outbound messages.
- Do not present Workflow Template Builder as editing active live jobs directly.
- Do not demo a polluted local database if generated rows like `Command Layer Job...` or `Task Host Job...` appear in default paths.

## Known Rough Edges

- The remove-step flow uses a browser confirmation dialog. For Tuesday, Matthew should click through it deliberately and explain that the protected template and live workflows are not changed.
- Dependency-blocked remove is intentionally strict. If a step is required by another step, remove the dependency before deleting the step.
- Full staff assignment history, workload balancing, and detailed Production capacity planning are future work.
- If local test rows appear after release validation, reseed or use a clean demo database before browser demo. The committed code is validated, but stale local test data can make default queue paths noisy.

## 8. Compliance Workspace

Say:

> Compliance Workspace is a read-oriented leadership surface for operational gaps that need follow-up.

Show only if needed:

- Missing closeout or follow-through items.
- Missed check-in or attendance-related review.
- Data or QR issues.

Honest caveat: Compliance Workspace V1 is not a duplicate issue-tracking system.

## Honest Caveats

- Demo data is curated demo data, not production data.
- Schools Dashboard is intentionally low-noise and should not grow into a card wall.
- Production Queue V1 is handoff-backed and narrow, not the full Production operating system.
- Queue-first assignment is live for this V1; full staff assignment, workload balancing, and assignment history are future work.
- Teams, Outlook, scheduler, payroll, mileage, and automation features should not be promised as part of this handoff demo.
- ID Card Tracker is a dashboard-level tracker, not a complete dedicated ID card workflow model.
- monday.com may remain a safety net while Mission Control proves real workflow movement.
