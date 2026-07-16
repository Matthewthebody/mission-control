# Ask Bailey H8 — Fall Field Coach Pilot: Launch, UAT, and Rollback Plan

**Date:** 2026-07-16. Companion to the H8 readiness report.

The pilot is **disabled by default**. Nothing in this plan enables company-wide
access. Enablement is per-cohort and reversible.

---

## H8-A — Demo/production separation (enforced)
- `knowledge_source.is_demo` marks demo content; the seed corpus is backfilled to `is_demo = true` (migration 174).
- `ASK_BAILEY_ALLOW_DEMO_CONTENT=false` (set in production app settings) excludes demo sources from retrieval **inside the eligibility predicate** — proven by `askBaileyPilotReadiness` (demo content vanishes, real content still answers).
- Training lessons and pilot cohorts carry their own `is_demo` flag.
- Removing demo content never breaks the real system (independent rows).

## H8-B — Real content manifest + import
- Fill `docs/ask-bailey/h8-content-manifest-template.json` with real approved content (inline body or a Resource Library asset id) per entry.
- Dry-run: `npx tsx scripts/import-ask-bailey-content.ts <manifest.json>` — validates schema, prints the plan, and lists any entry missing real content as a **launch blocker** (never invented).
- Import: add `--allow-import` (and `--auto-approve` only when a human has already reviewed). Sources are created through the same governed workflow employees see, with `is_demo=false` for a production manifest.
- Target corpus: ~10–20 written resources, 2–5 videos/audio, one troubleshooting guide, one pre-shoot checklist, one escalation guide.

## H8-C — Content quality review
For each real source: confirm current/approved status; compare against conflicting/older material (the existing conflict record + reviewer queue); classify segments (current workflow vs pain point vs future design vs raw vs evidence — H3 nine-way classification); verify transcript corrections and timestamps; verify scope. Retire/supersede outdated versions through the governed workflow. Do not mass-approve to fill coverage.

## H8-D — Pilot cohort and feature controls
- Create a cohort (`#training/lessons` → cohorts), add explicit members (selected senior photographers, certified trainers, new/returning associates, knowledge owners, leadership reviewers).
- **Disabled by default**; enable per-cohort. Assignment through a disabled cohort or to a non-member is refused (proven in H6).
- Provider kill switch: `ASK_BAILEY_LLM_KILL_SWITCH=true` (H7).
- Content version pinning: assignments pin the approved lesson version (H6).
- Start/end: cohort `starts_on` / `ends_on`.
- Support contact + escalation: cohort `support_contact`.
- **Employee-facing disclosure** (show to each pilot member before first use):
  > "Ask Bailey answers from our approved company playbook and cites its sources. It is a help and training tool, not a monitoring or evaluation system. Your questions and training results are used to improve the playbook and support coaching — never for discipline or ranking. If Bailey is wrong or missing something, use the report button."

## H8-E — Pilot UAT scenarios (expected result + evidence)
| # | Scenario | Expected result |
|---|----------|-----------------|
| 1 | Exact SOP question | Supported answer with citation to the approved section |
| 2 | Paraphrase of #1 | Same supported answer (hybrid retrieval) |
| 3 | Typo/inflection | Still retrieves (trigram/typo similarity) |
| 4 | Contextual shoot question (drawer) | Answer scoped to the record's context |
| 5 | Exact video timestamp | "Watch from mm:ss" opens protected media at the stored time |
| 6 | No-answer question | Honest "no approved answer" — never a guess |
| 7 | Source conflict | Visible conflict state showing both approved sources |
| 8 | Restricted content as an unauthorized user | Opaque — content and its existence stay hidden |
| 9 | Future-design question | "This is a future-design idea, not today's procedure" |
| 10 | Follow-up in a conversation | Coherent threaded answer |
| 11 | Feedback (helpful/not) | Recorded; reviewer queue updated |
| 12 | Report incorrect/outdated | Creates a reviewer report |
| 13 | Lesson assignment + completion | Assign → read → readiness → completed (H6) |
| 14 | Provider outage/fallback | Deterministic fallback with a visible notice (H7) |
| 15 | Mobile use | Keyboard/touch accessible, readable |

## H8-F — Pilot measurement
Use `#knowledge/observability` (H7) + the H6 pilot metrics: active users, questions per user/role/topic, supported/partial/no-answer/conflict rates, false-support reports, citation/timestamp clicks, latency/provider errors, cost, training completion/readiness, helpful/not-helpful, unresolved questions, source gaps, support volume. **Not** hidden employee performance scoring.

## H8-G — Launch & rollback runbook
- **Launch checklist**: env set (`ASK_BAILEY_ALLOW_DEMO_CONTENT=false`, provider creds or kill switch on); real manifest imported + approved; cohort created + members added; disclosure shown; support contact set; observability reviewed (release gate = pass).
- **Knowledge-owner checklist**: every pilot source approved, scoped, and reviewed; conflicts resolved; review dates set.
- **Employee quick-start**: open Ask Bailey → ask in plain words → open the cited source/timestamp → report if wrong. Training: `#my-work/training`.
- **Leadership review guide**: watch supported vs no-answer rate, reported answers, unresolved questions, training completion.
- **Provider outage**: engage the kill switch; the deterministic path keeps answering.
- **Bad answer / source conflict**: retire/supersede the version (governed); resolve the conflict record.
- **Content rollback**: retire the version — it stops answering immediately (proven purge).
- **Emergency disable**: disable the cohort (assignments stop) and/or engage the kill switch; set `ASK_BAILEY_ALLOW_DEMO_CONTENT` appropriately.
- **Pilot review agenda / go-no-go**: after the window, review measurement; expand only if supported-rate and helpfulness meet target and no protected-source or citation-integrity gate regressed.

## H8-H — Readiness verdict
See the H8 readiness report. Status: **CONDITIONALLY READY** — code, controls, manifest tooling, UAT, measurement, and rollback are complete and the pilot is disabled by default; the only remaining items are external real-world inputs (approved content, named pilot employees, cloud provider credentials, an approved Bailey portrait, a launch date).
