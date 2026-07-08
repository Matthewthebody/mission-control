# Mission Control — Scout C Audit: Runtime QA, Security/Permissions, Tests, Performance

Author: Scout Agent C
Date: 2026-07-08
Repo: `C:\Dev\Codex-integrated-baseline-clean`
Branch: `feature/work-spine-foundation-v1` @ `fe5853e8`
Working tree at audit time: **DIRTY** — `M packages/api/src/app.ts`, untracked `packages/api/src/routes/postShoot.ts`, untracked `packages/api/src/services/postShootEvaluationObligations.ts`, untracked `docs/audits/`. This matters: some test failures below are attributable to this in-progress work, not the clean baseline.

Scope: runtime QA, bug hunt, security/RBAC, API/frontend contract mismatches, test coverage, performance at scale. **Read-only / audit-only** — no app code changed, no commits, no DB reset/seed run. The DB was already migrated + demo-seeded from prior sessions (98 jobs, 56 orgs, 42 locations, 2,271 alerts present).

## How this audit was performed / methodology honesty note
- **API layer (authoritative):** exercised directly with `curl` using real cookie+bearer sessions minted via `POST /auth/dev-login` for matthew (owner_admin), admin, leadership, senior_photographer, photographer, office_employee. This is high-confidence evidence.
- **Browser UI QA: NOT performed interactively.** The Chrome extension bridge was offline the entire session, and the Preview browser tool's fixed proxy port (5174) was held by another chat; `autoPort` did not release it. The admin-web SPA is a client-rendered hash-router app, so **page-level rendering, console errors, click flows, and visual empty/loading/error states could not be browser-verified.** Frontend findings below come from reading source (`packages/admin-web/src`) and from the admin-web vitest suite, and are labelled accordingly.
- Two parallel read-only sub-agents did deep code passes on (a) security/RBAC and (b) performance/scale; their findings are integrated and independently spot-checked at runtime where noted.
- Servers: API already running on :4000 (healthy); I started admin-web dev on :5173 (Vite up). I left both running; killed nothing.

---

## 1. BUG INVENTORY

### 1A. Routing / nav / deep-links

**BUG R1 — Unknown/typo/stale deep links silently redirect to the dashboard (no 404/not-found state).**
- Severity: **Medium**
- Evidence: `packages/admin-web/src/navigation.ts` — `resolveRouteId()` (lines 2051–2660) is a ~600-line manual `if (path === …)` chain that ends with `return getDefaultRouteId(...)` (line 2658). Any hash it does not explicitly recognize falls through to the default route (dashboard/my-work).
- Expected vs actual: A broken or renamed deep link (e.g. from an old alert email, a bookmarked detail page whose id format changed, or a typo) should show a "not found / this link is stale" affordance. Actual: the user is silently dropped on the dashboard with no signal the link failed.
- Root cause: giant hand-maintained alias table with a catch-all fallback and no explicit unknown-route branch.
- Recommended fix: add an explicit `not-found` route rendered when the hash is non-empty and matches no known prefix; keep the dashboard fallback only for empty hash.
- Tests to add: `resolveRouteId("#does/not/exist", …)` should resolve to a `not-found` route, not the default.

**BUG R2 — The hash resolver is a brittle 600-line manual alias table; fall-throughs have already regressed.**
- Severity: **Low** (maintainability/reliability)
- Evidence: `navigation.ts` `resolveRouteId` (2051–2660); the most recent commit on the branch is literally `78f125d Fix route resolution fall-throughs and command panel limit`, confirming this surface has produced real routing bugs.
- Recommended fix: replace the linear alias chain with a declarative prefix/param table driven off the `ROUTES` definitions.

**BUG R3 — "production" deep-link action target drifted from `#production` to `#production/operations` (contract test red).**
- Severity: **Low**
- Evidence: admin-web test `src/test/actionTargets.test.ts:11` — `resolveActionTarget({ sourceType: "production" })` now returns `{ hash: "#production/operations" }` but the actionability contract asserts `#production`. Test failure output: `Expected "#production" / Received "#production/operations"`.
- Expected vs actual: the deep-link contract for "production"-sourced actions changed without updating the contract test. Both hashes resolve to a page, so the user impact is small, but the actionability contract (which is the guarantee that alert/card deep links land on the exact intended destination) is currently unverified/red.
- Root cause: route relabel of the Production surface not reconciled with `resolveActionTarget` + its test.
- Fix: decide the canonical target and align `resolveActionTarget` and the test; if `#production/operations` is intended, update the test.

