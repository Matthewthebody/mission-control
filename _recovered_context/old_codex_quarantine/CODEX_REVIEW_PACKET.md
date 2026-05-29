# Photographer Mission Control Audit Reviewer Packet

## 1. Executive Summary
Before this pass, the repo had a solid product foundation but still carried several pre-ship risks in auth/session handling, server logging hygiene, and the Monday.com integration boundary. The most important issues were not cosmetic: malformed bearer tokens could bubble into server errors instead of clean `401` responses, request logging risked recording bearer tokens, the Monday protected-image proxy trusted lookalike hosts too loosely, and the SPA auth bootstrap treated all session-check failures as “log the user out,” which made real login/session failures hard to distinguish from transient runtime outages.

After fixes, the repo is materially safer and more stable. Auth/session failure handling is cleaner, bearer tokens are redacted from API request logs, internal `500` details are no longer returned to clients, the Monday proxy boundary is tightened to actual Monday hosts, setup-photo inputs are more strictly validated, and the frontend login/session bootstrap is less brittle. Monday.com integration appears safer to continue building on now because it remains backend-only, no Monday secret exposure was found in frontend source or build artifacts, and the riskiest server-boundary flaws were fixed; however, it still needs follow-up production validation and observability work before calling it fully hardened.

## 2. Critical Findings

### Finding 1
- Severity: Critical
- Title: Bearer tokens could be exposed in API request logs
- Root cause: The API used `pino-http` with default request serialization, which logs request headers unless explicitly redacted.
- User or business risk: Session bearer tokens could be written to server logs and later reused, undermining account security and tenant isolation.
- Exact files involved:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts)
- Fix implemented: Added request-header redaction for `authorization`, `cookie`, forwarded headers, and response `set-cookie`, and disabled noisy request logging during tests.
- How it was validated: Targeted API tests showed `[Redacted]` instead of raw bearer values in request logs; full API test suite passed after the change.
- Whether fully resolved or partially resolved: Fully resolved for the current server logging path.

### Finding 2
- Severity: Critical
- Title: Monday protected-image proxy trusted lookalike domains
- Root cause: Monday protected image validation used a regex that matched any hostname ending in the string `monday.com`, including lookalike domains such as `evilmonday.com`.
- User or business risk: The backend could be tricked into sending a secret-bearing Authorization header to an attacker-controlled host, creating an SSRF-style credential exposure boundary.
- Exact files involved:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationMonday.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationMonday.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationCatalog.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationCatalog.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts)
- Fix implemented: Replaced regex validation with strict `URL` parsing, requiring `https`, host `monday.com` or a true `.monday.com` subdomain, and a `/protected_static/` path.
- How it was validated: Added regression coverage rejecting both non-Monday URLs and lookalike domains; location API tests passed.
- Whether fully resolved or partially resolved: Fully resolved for the current proxy path.

### Finding 3
- Severity: Critical
- Title: Invalid or malformed bearer tokens could turn into server errors instead of clean auth failures
- Root cause: Global optional auth middleware forwarded JWT verification errors into the central error handler instead of treating them as unauthenticated requests.
- User or business risk: Expired or malformed tokens could trigger `500` responses, destabilize login/session restoration, and leak internal error behavior.
- Exact files involved:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\auth.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\auth.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\authMe.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\authMe.test.ts)
- Fix implemented: `optionalAuth` now swallows invalid-token decode/verify failures and leaves the request unauthenticated so protected routes return `401` through `requireAuth`.
- How it was validated: Added regression coverage proving malformed bearer tokens now return `401 Unauthorized`; auth tests passed.
- Whether fully resolved or partially resolved: Fully resolved for current bearer-auth request handling.

## 3. High Priority Findings

### Finding 1
- Severity: High
- Title: Raw internal error messages were returned to clients on unexpected `500` paths
- Root cause: The API error handler returned `err.message` for non-`ApiError` exceptions.
- User or business risk: Internal implementation details, integration failures, and debugging strings could leak to browsers or API consumers.
- Exact files involved:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\error.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\error.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts)
- Fix implemented: Unexpected exceptions now return a generic `Internal server error` plus request id, while detailed errors stay server-side only.
- How it was validated: Added regression coverage proving unexpected Monday-side failures no longer echo sensitive strings back to the client.
- Whether fully resolved or partially resolved: Fully resolved for the central API error handler.

