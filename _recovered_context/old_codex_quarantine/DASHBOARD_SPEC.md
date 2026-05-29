# Dashboard Spec

## Product Position

The dashboard is the most important screen in the product.

It is the front door to the operating system and must answer:

- what matters right now
- what I own
- where I need to be
- what changed
- what is late
- what needs follow-through

## Dashboard Design Principles

- role-aware by default
- above-the-fold clarity over breadth
- compact cards first, expandable detail second
- live enough to trust for operations
- direct drill-in into the exact next workspace
- no giant wall of open modules

## Dashboard Modes

### 1. Leadership Dashboard

Primary purpose:

- understand operational pressure
- see risk before it becomes a surprise
- move from signal to the owning workspace quickly

Above-the-fold order:

1. urgent watch
2. what's happening today
3. attendance awareness
4. staffing and follow-through summary
5. production snapshot
6. manager cockpit summary

Expandable lower sections:

- customer service pressure
- places needing attention
- profitability watch
- business context and week pressure

### 2. Manager Dashboard

Primary purpose:

- run today's operation
- resolve staffing and attendance issues
- keep follow-through moving

Above-the-fold order:

1. my team's day
2. needs staffing
3. assigned-but-missing and lateness
4. open approvals and exceptions
5. production follow-through
6. customer or account issues that affect execution

Expandable lower sections:

- week schedule pressure
- payroll and compliance review
- location and account follow-up

### 3. Employee Dashboard

Primary purpose:

- know today's assignment
- know where to go and when
- complete required day-of actions without confusion

Above-the-fold order:

1. today's next assignment
2. arrival time and location
3. primary action button
4. notes to review
5. late, attendance, trade, and PTO state
6. post-shoot follow-through still open

Expandable lower sections:

- upcoming shifts
- notifications
- resource links
- previous unresolved follow-ups

## Recommended Dashboard Information Hierarchy

### Tier 1: Action now

Must be visible immediately:

- urgent watch
- next shift or assignment
- lateness and attendance exceptions
- missing staffing
- overdue production work

### Tier 2: Execute today

- today's shoots and schedule
- where people are
- approvals and follow-up queues
- reviewer and production pressure

### Tier 3: Understand the week

- week volume
- upcoming risk
- backlog and burden
- business-health watch items

## Compact Vs Expandable Decisions

### Compact by default

- business pulse summaries
- week-at-a-glance
- customer service summaries
- profitability watch summaries
- low-urgency heads-up bands

### Expanded by default when urgent

- overdue watch items
- assigned-but-missing attendance
- staffing gaps for today
- overdue production and review queues
- open exceptions blocking payroll or compliance

## Alert And Status Hierarchy

### Severity order

1. action needed now
2. due today or overdue
3. heads up
4. informational or healthy

### Rules

- do not rely on color alone
- every urgent item needs explicit wording
- every urgent item needs a direct action path
- low-urgency items should stay compact and calm

## Core Dashboard Modules

| Module | Audience | Purpose | Default behavior |
| --- | --- | --- | --- |
| Urgent Watch | leadership, managers | urgent items in next 24h and overdue | expanded when urgent |
| Today / What's Happening Today | all | same-day execution context | always prominent |
| Attendance Awareness | leadership, managers | missing, office, field, unresolved end-of-day states | high on page |
| My Work Summary | employees | personal day-of clarity | dominant for employee view |
| Staffing Command Summary | managers | missing assignments, lead gaps, conflicts | visible above fold |
| Production Snapshot | leadership, managers, production leads | unassigned, in production, overdue, review, release | compact cards with drill-in |
| Approvals / Exceptions | managers | approvals blocking execution or payroll | queue preview |
| Customer Service Pulse | leadership, managers, customer service | ticket pressure affecting ops | supporting section |
| Profitability Watch | leadership | business-health pressure tied to real operations | supporting section |

## Operational Behaviors Required

- all dashboard cards must deep-link into a filtered owning workspace
- dashboard should reflect live changes from schedule, attendance, and notification events
- the dashboard should remember appropriate hash and filter context during drill-in
- empty states should be meaningful, not generic

## Dashboard Data Contract Direction

The backend should remain the source of truth for:

- urgency classification
- priority and tone
- queue counts
- owner workload pressure
- next action labels
- action hashes

Do not move operational meaning into fragile client-only derivation.

## Daily Usefulness Test

The dashboard is operationally useful every day when:

- a leader can open it and understand risk in under 30 seconds
- a manager can move from signal to exact resolution queue without hunting
- an employee can use it to complete the day without switching apps for basic schedule and accountability work