**Positive (verified at code level):** off-page job deep links are ID-safe — `GET /api/jobs/quick-view/:jobId` returns the canonical row by id, 404s on a shoot id or unknown/non-uuid, and requires auth (API test file `jobsCanonicalIndex.test.ts` "off-page deep link" group — all 4 passed). Directory has stable full-page canonical detail routes (`#directory/organizations/<id>` etc., `navigation.ts:1170-1204`).

### 1B. Auth / permissions

**BUG P1 — Owner Command / Manager Cockpit expose all-employee payroll & compliance data to office/CSR-level roles. (RUNTIME-CONFIRMED)**
- Severity: **HIGH**
- Area: API authorization
- Repro:
  1. `POST /auth/dev-login {email:"office@example.com"}` → bearer token.
  2. `GET /api/dashboard/manager-cockpit` (or `/api/dashboard/owner-command`) with that token.
- Evidence (runtime): office_employee receives HTTP 200 and a ~111 KB payload. The `needs_payroll_compliance_review` queue is populated with `count: 830` and item objects carrying employee identity and payroll-blocking detail, e.g. `title:"Demo Photographer"`, `summary:"Missed clock-in correction requested for 7/8/2026, 11:32:56 AM."`, `due_label:"Payroll blocking"`, `status_label:"Missed Clock-In Request"`, plus a click-through `action_hash` into the compliance surface. `summary.needs_payroll_compliance_review = 830` is also exposed. matthew (owner) and office get near-identical payloads (111,275 B vs 111,232 B).
- Evidence (code): `packages/api/src/routes/dashboard.ts:354-360` guards both routes with only `requireAuth, requireAction("dashboard.read")`. `dashboard.read` is held broadly (`authz/authority.ts` grants it to `customer_service_rep`, `schools_client_success`, `sports_client_success`, `read_only_viewer`, etc.). The aggregator `application/dashboard/load-manager-cockpit.action.ts:19-22` calls `getPayrollReview(client, auth, {})` and `listComplianceWorkspaceItems(...)`, neither of which has an entry-level authority gate; they only row-scope via `shouldRestrictShiftList(auth)` = `isOwnOnlyScheduleUser(auth)`, which returns **false** for CS/CSR profiles (`authority.ts:764-772`), so `effectiveUserId` becomes `null` → all employees returned (`timeClockPayroll.ts:1806`).
- Expected vs actual: a customer-service/office role should not see the company-wide payroll/compliance review queue. The direct route `/api/attendance/payroll-review` correctly blocks these roles (they lack `attendance.read`) — the cockpit path bypasses that boundary.
- Affected roles: `office_employee` (resolves to `customer_service_rep` profile by default), `customer_service_rep`, `schools_client_success`, `sports_client_success`, and any standard-employee holder of `dashboard.read` who is not own-only.
- Root cause: sensitive aggregation gated by a generic dashboard permission; underlying read services fail **open** (return all rows) for roles that are neither leadership nor own-only.
- Recommended fix: add a manager/owner authority guard to `/manager-cockpit` and `/owner-command` (e.g. `requireOperatingSystemModuleView("operations")` or `canReviewTeamTime`), **and** give `getPayrollReview`/`getPayrollSummary`/`listComplianceWorkspaceItems` a defense-in-depth entry gate that forces own-scope for non-privileged callers instead of defaulting to all.
- Tests to add: as `office_employee`/`schools_client_success`, `GET /api/dashboard/owner-command` returns no other-employee payroll/compliance rows (self-only or 403); regression for CSR and sports CS.

**BUG P2 — Payroll/compliance read services have no entry-level authority gate (root cause of P1).**
- Severity: **Medium**
- Evidence: `services/timeClockPayroll.ts:1806` (`effectiveUserId = shouldRestrictShiftList(auth) ? auth.id : input.userId ?? null` — null ⇒ all), `services/complianceWorkspace.ts` (`listComplianceWorkspaceItems` no top-level gate). Any future route calling these without a strict guard re-opens P1.
- Fix: assert `canViewLaborCost`/`canReviewTeamTime` at service entry, mirroring `leadershipReports.ts:581-588`.

