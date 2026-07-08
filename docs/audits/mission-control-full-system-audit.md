# Mission Control — Full-System Audit (Coordinator Synthesis)

Date: 2026-07-08
Repo: `C:\Dev\Codex-integrated-baseline-clean`, branch `feature/work-spine-foundation-v1`, HEAD `fe5853e8` (tree clean at audit start; a concurrent session was editing `complianceWorkspace.ts`/post-shoot files during Scout C's run — those WIP effects are called out where relevant).
Method: three-agent scouting per the audit brief, then coordinator synthesis. Full evidence lives in:

- [Scout A — Source of Truth / Architecture](mission-control-scout-a-source-of-truth.md)
- [Scout B — UX / Role Workflows](mission-control-scout-b-ux-workflows.md)
- [Scout C — Runtime QA / Security / Tests / Performance](mission-control-scout-c-qa-security-runtime.md)
- [Audit Setup Note](mission-control-audit-setup-note.md)

No app code was changed. Only `docs/audits/*.md` files were created.

**Coordinator honesty note:** browser-level UI verification could not be performed (Chrome bridge offline, preview proxy port held by another session). API behavior was runtime-verified via authenticated curl across 6 roles; UI findings are code-level + vitest. A per-role browser smoke pass is the single biggest remaining blind spot and appears in Phase 0.

---

## 1. CEO Version (five minutes)

**Is this one operating system?** No — not yet. It is **two operating systems sharing one directory and one login**. The "Shoot OS" (2,709 shoots — scheduling, staffing, time clock, labor, leadership dashboards) and the "Jobs OS" (93 jobs — closeout, production items, client command center, M365) do not see each other: the bridge tables built to connect them contain **zero rows**. The convergence fix was designed and documented on June 19 and never implemented. Every new feature since (Production Tracker, Season Autopilot) deepens the fork.

**What's surprisingly strong.** The canonical directory (orgs/schools/districts/contacts/locations), the dated-commitment snapshot model, the staffing publish/acknowledge lifecycle, the Labor Command Center (correctly built on the real spine, honestly labeled QuickBooks scaffold), Urgent Window's count-integrity pattern, Concierge search, and the 46-month evaluation→next-year-brief memory loop. These beat Monday.com outright. The authentication core (DB-derived permissions per request, no client trust, CSRF, token revocation) is solid.

**Biggest risks, in order:**
1. **A confirmed data leak:** an office/CSR login can pull the entire company's payroll & compliance queue (830 items with employee names and "payroll blocking" flags) through `/api/dashboard/owner-command`. Runtime-verified. Do not run this cross-role internally until fixed.
2. **The front door is fiction.** The default home page mixes 3 live counts with 9 fabricated incidents, 5 fake employees, and a persona picker driven by localStorage, not login. One phone call about the fake "Edina Soccer photographer not clocked in" ends leadership trust permanently. The honest-contract pattern that fixes this is already built and proven on the same page's top card row.
3. **The two-spine fork.** Scheduling/staffing is dead for jobs without linked shoots; leadership production trends are computed from a data model whose workspace is unreachable; dashboards and detail pages disagree by construction.
4. **Silent wrong numbers at scale.** The jobs page truncates at 200 rows and computes its count tiles client-side; hub KPIs are keyword guesses over a 14-row board; the home dashboard runs ~600 sequential DB queries per render, polled every 60 seconds per tab.
5. **Payroll has three exit doors** (three CSV exports, only one lifecycle-gated). Someone will hand QuickBooks an unreviewed export.

**What not to build yet:** more modules, more dashboards, a Monday-style board engine, further Production Tracker or Season Autopilot slices past their current state. Every feature added before the Job/Shoot decision picks a spine and makes the fork worse.

**Top 10 things to fix first:**
1. Close the payroll/compliance leak (P1) + add RBAC regression tests.
2. Decide Job-vs-Shoot semantics and populate `job_shoot_links` (the June-19 plan, executed).
3. Kill or fully label the home demo layer; wire Needs Attention to the live exceptions feed; route employees to live MyWork.
4. Turn on job intake with clickable missing-state links (Jessica currently has no create button).
5. One job-status vocabulary; one jobs list; delete drifted frontend enum copies.
6. One payroll surface + one gated CSV; port the ops dashboard off legacy time tables.
7. Fix the broken deep links (RelatedJobLink, `critical_high_only`, `queue/stage` params, Training self-link) and add a not-found route.
8. Batch the dashboard N+1 and put LIMITs on the unbounded endpoints (`/api/alerts` returns ~1MB today).
9. Persist acknowledgements/confirmations server-side (today: localStorage — "I confirmed that" is untrue on any other machine).
10. Seed the labor stack so the owner's marquee new feature doesn't demo as an empty shell.

---

## 2. Executive Summary

| Dimension | Health | One-line reason |
|---|---|---|
| Product health | **Mixed** | Excellent live surfaces coexist with an unlabeled demo veneer and a forked work model |
| Architecture health | **Fair** | New layers (directory, labor, 163/164) are modeled well; nothing legacy is ever retired |
| UX health | **Fair** | Reports problems well, rarely hands the user the next action; too many front doors and vocabularies |
| Data / source-of-truth health | **Poor at the work layer** | Two spines, empty bridges, 3 status enums, 3 mileage models, 6 alert registries |
| Workflow health | **Mixed** | Staffing lifecycle is best-in-product; client issues don't exist; intake is flagged off |
| Runtime quality | **Fair (API) / Unverified (UI)** | API auth/validation correct in all negative tests; no browser pass was possible |
| Security / permissions | **Good core, one bad hole** | Auth core is strong; P1 leak is runtime-confirmed; dev-login default is a deploy risk |
| Testing health | **Fair** | 877/~890 tests pass, but the API suite is not hermetic and RBAC/scale regressions are untested |
| Ready for internal use? | **Not unsupervised** | P1 must be fixed first; then yes for pilot roles |
| Ready for demo? | **Chaperoned + scripted only** | Fake home data, empty labor seed, placeholder records are ambush risks |
| Ready to scale past demo data? | **No** | 200-row caps with wrong counts, N+1 dashboards, unbounded endpoints, no time floors on history |

Scout A's coherence scores (1–5): canonical identity **2**, relationship integrity **3**, workflow continuity **2**, dashboard trust **2**, alert trust **2**, historical memory **4**, role clarity **3**, duplicate prevention **3**, legacy cleanup **1**, reporting readiness **2**.

---

## 3. Top 20 Findings

Format: ID · title · severity · category · evidence (see scout reports for full detail) · impact · root cause · fix · size · acceptance criteria highlights.

### MC-AUDIT-001: Two live work spines with an empty bridge
Severity: **Critical** · Category: Data Model · Area: entire work layer · Scouts: A (B, C corroborate)
**Evidence:** `centralJobIntake.ts:1940` INSERTs `shoot`; `jobTruth/jobService.ts:2095` INSERTs `jobs`; both mounted (`app.ts:192,234`). Live DB: `shoot` 2,709 / `jobs` 93 / `job_shoot_links` **0** / `job_legacy_mapping` **0**. Migration 164 names a column `job_id` that FKs `shoot(id)` (`164_shoot_date_change_request.sql:15`). Leadership/home services query only `shoot` (grep: 0 `jobs` hits); closeout/production-items/client-command-center only `jobs`.
**Impact:** the same picture day can exist twice with different statuses; scheduling/staffing is dead for unlinked jobs (`JobsIndexPage.tsx:490-504`); leadership and department owners see different realities; production/closeout is unreachable for ~97% of real work.
**Root cause:** migration 084 (job fields on `shoot`) and 089 (`jobs` table) never converged; June-19 convergence audit's Option B documented, never implemented.
**Fix:** decide Job = engagement / Shoot = dated occurrence; populate `job_shoot_links` with reviewed provenance; ONE intake creator; the other spine's records become projections.
**Size:** XL (decision S; backfill+enforcement L–XL) · **Owner:** staff engineer + owner sign-off on semantics.
**Acceptance:** link table populated for all active work; a job detail can reach its shoots' schedule/staffing; leadership dashboards and jobs dashboards agree on counts; new records cannot be created spine-orphaned.
**Tests:** intake creates linked pairs; dashboard count parity test; FK/link invariants.

### MC-AUDIT-002: Owner-Command/Manager-Cockpit leak all-employee payroll+compliance to office/CSR roles
Severity: **Critical** (for internal rollout) · Category: Security · Scouts: C (runtime-confirmed)
**Evidence:** `office@example.com` → `GET /api/dashboard/owner-command` = HTTP 200, ~111KB, `needs_payroll_compliance_review.count: 830` with employee names/timestamps/"Payroll blocking". Guard is only `requireAction("dashboard.read")` (`dashboard.ts:354-360`); read services fail open for non-own-only roles (`timeClockPayroll.ts:1806`, `authority.ts:764-772`).
**Impact:** the lowest internal tier can read company-wide payroll/compliance data; the direct route (`/api/attendance/payroll-review`) correctly blocks them — this aggregator bypasses that boundary.
**Root cause:** sensitive aggregation gated by a generic permission; services default to all-rows when caller is neither leadership nor own-only. This is a **data-ownership** problem, not just a route-guard bug.
**Fix:** manager/owner guard on both routes AND own-scope-by-default entry gates in `getPayrollReview`/`listComplianceWorkspaceItems`.
**Size:** S–M · **Acceptance:** office/CSR gets 403 or self-only; regression tests for all CS roles. **Tests:** Scout C Top-10 #1/#2.

### MC-AUDIT-003: The default home page is unlabeled fiction with a localStorage persona switcher
Severity: **Critical** (trust) · Category: UX / Data Model · Scouts: B (A corroborates)
**Evidence:** persona chosen by `pmc-home-demo-role` in localStorage, not auth (`HomeCommandSurface.tsx:24-52`; `homePermissions.ts:3-6` admits "frontend-only for the demo"). 9 fabricated Needs Attention incidents, 5 fake employees, fake reports strip, hardcoded tile numbers ("Shoots Today = 18", `homeDemoData.ts:227`) — unlabeled below the card row. Photographer/CSR personas have ack/checklist buttons that discard input (`MyWorkspaceHome.tsx:28-33,108-114`). Mobile bottom-nav "My Dashboard" (`app.tsx:2120`) lands on the fiction; `RelatedJobLink` discards job IDs → `#jobs` (`homeShared.tsx:40-47`). Meanwhile the top card row is already honest-contract (3 live cards share the exact read model of their destinations, 3 labeled "Sample", 2 "Not connected" — `CompanyCommandHome.tsx:158-200`).
**Impact:** leadership acts on fiction once and never trusts a real number again; seasonal staff "acknowledge" a rain plan that evaporates.
**Fix:** every panel live-or-labeled; Needs Attention wired to the exceptions read model (already exists — `urgentWindow.ts`); employee home (web + mobile) = live MyWork; delete persona workspaces.
**Size:** M · **Acceptance:** zero unlabeled `dataSource:"sample"` content on `#home`; employee `#home` = `#my/day`; no interactive control persists only to component state.

### MC-AUDIT-004: Alert truth is shattered across six systems
Severity: **High** · Category: Data Model / UX · Scouts: A (B, C corroborate)
**Evidence:** `/api/alerts` reads only the 0-row `alert` table (`services/alerts.ts:15`) while real signals live in `urgent_watch_item`, `job_watch_flags` (5 writers), `attendance_exception` (2 writers), `staffing_issue`, ~1,942 `alert_events`; Home computes needs-attention client-side (`home/needsAttention.ts:3-5`). Two unrelated features are both named "Needs Attention" (`CompanyNeedsAttention.tsx` vs `Compliance.tsx:973-985`). `/api/alerts` also returns all 2,271 rows (~1MB, no LIMIT).
**Impact:** fixing an item in one registry doesn't clear the others; "go check Needs Attention" is a coin flip; the alerts endpoint will grow unboundedly.
**Fix:** one alert/needs-attention registry with resolution semantics; the five registries + Home rules become views/writers into it; rename one of the two features now.
**Size:** L (rename/wire-home: S).

### MC-AUDIT-005: Time truth forks — dashboard hours ≠ payroll hours by construction
Severity: **High** · Category: Data Model · Scouts: A
**Evidence:** `attendance.ts:1073` and `timeClockRuntime.ts:679` both INSERT `time_session`; `clock_event` has 3 writers; `attendance.ts` dual-writes legacy `shift_punch`/`time_entry`, which the ops dashboard reads (`dashboard.ts:155-192`) while payroll reads canonical `time_session/time_segment` (`payrollSelfCheck.ts:239-242`).
**Impact:** the owner's dashboard and payroll can disagree about hours in the same week — a payroll-trust killer.
**Fix:** one clock service; port `dashboard.ts` to canonical tables; freeze `shift_punch`/`time_entry`.
**Size:** M.

### MC-AUDIT-006: Job intake is dark by default and dead-ends when lit
Severity: **High** · Category: Workflow / UX · Scouts: B
**Evidence:** `centralJobIntakeV1` defaults false (`featureFlags.ts:10`, `.env.example:150`) — no create button on the Schools hub (`SchoolsHub.tsx:1572-1581`); missing school/contact/location shows non-clickable "Open it in Directory" text (`QuickCreateJobDrawer.tsx:674-697`); Smart Paste/CSV import mounted only for Sports (`SportsShoots.tsx:201-211`); service term fetched but never written into the payload.
**Impact:** Jessica cannot do the one workflow the product was built around; she stays on Monday.
**Fix:** enable the flag after making missing-state texts clickable (or inline-create — the selectors exist: `CanonicalContactSelector.tsx:192`); mount import for Schools; write service term into intake.
**Size:** M.

### MC-AUDIT-007: Three job-status vocabularies; frontend enum copies have already drifted
Severity: **High** · Category: Data Model · Scouts: A (B corroborates in UX)
**Evidence:** pg_enum: `shoot_status` (10), `shoot_job_status` (7), `job_status_type` (13). `DepartmentJobAdapterUIRegistry.tsx:291,307` re-declares statuses as untyped strings — missing `intake_blocked` and 7 of 20 production statuses vs `jobTruthTypes.ts`. Two jobs lists ship three stage vocabularies (`SharedJobsPage.tsx:438-474` vs `JobsIndexPage.tsx:402-408` vs `SharedJobDetailPage.tsx:173-181`).
**Impact:** "confirmed" means three things; users can't filter by statuses the system actually emits.
**Fix:** one vocabulary, one server-side engine (extend `jobStatusEngine`), frontend imports the union types; retire `shoot.job_status`.
**Size:** L.

### MC-AUDIT-008: Home/executive dashboards run a ~600-query N+1 plus full-table scans, polled every 60s per tab
Severity: **Critical** (perf trajectory) · Category: Performance · Scouts: C
**Evidence:** `checklistService.ts:2948-3040` sequential per-candidate loads (~5-6 queries each) on every `/api/jobs/dashboard/*`; `homeDashboard.ts:612-747` loads every location + every `post_shoot_evaluation` + every `setup_photo_upload` (no LIMITs) per request; frontend polls 30–60s (`HomePulseSurface.tsx:148-153`).
**Impact:** visibly slow within 1–2 seasons; a wall-mounted TV tab hammers the DB continuously.
**Fix:** batch with `ANY($ids)`; windowed queries; cache the location dataset.
**Size:** M.

### MC-AUDIT-009: Silent 200-row truncation with confidently wrong counts
Severity: **High** · Category: Data/API Contract · Scouts: C (B corroborates pattern elsewhere)
**Evidence:** `jobService.ts:3088` LIMIT 200 no offset; `SharedJobsPage.tsx:593-687` computes 10 stat tiles client-side over the window; `JobOperationalCommandPanel.tsx:154-190` fetches a 200-row board to find ONE job — jobs past row 200 show a blank panel (in-code comment admits a prior regression here).
**Impact:** at 1,000 jobs the page shows 200 with wrong "Missing info" tiles; single-job panels go silently blank.
**Fix:** migrate to the already-built paginated `/api/jobs/index` (real totals + server counts); add a by-id workflow endpoint.
**Size:** M.

### MC-AUDIT-010: Three mileage models for one drive
Severity: **High** · Category: Data Model · Scouts: A
**Evidence:** `mileage.ts:80` INSERTs legacy `mileage_claim` (haversine) while self-labeling canonical (`mileage.ts:41`); `timeClockMileage.ts` owns `mileage_reimbursement` and reads both (:357,:412); `jobCloseoutV1.ts:939` stores a third review copy. (Scout C: the concurrent WIP session is changing mileage semantics right now — tests red.)
**Impact:** two different reimbursement amounts for the same drive; manual reconciliation.
**Fix:** single pipeline on `mileage_reimbursement`; shoot-submit becomes a thin canonical writer; closeout references, never re-stores.
**Size:** M.

### MC-AUDIT-011: Two payroll review surfaces and three payroll CSV exports — only one lifecycle-gated
Severity: **High** · Category: Workflow / Compliance · Scouts: A + B
**Evidence:** `/api/attendance/payroll-review` (`payrollReviewApi.ts:33`) vs `/api/labor/*` (`laborCommandCenterApi.ts:251`) both live; CSVs from `Labor.tsx:483-486`, `PayrollReview.tsx:226-228`, `LaborCommandCenter.tsx:514-525` — only LCC's is approval-gated.
**Impact:** review completed in one surface leaves the other showing pending; office staff can hand QuickBooks an unreviewed export.
**Fix:** Labor CC canonical; other surfaces read-only with a banner naming the gated export; remove ungated CSVs.
**Size:** S–M.

### MC-AUDIT-012: Production has three progress models; leadership measures the dead one
Severity: **High** · Category: Data Model / UX · Scouts: A + B
**Evidence:** `production_items` (canonical, Tracker Slice 1) vs `production_project` (11 rows, summarized two different ways: `productionOperations.ts:71-103` vs `productionProjects.ts:967-986`) vs workflow runs. `ProductionProjects.tsx` (2,387 lines) is unrouted, yet Reports' "Production Trends" computes from `production_project*` (`operationalReporting.ts:411-492`) while Spencer works in workflow runs. Two nav items are both labeled "Production Queue" (`navigation.ts:641,1012`); hub links carry `?queue=&stage=` params the rendered component never parses (`ProductionHub.tsx:78-95` vs `SharedJobProduction.tsx:484-498`).
**Impact:** three answers to "how far along?"; leadership's trend numbers come from a model nobody works in.
**Fix:** `production_items` + workflow backbone only; freeze/migrate `production_project`; repoint Reports; rename one queue; strip dead params.
**Size:** L.

### MC-AUDIT-013: Client-issue workflow does not exist end-to-end
Severity: **High** · Category: Workflow / Product Gap · Scouts: B (A corroborates fragmentation)
**Evidence:** no issue record, no owner→resolution lifecycle, no "client informed" step anywhere (repo-wide grep); exceptions engine offers only assign/snooze/mark-handled (`routes/exceptions.ts:44-60`); `ClientCommandCenter.tsx:410`: "No external delivery in V1"; Zendesk read-only/mock.
**Impact:** CSRs keep a spreadsheet; the owner hears about problems from clients.
**Fix:** minimal client-issue object (intake → owner → resolution → client-informed), Zendesk webhook feeding it; wire Home's "Client Issues" card (actionTargets already reserves `client_case`).
**Size:** L.

### MC-AUDIT-014: "What's next" is prose, never a button
Severity: **High** · Category: UX · Scouts: B
**Evidence:** missing-info next actions render as `<p>` text (`SharedJobDetailPage.tsx:780`); no scheduling CTA on job detail (:634-649); Labor signal cards and intake-review actions are action-shaped non-clickable text (`Labor.tsx:228-251`, `SharedJobsPage.tsx:525-530`); MyWork queue buckets are counts with no click-through (`MyWork.tsx:376-393`).
**Impact:** Monday's core virtue — click the thing, act on the thing — is unmatched; CSRs' chase-missing-details job stays manual.
**Fix:** every next action deep-links to its fixing surface; scheduling CTA on job detail.
**Size:** M.

### MC-AUDIT-015: Acknowledgements and confirmations persist to localStorage only
Severity: **High** · Category: Data Model / Trust · Scouts: B
**Evidence:** job "Confirm details" (`SharedJobDetailPage.tsx:487-499`), change-notice acks (`workflowChangeNotices.tsx:464-467`), demo-home acks (`MyWorkspaceHome.tsx:108-114`) — none server-persisted. Fabricated "Photography Change Notices" also feed MyWork's live "Heads Up" (`MyWork.tsx:23-26,93`).
**Impact:** "I confirmed that" is untrue on any other machine; fake notices interleave with real work on the employee's daily page.
**Fix:** server-side ack records; delete the demo notice array.
**Size:** M.

### MC-AUDIT-016: dev-login is gated only by a defaultable NODE_ENV, passwordless, unrate-limited
Severity: **Medium** (High on any misconfigured deploy) · Category: Security · Scouts: C
**Evidence:** `routes/auth.ts:96-108`; `config.ts:27-31` defaults `NODE_ENV`→"development" and `ALLOW_DEV_LOGIN`→true accordingly; no rate limiter.
**Fix:** explicit positive dev flag never defaulted on; startup failure if `NODE_ENV` unset in a deployed context; rate limit.
**Size:** S.

### MC-AUDIT-017: The migration-165/166 labor stack has zero seed data — the marquee new feature demos as an empty shell
Severity: **Medium** · Category: Demo Readiness / Test Gap · Scouts: B
**Evidence:** grep of `packages/api/scripts` for `payroll_period|self_check|time_session|mileage_reimbursement` → nothing; seeds write only legacy `time_entry`/`shift_punch` (`seed.ts:731-756,3516-3526`) while LCC/SelfCheck/PayrollReview read `time_session` (`services/laborCommandCenter.ts:100-106`).
**Fix:** seed time sessions, one open payroll period, a self-check window, mileage reimbursements, compliance stories.
**Size:** S–M.

### MC-AUDIT-018: Deep links fail silently — unknown hashes fall to the dashboard; several links drop their payload
Severity: **Medium** · Category: Routing / UX · Scouts: C + B
**Evidence:** `resolveRouteId` ends `return getDefaultRouteId(...)` (`navigation.ts:2658`) — no not-found state; last commit on the branch is literally a route-fall-through fix. Broken/lossy cases: `RelatedJobLink` (`homeShared.tsx:41`), `#exceptions?critical_high_only=yes` never parsed (`SharedJobCommandCenter.tsx:247` vs 1377), `?queue=&stage=` dropped (MC-012), Training breaks its own `?employee=` links (`Training.tsx:893-920`), `toJobHash` falls back to `#dashboard` (:113-115). ~19 files re-implement hash parsing; deep-link contract test is red (`actionTargets.test.ts:11`).
**Fix:** explicit not-found route; shared hash/query parser; fix the five named links; align the contract test.
**Size:** M.

### MC-AUDIT-019: The API test suite is not hermetic, and mileage tests are red against uncommitted work
Severity: **Medium** · Category: Test Gap · Scouts: C
**Evidence:** api 186/189 files pass — `jobsCanonicalIndex` count assertions polluted by the 98-job demo DB; `schedule.test.ts` trade-accept 409s on pre-seeded overlap; `timeClockMileagePhase5` red against the concurrent session's obligation change. admin-web 622/624; worker 69/69. Lint + mobile typecheck not run.
**Fix:** tenant-isolated fixtures; reconcile mileage tests before merge; RBAC + scale regression tests (Scout C's top-10 list).
**Size:** M.

### MC-AUDIT-020: KPIs computed by keyword-guessing over silently truncated boards
Severity: **Medium** · Category: UX / Data Model · Scouts: B
**Evidence:** SchoolsHub job types inferred from title keywords (`SchoolsHub.tsx:575-596`), ID-Card Tracker regex (:570-573), KPIs computed over a 14-row truncated board (:144,1179); production lanes keyword-matched (`ProductionWorkflowQueue.tsx:128-149`); Tracker areas regexed; task counts capped at 25 unlabeled (`DashboardMyTasksPage.tsx:88-99`).
**Impact:** numbers are wrong exactly when titles are messy — i.e., in real life; "fake precision" erodes trust in the honest numbers too.
**Fix:** real fields (job type on service term/job; stage on production items); true totals beside every capped list.
**Size:** M.

---

## 4. One Operating System / Source-of-Truth Assessment

**Verdict: disconnected modules with shared branding at the work layer, wrapped around a genuinely canonical directory and a well-anchored new labor layer.**

**Genuinely integrated (protect these):** directory → intake → publish (ID-linked, publish-gated, snapshotted via `dated_commitment`); staffing requirement → shift → publish/ack (all keyed on `shoot_id`, deep links carry IDs); time sessions → payroll periods → pay codes (labor stack FKs the real spine); location intelligence (single implementation reading real history); `jobsCanonicalIndex` (one CTE feeds rows AND counts); Urgent Window (card count definitionally equals page count).

**Fake-integrated (the trap list):** home cards without object IDs; alerts naming problems the user can't fix from them; "complete" shoots invisible to closeout/production (no link rows); dashboards reading legacy time tables while payroll reads canonical; production summarized three ways; "under-staffed" computed four ways from three fields; readiness re-derived client-side in three places; status badge colors colliding across dimensions via one overloaded `statusTone`; contacts/locations rendered from stale text columns beside their FKs; "Approved locations" with no approval state; "Prior Job Intelligence" hardcoded to demo org IDs.

**Where data flows cleanly:** organization→school→location→contact→shoot→staffing→time→evaluation (no re-entry, ID-linked end to end). **Where it breaks:** the production/closeout boundary — the shoot spine has no production model and the bridge to the jobs spine is empty, so the chain snaps for ~97% of real records. Sports additionally forks at mileage. Labor is schema-clean but has dual clock writers and legacy dual-writes.

**Canonical decisions needed immediately:** (a) Job vs Shoot semantics + link policy; (b) one job-status vocabulary; (c) `contact` (identity) vs `organization_contact` (edge) applied to work-record FKs; (d) `app_user` ↔ `user_account` bridge (220 vs 185 rows, no FK found); (e) alert registry ownership; (f) gallery = deliverable kind, not a fourth production model.

Full source-of-truth map (22 objects), duplication map (16 rows), and chain traces: Scout A §2–4.

**Top 10 consolidation recommendations** (= Scout A's list): 1 populate `job_shoot_links` under decided semantics; 2 one intake; 3 one status language; 4 one clock; 5 one payroll surface; 6 one mileage pipeline; 7 one alert registry; 8 one production model; 9 one evaluation writer; 10 kill home demo data / carry real IDs everywhere.

---

## 5. Role-Based Confusion Report (condensed; full version Scout B §D1)

- **CEO/Owner:** needs "is today safe / is payroll right." Gets 3 live + fabricated panels on `#home` that contradict `#executive`; three payroll CSVs. Will distrust the product after one fake-incident phone call. Fix: live-or-labeled home; one leadership surface; one gated CSV.
- **Jessica (Schools):** cannot create a job (flag off); keyword KPIs over a 14-row board; prose next-actions; no school↔jobs link either direction. Would demo it, then reopen Monday. Fix: intake on + clickable missing states + one jobs list.
- **Josh (Sports):** live overview buried in 12 stacked sections; `#home` persona is fully fabricated including a rebooking concept the file admits doesn't exist; ~1,270 lines of orphaned sports UI aliased away silently. Fix: delete orphans, one vocabulary, live home.
- **Carisa (Photography Ops):** owns the product's best workflow (staffing lifecycle) but fake "Change Notices" pollute her real pages and MyWork; prep pickers show 8 arbitrary jobs, not the photographer's; gear is unanswerable anywhere. Fix: scoped pickers, gear in the prep packet, delete demo notices.
- **Spencer (Production):** two surfaces named "Production Queue" + hub + board + tracker; blocked-link filters silently dropped; "Mark Missing Info" can't say what's missing; leadership measures him on a data model he doesn't work in; a status literally named `ready_for_spencer_review` in schema+UI. Fix: one queue with sort/priority; real missing-info reasons; repoint Reports; roles not names.
- **Dylan/Greta (Client Success):** real Client Command Center CRUD, but no client-issue record and no "client informed" step exists. Fix: MC-013.
- **CSR (all-scope):** lands on a fabricated CSR queue; their core job (chasing missing details) is served by non-clickable prose; payroll vocabulary is for engineers ("canonical labor-state model", "legacy drift"). Fix: CSR home = live missing-info worklist.
- **Photographer:** `#my/day` is genuinely good (ack/decline, self-check); but the shell and mobile bottom-nav route to the fake workspace; "Clocked Out" header is a nav link, not a status; no hours view outside the self-check window. Fix: MyWork as home; My Hours view.
- **Seasonal/new employee:** first screen is a fabricated assignment whose checklist/acknowledgement silently discards input; tribal vocabulary ("Ready Eligible", "Who has the ball"). Day two they're back to texting. The strongest argument for deleting the demo layer.

---

## 6. Workflow Gap Report (condensed; full table Scout B §D2)

| Workflow | State | Biggest gap | Risk if ignored |
|---|---|---|---|
| School picture day setup | Real cascade, flag OFF | No create button; no scheduling CTA; next actions unclickable | Jessica stays on Monday for the flagship workflow |
| Sports shoot setup | Shared spine live; sports detail orphaned | Vocabulary fork; alias-dependent deep links | Silent breakage, duplicate concepts |
| Job intake | Cascade+SmartPaste+CSV real | Schools can't reach import; service term display-only | Fall onboarding stays in Monday/CSV |
| Org/contact/location mgmt | Canonical CRUD real | Merge can't execute; "approved" is fake; unbounded lists | Duplicate schools poison "canonical" at Monday-failure scale |
| Staffing & assignment | Best in product | No delivery receipts; no auto-escalation of unacked | Carisa's phone remains the system of record |
| Schedule visibility | Good (MyWork strip + Travel) | Gear unanswerable; pickers not photographer-scoped | Screenshots and texts return |
| Photographer readiness | Prep checklist real | Fake change notices in the live feed; no per-assignment ack record | "Ready" means nothing |
| Shoot-day status | Live boards exist | No single shoot-day board joining punch+travel+issues | Day-of stays on group text |
| Post-shoot evaluation | Real, feeds next-year brief | Flag OFF in prod builds; Senior Review shows no eval data | The account-memory moat never accrues |
| Production handoff | Accept→claim→return real | No stage model (keyword lanes); canned missing-info reasons; no issue flag on return | Spencer triages from memory; leadership reads different numbers |
| Client issues | **Does not exist** | Everything | Owner hears about problems from clients |
| Late/missing details | Checklist computes well | Items don't link to fixing surfaces | #1 CSR workflow stays manual |
| Needs Attention | Two systems share the name | Home one is fiction; no unified registry | Leadership acts on fiction or ignores both |
| Leadership review | Reports real w/ freshness | Production trends from the dead model; home contradiction | Dashboards challenged once → ignored |
| Payroll/mileage/compliance | LCC+self-check+compliance strong | Empty seed; three CSVs; two review surfaces; three mileage models | Wrong export reaches QuickBooks |
| Resource/prep content | Panels exist | Training content un-migrated; no gear linkage | Monday/Drive stays the SOP home |
| Recurring work | Service terms + templates exist | Nothing generates next season's jobs | Monday's worst re-keying pattern, replicated |
| Historical/location intelligence | Location history real; 46-month eval seed | Prior Job Intelligence hardcoded to demo orgs; buried placement | The wow feature reads as broken on real accounts |

---

## 7. Bug Inventory (by group; full detail Scout C §1, Scout B throughout)

**Routing/nav/deep links:** no not-found route (silent dashboard fallback); 600-line manual alias chain (already regressed once); `#production` contract drift (test red); RelatedJobLink drops IDs; `critical_high_only` never parsed; `queue/stage` params dropped; Training breaks its own links; `#schools/production` resolves to tasks; sports legacy alias dependency; orphaned nav section key `my-work`.
**Auth/permissions:** P1 cockpit leak (Critical); fail-open payroll/compliance services; dev-login NODE_ENV default; service-only authz on several routes (mitigated).
**Data/API contracts:** 200-row job cap w/ client-side tiles; single-job panel filters a 200-row board; directory `total` reports the truncated count; three status enums w/ drifted frontend copies; mileage semantics changing under WIP.
**Forms/actions:** raw `window.prompt/confirm` on job actions; "Confirm details" localStorage-only; canned "Mark Missing Info" payloads; one-click Resolve writes a canned note without confirmation; rate/hourly-cents inputs on the scheduling form; ISO-timestamp placeholder in Attendance.
**Loading/error/empty states:** browser-unverified overall (flagged); notifications empty-body case; read-only photography calendar chip test red; LCC raw error for non-admins before a period exists.
**Large-data/performance:** see §11.
**Tests/tooling:** non-hermetic API suite; mileage tests red vs WIP; lint + mobile typecheck not run; `verify:release` blocked by dirty tree during audit.

---

## 8. Security and Permission Report

**Strong core (verified at runtime):** opaque DB-backed sessions in an HS256 JWT carrying only ids; roles/permissions recomputed from DB per request; no client role/user-id trust anywhere probed; `auth_version` revocation; CSRF double-submit; scrypt+timingSafeEqual; self-scoped writes use `auth.id`; schools-leadership endpoint scopes DOWN for photographers; negative matrix all correct (401/403/400 across 6 roles).

**Risks:** P1 cockpit payroll/compliance leak (Critical, runtime-confirmed — MC-002); fail-open read services (root cause; any future caller re-opens it); dev-login NODE_ENV default (MC-016); route-level guards missing on employees/admin workspace + attendance ops (service-enforced today, defense-in-depth gap); `security-rbac.md` claims "fail closed" while several flags default open (doc/behavior drift).

**Recommended permission tests:** Scout C §2 Top-10 items 1–4 (CSR/office cockpit scoping; service entry gates; dev-login 404; peer-shift action 403).

---

## 9. Runtime QA Report

- Servers: API :4000 already healthy (self-reports `release_ready:false` in dev); admin-web :5173 started by Scout C and left running; nothing killed.
- API routes exercised (owner + 5 other roles): jobs, orgs, locations, tasks, alerts, exceptions, schedule/calendar, dashboard home/owner-command/manager-cockpit, schools leadership ops, projects, labor command-center/periods/self-check, admin security, search, watch, notifications — all 200 with payload sizes recorded (§11).
- Cross-role matrix and write/negative flows: all correct except P1.
- **NOT tested:** every SPA page render, click flow, console error, empty/loading/error state, and deep-link landing — browser bridge unavailable. Mobile typecheck and lint skipped. **A per-role browser smoke pass is mandatory Phase 0 work.**
- Demo-data concerns: DB carries heavy prior-session data (2,271 alerts, 830 compliance items, 98 jobs); placeholder names ("Demo Photographer", "Test Location") on live surfaces; labor stack unseeded (MC-017); demo shoots' alert instances deliberately deleted by seed.

---

## 10. Test Coverage Report

| Suite | Result |
|---|---|
| worker | 69/69 PASS |
| admin-web | 622/624 (2 fail: deep-link contract drift; photography calendar chip) |
| api | 186/189 files (10 tests: jobsCanonicalIndex counts + schedule trade = environmental/non-hermetic; timeClockMileagePhase5 = red against concurrent WIP) |
| lint, mobile typecheck | NOT run (time) |

Missing critical tests: RBAC regressions (P1/P2), dev-login gating, scale contracts (201st job, tile counts vs server totals), not-found routing, deep-link contract per sourceType, bounded-response perf assertions, hermetic fixtures. Full top-10 list: Scout C §2.

---

## 11. Performance and Scale Report

Runtime payloads at only 98 jobs: `/api/alerts` **1.00MB** (2,271 rows, no LIMIT) · `/api/projects` 920KB · `/api/exceptions` 595KB · `/api/watch` 564KB · `/api/schools/leadership/operations` 396KB · `/api/jobs` 285KB.

Critical/High: dashboard checklist N+1 (~600 sequential queries/request, 60s poll — F1/F2); full location+evaluation scans per request (F3); SharedJobsPage fetch-everything over the 200 cap with per-keystroke checklist builds (F4); `run_automation` default that can turn a GET into a ~5,000-query read-modify-write (F5, latent); `listProductionQueue` no LIMIT ×3 per dashboard render (F6). Medium: directory caps with lying totals + per-keystroke unindexable searches (F7/F8); undebounced jobs search (F9); unbounded shifts/trades/PTO/alerts/attendance-exceptions (F10–F13); correlated subqueries on wide dashboard ranges (F14).

At scale: 1,000 jobs → wrong tiles + blank panels + multi-MB payloads; multiple seasons → append-only tables with no time floor grow linearly forever; hundreds of contacts → directory hard-stops at 120 with a lying total. The properly paginated `/api/jobs/index` keeps working — adopt it everywhere.

---

## 12. UX Improvement Backlog

(Scout B §D3 has the full 28-item list with citations.)
**Fast wins:** label/hide every demo panel; fix RelatedJobLink; fix `critical_high_only` + strip dead params; clickable intake missing-state links; rename dup "Needs Attention"/"Production Queue"; fix Training self-links + task Cancel target; "25+" semantics + true totals beside caps; LCC pay-code labels + blocker links; remove rate inputs from scheduling form; seed the labor stack.
**Medium:** enable intake + Schools import; wire Home Needs Attention to exceptions; employee home = MyWork (web+mobile); missing-info items link to fixing surfaces; one jobs list; production queue sort/priority/reasons; pagination on rails/queues/tracker; real fields for keyword KPIs; gear in prep packet + scoped pickers; server-side acks; delete ~3,650 lines of orphaned pages; always-on My Hours.
**Deeper:** one leadership surface; client-issue lifecycle; one production stage model shared by queue/board/tracker/Reports; season rollover from `school_service_term`; delivery receipts + escalation; nav consolidation.
**Avoid:** building a generic kanban to "match Monday"; new top-level sections; faking missing integrations (extend the honest disabled-with-reason pattern instead); named-person logic; polishing the demo layer.

---

## 13. Product Intelligence Opportunities

Grounded in what exists — no shiny features:
- **Account health:** consolidate the four independent roll-ups + `shoot` scoring columns + `school_profile.relationship_health_state` into one account-health record with history. Prereq: MC-001.
- **Location risk memory:** already real (`getShootLocationIntelligence`) — surface it automatically at intake and day-before (it's buried 10 sections deep on job detail).
- **Employee compliance patterns:** the compliance workspace + attendance exceptions already have the data; add per-employee trend ("3rd missed clock-in this month") to the owner review.
- **Shoot readiness:** one server-side readiness engine (retire the three client-side re-derivations), then readiness nudges from the Prep Readiness queue's existing gap computation.
- **Recurring client issues:** requires the client-issue record (MC-013) first; then "this school had a gallery complaint two years running" joins the evaluation memory loop.
- **Production bottlenecks:** real stage model (MC-012) makes cycle-time-per-stage a query, not a guess.
- **Staffing risk:** auto-escalate unacknowledged assignments after N hours — "Confirmation Overdue" is already computed; it just doesn't act.
- **Post-shoot evaluation insights:** the 46-month Wayzata loop is the model; wire "Senior Review" to actually show eval data (it promises it and shows none).
- **"What changed" digest / "needs my decision" inbox:** both become feasible only after the unified alert registry (MC-004) — build them on it, not beside it.
- **Department command centers:** exist in embryo (Schools Leadership is the exemplar); replicate its honest-contract pattern (server can_act, exact destination hashes, true counts) rather than inventing new surfaces.

---

## 14. Recommended Phased Roadmap

### Phase 0 — Safety, routes, permissions, tests (days–2 weeks)
Goal: safe for unsupervised internal pilot; trustworthy test signal. Why now: P1 is a live leak; the suite can't protect anything while non-hermetic.
In: fix MC-002 (guards + service entry gates + RBAC tests); MC-016 dev-login hardening; not-found route + fix the five broken deep links + align the contract test; make the API suite hermetic; reconcile mileage tests with the landed obligation change; seed the labor stack (MC-017); per-role browser smoke pass (the audit's blind spot); LIMIT on `/api/alerts` and the worst unbounded endpoints.
Out: any schema convergence, any new features.
Accept: office/CSR cockpit = 403/self-only with tests; all suites green on a fresh DB; every top-level route browser-verified per role; no >500KB list endpoint.

### Phase 1 — Source-of-truth consolidation (the big one)
Goal: one work spine. Why now: every deferred week adds spine-orphaned records.
In: Job/Shoot semantic decision + populate `job_shoot_links` (reviewed backfill); one intake creator; one status vocabulary (retire `shoot.job_status`, frontend imports server unions); one clock writer + dashboard ported to canonical time tables; one mileage pipeline; declare Labor CC the only payroll surface.
Out: UI redesigns beyond what consolidation forces.
Accept: 0 unlinked active work records; leadership vs jobs dashboards count-parity test; dashboard hours == payroll hours on a fixture week; one CSV export, gated.

### Phase 2 — Workflow clarity & duplicated-effort removal
Goal: users can act, not just observe. In: enable intake (+clickable missing states, Schools import, service term written); every next-action a deep link + scheduling CTA; one jobs list; kill/label the home demo layer + employee home = MyWork + mobile nav fix; server-side acks; delete orphaned pages (~3,650 lines); rename dup nav labels.
Accept: Jessica creates a school job start-to-schedule without leaving the app; zero unlabeled sample data anywhere; zero localStorage-only confirmations.

### Phase 3 — Leadership/compliance review surfaces
Goal: one trusted command layer. In: unified alert/needs-attention registry with resolution semantics (MC-004); merge `#home`/`#executive`/`#operations/today` into one role-aware surface on the exceptions/dashboard read models; repoint Reports' production trends to the live model; compliance trend views.
Accept: resolving a source record clears it from every surface; home and executive numbers cannot disagree (shared read model).

### Phase 4 — Role dashboards & command centers
Goal: each role's day starts in-product. In: CSR live worklist home; Spencer's single production queue with real stages/sort/priority/reasons; Josh's live sports home; Carisa's scoped prep pickers + gear in packet; always-on My Hours.
Accept: each named role's confusion-report top item resolved.

### Phase 5 — Automation & escalation
Goal: the system chases, not the humans. In: unacked-assignment escalation; auto missing-info tasks with owners + auto-chase email to canonical contacts; season rollover generator from `school_service_term`; delivery receipts (Teams/Outlook).
Accept: a missing roster triggers an owned task and a chase without human initiation; next season's jobs generated, not re-keyed.

### Phase 6 — Operational intelligence
Goal: the memory moat. In: account health record; location risk at intake/day-before; client-issue record + recurring-issue surfacing; "what changed" digest + decision inbox on the unified registry; Senior Review actually showing evals.
Accept: intake for a repeat school shows last year's brief unprompted.

### Phase 7 — Polish, performance, security hardening
Goal: multi-season scale. In: batch the checklist N+1; windowed/cached location dataset; SharedJobsPage → `/api/jobs/index`; pagination everywhere (directory rails, queues, tracker); debounced searches; invert `run_automation`; time floors on append-only reads; route-level guards everywhere; doc/behavior reconciliation for `security-rbac.md`.
Accept: dashboard p95 under budget at 1,000 jobs + 3 seasons of history (see `docs/performance-budgets.md`).

---

## 15. Paste-Ready Implementation Prompts

Sequenced. Each is scoped, safe, and testable. Do not combine them into one giant diff.

### Prompt 1 — Close the payroll/compliance leak (P1) [Phase 0]
Mission: prevent office/CSR-tier roles from reading company-wide payroll & compliance data via dashboard aggregators.
Files: `packages/api/src/routes/dashboard.ts:354-360`, `application/dashboard/load-manager-cockpit.action.ts`, `services/timeClockPayroll.ts:1806`, `services/complianceWorkspace.ts`, `authz/authority.ts`.
Steps: (1) add a manager/owner authority guard (e.g. `canReviewTeamTime`) to `/api/dashboard/owner-command` and `/manager-cockpit`; (2) defense-in-depth: `getPayrollReview`/`getPayrollSummary`/`listComplianceWorkspaceItems` must force own-scope for non-privileged callers instead of defaulting to all rows (mirror `leadershipReports.ts:581-588`); (3) verify photographer 403 behavior unchanged.
Tests: office_employee + schools_client_success + sports_client_success GET both routes → 403 or self-only payload with zero other-employee rows; owner/leadership unchanged.
Do not: change what leadership sees; loosen any other route; touch the payroll data model.
Accept: runtime curl matrix reproduced from Scout C shows the leak closed; new RBAC tests green.

### Prompt 2 — Deep-link integrity + not-found route [Phase 0]
Mission: no deep link ever silently lands on the wrong page.
Files: `packages/admin-web/src/navigation.ts` (`resolveRouteId` ~2051-2660), `home/homeShared.tsx:40-47`, `components/jobs/SharedJobCommandCenter.tsx:247,1377`, `pages/ProductionHub.tsx:78-95` + `navigation.ts:1050-1098`, `pages/Training.tsx:893-920`, `src/test/actionTargets.test.ts`.
Steps: (1) explicit not-found route for unknown non-empty hashes (dashboard fallback only for empty hash); (2) `RelatedJobLink` accepts+emits a record id or renders plain text; (3) parse `critical_high_only` on the exceptions page; (4) either translate `?queue=&stage=` to params `SharedJobProduction` understands or strip them from links; (5) fix Training's parser to accept `#employees/training`; (6) reconcile the `#production` vs `#production/operations` contract and make the test green intentionally.
Tests: `resolveRouteId("#does/not/exist")` → not-found; per-sourceType contract test green; each fixed link has a unit test.
Do not: rewrite the router wholesale in this pass; change route labels.

### Prompt 3 — Hermetic API test suite + mileage reconciliation [Phase 0]
Mission: the suite passes on any DB state and protects the new obligation semantics.
Files: `packages/api/tests/jobsCanonicalIndex.test.ts`, `tests/schedule.test.ts`, `tests/timeClockMileagePhase5.test.ts`, shared fixture helpers.
Steps: tenant-isolate fixtures (unique tenant per file) so count assertions never see demo rows; fix the schedule trade fixture to avoid pre-seeded shift overlaps; update mileage tests to the landed `review_required`-without-evaluation semantics (coordinate with the labor/payroll branch owner — this code was in flight on 2026-07-08).
Accept: full api suite green immediately after `db:seed` + demo seeds, no reset required, twice in a row.

### Prompt 4 — Seed the labor stack [Phase 0]
Mission: LCC, PayrollSelfCheck, PayrollReview, and Compliance demo with real-looking data.
Files: `packages/api/scripts/seed-mission-control-demo.ts` (extend), referencing `services/laborCommandCenter.ts:100-106`, `services/payrollPeriods.ts:607-632`.
Steps: seed `time_session`/`time_segment`/`clock_event` for ~8 employees across the current week (linked to seeded shifts/shoots); one open `payroll_period` + an open self-check window with 2 problem reports; 3 `mileage_reimbursement` rows in mixed states; 2 overtime warnings; a compliance story (replace the `deferred_areas` marker).
Do not: write legacy `shift_punch`/`time_entry` for the new stories; touch migrations.
Accept: fresh `db:reset:demo` → LCC shows employees/confirmations/blockers; self-check open for a seeded employee; PayrollReview non-empty.

### Prompt 5 — Kill the home fiction; honest home for every role [Phase 2, do early]
Mission: `#home` is live-or-labeled for every role; employees land on real work.
Files: `packages/admin-web/src/components/home/HomeCommandSurface.tsx`, `home/homeDemoData.ts`, `home/sportsDemoData.ts`, `home/CompanyNeedsAttention.tsx`, `home/MyWorkspaceHome.tsx`, `home/RolePreviewSwitcher.tsx`, `home/needsAttention.ts`, `app.tsx:2114-2159`, `workflowChangeNotices.tsx`.
Steps: (1) persona from the real session role; keep RolePreviewSwitcher owner/admin-only and visibly labeled "Preview"; (2) wire Needs Attention to the live exceptions read model (`home/urgentWindow.ts` pattern) and delete `DEMO_NEEDS_ATTENTION`; (3) apply the existing "Sample"/"Not connected" card patterns to Operating Areas / Attendance Risk / Reports strip or remove them; (4) employee + mobile bottom-nav home = live MyWork; delete persona workspaces; (5) delete the fabricated change-notices array feeding MyWork "Heads Up".
Do not: touch the three live cards or the Urgent Window read model; leave any interactive control persisting to localStorage.
Accept: grep shows no unlabeled `homeDemoData` consumer; a seasonal photographer's home is `#my/day`; acknowledgements hit the server.

### Prompt 6 — Job↔Shoot convergence slice 1: reviewed links [Phase 1]
Mission: execute the June-19 convergence plan (Option B): every active `jobs` row linked to its shoot(s); linkage enforced going forward.
Files: `db/migrations` (new), `packages/api/src/services/jobTruth/jobService.ts`, `services/centralJobIntake.ts`, `job_shoot_links` (`097:270`), `docs/jobs-shoot-convergence-audit.md` (the spec).
Steps: (1) backfill script proposing links via `jobs.legacy_shoot_id`, job_number, org+date matching — output a reviewable report, apply only reviewed matches with provenance columns; (2) on publish/create in either path, create the link row transactionally; (3) `jobsCanonicalIndex` and job detail expose `shoot_link_status` truthfully (already does — keep it honest); (4) unlinked-record report endpoint for ongoing hygiene.
Do not: merge the tables; change either intake's UX; delete any data; guess ambiguous links (leave them in the review queue).
Accept: 100% of active jobs linked or explicitly queued for review; new records cannot be created unlinked; count-parity test between `/api/jobs` dashboards and shoot-spine dashboards for linked work.

### Prompt 7 — One job-status vocabulary [Phase 1, after Prompt 6 decision]
Mission: one server-owned status language; frontend imports it.
Files: `services/jobTruth/jobStatusEngine.ts`, `db/migrations` (map/retire `shoot.job_status`), `admin-web/src/shootLifecycle.ts`, `types.ts`, `jobTruthTypes.ts`, `DepartmentJobAdapterUIRegistry.tsx:291,307`, the three list-page vocabularies (`SharedJobsPage.tsx:438-474`, `JobsIndexPage.tsx:402-408`, `SharedJobDetailPage.tsx:173-181`).
Steps: (1) publish the canonical union from one server module; (2) generate/import frontend types — delete the untyped `string[]` copies (restoring `intake_blocked` + the 7 missing production statuses); (3) map `shoot_job_status` values into the canonical set with a migration + compatibility view; (4) delete the frontend transition map in favor of server-provided allowed-transitions.
Accept: grep finds no locally-declared status arrays; filters offer every status the API emits; one vocabulary across both jobs lists and job detail.

### Prompt 8 — One time truth + one payroll exit [Phase 1]
Mission: dashboards and payroll read the same hours; one gated CSV.
Files: `packages/api/src/services/dashboard.ts:155-192`, `services/attendance.ts` (dual-writes :801,:1712,:2233), `services/timeClockRuntime.ts`, `admin-web/src/pages/Labor.tsx:483-486`, `pages/PayrollReview.tsx:226-228`.
Steps: (1) port `dashboard.ts` worked-hours to `time_session`/`time_segment`; (2) route both clock entry points through one write service (keep dual-write to legacy tables temporarily behind a flag, then remove); (3) remove the ungated CSV buttons from Labor.tsx and PayrollReview.tsx, replacing with a link to the LCC gated export + a banner naming it the payroll source.
Accept: fixture week where dashboard hours == payroll hours exactly; only one CSV endpoint reachable, and it 403s before owner review completes.

### Prompt 9 — Bounded endpoints + dashboard N+1 [Phase 0/7]
Mission: no unbounded list responses; dashboards stop doing ~600 sequential queries.
Files: `services/alerts.ts:5-23`, `services/jobTruth/checklistService.ts:2948-3040`, `services/homeDashboard.ts:612-747`, `services/locations.ts:362-413`, `services/scheduling.ts:680+,2307+`, `availabilityRequests.ts:1208-1227`, `jobService.ts:3474-3478,3506-3640`.
Steps: (1) LIMIT+default windows on alerts/shifts/trades/PTO/production-items/attendance-exceptions; (2) batch `listChecklistAttention` with `ANY($ids)`; (3) stop full location/evaluation scans on the home path (windowed query or short-TTL cache); (4) invert the `run_automation` default on `listProductionQueue`.
Accept: at seeded scale, no list endpoint over 500KB; `/api/jobs/dashboard/home` issues a bounded query count (add a query-counter test); existing behavior unchanged for current callers.

### Prompt 10 — Jobs list at scale: adopt the canonical index [Phase 2/7]
Mission: one jobs list with true counts and pagination.
Files: `pages/SharedJobsPage.tsx`, `pages/JobsIndexPage.tsx`, `components/jobs/JobOperationalCommandPanel.tsx:154-190`, server `jobsCanonicalIndex.ts` (already paginated), new by-id workflow endpoint in `routes/workflows.ts`.
Steps: (1) migrate SharedJobsPage's data + stat tiles to `/api/jobs/index` server totals (or retire it in favor of JobsIndexPage per the Phase-2 one-list decision); (2) add `GET /api/workflows/command-center/job/:jobId`; the panel fetches one row, not 200; (3) show true totals beside any remaining capped list.
Accept: with 1,000 seeded jobs, tiles equal server-side counts; the 201st job's panel resolves; no client-side `.filter` over a truncated window remains on these pages.

---

## Final acceptance check (per the audit brief)

1. Repo state documented — ✅ Setup Note. 2. Three scout reports produced — ✅. 3. Synthesized report — ✅ (this file). 4. One-OS answer — ✅ (§1/§4: no; two spines). 5. Duplicated effort / competing truths — ✅ (§4, Scout A §3). 6. Evidence-backed findings — ✅ (§3, all cited). 7. Role-based confusion — ✅ (§5). 8. Workflow gaps — ✅ (§6). 9. Runtime/browser QA where possible — ✅ with explicit browser-gap disclosure (§9). 10. Security risks — ✅ (§8). 11. Test gaps — ✅ (§10). 12. Phased roadmap — ✅ (§14). 13. Paste-ready prompts — ✅ (§15, 10 prompts). 14. No app code changed — ✅. 15. Blunt, specific, prioritized — reader's call, but nothing was softened.
