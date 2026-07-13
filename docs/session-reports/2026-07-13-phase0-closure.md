# Phase 0 Closure — 2026-07-13

**Scope:** finish the 2026-07-08 full-system audit's Phase 0 (safety, routes, tests, honesty) and put every open product decision in front of the owner. Branch `feature/work-spine-foundation-v1`, pushed to origin at session start (157 commits) and again at close.

## Decisions put to the owner

`docs/decisions/2026-07-13-owner-decision-memo.md` (`794fda2`) consolidates every decision blocking engineering, each with context and a recommended default:
- **A** Job↔Shoot convergence (semantics, Option B links, one intake, backfill review) — gates Phase 1 and audit prompts 6/7.
- **B** Payroll calendar (bi-weekly anchor + close rule), travel pay, QuickBooks timing, Teams payroll alerts.
- **C** The six eval/mileage policy questions + answer-pending and legacy-mileage-retirement follow-ons.
- **D** Exception Center vs Compliance Workspace; unified alert registry direction; one payroll surface.
- **E** director_admin Teams grants; intake flag ON for Schools; gallery-as-deliverable; contact-edge FK convention.

**Nothing below waits on these answers; everything in Phase 1/G2-E/G3/SSA does.**

## Shipped (commit per slice)

| Commit | Slice |
|---|---|
| `f72e7df` | **Hermetic API tests** (prompt 3): jobsCanonicalIndex creates its own Job fixtures and mirrors the active-view predicate in raw counts; its scale test builds a 105-row `test_fixture` dataset visible only under `demo_view=all`; schedule's trade-accept picks a date where no participant has a shift. (Complements `60e7876`/`04de945`.) |
| `8152e56` | **MC-016 dev-login hardening**: `ALLOW_DEV_LOGIN` fails closed when `NODE_ENV` is unset (a deploy that forgets the variable can no longer silently enable passwordless login); per-ip+email rate limit; regression tests. Repo `.env` now sets `NODE_ENV`/`ALLOW_DEV_LOGIN` explicitly. |
| `61cf35c` | **Labor stack seed** (prompt 4 / MC-017): `scripts/seed-labor-command-center.ts` — canonical sessions derived from the current week's real shifts (`source_shift_id`-linked, so ops-dashboard hours reconciliation becomes comparable), payroll summaries via the single-writer service, period + self-check via the real lifecycle services, discrepancy/mileage/overtime stories. Idempotent; standalone-runnable against a live dev DB (verified: 14 sessions / 8 employees) and wired into `seed.ts`. |
| `5058131` | **Home fiction killed** (prompt 5 / MC-003/015 + smoke F1): Home derives from the real session role; employees land on live My Work; Needs Attention is fed by the same `/api/exceptions`→urgentWindow read model as On Fire (counts cannot disagree); persona workspaces, sports demo data, and the fabricated change notices deleted (~1,700 lines); remaining sample panels visibly badged; preview switcher leadership-only. |
| `0ff4b08` | **Bounded endpoints** (prompt 9, Phase 0 subset): `/api/alerts` newest-first LIMIT 200 (cap 500, tested); `listShifts` 90-day default lookback; trades/PTO capped at 500; `listProductionQueue`'s automation sweep is opt-in (all callers already opted out — note: the sweep now has NO invoker and needs a worker schedule). |
| `160843a` | **Deep-link integrity** (prompt 2 / MC-018): explicit `route-not-found` page for unknown hashes; `critical_high_only` parsed; `?queue=&stage=` translated to the queue's real `saved_view` contract (links + nav registry); Training's parser accepts the hash it writes; `toJobHash` without an id → `#jobs`; both audit-known red tests fixed intentionally (`#production/operations` contract; calendar fixture dates now track the current month). |
| `f63e58b` | **Guard fix from live verification**: `route-not-found` needed a `canAccessRoute` case or the app guard silently swapped it for the dashboard — the registered-but-unreachable trap again. |

## Verification

- **API suite: 191/191 files green** on the first full run; second full run green after the labor seed mutated the DB (the hermeticity point). Worker 69/69. admin-web **111 files / 626 tests green** (including the two audit-known reds, now intentionally aligned). tsc clean across api / admin-web / mobile.
- **Live browser pass** (dev servers, real dev-login): leadership Home renders live On Fire == live Needs Attention (1,085) with Sample/Not-connected badges; photographer Home is the live My Work launchpad (377 real eval obligations, working acknowledge/decline); `#does/not/exist` renders the not-found page; Labor Command Center returns a real period with self-check counts and 4 overtime warnings.

## Still open from the audit (sequenced)

1. **Prompt 6** job↔shoot reviewed links — blocked on decision memo §A.
2. **Prompt 7** one status vocabulary — after 6.
3. **Prompt 8** one time truth / one payroll exit — G2 retirement sequencing (Slice D landed; consumers opt in next).
4. **Prompt 9 deep half** — checklist-attention N+1 batching (~600 queries/render) + a worker schedule for the production automation sweep (spawn-task chip created).
5. **Prompt 10** SharedJobsPage → canonical jobs index; by-id workflow endpoint.
6. Server-side acks (MC-015 remainder), intake flag ON (§E2 after clickable missing states), client-issue record (MC-013), unified alert registry (Phase 3).