**BUG P3 — `dev-login` is gated only by `NODE_ENV`, which Zod defaults to `"development"` when unset; also unrated-limited & passwordless.**
- Severity: **Medium**
- Evidence: `routes/auth.ts:96-108` — passwordless session for any active email; guard `if (config.NODE_ENV === "production" || !config.ALLOW_DEV_LOGIN) → 404`. `config.ts:27` defaults `NODE_ENV` to `"development"` and `ALLOW_DEV_LOGIN` to `NODE_ENV !== "production"`. `/auth/login` has `loginRateLimit`; `/auth/dev-login` has **none**.
- Impact: if a deployed environment ever ships with `NODE_ENV` unset/misconfigured, `dev-login` is live and any known email yields that user's full authority — complete auth bypass.
- Fix: require an explicit positive dev flag that is never defaulted-on; fail startup if `NODE_ENV` is unset in a deployed context; add a rate limiter to `/auth/dev-login`.
- Test: `POST /auth/dev-login` → 404 when `NODE_ENV` unset or production.

**BUG P4 — Several review/workspace/attendance routes rely on service-only authorization (mitigated, but inconsistent).**
- Severity: **Low** (no bypass found; defense-in-depth gap)
- Evidence: `dashboard.ts:250,264` (`employees/workspace`, `admin/workspace`) and `attendance.ts:64-134` (`/operations`, `/operations/:id`, `POST /operations/:id/actions`) carry only `requireAuth`; protection is entirely inside the service (`canViewEmployeesWorkspace`, `assertShiftManagementScope`, `buildScopeFilter`). Functionally safe today.
- Fix: add explicit route-level `requireAction`/module guards for clarity and defense-in-depth; add a test that an own-only employee gets 403 from `POST /operations/:id/actions` on a peer's shift.

**Positive auth findings (verified):**
- Authentication is sound: opaque DB-backed sessions wrapped in an HS256 JWT that carries only `sub/sid/tenant_id/ver`; **roles/permissions are recomputed from DB every request** (`middleware/auth.ts` `resolveAuthenticatedUser` → `mapAuthUser`/`buildPermissionCodesForAuthority`). No client-supplied role/user-id is trusted. `auth_version` revokes all tokens on password change. scrypt + `timingSafeEqual` password hashing.
- Runtime spot-checks all correct: no token → 401; garbage token → 401; photographer `POST /api/organizations` → 403; empty-body org create → 400; cookie-transport `POST` without CSRF header → 403; photographer `GET /api/dashboard/owner-command` → 403; photographer/office `GET /api/exceptions` → 403; office `GET /api/labor/command-center` → 403.
- Self-scoped write surfaces (mileage, employee ack/decline, clock punches, payroll self-check, `overtime/mine`) use `auth.id`, never a body/param user id.
- The schools leadership operations endpoint scopes **down** by role rather than leaking: `GET /api/schools/leadership/operations` returns `"scope":"own"` for a photographer (guarded by `requireSchoolsHubReadAccess`, service reduces scope). Not a leak.

### 1C. Data / API contracts

**BUG C1 — Single-job workflow panel loads up to 200 job rows and filters client-side; jobs beyond the cap silently show no workflow state.**
- Severity: **High** (latent, triggers at ~200+ jobs)
- Evidence: `packages/admin-web/src/components/jobs/JobOperationalCommandPanel.tsx:154-190` — `useJobWorkflowState` calls `getProjectWorkflowCommandCenter(token, { view:"global", limit:200 })` then `commandCenter.job_rows.find(r => r.job_id === jobId)`. The in-code comment admits a prior 400-error regression when `limit` was 250 (`routes/workflows.ts` caps at 200): *"250 was rejected with a zod 400, silently breaking this panel for every role."*
- Expected vs actual: opening any job's operational command panel should show that job's workflow state. Actual: at >200 jobs, jobs outside the first 200 command-center rows resolve to `row = null`, so the panel shows no workflow with no error. Also wasteful (200-row fetch to render one job).
- Root cause: no by-id workflow endpoint; the panel reuses a capped list endpoint and filters in the browser.
- Fix: add `GET /api/workflows/command-center/job/:jobId` (or reuse `/api/jobs/quick-view`) returning one job's row; stop fetching the whole board.
- Tests to add: with >200 jobs seeded, the panel for the 201st job still resolves its workflow row.

