# Phase 1 Execution Plan

## Phase 1 Goal

Make this app the daily operating system for Kemmetmueller.

Phase 1 is successful when:

- leadership opens one dashboard to understand operational pressure
- managers run assignment, attendance, follow-through, and production from one system
- employees use the app by default for their day-of work and accountability
- tribal knowledge is moved into visible workflow state

## Strategy

Build around two anchors only:

1. role-based dashboard
2. assignment-to-completion workflow

Everything else must clearly support one of those anchors.

## Top Implementation Priorities

1. Normalize the dashboard into a true role-based front door.
2. Unify assignment-to-completion into one explicit workflow contract.
3. Make mileage and follow-through first-class in the employee and manager flow.
4. Consolidate People Ops review work into one clearer workspace model.
5. Make Production the default post-shoot digital follow-through system.
6. Tighten cross-linking between Home, Operations, People Ops, Directory, and Production.
7. Use Profitability as a leadership watch workspace, not a data island.

## First Build Batch

### Batch 1: Dashboard and workflow normalization

Goal:

- strengthen the two anchors without broad new scope

Includes:

- dashboard role specification and payload normalization
- employee dashboard and My Work parity improvements
- manager dashboard follow-through lanes
- clearer workflow state language from assignment to production handoff
- cross-surface drill-in cleanup

## Second Build Batch

### Batch 2: Assignment-day accountability

Goal:

- remove friction from schedule, lateness, attendance, mileage, and end-of-day follow-through

Includes:

- mileage workflow unification
- late-arrival and missing-punch clarity
- end-of-day confirmation hardening
- exception review consolidation
- people-ops lane model across attendance, payroll, compliance, labor

## Third Build Batch

### Batch 3: Production and leadership visibility

Goal:

- make post-shoot production the default visible follow-through system

Includes:

- production auto-coverage rules
- reviewer and QA workload
- release visibility
- profitability-to-production linkage
- leadership bottleneck visibility

## What Should Not Be Built Yet

- external client portals
- white-label abstraction work
- generic company-wide PM tooling
- generic CRM expansion
- deep profitability math without reliable source data
- large-scale route rewrites
- full communications replacement for email or Zendesk

## Technical Dependencies

### Already in place

- role-aware shell
- employee day-of workflow
- schedule and staffing APIs
- attendance and exception APIs
- production board and trigger model
- directory and import workflow
- profitability workspace
- Outlook and Zendesk integration paths

### Needed for stronger phase 1 execution

- clearer shared dashboard contract by role
- cleaner workflow state mapping across schedule, attendance, and production
- better People Ops consolidation model
- explicit source-of-truth documentation for Outlook, Captura, Zendesk, and this app

## Product Risks

1. Too many routes may continue to dilute the operating-system story.
2. Mileage may remain a side feature unless it is pulled into My Work and manager review intentionally.
3. Employees may still think of the app as "for managers" unless My Work becomes strong enough.
4. Production may regress into a catch-all bucket unless trigger rules stay shoot-centered.
5. Profitability may overpromise if deeper source data is not populated.
6. Permission complexity may slow rollout unless translated into plain product roles.
7. Communication and change visibility may still feel fragmented without a clear follow-through layer.

## Unresolved Decisions

These require leadership direction before deeper implementation.

## Top 10 Manual Decisions Still Needed From Leadership

1. What exact user populations should land on `Home` versus `My Work` by default?
2. Is every completed shoot expected to create at least one production record, or only certain shoot types?
3. What is the authoritative business rule for mileage submission: same-day required, post-shoot optional, or payroll-period batch acceptable?
4. Which attendance exceptions can senior photographers approve in shoot-lead scope versus manager scope?
5. Should customer service pressure appear on all manager dashboards or only on leadership and CS roles?
6. Which People Ops data should be visible to non-leadership managers by default?
7. What exact definition of "late" should trigger operational watch and escalation?
8. What operational events must always generate follow-through: issue flags, remakes, no-show risk, customer complaints, production delays, all of the above?
9. Which external systems remain authoritative in phase 1: Captura for commerce, Outlook for interoperability, Zendesk for tickets, this app for operations?
10. What release-signoff standard should exist for digital production: peer review only, peer plus final QC, or department-specific rules?

