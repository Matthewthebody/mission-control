# Phase 4.1 — Demo Contact Identity Backfill (Applied, safe-only)

- **Admin context:** schools-office@example.com
- **Generated:** 2026-06-21T01:37:55.236Z
- **Mode:** applied (safe one-to-one only)
- **safe_only:** true
- **Batch id:** 4689434a-6f7c-4e21-a414-78bb47600224

## Classification

- Total unlinked org-bound contacts considered: **187**
- safe_one_to_one (applied when --apply): **187**
- possible_duplicate (Review Required — never merged, not applied in safe-only): **0**
- invalid_no_identity (Review Required — no name and no email): **0**
- **Applied this run:** 187

## Before / after (organization_contact link coverage)

| Metric | Before | After |
|---|---|---|
| org-bound contacts | 189 | 189 |
| linked (contact_id set) | 2 | 189 |
| unlinked | 187 | 0 |
| canonical identities | 9 | 196 |

## Reversal

This batch is reversible: `rollbackContactIdentityBackfill(client, auth, "4689434a-6f7c-4e21-a414-78bb47600224")` nulls the org-bound links it set and deletes ONLY the identities it created (source = 'backfill:4689434a-6f7c-4e21-a414-78bb47600224'). No org-bound contact and no other-source identity is touched; nothing is hard-deleted beyond this batch's own identities.

> Names are never merged. Shared emails are never merged (each relationship gets its own identity). Possible duplicates and identity-less rows are left as Review Required.
