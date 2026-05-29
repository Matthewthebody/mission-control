# Phase 1 Enforcement Hardening And Communications Discoverability

> Historical implementation note: the active phase-one operating contract in [phase-one-operating-contract.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/phase-one-operating-contract.md) supersedes earlier wording here that treated Communications like a first-class standalone app route. Communications remains record-linked and is exposed through launchers, utilities, and admin diagnostics.

## Scope
- Close the remaining Phase 1 Microsoft auth/security blockers that kept the Entra foundation from being enforceable inside Mission Control.
- Keep Teams communications discoverable as a record-linked utility surface without turning it into a noisy history dump or a parallel workspace.

## What Shipped
- Microsoft Entra step-up now supports durable OAuth state for privileged actions instead of dead-ending on `enterprise step-up needed`.
- `auth_session` now carries stronger session trust metadata:
  - `session_assurance`
  - `last_reauthenticated_at`
  - `active_auth_context_ids`
  - stored Entra claims and resolved authorization state
- App-side Entra authorization is now driven by admin-managed contracts:
  - `roles_access.microsoft_entra_authorization_contract`
  - `roles_access.microsoft_entra_sensitive_action_contract`
- Production governance validation now treats insecure fallback auth as blocked or risky instead of informational.
- Security Center now exposes a compact Microsoft Security Truth workspace with blocker-first status and re-audit criteria.
- Communications is available through a compact launcher and a focused utility route for record-linked actions.

## Auth Session Assurance Honesty Notes
- `packages/api/src/services/auth.ts` still contains a generic `sessionAssurance ?? "standard"` fallback inside `createSessionRow`.
- That fallback is intentional and only exists for providers that do not send stronger trust metadata, such as local development and local password flows.
- Normal Microsoft Entra sign-in does not rely on that fallback:
  - `packages/api/src/services/microsoftEntraContracts.ts` derives assurance from Entra claims and auth context.
  - `packages/api/src/services/microsoftEntra.ts` passes `identity.claimsSnapshot.session_assurance` into `issueAuthSession(...)`.
  - `packages/api/tests/microsoftEntraAuth.test.ts` verifies that a normal Entra sign-in stores `auth_session.session_assurance = 'mfa'`.

## Required Production Auth Posture
This repo now makes the boundary explicit:
- `.env.example` is development-oriented only.
- `.env.production.example` shows the minimum fail-closed application posture expected for production.
- Production must not copy those defaults as-is.

Minimum production auth posture:
- `NODE_ENV=production`
- `MICROSOFT_ENTRA_AUTH_ENABLED=true`
- `ALLOW_DEV_LOGIN=false`
- `ALLOW_PASSWORD_LOGIN=false`
- If password fallback is retained at all:
  - `ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY=true`
  - break-glass accounts must be separately controlled and audited
- `MICROSOFT_365_GOVERNANCE_STRICT_VALIDATION=true`
- `MICROSOFT_365_OPERATING_SYSTEM_STRICT_VALIDATION=true`
- `COMMUNICATIONS_STRICT_STARTUP_VALIDATION=true`

Production also still requires tenant-side Microsoft admin execution for:
- MFA and authentication strength
- Conditional Access
- Intune / app protection posture
- external sharing restrictions
- unified audit logging
- Entra app role and group assignment governance

## Admin-Managed Contracts
### `roles_access.microsoft_entra_authorization_contract`
- Stable external contract: Entra app roles first, explicit group IDs second.
- Safe assumptions:
  - no nested group dependence
  - no raw group-name matching
  - fail closed when privileged assignment cannot be proven

### `roles_access.microsoft_entra_sensitive_action_contract`
- Maps action keys to required auth context and session trust:
  - required assurance
  - required auth context ID
  - recent reauthentication window
  - elevated window
  - privileged window
  - break-glass allowance

## Operator Verification
1. Set `MICROSOFT_ENTRA_AUTH_ENABLED=true` in the target environment.
2. Set `ALLOW_PASSWORD_LOGIN_BREAK_GLASS_ONLY=true` anywhere password login must remain available as an emergency fallback.
3. Configure the two Entra contracts in admin settings before enabling privileged Entra-only operation.
4. Sign in with a mapped Entra user and confirm:
   - `/auth/session` shows the expected authority and permissions
   - Security Center shows the raw Entra inputs and resolved Mission Control access
   - `auth_session.session_assurance` is populated from Microsoft claims, not the generic fallback
5. Trigger elevation from My Account and confirm the 428 challenge redirects into Microsoft reauthentication.
6. After callback, confirm Security Center shows:
   - current assurance
   - last reauthentication time
   - active auth context IDs
7. Open the record-linked communication actions utility from the launcher or the Teams utility route.
8. Confirm incomplete Microsoft linking shows setup guidance instead of hiding Communications.

## Troubleshooting
### Entra step-up returns immediately to an error state
- Check that the sensitive action contract contains the expected action key.
- Check that the Entra callback returns the requested auth context ID.
- Check that the authorize redirect contains a `claims` payload requesting the expected auth context ID.
- Check Security Center for the current session trust and Entra resolution details.

### A mapped Entra user signs in but receives less access than expected
- Compare:
  - raw app role values
  - raw group IDs
  - resolved authority tier
  - resolved internal role groups
  - resolved policy roles
  - final permission keys
- If privileged access is still blocked, verify the mapping is marked privileged and that the contract is not failing closed on a missing privileged assignment proof.

### Production startup blocks on Microsoft posture
- Review Microsoft governance diagnostics for:
  - password login still enabled outside break-glass-only mode
  - Teams dev bypass enabled in production
  - missing tenant/sharepoint/security-group configuration

### Communications launcher looks empty
- The launcher is intentionally compact.
- It prioritizes:
  - action-needed count
  - pinned records
  - urgent communication issues
  - compact search
- Full history remains on the focused communication actions utility page.

## Deferred On Purpose
- Tenant-side MFA, Conditional Access, Intune, external sharing, and unified audit evidence still require Microsoft admin execution and re-audit.
- Inline evidence authoring UI in Security Center is not included yet; evidence storage and admin update APIs are in place.
- Broader module-by-module privileged challenge handling is still centered on the session elevation flow instead of every individual admin action.

## Verification Commands
```powershell
npm run build -w packages/api
npm run build -w packages/admin-web
npm run test -w packages/api -- tests/microsoftEntraAuth.test.ts tests/microsoft365Governance.test.ts tests/microsoftSecurityTruth.test.ts
npm run test -w packages/admin-web -- src/test/appAuth.test.tsx src/test/permissions.test.ts src/test/communicationsLauncher.test.tsx src/test/teamsCommunicationsPage.test.tsx
```
