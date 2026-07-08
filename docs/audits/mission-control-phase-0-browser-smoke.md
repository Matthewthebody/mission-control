# Mission Control — Phase 0 Browser Smoke Verification

Date: 2026-07-08
Auditor: Claude (Fable 5), Phase 0 safety slice — the browser pass Scout C could not perform.
App under test: admin-web Vite dev server on `http://localhost:5173` (reused, already running) against the live API on `:4000` (tsx watch, includes commit `045a7ff` "Restrict owner command compliance access").
Repo state during pass: branch `feature/work-spine-foundation-v1`, clean tree at `045a7ff` + two concurrent-session commits (`ad5afad`, `6153e36`).

## Method & environment honesty

- The Claude Preview proxy and the Chrome extension bridge were both still unavailable (preview port 5174 held by another chat; zero connected browsers). Verification was performed instead with **headless system Chrome driven via `playwright-core`** (installed in the session scratchpad, no repo changes) — a real Chromium engine executing the real SPA with console-error, page-error, and network-failure capture per route.
- Three roles were exercised via the real login form (`LocalDemo123!`): `matthew@example.com` (owner_admin, 19 routes), `office@example.com` (office_employee/CSR profile, 6 routes), `photo@example.com` (photographer, 5 routes). 30 route loads + 3 logins, 33 records total (`smoke-results.json`, `smoke-focus.json` in the session scratchpad).
- NOT covered: mobile/responsive viewports, deep click-through interactions beyond login + navigation, form submissions, dark mode. Route loads used a fixed 3.5–4s settle; slower panels may lazy-load after capture.
- One artifact of this session itself: my temporary edit to the **tracked** file `.claude/launch.json` triggered the repo-wide "DIRTY STATE — Pilot mode is blocked" banner during the first pass (visible to every role, including photographers). The edit was reverted; the finding that release-discipline banners render for field staff stands (see F7).

## Route matrix

Legend: ✅ loads with real data · ⚠️ loads with issues · console/network columns are per-route captures.

### owner_admin (matthew@example.com) — 19/19 loaded, 0 console errors, 0 failed requests

| Route | Result | Notes |
|---|---|---|
| `#home` | ⚠️ | Card row honest (live "ON FIRE 1031", "SAMPLE"-badged tiles, "NOT CONNECTED" weather/client-issues). Below it, the **unlabeled fictional "Needs Attention" (9 invented incidents — "Minnetonka shoot tomorrow", "White Bear gallery behind promised delivery")** renders exactly as Scout B predicted, plus the "VIEWING AS" localStorage persona switcher. |
| `#dashboard` | ✅ | Alias of `#home`, same content. |
| `#executive` | ✅ | Fully live: operational health "Critical", 8 critical flags, 96 overdue checklists, widget snapshot, priority exceptions with job codes. Numbers visibly disagree with `#home`'s sample tiles (e.g. home "Staffing Risk 3 (SAMPLE)" vs executive "Missing Staffing 31"). |
| `#needs-attention` | ✅ | Compliance/leadership review queue, live: 1,020 open, 233 urgent, 594 payroll/mileage-blocking. Employee filter lists **"Trade Replacement Photographer" 13×** (test-data pollution). |
| `#my-work/payroll-self-check` | ✅ | Honest closed state: "WINDOW CLOSED… No recorded time in this pay period" — the owner has no seeded time (labor seed gap, MC-AUDIT-017). |
| `#directory/organizations` | ✅ | Rail + records load. |
| `#directory/contacts` | ✅ | Loads. |
| `#directory/locations` | ⚠️ | Auto-redirects to a specific record (`?organization=…&location=…`) rather than a neutral list. |
| `#jobs` | ⚠️ | Auto-redirects to `#jobs?demo_view=curated`; a "Demo: Curated / Show Archived Demo / Show All Demo" control ships in the leadership UI. Count tiles + table load. **Every visible row reads "No Shoot linked"** — the two-spine fork (MC-AUDIT-001) is visible on screen. Rows include test artifacts ("Production Board Sports Job 1783532379697 7742"). |
| `#project-tracking` | ✅ | Production Tracker loads. |
| `#schools` | ✅ | Hub loads with live sources. |
| `#sports` | ✅ | Overview loads. |
| `#production-queue` | ✅ | Loads. |
| `#production/operations` | ✅ | Loads (second surface also labeled "Production Queue" — naming collision confirmed live). |
| `#operations/staffing?area=staffing` | ✅ | Staffing board loads. |
| `#schedule` | ✅ | Loads. |
| `#job-closeout` | ✅ | Loads its no-job guidance state (hand-built-hash discoverability gap noted in audit stands). |
| `#my-work` | ✅ | Live. |
| `#urgent-window` | ✅ | Live; count matches home's "ON FIRE" card (count-integrity pattern intact at 1,031). |

### office_employee (office@example.com) — 6/6 loaded

