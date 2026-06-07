# Mission Control Demo Readiness Audit

## Executive Summary

Overall readiness: demo direction is much stronger than the earlier prototype state. Home, My Work, Jobs, Directory, and the department hubs now mostly communicate the intended operating-system model instead of separate disconnected boards.

Biggest risks:

| Risk | Why it matters | Priority |
| --- | --- | --- |
| Production shows an `Internal server error` banner during local smoke | The route renders, but the page calls `GET /api/jobs/production-items`, which attempts a mutating production-board sync during a read-only request. This damages trust in a demo. | Critical |
| Notifications is still a death-scroll list | Browser smoke showed a very long alert feed with repeated critical cards and no compact triage/pagination on first load. | High |
| Hidden `#needs-attention` still feels like a full destination | It is no longer primary navigation, but the legacy route still presents a large review desk with `Open Needs Attention` language. | High |
| Directory still repeats "Directory" several times | The purpose is clear enough, but the header/title stack makes the page feel less polished. | Medium |
| Department job lists still had saved-view management controls | Fixed in this pass by keeping preset lenses and removing Save/Rename/Pin/Delete controls. | Fixed |
| My Work intro repeated "Your day" | Fixed in this pass. | Fixed |

Highest ROI fixes:

1. Fix the Production read-only GET mutation error.
2. Add a compact/paginated notification triage surface.
3. Keep `#needs-attention` as a legacy alias but remove self-referential "Open Needs Attention" CTAs inside it.
4. Reduce Schools/Sports long-scroll content after the standardized hub sections.
5. Tighten Directory title/header stacking.

What is already working well:

| Area | Status |
| --- | --- |
| Home | Good command-center shape: Clock In, visible concierge input, compact Today's Briefing, urgent issue count, weekly work and outbound jobs sections. |
| My Work | Improved employee launchpad with schedule, assigned tasks, workflow steps, and heads-up cards. |
| Jobs | Database framing is now clear: filters, department/type, organization, status, risk, owner, and 10/25/50 page sizes. |
| Department hubs | Shared structure is consistent while Schools, Sports, Photography, Production, and Project Tracking use more specific operational language. |
| Needs Attention nav | Not present as a primary top-level navigation item. |
| Horizontal overflow | Browser smoke found no horizontal overflow on the major routes checked at desktop width. |

## Current State

Repo: `C:\Dev\Codex-integrated-baseline-clean`

Branch at audit start: `feature/work-spine-foundation-v1`

Starting HEAD: `691a2f4 Polish department hub specificity`

Working tree at audit start: clean

Recent history reviewed:

| Commit | Summary |
| --- | --- |
| `691a2f4` | Polish department hub specificity |
| `e49c302` | Refine Directory client lookup experience |
| `ee2dd75` | Refine Jobs database experience |
| `4a87f68` | Demote Needs Attention navigation |
| `b859b65` | Standardize department hub pattern |
| `8c7721f` | Clean up Schedule surface |
| `870b372` | Refine concierge and My Work launchpad |
| `68a7398` | Add Production department hub |
| `1995082` | Refine My Work employee launchpad |
| `cbfce5d` | Refine urgent issues briefing action |
| `0fbf2b3` | Refine homepage mission control briefing |
| `5c07450` | Fix Schools and Sports hub loading states |

## Route and Layout Inventory

Routes are defined in `packages/admin-web/src/navigation.ts` and rendered through `packages/admin-web/src/app.tsx`.

Main employee-facing routes audited:

