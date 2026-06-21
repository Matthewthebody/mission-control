# Phase 4.1 — Demo Contact Identity Backfill (Dry Run)

- **Admin context:** schools-office@example.com
- **Generated:** 2026-06-21T01:38:15.368Z
- **Mode:** dry-run (nothing written)
- **safe_only:** true
- **Batch id:** (dry-run — no batch)

## Classification

- Total unlinked org-bound contacts considered: **0**
- safe_one_to_one (applied when --apply): **0**
- possible_duplicate (Review Required — never merged, not applied in safe-only): **0**
- invalid_no_identity (Review Required — no name and no email): **0**
- **Applied this run:** 0

## Before / after (organization_contact link coverage)

| Metric | Before | After |
|---|---|---|
| org-bound contacts | 189 | 189 |
| linked (contact_id set) | 189 | 189 |
| unlinked | 0 | 0 |
| canonical identities | 196 | 196 |

## Reversal

Dry run — nothing to reverse.

> Names are never merged. Shared emails are never merged (each relationship gets its own identity). Possible duplicates and identity-less rows are left as Review Required.