| Route | Result | Notes |
|---|---|---|
| `#home` | ⚠️ | Lands on the **fabricated CSR "My Workspace"** ("Client Success Queue: 7 open cases, Edina parent, Wayzata follow-up…" — all fiction from `homeDemoData.ts`), including the "VIEWING AS Matthew / Owner" persona switcher and a fictional "Time Clock: Clocked in 8:30 AM" card. |
| `#needs-attention` | ⚠️ **NEW DEFECT (F1)** | The hash stays `#needs-attention` but the page **silently renders the same fabricated CSR workspace** — the route resolver falls back for users without the compliance tab. An office user told to "check Needs Attention" sees invented client cases under the real route name, with zero indication of a fallback. Runtime confirmation of audit findings R1 (silent fallback) + MC-AUDIT-003 (fiction) compounding each other. |
| `#executive` | ✅ (denied cleanly) | API returns **403 on `/api/jobs/dashboard/executive`**; page shows an error banner, no data leak. |
| `#jobs` | ✅ | Jobs list loads (office has jobs read) with `demo_view=curated` redirect. |
| `#schools` | ⚠️ | Page renders but two **403s on `/api/workflows/command-center?department=schools`** produce a visible error banner — office has schools-hub access but not workflow read; partial-degradation UX. |
| `#my-work/payroll-self-check` | ✅ | Own-scope self-check; no other-employee data. |

### photographer (photo@example.com) — 5/5 loaded

| Route | Result | Notes |
|---|---|---|
| `#home` | ⚠️ | Fabricated "Seasonal Photographer" workspace (per audit; unchanged). |
| `#my-work` | ✅ | Live and rich: assignments with Acknowledge/Decline, the concurrent session's new "Post-shoot evaluations due" card works — though it reports "**253 shoots** still need your post-shoot evaluation" against demo data, and the assignment list shows ~8 duplicated "Employee Staffing Jul 10" rows with confirm-by dates in the past (test-data pollution). |
| `#my-work/payroll-self-check` | ⚠️ | Loads with real own-scope day rows, but (a) a **React duplicate-key console error** fires (`Encountered two children with the same key`), and (b) the list is dominated by 0.00h "Test Location / Demo DuplicateClockIn / OutOfScopeMissedPunch" garbage sessions. |
| `#schedule` | ✅ | Loads own-scope. |
| `#needs-attention` | ⚠️ | Same silent fallback as office: renders the persona workspace under the compliance hash. |

## Security behavior verified in-browser (before/after)

- **Before (Scout C, runtime, pre-fix):** office_employee `GET /api/dashboard/owner-command` → 200 with an 830-item company payroll/compliance queue.
- **After (this pass, browser + API):** office `owner-command`/`manager-cockpit` → **403**; office `#executive` → API 403 + clean error banner, no payroll data anywhere in the rendered DOM; office `#home` (which server-side used to embed the manager cockpit) now contains **zero** payroll/compliance strings; owner and leadership retain the full cockpit (1,021-item payroll/compliance count). Direct routes (`/api/attendance/payroll-review`, `/api/attendance/compliance-review`, `/api/compliance/workspace`) all 403 for office.

## Findings

- **F1 (HIGH, new, runtime-confirmed): `#needs-attention` silently renders the fabricated persona workspace for non-leadership roles.** The route resolver's dashboard fallback + the unlabeled home fiction combine: office/photographer users see invented client cases/assignments under a real route name. Fix priority: this is the concrete harm case for audit items MC-AUDIT-003 + MC-AUDIT-018 (not-found route). Evidence: `smoke-focus.json` office/`#needs-attention`.
- **F2 (MEDIUM, runtime-confirmed): React duplicate-key error on PayrollSelfCheck** for a photographer with colliding demo sessions — real rendering-correctness risk (rows may be dropped/duplicated). Evidence: console capture, photographer `#my-work/payroll-self-check`.
- **F3 (MEDIUM): office `#schools` renders with visible 403 error banners** from the workflows command-center — role has the page but not its data sources; partial-degradation confusion.
- **F4 (MEDIUM, demo-readiness): test-data pollution is on-screen everywhere** — "Trade Replacement Photographer" ×13 in a filter, "Test Location"/0.00h sessions in self-check, "Production Board Sports Job 178…" rows in Jobs, "253 evaluations due", 1,031 urgent issues, 1,020 compliance items. A live demo on this DB would look broken even where the code is right.
- **F5 (LOW): `#jobs` ships a "Demo" view-mode control** (`demo_view=curated` default) in the leadership UI; `#directory/locations` deep-defaults into a specific record.
- **F6 (CONFIRMS AUDIT): home fiction + contradictory numbers verified live** (home sample tiles vs executive live counts; 9 invented Needs Attention incidents; persona switcher visible to office users offering "Matthew / Owner").
- **F7 (LOW/UX): the release-discipline "DIRTY STATE — Pilot mode is blocked" banner renders for every role** including photographers whenever the repo tree is dirty — engineering state leaking into field UI.
- **Positives:** zero console errors and zero failed requests across all 19 owner routes; the Urgent Window count-integrity pattern held at 1,031; permission denials render as clean banners, not blank screens or crashes; login worked for all roles; the concurrent session's new post-shoot evaluations card functions.

## Conclusion

The Phase 0 browser blind spot is now covered for 30 route/role combinations. The security fix (commit `045a7ff`) is verified end-to-end in a real browser: office/CSR users can no longer obtain company payroll/compliance data through the cockpit routes, the home dashboard, or any tested surface, while leadership access is intact. The most important new discovery is F1: the compliance route silently swaps to fabricated content for non-leadership roles — the audit's "silent fallback" and "unlabeled fiction" findings compounding into a concrete misdirection. No route crashed, failed to load, or produced unexplained console errors for the owner role.

Residual gaps for a later pass: mobile viewports, deep interaction flows (form submits, button-by-button dead-control sweep), dark mode, and the remaining roles (leadership, senior, associate).
