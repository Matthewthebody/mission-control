# Mission Control — Phase 6A Schools Leadership Closure Report

**Date:** 2026-07-08
**Branch:** `feature/work-spine-foundation-v1`
**Scope of this report:** closure of Phase 6A Parts 3 / 5 / 3b / 4 (Schools Leadership operating view), the closure-gate results, and the coordination blocker with a concurrent labor/payroll work stream. Documentation only.

---

## 1. Repo / session context

| Item | Value |
|------|-------|
| Branch | `feature/work-spine-foundation-v1` |
| Phase 6A commit range | `7e484ac` → `0d0dbf5` → `8275896` → `fbfba41` (contiguous, no merges or unrelated commits interleaved) |
| Current HEAD (at time of writing) | `fbfba41` — "Focus Schools Leadership deep-link destinations" |
| Working tree status | **Dirty — NOT from Phase 6A.** A concurrent labor/payroll stream has ~9 modified tracked files (api `app.ts`, `authority.ts`, `attendance.ts`; worker `index.ts`, `queue/bullmq.ts`; admin-web `app.tsx`, `navigation.ts`, `permissions.ts`, `styles.css`) + ~12 untracked files (migration `165_labor_command_center_phase1.sql`, labor/payroll/quickbooks services + routes, worker `laborMonitor.ts`, admin-web LaborCommandCenter/PayrollSelfCheck UI). None of it is staged in any Phase 6A commit. |
| Pushed? | **No.** 134 commits ahead of origin; nothing pushed this phase. |
| Stack | Docker postgres+redis (:5432), API `tsx watch` (:4000), admin-web Vite (:5174) — left running. |

---

## 2. What Phase 6A shipped

**Final route:** `#schools/leadership` — "Leadership" tab in the Schools context nav (Jobs · Tasks · Exceptions · Leadership), gated on `canAccessSchoolsHub`.

