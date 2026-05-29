# Microsoft Integration Contract

## 1. Purpose
This document locks the Microsoft 365 boundary for Mission Control.

- Mission Control is the operational system of record.
- Microsoft 365 is the connected backbone for identity, email delivery, calendar visibility, and Teams notification entry points.
- Outlook and Teams must not become a second workflow system.
- Every Microsoft integration must declare an owner, sync direction, permission model, failure path, and audit trail.

## 2. Approved Phase-One Microsoft Surface
Phase one approves only the following Microsoft-facing surfaces.

### 2.1 Entra ID Identity
- Purpose: employee sign-in, identity linking, tenant assurance, and authorization context.
- Mission Control owner:
  - `packages/api/src/routes/auth.ts`
  - `packages/api/src/services/microsoftEntra.ts`
  - `packages/api/src/services/microsoftEntraContracts.ts`
- Current auth pattern in repo:
  - server-mediated authorization code flow
  - PKCE challenge/verifier
  - state and nonce handling
  - no first-class MSAL library
  - no explicit OBO path
- Direction: Microsoft identity -> Mission Control session and authorization context.

### 2.2 Outlook Mail Delivery
- Purpose: record-linked outbound delivery around canonical Mission Control records.
- Mission Control owner:
  - `packages/api/src/services/microsoft365MailAutomation.ts`
  - `packages/api/src/routes/integrations.ts`
  - `packages/api/src/routes/communications.ts`
- Direction: Mission Control record -> delivery workflow -> callback/audit back into Mission Control.
- Approved behavior:
  - outbound delivery from approved shared-mailbox / automation contracts
  - callback tracking, replay, and failure handling
  - record-linked communication actions only
- Boundary note:
  - no runtime `Mail.Send` or `Mail.Send.Shared` Graph usage was found in the repo
  - phase one does not approve inbox sync, mailbox mirroring, or mailbox-as-work-queue behavior

### 2.3 Outlook Calendar Visibility And Projection
- Purpose: delegated calendar visibility, busy-window conflict detection, and explicit downstream event projection from Mission Control work.
- Mission Control owner:
  - `packages/api/src/routes/outlook.ts`
  - `packages/api/src/services/outlook.ts`
  - `packages/api/src/services/outlookGraph.ts`
  - `packages/api/src/services/outlookCalendarGraph.ts`
  - `packages/api/src/services/outlookCalendarSync.ts`
  - `packages/worker/src/calendar/outlookGraph.ts`
- Direction:
  - Outlook delegated read -> Mission Control preview and visibility
  - Mission Control work -> explicit sync operation -> Outlook event projection
  - Microsoft webhook/lifecycle notice -> Mission Control sync health and exception escalation
- Approved behavior:
  - delegated calendar preview
  - explicit sync and retry operations
  - downstream projection of canonical work into Outlook events
- Boundary note:
  - Outlook is not the source of truth for jobs, events, assignments, tasks, or approvals
  - schedule truth stays in Mission Control even when Outlook visibility exists

### 2.4 Teams Notification Entry Points
- Purpose: human-facing notification entry points back into Mission Control.
- Mission Control owner:
  - `packages/api/src/services/operationalAlerting.ts`
  - `packages/api/src/services/microsoftTeamsAuth.ts`
  - `packages/api/src/services/microsoftTeamsMessageExtension.ts`
  - `packages/api/src/services/teamsMessaging.ts`
  - `packages/api/src/routes/integrations.ts`
  - `packages/api/src/routes/communications.ts`
- Direction: Mission Control record/change -> Teams notification or deep link -> human returns to Mission Control.
- Approved behavior:
  - high-signal operational alerts
  - Bot-authenticated Teams message-extension search/open flows
  - record-linked communications launchers and action pages
  - Teams personal-app / entry-point surfaces that lead back into Mission Control
- Boundary note:
  - Teams is human-facing, not a machine log sink
  - Teams diagnostics noise, sync logs, and workflow state remain inside Mission Control

### 2.5 Portal-Related Microsoft Control Plane
- Purpose: bounded account-facing portal access control and scoping assumptions, not a new collaboration surface.
- Mission Control owner:
  - `packages/api/src/services/microsoft365ClientPortal.ts`
  - `packages/api/src/types/microsoft365ClientPortal.ts`
  - `docs/architecture/phase-one-account-portal-mvp-runtime-plan.md`
- Direction: Mission Control account/job truth -> portal access grants and project links.
- Approved behavior:
  - explicit Entra External ID access assumptions
  - explicit app-owned portal grants and project links
  - no internal admin-shell ownership of external portal routes

