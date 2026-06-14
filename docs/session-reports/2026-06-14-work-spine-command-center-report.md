# Mission Control — Work-Spine / Command-Center Session Report

**Date:** 2026-06-14
**Branch:** `feature/work-spine-foundation-v1`
**Scope of this report:** the continuous local work session spanning 2026-06-12 → 2026-06-14.

---

## 1. Branch
`feature/work-spine-foundation-v1` — local only, **22 commits ahead of `origin`**. Nothing has been pushed.

## 2. Uncommitted work
**None.** The working tree is clean — all session work (including the Sports Command Center / Sam workspace) is committed. This report is the only new file.

## 3. Commits in this continuous session (2026-06-12 → 2026-06-14)

These are the 22 unpushed commits on the branch, newest first. (The session was compacted partway through; the 06-12 commits are the earlier part of the same continuous effort.)

| Commit | When | Subject |
|--------|------|---------|
| `10e4cd1` | 06-14 14:24 | Build sports command center and Sam workspace |
| `0922a29` | 06-14 11:54 | Rename to Production Tracker with an 8-card Company Command strip |
| `1d34af3` | 06-14 11:33 | Refine Home into role-aware Company Command |
| `873245d` | 06-14 10:57 | Seed Wayzata location memory and surface real all-time history |
| `5f9eddf` | 06-14 09:53 | Make data-load failures honest instead of masking them as demo |
| `0f3a390` | 06-13 16:40 | Disable Sports nav buttons when their target hash is missing |
| `b020027` | 06-13 16:21 | Split admin tools into a dedicated Admin section, separate from Settings |
| `60d7034` | 06-12 15:09 | Simplify Settings around account and preferences |
| `aefb70a` | 06-12 13:45 | Add dense tracker table to Project Tracking |
| `b298c0f` | 06-12 12:43 | Place operating report mid-Leadership with resilient states |
| `7cd761b` | 06-12 12:34 | Move operating report into Leadership |
| `d3dd2f1` | 06-12 12:00 | Densify Project Tracking cards and open job detail |
| `0a51421` | 06-12 11:44 | Make Project Tracking board-first by removing the Leadership report |
| `3dbc26a` | 06-12 11:25 | Bring Jobs preview to parity with the Job Truth model |
| `312c938` | 06-12 11:16 | Harden help tooltip to prove visible decluttering |
| `2af247a` | 06-12 11:11 | Add reusable HelpTooltip and declutter My Dashboard descriptions |
| `e8fb8f2` | 06-12 09:54 | Make Job Truth Snapshot interactive + Definition of Done + staffing link |
| `95dabbb` | 06-12 09:32 | Add date-first Staff Assignment Board with real assignment drawer |
| `6fe42e4` | 06-12 09:09 | Make the desktop sidebar pin and scroll independently |
| `a013dec` | 06-12 09:02 | Compact Today's Briefing and add Ask Mission Control foundation |
| `a4c1cbf` | 06-12 08:50 | Rename Home to My Dashboard and add Due This Week widget |
| `84b581c` | 06-12 08:11 | Add studio pulse and personal work to home dashboard |

## 4. What each commit changed (plain English)

Grouped by work stream:

**Home / Dashboard → role-aware Company Command**
- `84b581c`, `a4c1cbf`, `a013dec` — built out the home dashboard (studio pulse, personal work, Due This Week), renamed Home → "My Dashboard", compacted the briefing, and added the safe "Ask Mission Control" foundation (no API keys in the frontend, no student/client data to an external LLM).
- `2af247a`, `312c938` — added a reusable HelpTooltip and moved verbose descriptions behind a "?" so the dashboard reads calmly; hardened the tooltip so its visibility is testable.
- `1d34af3` — **the big one:** refactored Home into a role-aware experience. Leadership/department-leads default to **Company Command** (eight locked cards — On Fire, Shoots Today, Staffing Risk, Late/Not Clocked In, Jobs Behind, Weather Watch, Production Load, Client Issues — plus a strict centralized Needs Attention, Operating Area Pulse, Attendance Risk, Weather Impact, Reports). Associates default to **My Workspace** (their shift/queue/cases). Added a demo "Viewing as" role switcher. Demo-data-driven; makes no backend calls.

**Job Truth / Staffing / Jobs**
- `95dabbb` — date-first **Staff Assignment Board** with a real assignment drawer (ShootStaffingCommand).
- `e8fb8f2` — made the Job Truth Snapshot interactive, added a Definition-of-Done ladder and a staffing deep-link.
- `3dbc26a` — brought the Jobs-list preview to parity with the Job Truth model.

**Project / Production Tracking**
- `0a51421`, `d3dd2f1`, `aefb70a` — made Project Tracking board-first, densified the cards, and added the dense Tracker table grouped by work area (with job-title links into Job Detail).
- `7cd761b`, `b298c0f` — relocated the Leadership Operating Report into Leadership with resilient loading/error states.
- `0922a29` — **renamed "Project Tracking" → "Production Tracker"** and grew the strip into the eight-card **Company Command** strip (Active Jobs, At Risk, Late, Blocked/Waiting, To Delegate, Due in 72 Hours, In Review, Recently Done), each a clickable filter.

