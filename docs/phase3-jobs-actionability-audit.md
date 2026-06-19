# Phase 3 — Jobs Index & Job Detail: Read-Only Audit & Scope

**Date:** 2026-06-19
**Branch:** `feature/work-spine-foundation-v1`
**Status:** Read-only audit. **No code was changed.** This document is the scope artifact for Phase 3; no feature work begins until the slice plan in §6 is approved.
**Method:** Three parallel read-only code sweeps (API backend, admin-web UI, cross-surface count coherence) plus direct verification of every load-bearing file cited below.

---

## 0. Headline reframing (read this first)

**The Jobs index and job detail already exist and are real, Postgres-backed surfaces.** Phase 3 is **not** a greenfield "build Jobs" phase — it is an **actionability + state-coherence wiring** phase. This mirrors the Phase 0 audit's central finding (most domains have real backends; the gap is that *Home / Company Command* is demo-backed and unwired to them).

Concretely, all of the following already ship:

- a canonical `jobs` table + child aggregate (migration 089, "shared job truth layer");
- a job **list** endpoint and a single-**job detail** endpoint (plus full CRUD + production sub-routes);
- a derived **job truth layer** that computes status / readiness / "behind" health;
- an admin-web **Jobs index page** and a multi-tab **job detail page**, with working `#jobs/{id}` **deep-link routing**;
- a Phase 1 **actionability contract** that *already* resolves a job to `#jobs/{id}` and is explicitly designed to upgrade a section link into an exact-record link "with no caller changes" once a target carries a real id.

So the Phase 3 question is **not** "how do we build job detail?" It is: **"why does Home still send users to a generic `#jobs` list (or a sample number) instead of the exact real job, and where do job counts disagree across surfaces?"**

---

## 1. Inventory — what already exists

### 1a. API / backend (all real Postgres, no demo mode)

| Capability | Route | Service / source | Ref |
|---|---|---|---|
| Jobs **list / index** | `GET /api/jobs` (search, department_type, day_date filters; limit 200) | `listJobs` | [routes/jobs.ts:926](packages/api/src/routes/jobs.ts:926), [jobService.ts:3015](packages/api/src/services/jobTruth/jobService.ts:3015) |
| Single **job detail** | `GET /api/jobs/:jobId` | `getJobDetail` → `JobDetailResponse` | [routes/jobs.ts:1054](packages/api/src/routes/jobs.ts:1054), [jobService.ts:3722](packages/api/src/services/jobTruth/jobService.ts:3722), [types/jobTruth.ts:1342](packages/api/src/types/jobTruth.ts:1342) |
| Prep-readiness queue | `GET /api/jobs/prep-readiness-queue` | `listPrepReadinessQueue` | [routes/jobs.ts:941](packages/api/src/routes/jobs.ts:941) |
| Production items / exceptions / overdue / blocked | `GET /api/jobs/production-items*` | production board services | [routes/jobs.ts:961-1039](packages/api/src/routes/jobs.ts:961) |
| Mutations | `POST /drafts`, `PATCH /:jobId`, `POST /:jobId/publish`, `/days`, `/staff-assignments`, … | job service | [routes/jobs.ts:1069-1149](packages/api/src/routes/jobs.ts:1069) |
| Canonical schema | `jobs` + `job_days` + `job_staff_assignments` + `job_readiness_items` + `production_items` + `job_watch_flags` | migration 089 | [089_shared_job_truth_layer_phase1.sql:148](db/migrations/089_shared_job_truth_layer_phase1.sql:148) |
| **Truth layer** (derived status) | — | `calculateJobStatusSnapshot` → `job_status` / `staffing_status` / `readiness_status` (incl. `off_track` = "behind" within 72 h) / `risk_status` / `readiness_percent` / `blocker_count` | [jobStatusEngine.ts:181](packages/api/src/services/jobTruth/jobStatusEngine.ts:181) |

### 1b. admin-web UI