## Ticket-Ready Task List

### 1. Role-based dashboard contract normalization

Anchor:

- dashboard

Acceptance criteria:

- backend can return a role-aware dashboard payload shape for leadership, manager, and employee modes
- frontend renders role-specific sections without dead modules
- every above-the-fold card has a drill-in destination

### 2. Employee dashboard strengthening

Anchor:

- dashboard
- assignment-to-completion

Acceptance criteria:

- `My Work` clearly shows next assignment, location, timing, primary action, notes, and unresolved follow-through
- employee can reach late, missed punch, and post-shoot actions without hunting
- notifications do not crowd primary assignment clarity

### 3. Assignment-day workflow copy and state alignment

Anchor:

- assignment-to-completion

Acceptance criteria:

- assignment, attendance, and production states use consistent plain-language labels
- managers and employees see the same lifecycle expressed coherently
- state drift between schedule, attendance, and production is documented and reduced

### 4. Mileage workflow unification

Anchor:

- assignment-to-completion

Acceptance criteria:

- employee sees mileage intent and submission as part of end-of-day workflow
- manager review still happens in People Ops
- duplicate or conflicting mileage flows are reduced

### 5. People Ops workspace consolidation pass

Anchor:

- dashboard
- assignment-to-completion

Acceptance criteria:

- Attendance, Labor, Payroll Review, and Compliance share one lane model and common entry points
- managers can move between exception review, mileage review, and payroll/compliance without route hunting
- no existing review capability regresses

### 6. Manager follow-through lane model

Anchor:

- dashboard

Acceptance criteria:

- Home or cockpit exposes explicit lanes for staffing gaps, attendance issues, approvals, and production follow-through
- lane counts are backend-authored
- lane drill-ins preserve context

### 7. Universal shoot-to-production rule audit

Anchor:

- assignment-to-completion

Acceptance criteria:

- every production trigger path is documented
- missing shoot types or transition gaps are identified
- leadership gets a clear rule for which shoots must generate production visibility

### 8. Production reviewer workload pass

Anchor:

- dashboard
- assignment-to-completion

Acceptance criteria:

- reviewer and QA workloads are visible on Home and Production
- production owners can see what is waiting on whom
- blocked or change-requested work is obvious and actionable

### 9. Follow-through signal consolidation

Anchor:

- dashboard

Acceptance criteria:

- alerts, approvals, attendance issues, and production follow-through feed into clearer priority lanes
- users can answer "what changed" and "what still needs follow-through" faster than today

### 10. Source-of-truth integration policy

Anchor:

- dashboard
- assignment-to-completion

Acceptance criteria:

- written source-of-truth policy exists for Captura, Outlook, Zendesk, and this app
- route and UI copy reflect the correct system ownership
- duplicate operational entry points are called out for cleanup

## Suggested Batch Mapping

### Batch 1

- Task 1
- Task 2
- Task 3
- Task 6

### Batch 2

- Task 4
- Task 5
- Task 9

### Batch 3

- Task 7
- Task 8
- Task 10

## Tradeoffs

- This plan favors consolidation over shiny net-new modules.
- It assumes route simplification can be achieved through copy, lanes, and drill-ins before any router rewrite.
- It keeps Captura, Outlook, and Zendesk in the picture where they are already real, instead of pretending phase 1 can replace them.

## MISSING CONTEXT NEEDED FOR NEXT PASS

- exact leadership escalation rules for late arrivals, no-shows, and attendance misses
- mileage reimbursement policy details by role and vehicle type
- which shoot types always require production and which can stay minimal
- whether production release requires formal signoff by department
- expected staffing publish SLA and employee acknowledgment expectations
- exact ownership boundaries between operations managers, production leads, and customer service
- expected profitability KPIs once import data is populated
