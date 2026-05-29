# Microsoft Permissions Matrix

This matrix records the current Microsoft boundary for Mission Control.

- Mission Control remains the system of record.
- Microsoft permissions must stay least-privileged and intentional.
- If a surface cannot declare its exact permission model, it is not fully approved.

| Surface | Current repo owner | Auth pattern in repo today | Permissions / scopes in repo today | Direction | Phase-one decision | Failure / audit owner | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Entra sign-in and identity linking | `packages/api/src/routes/auth.ts`, `packages/api/src/services/microsoftEntra.ts` | Server-mediated auth code flow with PKCE, state, and nonce | `openid`, `profile`, `email`, `User.Read` | Microsoft -> Mission Control | Approved | auth audit logs, `microsoftIntegrationObservability` | No MSAL yet. No explicit OBO yet. `id_token` signature verification is still a hardening gap. |
| Entra authorization mapping | `packages/api/src/services/microsoftEntraContracts.ts` | Mission Control claim mapping after sign-in | Entra app roles / group claims mapped to internal roles | Microsoft -> Mission Control | Approved | auth audit and review flows | Group overage and privileged mapping paths fail closed. |
| Outlook delegated calendar preview | `packages/api/src/routes/outlook.ts`, `packages/api/src/services/outlook.ts`, `packages/api/src/services/outlookGraph.ts` | Delegated OAuth token storage and refresh with PKCE | `offline_access`, `User.Read`, `Calendars.Read` | Outlook -> Mission Control preview | Approved | Outlook sync status, diagnostics, sync logs | This is the cleanest least-privilege Outlook surface in the repo. |
| Outlook calendar visibility preferences | `packages/api/src/routes/outlook.ts`, `packages/api/src/services/outlook.ts` | Mission Control preference write over delegated calendar list | No extra Graph scope beyond delegated calendar read | Mission Control internal preference only | Approved | Outlook diagnostics and audit | This changes Mission Control visibility only. |
| Outlook event / invite projection from canonical work | `packages/api/src/services/outlookCalendarSync.ts` | Explicit Mission Control sync queue | No delegated `Calendars.ReadWrite` scope is declared in repo | Mission Control -> Outlook projection | Approved with hardening | sync operations, activity logs, diagnostics | Calendar write intent is explicit and attributable. Outlook remains downstream only. |
| Outlook busy-window conflict detection | `packages/api/src/services/outlookCalendarGraph.ts` | App-only Graph client credentials | `https://graph.microsoft.com/.default` | Outlook -> Mission Control conflict visibility | Approved only as controlled compatibility seam | sync diagnostics and schedule sync state | This is the biggest over-permission seam still present. |
| Outlook mail delivery automation | `packages/api/src/services/microsoft365MailAutomation.ts`, `packages/api/src/routes/integrations.ts` | App-controlled outbound workflow plus callback secrets | No runtime Graph `Mail.Send` or `Mail.Send.Shared` scope found in repo; delivery is via configured automation endpoints | Mission Control -> delivery workflow -> callback into Mission Control | Approved | mail automation delivery log, event log, sync operations | Allowed only when tied to canonical records and approved templates/mailboxes. |
| Outlook reply / inbox behavior | mail + communication seams only | Not implemented as mailbox sync | No approved mail-read or reply-thread permission contract in repo | N/A | Deferred | N/A | Do not treat current Outlook support as inbox behavior. |
| Teams operational alerts | `packages/api/src/services/operationalAlerting.ts`, `packages/api/src/routes/integrations.ts` | Teams webhook delivery | Teams webhook URL, not Graph scope | Mission Control -> Teams | Approved | alert deliveries and audit log | Teams alerts must stay high-signal and link back into Mission Control. |
| Teams message-extension search / open | `packages/api/src/services/microsoftTeamsAuth.ts`, `packages/api/src/services/microsoftTeamsMessageExtension.ts`, `packages/api/src/routes/integrations.ts` | Bot Framework bearer verification with JWKS | Bot app identity; no separate Graph scope declared here | Teams -> Mission Control entry point | Approved | Teams search telemetry, integration observability, audit events | Human-facing search/open only. |
| Teams communications launcher and action pages | `packages/api/src/routes/communications.ts`, `packages/api/src/services/teamsMessaging.ts`, `packages/admin-web/src/components/communications/CommunicationsLauncher.tsx` | Mission Control auth plus record-linked Teams destinations | No explicit Graph scope declared in code | Mission Control record -> Teams destination -> user back into Mission Control | Approved with boundary | communication observability, moderation records, audit | Must remain record-linked. Not a standalone collaboration workspace. |
| Teams personal-app / entry surfaces | `packages/api/src/services/teamsEmbeddedCommunications.ts`, `packages/admin-web/src/pages/TeamsHomePage.tsx` | Mission Control auth plus Teams deep-link entry context | No separate Graph scope at UI boundary | Teams -> Mission Control | Approved with boundary | diagnostics + page-level auth | Entry point only, not a second work system. |
| Teams meeting helpers | `packages/api/src/services/teamsMeetings.ts`, `packages/api/src/routes/communications.ts` | Mission Control auth plus linked communication identity | Graph permission scope is not clearly enumerated in repo | Mission Control record -> Teams meeting | Deferred / feature-gated | communication observability and audit | Keep record-linked and tightly constrained. Do not treat meetings as workflow state. |
| Graph webhook / subscription lifecycle | `packages/api/src/routes/integrations.ts`, `packages/worker/src/calendar/outlookGraph.ts`, `packages/worker/src/diagnostics/microsoftIntegrationEvents.ts` | Generic webhook intake plus worker lifecycle handling | No explicit subscription permission contract documented in repo | Microsoft callback -> Mission Control | Not approved as an open-ended surface | sync health, integration events, exception escalation | `validationToken` is handled; `clientState` is not validated; renewal remains manual. |
| Microsoft client portal control plane | `packages/api/src/services/microsoft365ClientPortal.ts` | Mission Control-managed access grants and project links | `entra_external_id` identity-provider metadata | Mission Control -> portal access mapping | Approved only for bounded portal MVP control plane | portal audit and diagnostics | This is portal access ownership, not a broad collaboration surface. |

## Current Reality Notes
- The repo does not currently use MSAL.
- The repo does use PKCE in both Entra sign-in and delegated Outlook OAuth.
- The repo does not currently show an explicit OBO implementation.
- Delegated Outlook scopes are tightly constrained and phase-one-safe.
- No runtime Graph `Mail.Send` or `Mail.Send.Shared` usage was found.
- The app-only Outlook calendar graph path is still the biggest permission ambiguity in the repo.
- Teams surfaces are broader than the minimal contract, so meetings and embedded collaboration should remain feature-gated and explicitly deferred.

## Required Rules For Any New Microsoft Permission
Before adding any new Microsoft permission or scope, the change must document:

- owning Mission Control route and service
- delegated vs app-only vs callback auth model
- exact permission name or app-registration permission set
- sync direction
- operator-visible failure handling
- audit trail
- rollback switch or feature flag
