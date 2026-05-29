# Profitability Intelligence Phase 0 Handoff

## Scope

This pass implements `Phase 0: Architecture and contracts` for `Profitability Intelligence` as a bounded domain inside Mission Control.

Implemented in this phase:

- canonical profitability dictionary
- source-of-truth matrix
- identity and linkage rules
- permissions matrix
- recalculation trigger map
- schema proposal
- protected API surface proposal
- worker job contract types
- leadership-only contract endpoint
- architecture decision record

Not implemented in this phase:

- production profitability calculations
- import execution pipeline
- snapshot rebuild worker runtime
- leadership dashboard UI
- employee-safe dashboard UI
- profitability database tables and migrations
- override UX

## Architecture Choice

`Profitability Intelligence` is a bounded domain inside Mission Control, not a separate application.

Why:

- profitability depends on `Shoot`, staffing, time, `Post-Shoot Evaluation`, issues, remakes, and recurring operational history
- a separate app would duplicate auth, permissions, joins, and identity mapping
- the employee-safe visibility boundary is easier to enforce inside the current product shell and RBAC system

Primary reference:

- [ADR-2026-03-27-profitability-intelligence-domain.md](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\docs\architecture\ADR-2026-03-27-profitability-intelligence-domain.md)

## Files Added Or Updated

### Contracts And Types

- [profitability-phase0-contract.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\domain\profitability\profitability-phase0-contract.ts)
- [profitability-contract.registry.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\domain\profitability\profitability-contract.registry.ts)
- [profitability-snapshot.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\domain\profitability\profitability-snapshot.ts)
- [profitability-projection.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\domain\profitability\profitability-projection.ts)
- [index.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\domain\profitability\index.ts)
- [profitability.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\types\profitability.ts)
- [profitabilityContracts.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\profitabilityContracts.ts)
- [profitabilityJobContracts.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\worker\src\jobs\profitabilityJobContracts.ts)

### API And Permissions

- [profitability.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\profitability.ts)
- [app.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts)
- [auth.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\types\auth.ts)
- [authority.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\authz\authority.ts)

### Documentation

- [ADR-2026-03-27-profitability-intelligence-domain.md](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\docs\architecture\ADR-2026-03-27-profitability-intelligence-domain.md)
- [profitability-dictionary.md](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\docs\profitability-dictionary.md)

### Validation

- [profitabilityPhase0Contracts.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\profitabilityPhase0Contracts.test.ts)

## Source-Of-Truth Matrix

Operational source of truth:

- `Shoot`
- staffing and assignments
- employee identity and authority
- `Time Session`, `Time Segment`, `Clock Event`, `Exception Request`, `Approval Record`
- `Post-Shoot Evaluation`
- `Resource Library`
- compliance flags

Imported source of truth:

- revenue summaries
- lab costs
- shipping costs
- support burden summaries
- specialty/yearbook feeds

Derived profitability output:

- profitability snapshots
- coaching flags
- recommendation flags
- dashboard metric snapshots

Guardrail:

- profitability consumes upstream truth and produces versioned derived outputs
- profitability does not mutate upstream operational records

## Canonical Identity Rules

Locked Phase 0 identities:

- `job_id` -> `Shoot.id`
- `account_id` -> `Organization.id`
- `staff_id` -> `app_user.id`
- `location_id` -> `shoot_location.id`
- `season_id` -> derived profitability dimension
- `division_id` -> derived profitability dimension

Mapping rules:

- imported revenue and expense lines require explicit mapping
- no fuzzy job-name matching in Phase 1
- remake and reshoot costs must link back to the original `Shoot`
- district-level overhead splits must come from versioned allocation rules

## Permissions Matrix

Leadership-facing access:

- `profitability_leadership.view`
- `profitability_imports.*` for leadership and directors

Current behavior:

- leadership and admin-facing roles can read the Phase 0 contract route
- photographers and standard field users are blocked
- employee-safe profitability permissions are defined in the model but not granted for release yet

Why this matters:

- Phase 0 explicitly prevents premature employee rollout before math trust exists

## Calculation Lifecycle And Snapshot Strategy

Phase 0 contracts lock these lifecycle rules:

- all calculations are versioned
- snapshots are versioned separately from raw source tables
- stale snapshots are marked when source events change
- recalculation supports job, account, season, division, staff, date-range, and full rebuild scopes
- overrides must be logged and must preserve prior snapshot versions

Recalculation triggers defined in code:

- revenue import completed
- expense import completed
- approved time records changed
- staffing or assignment changed
- `Post-Shoot Evaluation` changed
- issue or remake linkage changed
- allocation rule changed
- override entered or restated

## Schema Proposal

Proposed Phase 1 tables captured in code:

- `profitability_calculation_version`
- `profitability_import_run`
- `profitability_import_validation_issue`
- `profitability_revenue_entry`
- `profitability_expense_entry`
- `profitability_source_mapping`
- `profitability_allocation_rule`
- `profitability_allocation_run`
- `profitability_snapshot`
- `profitability_override`
- `profitability_coaching_flag`
- `profitability_recommendation_flag`
- `profitability_dashboard_metric_snapshot`

Phase 1 schema skeleton now exists in:

- [051_profitability_intelligence_phase1.sql](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\db\migrations\051_profitability_intelligence_phase1.sql)

Important rule:

- raw imported values remain separate from calculated values
- historical snapshots are not overwritten without versioning and audit logging

## API Surface Proposal

Currently implemented:

- `GET /api/profitability/contracts`

Planned protected route groups:

- `/api/profitability/leadership`
- `/api/profitability/admin`
- `/api/profitability/employee`

Rules:

- front-end clients do not read raw profitability tables directly
- leadership/admin projections may contain dollars
- employee-safe projections may not contain dollars, labor rates, or margins

## Audit And Observability Plan

Required audit events:

- import run created/applied
- validation issue created
- override created/reverted
- snapshot rebuilt
- permission denied
- recommendation refreshed
- coaching flag refreshed

Required operational metrics:

- import error counts
- reconciliation mismatch counts
- stale snapshot counts
- override counts
- projection latency

Traceability expectation:

- any dashboard number must be traceable back to snapshot version, calculation version, and source inputs

## Rollout Plan

1. Admin validation
2. Limited leadership pilot
3. Department-head expansion
4. Employee-safe pilot
5. Broader employee release

Hard rule:

- no employee-facing profitability release before leadership trusts the math

## Backfill Plan

Initial recommended window:

- last 3 to 6 months of completed `Shoot`s, approved time data, and imported revenue/cost feeds

Sequence:

1. backfill mapping tables
2. backfill raw imports
3. run direct-cost and allocation rebuild
4. validate example jobs with leadership before wider rollout

## Current Route

Leadership-only contract endpoint:

- [profitability.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\profitability.ts)

This endpoint exists to make the Phase 0 contract inspectable and testable inside the repo instead of leaving architecture only in markdown.

## Known Limitations

- No profitability engine yet
- No import runner yet
- No profitability worker execution yet
- No leadership or employee projection endpoints yet beyond the contract route
- No UI dashboard yet
- No employee-safe projection endpoint yet

That is intentional. Phase 0 is about preventing ambiguous boundaries before the engine work starts.

## Recommended Next Step

Move to `Phase 1: Core engine, admin only`.

Do not build broad UI first.

Build next:

- profitability schema migration
- immutable import-run tables
- source mapping tables
- versioned snapshot tables
- direct-cost aggregation
- allocation rule execution
- admin-only inspection endpoints
- historical backfill for a narrow pilot window