### Finding 2
- Severity: High
- Title: Frontend auth bootstrap conflated invalid sessions with network or API outages
- Root cause: The SPA cleared local auth state for any `/auth/session` failure, regardless of whether the failure was a real `401/403` auth problem or a transient network/backend issue.
- User or business risk: Valid users could be silently signed out during local outages or backend instability, making login behavior unreliable and confusing.
- Exact files involved:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\app.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\app.tsx)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\test\appAuth.test.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\test\appAuth.test.tsx)
- Fix implemented: Added a typed `ApiClientError`, distinguished auth failures from network failures, preserved tokens during transient session-check failures, and introduced a retryable “Session Check Failed” UI.
- How it was validated: Added frontend regression tests for stale-token `401` handling and network-failure retry behavior; admin-web tests passed.
- Whether fully resolved or partially resolved: Fully resolved for the current SPA bootstrap path.

### Finding 3
- Severity: High
- Title: Frontend API base URL was hardcoded to `http://localhost:4000`
- Root cause: The admin app used a static API origin instead of deriving it from the current hostname or a Vite environment variable.
- User or business risk: Accessing the app via `127.0.0.1`, a local IP, or alternate dev hostnames could break auth/session calls and appear as login failures or blank-screen behavior.
- Exact files involved:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\vite-env.d.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\vite-env.d.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts)
- Fix implemented: The admin app now prefers `VITE_API_URL` and otherwise derives the API host from `window.location.hostname`; API CORS was also tightened to an allowlist with localhost/127.0.0.1 alias support.
- How it was validated: Admin build passed, auth bootstrap tests passed, and the CORS/api-origin behavior is now consistent in code for localhost variants.
- Whether fully resolved or partially resolved: Fully resolved for current local/admin routing patterns.

### Finding 4
- Severity: High
- Title: Monday setup photo upload accepted overly broad image metadata and payloads
- Root cause: Upload validation only checked that `data_url` was a long string and `content_type` was present, leaving mismatched MIME types, oversized payloads, and unsafe filenames under-validated.
- User or business risk: Weak validation increases abuse surface, raises memory pressure risk, and makes downstream integration behavior less predictable.
- Exact files involved:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\locations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\locations.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locations.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts)
- Fix implemented: Added MIME allowlist, filename validation, data URL pattern validation, max payload length, decoded-size limit, and content-type/payload consistency checks.
- How it was validated: Added regression coverage for mismatched content type and unsafe filenames; location tests passed.
- Whether fully resolved or partially resolved: Fully resolved for the current upload path.

## 4. Login Issue Deep Dive
- Exact root cause of login issue or issues:
  - The admin app hardcoded `http://localhost:4000`, which made auth calls brittle when the app was accessed via alternate local hosts such as `127.0.0.1`.
  - Invalid bearer tokens could trigger server-side JWT verification errors instead of clean `401` handling.
  - The SPA treated any `/auth/session` failure as an expired session and cleared the saved token, even when the real problem was network or backend availability.
- Reproduction path:
  - Store a stale or malformed token in local storage and load the app.
  - Access the app from a local host variant that does not match the hardcoded API assumption.
  - Trigger `/auth/session` while the API is temporarily unavailable.
- Why it was happening technically:
  - `optionalAuth` forwarded token verification exceptions to the global error handler.
  - `apiFetch` did not preserve status information, so the app could not distinguish `401` from network failures.
  - `App` cleared the token on any session bootstrap error.
- Files changed:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\auth.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\auth.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\app.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\app.tsx)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\pages\Login.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\pages\Login.tsx)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\test\appAuth.test.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\test\appAuth.test.tsx)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\authMe.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\authMe.test.ts)
- Final fix:
  - Invalid tokens now become unauthenticated requests, not server errors.
  - The frontend now gets typed HTTP status information from `apiFetch`.
  - The SPA only clears saved auth on real `401/403` failures; network issues show a retryable session-check panel instead.
  - The frontend API origin now follows the current hostname or `VITE_API_URL`.
- Validation performed:
  - API auth regression tests for malformed tokens and logout/session invalidation.
  - Frontend regression tests for stale-token handling and network-failure retry.
  - Full API and admin-web test suites passed.
- Any remaining edge cases:
  - The app still uses localStorage for bearer-token storage, which remains XSS-sensitive by design.
  - Production deployment still depends on correct `ADMIN_WEB_URL`/CORS configuration.

## 5. Monday.com Security Review
- All Monday-related files inspected:
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationMonday.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationMonday.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationCatalog.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationCatalog.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locations.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\locations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\locations.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\services\locationApi.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\services\locationApi.ts)
  - [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts)
- Whether any secrets were exposed to frontend code, responses, or logs:
  - No secret-name hits were found in `packages/admin-web/src` or `packages/admin-web/dist` when scanning for Monday, Zendesk, JWT, Outlook encryption, Twilio, or AWS secret env names.
  - No frontend source references Monday API URLs or server-side Monday auth headers.
  - Request logging now redacts bearer tokens.
