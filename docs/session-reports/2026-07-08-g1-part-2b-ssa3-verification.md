# G1 Part 2b / SSA-3 Verification Note

**Date:** 2026-07-08 · **Branch:** `feature/work-spine-foundation-v1`
**Scope:** post-landing verification of `cc1dfe1` (Compliance item types), `ad5afad` (My Work card), `6153e36` (mobile mileage prompt) — including an adversarial fresh-eyes review that found and fixed three real defects (`945fdf6`).

## Verification gate results (at HEAD `045a7ff`+)

| Check | Result |
|---|---|
| API / admin-web / mobile `tsc` | 0 / 0 / 0 |
| Compliance suite (incl. Part 2b types) | 6/6 |
| Mileage eligibility suite | **8/8** (grew: shift_id case + payable-guard case) |
| Obligations suite | 6/6 |
| Labor Command Center suite | 13/13 |
| Manager cockpit suite (another stream's, landed `045a7ff`) | 7/8 — see flake note |
| Browser: `#employees/compliance` (manual-adjustment rows), `#my-work/payroll-self-check`, My Work card (photographer scope, 253 real obligations, no team leak) | ✅, zero console errors |

**Manager-cockpit interaction:** `045a7ff` ("Restrict owner command compliance access", fixing audit finding MC-AUDIT-002) composes cleanly with G1 Part 2 — it adds fail-closed own-scoping *before* the summary computation, so the count==rows invariant is unaffected. One of its own tests (`owner-command compatibility alias`) is **racy by design**: it deep-compares two live endpoints fetched in parallel while the 60-second labor sweep mutates state. Flagged for that stream; not a regression.

## Defects found by adversarial review of the mobile prompt (all fixed in `945fdf6`)

1. **Blocker — prompt never appeared.** `onSubmitted` fired immediately on submit success, and the parent closes the modal on that callback, unmounting the prompt in the same tick. Fixed: deferred notification via `handleDismiss` (fires on Done / dismiss / close; dismiss-without-answer stays honest — the eval is saved, the answer can come later).
2. **Cross-shift state leak.** The modal is persistently mounted; the reset effect didn't clear mileage-prompt state, so a stale prompt would pre-render on the next shift's sheet. Fixed: full mileage-state reset on open.
3. **Unenforced G3 boundary.** The recalc's upsert overwrites status unconditionally; an answer could have downgraded an approved/exported (payable) record. Fixed: service-level 409 `mileage_already_processed` guard, test-proven. (Those statuses have no writer today — latent-trap guard.)

## Mobile device verification status: **OUTSTANDING (tsc + API-test verified only)**

No Expo runtime/simulator exists in this environment. Manual QA checklist for the device pass:

1. Photographer assigned to a shoot submits a standard post-shoot eval → the sheet stays open and the mileage question appears (Defect 1's regression check).
2. Yes path → "Saving…" → recorded-eligible echo with vehicle type → Done closes and the parent refreshes.
3. No path (different fixture) → recorded-declined echo; server-side mileage becomes non-payable (`submit_declined`).
4. Failure path (kill connectivity, tap Yes) → honest error copy, buttons re-enable, retry succeeds, eval stays submitted/locked throughout.
5. Reopen the same shift → no duplicate prompt; open a *different* shift → no pre-showing prompt (Defect 2's regression check).
6. With an approved/exported mileage row for the date → answering returns the 409 guard message and the payable status survives (Defect 3's regression check).

Known design gap (not a defect): the Yes path records the form's `vehicleType` state (defaults `personal_vehicle`); a vehicle picker inside the prompt is a candidate refinement. A true "answer pending" state remains unrepresentable canonically (`submit_for_mileage` defaults false) — that is G2/G3 semantics work (see the G2 audit doc), not something to fake in UI.
