# Phase 5 — Monday Migration Dry Run: Initial Process

- **Source:** `initial-process.sample.json` (SANITIZED SAMPLE — not real Monday data)
- **Provider/board:** monday / `sample_initial_process` (workspace: Schools)
- **Target entity:** job
- **Mode:** dry-run · side effects suppressed: true

## Counts

- total items: **2**
- create: 2 · update: 0 · skip: 0 · conflict: 0 · review_required: 0
- unsupported columns (formula/mirror/dependency — never invented): mirror_owner

## Rows

| item_id | classification | dedupe_key | missing_required | unsupported | name |
|---|---|---|---|---|---|
| ip_2001 | create | monday:job:ip_2001 | — | mirror_owner | Sample Maple High — Fall Picture Day |
| ip_2002 | create | monday:job:ip_2002 | — | mirror_owner | Sample Oak Middle — Fall Picture Day |

> Candidate matching is by Monday item id / external_object_map only — never fuzzy names.
> No entity was written and no notification / email / reminder / escalation / workflow side effect fired.