| Capability | Where | Ref |
|---|---|---|
| Hash routing for `#jobs`, `#jobs/{id}` (detail), `#jobs/{id}/edit`, `#jobs/new` | `resolveRouteId` | [navigation.ts:2137-2150](packages/admin-web/src/navigation.ts:2137) |
| Jobs **index page** (real `listSharedJobs`, rich filters, row-click → `navigateToSharedJobHash(base, id)`) | `SharedJobsPage` | [pages/SharedJobsPage.tsx](packages/admin-web/src/pages/SharedJobsPage.tsx) |
| Job **detail page** (multi-tab: readiness, staffing, production, QA, deliverables, day-of, comms, etc.) | `SharedJobDetailPage` | [pages/SharedJobDetailPage.tsx](packages/admin-web/src/pages/SharedJobDetailPage.tsx), route [navigation.ts:681](packages/admin-web/src/navigation.ts:681) |

### 1c. Actionability contract (Phase 1)

- `resolveActionTarget` maps `{ sourceType, sourceId?, focus?, unavailableReason? }` → available `#hash` or disabled+reason. For `sourceType: "job"` it returns `#jobs/${sourceId}` when an id is present, else the `#jobs` base. [actionTargets.ts:48-97](packages/admin-web/src/home/actionTargets.ts:48)
- The contract is **ready**: "when a target gains a real sourceId, the resolver upgrades a section link into an exact-record deep link with no caller changes" ([actionTargets.ts:11-13](packages/admin-web/src/home/actionTargets.ts:11)).

---

## 2. The actionability gap (the Phase 0 `RelatedJobLink` finding, precisely)

`RelatedJobLink` hardcodes `href="#jobs"` and accepts only `jobName` — it **discards the job id**:

```tsx
// homeShared.tsx:40
export function RelatedJobLink({ jobName }: { jobName: string }) {
  return <a className="home-related-job" href="#jobs">{jobName} →</a>;
}
```

**Critical nuance — this is currently *intentional*, not a naive bug.** The comment above it ([homeShared.tsx:38-39](packages/admin-web/src/home/homeShared.tsx:38)) explains: *"Demo jobs are not real records, so a related-job affordance links to the real Jobs database rather than a dead per-job hash. Keeps the no-fake-UI discipline."* Its only call sites render **demo** items whose `relatedJobId`s are non-real slugs — `edina-soccer`, `white-bear-gallery`, `minnetonka-soccer`, `wayzata-pd` ([CompanyNeedsAttention.tsx:35](packages/admin-web/src/home/CompanyNeedsAttention.tsx:35) over `DEMO_NEEDS_ATTENTION` at [homeDemoData.ts:82-205](packages/admin-web/src/home/homeDemoData.ts:82)).

**Sequencing consequence (important):** "fixing" `RelatedJobLink` to emit `#jobs/{id}` *before* its source items carry **real** job ids would replace an honest list-link with a **dead deep-link** to a slug that no `GET /api/jobs/:jobId` will resolve. The real fix is upstream: feed real job ids in, then let the (already-built) contract deep-link. This is the Jobs instance of the locked Phase 1 decision **"honest contract on demo data first; wire real backends later."**

---

## 3. State-coherence findings (job counts across surfaces)

| Surface | Source today | Behavior | Ref |
|---|---|---|---|
| "On Fire" card | **live** (`/api/exceptions`, same fn as Urgent Window) | Correct by design — count equals its destination | [CompanyCommandHome.tsx:77](packages/admin-web/src/home/CompanyCommandHome.tsx:77), [urgentWindow.ts:203](packages/admin-web/src/home/urgentWindow.ts:203) |
| **"Jobs Behind"** card | **sample** `"5"`, badged `dataSource:"sample"`, helper *"live delivery risk is in Production Tracker"*, target `project_tracking` (section, no id) | Honest placeholder, **not wired** to the real count | [homeDemoData.ts:253](packages/admin-web/src/home/homeDemoData.ts:253) |
| **"Production Load"** card | **sample**, same pattern | Honest placeholder, **not wired** | [homeDemoData.ts:273](packages/admin-web/src/home/homeDemoData.ts:273) |
| Real "behind" count **does exist** | `/api/workflows/command-center` → `total_running_late` / `total_blocked` over job rows | Backend is live; Home just doesn't consume it | `listProjectWorkflowCommandCenter` / summarize in [services/projectTracking/workflowEngine.ts](packages/api/src/services/projectTracking/workflowEngine.ts) |
| **Needs Attention** panel | **demo-only** (`DEMO_NEEDS_ATTENTION`) | Real urgent issues do **not** appear here — they surface only in the live **Urgent Window** (Phase 1 `49b05ea`) | [CompanyNeedsAttention.tsx:42](packages/admin-web/src/home/CompanyNeedsAttention.tsx:42) |