- Whether all Monday access is server-side only:
  - Yes. Monday GraphQL calls, file uploads, and protected-image proxying remain in backend service code only.
- Input validation assessment:
  - Improved. Setup photo uploads now enforce allowed image types, file-name rules, data URL structure, size limits, and payload/content-type consistency.
  - Proxy input now depends on strict host/path allowlisting instead of loose regex matching.
- Webhook or callback validation assessment, if applicable:
  - No Monday webhook or callback endpoint was found in the current repo, so no webhook signature validation path was required in this pass.
- Error handling and retry assessment:
  - Better than before. Monday fetches now use bounded timeouts and safe `ApiError` responses instead of raw error propagation.
  - Still incomplete for production resilience: there is no deeper retry/backoff/observability strategy yet for Monday transient failures.
- Remaining risks:
  - Monday history reads still fall back to mock-style data when live reads fail, which is safe for reviewability but can mask production degradation if not separately monitored.
  - No production credentials were available for live end-to-end Monday verification.
- Final reviewer verdict: Safer but needs follow-up

## 6. Auth, RBAC, and Tenant Isolation Review
- Summary of server-side enforcement:
  - Bearer auth is enforced server-side through `optionalAuth` plus `requireAuth`.
  - Permission/RBAC enforcement remains route/service-side through `requireAction`, authority policy checks, and scoped service assertions already present in the repo.
  - Database tenant context is still set through transaction helpers using `app.set_context(...)`.
- Any privilege escalation or cross-tenant risks found:
  - No new cross-tenant bypass was proven in this pass.
  - The most important auth flaw found was invalid-token handling degrading into `500`s instead of controlled `401`s.
  - The Monday proxy flaw was a secret-bearing outbound trust issue, not a direct tenant-isolation bypass.
- Fixes implemented:
  - Invalid bearer handling now degrades safely to unauthenticated requests.
  - Bearer tokens are redacted from logs.
  - API 500s no longer expose raw internals.
  - Auth bootstrap logic distinguishes auth failure from transport failure.
- Confidence level after validation:
  - Moderate-high for the audited auth/session paths and the critical routes covered by existing permission tests.
- Remaining manual checks recommended:
  - A second-pass review of older legacy route groups that still rely on compatibility permission codes.
  - Manual tenant-scoping review on any newer integration routes added after this audit scope.
  - Production-domain CORS validation in the real deploy environment.

## 7. Files Changed
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\auth.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\auth.ts)
  - Reason for change: stop invalid bearer tokens from producing server errors
  - Short summary of modification: token verification failures now leave the request unauthenticated instead of erroring
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\error.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\middleware\error.ts)
  - Reason for change: sanitize `500` responses and reduce logging risk during tests
  - Short summary of modification: generic internal-error responses plus request id; test logging disabled
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts)
  - Reason for change: harden request logging, headers, and local-origin behavior
  - Short summary of modification: added security headers, bearer redaction, localhost/127 CORS allowlist handling, and disabled `x-powered-by`
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationCatalog.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationCatalog.ts)
  - Reason for change: tighten Monday protected image URL validation
  - Short summary of modification: replaced loose regex with strict URL/host/path validation
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationMonday.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locationMonday.ts)
  - Reason for change: secure Monday server boundary and avoid leaking raw integration errors
  - Short summary of modification: added strict proxy validation, bounded request timeouts, and safe `ApiError` handling
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\locations.ts)
  - Reason for change: improve upload validation and safer API failures
  - Short summary of modification: data URL parsing now validates MIME match, size, emptiness, and uses explicit API errors
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\locations.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\locations.ts)
  - Reason for change: harden location-related request validation
  - Short summary of modification: added stricter zod constraints for evaluation fields, upload fields, and link metadata
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\api.ts)
  - Reason for change: give the frontend status-aware API errors and resilient API-origin resolution
  - Short summary of modification: introduced `ApiClientError`, host-derived API base URL, and cleaner error classification
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\app.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\app.tsx)
  - Reason for change: fix brittle auth/session bootstrap behavior
  - Short summary of modification: distinguished session expiry from API/network failure, added retryable session-check state, and improved logout cleanup behavior
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\pages\Login.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\pages\Login.tsx)
  - Reason for change: improve login failure messaging for real transport failures
  - Short summary of modification: status-aware formatting now produces a clearer “API unreachable” message
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\vite-env.d.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\vite-env.d.ts)
  - Reason for change: support typed Vite env access
  - Short summary of modification: added Vite client env typings
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\authMe.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\authMe.test.ts)
  - Reason for change: regression coverage for malformed tokens and logout invalidation
  - Short summary of modification: added `401` malformed-token coverage and logout/session-reuse rejection
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\locations.test.ts)
  - Reason for change: regression coverage for Monday boundary hardening
  - Short summary of modification: added lookalike-host rejection, upload validation, and `500` sanitization tests
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\test\appAuth.test.tsx](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\test\appAuth.test.tsx)
  - Reason for change: frontend regression coverage for login/session bootstrap
  - Short summary of modification: added stale-token and network-failure session bootstrap tests