| Route | Purpose | Current route behavior |
| --- | --- | --- |
| `#home` | Mission Control command center | Loads cleanly. |
| `#my-work` | Employee launchpad | Loads cleanly. |
| `#jobs` | Searchable jobs database | Loads cleanly with filters and pagination. |
| `#schedule` | Schedule workspace | Loads cleanly. |
| `#directory` | Directory entry | Redirects to `#accounts`; loads Directory. |
| `#schools` | Schools hub | Loads, but page is still long after the hub sections. |
| `#sports` | Sports hub | Loads after a longer wait; still very long after the hub sections. |
| `#studios` | Photography hub | Loads cleanly. |
| `#production` | Production hub | Route loads, but shows an `Internal server error` banner. |
| `#project-tracking` | Shared work spine | Loads cleanly. |
| `#search` | Global search | Loads cleanly. |
| `#notifications` | Notification center | Loads, but is a very long repeated alert list. |
| `#needs-attention` | Hidden legacy review queue | Loads as hidden alias; still feels like a large destination. |

Shared layout/components reviewed:

| File/component | Role |
| --- | --- |
| `packages/admin-web/src/app.tsx` | Shell, sidebar, route rendering, quick access, topbar metadata. |
| `packages/admin-web/src/navigation.ts` | Route definitions, visibility, legacy aliases. |
| `packages/admin-web/src/components/department/DepartmentHubPattern.tsx` | Standard Open First / Attention Needed / This Week's Work / Work Queues pattern. |
| `packages/admin-web/src/pages/SharedJobsPage.tsx` | Jobs database/list and department job list shell. |
| `packages/admin-web/src/pages/MyWork.tsx` | Employee launchpad. |
| `packages/admin-web/src/components/home/HomeCommandSurface.tsx` | Home command-center cards and urgent issue actions. |
| `packages/admin-web/src/pages/Organizations.tsx` | Directory organizations/contacts/locations lookup surface. |
| `packages/admin-web/src/pages/Compliance.tsx` | Hidden Needs Attention review queue. |
| `packages/admin-web/src/pages/ProductionHub.tsx` | Production hub and production queue summary. |

## Dead / Suspicious Buttons and Links

| Page | Label | Current behavior | Risk | Recommendation | Fix status |
| --- | --- | --- | --- | --- | --- |
| Production | `Open Production Queue`, hub cards, list sections | Route is valid, but the page shows `Internal server error` from the production queue API load. | Demo blocker; users see an error on a main department route. | Fix API/read-only request behavior in `GET /api/jobs/production-items`. | Documented, not fixed; backend behavior out of this cleanup scope. |
| Department job lists | `Save current view`, `Rename`, `Pin default`, `Delete` | Previously visible on Schools/Sports job list surfaces. | Feels like admin/view-builder tooling in normal employee flow. | Keep preset lenses; remove visible management controls. | Fixed. |
| Needs Attention legacy route | `Open Needs Attention` | Self-referential CTA remains inside hidden review queue text/actions. | Reinforces Needs Attention as a destination instead of a signal. | Rename to `Review queue`, route back to Home/Project Tracking, or remove. | Documented, not fixed. |
| Directory | `New organization`, `New contact`, `New location` | Visible in Directory header. | May be valid for leads, but could feel too broad for normal employees. | Permission-check against intended create rights; otherwise hide for standard users. | Documented, not fixed. |
| Prep Readiness | `Client Command Center` | Routes to `#client-command-center` without a selected client. | Can feel disorienting because Directory should be the address book and client command should be contextual. | Prefer Directory search or selected-client deep links. | Documented, not fixed. |
| Notifications | `Mark Read`, `Acknowledge`, `Resolve` repeated across many cards | Buttons are action-like across a very long list. | The surface feels like a queue dump, not a triage center. | Add pagination/triage grouping before broad action cleanup. | Documented, not fixed. |
| Shell metadata | `Connected`, `Standard`, `Team Member` | Still visible on several non-Directory routes. | Reads like implementation status rather than employee work context. | Hide or demote globally except diagnostic/admin contexts. | Documented, not fixed. |

## Developer/Admin Controls Visible to Normal Users

