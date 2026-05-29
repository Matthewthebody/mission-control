# Client Operations Core Handoff

## Scope

This pass implements the architecture foundation for `Client Operations Core` inside Mission Control.

Implemented in this pass:

- canonical entity and relationship contract
- connected-system boundary rules
- shared permissions strategy
- shared document/media strategy
- shared search strategy
- shared warning strategy
- recommended information architecture
- naming dictionary
- future-proofing guidance
- protected API contract route
- architecture decision record
- reviewer handoff guidance in code and docs

Not implemented in this pass:

- schema migrations for a brand-new unified core
- UI rewrites
- worker jobs
- alert engine changes
- full search index implementation
- module-specific feature builds

This is intentionally an architecture-and-contract phase.

## Architecture Choice

`Client Operations Core` is the shared backbone of Mission Control, not a separate app and not a loose collection of module docs.

Canonical backbone:

- `Organization`
- `Contact`
- `Location`
- `Shoot`
- `Resource Library Item`
- `Agreement`
- `Post-Shoot Evaluation`
- `Recurring Location Intelligence`

Integrated systems:

- `Time Clock / Labor Tracking`
- `Gear / Equipment`
- `Alerts / Notifications`
- `Reporting / Dashboards`

Primary reference:

- [ADR-2026-03-28-client-operations-core.md](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\docs\architecture\ADR-2026-03-28-client-operations-core.md)

## Files Added Or Updated

### API Contract

- [clientOperationsCore.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\types\clientOperationsCore.ts)
- [clientOperationsCoreContracts.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\clientOperationsCoreContracts.ts)
- [clientOperationsCore.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\clientOperationsCore.ts)
- [app.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\app.ts)

### Documentation

- [ADR-2026-03-28-client-operations-core.md](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\docs\architecture\ADR-2026-03-28-client-operations-core.md)
- [client-operations-core-architecture.md](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\docs\client-operations-core-architecture.md)

### Validation

- [clientOperationsCoreContracts.test.ts](C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\tests\clientOperationsCoreContracts.test.ts)

## Protected Route

Implemented route:

- `GET /api/client-operations-core/contracts`

Current access policy:

- leadership-facing roles only
- blocked for photographers/field users

This route exists so the architecture contract is inspectable and testable from code, not only from markdown.

## What Later Phases Should Preserve

- Keep `Organization`, `Contact`, `Location`, and `Shoot` canonical.
- Keep `Resource Library Item` as the shared media/document spine.
- Keep `Agreement`, `Post-Shoot Evaluation`, `Time Session`, `Time Segment`, `Asset`, and `Kit` authoritative in their own bounded domains.
- Keep cross-system warnings derived and projected, not hardcoded separately per screen.
- Keep dashboards and recurring memory derived from canonical history rather than becoming editable source records.

## Validation Commands

- `npm run build -w packages/api`
- `npm run test -w packages/api -- tests/clientOperationsCoreContracts.test.ts`

## Known Limitations

- This pass does not merge or rewrite existing module schemas.
- This pass does not implement a central warning engine or unified search index yet.
- This pass does not add UI beyond making the architecture contract available through the protected API.

That is intentional. The purpose here is to lock the shared model before more implementation phases build on top of it.