- [C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\CODEX_REVIEW_PACKET.md](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\CODEX_REVIEW_PACKET.md)
  - Reason for change: provide an external-review handoff artifact in repo
  - Short summary of modification: added the audit reviewer packet requested for ChatGPT/senior review

## 8. Validation Evidence
- Commands run:
  - `npm run build -w packages/api`
  - `npm run build -w packages/admin-web`
  - `npm run build -w packages/worker`
  - `npx tsc -p packages/mobile/tsconfig.json --noEmit`
  - `npm run test -w packages/api -- authMe.test.ts locations.test.ts`
  - `npm run test -w packages/api`
  - `npm run test -w packages/admin-web -- appAuth.test.tsx`
  - `npm run test -w packages/admin-web`
  - `npm run test -w packages/worker`
  - `npm run lint`
- Results:
  - API build passed
  - Admin-web build passed
  - Worker build passed
  - Mobile typecheck passed
  - API tests passed: `23 files / 94 tests`
  - Admin-web tests passed: `2 files / 9 tests`
  - Worker tests passed: `4 files / 10 tests`
  - `npm run lint` ran, but there are no meaningful workspace lint scripts configured; npm emitted a warning about the root `-ws` flag
- Key tests added or updated:
  - malformed bearer token returns `401`
  - logout invalidates old session token
  - Monday proxy rejects lookalike hosts
  - setup photo upload rejects unsafe/mismatched payloads
  - unexpected integration errors do not leak internal strings
  - SPA auth bootstrap handles stale tokens and network failures differently
- Manual or targeted flows exercised:
  - Auth/session route behavior through API tests
  - Logout/session reuse rejection
  - Monday proxy/input boundary behavior
  - Frontend auth bootstrap behavior via React tests
  - Frontend secret-boundary scan over `packages/admin-web/src` and `packages/admin-web/dist`
- What could not be fully validated locally:
  - Live Monday.com behavior with real credentials and production board data
  - Production-domain CORS behavior outside local host variants
  - Browser-console runtime validation of the exact blank-screen case the user saw earlier

## 9. Remaining Risks and Recommended Next Steps
- Open concerns:
  - Bearer tokens are still stored in browser localStorage, which remains an XSS-sensitive design even though the current pass improved session handling around it.
  - Monday history reads still fall back to mock data on read failure, which is safe for UX continuity but can hide production degradation without separate alerting.
  - The repo still emits a `pg` concurrency deprecation warning in the API suite.
  - Admin-web build still emits the existing Vite large-chunk warning.
- Things that still need manual review:
  - Production deployment settings for `ADMIN_WEB_URL`, `SOCKET_IO_CORS_ORIGIN`, and any reverse-proxy auth/header behavior.
  - A second-pass review of legacy routes that still depend on compatibility permission codes rather than only canonical domain/action guards.
  - Live Monday credentials and board mapping behavior under real rate-limit/error conditions.
- Suggested next hardening priorities:
  - Move from localStorage bearer tokens to a more XSS-resistant session model when architecture allows.
  - Add explicit integration health logging/alerting for Monday read failures instead of silent mock fallback.
  - Add structured request-id surfacing in the frontend for supportable error reporting.
  - Add targeted lint rules or a real workspace lint script so security-sensitive patterns are checked automatically.

## 10. Reviewer Notes for ChatGPT
This pass was surgical rather than architectural. The changes targeted concrete, provable problems in auth bootstrap behavior, request logging, API error exposure, and the Monday proxy/upload boundary, while preserving the existing product direction and permission model. I did not attempt a sweeping auth redesign or a broader integration rewrite.

The biggest uncertainty is not whether the patched issues are real; they were real and were fixed. The bigger uncertainty is breadth: this repo is large, and while the highest-risk auth/session/Monday boundaries were traced and strengthened, a second-pass review should focus on older legacy route groups, any remaining integration code paths not covered by regression tests, and the long-term token-storage model in the admin SPA. The repo now looks materially safer and stable enough for continued development, but it should still be treated as “safer after a real hardening pass,” not “fully security-complete.”
