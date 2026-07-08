# Mission Control — Scout B: UX & Role-Workflow Audit

Date: 2026-07-08
Auditor: Scout B (UX / role workflows), three-agent full-system audit
Repo: `C:\Dev\Codex-integrated-baseline-clean` @ `fe5853e8` (branch `feature/work-spine-foundation-v1`, clean tree)
Method: code-level UX inspection — router/nav source, page components, seed/demo data, deep-link construction. Six parallel area sweeps + first-hand verification of every load-bearing claim. No app code modified; no servers started; no DB writes. All paths below are under `packages/admin-web/src\` unless prefixed.

The bar applied throughout: **"easier and more useful than Monday.com"** for the real people who run Kemmetmueller Photography — not "renders without errors."

---

## 0. Executive summary

Mission Control is **two products sharing one shell**:

1. **A genuinely live operating system** — Urgent Window, Exceptions, MyWork, Shared Job Command Center family, Schools hub, Schools Leadership board, Jobs index/detail, canonical Directory, Concierge search, Labor Command Center. These fetch real API data, have honest empty/error states, and mostly deep-link with real IDs.
2. **A demo veneer** — the default `#home` landing surface (Company Command "Needs Attention", Operating Areas pulse, Attendance Risk, Reports strip, the Sports Command Center, and the entire photographer/CSR/graphic-artist "My Workspace") is **hardcoded fiction** (`home/homeDemoData.ts`, `home/sportsDemoData.ts`) rendered without any "Sample" labeling on most panels, with interactive controls (checklists, acknowledgements) that mutate only local React state and evaporate on reload.

The dangerous part is that the fiction sits on the **front door**. The live system is one route away and shows *different numbers* for the same concepts. A leadership user comparing `#home` ("Staffing Risk: 3", "Late / Not Clocked In: 2" — both literals, `home/homeDemoData.ts:234-249`) with the live Executive Dashboard will conclude the product cannot be trusted — and they'd be half right.

Second structural theme: **the live pages report problems well but rarely hand the user the next action.** Missing-info items say "Request the roster from the school" as plain prose with no link (`pages/SharedJobDetailPage.tsx:780`); job detail has no scheduling button; intake dead-ends on missing directory records with non-clickable "Open it in Directory" text; MyWork's queue buckets are counts without click-throughs. Monday.com's core virtue — click the thing, act on the thing — is not yet consistently matched.

Third theme: **too many front doors, too many vocabularies.** Five day-starting dashboards, two "Needs Attention" features that are unrelated systems, two competing Jobs lists with three stage vocabularies, six-plus production surfaces, and engineer vocabulary ("canonical", "continuity", "service truth", "exceptions", "watch flags") shipped in user-facing strings.