| Page | Label/control | Why it feels wrong | Recommendation |
| --- | --- | --- | --- |
| Department job lists | Save current view, Rename, Pin default, Delete | View-management controls feel like an internal builder, not a daily job database. | Fixed: removed management controls while keeping preset lenses. |
| Jobs/Shell | Connected, Standard, Team Member | Looks like system/debug metadata on normal work pages. | Move to My Account or diagnostics, or show only when useful. |
| Directory | New organization/contact/location | May be appropriate for admins, but too broad if visible to standard staff. | Gate by create permissions and role intent. |
| Needs Attention | Date Anchor | Useful for review tooling, but internal-sounding in a demo. | Rename to business language such as `Review date` or keep only for leads/admins. |
| Production | Viewing as Demo Admin | Exposes demo/admin phrasing inside a department hub. | Show role-neutral language, or hide in normal demo mode. |

## Repeated or Confusing Page Titles

| Page | Current wording | Suggested wording |
| --- | --- | --- |
| Directory | `DIRECTORY / Directory / Directory` appears in the shell/header/body stack. | Keep shell label `Directory`; body title can be `Find a Client or Organization`. |
| Notifications | Top shell says Home/Notifications, then page says Notification Center. | Keep `Notifications`; body title can be `Alert Triage`. |
| Needs Attention | Shell and body repeat Needs Attention while also saying Leadership Review Queue. | Keep hidden route, body title `Leadership Review Queue`; remove self-referential CTA copy. |
| Jobs | Shell says Jobs, body says Database/Jobs Database. | Current wording is acceptable and better than repeated Jobs/Jobs/Jobs. |
| My Work | Previously repeated "Your day"; fixed to one clean employee sentence. | Fixed. |

## Death-Scroll / Overloaded Pages

| Page | Problem | Recommended structure |
| --- | --- | --- |
| Notifications | Browser smoke measured roughly 22 screens of repeated critical alert cards. | Compact triage inbox with groups, counts, severity tabs, 25-per-page pagination, and a detail drawer. |
| Sports | Browser smoke measured roughly 25 screens after data loaded. | Keep hub sections first, collapse lower operational boards into tabs or detail-on-demand panels. |
| Schools | Browser smoke measured roughly 7 screens. | Keep hub sections first, collapse active work/detail sections behind clear queue links. |
| Needs Attention | Browser smoke measured roughly 8 screens and shows many filter options and records. | Treat as legacy review desk; grouped triage, pagination, and clearer owner/next action rows. |
| Directory | Browser smoke measured roughly 5 screens of records. | Add pagination or keep list region scroll-contained after first search/results summary. |
| Jobs | Browser smoke measured roughly 5 screens, but this is controlled by 25-per-page pagination. | Acceptable for now; keep improving table density and row preview behavior. |

## Needs Attention Migration Check

| Check | Result |
| --- | --- |
| Top-level primary nav item removed | Pass. It does not appear in the primary sidebar groups. |
| Hidden `#needs-attention` still supported | Pass. It loads for compatibility. |
| Attention appears inside Home | Pass. Urgent Issues is visible in Today's Briefing. |
| Attention appears inside My Work | Pass. Heads Up is present. |
| Attention appears inside department hubs | Pass. Department hubs use `Attention Needed` as a section. |
| Attention appears inside Project Tracking | Pass. Project Tracking has blocked/at-risk project signals. |
| Remaining confusing use | `#needs-attention` still contains self-referential `Open Needs Attention` language and presents as a major destination. |

## Page-by-Page Findings

### Home

What works:

- Add Task is gone.
- Clock In is present and demo-safe.
- Concierge/search input is visible in the shell.
- Today's Briefing is compact.
- Urgent Issues appears as a small count-bearing briefing action.
- Work That Needs To Be Processed This Week and Jobs That Need To Go Out This Week are visible without overwhelming the first screen.

What is confusing:

- None observed as a blocker in this audit.

Dead/suspicious controls:

- No obvious dead Home controls found during smoke.

Recommended fixes:

- Keep as-is for now; use Home as the model for command-surface polish.

Safe changes made:

- None on Home.

Future slice:

- Add a small browser-level test for Home briefing route buttons if not already covered.

### My Work

What works:

- Launchpad framing is clear.
- One clock action/status is visible.
- My Schedule This Week, Assigned Tasks, Workflow Steps Waiting on Me, and Heads Up are present.
- Schedule is a compact weekly strip.

What is confusing:

- Intro copy repeated `Your day`.

Dead/suspicious controls:

- None found in the top launchpad.

Recommended fixes:

- Keep collapse/detail-on-demand direction.

Safe changes made:

- Changed intro copy to `Tasks assigned to you, workflows you're part of, and things your department may need help with.`

Future slice:

- Continue reducing lower-page job/task detail density if employee scroll remains too long in real demo data.

### Jobs

What works:

- Quick Access is absent.
- Jobs is framed as `Jobs Database`.
- Filters support department/type, organization, status, date range, risk, and owner.
- Pagination/page-size controls are present as `10 per page`, `25 per page`, `50 per page`.
- Create New Job is not visible on the global Jobs database in smoke.
- Export was not visible on the global Jobs database in smoke.

What is confusing:

- Department-specific job lists still had saved-view management controls before this pass.

Dead/suspicious controls:

- Save current view, Rename, Pin default, Delete on department job lists.

Recommended fixes:

- Keep preset lenses; remove management controls from employee-facing views.

Safe changes made:

- Removed saved-view management controls from `SharedJobsPage`.
- Updated copy from `saved views` to `preset lenses`.
- Preset lenses remain for fast filtering.

Future slice:

- Consider a detail drawer or row-preview control to reduce table scan fatigue further.

### Schedule

What works:

- Route loads without errors or horizontal overflow.
- Generic Quick Access is suppressed.

What is confusing:

- Needs deeper review for overlap with My Work schedule; this audit did not change schedule behavior.

Dead/suspicious controls:

- No route-breaking controls found during smoke.

Recommended fixes:

- Keep Schedule as the full scheduling workspace; keep My Work as a short personal preview.

Future slice:

- Add a Schedule-specific visual audit for weekly default, sticky filters, and employee vs leadership mode clarity.

### Directory

What works:

- Quick Access is absent.
- Connected/Standard/Team Member metadata is hidden on the Directory route.
- Search/filter structure is prominent.
- Directory is clearly about organizations, contacts, and locations.

What is confusing:

- `#directory` redirects to `#accounts`, which is functional but less intuitive.
- Page repeats Directory in the shell/header/body.
- Search language in smoke is `Search clients, organizations, contacts, and locations`, not the exact broader prompt text.
- New organization/contact/location controls may be too broad for normal employees.

Dead/suspicious controls:

- `New organization`, `New contact`, `New location` should be permission-reviewed.

Recommended fixes:

- Rename body title to `Find a Client or Organization`.
- Keep Client Command Center contextual after a record selection.
- Gate create controls explicitly.

Safe changes made:

- None on Directory in this pass.

Future slice:

- Directory title/search/header polish and permission check for create controls.

### Schools

What works:

- Open First, Attention Needed, This Week's Work, and Work Queues render.
- School-specific language is present: galleries, missing data, retakes, school follow-up, school tasks.
- No horizontal overflow.

What is confusing:

- Page still becomes long after the standardized hub sections.

Dead/suspicious controls:

- No obvious dead controls found in smoke.

Recommended fixes:

- Collapse lower sections behind queues or tabs after the hub.

Safe changes made:

- None in this pass beyond previous hub specificity commit.

Future slice:

- Schools detail-on-demand cleanup.

### Sports

What works:

- Route loads after a longer data wait.
- Sports-specific language is present: games/events, staffing gaps, team info, sports releases, release/graphics.
- No horizontal overflow.

What is confusing:

- Page is still very long after data finishes loading.
- Header still exposes `New Sports Job` and `Import Sports Jobs`; these may be valid for leads but should be permission-reviewed for standard employees.

Dead/suspicious controls:

- No route-breaking controls found, but create/import controls need role review.

Recommended fixes:

- Collapse lower boards after the hub.
- Gate create/import actions to intended Sports operators.

Safe changes made:

- None in this pass beyond previous hub specificity commit.

Future slice:

- Sports detail-on-demand cleanup and role review for create/import.

### Photography / Studios

What works:

- Photography Command Hub is clear.
- Today, job prep, travel/load-in, post-shoot handoffs, readiness, and senior photographer framing are present.
- No horizontal overflow.

What is confusing:

- No major issue found in smoke.

Dead/suspicious controls:

- No obvious route-breaking controls found.

Recommended fixes:

- Keep as a model for department-specific hub language.

Safe changes made:

- None.

Future slice:

- Add more reference-file/readiness affordance only if demo walkthrough needs it.

### Production

What works:

- Hub structure renders.
- Production language is specific: processing, QA, rush/at-risk, exports/releases, handoffs.
- No horizontal overflow.

What is confusing:

- Page shows `Internal server error` in smoke.
- Page shows `Viewing as Demo Admin`.

Dead/suspicious controls:

- Production queue links route to valid places, but the underlying API error makes the surface look broken.

Recommended fixes:

- Fix `GET /api/jobs/production-items` so read-only smoke does not attempt a mutating SQL sync.
- Replace `Viewing as Demo Admin` with role-neutral copy or hide it.

Safe changes made:

- None; API behavior is out of this UI cleanup scope.

Future slice:

- Production API read-only smoke fix before demo.

### Project Tracking

What works:

- Route loads cleanly.
- Command View, Open First, Main Work List, blocked/owner/deadline lenses are visible.
- No horizontal overflow.
- Still feels like project management rather than department operations.

What is confusing:

- No new issue found in smoke.

Dead/suspicious controls:

- No obvious route-breaking controls found.

Recommended fixes:

- Keep current structure; future work can add real saved role views only after the first slice stabilizes.

Safe changes made:

- None in this pass.

Future slice:

- Role presets and timeline/board polish.

### Search

What works:

- Route loads cleanly.
- Search is accessible as a utility route.

What is confusing:

- No major issue found in smoke.

Dead/suspicious controls:

- No obvious route-breaking controls found.

Recommended fixes:

- Keep global search connected to Home concierge expectations.

Safe changes made:

- None.

Future slice:

- Verify result actions route to precise records rather than broad pages.

### Notifications

What works:

- Route loads cleanly.
- No horizontal overflow.
- Actions are visible on alert cards.

What is confusing:

- Browser smoke showed a very long repeated critical alert list.
- It looks like a feed dump, not a triage surface.

Dead/suspicious controls:

- Mark Read, Acknowledge, Resolve appear repeatedly. They may work, but the volume and repetition make the page risky for demo trust.

Recommended fixes:

- Add compact grouped triage, pagination/page size, and detail-on-demand.

Safe changes made:

- None.

Future slice:

- Notification triage cleanup.

## Static Code Audit Findings

Searches reviewed:

- Empty/no-op link patterns such as `href="#"`, `href=""`, `to="#"`, no-op click handlers.
- Placeholder patterns such as `TODO`, `FIXME`, `Coming Soon`, `console.log`.
- Visible control labels such as `Save Current View`, `Pin Default`, `Rename`, `Delete`, `Export`, `Open Needs Attention`, `View in Project Tracking`, `Client Command Center`, `Anchor Date`, `Quick Access`, `Connected`, `Standard`, `Team Member`.

Notable findings:

| Finding | Location | Recommendation |
| --- | --- | --- |
| Hidden Needs Attention route remains | `packages/admin-web/src/navigation.ts` | Keep for compatibility, but reduce self-referential copy/actions. |
| Saved-view management controls existed on department job lists | `packages/admin-web/src/pages/SharedJobsPage.tsx` | Fixed. |
| Shell identity/status metadata remains on many routes | `packages/admin-web/src/app.tsx` | Decide whether to hide globally for normal users. |
| Anchor Date remains in legacy/admin surfaces | Dashboard/admin/operations surfaces | Rename if visible to normal users; otherwise keep in admin contexts. |
| Client Command Center direct route exists | `packages/admin-web/src/navigation.ts`, `PrepReadinessQueuePage.tsx` | Keep contextual, avoid making it a generic Directory tab. |

## Browser Smoke Results

Smoke environment: `npm run dev:smoke`

Viewport: desktop, 1440 x 1000

Note: smoke was run while audit/code/report files were intentionally dirty, so the local release guard displayed a `DIRTY STATE` banner. That was not counted as a route failure.

| Route | Result | Console errors | Horizontal overflow | Notes |
| --- | --- | --- | --- | --- |
| `#home` | Pass | 0 | 0 | Command center sections present. |
| `#my-work` | Pass | 0 | 0 | Launchpad sections present. |
| `#jobs` | Pass | 0 | 0 | Database filters and page sizes present. |
| `#schedule` | Pass | 0 | 0 | No loading loop observed. |
| `#directory` | Pass | 0 | 0 | Redirects to `#accounts`; repeated Directory wording remains. |
| `#schools` | Pass with scroll concern | 0 | 0 | Long page after hub sections. |
| `#sports` | Pass with scroll concern | 0 | 0 | Needed longer data wait; very long page after load. |
| `#studios` | Pass | 0 | 0 | Department-specific hub works. |
| `#production` | Fail with API banner | 0 browser errors | 0 | Shows `Internal server error`. |
| `#project-tracking` | Pass | 0 | 0 | Project-specific command surface works. |
| `#search` | Pass | 0 | 0 | Loads cleanly. |
| `#notifications` | Pass with major UX concern | 0 | 0 | Very long repeated alert list. |
| `#needs-attention` | Pass as hidden legacy route | 0 | 0 | Still feels destination-like. |

## Safe Changes Made

| Area | Change |
| --- | --- |
| My Work | Removed repeated `Your day:` prefix from the intro sentence. |
| Jobs | Removed visible Save current view, Rename, Pin default, and Delete controls from department job list surfaces. |
| Jobs | Kept preset lenses available for fast filtering. |
| Jobs | Updated copy from `saved views` to `preset lenses`. |
| Tests | Updated focused My Work and Shared Jobs tests for the new behavior. |

## Recommended Next Development Slices

1. Production API/read-only smoke fix: stop `GET /api/jobs/production-items` from attempting mutating SQL in read-only request mode.
2. Notifications triage cleanup: grouped alert inbox, pagination, severity filters, and detail-on-demand.
3. Needs Attention legacy cleanup: keep alias but remove self-referential CTAs and make it feel like a review desk entered from signals.
4. Directory title/search polish: reduce repeated Directory labels, clarify search wording, and review create button permissions.
5. Schools/Sports detail-on-demand cleanup: keep hub first, collapse long boards after queue links.
6. Shell metadata cleanup: demote or hide Connected/Standard/Team Member outside account/admin contexts.
7. Schedule polish: confirm weekly default and prevent overlap/confusion with My Work schedule.
8. Search/Concierge result precision: verify result actions land on precise records where possible.

## Validation Results

Commands run:

| Command | Result |
| --- | --- |
| `npm run test -w packages/admin-web -- myWorkPage.test.tsx sharedJobPages.test.tsx` | Passed, 32 tests. |
| `npm run build -w packages/admin-web` | Passed. |
| `npm run lint` | Passed. |
| `git diff --check` | Passed; only Windows line-ending notices were reported. |
