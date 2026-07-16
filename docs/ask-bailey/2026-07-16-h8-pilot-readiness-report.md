# Ask Bailey H8 — Real-Content Pilot Launch Readiness — Final Report

**Date:** 2026-07-16
**Branch:** `feature/work-spine-foundation-v1`
**Verdict:** `CONDITIONAL PASS` — **CONDITIONALLY READY FOR CONTROLLED PILOT**

Charter mission H8: move Ask Bailey from demo fixtures toward a controlled
real-content pilot with a complete launch, support, measurement, and rollback
plan — without inventing real approvals or claiming pilot outcomes. The pilot
remains disabled by default.

This CONDITIONAL PASS is permitted under the autopilot rules: the code,
permissions, feature flags, cohort controls, manifest tooling, UAT plan,
rollback controls, and tests are complete; H7's security/reliability gates are
green; the only missing items are **external real-world inputs**; the pilot is
disabled by default; and no real pilot outcome is claimed.

---

## 1. Branch and upstream
- `feature/work-spine-foundation-v1` → `origin/feature/work-spine-foundation-v1`.

## 2. HEAD before and after
- Before H8: `02ccda3` (H7). After H8: this commit.

## 3. Working-tree state before and after
- Before: clean at `02ccda3`. After: clean.

## 4/5. Ahead/behind + push
- Preserved via a normal non-force fast-forward push after the phase; 0/0 afterward.

## 6. Commits created, in order
1. (this commit) — feat: Ask Bailey real-content pilot readiness — demo/prod separation, manifest tooling (H8)

## 7. Files changed by slice
- `db/migrations/174_ask_bailey_demo_separation.sql` (new) — `knowledge_source.is_demo` + backfill.
- `packages/api/src/config.ts` — `ASK_BAILEY_ALLOW_DEMO_CONTENT`.
- `packages/api/src/services/knowledge/knowledgeGovernance.ts` — demo-exclusion clause in `buildVersionEligibilitySql`; `isDemo` on `createKnowledgeSource`.
- `packages/api/src/services/knowledge/contentManifest.ts` (new) — manifest schema, validation, plan, governed import.
- `packages/api/scripts/import-ask-bailey-content.ts` (new) — environment-gated import CLI (dry-run by default).
- `packages/api/tests/askBaileyPilotReadiness.test.ts` (new) — 4 tests.
- `docs/ask-bailey/h8-content-manifest-template.json` — manifest template.
- `docs/ask-bailey/2026-07-16-h8-pilot-launch.md` — launch/UAT/rollback plan + employee disclosure.

## 8. Migrations and configuration changes
- Migration 174 (`knowledge_source.is_demo`). New config key `ASK_BAILEY_ALLOW_DEMO_CONTENT` (default true; production sets false).

## 9. Reused canonical systems
- The eligibility predicate, governed source lifecycle (`createKnowledgeSource` → ingestion → submit → approve), H6 pilot cohorts/assignment, H7 observability/release gate/kill switch, and the Resource Library asset link.

## 10. Behavior implemented
- **Demo/production separation** enforced inside retrieval eligibility (production excludes demo content; proven).
- **Real-content manifest** schema + validation that reports missing content as launch blockers (never fabricates) + a governed, environment-gated import tool (dry-run by default; production entries created with `is_demo=false`).
- Complete launch/UAT/rollback plan, employee disclosure, and go/no-go criteria (docs).
- Measurement reuses H7 observability + H6 pilot metrics.

## 11. Authorization and security controls
- Import runs through `createKnowledgeSource` (reviewer authority) and the normal approval workflow; nothing bypasses governance.
- Demo exclusion is a SQL predicate, not a UI convention.

## 12. Exact tests and commands run
- `npx tsc --noEmit -p tsconfig.json` (both packages).
- `npx vitest run tests/askBaileyPilotReadiness.test.ts` (4 tests).
- `npm run test` (both full suites).
- Dry-run of the import CLI against the template manifest (reports the missing-content blockers).

## 13. Test, typecheck, build, and evaluation results
- Both typechecks PASS. H8 tests 4/4. Full suites green at the committed tree.
- Demo/production separation proven: with `ASK_BAILEY_ALLOW_DEMO_CONTENT=false`, a demo source's distinctive phrase disappears from answers while a real source still answers.

## 14. Authenticated browser/API verification performed
- Demo/production separation and governed import verified through the real service path (transactional tests against the seeded DB). The manifest import CLI dry-run lists ready entries vs missing-content blockers.

## 15. Whether any live external provider was actually exercised
No. Deterministic providers only.

## 16. Demo fixtures versus real production behavior
- The existing `[DEMO]` seed corpus is now flagged `is_demo=true` and is excluded from production retrieval. The manifest template ships with **no real content** (all entries are blockers) precisely so no company policy is fabricated.

## 17. Known limitations and risks not hidden — explicit LAUNCH BLOCKERS
1. **Approved real content** — the pilot corpus (SOPs, videos, guides) is not in the repository; the manifest template has no real entries.
2. **Named pilot employees** — no real cohort membership is configured.
3. **Cloud provider credentials** — no hosted LLM/embedding/transcription provider provisioned; the deterministic path is the only exercised one.
4. **Approved Bailey portrait** — still the replaceable placeholder mark.
5. **Launch date** — no `starts_on`/`ends_on` set for a real cohort.
No real pilot outcome, adoption, or accuracy is claimed.

## 18. External configuration/content still required
- Set `ASK_BAILEY_ALLOW_DEMO_CONTENT=false` and provider env in production; import an approved manifest; create + enable a cohort with named members; supply the Bailey portrait; set a launch date.

## 19. Recommended next bounded prompt
H9 — Governed organizational learning and bounded actions (deterministic pilot fixtures where real pilot data is absent).