## 3. Explicitly Deferred Or Not Approved In Phase One
The following are out of bounds unless the contract is updated first.

- Outlook as the operational system of record
- Teams as the operational system of record
- direct frontend-to-Graph behavior
- inbox sync or mailbox mirroring
- mailbox-driven task management
- hidden or silent Microsoft writes
- unbounded background sync
- generic Graph subscription processing as an open-ended surface
- broad app-only Graph expansion without explicit owner and permission declaration
- OBO-based broader delegated Graph usage before an intentional OBO design exists
- Teams meetings and broader embedded collaboration as a general-purpose work system
- full Power Pages / portal expansion beyond the bounded phase-one portal control plane

## 4. Current Repo Touchpoints
These are the Microsoft-facing touchpoints currently present in the repo.

### 4.1 API Config And Boot
- `packages/api/src/config.ts`
- `packages/api/src/config/outlook.ts`
- `packages/api/src/app.ts`

### 4.2 Entra / Identity
- `packages/api/src/routes/auth.ts`
- `packages/api/src/services/microsoftEntra.ts`
- `packages/api/src/services/microsoftEntraContracts.ts`
- `packages/api/tests/microsoftEntraAuth.test.ts`
- `packages/api/tests/microsoftEntraContracts.test.ts`

### 4.3 Outlook / Calendar / Mail
- `packages/api/src/routes/outlook.ts`
- `packages/api/src/services/outlook.ts`
- `packages/api/src/services/outlookGraph.ts`
- `packages/api/src/services/outlookCalendarGraph.ts`
- `packages/api/src/services/outlookCalendarSync.ts`
- `packages/api/src/services/outlookStore.ts`
- `packages/api/src/services/microsoft365MailAutomation.ts`
- `packages/api/tests/outlookConfig.test.ts`
- `packages/api/tests/outlookIntegration.test.ts`
- `packages/api/tests/outlookPilotBoundary.test.ts`
- `packages/api/tests/outlookCalendarGraph.test.ts`
- `packages/api/tests/microsoft365MailAutomation.test.ts`

### 4.4 Graph Webhooks, Lifecycle, And Worker Processing
- `packages/api/src/routes/integrations.ts`
- `packages/worker/src/calendar/outlookGraph.ts`
- `packages/worker/src/diagnostics/microsoftIntegrationEvents.ts`
- `packages/worker/tests/outlookGraph.test.ts`
- `packages/worker/tests/appEventHandler.test.ts`

### 4.5 Teams / Communications / Notifications
- `packages/api/src/routes/communications.ts`
- `packages/api/src/routes/integrations.ts`
- `packages/api/src/services/microsoftTeamsAuth.ts`
- `packages/api/src/services/microsoftTeamsMessageExtension.ts`
- `packages/api/src/services/microsoftTeamsLinks.ts`
- `packages/api/src/services/teamsMessaging.ts`
- `packages/api/src/services/teamsMeetings.ts`
- `packages/api/src/services/teamsEmbeddedCommunications.ts`
- `packages/api/src/services/operationalAlerting.ts`
- `packages/api/src/services/communicationObservability.ts`
- `packages/api/src/services/microsoftIntegrationObservability.ts`
- `packages/api/tests/teamsMessaging.test.ts`
- `packages/api/tests/teamsMeetings.test.ts`
- `packages/api/tests/teamsMessageExtension.test.ts`
- `packages/api/tests/teamsEmbeddedCommunications.test.ts`
- `packages/api/tests/operationalAlerts.test.ts`
- `packages/api/tests/microsoftIntegrationObservability.test.ts`

### 4.6 Portal Control Plane And Assumptions
- `packages/api/src/services/microsoft365ClientPortal.ts`
- `packages/api/src/types/microsoft365ClientPortal.ts`
- `packages/api/tests/microsoft365ClientPortal.test.ts`
- `docs/architecture/phase-one-account-portal-mvp-runtime-plan.md`