| Part | Commit | Summary |
|------|--------|---------|
| 3 — Schools Leadership UI | `7e484ac` | Operating board over `GET /api/schools/leadership/operations`: two sections (Current season / Building next season); per-category blocks; server counts (displayed == filtered); unavailable categories render "Not connected yet" + backend reason, never a fake zero; calm "All clear" empty states; severity pills; `Unowned` owner-gap pill; `primary_action` clickable only when `can_act`; `focus_reason` as secondary row text; `exact_destination_hash` deep-links. |
| 5 — Live browser verification | `0d0dbf5` | Fixed 3 live-only defects: (1) `resolveRouteId` needed an explicit `schools/leadership` case (registering ROUTES/app.tsx/permissions alone leaves a route unreachable); (2) Schools `SECTION_CHILD_ORDER` needed the new route for the nav tab; (3) real data (159-row categories, ~430 rows/page) needed `CATEGORY_ROW_LIMIT = 12` + honest "Showing the first 12 of N" disclosure (true total stays on the count pill). |
| 3b — CSR route/reuse audit | `8275896` | **CSRs are all-scope, not owner-scoped**: `getSchoolsHubAccessScope` grants "all" to `schools_client_success` / `customer_service_rep` / `sports_client_success` / leadership / admins / read-only; "own" derives only from own-only schedule users (field / graphic_artist / office_employee). Conclusion: reuse the single route — a "My Schools" CSR route would mislabel an all-schools view. Page framing is now scope-aware from the server payload: all → "Schools Leadership" / "All schools"; own → "My Schools Operations" / "My schools". |
| 4 — Actionability / deep-link focus | `fbfba41` | (1) Shoot rows linked to the jobs world where 0 of 326 shoot ids exist — now `#operations/staffing?date=<date>&shoot=<id>` (Staff Assignment Board consumes both; opens the exact shoot's staffing drawer); `open_job` → `open_shoot`. (2) `GET /api/jobs/detail → 500` root-caused: `parseSharedJobIdFromPath` treated the canonical `detail` segment as a job id; now returns null + `parseSharedJobIdFromParams` (`?job=`/`?preview=`) fallback in `SharedJobDetailPage` — heals all three `#…/jobs/detail` shells and the production workflow queue's `?preview=` links. (3) `workflow_blockers` → `#schools/jobs?focus=stalled` (SchoolsHub's consumed filter). |

---

## 3. Closure-gate results (2026-07-08)

### 3.1 Code review at HEAD (immune to the dirty overlay — checked via `git grep` at `fbfba41`)
All 17 intended behaviors confirmed present: resolveRouteId case; SECTION_CHILD_ORDER entry; permissions case; app.tsx dispatch; `CATEGORY_ROW_LIMIT = 12`; disclosure line; "Not connected yet" (4 uses); "All clear" empty state; scope-aware titles; `can_act && primary_action` gating; `Unowned` pill; `#operations/staffing` shoot destination; `focus=stalled` blockers destination; `detail`-not-an-id; params fallback; `preview` support; `open_shoot` label.

The concurrent stream's edits to the shared shell files were verified **additive** (+72/−1); all Phase 6A wiring is intact in the working tree.

### 3.2 Typechecks / tests (run in the dirty tree; attribution noted)

| Check | Result |
|-------|--------|
| admin-web `tsc --noEmit` | **0** (includes the concurrent stream's admin-web files — they compile) |
| admin-web vitest: schoolsLeadershipOperations (12) + sharedJobRouting (7) + sharedJobPages (49) + permissions (25) + appAuth (27) | **120/120 pass** |
| api vitest: schoolsLeadershipOperations | **5/5 pass** |
| api `tsc --noEmit` | **0** (the earlier missing-export errors from the concurrent stream are resolved in-tree) |

### 3.3 Browser smoke (admin@example.com, all-scope, real demo data)

| Check | Result |
|-------|--------|
| `#schools/leadership` resolves (no Home fall-through) | ✅ |
| Title "Schools Leadership" + badge "All schools" | ✅ |
| Schools nav Jobs · Tasks · Exceptions · **Leadership** (active) | ✅ |
| 74 rows (cap intact), 6 "Showing the first 12 of N" disclosures | ✅ |
| 4 unavailable categories visible as "Not connected yet" (no fake zeroes) | ✅ |
| "Open shoot" → Staff Assignment Board, drawer open on the exact shoot (`SPL-fc8ef630` matches the linked id in the DB) | ✅ |
| "Open work item" → `#schools/jobs?focus=stalled`, Stalled filter `is-active` | ✅ |
| "Assign owner" → exact org record (Wayzata HS full page) | ✅ |
| `#schools/jobs/detail?job=<real job>` → full job detail, **0** `/api/jobs/detail` requests | ✅ |
| Console errors | **None** |
| Failed requests attributable to Phase 6A | **None** (see §5 observation on aux-panel 403s) |

Own-scope (`graphic@example.com`) was verified during Part 3b: "My Schools Operations" / "My schools", HTTP 200 scope "own", honest all-zero board (the user owns no schools; no fake ownership was seeded).

---

## 4. Lessons captured

1. **New admin-web routes need an explicit `resolveRouteId` case** — the ROUTES array does not drive path resolution.
2. **Section-nav tabs require a `SECTION_CHILD_ORDER` entry** in addition to `showInSectionNav`.
3. **Live data exposes scale jsdom tests don't** — cap per-category rows and disclose honestly.
4. **CSR roles are all-scope** — never assume a role's scope; read `getSchoolsHubAccessScope`.
5. **Shoot rows are not canonical job rows** — deep-link shoots to `#operations/staffing?date&shoot`, never to jobs-world hashes.
6. **Shared job detail ids must come from path segments or `?job=`/`?preview=` params** — the literal `detail` segment is never an id.

---

## 5. Known out-of-scope follow-ups

| Item | Detail |
|------|--------|
| Urgent-watch `#scheduling` destinations do not focus | `buildSchedulingUrgentWatchHash` emits `#scheduling?area=staffing&date&shoot`, but `resolveRouteId` sends the literal `scheduling` path to the Team Schedule calendar, which never opens the shoot drawer. Urgent-watch deep-links deserve their own fix pass (likely the same `#operations/staffing` destination Phase 6A now uses). |
| `GET /api/jobs/:jobId` 500s on non-UUID ids | Unguarded cast (jobs.ts `/:jobId`). No product link produces it anymore; add a 404 guard (Phase 3C.1 quick-view precedent). |
| Own-scope zero-ownership empty state | An own-scope user who owns 0 schools sees seven "All clear" blocks; a dedicated "You don't own any schools yet" state would read clearer (needs a read-model signal or client heuristic). |
| Job Detail aux-panel 403/400s (observation) | With a fresh admin token: `record-resources`/`communications`/`approvals` 403 and `workflows/command-center?view=global` 400, while the core job fetch is 200. Observed while the API was hot-running the concurrent stream's uncommitted `authority.ts`/`app.ts` edits — not attributable to Phase 6A (which only supplies the job id). Re-check after the labor stream lands. |

---

## 6. Closure status & blocker

**Phase 6A is functionally COMPLETE.** All four parts are committed, code-reviewed at HEAD, and verified live; every targeted check passes.

**Full branch-level closure (and any push) is BLOCKED** on the concurrent labor/payroll stream: the working tree carries its ~21 uncommitted files, including modifications to shared shell files (`app.ts`, `authority.ts`, admin-web `app.tsx`/`navigation.ts`/`permissions.ts`). Until that stream commits (or is intentionally discarded by its owner):

- do **not** push this branch;
- do **not** run repo-wide formatting or auto-fixes;
- treat repo-wide gate results as including that stream's in-flight code.

**Recommendation:** the labor/payroll stream owner should finish and commit their slice (their code currently typechecks), then re-run the branch gate; after that, begin the G1 Compliance Workspace audit.