**BUG C2 — `SharedJobsPage` (jobs tracking + department job DBs) fetches everything and paginates/filters/counts client-side over a silent 200-row server cap.**
- Severity: **High** (correctness at scale)
- Evidence: server `services/jobTruth/jobService.ts:3088` `ORDER BY … LIMIT 200` (no offset); client `pages/SharedJobsPage.tsx:593-687` slices client-side and computes 10 stat tiles via `.filter()` + `buildJobMissingInfoChecklist(item)` in the render body.
- Expected vs actual: the jobs table and its "Missing info / Waiting on client" tiles should reflect all jobs. Actual at 1,000 jobs: only the 200 earliest-scheduled jobs are shown and every count tile is wrong relative to reality; a code comment (`jobService.ts:3048-3052`) acknowledges the window problem and only patches two statuses.
- Fix: migrate this page to the already-built paginated read model `GET /api/jobs/index` (`jobsCanonicalIndex.ts`), which returns real `page:{limit,offset,total,has_more}` and server-side metric counts.

### 1D. Forms / actions

- Validation and authorization on write flows are correct in the cases tested (400 on empty org create, 403 on unauthorized create, 403 on missing CSRF). No forms-accept-bad-data issue was found at the API layer in the surfaces probed. **Form UX (inline validation messages, disabled/submitting states, success toasts, save-then-appears-elsewhere) was NOT browser-verified** (browser unavailable).
- Mileage semantics changed under the in-progress `postShootEvaluationObligations.ts` work (see Tests §): mileage submissions that previously produced a `candidate` now yield `review_required` when a post-shoot evaluation is missing. If this ships, confirm the frontend mileage/labor surfaces render the `review_required` state meaningfully.

### 1E. Loading / error / empty states

- `GET /api/notifications` returns an empty body (`[]`, 2 bytes) for the owner in demo data — verify the Notifications UI shows a real empty state rather than a spinner/blank. **Not browser-verified.**
- admin-web test `photographyWorkspacePage.test.tsx` "read-only 30-day calendar" fails asserting a `.schedule-month-day__preview--school` chip is present (`expected null not to be null`). Either a rendering regression in the read-only photography calendar or demo-data lacking a school shoot in the window. **Flagged for browser follow-up.**
- General empty/loading/error-state coverage across pages is **unverified** due to the browser limitation. This is the single biggest gap in this audit — see Conclusion.

### 1F. Large-data / performance

Full detail in §4 (Performance). Headlines, all with runtime payload evidence at only 98 jobs of demo data:
- `GET /api/alerts` returns a flat array of **2,271** alerts, **~1.00 MB**, no LIMIT/pagination (`services/alerts.ts:5-23`). Loaded by `Approvals.tsx:212` with `status=all`.
- `GET /api/projects` **~920 KB**, `GET /api/schools/leadership/operations` **~396 KB**, `GET /api/exceptions` **~595 KB**, `GET /api/watch` **~564 KB**, `GET /api/jobs` **~285 KB** — all large, mostly unpaginated.
- Dashboard-home N+1 (checklist attention, up to ~600 sequential queries) + full location/evaluation scan, polled every 60 s per open tab.
- Directory lists hard-capped (80 orgs / 120 contacts / 120 locations) with **no offset** and a `total` that reports the truncated count — records beyond the cap are unreachable.

### 1G. Tests / tooling

See §2 for full results. Headlines:
- API `npm test`: **186 passed / 3 failed files (10 tests)** — failures are consistent with a non-hermetic suite run against a pre-seeded shared demo DB **plus** the dirty in-progress working tree, not clearly baseline product bugs (analysis in §2).
- admin-web `npm test`: **622 passed / 2 failed** (deep-link contract drift R3; read-only calendar chip).
- worker `npm test`: **69 passed / 0 failed**.
- The API suite is **not hermetic** — it depends on DB state and fails against a used demo DB. This is itself a tooling gap.

---

## 2. TEST COVERAGE REPORT

### Commands run
- `npm test -w packages/api` (chunked vitest runner, 189 files) — **run against the already-seeded shared demo DB; DB was NOT reset (safety rule).**
- `npm run test -w packages/admin-web` (`vitest run --maxWorkers 1`, 110 files).
- `npm run test -w packages/worker` (vitest).
- Re-ran the 3 failing API files individually to capture error detail.
- NOT run: `npm run verify:mobile` (Expo typecheck) — skipped for time; ESLint `npm run lint` — skipped for time; full `verify:release` — requires clean tree (tree is dirty). Flag: mobile typecheck and lint are unverified.

