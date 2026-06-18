# Mission Control — Actionability & Source-Mapping Audit (Phase 0)

**Date:** 2026-06-18
**Branch:** `feature/work-spine-foundation-v1` · **HEAD:** `98af185` · working tree clean
**Stash (do not touch):** `stash@{0}` — "TEMP debug: uncontrolled-input warning capture"
**Unpushed:** 6 commits (`98af185`, `264fe3c`, `0476f5c`, `3d139ad`, `4a83adf`, `6d44f3f`)
**Method:** Five read-only domain sweeps over `packages/admin-web/src` (frontend) and `packages/api/src` + `db/migrations` (backend), plus direct re-verification of the load-bearing citations. No code changed in this phase.

This document is the Phase 0 deliverable required before any implementation. It names exact files, models, routes, permissions, and tests, and ends with the genuine conflicts that must be decided **before** code changes.

---

## 1. Executive confirmation of the three foundational problems

The feedback's three problems are confirmed in code:

1. **Reports problems without opening the exact problem.** The entire Company Command / Home surface is rendered from one static demo file and its only deep-link affordance throws the record ID away. See §2 and §3.
2. **Derived counts drift from underlying records after an action.** Staffing counts recompute only on a full re-fetch and via two independent code paths; Jobs-index counts are decorative. See §5 and §6.
3. **Schools data is split, not canonical.** District→School parent and contextual contact roles exist **twice** (canonical Directory vs. the migration-144 "Client Command Center" stack), and a time-bound school-year service profile does not exist as a reusable entity. See §7 and §10.

---

## 2. Cross-cutting fact: the Company Command / Home surface is 100% demo-backed

Every count, panel, and queue on the Leadership/Company Command home reads from static literals in
`packages/admin-web/src/home/homeDemoData.ts`. Independently confirmed by two sweeps.

- `CompanyCommandHome.tsx` imports `buildCompanyCommandCards` from `homeDemoData` (cards are static literals, only "On Fire" is derived from the demo array — `homeDemoData.ts:204-280`).
- `AttendanceRiskPanel.tsx` renders `DEMO_ATTENDANCE_RISK`; `WeatherImpactPanel.tsx` renders `DEMO_WEATHER_IMPACT`; `LeadershipReportsStrip.tsx` renders `DEMO_LEADERSHIP_REPORTS`; `CompanyNeedsAttention.tsx` renders `DEMO_NEEDS_ATTENTION`.
- The demo job IDs (`edina-soccer`, `white-bear-gallery`, …) exist **only** in `homeDemoData.ts` / `sportsDemoData.ts` — they are not canonical job records, so no Home affordance *can* resolve to a real record today.

**Critical nuance — "demo card" ≠ "no backend."** Real, DB-backed backends already exist for most of these domains and are simply not wired to Home:

| Home surface | Real backend exists? | Where the real one lives |
|---|---|---|
| Late / Not Clocked In | **Yes** | `api/src/services/attendanceOperations.ts`, `routes/attendance.ts` (`/api/attendance/operations`), `AttendanceOperationsPanel.tsx`, tables `shift_attendance_runtime` (075) |
| Jobs Behind / On Fire | **Yes** | `services/jobsApi.ts`, `services/projectTracking`, `ProjectTrackingFoundation.tsx` |
| Staffing Risk | **Yes** | `services/scheduleStaffing.ts` (both sides), `StaffAssignmentBoard.tsx`, table `work_shift` |
| Client Issues | **Partial** | Client Command Center (real accounts, not "cases") + Zendesk (real-capable, fixtures by default) |
| Notifications/ack | **Yes** | `app_event` outbox → `worker`, `ops_notification`, `POST /notifications/:id/acknowledge` |
| **Weather Watch** | **No — none** | Only `DEMO_WEATHER_IMPACT` + `mockStudioServices.ts` "Mocked forecast". No provider, key, route, or table. |