**Sidebar / Settings / Admin**
- `6fe42e4` — pinned the desktop sidebar so it scrolls independently.
- `60d7034` — **simplified Settings** to a real account/preferences surface (My Account, Preferences/theme, Integrations status, Role & Access) instead of an admin "control room".
- `b020027` — **split admin tools** into a dedicated, admin-only **Admin** sidebar section; collapsed the duplicate "My Account" entry.

**Dead-control audit (no-fake-UI)**
- `0f3a390` — Batch 1: disabled two Sports buttons ("Open Production", "Open Linked Shoot") that rendered enabled but silently no-op'd when their target hash was null.
- `5f9eddf` — Batch 2: made data-load failures honest — real API errors no longer masked as "demo data unavailable" (Production Hub, Project Tracking, Jobs); removed the fake prep-file uploads that discarded files; "demo queue" → real wording.

**Location Intelligence (backend)**
- `873245d` — seeded **Wayzata** location memory (org + Wayzata High School + 17 post-shoot evaluations + pinned location-memory notes) into the demo-reset flow, and fixed the intelligence endpoint to count all-time prior visits (so it honestly shows 17) and to prefer real history over a synthetic Monday mock. Verified end-to-end (17 prior visits, a "Repeated understaffing" pattern, an open follow-up, real west-entrance watch-outs).

**Sports Command Center**
- `10e4cd1` — built Josh's **Sports Command Center** (Sports Pulse, Changes Requiring Acknowledgement reusing the real change-notice engine, Current Season vs Building Next Season with a rebooking tracker, a Specialty Product Tracker incl. the sent-to-Mike risk, production/gallery, staffing readiness, association health) and **Sam's** task-focused "My Sports Work" (groups, next actions, due-this-week, waiting-on, recently-changed — no revenue, no KPIs).

## 5. Files touched summary
**56 files changed, +5,847 / −1,621** across the session. By area:

| Area | Files |
|------|-------|
| `home/` (role-aware home + sports) | 16 |
| `test/` | 14 |
| `pages/` | 13 |
| `components/workspace`, `components/home` | 4 |
| `styles.css` | 1 |
| `navigation.ts`, `app.tsx` | 2 |
| backend `packages/api` (Wayzata seed + locations service) | 2 |
| `services/`, `components/leadership`, `components/jobs` | 3 |

## 6. Checks run and results
- **TypeScript** (`tsc --noEmit`): **clean** (exit 0).
- **Full test suite** (`vitest run`): **374 / 374 passing**, 76 files (deterministic — re-run on the clean committed tree).
- **Browser smoke** (10 routes, no console errors on any):

| Route | Renders |
|-------|---------|
| `#home` (Company Command, role matthew) | "Company Command" ✓ |
| `#home` (Sports Command Center, role josh) | "Sports Command Center" ✓ |
| `#home` (Sam, role sam) | "My Sports Work" ✓ |
| `#project-tracking` | "Production Tracker" ✓ |
| `#jobs` | "Jobs" ✓ |
| `#jobs/new` (Job Intake) | Job Basics / Workflow / Schedule / Job Needs, 24 fields ✓ |
| `#jobs/<id>` (Job Detail) | real job opens from a tracker link ✓ |
| `#accounts` (Directory) | "Directory" ✓ |
| `#account` (Settings) | "Account & Session" ✓ |
| `#admin` (Admin) | "Admin workspace" ✓ |

## 7. Demo-readiness audit (three scouts, ranked)

**P0 — demo-blocking:** _none found._ All routes render, no broken navigation, no console errors, role switcher works across all states, full suite green.

**P1 — high-priority before the June 20 demo** (feature gaps, not defects):
- **Location Intelligence has no UI surface yet.** The headline demo idea ("the system remembers Wayzata") is backend-verified but not visible in the app — no Job Detail panel and no Job Intake history preview. Highest demo value.
- **"Needs Attention" logic is not shared** across Company Command (`home/needsAttention.ts`), Production Tracker (health-based predicates in `ProjectTrackingFoundation.tsx`), and Sports (demo signals). On stage these could disagree. A shared rule layer would make leadership surfaces consistent.

**P2 — polish before June 20:**
- Production Tracker rows don't yet show every operational field inline (acknowledgement status, waiting-on); the explicit Command/Tracker/Workflow view relabel is deferred.
- Sports Command Center is demo-data-driven (Pulse counts mostly static); add per-person acknowledgement progress ("3 of 5 crew") and the spec'd quick actions (Send reminder, Message crew, Need clarification).
- **Terminology consistency** pass (Ready / To Delegate / Assigned / Acknowledged / Working / Waiting / Blocked / Needs Review / Delivered / Done / Needs Attention / At Risk / Urgent) across surfaces.
- Naming overlap: "Company Command" is both the leadership Home title and the Production Tracker strip label; "My Workspace" / "My Work" / "My Sports Work" are three similar names.