### 4.7 Admin-Web Launchers, Action Pages, And Diagnostics
- `packages/admin-web/src/pages/Login.tsx`
- `packages/admin-web/src/pages/OutlookIntegration.tsx`
- `packages/admin-web/src/pages/TeamsHomePage.tsx`
- `packages/admin-web/src/pages/TeamsCommunicationsPage.tsx`
- `packages/admin-web/src/pages/SystemDiagnosticsPage.tsx`
- `packages/admin-web/src/components/communications/CommunicationsLauncher.tsx`
- `packages/admin-web/src/components/MicrosoftIntegrationDiagnosticsPanel.tsx`
- `packages/admin-web/src/services/microsoftIntegrationObservabilityApi.ts`
- `packages/admin-web/src/services/teamsCommunicationApi.ts`
- `packages/admin-web/src/services/teamsEmbeddedCommunicationsApi.ts`
- `packages/admin-web/src/services/teamsMeetingsApi.ts`
- `packages/admin-web/src/services/teamsOperationalAlertsApi.ts`
- `packages/admin-web/src/test/outlookIntegration.test.tsx`
- `packages/admin-web/src/test/communicationsLauncher.test.tsx`
- `packages/admin-web/src/test/microsoftIntegrationDiagnosticsPanel.test.tsx`

### 4.8 Teams App Package
- `teams/appPackage/manifest.json`

## 5. Current Repo Reality
The repo is not starting from zero. The current integration layer already has real behavior and real constraints.

### 5.1 Identity Reality
- The repo does not currently use MSAL.
- The repo does use a custom server-mediated auth code flow with PKCE and nonce.
- The repo does not currently show an explicit OBO implementation.
- The current Entra `id_token` path uses `decodeJwt(...)` plus claim checks; full signature verification is still a hardening gap.

### 5.2 Outlook Reality
- Delegated Outlook scopes are tightly constrained in `packages/api/src/config/outlook.ts`:
  - `offline_access`
  - `User.Read`
  - `Calendars.Read`
- No delegated `Calendars.ReadWrite` or Graph mail-send scope was found in code.
- The repo still contains an app-only Graph compatibility seam in `packages/api/src/services/outlookCalendarGraph.ts` using `https://graph.microsoft.com/.default`.
- Mail delivery success is callback-driven and explicitly separated from provider acceptance.

### 5.3 Teams Reality
- Teams message extension auth verifies Bot Framework tokens against JWKS in `packages/api/src/services/microsoftTeamsAuth.ts`.
- The repo contains more than simple alerting:
  - message extension search/open
  - operational alerts
  - record-linked messaging
  - meetings
  - embedded communications hubs and action pages
- The contract should therefore treat meetings and broader embedded collaboration as deferred or tightly feature-gated, not as default phase-one boundary.

### 5.4 Webhook And Lifecycle Reality
- `packages/api/src/routes/integrations.ts` correctly returns `validationToken` for Graph validation requests.
- `packages/worker/src/calendar/outlookGraph.ts` handles lifecycle events like `reauthorizationRequired`, `subscriptionRemoved`, and `missed`.
- Lifecycle state is auditable, but the repo still lacks a first-class subscription-renewal owner and does not validate `clientState`.

## 6. Risks And Ambiguities Found
- No first-class MSAL implementation is present.
- No explicit OBO path is present.
- Entra sign-in still lacks full JWKS-based `id_token` signature verification.
- App-only Graph `.default` in `packages/api/src/services/outlookCalendarGraph.ts` is still the clearest over-privilege seam.
- Confidential auth still depends on client secrets rather than certificate credentials.
- Generic `microsoft_graph` webhook intake in `packages/api/src/routes/integrations.ts` is broader than a dedicated Microsoft subscription contract.
- Worker lifecycle handling records `client_state_present`, but does not validate `clientState`.
- Teams meetings and embedded communications remain broader than the strict "notification entry points" phase-one boundary.
- Mail automation uses Power Automate / shared-mailbox infrastructure, so part of the real permission surface lives outside repo code and must stay documented operationally.

## 7. Required Rules For Any New Microsoft Surface
Before any new Microsoft behavior is added, the change must document:

- owning Mission Control route and service
- delegated vs app-only vs callback auth model
- exact Microsoft permission or app-registration expectation
- sync direction
- operator-visible failure handling
- audit trail
- rollback switch or feature flag

If those answers are missing, the surface is not approved.

## 8. Recommended Next Hardening Phase
The next Microsoft hardening phase should stay narrow and do four things:

1. Add proper JWKS-based Entra `id_token` signature verification and keep the PKCE/nonce flow intact.
2. Replace or constrain app-only Graph `.default` usage with an explicit minimal app-permission set and certificate credentials where practical.
3. Create a dedicated Microsoft webhook/subscription ownership layer with client-state validation, renewal/reauthorization handling, and explicit lifecycle rules.
4. Separate approved Teams notification entry points from deferred meetings / broader embedded collaboration so the repo stops treating those surfaces as equally mature.

## 9. Companion Matrix
The current Microsoft permission and access matrix lives in:

[microsoft-permissions-matrix.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/microsoft-permissions-matrix.md)
