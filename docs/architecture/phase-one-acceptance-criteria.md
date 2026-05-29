# Mission Control Phase-One Acceptance Criteria

## 1. Contract Locked In Repo
Done when:

- [phase-one-operating-contract.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/phase-one-operating-contract.md) exists in the repo
- the contract defines mission, scope, core objects, hierarchy, workflow rules, exception rules, sync boundary, phase-one screens, naming rules, route ownership rules, compatibility migration rules, and acceptance criteria
- the contract explicitly names Exceptions as canonical vocabulary
- the contract explicitly includes communications and the minimal account-facing portal boundary

## 2. Canonical Object Ownership Defined
Done when:

- Job, Event, Staff Assignment, and Task ownership is explicitly defined in code-facing docs and reflected in shared backend types
- duplicate primary object claims between `jobTruth`, `workModel`, `jobs`, and `schedule` are resolved or marked for removal with canonical ownership called out in code comments or doc references
- Schedule entries are treated as derived views unless they are true standalone admin events
- no new route or page introduces a new core object name outside the contract

## 3. Navigation Cleaned To Contract
Done when:

- top-level navigation is reduced to Departments, Operations, My Work, and Admin
- canonical department naming is used in visible navigation
- Photography and Production no longer appear as primary visible department labels where Studios and Graphics are intended
- Watch/Watchlist no longer appears as primary visible product vocabulary
- scaffold-only and placeholder routes are removed, hidden, or demoted from primary navigation

## 4. My Work Rebuilt As The First Shared Execution Surface
Done when:

- My Work shows assigned Jobs, Events, Tasks, Acknowledgements, Exceptions, and Recent Changes
- My Work is no longer centered on shifts as the only primary record
- My Work consumes shared backend records rather than a page-local work model
- utility views like personal tasks or schedule do not redefine the execution model outside My Work

## 5. Exceptions Unified Under One Vocabulary And One Surface
Done when:

- Exceptions is the primary visible product term
- watch, watchlist, urgent watch, staffing issues, blocked approvals, failed syncs, and production blockers are converged into one canonical exception surface or one clearly owned migration path toward it
- exception severity, owner, status, and resolution history are consistently represented
- Home and department pages route into Exceptions using canonical language

## 6. Compatibility Migration Done Safely
Done when:

- old route hashes remain stable only where needed for compatibility
- old names redirect or resolve into canonical owner routes without remaining visible as primary naming
- docs and navigation use canonical names first
- compatibility aliases are documented and intentionally temporary
- the current compatibility inventory is explicitly tracked in [reset-compatibility-register.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/reset-compatibility-register.md)

## 7. Communications And Portal Boundary Enforced
Done when:

- Communications is exposed only as a record-linked launcher, focused utility surface, or admin diagnostic surface
- no major top-level operator route presents Communications as a separate system of record
- the minimal account-facing portal MVP is explicitly bounded to schedule, status, files, and change history
- the repo names one runtime owner and one exact MVP route plan for the account-facing portal
- the repo makes the auth and access boundary explicit through account-linked grants, job-linked project links, and Entra External ID
- the internal admin-web shell does not claim ownership of the external `/projects` portal routes
- portal planning and naming do not imply a full CRM, inbox, or workflow-editing surface
- any deferred communication or portal expansion is listed explicitly instead of leaking into phase-one navigation or vocabulary