**P3 — backlog:**
- Association as a first-class season-grouping object (sports is relationship/season-centric).
- Real auth/permissions (the role switcher is a demo preview, not a permission gate).
- Rebooking / specialty-product persistence (currently typed demo arrays, not services).
- Acknowledgement is global-per-browser localStorage (not multi-user/multi-device honest).
- Cross-page action buttons still say "Open Project Tracking" (rename to Production Tracker).

## 8. Current risks
- **Demo-data divergence / duplicate truth.** Several dashboards (Sports Pulse counts, parts of Company Command, Production Tracker rows) are independently hardcoded demo data; if real data later replaces some of them, numbers can drift. Forward-compatible shapes mitigate this; the single-source derivation used for `needsAttention` / rebooking is the pattern to extend.
- **Static counts imply live precision** — the honesty risk the dead-control audit guards against; mitigated only by demo framing until wired.
- **Acknowledgement is global-per-browser** (keyed by notice id) — fine for demo, not multi-user honest.
- **Role = demo preview, not real permissions.** "Sam sees no revenue" is enforced by which component renders, not a permission check.
- **Location Intelligence is backend-only** — the operational value isn't yet demonstrable inside the app.

## 9. Recommended next slices (in priority order)
1. **Location Intelligence UI slice** — a Job Detail "what we know about this place" panel + a compact Job Intake "known history available" preview, fed by the real seeded `getShootLocationIntelligence` endpoint, with honest empty states. (Highest demo value.)
2. **Shared "Needs Attention" rule** — extract one rule layer (late / not acknowledged / 72h client-or-shoot / behind promised delivery / blocked-no-owner / missing-required-details) and adopt it in Company Command, Production Tracker, Sports, department hubs, My Work, and Job Detail. Tests for the shared rule.
3. **Production Tracker dense-row slice** — surface owner / next action / waiting-on / due / acknowledgement / risk-reason inline; use the shared rule; relabel views Command/Tracker/Workflow.
4. **Sports Command Center slice 2** — per-person acknowledgement progress + quick actions; wire the Pulse to real sports services.
5. **Terminology consistency patch** — copy-only, no logic change.

## 10. Demo-readiness notes for June 20
- **Demo-ready today:** the role-aware Home (Company Command for leadership/leads, My Workspace for associates), the Sports Command Center (Josh) and Sam workspace, the renamed Production Tracker with its Company Command strip, honest Settings/Admin, and the clean navigation across all surfaces. The "Viewing as" switcher lets you walk every seat live.
- **Backend-ready but not yet shown:** Wayzata Location Intelligence (17 prior visits, repeated-understaffing pattern, west-entrance watch-outs). Surfacing it (slice 1 above) is the single most impactful pre-demo addition.
- **Demo-data caveat:** the command-center dashboards are demo-data-driven and forward-compatible, not live-wired. This proves the operating model and is appropriate for a demo, but the numbers are illustrative.
- **Reset path:** `npm run reset:demo` (from `packages/api`) rebuilds the demo DB including the Wayzata seed.

## 11. Do not forget

**Company Command / role-aware Home**
- Lives in `src/home/*` + `components/home/HomeCommandSurface.tsx` (the single shell). Branches by `homeRole.mode` and `homeRole.id`. Demo role switcher persists to `localStorage["pmc-home-demo-role"]`. Eight locked Company Command cards. `home/needsAttention.ts` is the strict four-rule logic — extend it into the shared rule, don't fork it.

**Production Tracker rebuild**
- `pages/ProjectTrackingFoundation.tsx` (~2.5k lines) + `test/projectTrackingFoundationPage.test.tsx`. Slice 1 shipped (rename + 8-card strip). Reuse `ProjectWorkflowJobRow` (it already carries `current_step`, `health`+`health_reasons`, `waiting_on_party`, `blocked_reason`, `missing_info_flags`, `next_action`). Department pages are already filtered views via `ProjectTrackingDepartmentQueue`. The Command/Tracker/Workflow view relabel is coupled to the intricate view-toggle test — handle carefully.

**Sports Command Center (Josh + Sam)**
- `home/SportsCommandCenter.tsx`, `home/SamSportsWorkspace.tsx`, `home/sportsDemoData.ts`. Reuses the **real** `workflowChangeNotices` engine for Changes Requiring Acknowledgement (per-notice acknowledge + diff). Rebooking + specialty + association-health are net-new demo arrays (rebooking = job created + on calendar; no contract required). Sam must never see revenue/KPIs.

**Location Intelligence / Wayzata history**
- Backend: `packages/api/scripts/seed-mission-control-demo.ts` (`seedWayzataLocationIntelligence`) + `packages/api/src/services/locations.ts`. One `shoot_location` row serves both the approved-location picker and the intelligence name-match. Frontend `getShootLocationIntelligence` + `HistoricalContextPanel`/`LocationIntelligencePanel` already exist (wired only to Outlook/shoot surfaces today) — connect them to Job Detail + Job Intake. The endpoint matches on the picked location NAME; seed names must align.

**No fake UI / no silent no-op standard**
- The bar held all session: no dead buttons, no `href="#"`, no silent no-ops, no error masked as "demo". Buttons that aren't wired are **disabled with a reason** or **rendered as passive text**, never left as a no-op. Empty states are honest. Keep this standard for every new control — it is the product's credibility.
