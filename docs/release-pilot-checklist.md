# Mission Control Release And Pilot Checklist

## Release Truth
- Linux CI is the release truth.
- The canonical release workflow is `.github/workflows/linux-release-truth.yml`.
- Local Windows runs are for fast feedback only. If Windows-specific `spawn EPERM` or shell issues appear, use the guidance in [windows-local-test-guidance.md](./windows-local-test-guidance.md) and treat the Linux workflow as the final gate.

## Required Release Commands
Run the same sequence locally when preparing a pilot cut:

```powershell
npm ci
npm run db:migrate
npm run db:seed
npm run verify:release
```

`npm run verify:release` now enforces all of the following:
- the git worktree must be clean before validation starts
- API, worker, and admin-web builds must pass
- API, worker, and admin-web full test suites must pass
- the pilot smoke suite must pass
- the built API, worker, and admin-web runtime must boot and answer real HTTP/runtime checks
- the git worktree must still be clean after validation finishes

`npm run verify:pilot-mode` is the explicit shared pilot gate and is the same command shape used by Linux CI through `npm run verify:release`.

Pilot mode must stay blocked unless all of the following are true:
- the git worktree is clean
- runtime smoke attestation exists for the current commit
- runtime smoke passed
- core API endpoints passed in runtime smoke:
  - `/health`
  - `/auth/me`
  - `/api/exceptions`
  - `/api/dashboard/owner-command`

Non-development API and worker startup now fail fast when the repo is dirty. The admin shell also shows a visible `DIRTY STATE` banner whenever the repo is not clean so operators do not mistake a dirty branch for a pilot-safe environment.

## Smoke Coverage
The pilot smoke suite is intentionally narrow and maps to the release-critical surfaces:

```powershell
npm run smoke:jobs
npm run smoke:workflow
npm run smoke:exceptions
npm run smoke:my-work
npm run smoke:portal
npm run smoke:microsoft
```

Current smoke ownership:
- `jobs`: canonical job spine and shared job truth
- `workflow`: shared workflow generation, dependency release, acknowledgement, and approval checkpoint runtime
- `exceptions`: `/api/exceptions` plus `/api/watch` compatibility safety
- `my work`: event-native employee execution surface in API and admin-web
- `portal`: bounded account-facing portal MVP owner and route plan
- `microsoft`: Entra auth, Outlook visibility/sync, mail automation, Teams entry points, webhook handling, and diagnostics where implemented

## Observability Checks Before Pilot
- Confirm [compatibility-register.md](./architecture/compatibility-register.md) is current.
- Confirm the admin diagnostics surfaces are reachable and readable:
  - `#admin/system/foundation`
  - `#admin/system/communications`
  - `#admin/system/sync`
  - `GET /api/admin/system/foundation`
  - `GET /api/integrations/microsoft/health`
  - `GET /api/admin/system/microsoft-client-portal`
- Confirm operators can see the phase-one runtime health they need:
  - workflow health and drift in foundation diagnostics
  - exception backlog in `#exceptions` and `GET /api/exceptions`
  - sync failures and retry state in `#admin/system/sync` and `GET /api/integrations/microsoft/health`
  - tenant-scoped in-memory compatibility alias usage since current API startup in foundation diagnostics
  - authoritative alias measurement from ingress logs plus the compatibility headers documented in the register
- Confirm the operator-facing exception surface is clean enough to pilot:
  - `#exceptions`
  - `GET /api/exceptions`
- Confirm My Work and schedule context are green:
  - `#my-work`
  - `GET /api/employee/my-work`

## Rollback Toggles
The release rollback rule is to disable the narrow surface, not to mutate core data:

| Surface | Toggle | Rollback Effect |
| --- | --- | --- |
| Microsoft Entra sign-in | `MICROSOFT_ENTRA_AUTH_ENABLED=false` | Returns sign-in ownership to local/password auth flows without changing Mission Control records. |
| Outlook visibility and calendar sync | `MICROSOFT_OUTLOOK_SYNC_ENABLED=false` | Disables Outlook connection and downstream calendar sync while leaving Mission Control scheduling intact. |
| Microsoft mail automation | `MICROSOFT_365_MAIL_AUTOMATION_ENABLED=false` | Stops outbound Microsoft automation flows without deleting queued or historical delivery records. |
| Teams alerts | `TEAMS_OPERATIONAL_ALERTS_ENABLED=false` | Stops new alert sends while preserving audit and delivery history. |
| Teams communications actions | `MICROSOFT_TEAMS_COMMUNICATIONS_ENABLED=false` | Disables record-linked Teams send actions without touching underlying communication records. |
| Teams meetings | `MICROSOFT_TEAMS_MEETINGS_ENABLED=false` | Stops new Teams meeting sync actions while preserving Mission Control event truth. |
| Teams search / message extension | `MICROSOFT_TEAMS_MESSAGE_EXTENSION_ENABLED=false` | Disables Teams search entry points and leaves Mission Control as the only active workflow surface. |
| Teams personal app | `MICROSOFT_TEAMS_PERSONAL_APP_ENABLED=false` | Removes the personal-app shell entry point without changing underlying records. |
| Portal MVP | `MICROSOFT_365_CLIENT_PORTAL_ENABLED=false` | Disables the external account-facing portal boundary while leaving account/job/project links and Mission Control truth intact. |

## Pilot Readiness Checklist
- [ ] Linux CI `Linux Release Truth` workflow is green on the exact release candidate commit.
- [ ] The release candidate commit has a clean git worktree before and after `npm run verify:release`.
- [ ] `npm run verify:release` passes against a migrated and seeded database.
- [ ] Smoke coverage is green for jobs, workflow generation, exceptions, My Work, portal, and Microsoft.
- [ ] Built runtime validation is green for API `/health`, dev-login auth/session, canonical exception reads, owner-command reads, worker boot, and admin-web preview boot.
- [ ] Admin diagnostics show no unresolved critical sync or startup-validation issues that block the pilot surface being released.
- [ ] Compatibility register is current and any intentionally alive aliases have a stated removal gate.
- [ ] Rollback toggles are confirmed in the target environment before release.
- [ ] Windows-local fallback guidance has been shared with the team if local EPERM issues remain.

## Sign-Off
Current engineering sign-off for this repo state is `conditional go`.

Conditional-go means:
- the bounded release workflow, smoke suite, observability path, and rollback toggles exist in repo
- release should wait for a green Linux workflow run on a clean release candidate commit
- Windows-local `spawn EPERM` remains a developer-environment issue, not the release truth

## References
- [pre-merge-checklist.md](./pre-merge-checklist.md)
- [compatibility-register.md](./architecture/compatibility-register.md)
- [microsoft-integration-contract.md](./architecture/microsoft-integration-contract.md)
- [phase-one-account-portal-mvp-runtime-plan.md](./architecture/phase-one-account-portal-mvp-runtime-plan.md)
