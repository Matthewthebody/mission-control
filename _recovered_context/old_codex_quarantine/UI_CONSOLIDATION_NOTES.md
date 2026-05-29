## Reused Patterns

### `OperationalDetailSection`

Extended and reused as the main progressive-disclosure primitive.

Added:

- compact variant
- optional badge
- cleaner disclosure controls

Why:

- the repo already had a good detail/disclosure primitive
- strengthening one disclosure pattern was safer than inventing several new accordion variants

### `OperationalPreviewCard`

Extended with a compact density variant and reused for dashboard workflow and manager queue items.

Why:

- preview cards were already the right direction for operational scanning
- the main problem was oversized treatment, not the concept itself

## New Shared UI Variants

### Compact panel / summary treatment

Used on:

- dashboard workflow surface
- manager cockpit surface
- secondary dashboard queues

Behavior:

- shorter intros
- tighter padding
- smaller metric cards
- less visual competition with the primary Home pulse

### Employee workflow tabs

Used in:

- `EmployeeShiftDetailPanel`

Tabs:

- `Execute`
- `Closeout`
- `Exceptions`

Why:

- this screen had too many always-open sections
- the assignment-to-completion workflow already grouped naturally into these modes

## Route Consolidation Decisions

### Kept stable

- no new top-level routes
- no router rewrite
- no hash migration

### Consolidated in place

- employee detail complexity was consolidated into tabs rather than separate pages
- dashboard secondary queues were consolidated into a lower-priority section instead of being given more route weight
- employee notifications were consolidated into a subordinate disclosure area

## Screens Still Needing Cleanup Next

### 1. Scheduling

Why next:

- still carries a lot of surface area
- has strong functional value but more visual density than the cleaned dashboard/employee views

### 2. Live Shoots

Why next:

- queue structure is strong
- card density and drill-in rhythm can still be tightened further

### 3. Production

Why next:

- workflow meaning is much better now
- filters and section hierarchy can still be compressed into a calmer control-tower feel

### 4. Directory workspace detail

Why next:

- the data-ops direction is strong
- some detail states still have more simultaneous open content than they need

## Architectural Notes

- this pass preferred refactoring existing primitives over inventing a parallel component library
- the cleanup improves consistency by using fewer patterns more deliberately
- the dashboard and employee workflow now share more visual logic even though their roles are different