Verdict preview (full version in §8): the spine is real and better than Monday.com in specific places (Urgent Window's count-integrity pattern, Schools Leadership honest-contract board, canonical directory, Concierge search, Labor Command Center). But as shipped — intake feature-flagged off, home page fabricated, next actions non-clickable — Jessica would keep Monday.com open in the next tab, and a seasonal photographer would text their lead instead of trusting the app.

---

## 1. Navigation & information architecture (first-hand)

### 1.1 The shell

- 13 top-level sections (`navigation.ts:147-226`): My Dashboard, Schools, Sports, Photography, Production, Production Tracker, Jobs, Directory, Schedule, Employees, Leadership, Settings, Admin — over ~130 route definitions (`navigation.ts:228-1930`).
- Visibility is tab/permission-driven (`getPrimarySections`, `navigation.ts:1992-2009`); photographers get a reduced "employee-only" shell whose default route is My Work (`getDefaultRouteId`, `navigation.ts:2037-2048`).
- Mobile: employee-worksurface users get a bottom nav — My Dashboard / Schedule / Requests / More (`app.tsx:2114-2135`) with a "More" sheet (`app.tsx:2137-2159`). Everyone else gets the desktop sidebar even on mobile widths.
- **Mobile defect:** the bottom-nav "My Dashboard" routes to `dashboard` (`app.tsx:2120`) → `HomeCommandSurface` → the **fabricated** `MyWorkspaceHome` (see §2.3), not the live MyWork page. The field photographer's most-tapped button lands on fake data; their real page (`dashboard-my-day`) is buried in the "More" sheet (`app.tsx:2139`).
- The Leadership section alone carries 15 child routes (`navigation.ts:1964-1980`); an owner sees all 13 sections. This is a lot, but the sectioned sidebar + Concierge (Cmd+K) makes it navigable. The bigger problem is *redundancy*, not volume (see §1.2).

### 1.2 Competing front doors (fan-out confirmed by area sweep)

Five surfaces claim "start your day here":

| Route | Page | Claim |
|---|---|---|
| `#home` | `HomeCommandSurface` → CompanyCommand / MyWorkspace / SportsCommand (`pages/Dashboard.tsx:12-14`) | default landing for full-shell users |
| `#my/day` | `MyWork` (`pages/MyWork.tsx:180-199`) | default for employee-only users, live API |
| `#operations/today` | `OperationsTodayPage` → SharedJobCommandCenter | "Today" |
| `#executive` / `#leadership` | `ExecutiveDashboardPage` → SharedJobCommandCenter | Leadership Dashboard |
| `#teams/home` | `TeamsHomePage` | Teams-embedded front door, live |

Plus four more "what needs attention" queues: `#urgent-window`, `#exceptions`, `#tasks`, `#notifications`. ExecutiveDashboard / OperationsToday / `#home` Company Command overlap ~70% in mandate but draw from **different data models** — the SharedJobCommandCenter family is live API; `#home` is demo literals — so their numbers contradict each other.

**Two unrelated features are both named "Needs Attention":** the demo incident list on `#home` (`home/CompanyNeedsAttention.tsx:42`) and the Compliance page retitled "Needs Attention" at `#needs-attention` (`pages/Compliance.tsx:263,973-985`; nav label `navigation.ts:1360`). "Go check Needs Attention" is a coin-flip instruction.

### 1.3 Identity theater on the home page

The `#home` persona is chosen by a **localStorage demo switcher, not auth**: `RolePreviewSwitcher` persists `pmc-home-demo-role` (`components/home/HomeCommandSurface.tsx:24-52`; `home/RolePreviewSwitcher.tsx`), and `home/homePermissions.ts:3-6` admits gating is "frontend-only for the demo." Any associate can flip to "Viewing as: Matthew / Owner" and render leadership panels. `defaultHomeRoleForUser` (`home/homeRoles.ts:72-88`) maps every real photographer to the fictional "seasonal_photographer" persona, CSRs to a fictional "csr" persona, production staff to "graphic_artist."

### 1.4 Search — a real strength

Concierge (Cmd+K and `#search?q=`) is a real, API-backed, permission-aware global search with typed filters, saved searches, grouped results, and answer cards (`pages/ConciergeSearchPage.tsx:10-36`; `components/concierge/ConciergeCommandPalette.tsx`, backed by `services/conciergeApi.ts`). This genuinely beats Monday.com's search. Minor: the header meta pills ("Permission aware", "Saved searches") are static labels styled like live status badges (`ConciergeSearchPage.tsx:27-32`).

---

## 2. The daily-driver surfaces (Dashboard / MyWork / Alerts / Tasks / Urgent)

### 2.1 `#home` Company Command — half honest, half fiction, unlabeled

The top card row is now honest-contract (Phase 1 work landed): 3 of 8 cards live ("On Fire", "Jobs Behind", "Production Load" — `home/CompanyCommandHome.tsx:25-75,193-200`), 3 carry a visible "Sample" badge ("Shoots Today: 18", "Staffing Risk: 3", "Late / Not Clocked In: 2" — badge render `CompanyCommandHome.tsx:180-182`), and 2 render honestly disabled "Not connected" (Weather, Client Issues — `CompanyCommandHome.tsx:158-169`; `home/actionTargets.ts`). The live "On Fire" count is derived from the same function its destination renders (`home/urgentWindow.ts:202-208`) — card and page can never disagree. **This is the pattern the whole app should copy.**

Everything below the card row is unlabeled fiction:

| Panel | Content | Labeled as sample? |
|---|---|---|
| Needs Attention | 9 invented incidents with realistic copy ("Edina Soccer photographer not clocked in… Call time passed at 3:15 PM") | **No** (`home/homeDemoData.ts:82-205`, rendered `home/CompanyNeedsAttention.tsx:41-64`) |
| Operating Areas pulse | hardcoded issues/owners for all 7 areas | **No** (`homeDemoData.ts:303-373`) |
| People / Attendance Risk | 5 fictional employees; "Call / replace / notify lead" is plain text, not a button | **No** (`homeDemoData.ts:377-436`; `home/AttendanceRiskPanel.tsx:36`) |
| Reports strip | 9 hardcoded KPIs incl. three "Coming soon" integrations | **No** (`homeDemoData.ts:494-504`) |

And the one record affordance on the page is still broken: `RelatedJobLink({ jobName })` discards the job ID and hardcodes `href="#jobs"` (`home/homeShared.tsx:40-47`) — the exact defect the Phase 0 actionability audit called "the single most pervasive defect" (`docs/mission-control-actionability-audit.md` §3) remains unfixed on this surface.

### 2.2 The live command-center family — good bones, some noise

`#executive`, `#operations/today`, `#exceptions`, `#notifications` all wrap `components/jobs/SharedJobCommandCenter.tsx`, which is genuinely API-backed (`getSharedDashboard` / `listSharedAlerts` / `listSharedExceptions`, lines 991-1026, 1310-1325, 1391-1408) with specific empty states, loading blocks, and error banners.

- **Deep links carry real IDs**: `toJobHash` builds `#schools/jobs/{id}` / `#sports/jobs/{id}` / `#jobs/{id}` (lines 111-123); checklist rows deep-link `?item={production_item_id}` and `?checklist_state=…`, which the production board actually parses (`components/jobs/SharedJobProduction.tsx:484-498, 3758`). Click depth dashboard → job detail: 2 clicks.
- **Dead filter bug:** the Critical Issues banner navigates to `#exceptions?critical_high_only=yes` (`SharedJobCommandCenter.tsx:247`) but the exceptions page never reads hash params (filter state initialized from props only, line 1377; only other occurrence of the key is the checkbox label at 1457). The promised pre-filter silently doesn't happen.
- **Silent fallback:** `toJobHash` returns `#dashboard` when a flag has no job id (113-115) — "Open Linked Record" can dump you back on the dashboard unexplained.
- **Noise:** ~15+ card frames of equal visual weight; "Priority Exceptions" heading appears twice on the same page (1234 and 633). One-click "Resolve" on alert cards writes a canned note "Resolved from alert center" without confirmation (1352).
- **No pagination** on Exceptions (renders all `payload.items`, 899-921); Notification Center hard-caps at `limit: 100` with no pager (`pages/Alerts.tsx` wiring, line 1313).

### 2.3 MyWork (`#my/day`) — the best live employee page, with blunted edges

Live (`fetchEmployeeMyWork`, `pages/MyWork.tsx:101-113`) with socket refresh (156-176), launchpad tiles, week strip, workflow steps with per-step deep links (`step.deep_link`, 773) and an inline status mover. Issues:

- The header's primary action reads "**Clocked Out**" but is actually a nav link to the org-wide attendance page (`MyWork.tsx:187`) — status-shaped, link-behaving.
- "My Operating Queue" buckets are counts with **no click-through** (376-393).
- Overflow line "N more items available in the detailed workspace" is not a link and names no destination (692-720).
- Three task-like vocabularies coexist: "Assigned Tasks" tile, "My Tasks" page, "Workflow Steps Waiting on Me."

### 2.4 Tasks

`#tasks` (`pages/DashboardMyTasksPage.tsx`) has live counts with partial-failure honesty ("Some task counts could not be refreshed", 138-139) — but every count derives from a `limit: 25` fetch (90-95): **a user with 60 open tasks sees "25"** with no "25+" marker. My-task list caps at 6 with no "view all" personal list. Task detail (`pages/SharedTaskPage.tsx`) is a real create/edit with policy-driven read-only, but a permanent "Operating Model — One workload model, four distinct objects" education panel sits above the form on every visit (377-398), and Cancel always goes to `#home` (631) even when you came from `#tasks`.

### 2.5 Urgent Window (`#urgent-window`) — the best page in the product

Fully live from `GET /api/exceptions` (`pages/UrgentWindowPage.tsx:157-179`; read model `home/urgentWindow.ts:150-208`), honest provenance chips ("Live · tracked"), disabled-with-reason for unconnected categories (Client Success, Weather — `urgentWindow.ts:42-54`), URL-state filter/focus that survives refresh (`urgentWindow.ts:258-282`), permission-aware "Assign to me", and count-integrity with the home card. Gaps: no pagination; the eyebrow says "Company Command" (234), feeding the naming tangle.

---

## 3. Schools, Directory, Job Intake (Jessica's world)

### 3.1 Schools hub (`#schools`) — live data, heuristic dressing

All six data sources are real API calls with per-source error capture and an honest full-block retry panel (`pages/SchoolsHub.tsx:1047-1114, 1540-1552`). But:

- **KPI cards are keyword guesswork.** Job type is inferred by matching `"retake"|"graduation"|"yearbook"|"picture"` in title strings (`SchoolsHub.tsx:575-596`); exception lanes bucket on whether text contains `"gallery"`, `"missing"`, etc. (402-420); the "ID Card Tracker" strip regex-matches "id"/"badge" (570-573, 1520-1537). Counts are wrong whenever a title lacks the magic word — fake precision presented as KPIs.
- **The Daily Board silently truncates to 14 rows** (`SCHOOLS_OPERATING_BOARD_ROW_LIMIT`, 144, applied 1152) and hub KPIs like "Active School Work" count only those ≤14 rows (1179-1183) — a hub-level number that isn't the real total.
- Hardcoded personal names in product copy: "…need **Jessica's team** to move work forward" (1354); `FALLBACK_INTERNAL_OWNERS = ["Jessica","Josh","Spencer","Dylan","Greta","Jared","Matthew"]` (`components/directory/DirectoryActionForms.tsx:166`); `Schools: "Jessica"` (`components/jobs/JobRoutingFoundation.tsx:299`).

### 3.2 Schools Leadership (`#schools/leadership`) — the exemplary surface

`pages/SchoolsLeadershipOperations.tsx` is the honesty standard: server counts always shown even when rows are windowed to 12 (35, 200-204); unavailable categories render "Not connected yet" with the backend's reason instead of a fake zero (143-153); action buttons render only when the server says `can_act` (209-224); rows carry server-supplied `exact_destination_hash` deep links (213, 220); CSR all-scope handled (67-78).

### 3.3 Job intake — dark by default, dead-ends when lit

- **The intake flag is off.** "New School Job" / "Resume Drafts" render only under `featureFlags.centralJobIntakeV1 && canCreate` (`SchoolsHub.tsx:1572-1581`); `featureFlags.ts:10` defaults false via `parseBooleanFlag` (fallback `false`, lines 1-8) and `.env.example:150` ships `VITE_CENTRAL_JOB_INTAKE_V1_ENABLED=false`; `docs/feature-flags.md:12` says keep disabled. **As shipped, Jessica has no create button anywhere on the Schools hub.**
- The cascade itself is real where mounted: district select genuinely parent-scopes the school list server-side (`components/jobIntake/QuickCreateJobDrawer.tsx:610-632, 207`); locations/contacts come from the selected org (107-108); service term is fetched per school (334-343) — but is **display-only, never written into the intake payload** (no service-term field in `jobIntakeFormState.ts`).
- **Missing-data dead ends:** the Directory's inline "+ New person" / "+ New location" selectors exist (`CanonicalContactSelector.tsx:192`, `CanonicalLocationSelector.tsx:186`) but are never mounted in intake; the intake empty states say "Open it in Directory to add or link…" as **non-clickable helper text** (`QuickCreateJobDrawer.tsx:674-677, 694-697`). Jessica must abandon the drawer and hunt.
- **Schools got the crippled intake.** Smart Paste and the 5-step CSV Import are real pipelines, but their launcher card is mounted only on `pages/SportsShoots.tsx:201-211` with a hardcoded `#sports/shoots/import` hash. Schools has no route to either.
- Duplicate-warning "Open Owning Job" always routes to `#operations/shoots?shoot=…` even for schools duplicates (`components/jobIntake/JobIntakeFields.tsx:1096-1099`).
- One long single-scroll drawer, ~30+ fields across 7 sections (`QuickCreateJobDrawer.tsx:576-807`); validation is server-side only (310-332). Drafts persist and resume server-side; publish auto-navigates to the created job (`SchoolsHub.tsx:2057-2087`) — good.

### 3.4 Directory — canonical spine real; scale, merge, and "approved" are not

- Search + category/status filters work; a specific school is one search away (`components/directory/DirectoryRail.tsx:227-265`). But there's no district filter on Organizations, and **500+ orgs render 500+ DOM rows** — unbounded `.map` with no pagination/virtualization (`DirectoryRail.tsx:419,443,485`; `pages/Organizations.tsx:1088-1135`). `DirectoryRecordDetailPage.tsx:105-106` loads the entire location list to `.find` one record.
- **Merge is scaffolding:** "Merge execution still stays out of the UI until the backend path is safer" (`DirectoryWorkspace.tsx:1065`); the Duplicates tab records decisions but cannot merge (1093-1113); nothing blocks creating duplicate orgs (name is the only required field, `DirectoryActionForms.tsx:318,601`).
- **"Approved locations" is fake completeness:** headers claim "Approved canonical locations" / "No approved locations yet" (`pages/DirectoryRecordDetailPage.tsx:324-343`) but no approval state or gate exists anywhere.
- Atomic org creation (org+brand+service term+contacts+locations in one transaction) is real (`Organizations.tsx:1007-1029`) — but a school's parent district cannot be created inline (`DirectoryActionForms.tsx:349-357`).
- **School→jobs navigation doesn't exist in either direction:** the hub's per-row "Account" button goes to bare `#schools/accounts` (`SchoolsHub.tsx:722,1502-1506`), and Directory's "Open Jobs database" is unfiltered `#jobs` with no org id (`DirectoryWorkspace.tsx:1342`).

### 3.5 Job detail — answers "what/status/owner", fails "what's next"

`pages/SharedJobDetailPage.tsx` renders a genuinely rich record: Job Truth Snapshot (537), Progress (715), Missing Info Checklist (612), Calendar Readiness (634), Definition of Done (678), tasks/notes/evaluations/production handoff, Prior Intelligence (1266), Location Intelligence, approvals, activity (844-892). But:

- **Every "next action" is prose.** Checklist items render `<p>{item.nextAction}</p>` (780) — "Request the roster from the school." (`jobMissingInfoChecklist.ts:302`) with no link to where to do it. Biggest single workflow gap for CSRs.
- **No scheduling link from job detail** — "Calendar Readiness" and "Next scheduling action" are prose only (634-649). From the jobs list, "Open Schedule"/"Open Staffing" exist only when `shoot_link_status === "linked"` (`pages/JobsIndexPage.tsx:490-504`); unlinked jobs' whole scheduling/staffing chain is dead.
- Cancel/Postpone/Archive use raw `window.prompt`/`window.confirm` (465-470). "Confirm details" persists to **localStorage only** (487-499) — invisible to colleagues; fake persistence. The Definition-of-Done ladder shows stages the system admits it does not track ("live in Captura/admin today", 183-186, 701-703).
- **Two competing jobs lists ship simultaneously** — server-driven `JobsIndexPage.tsx` (`#jobs?selected=`) vs client-filtered `SharedJobsPage.tsx` (`preview=`) — with **three different stage vocabularies** (`SharedJobsPage.tsx:438-474` vs `JobsIndexPage.tsx:402-408` vs `SharedJobDetailPage.tsx:173-181`).
- Intake Review Queue renders "Open intake" / "Request missing info" / "Assign owner" as `<em>` text with no handler (`SharedJobsPage.tsx:525-530,819`) — dead-looking affordances that are actually dead.

### 3.6 Historical / location intelligence — half-wired, half-hardcoded

- **"Prior Job Intelligence" is a hardcoded demo array** that only matches org IDs `"org-school"` / `"org-sports"` (`jobPriorIntelligence.ts:36-153`) — permanently empty for every real school, yet renders as a job-detail section (`SharedJobDetailPage.tsx:837,1266`). Flagship fake completeness.
- Location history is real (`getShootLocationIntelligence` via `components/location/LocationHistorySurface.tsx:51`) and mounts in the intake editor with a calm "Known history available" strip (`SharedJobEditorPage.tsx:930,1099`; `LocationHistorySurface.tsx:97-113`) — good — but on job detail it sits ~10 sections deep, and the Directory location record's "Location Intelligence" card just deep-links away (`DirectoryRecordDetailPage.tsx:448-462`).

---

## 4. Sports, Photography/Staffing, Schedule, Shoot Day, Evaluations (Josh's and Carisa's world)

### 4.1 Sports hub — real spine, orphaned legacy, one duplicated vocabulary

- `pages/SportsOverview.tsx` is **real** (six parallel API calls, 442-448, per-source error state 44-60) and risk-sorted with owners — but it stacks ~12 sections (Department Brief, Hub cards, Job Spine, Daily Board, Ops Health, Peer QA, two panels *both titled* "Sports Active Work" at 858 and 869, Today board, Graphics, Work Records, Signals). An operating view buried in a data dump of operating views.
- **~1,270 lines of orphaned UI:** `pages/SportsShoots.tsx` and `pages/SportsShootDetailPage.tsx` are imported only by a test; `#sports/shoots` and `#sports/shoots/<id>` are silently remapped to the shared jobs list/detail (`navigation.ts:2306-2316`, route renders at 862-892). The entire sports command-center tab set (Readiness/Staffing/Teams/Proofs/Products/Financial, `SportsShootDetailPage.tsx:68-78`) is unreachable. The dead code's View selector offers Calendar/Kanban/Timeline but renders the identical table regardless (263-268, 314) — a fake option set, fortunately unreachable too.
- Live pages still deep-link into the legacy alias: `SportsAccounts.tsx:251` and `SportsProduction.tsx:182` link `#sports/shoots/${id}` and depend on the alias resolving sports-shoot id == shared job id.
- `pages/SportsReports.tsx` self-describes as thin: "This route is wired and ready for deeper reporting, but it currently exposes the starter metrics only" (75); every KPI links to the same unfiltered `#sports/shoots` (68). `pages/SportsSettings.tsx` claims "Leadership and admin controls" (61) but is display-only — no editing whatsoever.
- **A named human is baked into the schema/UI:** Peer QA status `ready_for_spencer_review` → "Ready for Spencer Review", `?? "Spencer"` fallbacks, "Stamp Spencer Approval" button (`pages/SportsPeerQaBoard.tsx:43,53,153,300,380-381,501,518`). When Spencer changes roles this is schema+UI surgery.
- Sports Command Center home persona is fully fabricated, including a **net-new concept the file admits doesn't exist**: "Rebooking and the current-vs-next-season split are net-new (absent in the codebase today)" (`home/sportsDemoData.ts:2-4,68-77`).

### 4.2 Staffing lifecycle — the strongest workflow in the product

Request → assign → publish → acknowledge/decline → replacement exists end-to-end:

- Assign: `pages/StaffAssignmentBoard.tsx` — live staffing dashboard (132), gap-scored coverage (95-102), socket refresh with monotonic request guard (114-158), `ShootStaffingCommand` drawer (370). Deliberate state-coherence documentation (`pages/staffingBoardState.ts:3-19`).
- Publish/version discipline: "Draft Changes — Republish Required (since version N)", "Coverage Complete — Confirmation Pending/Overdue" (`pages/staffingLifecyclePresentation.ts:17,27-29`). Notification copy is honest by design: "notification queued… never claims individual delivery, channel, success, or a read receipt" (96-102).
- Photographer accept/ack is real and clear: `components/EmployeeStaffingConfirmations.tsx` on MyWork (`pages/MyWork.tsx:206`) — Acknowledge, Decline-with-required-reason modal, "You are not removed from the schedule until they confirm the change" (238-281, 249-251); notification deep links `#my-work?focus_shoot=<id>` scroll+highlight (74-84); declines flow back to the board via `?shoot=` (`StaffAssignmentBoard.tsx:41-52,185-202`).
- Capacity: `pages/StaffingCapacityPlanning.tsx` — hash-as-source-of-truth filters, per-assignment lifecycle badges, honest subtitle "Not payroll, actual, or worked time" (231, 686-715).
- **Break points:** (a) the Home demo "Acknowledge" buttons imitate this exact flow but persist nothing (`home/MyWorkspaceHome.tsx:108-114`) — a seasonal hire can believe they acknowledged a real change; (b) delivery is aggregate-only; (c) `pages/Scheduling.tsx` exposes raw `Rate Code` / `Hourly Rate (cents)` inputs on the manager's schedule-draft form (1210-1218) — payroll plumbing leaking into scheduling UX.

### 4.3 "Where am I tomorrow, what time, what gear, who's lead?"

- Where/when/lead: answerable on MyWork (week strip with time/title/location; "Lead:" on expand — `pages/MyWork.tsx:273-311`) and the Photography **Travel** panel is genuinely good field UX: "Where Am I Going?" + Google Maps link + Schedule/Parking/Contact/Crew/Field Notes (`pages/PhotographyWorkspace.tsx:906-929`).
- **But Travel/Prep job pickers are not scoped to the photographer** — they load *all* non-archived jobs and cap the dropdown at 8 (`listSharedJobs(token)` at 406/790; `jobs.slice(0, 8)` at 513/884). On a busy week your shoot may simply not be in the picker.
- **Gear: unanswerable.** Zero gear references in PhotographyWorkspace, MyWork, Schedule, or the prep packet (grep: 0 matches). `pages/Gear.tsx` is a full real module (dashboard/assets/kits) but an island — the prep packet never says "bring Kit 7." A Travel card exists solely to explain an absence: "Leadership Staffing Context — Leadership handles staffing… so this page stays focused on field travel" (925-928).
- Photography is mid-rename: `StudiosWorkspace` with `export const PhotographyWorkspace = StudiosWorkspace` marked `@deprecated` (`PhotographyWorkspace.tsx:1407-1411`); hashes are `#studios/*` while labels say "Photography."

### 4.4 Post-shoot evaluations — real, and it feeds forward

- `pages/JobCloseoutV1.tsx`: lead mode ("about two minutes on a phone") vs associate mode ("30 to 45 seconds") (377); real submit (198); shoot check-ins ("We are good"/"Issue", 352-360); mileage self-report (548-578). Feature-flag gated (`featureFlags.jobCloseoutV1`, 244-255).
- **Not a dead end:** results feed `latest_evaluation`, open flags, the mileage review queue, and next year's pre-shoot brief (`jobCloseoutTypes.ts:138-144`; "Today's closeout starts the account memory", `JobCloseoutV1.tsx:586-606`); prep surfaces `post_shoot_eval_summary` in "Past Shoot References" (`PhotographyWorkspace.tsx:680-682`). This is the best account-memory loop in the product.
- **Broken promise:** "Senior Review" (`#studios/workload`) promises "post-shoot evaluation highlights, customer feedback, and coaching opportunities" (`PhotographyWorkspace.tsx:80-82`) but renders only generic active-work + department queue panels (208-231) — no evaluation data appears; the claim is hardcoded as a static string ("Post-shoot evaluations feed Senior Review.", 727).
- Discoverability: with no jobId the closeout page tells the user to hand-construct a hash: "Use `#job-closeout/jobs/<job-id>` from a canonical job detail page" (296-299).

### 4.5 "Photography Change Notices" — fiction mixed into a live feed

`workflowChangeNotices.tsx:52-389` is a hardcoded demo array (fake staff "Carisa Lead"/"Josh Sports"/"Spencer Production", fake job "Maple Grove Baseball Media Day" SP-2042, deep links to nonexistent `#sports/shoots/job-sports-1`). Acknowledgement persists to **localStorage only** (464-467). It renders on the live Photography overview (`PhotographyWorkspace.tsx:116-125,148-154`) **and feeds MyWork's "Heads Up"** (`pages/MyWork.tsx:23-26,93`) — fabricated notices interleaved with real operational data on the employee's live daily page. Highest-priority fake-completeness item after the home page.

---

## 5. Labor, Payroll, Compliance, Mileage — and the demo-seed reality

### 5.1 Labor Command Center — the honesty model, undermined by an empty seed

- The owner flow explains itself: lifecycle map mirrors the server, only legal next steps are offered, owner-only transitions hidden from non-owners (`pages/LaborCommandCenter.tsx:36-49,160-162`); blockers panel renders before tables (223-241); stat row "X of Y employees confirmed / open problem reports / overtime warnings / payroll-ready" (196-213); real loading/error/retry (135-154).
- **QuickBooks honesty is exemplary, not fake:** "Direct QuickBooks sync is scaffolded but not connected" (491-496); "QuickBooks Online is not connected (scaffolding phase…). The CSV export above is the working handoff today" (568-573); Send disabled unless `connection_status === "connected"` (546-559); server transport deliberately throws "not implemented yet… Use the CSV export" (`packages/api/src/services/quickbooksIntegration.ts:360-380`). This is the pattern the home page should have used.
- Gaps: two blockers ship `hash: null` ("Unresolved self-check problem reports", "Sessions edited after payroll review", 166-168) — a count with no "Review" path; pay codes render as raw enum keys via `code.replace(/_/g, " ")` (278) with no label map (contrast the friendly `PERIOD_STATUS_LABELS`, `services/laborCommandCenterApi.ts:228-238`); the event log shows raw `event_type` and `from_status → to_status` machine strings (592-596); non-payroll-admins who load before a period exists get a raw error with no "wait a minute, the sweep creates it" explanation (98-104 vs `packages/api/src/routes/labor.ts:265`).

### 5.2 Three competing payroll CSVs — a compliance trap

Three leadership surfaces each export their own CSV: `pages/Labor.tsx:483-486` (four export buttons incl. "Payroll View CSV"), `pages/PayrollReview.tsx:226-228` ("Download Payroll CSV"), `pages/LaborCommandCenter.tsx:514-525` ("Generate payroll CSV"). **Only LCC's is gated by the approval lifecycle.** Nothing tells the owner or office staff which CSV feeds payroll; an office person could hand QuickBooks an unreviewed Labor.tsx export.

### 5.3 PayrollSelfCheck (employee) — genuinely good; but no always-on "my hours"

Day-by-day review with plain language ("A 30-minute break was auto-deducted… If you did not get a break, report it", `pages/PayrollSelfCheck.tsx:292-295`), honest closed-window state explaining the 72-hour cadence (221-234), confirm gate with reasons (396-413). **Caveat:** outside the self-check window employees have no way to see their hours; `pages/MyAccount.tsx` contains no time clock and no hours at all (133-330) — the clock lives in the header `GlobalPunchControl` and the shift detail panel (`components/EmployeeShiftDetailPanel.tsx:1534-1569`), not where a normal employee would look. Meanwhile the fake home-workspace "Time Clock" card shows static "Not clocked in" text (`home/homeDemoData.ts` SEASONAL_TIME_CLOCK) — two clocks, one real, one fiction.

### 5.4 PayrollReview & Compliance

- `pages/PayrollReview.tsx` mechanics are solid (filters, per-employee sessions/segments drill-in, exception approvals, mileage kept separate — "mileage remains separate from labor hours", 517; empty states at 334/388/459/491/508). But the vocabulary is for engineers: header "Canonical payroll review desk… canonical labor-state model" (196-199); a card literally titled "Source Of Truth" showing `canonical_labor_state` (260-266); "Legacy comparison mismatches / Legacy drift" (251-258). Office staff cannot act on "legacy drift."
- **Dead-looking action cards:** `components/OperationalPreviewCard.tsx:74-106` renders "Next: **Open employee labor detail**" as text when no `onClick` is passed — and all four signal cards in `pages/Labor.tsx:228-251` are exactly that: action-shaped, non-clickable. The same cards ARE clickable in PayrollReview/Compliance, so users learn the pattern then hit the dead version.
- Compliance (`#needs-attention`) is the strongest reviewer UX in scope: every item carries blocker summary, "why it matters," urgency, "Fix in <workspace>", concrete next action per issue type (`pages/Compliance.tsx:953-970`); Payroll Impact / Mileage Impact make the money consequence explicit (556-601); honest truncation ("Use filters… to narrow the remaining N", 386-427). Mileage has no standalone page — it renders only inside PayrollReview, Compliance, EmployeeShiftDetailPanel, and JobCloseoutV1 (repo-wide grep).
- Rough edge: Attendance's corrected-time input placeholder is a raw ISO timestamp `2026-03-30T08:00:00.000Z` (`pages/Attendance.tsx:550`).

### 5.5 The seed gap — the newest features demo as unbuilt

Seed pipeline: `packages/api/scripts/reset-local-demo-db.ts:168-170` → `seed.ts` → `seed-mission-control-demo.ts` chain. Content is realistic (zero lorem ipsum) and date-relative (demo looks alive): 13 users with pay profiles, 5 base orgs + districts/accounts/locations/contacts, same-day shoots at `localTodayAt(15:00/18:00)`, 5 project-tracking jobs incl. overdue/blocked, 6 sports peer-QA jobs across every QA state, and — the richest storytelling — **17 Wayzata post-shoot evaluations spanning ~46 months** with client quotes and pinned location-memory notes (`seed-mission-control-demo.ts:998-1084`).

**But no seed touches the migration-165/166 labor stack:** grep of `packages/api/scripts` for `payroll_period|self_check|overtime_warning|payroll_export|quickbooks|time_session|mileage_reimbursement` matches nothing; the seed writes only legacy `time_entry` + `shift_punch` (`seed.ts:731-756,3516-3526`), while LCC/PayrollReview/SelfCheck all read `time_session` (`services/laborCommandCenter.ts:100-106`, `services/payrollPeriods.ts:607-632`). Consequences on a fresh `db:reset:demo`:

- Labor Command Center: "0 of 0 employees confirmed", "No employees with recorded time in this period yet" (`LaborCommandCenter.tsx:253-254`), empty everything — the owner's marquee new feature demos as a shell.
- PayrollSelfCheck: "Self-check is not open yet" for everyone (221-234).
- PayrollReview: "No payroll rows match these filters yet" (334); zero mileage reimbursements seeded.
- Compliance/Needs Attention: the seed **explicitly defers it** — `deferred_areas: ["compliance_workspace_specific_story"]` (`seed-mission-control-demo.ts:1196`).
- Alerts: seed deletes alert instances for demo shoots and inserts only rules (`seed.ts:2209,3031`).

---

## 6. Production & Client Success (Spencer's and Dylan/Greta's world)

### 6.1 Too many production surfaces; two share a name

Routed production surfaces: `#production` (ProductionHub), `#production-queue` (ProductionWorkflowQueue, label "Production Queue", `navigation.ts:640-648`), `#production/operations` (ProductionOperationsView, label **also** "Production Queue", `navigation.ts:1011-1019`), `#graphics` + aliases (SharedJobProduction, "Production Board", `navigation.ts:1022-1031`), `#project-tracking` ("Production Tracker"), `#files` (ProductionAssetsPage), `#sports/graphics`, and Sports Peer QA. Spencer cannot tell from labels which queue to open; nothing in-product explains hub vs queue vs board vs tracker.

### 6.2 Dead code that leadership still measures

`pages/ProductionProjects.tsx` (2,387 lines, with the 12-stage model `intake_pending…released_complete` at 139-152 and the workflow-rules guidance cards at 154-203) is **unrouted** — imported only by its test; the `#graphics/*` routes render SharedJobProduction instead (`app.tsx:1715-1760`). Yet Reports' "Production Trends" numbers are computed server-side from the `production_project*` tables (`packages/api/src/services/operationalReporting.ts:411-492`) and `RoleDashboardSurface.tsx:315` still calls `listProductionProjects`. **Leadership's production trend numbers come from a data model whose workspace is unreachable, while Spencer works in workflow runs/handoffs — two production truths.**

### 6.3 Precise-looking links that drop their filters

ProductionHub's At Risk/Blocked cards link `#production/qa?queue=blocked_queue&stage=blocked` (`pages/ProductionHub.tsx:78-95`), and nav canonical hashes bake in `?queue=…&stage=…` (`navigation.ts:1050,1074,1086,1098`). Those params were designed for the dead ProductionProjects page; the component actually rendered (SharedJobProduction) parses only `department/owner/workflow_status/health_state/…` (`components/jobs/SharedJobProduction.tsx:484-498`) — **never `queue` or `stage`**. Clicking "Blocked: 3" opens an unfiltered workspace.

### 6.4 The handoff spine — real, with gaps at both ends

1. Send: ProjectWorkflowMap gates "Send to Production" on the active step (`components/projectTracking/ProjectWorkflowMap.tsx:436,489-492`), API-enforced readiness (`packages/api/src/routes/workflows.ts:223,607`).
2. Intake: ProductionWorkflowQueue "What came in" lane; Accept → Claim → Mark Missing Info → Mark Complete → Return to Schools all wired to real endpoints with state guards (`pages/ProductionWorkflowQueue.tsx:211-234,484-494`).
3. **No real stage model**: lanes are keyword matching (`laneForItem`, 128-149: `text.includes("qa")`, `"ready to release"`); the queue table has **no sort control** — row order is whatever the API returns; priority exists only as derived chips on the Tracker (`ProjectTrackingFoundation.tsx:943-965`); lane cards preview 4 items, limit 50, no pagination (259, 343). Empty copy leaks dev-speak: "No real rows in this lane." (342).
4. **Canned mutations**: "Mark Missing Info" hardcodes `waiting_on_party: "school"` and a canned detail string — Spencer cannot say *what* is missing or that it's waiting on Photography; return-to-schools hardcodes `issue_flag: false` — Production literally cannot flag an issue on return (487-494).
5. Done→delivered: "Return to Schools" ends Production's view; client delivery is inferred from `release_status === "RELEASED"` (`ProductionHub.tsx:303-308,477-483`). No explicit "client received it" step.

### 6.5 Production Tracker slice — real Slice 1, honest about what's missing (mostly)

Works: live command-center payload, 4 view modes, rich preset/filter stack, clickable metrics, inline step advancement (`QuickWorkflowNextStepMover`) with board refresh, `#jobs/<id>` deep links, honest "no data vs filtered to nothing" empty states (`pages/ProjectTrackingFoundation.tsx:2250-2294,2101-2120,1835-1843`).
Stubbed/pending (matches the known Slice-1 scope): no side panel (inline row expansion only, 2072-2081); board lanes and area classification are keyword heuristics (`boardLaneForRow`, 685-699; area regex 389-416); no weight/capacity/acknowledgement/drag anywhere (grep: 0); **the "No Workflow Linked" filter can never match** because `buildJobBoardRows` keeps only rows *with* `workflow_run_id` (859-861 vs 1113-1119) — jobs without workflows are invisible on a page claiming "Company-wide view of active jobs" (2392); hard `limit: 100`, no pagination (2251); "Mine" filter falls back to full-name string equality (865-870). Demo rows are hidden by client-side title matching ("command layer job", 1105-1111) rather than a data flag.

### 6.6 Client issues — no end-to-end workflow exists

- Intake lives in Zendesk (external); Mission Control is read-only: "Ticket work still lives in Zendesk" (`pages/CustomerService.tsx:247-248`), and without credentials it shows **demo support health** with an honest banner and "Refresh Demo Data" buttons (127-131, 120; server defaults `provider_mode: "mock"`, `packages/api/src/services/zendesk.ts:270,345`). Ticket list caps at 12, no paging (51).
- Internal issues run through the exceptions engine with exactly three actions — `assign_owner`, `snooze`, `mark_handled` (`packages/api/src/routes/exceptions.ts:44-60`). Nothing client-facing.
- **"Client informed" does not exist anywhere** — repo-wide grep for `client_informed`/`notify_client`/"client notified" returns nothing; Client Command Center's own banner: "No external delivery in V1" (`pages/ClientCommandCenter.tsx:410`).
- Client Command Center itself is real end-to-end CRUD (dashboard, account detail, org/account/contact/service/note/task creation, readiness checks, timeline — 12-23, 242-360, 633-640) — a genuinely strong CSR surface that stops at the company's edge.

### 6.7 Reports / Profitability / Training / Approvals

- Reports is genuinely server-computed with per-source freshness panels, CSV export, saved views, PDF packet runs (`pages/Reports.tsx:70,93-112,139-216,327-347`; SQL in `operationalReporting.ts:313-592`) — modulo the F1 caveat that production trends read the dead model.
- Profitability is watch-signals, not a P&L, finance-gated, honestly empty until imports run ("Profitability imports and snapshots have not been populated yet", `pages/Profitability.tsx:286`).
- Training is real (profiles/catalog/quiz/signoff) but ships "Streak placeholder {round.streak_placeholder}" as literal UI text (`pages/Training.tsx:785`) and an admitted content gap ("Catalog Migration", 169-173, 712-726). **Training also breaks its own deep links**: it writes `#employees/training?employee=…` (910-920) but its parser only strips `#training`/`#people-ops/training` prefixes (893-900) — reload loses the selection.
- Approvals is real (trades/PTO/operational, decision actions, confirm dialogs).
- `#files` is labeled "Files" but renders a preset/background-pack/tool-license manager; nav itself admits "Temporary shared files compatibility surface" (`navigation.ts:1037`). `#schools/production` resolves to Schools *tasks*, not production (`navigation.ts:2261-2263`).

---

## 7. Monday.com replacement audit

### 7.1 What the docs claim vs what exists

`docs/phase5-monday-board-inventory-and-mapping.md` leads with its own caveat: **no real Monday exports exist in the repo**; only 2 of ~76 boards are known by real ID (Locations `7848036857`, Post-Shoot Evaluations `6159270943` — confirmed live in `packages/api/src/services/locationMonday.ts:8-9`); the other ~74 are mapped **by class** (All Schools → canonical org hierarchy + service terms; Initial Process → jobs + intake workflow; Yearbook/Gallery/Portal/Code Return → service enrollment + workflow runs, explicitly *not* per-board tables; reporting boards → rebuilt as views, never imported; duplicates → consolidate with human confirm).

Verification: **every claimed destination exists as a real route + rendered page** (organizations/contacts/locations detail routes, jobs, schools hub, project-tracking, workflow templates, production queue, reports — `navigation.ts:607-1205`, `app.tsx:1324-1620`). The importer framework, dry-run planner, sanitized fixtures, and operator panel (`components/MondaySchoolAdminPanel.tsx`, mounted in Admin → Integrations) are real. **The apply executor is intentionally not built** (pilot report §14). Formula/mirror/dependency/subitem columns are unsupported; attachments/comments are counted, not imported.

### 7.2 Monday capabilities with no MC equivalent yet

1. **Automation rule builder** — no if-then builder; `#admin/automations` is sync/retry health only (`navigation.ts:1702-1712`).
2. **Notification delivery** — Teams/Outlook delivery is scaffolded outbox only; owner-change notification "Not live" (`docs/schools-workflow-automation-parity.md:26-32`).
3. **Per-user saved board views / kanban / timeline configurability** — MC ships fixed queues (the Tracker has 4 view modes but no per-user saved views).
4. **Intake forms** — no public/external form capture; internal intake is flag-off.
5. **Calendar intake automation** (Outlook event → review item) — designed, not built.
6. The parity doc's own "Do Not Promise Yet" list includes "Full monday.com replacement" (lines 85-92).

### 7.3 Where MC already beats a Monday board (copy/keep)

- Urgent Window's count-integrity + provenance chips + disabled-with-reason (§2.5) — Monday cannot do "the number on the card is definitionally the number on the page."
- Schools Leadership honest-contract board (§3.2) — server-computed can_act, exact destination hashes.
- Staffing lifecycle with versioned publish + photographer ack/decline (§4.2) — Monday approximates this with status columns and prayer.
- Labor Command Center lifecycle gating + honest QB scaffold labeling (§5.1).
- Concierge search (§1.4), canonical directory with atomic org creation (§3.4), evaluation → next-year brief memory loop (§4.4).

### 7.4 Where a board/table is still the right answer (and MC's version is weaker)

- **A sortable, per-user-filterable jobs table.** Monday's core loop — see all rows, sort by any column, save my view — is not yet matched: two competing jobs lists with three stage vocabularies (§3.5), Production queue without sort (§6.4), Tracker capped at 100 with no pagination (§6.5).
- **Reference boards** (resources, SOPs) — resource library exists (`RecordResourcesPanel`/`ResourceLibraryPanel`) but training content is admittedly un-migrated (§6.7); Monday remains the de-facto SOP home until that closes.
- **What should become automatic from canonical data:** the ID-card tracker and job-type strips currently faked by keyword matching (§3.1) should be real fields on service term/job; recurring seasonal work (Monday's duplicated-board-per-season pattern) should be generated from `school_service_term` — the schema exists, no UI generates next season's jobs from it.

### 7.5 Role-based navigation reality (per-role map)

Mechanics: 26 tab keys filtered per user (`app.tsx:2023-2061`; employee-limited users clamped to 9 tabs at 2058); employee-only mode per `shouldLimitToEmployeeWorksurface` (`permissions.ts:1258-1265`); all roles land on "My Dashboard" (`permissions.ts:2339-2347`).

| Role | Mode | Sections | Landing | Approx. nav nodes |
|---|---|---|---|---|
| owner_admin | full | all 13 | `#home` (demo-persona Company Command) | **~76** (13 sections + ~63 children; ~137 route defs total) |
| admin / leadership | full | all 13 (Leadership section alone: 15 children, `navigation.ts:1964-1980`) | `#home` | ~70+ |
| senior_photographer | full | ~10 (no Sports w/o dept scope, no Admin) | `#home` | ~45-55 |
| photographer / associate | employee-only | ~8 section headers, mostly filtered children | `#home` → **fabricated My Workspace** | ~20-25 |
| office / CSR | **full shell** (reports.view counts as oversight signal) | ~9-10 incl. Schools ALL-scope + Sports ALL-scope (`permissions.ts:1503-1513,1587-1589`) + Leadership | `#home` → **fabricated CSR queue** | ~35-45 |

Redundancy findings: 4 nav items (Requests/PTO/Approvals/Availability) render the same `approvals` tab (`navigation.ts:1323-1381`); 5 leadership items (Reports/KPIs/Trends/Operations/Executive Summary) render the same `reports` tab (1546-1652); Schools Jobs/Tasks/Exceptions all render `schools-hub` (765,826,837); Training/Certifications/Readiness → same tab; 5 sales items → same tab. Orphaned: `dashboard-my-tasks` (`#tasks`) and `dashboard-payroll-self-check` sit under section key `"my-work"` which has **no SECTION_DEFINITIONS entry** (147-226) and is excluded from desktop nav groups (`app.tsx:1910-1941`) — reachable only by hash or home cards. Six asset sub-routes are hidden redirects to the same gear page (1231-1309). Label/id/hash disagreement: "Senior Review" = `studios-workload` = `#studios/workload` (585-593).

Feature-flag posture: `centralJobIntakeV1` OFF (no fallback); `jobCloseoutV1` defaults `!PROD` → **OFF in production builds** (hiding the evaluation flow that feeds the account-memory loop); `workflowTemplateBuilderV1` and `complianceWorkspaceV1` ON.

---

## D1. Role-based confusion report

### CEO/Owner (Matthew)
- **Needs:** is today safe, what's on fire, who needs help, is payroll right, are we ahead of Monday.com.
- **Gets:** `#home` Company Command — 3 live counts, 3 "Sample" counts, 2 "Not connected" cards, then four unlabeled fiction panels (§2.1); the real Executive Dashboard, Urgent Window, Reports, and Labor Command Center one nav-hop away.
- **Confused by:** contradictory numbers between `#home` and `#executive`; two "Needs Attention"s; 15-item Leadership section where 5 items open the same reports tab; three payroll CSVs where only one is lifecycle-gated (§5.2).
- **Will distrust:** the first time he calls someone about "Edina Soccer photographer not clocked in" and learns it's a demo row. That single moment can poison the whole product.
- **Duplicated effort:** cross-checking MC numbers against Monday/spreadsheets because Home and live pages disagree.
- **Change:** make `#home` 100% live-or-labeled (the card row already proves the pattern); collapse Home/Executive/Today into one leadership surface.

### Jessica (Schools Director)
- **Needs:** every school's picture day on track, what's missing, who owes what, next action per job.
- **Gets:** a live Schools hub + the exemplary Leadership board; a rich job detail; canonical directory; drafts that persist.
- **Confused by:** no create button (intake flag off, §3.3); "canonical/continuity/service truth" labels; keyword-guess KPIs and a 14-row "Daily Board" whose KPI counts aren't the real totals (§3.1); prose next-actions she can't click (§3.5); no school→its-jobs link in either direction (§3.4).
- **Will distrust:** the ID Card Tracker the first time a retake job titled "Fall follow-up" doesn't show in the "retake" lane; "Prior Job Intelligence" that's always empty for her real schools.
- **Duplicated effort:** re-keying school/contact/location data she can see in the drawer but can't create from it; keeping the Monday board for yearbook/gallery statuses (service-term config exists but generates no work).
- **Change:** turn the flag on with the missing-state links made clickable; replace keyword KPIs with real fields; one jobs list with one stage vocabulary.

### Josh (Sports Director)
- **Gets:** a live SportsOverview (12 stacked sections), real accounts/contacts/production/peer QA.
- **Confused by:** "shoots" vs "jobs" double vocabulary with silent aliasing (§4.1); his `#home` persona is a fully fabricated Sports Command Center including a rebooking pipeline the file admits doesn't exist; SportsReports links every KPI to the same unfiltered list; SportsSettings shows controls that don't edit.
- **Will distrust:** rebooking numbers, "Shoots This Week: 9" (a string literal), and any deep link that lands on the wrong record via the legacy alias.
- **Change:** delete the orphaned sports pages, keep one vocabulary, make his home the live overview.

### Carisa (Photography Ops)
- **Gets:** the best workflow in the product — staffing board, capacity planning, publish/ack lifecycle (§4.2); a genuinely good Travel packet.
- **Confused by:** "Photography Change Notices" mixing fake notices into real pages under her name (§4.5); `#studios/*` hashes for "Photography"; the Travel/Prep pickers showing 8 arbitrary jobs instead of assigned ones.
- **Will distrust:** aggregate-only notification claims ("queued") when a photographer says "I never saw it" — by design honest, but she'll keep texting to confirm.
- **Change:** photographer-scoped prep pickers; gear/kit in the prep packet; retire the demo notices.

### Spencer (Production)
- **Gets:** a real handoff queue with accept/claim/complete/return; the new Tracker.
- **Confused by:** two surfaces named "Production Queue" + hub + board + tracker + files (§6.1); precise-looking blocked links that drop filters (§6.3); status name-checking him personally ("Ready for Spencer Review", §4.1).
- **Will distrust:** leadership's production trend numbers (computed from a data model he doesn't work in, §6.2); "Mark Missing Info" that can't say what's missing.
- **Change:** one queue with sort/priority; free-text reason + party picker on missing-info; reconcile Reports with workflow runs.

### Dylan/Greta (Client Success)
- **Gets:** a real Client Command Center (accounts, contacts, services, notes, tasks, readiness) and a Zendesk health screen.
- **Confused by:** Zendesk demo numbers when credentials are absent (labeled, but easy to miss); Home's "Client Issues" card correctly says "Not connected", yet the CSR home persona shows a fabricated CSR queue.
- **Will distrust:** any promise of client-issue tracking — there is no issue record, no "client informed" step anywhere (§6.6).
- **Change:** a minimal client-issue object (intake → owner → resolution → informed) even if intake stays in Zendesk.

### CSR (all-scope)
- **Gets:** full shell with Schools + Sports ALL-scope and even Leadership reports (§7.5) — broad by design.
- **Confused by:** landing on a **fabricated CSR queue** at `#home` (`homeRoles.ts:80-82`); prose next-actions on missing info (their core job is chasing missing details); engineer vocabulary in PayrollReview if they help with payroll ("canonical labor-state model", "legacy drift").
- **Will distrust:** the demo queue's fake tickets after one attempt to work them.
- **Change:** CSR home = live missing-info/client-follow-up worklist; humanize payroll vocabulary.

### Photographer (staff)
- **Gets:** MyWork (live, good), staffing confirmations with honest decline flow, PayrollSelfCheck, Travel packet.
- **Confused by:** `#home` vs `#my/day` (default shell route is Home → fake workspace; the live page is the utility route); "Clocked Out" header button that's a nav link; no gear answer anywhere; can't see hours outside the self-check window.
- **Will distrust:** the home Time Clock card (static fiction) vs the real header punch control giving different answers.
- **Change:** make `#my/day` the employee `#home`, delete the fake workspace.

### Seasonal/new employee
- **Gets:** first screen = fabricated "Today's Assignment" with a checklist and acknowledge buttons that silently discard input (`MyWorkspaceHome.tsx:28-33,108-114`); mobile bottom-nav "My Dashboard" goes to the same fiction (§1.1).
- **Confused by:** everything the veterans are, plus: "Ready Eligible", "staffing volatility", "Acknowledgment Carried Forward", "Own-scope view", raw enum filter placeholders ("confirmed, ready_to_shoot…"), "Who has the ball" (§4 terminology list).
- **Will distrust:** the entire app on day two, when their acknowledged rain plan is unacknowledged again.
- **Change:** this persona is the strongest argument for deleting the demo home layer.

---

## D2. Workflow gap report

| Workflow | Current state | Missing pieces | Automation opportunities | Risk if ignored |
|---|---|---|---|---|
| **School picture day setup** | Intake cascade real but flag-off; drafts persist; job detail rich; scheduling/staffing links exist only for linked shoots (§3.3, §3.5) | Create button; inline create for school/contact/location; scheduling CTA from job detail; clickable next actions | Auto-generate season's jobs from `school_service_term`; auto-create missing-info tasks with owners | Jessica stays on Monday for the one workflow the product was built around |
| **Sports shoot setup** | Shared jobs spine live; sports detail features orphaned (§4.1) | One vocabulary; reachable team/proof/product tabs or deletion | Roster/association-driven job generation | Deep links via legacy alias silently break; duplicate concepts erode trust |
| **Job intake (both)** | Cascade + Smart Paste + CSV import all real; Schools can't reach import; service term display-only (§3.3) | Mount import for Schools; write service-term into payload; department-correct duplicate links | Duplicate detection is present at intake — good; extend to directory | Bulk fall-season onboarding stays in Monday/CSV+Slack |
| **Org/contact/location mgmt** | Canonical CRUD + atomic creation real; merge deferred; no approval workflow behind "Approved locations"; unbounded lists (§3.4) | Merge execution; district inline-create; pagination/virtualization | Dedupe suggestions already recorded — surface at create time | Duplicate schools poison "canonical" promise at exactly the scale Monday failed |
| **Staffing & assignment** | Best-in-product lifecycle (§4.2) | Real delivery receipts (Teams/Outlook) — currently "queued" only | Auto-escalate unacknowledged assignments after N hours (data exists: "Confirmation Overdue") | Carisa keeps texting; the system of record stays her phone |
| **Schedule visibility** | MyWork week strip + Schedule + Travel packet answer where/when/lead | Gear/kit answer; photographer-scoped pickers (8-job cap) | Auto-attach kit from job type + gear module | Field staff print schedules / screenshot texts again |
| **Photographer readiness** | Prep checklist real on PhotographyWorkspace; readiness queue exists | Demo change notices polluting the feed; no per-assignment readiness ack tied to record | Readiness nudges from prep-communication gaps (Prep Readiness queue already computes this) | "Ready" means nothing; leads re-verify verbally |
| **Shoot-day status** | LiveShoots/Today real; check-ins via closeout module | Field check-in surface is buried; no single shoot-day board with live punch + travel + issues | Punch + assignment + location join already exists in attendance ops | Day-of coordination stays on group text |
| **Post-shoot evaluation** | Real two-mode flow feeding next-year brief (§4.4) | Flag OFF in prod builds; "Senior Review" shows no eval data; hand-built hash needed without jobId | Auto-prompt lead at shoot end (worker exists for reminders) | The account-memory moat — MC's best differentiator vs Monday — never accrues |
| **Production handoff** | Accept→claim→complete→return real (§6.4) | Stage model; sort/priority; real missing-info reasons; issue_flag exposure | Auto-lane by real stage field instead of keyword match | Spencer triages by memory; leadership reads different numbers (§6.2) |
| **Client issues** | Does not exist end-to-end (§6.6) | Issue record; owner; resolution; client-informed step | Zendesk webhook → exception with `client_case` source (actionTargets already reserves the type) | CSRs keep a spreadsheet; owner hears about problems from clients |
| **Late/missing details** | Missing-info checklist computes well; exceptions engine solid | Links from checklist items to fixing surfaces; requester automation | Auto-chase emails to school contacts (contact data is canonical) | The #1 CSR workflow stays manual |
| **Needs Attention** | Two systems share the name; Compliance one is excellent (§5.4); Home one is fiction | Rename one; wire Home panel to exceptions feed (it already has the shape) | — | Leadership acts on fiction or ignores both |
| **Leadership review** | Reports real w/ freshness panels; Exec dashboard live | Production trend source mismatch (§6.2); Home contradiction | Scheduled packet runs exist — good | Numbers challenged once → dashboards ignored |
| **Payroll/mileage/compliance** | LCC lifecycle + self-check + compliance triage genuinely strong (§5) | Seeded demo data (§5.5); pay-code labels; blocker deep links; one gated CSV | Worker sweeps exist; add auto-open of self-check windows (rule exists) | Owner demos an empty shell; office exports the wrong CSV to QuickBooks |
| **Resource/prep content** | Resource panels exist; training real but content un-migrated (§6.7) | SOP migration; gear linkage | — | Monday/Drive stays the reference home |
| **Recurring work** | Service terms + workflow templates exist | Nothing generates next season's jobs from service terms | Season rollover generator | Every fall re-keyed by hand — Monday's worst pattern, replicated |
| **Historical/location intelligence** | Location history real in intake editor; 46-month eval seed proves the loop (§3.6, §5.5) | Prior Job Intelligence hardcoded to demo orgs; detail placement 10 sections deep | Surface prior-year brief at intake and day-before automatically | The demo's wow-feature reads as broken for real accounts |

---

## D3. UX improvement backlog

### Fast wins (days)
1. Label every demo panel "Sample" or hide it — the mechanism exists (`dataSource: "sample"` badge, `CompanyCommandHome.tsx:180-182`); apply to Needs Attention, Operating Areas, Attendance Risk, Reports strip, Sports Command, My Workspace personas, workflow change notices.
2. Fix `RelatedJobLink` to accept and emit record ids (`home/homeShared.tsx:40-47`).
3. Fix `#exceptions?critical_high_only=yes` parsing (`SharedJobCommandCenter.tsx:247` vs 1377) and strip/translate the dead `?queue=&stage=` params (§6.3).
4. Make intake's "Open it in Directory" texts actual links (`QuickCreateJobDrawer.tsx:674-697`); fix the schools duplicate-warning link department (`JobIntakeFields.tsx:1096-1099`).
5. Rename one "Needs Attention" and one "Production Queue"; retitle `#files`.
6. Fix Training's self-broken hash parser (`Training.tsx:893-920`); Cancel-returns-to-`#home` on task pages (`SharedTaskPage.tsx:631`).
7. Add "25+" semantics to task counts (`DashboardMyTasksPage.tsx:88-99`); show real totals next to capped boards (SchoolsHub 14-row cap).
8. Pay-code label map + friendly event log in LCC (`LaborCommandCenter.tsx:278,592-596`); deep links for the two `hash: null` blockers (166-168).
9. Remove rate-code/hourly-cents inputs from the manager scheduling form (`Scheduling.tsx:1210-1218`).
10. Seed the labor stack (`time_session`, one open payroll period, self-check window, a mileage reimbursement) so LCC/self-check/payroll demo real (§5.5).

### Medium (1-3 weeks)
11. Turn on `centralJobIntakeV1` after fast-win #4; mount Smart Paste/CSV import for Schools with a schools return-hash (`SportsShoots.tsx:201-211` pattern).
12. Wire Home's Needs Attention panel to the exceptions feed (Urgent Window read model already exists) and delete `DEMO_NEEDS_ATTENTION`.
13. Replace `MyWorkspaceHome` personas with the live MyWork content (or route employee `#home` → `#my/day`); fix the mobile bottom-nav target (`app.tsx:2120`).
14. Make missing-info checklist items link to their fixing surfaces (roster request → contact/comms; assign manager → staffing board).
15. One jobs list: retire `SharedJobsPage` or `JobsIndexPage`; one stage vocabulary shared with job detail.
16. Add sort + real priority to ProductionWorkflowQueue; reason/party picker on Mark Missing Info; expose `issue_flag`.
17. Pagination/virtualization: Directory rails, Exceptions, Urgent Window, Tracker (limit 100), production queue (50).
18. Replace keyword-heuristic KPIs (SchoolsHub job types/ID-card strip, production lanes, tracker areas) with real fields.
19. Gear/kit line in the prep packet + photographer-scoped job pickers (`PhotographyWorkspace.tsx:406,513,790,884`).
20. Persist "Confirm details" and change-notice acknowledgements server-side (currently localStorage — `SharedJobDetailPage.tsx:487-499`, `workflowChangeNotices.tsx:464-467`).
21. Delete orphaned `SportsShoots.tsx`/`SportsShootDetailPage.tsx`/`ProductionProjects.tsx` (~3,650 lines of dead UI) after harvesting their good parts (stage model, tab concepts).
22. An always-visible "My Hours" view outside the self-check window; link from My Account.

### Deeper redesigns (quarter)
23. One leadership surface: merge `#home` Company Command, `#executive`, `#operations/today` into a single role-aware command center fed exclusively by the exceptions/dashboard read models.
24. Client-issue record with owner → resolution → client-informed lifecycle; Zendesk webhook intake; wire Home's "Client Issues" card to it (actionTargets already reserves `client_case`).
25. Real production stage model shared by queue, board, tracker, and Reports (retire the `production_project*` reporting source, §6.2).
26. Season rollover: generate next year's jobs from `school_service_term`; the "recurring work" Monday-killer.
27. Notification delivery receipts (Teams/Outlook) on staffing publishes + assignment escalation.
28. Nav consolidation: collapse the 5-reports/4-approvals/5-sales duplicate nav items; give `my-work` a real section or move its children; role-tuned default sections.

### Things to avoid
- Don't build a generic kanban/board engine to "match Monday" — the differentiators (count integrity, honest contracts, lifecycle gating, account memory) are what Monday can't do; a worse Monday clone loses on both fronts.
- Don't add more top-level sections; every new surface should replace one.
- Don't fake the missing integrations (weather, QuickBooks, Zendesk) — current disabled-with-reason handling is correct; extend that pattern.
- Don't ship more named-person logic ("Spencer", "Jessica" fallbacks) — roles, not names.
- Don't keep polishing the demo layer; every hour spent making `homeDemoData.ts` prettier deepens the trust debt.

---

## D4. User trust

**Where users will trust the system (earned):**
- Urgent Window / Exceptions — provenance chips, count integrity, permission-aware actions (§2.5).
- Staffing lifecycle — versioned publishes, honest "queued, not delivered" claims, decline-with-reason (§4.2).
- Labor Command Center + PayrollSelfCheck — lifecycle gating, honest QB scaffold, plain-language self-check (§5.1, §5.3).
- Schools Leadership board — server can_act, real counts under windowed rows (§3.2).
- Reports' freshness panels; Profitability's honest emptiness (§6.7).

**Where they will distrust it (and be right):**
- The `#home` fiction panels and persona workspaces (§2.1, §2.3-persona): one discovered fake incident poisons every real number.
- Numbers that disagree across surfaces: home vs executive; hub KPIs computed on a truncated 14-row board; task counts capped at 25; production trends from the dead model.
- Keyword-derived KPIs (ID Card Tracker, job types, production lanes) — wrong exactly when titles are messy, i.e., in real life.
- Acknowledgements/confirmations that only live in localStorage — "I confirmed that" will be untrue on any other machine.

**Where they'll still ask a human:** did the photographer actually see the assignment (no delivery receipts); what gear to bring; whether the client was told (no client-informed step); which production queue is authoritative; whether payroll's CSV is the reviewed one.

**Where the app fails to explain itself:** which of five dashboards is theirs; engineer vocabulary ("canonical", "legacy drift", "staffing volatility", "Ready Eligible", raw enums in filter placeholders); silent hash aliases (`#sports/shoots` → shared jobs; `#schools/production` → tasks); action-shaped text that isn't clickable (Labor signal cards, intake review queue `<em>` labels, "Next:" prose).

**Where it looks complete but isn't operationally useful:** Prior Job Intelligence (demo-org-only); "Approved locations" (no approval exists); Senior Review (promises evals, shows none); SportsSettings (controls that don't edit); Sports Reports (starter metrics, admits it); Duplicates tab (records decisions, can't merge); `#files` (not files); the entire unlabeled Home fiction; QuickBooks "Send" correctly disabled — the one *honest* look-complete case, and the model to follow.

---

## D5. Blunt conclusion

**Would Jessica actually use this instead of Monday.com?** Not yet — and not because the product is weak, but because her three entry moments all misfire: she cannot create a job (flag off), her hub's KPIs are keyword guesses over a truncated board, and every "next action" is a sentence instead of a button. The moment she opens a job the product is *better* than Monday (job truth, missing-info checklist, drafts, directory). Fix intake + clickable next actions + one jobs list, and she switches; today she'd demo it enthusiastically and then reopen Monday to do the work.

**Would leadership trust it as company command?** No — the front door mixes three live counts with nine fabricated incidents, five fictional employees, and a fake reports strip, none labeled, while the honest command center (Urgent Window/Exceptions/Executive) sits one hop away *disagreeing with it numerically*. Leadership trust is binary and fragile: the first fake "Edina Soccer" phone call ends it. The fix is cheap relative to the stakes — the honest-contract pattern is already built and proven on the same page's card row.

**Would a seasonal photographer know what to do?** On `#my/day`, mostly yes (assignment, ack/decline, self-check are real and clear). But the shell doesn't take them there: `#home` and the mobile "My Dashboard" tab land on a fabricated workspace whose checklist and rain-plan acknowledgement silently discard input, and the vocabulary ("Ready Eligible", "staffing volatility", "Who has the ball") assumes tribal knowledge. Day one: confused. Day two, after their acknowledgement vanished: gone back to texting their lead.

**Top 10 changes to make it feel real:**
1. Kill or fully label the Home demo layer; wire Needs Attention to the live exceptions feed (mechanism exists).
2. Route employees (web + mobile bottom nav) to live MyWork as home; delete the persona workspaces.
3. Turn on `centralJobIntakeV1`; make intake's missing-state texts clickable; give Schools the import/Smart-Paste path.
4. Make every missing-info "next action" a deep link; add a scheduling CTA to job detail.
5. One jobs list, one stage vocabulary; one "Production Queue"; rename one "Needs Attention".
6. Fix the five broken/lossy deep-link cases (RelatedJobLink, critical_high_only, queue/stage, Training self-link, sports alias links).
7. Replace keyword-heuristic KPIs and lanes with real fields; show true totals beside capped lists.
8. Seed the labor stack so LCC/self-check/payroll demo with data; add pay-code labels and blocker links.
9. Persist all acknowledgements/confirmations server-side; add staffing delivery receipts + auto-escalation.
10. Ship the client-issue record (owner → resolution → client informed) — the last wholly-missing workflow.

---

*Method note: findings synthesized from six parallel code sweeps (daily-driver surfaces; schools/directory/intake; sports/staffing/schedule/evals; production/client success; labor/payroll/seeds; Monday parity + role nav), with all load-bearing claims (flag defaults, RelatedJobLink, dead filter params, home data sources, mobile nav targets, seed gaps) re-verified first-hand against the working tree at `fe5853e8`.*
