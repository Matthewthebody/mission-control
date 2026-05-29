# Reset Compatibility Register

## Purpose
This register is the authoritative inventory of reset-era compatibility aliases and deprecations that are still intentionally alive in Mission Control.

It exists to prevent the repo from drifting back into split-brain naming while canonicalization continues.

## Scope
Included here:
- route aliases
- hidden shell aliases
- deprecated permission wrappers
- deprecated backend/public type aliases
- compatibility API paths
- temporary runtime ownership seams kept for staged migration

Explicitly excluded:
- business-data aliases such as organization aliases, location aliases, and sender aliases
- import header aliases and parser synonyms
- search/query synonym expansion

Those are normal data or parsing features, not reset-era product identity seams.

## Register

| Area | Canonical Owner | Alias / Deprecated Surface | Current Source | Allowed Behavior Now | Removal Trigger |
| --- | --- | --- | --- | --- | --- |
| Communications utility | `#teams/communications` and route id `teams-communications` | `#communications`, route id `communications` | `packages/admin-web/src/navigation.ts`, `packages/admin-web/src/app.tsx` | Hidden utility alias only. It must not appear as a top-level workspace. | Remove once legacy hashes and launchers stop targeting `#communications`. |
| Shared Exceptions shell | `#exceptions` and `#operations/exceptions` | `#watchlist`, `#watch`, `#operations/watch`, `#operations/urgent-watch` | `packages/admin-web/src/navigation.ts` | Hidden route aliases may continue to resolve into canonical Exceptions surfaces. | Remove after bookmarks, deep links, and saved launchers are migrated. |
| Department exception routes | `#schools/exceptions`, `#sports/exceptions`, `#people/exceptions` | `#schools/watchlist`, `#sports/watchlist`, `#employees/exceptions` | `packages/admin-web/src/navigation.ts` | Department and people aliases may keep resolving, but canonical owner routes must stay visible. | Remove after department shortcuts and notifications stop emitting legacy hashes. |
| Studios workspace | `Studios`, `#studios/*`, `canAccessStudiosWorkspace` | `Photography`, `#photography/*`, `#operations/shoots`, `#shoots`, deprecated `canAccessPhotographyWorkspace`, deprecated `PhotographyWorkspace` export | `packages/admin-web/src/navigation.ts`, `packages/admin-web/src/permissions.ts`, `packages/admin-web/src/pages/PhotographyWorkspace.tsx` | Visible product naming stays Studios. Legacy hashes and imports may continue as compatibility-only paths. | Remove after route callers and imports stop using photography-era identifiers. |
| Graphics workspace | `Graphics`, `#graphics/*`, `canAccessGraphicsWorkspace` | `Production`, `#production/*`, `#projects`, `#sports/production`, deprecated `canAccessProductionProjects`, route id `graphics-legacy-alias` | `packages/admin-web/src/navigation.ts`, `packages/admin-web/src/permissions.ts`, `packages/admin-web/src/components/jobs/SharedJobProduction.tsx` | Visible naming stays Graphics. Legacy production/project hashes may continue resolving internally. | Remove after project queue callers and saved links stop targeting production-era hashes. |
| Files workspace | `#files` | `#production/assets`, `#graphics/files` | `packages/admin-web/src/navigation.ts`, `packages/admin-web/src/app.tsx` | Canonical Files route is still backed by the production asset manager. This is a temporary compatibility surface, not a finished Files model. | Remove when a dedicated shared Files workspace replaces the asset-manager backing surface. |
| Compliance workspace | `#employees/compliance` | route id `review-desk` / label `Review Desk (Legacy Alias)` | `packages/admin-web/src/navigation.ts` | Hidden alias may continue to resolve, but Compliance owns the visible workspace. | Remove when old review-desk links disappear. |
| Directory/account routing | `Accounts`, `Contacts`, `Locations` canonical child routes | `#directory`, `#directory/contacts`, `#contacts`, `#directory/locations` | `packages/admin-web/src/navigation.ts` | Resolver may keep routing old directory hashes into canonical account/contact/location views. | Remove after old directory bookmarks and shortcuts are retired. |
| Permission wrappers | `canAccessSharedExceptions`, `canAccessStudiosWorkspace`, `canAccessGraphicsWorkspace` | deprecated `canAccessSharedWatchlist`, deprecated `canAccessPhotographyWorkspace`, deprecated `canAccessProductionProjects` | `packages/admin-web/src/permissions.ts` | Canonical wrappers own the shell. Deprecated wrappers remain only to avoid breaking existing imports. | Remove after all imports are updated to canonical wrappers. |
| Permission-code bridging | canonical capability and module access | legacy grants like `watchlist.read` and capability permission aliases | `packages/admin-web/src/permissions.ts` | Old permission codes may still unlock canonical surfaces while policy producers catch up. | Remove after auth/policy producers emit only canonical capability grants. |
| Backend exception route | `/api/exceptions` | `/api/watch` | `packages/api/src/routes/exceptions.ts`, `packages/api/src/routes/watch.ts` | `/api/watch` remains a compatibility alias, but access is checked against canonical `exceptions` ownership. | Remove after clients and tests stop calling `/api/watch`. |
| Backend exception module key | canonical module `exceptions` | deprecated module key `urgent_watch` | `packages/api/src/types/operatingSystem.ts`, `packages/api/src/services/operatingSystemAccess.ts` | Backend access logic still recognizes `urgent_watch` as a migration alias. | Remove after operating-system config and persisted visibility data stop referencing `urgent_watch`. |
| Exception service/type filenames | canonical product term `Exceptions` | `urgentWatch.ts`, `urgentWatchApi.ts`, `types/urgentWatch.ts` filenames | `packages/api/src/services/urgentWatch.ts`, `packages/admin-web/src/services/urgentWatchApi.ts`, `packages/api/src/types/urgentWatch.ts` | File and symbol names may stay legacy temporarily while route and contract ownership remains canonical. | Remove when a low-risk rename pass can change filenames without obscuring blame/history. |
| Canonical event and staffing spine | `EventRecord`, `StaffAssignmentRecord` | deprecated `JobDayRecord`, deprecated `JobStaffAssignmentRecord`, `job_day_id` field naming | `packages/api/src/types/jobTruth.ts`, `packages/api/src/types/workModel.ts` | New code should speak Event and StaffAssignment. Old type names and storage field names remain compatibility seams. | Remove after route payloads and storage naming are fully event/staff-assignment native. |
| Job draft/event payload naming | `events` | deprecated `days` draft input field and day-era route comments | `packages/api/src/types/jobTruth.ts`, `packages/api/src/routes/jobs.ts` | Draft routes may still normalize `days` for compatibility. | Remove after clients write only `events`. |
| Production data model seam | `Job -> Event -> StaffAssignment -> Task` plus shared workflow | production/project records as transitional compatibility seam | `packages/api/src/types/jobTruth.ts`, `packages/api/src/types/productionProjects.ts` | Production-specific records may remain internally, but they are not allowed to reclaim primary model ownership. | Remove when shared workflow/runtime fully absorbs the old production seams. |
| Exception queue type aliases | exception-named queue contracts | deprecated watchlist-era types such as `WatchlistSavedViewRecord`, `WatchlistSavedViewSummary`, `WatchFlagListItem`, `WatchlistSummary`, `WatchlistResponse` | `packages/api/src/types/jobTruth.ts`, `packages/admin-web/src/jobTruthTypes.ts` | Canonical exception contracts own new code. Watchlist-era aliases exist only to keep older callers compiling. | Remove after callers stop importing watchlist-era types. |
| My Work event detail APIs | `/api/employee/events/:id`, `/api/employee/events/:id/acknowledge` | `/api/employee/shifts/:id`, `/api/employee/shifts/:id/acknowledge` | `packages/api/src/routes/employee.ts` | Event-native routes own the surface. Shift routes remain temporary aliases. | Remove after mobile/admin clients stop calling shift routes. |
| My Work service helpers | `getEmployeeEventDetail`, `fetchEmployeeEventDetail`, `acknowledgeEmployeeEventNotes` | deprecated `getEmployeeShiftDetail`, deprecated `fetchEmployeeShiftDetail`, deprecated `acknowledgeEmployeeShiftNotes` | `packages/api/src/services/employeeExperience.ts`, `packages/admin-web/src/services/employeeExperience.ts` | Canonical event helpers own new code. Shift-named helpers delegate directly to them. | Remove after downstream callers stop importing shift-named helpers. |
| My Work payload fields | event-native fields such as `event_id`, `events_today`, `upcoming_events`, `next_event_label` | deprecated `shift_id`, `shifts`, `next_shift_label` compatibility fields | `packages/api/src/services/employeeExperience.ts`, `packages/admin-web/src/services/employeeExperience.ts` | Event-native payloads own the page, but shift-era fields remain for migration safety while storage is still work-shift backed. | Remove after downstream shells and consumers stop reading shift-era keys. |
| Phase-one account portal default route | `/projects/{portal_project_key}/status` | `/projects/{portal_project_key}` | `docs/architecture/phase-one-account-portal-mvp-runtime-plan.md`, `packages/api/src/types/microsoft365ClientPortal.ts` | Bare project route resolves to the status page only. It is a bounded convenience alias, not a second page owner. | Remove only if the portal runtime stops supporting the short-form project route. |

## Known Contradictions Still Carried On Purpose
- Frontend operating-system naming is canonicalized to `exceptions` and `graphics`, but backend operating-system access still carries `urgent_watch` and `production` era module names for migration safety.
- Studios is the visible owner, but the page file is still `PhotographyWorkspace.tsx` and exports a deprecated `PhotographyWorkspace` symbol to avoid breaking imports.
- Files is the visible owner, but the runtime surface is still backed by the production asset manager.
- My Work is event-native in page plumbing, but compatibility fields still reflect `work_shift` storage underneath.

## Register Maintenance Rules
- Add new reset-era aliases here before shipping them.
- Do not add normal business-data aliases here.
- Remove rows when the alias or deprecated surface is actually deleted from code.
- If a surface is no longer temporary, remove the alias instead of rewording the row to make it sound permanent.
