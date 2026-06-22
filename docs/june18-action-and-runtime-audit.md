# June 18 — Cross-Surface Action & Runtime Audit (readable summary)

**Date:** 2026-06-22 · machine-readable companion: `docs/artifacts/june18-action-and-runtime-audit.json`

**Method.** Derived from the canonical action contract (`actionTargets.ts` `SOURCE_ROUTE` +
`resolveActionTarget`), the Company Command card configs, and the canonical read-model destinations
(Production, Schools Leadership). `verification` is **contract** (statically derived from the
resolver/config), **test** (an automated test covers it), or **live** (driven in the browser this
session). It is not a fresh exhaustive live click-through of every control. The key destination claims
are locked to the live resolver by `actionAuditContract.test.tsx`.

## Company Command

| Control | Data | Destination | State |
|---|---|---|---|
| On Fire | live (`/api/exceptions`) | `#urgent-window?status=open` | enabled |
| Shoots Today | **Sample** (badged) | `#schedule` | enabled |
| Staffing Risk | **Sample** (badged) | `#operations/staffing?area=staffing` | enabled |
| Late / Not Clocked In | **Sample** (badged) | `#employees/attendance` | enabled |
| Jobs Behind | live (`/api/jobs/status-counts`) | `#jobs?readinessStatus=off_track` | enabled |
| **Production Load** | live (`/api/production/operations` blocked) | `#production/operations?stage=blocked` | enabled |
| Weather | unavailable | — | **disabled (Not connected)** |
| Client Issues | unavailable | — | **disabled (Not connected)** |

The three **Sample**-badged cards never *look* live (visible "Sample" pill); wiring them to live
counts is a documented future enhancement, not a deterministic defect.

## Production · Schools Leadership/CSR · Date-change · Directory

- **Production**: metric chips open `#production/operations?stage=<status>` (server-computed counts,
  `displayed === filtered`); rows → quick-view → `#production?project=<id>`.
- **Schools Leadership / CSR**: every issue row carries its exact `source_id` and an
  `exact_destination_hash`; unavailable categories return `{available:false, count:null, reason}`.
- **Shoot date-change**: lifecycle actions are in-panel (POST to the date-change routes); approve/
  decline are leadership-gated server-side.
- **Directory**: Organizations/Contacts/Locations rows open `#directory/<entity>/<id>`.

## Deterministic defects found & fixed (this program)

1. **Production Load** counted blocked *jobs* and routed to `#jobs` (predicate mismatch) → now sources
   the canonical Production `blocked` metric and opens `#production/operations?stage=blocked`
   (**`0f683ff`**).
2. **Weather Impact** panel rendered a demo forecast **count badge** → now an honest
   "Weather provider not connected" state with no count/rows/CTA (**`66a275f`**).

**Dead enabled controls: 0** (unavailable targets resolve to a non-interactive "Not connected" card).
**Unavailable sources shown as zero/live: 0.**

## Runtime

- One recurring console warning: a **pre-existing** duplicate React key ("Trade Replacement
  Photographer") on the Schools photographer-trade list — outside June 18 scope, not introduced here.
- Test-state leak fixed: a `window.location.hash` leak from the Production view test (**`e6c9cb5`**).
- No surface falls back to demo data after an API error (honest error/unavailable states throughout).