**Implication:** Phase 1 is mostly a *wiring + contract* problem, not a "build the backend" problem — except Weather, which has no backend and (per locked Decision #3) must be hidden/disabled, never faked.

---

## 3. Route / Action matrix — Company Command + Needs Attention (Decision #1)

Count source legend: **derived** = computed from a record/array; **literal** = hardcoded string.

| Card / item | Count source (path:line) | Current destination hash → route | Opens exact record? | Defect |
|---|---|---|---|---|
| On Fire | derived `countBySeverity(DEMO_NEEDS_ATTENTION).urgent` (homeDemoData.ts:205) | `#project-tracking` → project-tracking-command-center | No | Generic tracker, no `severity=urgent` filter |
| Shoots Today | literal "18" (homeDemoData.ts:219) | `#schedule` → schedule-workspace | No | Fabricated count; not filtered to today |
| Staffing Risk | literal "3" (homeDemoData.ts:228) | `#operations/staffing` → Staff Assignment Board | No | Generic board, not the 3 at-risk records |
| **Late / Not Clocked In** | literal "2" (homeDemoData.ts:237) | `#operations/staffing` → Staff Assignment Board | No | **Label says "View attendance" but routes to staffing** (homeDemoData.ts:240-241). Real route `operations-attendance`/`#employees/attendance` unused |
| Jobs Behind | literal "5" (homeDemoData.ts:246) | `#project-tracking` → tracker | No | Fabricated; no "behind" filter |
| **Weather Watch** | literal "6" (homeDemoData.ts:255) | `#schedule` → schedule-workspace | No | Count (6) contradicts panel (4 rows); **no weather backend exists** |
| Production Load | literal "5 behind" (homeDemoData.ts:264) | `#production` → production-hub | No | Fabricated; no link to behind jobs |
| **Client Issues** | literal "2" (homeDemoData.ts:273) | `#leadership` → executive dashboard | No | **Label says "Open client success" but routes to executive** (homeDemoData.ts:276-277) |
| Needs Attention rows (×9) | `DEMO_NEEDS_ATTENTION` (homeDemoData.ts:77-200) | `RelatedJobLink` → hardcoded `#jobs` (homeShared.tsx:42) | No | **`RelatedJobLink` discards `relatedJobId`; always opens generic Jobs list.** 2 of 9 rows have no `relatedJobId` → render no link at all |
| Operating Area Pulse (×7) | literal `issues[]` strings (homeDemoData.ts:284-354) | per-area `#schools`/`#sports`/… | No | Department hubs, not the specific issue; Client Success card also mis-targets `#leadership` |
| Attendance Risk panel (×5) | `DEMO_ATTENDANCE_RISK` (homeDemoData.ts:358-417) | **none** (AttendanceRiskPanel.tsx:25-36) | No | **Zero navigation** — read-only text; `relatedJobId` on rows unused |
| Weather Impact panel (×4) | `DEMO_WEATHER_IMPACT` (homeDemoData.ts:421-471) | `RelatedJobLink` → `#jobs` | No | Same `RelatedJobLink` defect; contradicts the "6" card |
| Leadership Reports strip (×9) | `DEMO_LEADERSHIP_REPORTS` (homeDemoData.ts:475-485) | **none** (LeadershipReportsStrip.tsx:14-18) | No | Entirely non-interactive `<article>`s |

**The single most pervasive defect:** `RelatedJobLink({ jobName })` takes only a name and hardcodes `href="#jobs"` (`home/homeShared.tsx:40-47`). It is the only record affordance on Home and it cannot deep-link. Fixing this one component (accept `relatedJobId`, emit `#jobs/{id}` or the new focus param) repairs Needs Attention rows and Weather rows at once.

**Navigation primitive:** `navigateToHash(hash)` simply sets `window.location.hash` (`homeShared.tsx:5-7`); the hash is resolved by `resolveRouteId` (`navigation.ts:~1937`). `resolveRouteId` currently strips query params for these section hashes, so today no card can carry a filter/focus. The actionability contract will need a focus param that survives `resolveRouteId` + refresh.

---

## 4. Domain source map (canonical models / selectors / routes)

| Domain | Frontend | Backend / table | Real or demo |
|---|---|---|---|
| Needs Attention | `home/needsAttention.ts` (selectors, six-reason rule), `CompanyNeedsAttention.tsx` | — (demo array) | **Demo** on Home; the six-reason rule is canonical logic |
| Company Command | `home/CompanyCommandHome.tsx`, `home/homeDemoData.ts` | — | **Demo** |
| Attendance | `pages/Attendance.tsx`, `components/attendance/AttendanceOperationsPanel.tsx` | `services/attendanceOperations.ts`, `routes/attendance.ts`; `shift_attendance_runtime`/`_history` (075), `time_session`/`clock_event` (034) | **Real** (Home card is demo) |
| Staffing | `pages/StaffAssignmentBoard.tsx`, `components/ShootStaffingCommand.tsx`, `services/scheduleStaffing.ts` | `services/scheduleStaffing.ts`, `routes/schedule.ts`; `work_shift`, `shoot_staffing_requirement`, `staffing_template*` | **Real** |
| Jobs | `pages/SharedJobsPage.tsx`, `pages/SharedJobDetailPage.tsx`, `services/jobsApi.ts` | `services/jobTruth/jobService.ts`, `routes/jobs.ts`; `jobs`, shared workflow runs | **Real** |
| Production Tracker | `pages/ProjectTrackingFoundation.tsx`, `services/projectTracking` | project workflow command-center | **Real** |
| Client Success | `pages/ClientCommandCenter.tsx`, `pages/CustomerService.tsx` | `routes/clientCommandCenter.ts` (real accounts/contacts), `routes/zendesk.ts` + `zendeskProvider.ts` (live OR `zendeskFixtures.ts`) | **Real accounts**; Zendesk **fixtures by default**; Home "Client Issues" **demo** |
| Weather | `home/WeatherImpactPanel.tsx`, `services/shootHotSheet.ts` | none | **Demo only — no backend** |
| Notifications | `pages/*` notification center, `routes/notifications.ts` | `app_event` outbox (003) → `worker/src/outbox/processor.ts` → `ops_notification` (063); ack endpoint `POST /notifications/:id/acknowledge` | **Real** (in-app + queue + ack); email/SMS/push are stubs |
| Directory / Org / Contact / Location | `pages/Organizations.tsx`, `components/directory/*`, `services/organizationApi.ts` | `routes/organizations.ts`, `services/organizations.ts`; `organization` (028), `organization_contact` (028), `organization_contact_relationship` (053), `shoot_location` (028), `school_profile` (071) | **Real** |
| Workflow templates/steps | `WorkflowTemplateBuilderPage.tsx`, `ProjectWorkflowMap.tsx`, `QuickWorkflowStepEditor.tsx` | project workflow services | **Real**; `canManageWorkflowTemplates` gates recipe editing; `canEditJobWorkflow` (new, `permissions.ts`) gates per-job status |

---

## 5. Trace — one staffing assignment (Decision #4)

`ShootStaffingCommand.tsx` `<select>.onChange` → `handleAssign` → `assignShootStaffingSlot`
(`services/scheduleStaffing.ts`) → `POST /api/schedule/shoots/:id/staffing/assign`
(`routes/schedule.ts`, `requireAction("schedule.manage")`) → backend `assignShootStaffingSlot`
(`services/scheduleStaffing.ts:2023`) → writes **`work_shift`** (`createShift`/`updateShift`), appends `reassignment_history`, queues notifications, returns a freshly rebuilt snapshot.

**Lifecycle today** (`work_shift.status` = draft/published/completed/cancelled, mapped in `staffingFoundation.ts:94`):

| Required state | Modeled? |
|---|---|
| open / unfilled | Yes (synthetic slot, no shift) |
| assigned draft | Yes (`status='draft'`) |
| published-awaiting-ack | **No** |
| acknowledged | **No** |
| declined | **No** |
| reassigned | Partial (event in `reassignment_history` jsonb, not a status) |
| removed / canceled | Yes (`status='cancelled'`) |

**Findings:**
- **Name updates immediately** in the drawer (it swaps in the mutation's returned snapshot). **Summary counts update only via a full board re-fetch** (`StaffAssignmentBoard.tsx` calls `load(anchorDate)` on `onUpdated`); the authoritative snapshot already in hand is not merged → stale tiles if the re-fetch races/fails.
- **Two independent count implementations:** dashboard via SQL `COUNT(DISTINCT ws.assigned_user_id)` vs. snapshot via `assignments.length`. They can disagree (double-booked person, `conflict_warning_count` measures different things on each side).
- **Publish is real:** `publishShootStaffing` flips draft→published and **queues `schedule.staffing.published` notifications** — but does **not** set `requiresAcknowledgement: true`, and **no acknowledge/decline route exists** for assignments. Enabling ack is a small rule change (`scheduleStaffing.ts` / `opsNotifications.ts`), not new infrastructure.
- **Scheduled hours exist** (`scheduling.ts` computes `scheduled_hours_week` per member, distinct from payroll) but there is **no weekly capacity view** on the board — only an overtime flag at ≥40h.
- Tests: `api/tests/schedule.test.ts` (assign + conflict-override + publish-override), `staffingPhase1A..4A.test.ts` (domain math). Frontend `staffAssignmentBoardPage.test.tsx` mocks services → **no test asserts counts recalc after a real assign**.

---

## 6. Trace — one Jobs summary count (Decision #6)

`SharedJobsPage.tsx` calls `listSharedJobs` **once** on mount (`services/jobsApi.ts`; server params are only `department_type`/`search`/`day_date`), then does all filtering, stage derivation, and counting **client-side** over `filteredItems`.

- **"Job Snapshot" (10 cards)** = `buildJobManagementStats(filteredItems)` (`SharedJobsPage.tsx:499-515`); **"Intake Review Queue" (6 cards)** = `buildIntakeReviewQueue(filteredItems)`. Both derived from the loaded list.
- **Decorative — clicking a count does not filter.** The cards are `<article>`/`<span>` with no handler; the queue's "action" strings ("Request missing info", "Assign owner") are inert `<em>`. Confirmed by `sharedJobPages.test.tsx` asserting them as plain text.
- **Row click opens neither a drawer nor the detail route** — it sets `selectedJobId` + a `preview` query param and renders a persistent right-side `DetailPreviewPanel`. Opening requires a separate "Open job" / "Open Full Job Detail" button.
- **Oversized header:** ~16 summary cards + header + filter toolbar render before the first table row.
- **Contrast worth copying:** the **Production Tracker** summary metrics and "Needs Attention Review" groups **are** clickable filters (`ProjectTrackingFoundation.tsx:2437-2451`, `:1183-1191`) — the exact affordance the Jobs index lacks.
- **Cross-surface drift:** Production Tracker counts only workflow-linked, non-demo rows (`isCuratedProjectDashboardRow`), so the same job can be counted on one surface and not the other.
- **Job detail** (`SharedJobDetailPage.tsx`): dense metadata first (13-field Truth Snapshot + 8 cards) before the actionable "Missing Info and Blockers" list; calendar/staffing/missing-info statuses each rendered 3+ times; unclamped free-text notes risk overflow.
- Tests: `sharedJobPages.test.tsx`, `projectTrackingFoundationPage.test.tsx`, `needsAttention.test.ts`, `jobRoutingFoundation.test.ts`.

---

## 7. Trace — one organization/contact creation (Decisions #7-9)

`Organizations.tsx` → `OrganizationEditorForm` (`components/directory/DirectoryActionForms.tsx:109`) →
`POST /api/organizations` (`routes/organizations.ts:846`) → `createOrganization` (`services/organizations.ts:1337`).

- **Backend accepts only 7 fields** (`createOrganizationSchema`, `routes/organizations.ts:280-288`): `canonical_name`, `display_name`, `logo_url`, `account_type`, `active_status`, `aliases`, `notes`. **No `website`, no `parent_organization_id`, no brand, no phone.**
- **No district/parent picker, no school section** — `account_type` is a plain enum select; school-specific fields are absent from the create form.
- **One inline primary contact only** — cannot pick an existing contact or add multiple in the create flow (those are separate drawers on an existing org).
- **Website is not normalized** — `<input type="url">` (rejects a bare domain) and the value is **concatenated into `notes` text** via `buildOrganizationNotes`, never stored as a column. Brand colors/mascot and logo metadata are likewise **stuffed into `notes`** (no columns; this buried-in-notes behavior is even asserted as intended by `organizationsPage.test.tsx`).
- **Raw "Failed to fetch" surfaces** — `api.ts` rethrows the browser network message; `Organizations.tsx` `messageFor` returns `error.message` verbatim.
- Tests: `api/tests/organizationsDirectory.test.ts` (17 cases, none asserting parent/website), frontend `organizationsPage.test.tsx`, `clientCommandCenterPage.test.tsx` (the only place `parent_organization_id` is exercised).

---

## 8. Mock / demo seams (do not mistake for production)

- **Weather** — entirely demo, no backend (`homeDemoData.ts:421`, `mockStudioServices.ts:172`). Per Decision #3 → hide/disable.
- **Home "Late / Not Clocked In" card + Attendance Risk panel** — demo, despite a fully real attendance backend.
- **Home "Client Issues" / CSR queue** — demo, despite real Client Command Center + Zendesk pipes.
- **Zendesk** — fixtures unless `ZENDESK_LIVE` creds configured.
- **Notification channels** — in-app + queue + ack are real; **email/SMS/push are stubs** (`worker/src/notifications/*Stub.ts`).
- **Studio shoot-briefing weather** — mocked (`mockStudioServices.ts`).

---

## 9. Migrations, tests, shared components

- **Migrations:** `db/migrations` at **repo root** (not under `packages/api`). **153 `.sql` files**, `001_init.sql` … `155_…`. Runner `packages/api/scripts/migrate.ts` (`npm run migrate`), lexicographic sort, tracked in `app_migration`, idempotent. Related: `seed.ts`, `reset-local-demo-db.ts`, `verify-fresh-db-contract.ts`.
- **API tests:** `packages/api/tests`, **161 files**, `npm test` → `node scripts/run-vitest-chunks.mjs` (forks, `--maxWorkers 1`, real DB). Smoke: `test:smoke:jobs` → `jobTruthLayer.test.ts`.
- **Admin-web tests:** `packages/admin-web/src/test`, **79 files**, `npm test` → `vitest run --maxWorkers 1` (400 tests currently green).
- **Shared components to extend (not duplicate):** `home/needsAttention.ts` (six-reason rule), `home/homeShared.tsx` (`navigateToHash`, `RelatedJobLink`, `HomeSectionHeader`), `components/jobs/sharedJobRouting.ts`, `components/HelpTooltip.tsx`, `permissions.ts` (`canChangeSharedJobStatus`, `canEditJobWorkflow`, `canManageWorkflowTemplates`), `services/projectTracking` command-group filters (the clickable-filter pattern to reuse for Jobs).

---

## 10. Genuine conflicts to decide BEFORE changing code

These are the items the brief asked to surface before implementation. They do **not** block Phases 1-3; they shape Phase 4 and the Phase 1 data strategy.

### Conflict A — "the canonical Organization model" is actually two parallel stacks
Decision #7 says District/School extend "the existing canonical Organization model" and to not build a second Schools DB. In reality there are **two** stacks over the same `organization` table:

- **Canonical Directory** (`pages/Organizations.tsx`, `createOrganizationSchema`): models district as **free text** `school_profile.district_name` (071), supports only a **scalar** contact role (`relationship_role`, 053), buries website/brand/phone in `notes`, no parent FK in its create/edit path.
- **Client Command Center** (migration **144**, `pages/ClientCommandCenter.tsx`): has the real `organization.parent_organization_id` self-FK, `client_entity_kind`/`client_organization_type`, array `client_roles[]`, and `account_service`.

The columns coexist (144 is additive), so it is **not a hard schema conflict** — it is an **ownership/semantic** one. Building Schools on the Directory page requires either **adopting the 144 layer into the Directory** or formally designating one stack canonical and migrating the other. **This is a product decision, not something to silently pick.**

### Conflict B — no time-bound school-year service profile exists
Decision #9 requires separating static account truth from per-year service truth. Today: `account_service` (144) is **static** (`UNIQUE (tenant_id, account_id, service_type)`, no year column); `school_profile.school_year_label` (071) is a single overwritable label; `school_job_profiles` (089) has `school_year` + yearbook/composite/ID flags but is **keyed 1:1 to a `jobs` row**, not the school org. There is **no `(organization_id, school_year)` service-profile table** → Phase 4 needs **net-new schema** (the brief permits this where the current schema cannot represent the requirement).

### Conflict C — three overlapping contact-role vocabularies
`relationship_role` scalar (053) + `client_roles[]` (144) + `school_contact_categories[]` (071) all describe the same contact↔org link. Decision #8 wants contextual roles; these should be **reconciled before adding a fourth**.

### Already-decided-by-brief, restated for code:
- **Weather** has no provider → hide/disable (Decision #3), never fake.
- **Staffing ack/decline** lifecycle is absent (Decision #4) → net-new state, but publish-notify already exists, so this is incremental.

---

## 11. Recommended slice sequencing (maps findings → the brief's phases)

1. **Phase 1 — Actionability contract + Urgent Window.** Add a shared operational-issue/action-target type + a focus param that survives `resolveRouteId`/refresh; fix `RelatedJobLink` to carry IDs; correct the two mislabeled card destinations; make a reusable card that cannot render an enabled dead CTA; hide the Weather card (no backend). *Decision needed:* keep demo data behind an honest contract first, or wire the real backends (attendance/jobs/staffing/notifications/client-command-center all exist) in this same slice — see open question.
2. **Phase 2 — Staffing coherence.** Merge the returned snapshot into the board (kill the re-fetch-only drift), reconcile the two count paths, add ack/decline + `requiresAcknowledgement` on publish, add a weekly scheduled-hours capacity view.
3. **Phase 3 — Jobs quick-view + compact index.** Make snapshot counts clickable filters (reuse the Production Tracker pattern), add a quick-view drawer with focus-on-reason, compact the header, reorder detail to actionable-first.
4. **Phase 4 — Canonical Directory + Schools.** Blocked on Conflict A/B/C decisions. Reconcile the two org stacks, add the time-bound service-profile table, support parent picker + multiple/existing contacts + website normalization in the create flow.
5. **Phase 5 — Monday inventory + dry-run pilot only.** No production import.

---

## Open questions for the product owner (must answer before Phase 1/Phase 4 code)

1. **Phase 1 data strategy:** make every card/destination honest + deep-linkable **on the existing demo data first** (smaller, ships the contract fast), **or** wire the real backends now (attendance, jobs, staffing, notifications, client-command-center) so the numbers are live (larger)?
2. **Phase 4 canonical org stack (Conflict A):** designate the **migration-144 Client Command Center layer** as canonical and extend the Directory UI onto it (recommended — it already has parent FK + contextual roles + services), **or** keep the Directory stack canonical and migrate 144's parent/roles/services into it?