Two **deeper** coherence risks worth a decision (not just "demo vs live"):

1. **Two job-health truths can disagree.** "Behind/at-risk" is computed two independent ways: the **event-driven** `urgent_watch_item` set (approvals/acknowledgement exceptions, behind the Urgent Window's *jobs-workflow* category) vs the **state-driven** workflow-step health in Project Tracking. A job can be `blocked` in Project Tracking yet absent from the Urgent Window if no watch candidate was surfaced for it. These need a single canonical definition of "behind" if Home is to show one trustworthy number.
2. **Summary vs filtered group counts.** Project Tracking's backend summary counts *all* job rows, while the front-end filters out demo-noise rows (`isGeneratedDemoNoise` / `isCuratedProjectDashboardRow`, [ProjectTrackingFoundation.tsx:1105-1119](packages/admin-web/src/pages/ProjectTrackingFoundation.tsx:1105)) — so a group card's count can differ from the backend total.

---

## 4. What is genuinely missing / to decide

1. **No Home surface feeds real job ids into the (ready) deep-link contract.** The plumbing exists end-to-end except the data that flows into it on the Home side is demo.
2. **"Jobs Behind" / "Production Load" are honest placeholders, not live.** Wiring them to `/api/workflows/command-center` is the "wire real backends later" half of the Phase 1 decision — but it requires choosing the canonical "behind" definition (§3.1).
3. **Needs Attention is a demo narrative; the live issue surface is the Urgent Window.** Decide whether Phase 3 makes any job-bearing Home affordance live, or leaves Needs Attention as a demo story and routes real action exclusively through the Urgent Window.
4. **RBAC / data specifics to confirm during a slice** (not blockers): the exact `requireAction` scope on the jobs routes, and a real-job fixture in the Demo Studio tenant to deep-link to for verification.

---

## 5. Out of scope / guardrails (unchanged)

Not a Jobs rebuild, not Directory/Schools (Phase 4), not the Monday migration (Phase 5), not payroll, not a broad notification-center redesign. No parallel job store. No fake UI / no fabricated numbers — honest "sample"/"unavailable" stays until a surface is genuinely wired.

---

## 6. Proposed bounded Phase 3 slices — **FOR APPROVAL (no work started)**

Mirroring the Phase 1/2 cadence (audit/trace-first where useful, tests + browser smoke per slice, one bounded commit each):

- **Slice 1 — Real job deep-linking from the live issue surface.** Carry real `jobId` on Urgent Window job rows (and any live job-bearing Home affordance) and let `resolveActionTarget` open `#jobs/{realId}`. Extend `RelatedJobLink` to accept an optional real id (keeping the honest `#jobs` fallback when the id is a demo slug, so no dead deep-links). *Frontend-led; likely no migration.*
- **Slice 2 — Wire the job-count cards to truth.** Replace the "Jobs Behind" / "Production Load" sample values with the live `/api/workflows/command-center` count (or honest `unavailable`), preserving the card-truth `dataSource` badges from Phase 1 `61a5da9`. *Requires the §3.1 "behind" decision.*
- **Slice 3 — Job-count coherence.** Reconcile the event-driven vs state-driven "behind" definitions into one canonical number, and align Project Tracking's backend summary with the front-end's filtered group counts. *May touch a read model; audit-first.*
- **Slice 4 — Verification.** Deterministic two-sided smoke (Home count → exact job detail; Urgent Window job row → `#jobs/{id}`), full suites + typechecks + builds, and a dated Phase 3 closure report.

Each slice ends with the standard per-commit report; nothing is pushed; `stash@{0}` stays untouched.

---

## 7. Confidence & provenance

Every claim in §1–§3 carries a `file:line` reference. The load-bearing files (`homeShared.tsx`, `actionTargets.ts`, `routes/jobs.ts`, `CompanyNeedsAttention.tsx`, `homeDemoData.ts`, `navigation.ts`) were opened and verified directly during this audit. Internal line numbers inside `jobService.ts`, `jobStatusEngine.ts`, and `workflowEngine.ts` come from the read-only sweeps and should be re-confirmed at the top of whichever slice touches them.
