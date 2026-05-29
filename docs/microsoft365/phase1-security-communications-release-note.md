# Phase 1 Security And Communications Release Note

> Historical release note: the active phase-one operating contract in [phase-one-operating-contract.md](C:/Users/MatthewKemmetmueller/OneDrive%20-%20Kemmetmueller/Documents/Codex/docs/architecture/phase-one-operating-contract.md) later narrowed Communications to a record-linked launcher/utility boundary. References below to a first-class standalone route should be read as historical context, not the current product boundary.

## Fixed In App Code
- Microsoft Entra sign-in now carries durable session trust metadata, including assurance, reauthentication time, auth context IDs, and privileged window state.
- Sensitive Microsoft-backed actions can return structured step-up challenges instead of dead-ending on a generic enterprise-elevation error.
- Entra app roles and explicit group IDs resolve into Mission Control base roles, overlays, and permission outcomes through admin-managed contracts.
- Security Center exposes a compact Microsoft Security Truth surface for re-audit evidence, current session trust, and mismatch diagnostics.
- Communications shipped as a compact launcher plus a focused utility page for record-linked actions.

## Still Manual Microsoft Admin Work
- Tenant MFA and phishing-resistant authentication policies
- Conditional Access
- Intune compliance and app-protection posture
- External sharing restrictions
- Unified audit logging and retention
- Real Entra app-role assignments, group ownership, and break-glass account governance

## Intentionally Deferred
- Tenant-side policy provisioning automation
- Rich inline evidence editing inside Security Center
- Broader phase expansion beyond the app-side enforcement and communications proof set

## Proof Table
| Claim                              | File(s) changed | Test / verification command | Result |
| ---------------------------------- | --------------- | --------------------------- | ------ |
| Entra step-up works                | `packages/api/src/services/securitySession.ts`, `packages/api/tests/microsoftEntraAuth.test.ts` | `Select-String -Path packages/api/src/services/securitySession.ts -Pattern "microsoft_entra_step_up_required|required_auth_context_id|start_url"` | Passed |
| Auth-context requested in redirect | `packages/api/src/services/microsoftEntra.ts`, `packages/api/tests/microsoftEntraAuth.test.ts` | `Select-String -Path packages/api/src/services/microsoftEntra.ts -Pattern "params.set\\(|acrs|claims"` | Passed |
| Session assurance propagated       | `packages/api/src/services/auth.ts`, `packages/api/src/services/microsoftEntra.ts`, `packages/api/src/services/microsoftEntraContracts.ts`, `packages/api/tests/microsoftEntraContracts.test.ts`, `packages/api/tests/microsoftEntraAuth.test.ts` | `$env:DB_URL='postgres://postgres:postgres@127.0.0.1:5432/pmc_test'; $env:JWT_SECRET='test-secret'; $env:INTERNAL_SOCKET_SECRET='test-socket-secret'; npm run test -w packages/api -- tests/microsoftEntraContracts.test.ts` | Passed |
| Record-linked communications utility added | `packages/admin-web/src/navigation.ts`, `packages/admin-web/src/pages/TeamsCommunicationsPage.tsx`, `packages/admin-web/src/test/teamsCommunicationsPage.test.tsx` | `Select-String -Path packages/admin-web/src/navigation.ts -Pattern 'id: \"communications\"|id: \"teams-communications\"'` and `npm run test -w packages/admin-web -- src/test/teamsCommunicationsPage.test.tsx` | Passed |
| Launcher injected into shell       | `packages/admin-web/src/app.tsx`, `packages/admin-web/src/components/communications/CommunicationsLauncher.tsx`, `packages/admin-web/src/test/communicationsLauncher.test.tsx` | `Select-String -Path packages/admin-web/src/app.tsx -Pattern "CommunicationsLauncher"` and `npm run test -w packages/admin-web -- src/test/communicationsLauncher.test.tsx` | Passed |

## Known Limitations
| Limitation | Why it still exists | Impact | Planned handling |
| ---------- | ------------------- | ------ | ---------------- |
| `.env.example` is still development-oriented and permissive | Local setup and older tests still depend on easy dev defaults | Unsafe if mistaken for a production baseline | Use `.env.production.example` for production posture and enforce deployment validation against the Phase 1 auth/governance rules |
| Clean API proof runs still require explicit env vars | The exported artifact does not bundle local secrets or a tenant-specific `.env` file | Reviewers must supply non-secret placeholder values for config parsing before the focused API proof test will run | Keep the clean-artifact verification command explicit and continue moving proof tests away from unrelated config dependencies |
| Focused API proof runs still emit a `pg` deprecation warning about concurrent `client.query()` usage | Older test/database helper paths have not been refactored in this scope | Proof runs still pass, but the warning is noisy in audit output | Refactor the older test helpers and query flows outside this Phase 1 proof pass |
| Clean artifact verification is scoped, not a full-repo build | The broader committed tree still has unrelated workspace and source-packaging gaps outside this Phase 1 proof slice | Archive verification should use the focused proof commands instead of treating the whole repository as cleanly buildable | Close the wider repo hygiene gap in a separate cleanup pass instead of folding it into this Phase 1 proof export |
| Microsoft tenant controls are not enforceable from app code alone | MFA, Conditional Access, Intune, external sharing, and unified audit live in the tenant | Phase 1 is still not fully enforceable until tenant admins apply and evidence those controls | Complete the tenant-side baseline, attach evidence in Security Truth, and re-audit before Phase 2 |