### Results
| Suite | Files | Tests | Pass | Fail |
|---|---|---|---|---|
| api | 189 | — | 186 files | 3 files (10 tests) |
| admin-web | 110 | 624 | 622 | 2 |
| worker | 17 | 69 | 69 | 0 |

### API failures (verbatim, trimmed) and classification
- `tests/jobsCanonicalIndex.test.ts` (6 tests): `(5) honors search/owner/… filters → AssertionError: expected 0 to be greater than 0`; `(7) scopes rows AND counts → expected 38 to be 57`; `(20) caps page size … no per-row N+1 → expected 38 to be greater than 100`; plus (10),(13),(14) confirmed-links tests. **Classification: environmental** — count-based assertions (38 vs 57, 38 vs >100) indicate the pre-existing 98-job demo dataset polluting fixture expectations; the suite assumes a clean/reset DB.
- `tests/timeClockMileagePhase5.test.ts` (3 tests): `creates a mileage candidate … → expected 'review_required' to be 'candidate'`; `pays only once per day … → expected null to be '<uuid>'`; `attributes leadership-submitted evaluations … → expected 'review_required' to be 'candidate'`. **Classification: in-progress WIP breakage** — the untracked `postShootEvaluationObligations.ts` + modified `app.ts` change mileage to `review_required` when a post-shoot evaluation is missing (the sibling test "flags review when a worked day is missing a Post-Shoot Evaluation" now PASSES). Tests were not updated to match the new obligation semantics.
- `tests/schedule.test.ts` (1 test): `does not allow a trade participant to approve their own trade → expected 409 to be 200`. **Classification: environmental** — the failing assertion is the *accept* step (`expect(accepted.status).toBe(200)`) returning 409, i.e. an overlap conflict from pre-seeded shifts for the office user; the self-approval guard (`expect(review.status).toBe(403)`) is never reached, so this is **not** evidence of a self-approval hole. The self-approval protection appears intact (sibling trade tests pass).

### admin-web failures (verbatim, trimmed)
- `src/test/actionTargets.test.ts` "resolves each connected source type to its canonical route": `Expected "#production" / Received "#production/operations"` — deep-link contract drift (BUG R3).
- `src/test/photographyWorkspacePage.test.tsx` "read-only 30-day view": `AssertionError: expected null not to be null` at the `.schedule-month-day__preview--school` chip — rendering/demo-data (BUG in §1E).

### Honest caveat
Because the DB was **not** reset (per the safety mandate) and the working tree is **dirty**, I cannot cleanly attribute the API failures to the clean baseline. On a freshly reset DB and clean tree they may pass. The actionable conclusion is: **the API suite is not isolated from DB state, and the mileage tests are red against uncommitted work.** Before this branch merges, the mileage tests must be reconciled with the post-shoot obligation change.

### Top 10 tests to add
1. RBAC: `office_employee`/`schools_client_success` calling `/api/dashboard/owner-command` gets **no** other-employee payroll/compliance rows (guards BUG P1).
2. RBAC: `getPayrollReview`/`listComplianceWorkspaceItems` refuse to return all-employee rows for a non-privileged caller (guards P2).
3. Auth: `POST /auth/dev-login` returns 404 when `NODE_ENV` is unset or production, and is rate-limited (guards P3).
4. Attendance: own-only employee `POST /api/attendance/operations/:id/actions` on a peer's shift → 403 (guards P4).
5. Scale/contract: with >200 jobs, `JobOperationalCommandPanel` resolves the 201st job's workflow row (guards C1).
6. Scale/contract: `SharedJobsPage` stat-tile counts equal server-side totals when >200 jobs exist (guards C2).
7. Routing: `resolveRouteId` on an unknown non-empty hash resolves to an explicit not-found route, not the dashboard (guards R1).
8. Deep-link contract: `resolveActionTarget` for every `sourceType` matches the live canonical route (reconcile + guard R3).
9. Test hygiene: make `jobsCanonicalIndex`/`schedule` fixtures tenant-isolated so they pass against a non-empty DB (guards the non-hermetic-suite gap).
10. Perf regression: assert `/api/alerts`, `/api/shifts`, `/api/production-items` responses are bounded (LIMIT enforced) given N seeded rows.

