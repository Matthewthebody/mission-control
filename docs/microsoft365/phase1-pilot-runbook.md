# Phase 1 Outlook Pilot Runbook

## Purpose
- Keep the internal Outlook Phase 1 pilot honest, repeatable, and safe from scope drift.
- Document which Microsoft paths are actually supported from the current stabilized baseline.

## Who Can Use It
- Leadership users and admin operators who already have access to the Outlook integration route.
- Local development and internal pilot testers only.
- Do not treat this as a production-wide Microsoft rollout guide.

## Required Login Path
- Local development baseline:
  - sign in with local password auth
  - use a seeded leadership or admin account
  - open `http://localhost:5173/#outlook`
- Generic Microsoft employee sign-in:
  - only use it when `MICROSOFT_ENTRA_AUTH_ENABLED=true`
  - it is separate from the Outlook delegated pilot
  - it is not required for the local Outlook dummy-account smoke path
- Outlook delegated connect:
  - start it only after you are already signed into Mission Control
  - use the `Connect Microsoft 365` action on `#outlook`

## Supported Feature Matrix
| Surface | Status from current baseline | Notes |
| --- | --- | --- |
| Local password auth | Supported | Correct local entry path for the Outlook pilot and break-glass/local smoke testing. |
| Generic Microsoft sign-in | Supported only when explicitly enabled | This is Mission Control app auth, not the Outlook calendar connect path. Hide or avoid it when Entra auth is off locally. |
| Outlook delegated sync | Supported as a delegated read-only preview | Safe scope is connect, reconnect, disconnect, calendar visibility toggles, preview refresh, and status review. |
| Worker/background features | Supported only for the existing shared worker baseline, not Outlook writeback | General worker/runtime health matters, but Outlook app-permission background sync and writeback remain out of Phase 1. |

## Safe To Test
- Local password login and session elevation.
- Opening `#outlook` and confirming the current state is honest.
- `Connect Microsoft 365`, reconnect, and disconnect.
- Calendar visibility toggles inside Mission Control.
- Read-only preview refresh from the Outlook page.
- Microsoft diagnostics, system sync health, and worker startup/test validation.

## Off-Limits In Phase 1
- Outlook calendar writeback.
- Outlook mailbox preview, inbox parsing, or mail send.
- Outlook application-permission background sync.
- Webhooks, subscriptions, delta sync, or bidirectional conflict resolution.
- Treating generic Microsoft employee sign-in as a requirement for the local Outlook dummy-account pilot.

## Runtime Proof Steps
1. Start local dependencies and app processes.
2. Confirm `GET /health` returns `outlook_sync_enabled`.
3. Confirm the worker test baseline passes before pilot changes are used internally.
4. Log in with local password auth and open `#outlook`.
5. Confirm the page only shows enabled Microsoft surfaces as live and labels disabled surfaces separately.
6. Confirm the Outlook connector card reads as a read-only delegated preview, not a writeback workflow.
7. Connect the delegated Outlook account and verify calendars and preview load.
8. Refresh the live preview once and confirm status remains healthy.

## Phase 1 Freeze
- Treat the active Outlook surface as:
  - delegated
  - read-only
  - leadership-controlled
  - preview-oriented
- Treat worker/runtime proof as:
  - worker starts cleanly
  - shared background jobs remain healthy
  - no Outlook app-permission writeback is implied by the UI or diagnostics

## Remaining Hardening Watch List
- Historical Microsoft diagnostics from disabled surfaces should stay out of the live-status view.
- Legacy Outlook writeback and linked-record signals should not be treated as active Phase 1 features.
- Wider internal use still needs a clear owner for Entra-on environments versus local password-only pilot environments.
