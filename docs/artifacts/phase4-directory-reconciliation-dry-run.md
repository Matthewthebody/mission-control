# Phase 4 — Directory Reconciliation Batch (Dry Run)

- **Tenant:** `223ee748-3dcd-4837-97a9-8eba7dbb11f2`
- **Admin context:** schools-office@example.com
- **Generated:** 2026-06-20T21:43:36.409Z
- **Mode:** dry-run (nothing written)
- **Batch id:** (dry-run — no batch)

## Districts (link Schools to canonical Districts on exact name match)

- Considered: **3**
- already_canonical: 0
- exact_match: 0
- multiple_candidates (Review Required): 0
- no_candidate (Review Required): 3
- conflicting_parent (Review Required): 0
- **Applied links:** 0

## Contacts (one-to-one canonical identity backfill — never merges)

- Total unlinked org-bound contacts: **187**
- one_to_one (eligible): 187
- invalid_no_identity (Review Required): 0
- possible_duplicate (own identity, not merged): 0
- **Applied identities:** 0

## Brand / notes (legacy brand still packed in notes)

- Review Required candidates: **1** (reported only — never auto-applied)

## Reversal

- Districts applied links: 0
- Contacts backfill batch id: (none)

> Reverse districts: UPDATE organization SET parent_organization_id = NULL for each rollback.districts_applied_links row. Contacts and brand/notes are reported only by this batch (never applied), so there is nothing to reverse there — run POST /contact-identities/backfill explicitly to apply the one-to-one identity backfill.