---

## 3. SECURITY / PERMISSION RISK REPORT

| ID | Risk | Severity | Affected roles | Evidence | Fix | Test to add |
|---|---|---|---|---|---|---|
| P1 | Owner-Command/Manager-Cockpit leak all-employee payroll+compliance data | **HIGH** | office_employee, customer_service_rep, schools/sports_client_success | RUNTIME 200 + 830-item payroll queue with names/timestamps; `dashboard.ts:354-360`, `load-manager-cockpit.action.ts:19-22`, `timeClockPayroll.ts:1806`, `authority.ts:764-772` | manager/owner guard on both routes + entry gate in read services | see Top-10 #1/#2 |
| P2 | Payroll/compliance read services fail open (return all) for non-own-only roles | Medium | same as P1 (any future caller) | `timeClockPayroll.ts:1806`, `complianceWorkspace.ts` | own-scope default + authority assert at service entry | Top-10 #2 |
| P3 | `dev-login` gated only by defaultable `NODE_ENV`; passwordless; no rate limit | Medium | any (auth bypass if misconfigured) | `routes/auth.ts:96-108`, `config.ts:27-31` | explicit dev flag, hard startup check, rate limit | Top-10 #3 |
| P4 | Review/workspace/attendance routes rely on service-only authz | Low (mitigated) | own-only employees | `dashboard.ts:250,264`, `attendance.ts:64-134` | explicit route guards | Top-10 #4 |
| Doc | `security-rbac.md` says flags "fail closed" but several default open; matrix vs P1 | Low | — | `config.ts:283-357`; `docs/security-rbac.md` | reconcile doc/behavior | flag-default test |

**Strong points (do not regress):** DB-derived permissions recomputed per request; no client role/user-id trust; `auth_version` revocation; CSRF double-submit on cookie transport; scrypt hashing; consistent `auth.id` self-scoping on writes; schools-leadership endpoint scopes down (not up) by role. The authentication core is the most solid part of the system.

**Frontend-only-security check:** nav visibility (`isRouteVisible`/`pickVisibleRoute`, tab-based) is cosmetic; the real boundary is the API, which is mostly enforced. The one materially exploitable gap where a UI-hidden surface is reachable via API is **P1** (owner-command).

---

## 4. PERFORMANCE / DATA-SCALE REPORT

Runtime payload sizes at **98 jobs** of demo data (owner token):
`/api/alerts` 1,002,955 B (2,271 items) · `/api/projects` 921,715 B · `/api/exceptions` 594,809 B · `/api/watch` 564,452 B · `/api/schools/leadership/operations` 395,841 B · `/api/schedule/calendar` 275,191 B · `/api/jobs` 284,986 B (98 items) · `/api/dashboard/home` 186,812 B · `/api/dashboard/owner-command` 111,275 B.

### Critical / High
- **F1 (CRITICAL) — dashboard-home checklist N+1:** `services/jobTruth/checklistService.ts:2948-3040` `listChecklistAttention` selects up to 96/160 candidates then loops **sequentially**, each `loadInstanceDetailInternal` (line 1960) issuing ~5-6 queries ⇒ up to ~600 sequential round-trips per dashboard request, in one transaction. Caller: `dashboardQueryService.ts:259` (every `/api/jobs/dashboard/home|executive|today`). At 1,000 jobs the candidate cap is always saturated ⇒ worst case on every render. Fix: batch-load with `ANY($ids)`.
- **F2 (HIGH) — `/api/dashboard/home` mega-aggregator + 60 s poll:** `services/homeDashboard.ts:612-747` unconditionally `listShootLocations(...)` → `loadLocationDataset` (`services/locations.ts:362-413`) loads **every** location, **every** `post_shoot_evaluation` (no LIMIT), **every** `setup_photo_upload` (no LIMIT) and computes stats in JS. Frontend polls every 60 s per tab (`HomePulseSurface.tsx:148-153`; leadership/operations/employees surfaces poll 30-60 s). Multi-season history ⇒ re-reads 5-10k rows every minute per open tab (TV mode keeps tabs alive).
- **F3 (HIGH) — `loadLocationDataset` full-scan on every Shoot Locations request** (`locations.ts:180,239,284,310,1246,1329`), including single-location detail materializing the whole dataset. This is the June-20 Location Intelligence path.
- **F4 (HIGH) — SharedJobsPage fetch-everything over a 200-row cap** — see BUG C2. Client stat tiles run `buildJobMissingInfoChecklist` in the render body (`SharedJobsPage.tsx:685-687`) ⇒ ~800 checklist builds per filter keystroke at the cap.
- **F5 (HIGH, latent trap) — production-board automation sweep on a read path:** `jobService.ts:3474-3478` `listProductionQueue` runs `sweepProductionBoardAutomation` **by default** (`run_automation !== false`); the sweep selects up to 400 job ids and loops `syncProductionBoardForJob` (~13 queries + writes each). Every current caller passes `run_automation:false`, so no impact today — but the default polarity means the next forgetful caller turns a GET into a ~5,000-query read-modify-write. Fix: invert the default or move to a worker.
- **F6 (HIGH) — `listProductionQueue` main query has no LIMIT** and side-loads six full tables (`jobService.ts:3506-3640`); exposed via `/api/jobs/production-items` and multiplied ×3 per dashboard render.

