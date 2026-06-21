# Phase 5 — Monday Migration Dry Run: Code Return

- **Source:** `code-return.sample.json` (SANITIZED SAMPLE — not real Monday data)
- **Provider/board:** monday / `sample_code_return` (workspace: Schools)
- **Target entity:** service_term
- **Mode:** dry-run · side effects suppressed: true

## Counts

- total items: **2**
- create: 2 · update: 0 · skip: 0 · conflict: 0 · review_required: 0
- unsupported columns (formula/mirror/dependency — never invented): dependency_prev

## Rows

| item_id | classification | dedupe_key | missing_required | unsupported | name |
|---|---|---|---|---|---|
| cr_3001 | create | monday:school_service_term:cr_3001 | — | dependency_prev | Sample Maple High — 2026-2027 Code Return |
| cr_3002 | create | monday:school_service_term:cr_3002 | — | dependency_prev | Sample Oak Middle — 2026-2027 Code Return |

> Candidate matching is by Monday item id / external_object_map only — never fuzzy names.
> No entity was written and no notification / email / reminder / escalation / workflow side effect fired.
