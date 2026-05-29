## Next Best Batch

The strongest next batch is a manager-review and workflow-exception pass that builds directly on this implementation.

Priority order:

1. manager closeout review and mileage review actions
2. exact filtered drill-ins from dashboard workflow cards
3. stronger handoff visibility from field completion into downstream production or support work
4. tighter schedule-day unification between calendar, `My Work`, and attendance risk
5. targeted bundle reduction on large admin-web surfaces

## Recommended Implementation Batch

### 1. Manager review actions where the pressure is visible

Build:

- direct dashboard drill-in to unresolved compliance records
- direct dashboard drill-in to payroll and mileage review
- quick approve / send-back actions where the existing review workspace safely supports it

Why this is next:

- this batch made the risk visible
- the next batch should shorten the time from visibility to action

### 2. Exact workflow drill-ins

Tighten the dashboard and employee workflow navigation so cards open the exact filtered slice of work:

- attendance exceptions
- missing closeout
- mileage review
- late arrivals
- unresolved follow-through

Acceptance target:

- a manager can click any workflow summary card and land on the owning queue with the right filter already applied

### 3. Handoff modeling after shift completion

Improve how the app shows what happens after a shift is closed:

- no further action
- manager follow-up
- customer service follow-up
- production follow-up

Why:

- the current closeout UI supports escalation signals, but the next handoff is still more implicit than it should be

### 4. Unified schedule-day view

Consolidate the user’s day across:

- `My Work`
- schedule/calendar
- attendance state
- drive/mileage expectations

Goal:

- reduce switching between calendar and work views for day-of execution

### 5. Bundle and route hardening

The main admin-web bundle is still large.

Safest next candidates for targeted chunking:

- `Dashboard`
- `My Work`
- scheduling sub-surfaces tied to heavy operational detail

## Unresolved Product Decisions

These decisions will improve future implementation quality and should be explicitly settled:

1. What is the canonical “follow-through owner” model after a field shift closes?
2. Which roles can approve mileage directly versus only review/escalate it?
3. Should late-arrival review live primarily in attendance/compliance or in scheduling/day-of operations?
4. What is the minimum required closeout for every completed shift?
5. Which downstream handoff categories are official in phase 1?

## Technical Debt Worth Addressing Next

1. The admin-web main bundle remains large.
2. Several workflow drill-ins still depend on broad hash routes rather than exact filter/state preservation.
3. Some operational wording is improved, but there is still room to standardize workflow labels across Dashboard, My Work, Compliance, and Payroll Review.
4. The employee day model is stronger, but it is still assembled from multiple service projections rather than one more explicit assignment timeline model.

## What Should Not Be Built Next

Avoid spending the next batch on:

- white-label abstractions
- external client portals
- broad analytics redesign
- real-time chat
- speculative workflow engines
- broad visual redesign unrelated to workflow clarity

## Success Criteria For The Next Batch

The next batch is successful if:

- managers can act on closeout, lateness, and mileage pressure faster
- follow-through ownership is clearer
- employees can understand their day with less app-switching
- the same workflow language appears consistently across employee and leadership views