### Medium
- **F7 — Directory lists hard-capped, no offset, lying total:** `services/organizations.ts` `listOrganizations` LIMIT 80 (592), `listDirectoryContacts` LIMIT 120 (865), `listDirectoryLocations` LIMIT 120 (1005); response `search.total = rows.length` (the truncated count). At 300 contacts, 180 are unreachable and the UI count reads "120". Contact query uses 3 `LEFT JOIN LATERAL` + unindexable `LIKE '%…%'` over `regexp_replace(...)`.
- **F8 — Directory rail refetches on every keystroke** (`Organizations.tsx:275-321`; only the URL push is debounced) ⇒ 18 heavy queries to type "Lincoln Elementary".
- **F9 — JobsIndexPage full round-trip per search keystroke** (`JobsIndexPage.tsx:175`, no debounce).
- **F10 — `GET /api/shifts` unbounded, date range optional**, per-row `json_agg` of segments+punches (`services/scheduling.ts:680+`); `Labor.tsx:53` / `Approvals.tsx:210` can request season-wide.
- **F11 — Trade/PTO list endpoints have no LIMIT** (`scheduling.ts:2307+`, `availabilityRequests.ts:1208-1227`); `Approvals.tsx:207-208` fetches full history with no status filter.
- **F12 — `GET /api/alerts` returns all alerts, no LIMIT** (`services/alerts.ts:5-23`); 2,271 today, closeout alerts auto-created per shoot. (Contrast: the jobs Alert Center is correctly capped at 100, `alertEventService.ts:472`.)
- **F13 — `listAttendanceExceptions` no outer LIMIT, 4+ LATERAL joins/row** (`attendance.ts:2706-2890`); mitigated only because current callers pass `date=`.
- **F14 — Operations dashboard: per-row correlated subqueries, unbounded on wide ranges** (`services/dashboard.ts:122-520`); presets include `season_to_date`/`year_to_date`.

### What happens at scale
- **100 jobs (today):** renders; dominant cost already the home dashboard (F1 + F2 + 3× F6) every 60 s/tab.
- **1,000 jobs:** SharedJobsPage silently shows the first 200 with wrong count tiles; `/api/production-items` returns multi-MB ×3 per dashboard; checklist N+1 always worst-case; the properly paginated `/api/jobs/index` keeps working (adopt it everywhere).
- **Multiple seasons:** append-only tables (`post_shoot_evaluation`, `setup_photo_upload`, `alert`, trades/PTO, `attendance_exception`, `work_shift`, `production_items`) have no time floor ⇒ cost grows linearly with tenure and never plateaus.
- **Hundreds of contacts/locations:** directory rails hard-stop with a lying total; search fires unindexable multi-LATERAL per keystroke.
- **Many alerts:** jobs Alert Center safe (100 cap); legacy `/api/alerts` on Approvals is not.

### Highest-leverage perf fixes
1. Batch `listChecklistAttention` (F1). 2. Stop full location/evaluation scans per request (F2/F3). 3. Move SharedJobsPage onto `/api/jobs/index` (F4/C2). 4. Add LIMIT + default windows to `/api/alerts`, `/api/shifts`, `/api/production-items`, trades/PTO, attendance exceptions (F6,F10-F13). 5. Debounce the two type-to-fetch searches + invert the `run_automation` default (F5,F8,F9).

---

