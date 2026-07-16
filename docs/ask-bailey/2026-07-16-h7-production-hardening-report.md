# Ask Bailey H7 — Production Hardening — Final Report

**Date:** 2026-07-16
**Branch:** `feature/work-spine-foundation-v1`
**Verdict:** `PASS` (all H7 hard gates green)

Charter mission H7: close the highest-risk production gaps before real employees
rely on Ask Bailey — threat model, adversarial authorization/injection tests,
secrets/provider config + kill switch, reliability + rate limits, observability
+ cost, retention/deletion/incident operations, accessibility, and a
machine-readable release gate. No broad new user features.

---

## 1. Branch and upstream
- `feature/work-spine-foundation-v1` → `origin/feature/work-spine-foundation-v1`.

## 2. HEAD before and after
- Before H7: `5b05c98` (H6). After H7: this commit.

## 3. Working-tree state before and after
- Before: clean at `5b05c98`. After: clean (scratch scripts removed).

## 4. Ahead/behind state
- Preserved via a normal non-force fast-forward push after the phase passed; 0/0 afterward.

## 5. Push status
- Normal non-force push under the autopilot phase-boundary authorization.

## 6. Commits created, in order
1. (this commit) — feat: Ask Bailey production hardening — observability, release gate, adversarial suite (H7)

## 7. Files changed by slice
- `packages/api/src/services/ai/askBaileyObservability.ts` (new) — reviewer-gated observability summary + machine-readable release gate.
- `packages/api/src/routes/askBailey.ts` — `GET /observability`, `GET /release-gate` (reviewer-gated).
- `packages/api/tests/askBaileyHardening.test.ts` (new) — 8 adversarial hard-gate tests.
- `packages/admin-web/src/services/askBaileyObservabilityApi.ts` (new) — client.
- `packages/admin-web/src/pages/AskBaileyObservability.tsx` (new) — reviewer health page.
- `packages/admin-web/src/navigation.ts`, `permissions.ts`, `app.tsx` — four-point registration for `#knowledge/observability`.
- `packages/admin-web/src/test/askBaileyObservabilityPage.test.tsx` (new) — 2 page tests.
- `docs/ask-bailey/2026-07-16-h7-production-hardening.md` — threat model, retention/deletion/incident, deployment/secrets, accessibility.
- `docs/ask-bailey/2026-07-16-h7-release-readiness.json` — machine-readable release gate (overall pass).

## 8. Migrations and configuration changes
- No new migration. No new config key (H7 uses existing `ASK_BAILEY_LLM_KILL_SWITCH`, `ASK_BAILEY_ASK_RATE_MAX_PER_MINUTE`, `ASK_BAILEY_LLM_TIMEOUT_MS/RETRY_MAX/MAX_CONCURRENT`, cost keys). Deployment env requirements documented (not committed).

## 9. Reused canonical systems
- `ai_provider_usage_event` telemetry, `recordUsage`, the eligibility predicate, `getPlayableMedia`, `requireKnowledgeReviewer`, the rate-limit middleware, and the audit log.

## 10. Behavior implemented
Reviewer-gated observability read model + machine-readable release gate that computes the hard safety invariants from live data, a reviewer health page, and a consolidated adversarial suite proving the invariants against the real implementation. Existing hardening (kill switch, rate limit, timeout/retry, fallback, opaque media) was audited and proven rather than rebuilt.

## 11. Authorization and security controls
- Observability + release gate are `requireKnowledgeReviewer`-gated (associate → 403, proven live and in tests).
- No prompt content, protected excerpt, or secret is logged or surfaced.

## 12. Exact tests and commands run
- `npx tsc --noEmit -p tsconfig.json` (both packages).
- `npx vitest run tests/askBaileyHardening.test.ts` (API, 8 tests).
- `npx vitest run src/test/askBaileyObservabilityPage.test.tsx` (admin-web, 2 tests).
- `npm run test` (both full suites).
- Live: `GET /api/ask-bailey/release-gate` and `/observability` as reviewer (200) and associate (403).

## 13. Test, typecheck, build, and evaluation results
- Both typechecks PASS.
- H7 API adversarial suite: 8/8. H7 page tests: 2/2.
- Full suites green at the committed tree (see §14 for counts recorded at push time).
- Live release gate: **overall pass**; all six live gates pass; two gates honestly marked `external`.

## 14. Authenticated browser/API verification performed
- Reviewer `GET /release-gate` → 200, overall pass; associate → **403**.
- Reviewer `GET /observability` → 200, invalid_citations 0; associate → **403**.
- Adversarial suite proves: no confidential leak, opaque media 404, valid citations only, retirement purge, provider-failure honest degradation, 429 rate limit.

## 15. Whether any live external provider was actually exercised
No. Deterministic providers only. The hosted provider transport, kill switch, timeout, and cost keys are wired and documented but no cloud provider was provisioned or called.

## 16. Demo fixtures versus real production behavior
Verification ran against the seeded `pmc` tenant. The release gate and observability read model operate on real recorded telemetry; no demo answer was fabricated.

## 17. Known limitations and risks not hidden
- No live load test against a real hosted provider was run (no cloud resources provisioned); latency/error budgets are documented and enforced by the configured caps rather than measured against a live LLM.
- The release gate's two `external` gates depend on the CI/test commands in this report, not a runtime query — surfaced as `external` so they are never silently green.
- Accessibility was reviewed against the existing component tests and semantics; no dedicated screen-reader audit tool was run in this session.

## 18. External configuration/content still required
- Azure/staging provider credentials and cloud resources (documented in the hardening doc), an approved Bailey portrait, and real approved content (H8).

## 19. Recommended next bounded prompt
H8 — Real-content pilot launch readiness (CONDITIONAL PASS permitted per the autopilot rules).
