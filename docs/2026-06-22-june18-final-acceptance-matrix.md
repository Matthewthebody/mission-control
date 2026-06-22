# June 18 Feedback — Final Acceptance Matrix

**Date:** 2026-06-22
**Method:** Recording-by-recording acceptance audit. Status reflects **verified evidence** (tests,
commits, live-browser checks performed this session), not prior implementation reports. Where a
behavior was not independently re-verified in the running app during this audit, it is marked
**Partial — needs live re-verify** rather than asserted complete.

**Status legend:** Verified Complete · Partial · Missing · Intentionally Unavailable · Superseded by
canonical design.

---

## Company Command / Urgent Window

| Requirement | Status | Evidence | Required correction |
|---|---|---|---|
| On Fire count is live (no demo count as live) | Partial — needs live re-verify | `homeDashboard.ts` business-pulse tiles derive from canonical shoot rows | Re-verify each tile count equals its filtered list in the running app |
| Exact issue navigation (no dead control) | Partial | `homeDashboard` items carry destinations | Cross-surface action audit (Part 6) — not completed this bundle |
| Attendance | Partial — needs live re-verify | `kind:"attendance"` in homeDashboard items | live check pending |
| Staffing | Partial | staffing reqs (`shoot_staffing_requirement`) exist | see Staffing rows |
| Jobs/workflow | Verified Complete (canonical) | jobs canonical index + `school_work_item` | `afb3f54` read model surfaces workflow blockers |
| Production | Partial / Missing | `production_project` exists; dense operating surface not built this bundle | Part 2 (not completed) |
| Client issues | **Intentionally Unavailable** | No canonical client-case source (grep: no `client_case`/`communication_case` service) | Show "Not Connected", disable CTA (Part 3 — pending) |
| Weather | **Intentionally Unavailable** | `buildWeatherTravelItems` emits only `kind:"travel"` heuristics; **no weather provider/API** | "Weather provider not connected", no fake forecast (Part 4 — pending) |
| No enabled dead control | Partial | — | Part 6 cross-surface audit pending |

---

## Staffing

| Requirement | Status | Evidence |
|---|---|---|
| Named assignments | Partial — needs live re-verify | `shoot_assignment` table |
| Lead coverage | Partial | `shoot_staffing_requirement.lead_required` |
| Published lifecycle | Partial | staffing requirements created at publish (`centralJobIntake`) |
| Acknowledgment / decline | **Missing / Intentionally Unavailable** | No canonical ack/decline column (Phase 6A audit §10) — read model marks `declined_replacement_staffing` unavailable |
| Reminder | Missing | no canonical reminder lifecycle found |
| Capacity Day/Week/Month | Partial — needs live re-verify | capacity surface exists |
| Duplicate Leadership labels / duplicate Close removed; Back to Company Command; exact drawer links | Partial — needs live re-verify | UI-polish items; not re-verified this bundle |

---

## Jobs

| Requirement | Status | Evidence |
|---|---|---|
| Compact index / canonical summaries / current-work default | Verified Complete (canonical) | `jobsCanonicalIndex.ts` |
| Demo archival | Partial | — |
| Quick-view drawer / exact attention focus / no fake Shoot data | Partial — needs live re-verify | canonical index drives quick-view |
| Direct off-page selection / full-detail readability | Partial — needs live re-verify | — |

---

## Directory  — **Verified Complete this session** (closure `cdddbb8`)

| Requirement | Status | Evidence (commit / test) |
|---|---|---|
| First-class Organizations/Contacts/Locations + full routes | Verified Complete | `directoryRecordRoutes` (8 tests), full-page routes |
| Reusable Contact roles | Verified Complete | Contact identity closure `c8c6e42`; `canonicalContacts` 23 tests |
| Atomic Organization creation | Verified Complete | `eaf3e3c`; `organizationAtomicCreate` 22 tests; **browser-proven** (one atomic POST) |
| Website normalization | Verified Complete | `normalizeWebsite` + atomic test `(19/20)` |
| Logo history | Verified Complete | `organization_logo_history`; atomic test `(21/22)` |
| District→School hierarchy | Verified Complete | `validateOrganizationParent`; atomic tests `(2)–(5)` |
| Service terms | Verified Complete | `school_service_term`; `schoolServiceTerm` suite |
| Job Intake cascade | Verified Complete | `jobIntakeQuickCreate` (14 tests); Phase 4.2 closure |
| Dated commitment history | Verified Complete | migration 163 `dated_commitment` (versioned, write-once); `centralJobIntake` snapshot test |

---

## Team Schedule

| Requirement | Status |
|---|---|
| My Schedule vs Team Schedule; 7-day/weekend; day/week/month; Jump to Date; My Shifts/All Staff; department/person/location filters; exact Job/staffing links; scheduled-capacity semantics | Partial — needs live re-verify (schedule surfaces exist; not re-verified this bundle) |

---

## Production

| Requirement | Status |
|---|---|
| Compact dense queue; exact Production Load destination; live workflow step; waiting/review/delivery stages; blockers; missing inputs; promised delivery; next action; quick preview; exact links | **Partial / Missing** — `production_project` + `production_project_task` are canonical sources, but the dense actionable operating surface specified in Part 2 was **not built in this bundle**. |

---

## Client Issues

| Requirement | Status | Evidence |
|---|---|---|
| Real canonical issue/case source OR honest Not Connected; no fake "2 cases"; exact link when connected | **Intentionally Unavailable** | No canonical client-case/communication-case service exists. The Phase 6A read model already returns `unresolved_client_communication_cases: { available:false, count:null, reason }`. The Company Command surface must show the same honest state (Part 3 — pending). |

---

## Weather

| Requirement | Status | Evidence |
|---|---|---|
| Real provider/location-linked source OR honest disabled; no Team Schedule dead-link; no fake forecast | **Intentionally Unavailable** | `homeDashboard.buildWeatherTravelItems` emits only **travel** heuristics; there is **no weather provider/API** connected and no `weather_*` provider config. Honest state = "Weather provider not connected", no fake forecast, no enabled CTA (Part 4 — pending). |

---

## Scheduling-change workflow

| Requirement | Status | Evidence |
|---|---|---|
| Requested date / original date retained / reason / capacity-conflict check / alternatives / communication history / approval / final decision | **Missing** | No canonical `schedule_change` / `change_request` / reschedule table exists (Phase 6A audit §11 / category 18). Requires a new auditable workflow (Part 5 — pending). |

---

## Summary of honest gaps (for the residual parts)

- **Intentionally Unavailable (honest disable required on Company Command):** Client Issues cases, Weather forecast. *No canonical source — must not show a live-looking count or an enabled CTA.*
- **Missing (safe to build):** Production dense operating surface (Part 2); auditable Shoot date-change workflow (Part 5).
- **Partial — needs live re-verify:** Company Command tiles, Staffing board polish, Jobs quick-view, Team Schedule, cross-surface action exactness (Part 6).
- **Verified Complete this session:** the entire canonical Directory + Contacts + atomic Organization + service terms + Job Intake cascade + dated-commitment + the Schools Leadership/CSR read model (`afb3f54`).

This matrix is the audit deliverable (Part 1). The residual implementation parts (2–8) are scoped here
but were **not** all completed in this pass; each remains a bounded, safe slice over the canonical
sources identified above.