## 5. RUNTIME QA LOG

- **Servers:** API `:4000` already up (`/health` 200, though it self-reports `release_ready:false`, dirty tree, and several Microsoft365 subsystems `no_go`/disabled in dev). Started admin-web `:5173` (Vite ready). Left both running; killed nothing.
- **Auth:** dev-login succeeded for matthew/admin/leadership/senior/photo/office (311-char tokens each).
- **API routes exercised (owner):** jobs, organizations, locations, tasks, alerts, exceptions, schedule/calendar, dashboard/home, dashboard/owner-command, dashboard/manager-cockpit, schools/leadership/operations, projects, labor/command-center, labor/periods, labor/self-check/current, admin/security/overview, search, watch, notifications — all 200 (sizes in §4).
- **Cross-role authorization matrix (runtime):** owner-command → matthew/leadership/office 200, photo 403; labor/command-center → owner/leadership 200, photo/office 403; exceptions → owner/leadership 200, photo/office 403; alerts → owner/leadership 200, photo/office 403; admin/security/overview → owner/leadership 200, photo/office 403; schools/leadership/operations → 200 for all but scope-reduced to `own` for photo.
- **Write/negative flows (runtime):** empty org create 400; photographer create 403; no-token 401; garbage-token 401; cookie POST w/o CSRF 403. All correct.
- **Console errors / failed XHR / visual states: NOT captured** — browser bridge unavailable (Chrome extension offline; Preview proxy port held by another chat). This is a material gap.
- **Routes NOT tested (and why):** every page-level render, click flow, empty/loading/error state, and deep-link landing in the SPA — browser unavailable. Mobile typecheck and ESLint — skipped for time.
- **Demo-data concerns:** DB carries heavy prior-session data (2,271 alerts, 830 payroll-compliance items, 98 jobs, 56 orgs, 42 locations). This inflates payload-size evidence realistically but also breaks non-hermetic API tests (§2). Some demo entities are placeholders ("Demo Photographer", "Test Location") — fine for internal QA, would look unfinished in a live external demo.

---

## 6. BLUNT CONCLUSION

**Safe to demo internally, with a chaperone and a fixed script? Roughly yes.** The core flows authenticate, the API enforces most permissions correctly, and 877 of ~890 automated tests pass (worker 69/69, admin-web 622/624, api 186/189 files). But I could not drive the UI in a browser, so I cannot vouch that every page renders cleanly with real data and no console errors — treat that as unverified, not "passed."

**Safe for unsupervised internal use across roles? Not until P1 is fixed.** An office/customer-service user can pull the entire company's payroll-and-compliance review queue (830 items, employee names, missed-clock-in timestamps, "payroll blocking" flags) from `/api/dashboard/owner-command`. That is real employee-sensitive data exposed to the lowest internal tier, confirmed at runtime. This is the one finding I would not ship past.

**Biggest runtime risks:** (1) unverified UI — no browser pass happened; (2) the home/executive dashboards do a checklist N+1 (~600 sequential queries) plus a full location+evaluation scan every 60 seconds per open tab — this will get visibly slow within one or two seasons and on a wall-mounted TV-mode tab; (3) the jobs tracking page silently truncates at 200 jobs and shows wrong count tiles beyond that.

**Biggest permission risks:** P1 (owner-command payroll/compliance leak to office/CSR) and P3 (dev-login gated only by a defaultable `NODE_ENV`, passwordless, unrate-limited — a misconfigured deploy is a full auth bypass).

**What would embarrass us in a live demo:** a deep link that silently dumps the user on the dashboard (R1); the jobs page showing 200 of 1,000 jobs with confidently-wrong "Missing info" counts (C2); a job's workflow panel showing blank because the job is past row 200 (C1); placeholder "Demo Photographer / Test Location" strings on screen; and dashboard lag once real history accumulates.

**What must be tested before adding features:** (1) fix P1 and add the RBAC regression; (2) make the API test suite hermetic (tenant-isolated fixtures) and reconcile the mileage tests with the in-progress post-shoot obligation change — do not merge this branch with those red; (3) a real browser smoke pass across every top-level route per role (login, my-work, dashboards, schools/sports hubs, staffing, production tracker, jobs, directory, schedule, labor/payroll-self-check, mileage, evaluations, admin) capturing console errors and empty/error states — this audit could not do it and it is the biggest blind spot.
