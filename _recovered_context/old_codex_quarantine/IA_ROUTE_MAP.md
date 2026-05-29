# IA Route Map

## IA Direction

The route map should become simpler in product meaning, even if the code keeps several existing screens during transition.

Principle:

- keep fewer, stronger top-level anchors
- let detail work happen inside focused drill-ins, drawers, and lane views
- collapse fragmented leadership review pages into a clearer operating model over time

## Current Top-Level Shell Reality

Current app shell sections:

- `Home`
- `Operations`
- `Directory`
- `Assets`
- `People Ops`
- `Business Health`
- `Admin`

Current high-signal pages:

- Dashboard
- My Work
- Scheduling
- Live Shoots
- Production
- Alerts
- Approvals
- Customer Service
- Organizations
- Contacts
- Locations
- Attendance
- Labor
- Payroll Review
- Compliance
- Profitability
- Reports
- Sales Pipeline

## Recommended Top-Level Navigation

### 1. Home

Purpose:

- role-based front door
- "what matters now"
- personal and operational priorities

Keep:

- `Dashboard`
- `My Work`

### 2. Operations

Purpose:

- plan, assign, run, and follow through on operational work

Keep or strengthen:

- `Scheduling`
- `Live Shoots`
- `Production`
- `Alerts`
- `Approvals`
- `Customer Service`

Recommended product rule:

- this is the most important leadership and manager workspace after Home

### 3. Directory

Purpose:

- relationship context, contacts, locations, agreements, touchpoints, import, duplicate review

Keep:

- `Organizations`
- `Contacts`
- `Locations`

### 4. People Ops

Purpose:

- attendance, payroll review, compliance, mileage, labor review

Current routes:

- `Attendance`
- `Labor`
- `Payroll Review`
- `Compliance`

Recommendation:

- keep current routes short term
- move toward one `People Ops` workspace with lane drill-ins

### 5. Business Health

Purpose:

- leadership visibility into business condition and commercial risk

Keep:

- `Profitability`
- `Reports`
- `Sales Pipeline`

Recommendation:

- `Profitability` is the visible anchor
- `Reports` and `Sales` support that area, not the other way around

### 6. Assets

Keep:

- `Gear`

### 7. Admin

Keep:

- `Outlook Integration`
- `Access Control`
- `Security Center`
- `My Account`

## Recommended Navigation By User Type

| User type | Default landing | Primary routes | Secondary routes |
| --- | --- | --- | --- |
| Leadership | Dashboard | Home, Operations, Business Health, Directory | People Ops, Reports, Security |
| Operations managers | Dashboard | Home, Operations, Directory, People Ops | Business Health |
| Production leads | Dashboard or Production | Home, Operations > Production, Live Shoots, Directory | People Ops |
| Customer service | Dashboard | Home, Operations > Customer Service, Directory | Business Health |
| Sales / client success | Dashboard | Home, Sales Pipeline, Directory, Scheduling | Reports |
| Photographers / field staff | My Work | My Work, My Schedule, My Follow-Ups, My Account | limited detail drill-ins |
| Graphic artists / production staff | Home or Production | Home, Production, Directory | My Work if shift-based |

## Where Core Functions Live

| Function | Primary home | Supporting detail |
| --- | --- | --- |
| Scheduling and staffing | `Operations > Scheduling` | Live Shoots, staffing drawers, Outlook integrity |
| Attendance and lateness | `People Ops` with employee actions in `My Work` | Attendance review, compliance review, approvals |
| Mileage | employee wrap flow in `My Work`, manager review in `People Ops` | payroll and reimbursement review |
| Production tracking | `Operations > Production` | Home production snapshot, manager cockpit, linked shoot drill-ins |
| Communication and follow-through | `Home` and queue lanes first, `Directory` and `Customer Service` second | touchpoints, alerts, approvals, customer-service detail |

## What Belongs On Dashboard Vs Detail Screens

### Dashboard should contain

- urgent watch
- today's schedule and staffing pressure
- personal assigned work
- attendance and lateness exceptions that need action
- production snapshot and reviewer pressure
- approvals and follow-up queues
- customer-service or account pressure when operationally relevant

Dashboard should not contain:

- large editable forms
- full tabular history
- deep audit detail
- every queue expanded by default

### Detail screens should contain

- full record context
- mutation actions
- history and notes
- review and approval detail
- linked objects
- exception resolution tools

## Recommended Route Consolidation

### Short-term keep-as-is, but treat as one product area

People Ops currently spans:

- `#time`
- `#labor`
- `#payroll`
- `#compliance`

Recommendation:

- keep routes for now
- define one shared `People Ops` workspace model
- use one shared lane strip and dashboard entry point

### Short-term keep-as-is, but align copy and drill-in

Operations currently spans:

- `#calendar`
- `#shoots`
- `#production`
- `#alerts`
- `#approvals`
- `#customer-service`

Recommendation:

- keep routes
- tighten cross-linking so these feel like one operating surface

## Recommended Dashboard-to-Detail Drill-In Rules

- Dashboard cards should deep-link into filtered operational queues, not generic landing pages.
- Employee dashboard actions should open the exact shift detail or exception action.
- Production drill-ins should preserve queue, stage, due-state, and record context.
- Profitability watch items should deep-link into the owning shoot, production, or review surface.
- Directory should open person, location, or organization detail directly from operational context.

## Employee-Only Route Map

Current employee-only shell is directionally correct:

- `My Work`
- `My Schedule`
- `My Follow-Ups`
- `My Account`

Recommendation:

- preserve this narrow shell
- make `My Work` the real dashboard for employees
- add mileage, lateness, attendance, and follow-through summary there instead of sending employees into manager-first pages

## Route Sprawl Reduction Priorities

1. Home and My Work become the two primary entry points.
2. Operations becomes the default manager workspace after Home.
3. People Ops becomes one product area, even if it keeps multiple routes initially.
4. Business Health remains leadership-focused and should stay smaller and cleaner than Operations.
5. Avoid creating new top-level areas unless they directly reinforce dashboard or assignment-to-completion.
