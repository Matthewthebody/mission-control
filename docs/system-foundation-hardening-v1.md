# System Foundation Hardening V1

This pass hardens Mission Control as a platform. It is not a feature sprint and should not create duplicate sources of truth for jobs, accounts, contacts, workflows, mileage, evaluations, flags, or reports.

## Baseline

Base branch:

- `feature/mission-control-integrated-baseline`

Expected foundation:

- Project Tracking and Client Command Center pilot polish.
- Release Gate Rebuild V1.
- Workflow Template Builder V1.
- Job Closeout / Post-Shoot Evaluation V1.

The dirty Client Command Center relationship-workflow UI branch is intentionally excluded from this pass.

## Data Categories

### Reference data

Reference data is required system data. It should be idempotent and safe to create during `npm run db:seed`.

Examples:

- Tenants needed for local development.
- Local/dev users needed for dev-login.
- Roles, permissions, and authority grants.
- Core workflow templates and workflow reference records that app flows require.
- Schedule, mileage, and production reference records required by existing dev flows.

### Test data

Test data belongs to tests only. It must not be required by local demos or production-like data.

Rules:

- Use unique test markers or inserted ids.
- Prefer test-owned rows over shared demo rows.
- Clean up only test-owned rows.
- Avoid broad tenant-wide deletes from shared tables.
- Avoid mutating shared rows such as `DEMO-001` unless the test explicitly owns that row.

### Demo data

Demo data is curated story data for walkthroughs. It should be small, readable, and intentionally demo-owned.

Rules:

- Must be disabled in production.
- Must require an explicit `--allow-demo-data` confirmation.
- Must use clear markers such as `client_command_center_v1`, `project_tracking_foundation`, or `mission_control_demo_v1`.
- Must not be required by tests.
- Must stay under demo caps where practical: no more than 10 organizations, accounts, jobs, tasks, or contacts per demo area.

## Fresh DB Contract

A fresh local/dev DB should become usable after:

```bash
npm run db:migrate
npm run db:seed
npm run verify:fresh-db-contract
```

The verifier checks:

- Demo Studio tenant exists.
- Required local users exist for dev-login.
- Roles and permissions exist.
- Studio and organization references exist.
- Workflow template demo references are reported when present, but they are created by the demo seed rather than required by `db:seed`.
- `/health` responds.
- `dev-login` works for leadership.
- Core feature flags load.

The verifier is read-only except for normal auth/session writes caused by `dev-login`.

## Seed and Demo Commands

Reference seed:

```bash
npm run db:seed
```

Curated demo seed wrapper:

```bash
npm run seed:mission-control-demo
```

The V1 demo wrapper runs the existing Project Tracking and Client Command Center demo seeders and enforces the top-level demo caps for those areas. It does not yet create the full Job Closeout story dataset.

## Tenant and RLS Risks

Known safeguards:

- Core app requests use `withClientTransaction` / transaction helpers that set `app.tenant_id`.
- Many tenant-scoped tables use RLS policies against `app.current_tenant_id()`.
- Tenant isolation tests cover cross-tenant shoot access and now cover Job Closeout/report snapshot rows.

Known risk:

- Some older shared workflow template base tables predate the later Project Tracking RLS policies. API paths still filter by tenant, but a future RLS pass should audit the full shared workflow backbone before enabling policies broadly.

## Search and Indexing Risks

Known safeguards:

- Global search is feature-flagged.
- Search reads are bounded.
- Nullable derived booleans should be coalesced before they reach not-null global search columns.

Known risk:

- Search refresh failures are still surfaced as business-action failures for some entity paths. V1 keeps those errors visible but hardens known nullable derived values.

## Compliance Workspace Status

The Compliance Workspace already exists at `#employees/compliance` and `/api/compliance/workspace`.

V1 hardening makes it feature-flag discoverable:

- Backend: `COMPLIANCE_WORKSPACE_V1_ENABLED`
- Frontend: `VITE_COMPLIANCE_WORKSPACE_V1_ENABLED`

Default state remains enabled so the integrated baseline behavior is preserved.

## Known Slow/Performance Debt

Known slower areas:

- Full release test can take 30+ minutes.
- `jobTruthLayer.test.ts`
- `urgentWatch.test.ts`
- broad Concierge/global search paths
- `/api/exceptions`
- owner-command/dashboard runtime response payloads

This pass documents budgets but does not add brittle performance failures.

## Recommended Next Hardening Phases

1. Run a dedicated RLS policy audit for shared workflow backbone tables.
2. Add a fuller Mission Control demo seed for Job Closeout, Checklist Templates, and report snapshots.
3. Add search refresh recovery tooling for failed index rows.
4. Add a platform health page for DB, Redis, outbox, search index, and scheduler status.
5. Reduce full release test duration by grouping safe non-DB unit tests separately from DB-backed integration tests.
