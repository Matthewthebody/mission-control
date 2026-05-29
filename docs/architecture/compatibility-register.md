# Compatibility Register

## Purpose
This register is the implementation-facing inventory of compatibility aliases, deprecated wrappers, and old file or module names that are still intentionally allowed during the reset.

It exists so we can freeze the current baseline honestly, measure alias usage, and remove seams deliberately instead of forgetting where the old language is still alive.

## Scope
Included here:
- legacy route aliases still allowed
- legacy module and permission aliases still allowed
- old file or module names still allowed as shims
- API and type aliases still allowed for migration safety
- deferred destructive storage renames that still back canonical surfaces

Excluded here:
- normal business-data aliases
- import parser synonyms
- search synonyms
- speculative future deprecations not grounded in current code

## Register

| Alias Scope | Canonical Owner | Allowed Alias / Shim | Current Source | Allowed Behavior Now | Removal Gate |
| --- | --- | --- | --- | --- | --- |
| UI-only | `#teams/communications`, route id `teams-communications` | `#communications`, route id `communications` | `packages/admin-web/src/navigation.ts`, `packages/admin-web/src/app.tsx` | Hidden hash alias only. It must not reappear as a first-class workspace owner. | Remove after bookmarks, launchers, and smoke tests stop targeting `#communications`. |
| UI-only | `#exceptions`, `#operations/exceptions` | `#watchlist`, `#watch`, `#operations/watch`, `#operations/urgent-watch` | `packages/admin-web/src/navigation.ts` | Hidden hash aliases may still resolve into Exceptions. Visible product ownership stays with Exceptions. | Remove after saved hashes, launcher links, and regression tests stop using watch-era routes. |
| UI-only | `#schools/exceptions`, `#sports/exceptions`, `#people/exceptions` | `#schools/watchlist`, `#sports/watchlist`, `#employees/exceptions` | `packages/admin-web/src/navigation.ts` | Department and people exception aliases may still resolve, but they are compatibility-only. | Remove after notifications, bookmarks, and department tests stop targeting the old hashes. |
| UI-only | `Studios`, `#studios/*` | `#photography/*`, `#operations/shoots`, `#shoots` | `packages/admin-web/src/navigation.ts` | Studios owns the live department surface. Photography-era hashes survive only as hidden redirects. | Remove after shell routing, links, and tests stop referencing photography-era hashes. |
| UI-only | `Graphics`, `#graphics/*` | `#production/*`, `#projects`, `#sports/production` | `packages/admin-web/src/navigation.ts` | Graphics owns the live department surface. Production-era hashes remain compatibility routes only. | Remove after queues, bookmarks, and navigation tests stop targeting production-era hashes. |
| UI-only | `#files` | `#production/assets`, `#graphics/files` | `packages/admin-web/src/navigation.ts`, `packages/admin-web/src/app.tsx` | Files stays the visible owner while the runtime still rides the older graphics asset seam. | Remove after a dedicated shared Files runtime replaces the production asset backing surface. |
| UI-only | `Accounts`, `Contacts`, `Locations` canonical child routes | `#directory`, `#directory/contacts`, `#contacts`, `#directory/locations`, `#directory/accounts`, `#organizations` | `packages/admin-web/src/navigation.ts` | Resolver may keep routing directory-era hashes into the canonical Accounts and Contacts surfaces. | Remove after internal shortcuts and saved links stop emitting directory-era hashes. |
| UI-only | `StudiosWorkspace` | `PhotographyWorkspace.tsx` file name and deprecated `PhotographyWorkspace` export | `packages/admin-web/src/pages/PhotographyWorkspace.tsx` | Visible naming must stay Studios. The old file and export remain only so imports keep compiling. | Remove after imports and tests stop referencing `PhotographyWorkspace`. |
| UI-only | `OperationsExceptions` | `OperationsWatch.tsx` file name and deprecated `OperationsWatch` export | `packages/admin-web/src/pages/OperationsWatch.tsx` | Visible naming must stay Exceptions. The old module name remains a shim only. | Remove after imports and tests stop referencing `OperationsWatch`. |
| UI-only | `SharedExceptionsPage` | `SharedWatchlistPage.tsx` file name and deprecated `SharedWatchlistPage` export | `packages/admin-web/src/pages/SharedWatchlistPage.tsx` | Visible naming must stay Exceptions. The old module name remains a shim only. | Remove after imports and tests stop referencing `SharedWatchlistPage`. |
| UI-only | Graphics-facing workspace language | Production-named graphics modules such as `ProductionProjects.tsx`, `ProductionAssetsPage.tsx`, `ProductionLeadBoard.tsx`, and `ProductionProjectDetailPanel.tsx` | `packages/admin-web/src/pages/ProductionProjects.tsx`, `packages/admin-web/src/pages/ProductionAssetsPage.tsx`, `packages/admin-web/src/components/projects/ProductionLeadBoard.tsx`, `packages/admin-web/src/components/projects/ProductionProjectDetailPanel.tsx` | Visible product language may say Graphics while these file names remain implementation shims. | Remove after a dedicated low-risk module rename pass updates imports, tests, and history references. |
| route-only | `/projects/{portal_project_key}/status` | `/projects/{portal_project_key}` | `docs/architecture/phase-one-account-portal-mvp-runtime-plan.md`, `packages/api/src/types/microsoft365ClientPortal.ts` | Bare project route resolves only to the status page. It is a bounded convenience alias, not a second page owner. | Remove only if the portal runtime intentionally drops the short-form route. |
| permission-only | `canAccessSharedExceptions`, canonical `exceptions` module access | deprecated `canAccessSharedWatchlist`, `watchlist.read`, and deprecated module key `urgent_watch` | `packages/admin-web/src/permissions.ts`, `packages/api/src/types/operatingSystem.ts`, `packages/api/src/services/operatingSystemAccess.ts` | Canonical exception wrappers own the decision. Watch-era grants remain migration aliases only. | Remove after auth producers, stored visibility state, and callers emit only canonical exception permissions. |
| permission-only | `canAccessStudiosWorkspace` | deprecated `canAccessPhotographyWorkspace` plus task-scope alias `photography -> studios` | `packages/admin-web/src/permissions.ts` | Studios owns shell access. Photography-era wrappers survive only to keep callers compiling. | Remove after imports and task-scope producers stop referencing photography-era identifiers. |
| permission-only | `canAccessGraphicsWorkspace` | deprecated `canAccessProductionProjects`, legacy graphics view/manage permission aliases, task-scope alias `production -> graphics`, and production-era role vocabulary such as `production_staff` | `packages/admin-web/src/permissions.ts` | Graphics owns shell access. Production-era wrappers and permission aliases remain compatibility-only. | Remove after upstream auth and config producers emit only canonical graphics permissions. |
| API-only | `/api/exceptions` | `/api/watch`, `/api/watch/:id`, `/api/watch/:id/actions` | `packages/api/src/routes/exceptions.ts`, `packages/api/src/routes/watch.ts` | `/api/watch` remains a live compatibility alias and must emit deprecation headers. | Remove after clients, smoke tests, and logs show zero live traffic to `/api/watch*` across the agreed observation window. |
| API-only | `/api/employee/events/:id` and `/api/employee/events/:id/acknowledge` | `/api/employee/shifts/:id` and `/api/employee/shifts/:id/acknowledge` | `packages/api/src/routes/employee.ts` | Event-native routes own My Work detail and acknowledgement. Shift routes remain migration aliases only and must emit deprecation headers. | Remove after admin and mobile clients stop calling shift detail and shift acknowledgement routes. |
| API-only | canonical frontend Exceptions API and contracts | `urgentWatchApi.ts` and `urgentWatchTypes.ts` import surfaces | `packages/admin-web/src/services/urgentWatchApi.ts`, `packages/admin-web/src/urgentWatchTypes.ts` | Exceptions owns the live API contract. Urgent-watch modules remain alias shims for legacy imports only. | Remove after frontend imports stop referencing urgent-watch module names. |
| API-only | `ExceptionSavedViewRecord`, `JobExceptionSavedViewSummary`, `JobExceptionListItem`, `JobExceptionQueueSummary`, `JobExceptionQueueResponse` | `WatchlistSavedViewRecord`, `WatchlistSavedViewSummary`, `WatchFlagListItem`, `WatchlistSummary`, `WatchlistResponse`, `ProductionUrgentWatchSummary`, `ProductionUrgentWatchResponse`, `JobWatchFlagRecord`, `JobDetailExceptionRecord` | `packages/api/src/types/jobTruth.ts` | Exception-named contracts own new code. Watch-era names survive only so older callers keep compiling. | Remove after API callers and tests stop importing watch-era type names. |
| API-only | `EventRecord`, `StaffAssignmentRecord`, `ScheduleProjectionRecord` | `JobDayRecord`, `JobStaffAssignmentRecord`, `WorkAssignmentRecord`, `ScheduleEntryRecord` | `packages/api/src/types/jobTruth.ts`, `packages/api/src/types/workModel.ts` | Canonical event and staffing language owns the model. Old names remain compatibility aliases only. | Remove after downstream services and tests stop importing the older day, assignment, and schedule-entry names. |
| API-only | event-native My Work helpers | shift-named helper exports such as `getEmployeeShiftDetail`, `fetchEmployeeShiftDetail`, and `acknowledgeEmployeeShiftNotes` | `packages/api/src/services/employeeExperience.ts`, `packages/admin-web/src/services/employeeExperience.ts` | Event-native helpers own the surface. Shift-named helpers delegate only for migration safety. | Remove after downstream callers stop importing the shift-named helpers. |
| storage-only | canonical Exceptions surface | storage and audit names such as `urgent_watch_item`, `urgent_watch_event`, `urgent_watch_status`, and `watch.*` event names | `packages/api/src/services/urgentWatch.ts`, database schema | Route and contract ownership is canonical Exceptions, but the storage vocabulary remains legacy. | Remove only in a dedicated migration pass after route, auth, and contract callers no longer depend on watch-era storage naming. |
| storage-only | event-native My Work surface | storage names such as `work_shift`, `shift_id`, and `shift_note_acknowledgement.shift_id` | `packages/api/src/services/employeeExperience.ts`, employee-related tables | Event-native API owns the surface, but shift-era storage naming remains a compatibility seam underneath. | Remove only after data-model migrations can rename storage without breaking admin or mobile consumers. |
| storage-only | canonical Job -> Event -> StaffAssignment -> Task spine | storage names such as `job_day_id` and task linkage field `related_job_id` | `packages/api/src/types/jobTruth.ts`, `packages/api/src/types/workModel.ts`, database schema | Canonical object ownership is now in code, but storage naming still carries day-era and related-job terminology. | Remove only after a dedicated schema and data-migration pass retires the old column names safely. |

## Release Telemetry
- Deprecated API aliases must emit:
  - `Deprecation: true`
  - `X-Mission-Control-Compatibility-Alias`
  - `X-Mission-Control-Canonical-Route`
- Current measurable API alias coverage includes:
  - `/api/watch` -> `/api/exceptions`
  - `/api/employee/shifts/:id` -> `/api/employee/events/:id`
  - `/api/employee/shifts/:id/acknowledge` -> `/api/employee/events/:id/acknowledge`
- Release-control expectation:
  - use request-path counts plus the compatibility headers above in ingress or reverse-proxy logs to measure live alias traffic
  - do not remove an API alias until live traffic has fallen to zero across the agreed observation window
- Hash-only admin-web aliases are still measured manually through smoke QA, launcher review, and bookmark review until first-class client telemetry exists.

## Maintenance Rules
- Add new reset-era aliases here before shipping them.
- Keep each row implementation-facing and grounded in current code or current docs-backed runtime contracts.
- Remove rows only when the alias, shim, or storage seam is actually deleted.
- If a seam stops being temporary, delete the seam instead of normalizing it through the register.
