# Phase 5 — Monday Migration Dry Run: All Schools

- **Source:** `all-schools.sample.json` (SANITIZED SAMPLE — not real Monday data)
- **Provider/board:** monday / `sample_all_schools` (workspace: Schools)
- **Target entity:** organization
- **Mode:** dry-run · side effects suppressed: true

## Counts

- total items: **3**
- create: 2 · update: 0 · skip: 0 · conflict: 0 · review_required: 1
- unsupported columns (formula/mirror/dependency — never invented): formula_health

## Rows

| item_id | classification | dedupe_key | missing_required | unsupported | name |
|---|---|---|---|---|---|
| sch_1001 | create | monday:organization:sch_1001 | — | formula_health | Sample Maple High School |
| sch_1002 | create | monday:organization:sch_1002 | — | formula_health | Sample Oak Middle School |
| sch_1003 | review_required | monday:organization:sch_1003 | canonical_name | formula_health | (blank) |

> Candidate matching is by Monday item id / external_object_map only — never fuzzy names.
> No entity was written and no notification / email / reminder / escalation / workflow side effect fired.
