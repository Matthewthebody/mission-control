# Work Spine Foundation Handoff

## Branch

- Branch: `feature/work-spine-foundation-v1`
- Validation baseline HEAD before this handoff note: `08ba7f4 Tighten Project Tracking action links`
- Origin comparison at handoff start: `14` commits ahead of `origin/feature/work-spine-foundation-v1`

## Product Mental Model

- Home is the daily command center.
- My Work is the employee day.
- Needs Attention is the leadership review queue.
- Project Tracking is the source-of-truth work spine.
- Directory is the relationship spine.
- Schools and Sports are department command hubs.
- Photography is the field readiness and shoot execution hub.
- Attendance is the leadership attendance review surface.
- Navigation is grouped around the user mental model: Start Here, Work Spine, Departments, Company.

## Commit Story

### Home / Employee Command Surfaces

- Commits: `a95db27`, `ee9fa21`
- Outcome: Home now leads with search/concierge, clock action, useful daily briefing, honest action labels, expandable/routable summary cards, and clearer employee-day separation through My Work.
- Intentional deferrals: no new task drawer, no new Home data source, no new employee workflow model.

### Needs Attention Review Queue

- Commits: `c398842`, `ee9fa21`, `08ba7f4`
- Outcome: Compliance language was softened into Needs Attention, legacy aliases remain supported, detail actions avoid raw internal labels, and Project Tracking links are precise when an existing supported workflow route is present.
- Intentional deferrals: no new review engine, no new backend metadata, no fake direct links.

### Local Smoke Reliability

- Commits: `94cfea6`, `94d5a58`
- Outcome: Local smoke uses stable ports and Windows guidance documents the expected local setup.
- Intentional deferrals: no production deployment changes.

### Project Tracking Work Spine

- Commits: `af99b42`, `c4bec19`, `4ee0539`, `08ba7f4`
- Outcome: Project Tracking is positioned as the source of truth for owners, due dates, blockers, current workflow steps, and workflow detail routes.
- Intentional deferrals: no new Project Tracking filters, no new workflow data model, no backend route metadata expansion.

### Schools and Sports Command Hubs

- Commit: `11835f2`
- Outcome: Schools and Sports read as summary-first command hubs with work-spine and blocker entry points.
- Intentional deferrals: no department rewrite, no new queue engine.

### Photography Command Hub

- Commit: `12766a7`
- Outcome: Photography reads as a field readiness and shoot execution hub with travel, prep, readiness, closeout, and work-spine actions.
- Intentional deferrals: no new Google Maps/reference-file backend behavior.

### Directory Source Of Truth / Related Work

- Commits: `66eaa07`, `1fc3229`
- Outcome: Directory owns relationships and source-of-truth checks, while exact related work only opens when existing operations data provides a real route.
- Intentional deferrals: no active-work rollups or invented relationship counts.

### Navigation Simplification

- Commit: `7b088f0`
- Outcome: Primary navigation is grouped by mental model instead of implementation modules.
- Intentional deferrals: no auth/permissions overhaul, no route removal for preserved aliases.

## Preserved Routes And Aliases

- Home: `#home`
- My Work: `#my-work`
- Needs Attention: `#needs-attention`
- Legacy Needs Attention aliases: `#compliance`, `#review-desk`, `#production/review`, `#employees/compliance`
- Attendance Review: `#employees/attendance`
- Project Tracking list: `#project-tracking`
- Project Tracking detail: `#project-tracking/workflows/:workflowRunId`
- Schools: `#schools`
- Sports: `#sports`
- Photography: `#studios`
- Directory contacts: `#directory/contacts`
- Directory accounts: `#accounts`

## Validation Commands Passed

- `npm run test -w packages/admin-web -- dashboardPersonalization.test.tsx compliancePage.test.tsx projectTrackingFoundationPage.test.tsx workSpineRouting.test.ts appAuth.test.tsx organizationsPage.test.tsx schoolsHubPage.test.tsx sportsOverviewPage.test.tsx photographyWorkspacePage.test.tsx attendancePage.test.tsx myWorkPage.test.tsx conciergeSearchPage.test.tsx conciergeCommandPalette.test.tsx`
- `npm run test -w packages/api -- homeDashboard.test.ts attendanceOperations.test.ts employeeExperience.test.ts timeClockShellState.test.ts projectTrackingFoundation.test.ts organizationsDirectory.test.ts globalSearch.test.ts locations.test.ts resetLocalDemoDb.test.ts`
- `npm run build -w packages/admin-web`
- `npm run build -w packages/api`
- `npm run lint`
- `git diff --check`

## Browser Smoke Checked

- Routes: `#home`, `#my-work`, `#needs-attention`, `#employees/attendance`, `#project-tracking`, `#project-tracking/workflows/c4399818-31f3-4a58-bbaf-8ea03d007fca`, `#schools`, `#sports`, `#studios`, `#directory/contacts`, `#accounts`
- Aliases: `#compliance`, `#review-desk`, `#production/review`, `#employees/compliance`, `#studios`, `#accounts`
- Click paths: grouped sidebar navigation, Home to Needs Attention, Home to Project Tracking, Needs Attention to Attendance Review, Project Tracking row to workflow detail, Directory to Project Tracking and Needs Attention, Schools to Project Tracking, Sports to Project Tracking, Photography to Project Tracking, Photography Job Prep, Photography Travel, and browser back/forward.
- No auth or CORS workaround was needed.
- No raw hashes appeared as primary visible copy in the checked routes.

## Deferred Work

- Backend related-work route metadata where real workflow/job/shoot links already exist.
- Additional precise links for live data that currently only exposes generic Project Tracking routes.
- Any Jessica/Monday.com analysis unless Matthew explicitly says `go baby go`.
- Demo reset UI, new filters, new API behavior, new data models, and broad UI redesign.

## Known Risks / Watch Items

- Some live Schools and Sports rows expose many duplicate action labels; the branch keeps behavior safe, but future polish can make row-level actions easier to target and review.
- Some live Directory records have no precise related-work link; the UI intentionally falls back honestly instead of inventing one.
- Project Tracking precision is limited by existing `action_hash`, `actionHash`, or workflow run id data.

## Recommended Next Scope

After push and PR review, the safest Scope 13 is branch review fixes from PR feedback. If review is clean, the next product slice should be backend related-work route metadata only where real workflow/job/shoot links already exist.
