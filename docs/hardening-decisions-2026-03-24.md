# Hardening decisions - 2026-03-24

## Coworker visibility
Decision:
- For shifts tied to a shoot, employees may see published coworkers assigned to that same shoot.
- For standalone studio, office, or training shifts, do not show a coworker list for now.
- Do not show employees from unrelated shoots, locations, or departments.

Reason:
- This is the safest rule for the hardening pass.
- It removes dependence on legacy shoot_assignment without widening visibility by accident.

## Offline stance
Decision:
- Phase 1 officially supports queued punch submission only.
- Phase 1 does not support full offline mode.
- No offline browsing, schedule editing, or approvals.
- Queued punches may retry when connectivity returns and should be clearly marked in the UI.

Reason:
- The mobile code already leans toward practical queued punch behavior.
- This accepts the useful part without pretending the app fully supports offline work.

## Outlook external work
Decision:
- Real Azure app registration, OAuth credentials, and live Microsoft testing are deferred until after the hardening pass is merged.
- This hardening pass is source-build, typing, legacy cleanup, and UI regression coverage only.
