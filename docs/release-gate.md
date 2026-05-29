# Release Gate

Mission Control's release gate is intended to prove that a commit candidate is buildable, deterministic, pilot-safe, and runnable without hiding product regressions.

This gate is not a place to lower coverage. When a test flakes or times out, prefer fixing test ownership, fixture scope, query bounds, or lifecycle cleanup over skipping the test or increasing timeouts.

## Gate Tiers

### Release build gate

Command:

```bash
npm run verify:release:build
```

What it runs:

- `npm run build -w packages/api`
- `npm run build -w packages/worker`
- `npm run build -w packages/admin-web`
- `npm run verify:mobile`

Purpose:

- Proves API, worker, admin-web, and mobile TypeScript/build targets compile.
- Does not prove runtime behavior or DB-backed behavior.

### Release test gate

Command:

```bash
npm run verify:release:test
```

What it runs:

- `npm run test -w packages/api`
- `npm run test -w packages/worker`
- `npm run test -w packages/admin-web`

API test runner:

- `packages/api/scripts/run-vitest-chunks.mjs`
- Runs API test files one at a time with `vitest run --pool forks --maxWorkers 1`.
- Retries a file once only for Vitest runner-level IPC channel closures.

Purpose:

- Runs stable, deterministic, release-blocking tests.
- Protects core product behavior, permissions, workflow state, reporting, integrations, scheduling, and pilot-critical APIs.

Release-blocking tests must:

- Use deterministic test-owned fixtures.
- Avoid mutating shared demo records such as `DEMO-001`.
- Avoid broad global cleanup.
- Clean up only records they own, usually by inserted ids or unique test markers.
- Avoid unbounded queries and broad JSON scans where a scoped query would prove the same behavior.
- Avoid real external calls.
- Avoid triggering heavy sync, outbox, or worker behavior when the test only needs permission coverage.
- Avoid near-timeout behavior in normal local runs.

### Runtime/smoke gate

Command:

```bash
npm run verify:release:runtime
```

What it does:

- Starts built API, worker, and admin-web preview processes.
- Checks `/health`, `auth`, exceptions, and owner-command runtime routes.
- Writes a runtime smoke attestation to `.codex-artifacts/release-runtime-smoke.json`.

Purpose:

- Proves the built app boots and core runtime surfaces respond.

### Pilot smoke gate

Command:

```bash
npm run smoke:pilot
```

What it runs:

- Jobs smoke tests.
- Workflow smoke tests.
- Exceptions smoke tests.
- My Work smoke tests.
- Portal smoke tests.
- Microsoft smoke tests.

Purpose:

- Proves pilot/demo-critical flows remain operational.

### Pilot mode gate

Command:

```bash
npm run verify:pilot-mode
```

What it runs:

- Clean git preflight.
- Release build gate.
- Release test gate.
- Pilot smoke gate.
- Runtime smoke gate.
- Final clean git check.

Purpose:

- Proves a clean commit candidate is safe for pilot/demo review.

## Known Fragile Areas Rebuilt

### Concierge Search

Issue:

- Contact lookup search was close to the 5 second timeout under local data volume.

Fix:

- Contact lookup intent now bounds the candidate search to organization/contact records unless the caller provided an explicit entity filter.
- Manager-only comment coverage now searches comment records directly instead of exercising a broad global query path.

### Operational Intelligence Phase G8

Issue:

- The repeated missed clock-in report test inserted `work_shift` rows even though the route behavior under test only needed attendance exception patterns.
- `work_shift` writes trigger unrelated global indexing and side effects.

Fix:

- The test now inserts test-owned `attendance_exception` rows directly with the required tenant, shoot, user, status, and classification context.

### Production Projects

Issue:

- Reference data filtered linked locations and shoots by selected organization, but the selected organization itself was not guaranteed to appear in the first 120 organization rows.

Fix:

- The production reference data query now prioritizes the selected linked organization in the organization list before alphabetical ordering.
- Response shape is unchanged.

### Project Tracking Foundation

Issue:

- Repeated local runs accumulated stale command-center test jobs that polluted capped Command Center responses.

Fix:

- The Command Center ordering test now closes stale test-owned command-center jobs before creating a fresh scenario.
- The test resolves runtime workflow step ids from `workflow_step` rows instead of relying on template-derived ids.

### Schedule

Issue:

- The staffing-template permission test mutated the shared `DEMO-001` shoot.
- The break-deduction payroll test anchored to a shared demo shoot whose business date could differ from the test punch date.

Fix:

- The test now applies the staffing template to a fresh test-owned shoot created for that test.
- The payroll break-deduction test now uses a test-owned shoot dated to the scenario so canonical payroll and legacy time-entry assertions use the same pay period.

### Route Permissions

Issue:

- The schedule/integration/sync permission route test timed out during the full release run while a dev API/worker/web stack was still running locally.
- Direct execution passes when the test environment is clean.

Release rule:

- Do not run release gates while the local dev stack is running.
- Permission tests that need sync or integration routes should assert permission and response contract without triggering unnecessary heavy sync side effects.

### Urgent Watch / Exceptions

Issue:

- The exceptions smoke test repeatedly reconciled thousands of active local urgent-watch rows.
- Unchanged rows were refreshed every reconcile, which cascaded through global search indexing and pushed the smoke test past timeout.
- The workspace read accepted a `date` parameter but did not use it, so dated requests still loaded every active watch row.

Fix:

- Unchanged urgent-watch rows now refresh `last_seen_at` at most once every 15 minutes and no longer churn `updated_at`.
- Dated urgent-watch workspace requests now scope active items to the requested 30-day window while still surfacing undated operational issues.
- No urgent-watch or exceptions coverage was quarantined.

## Quarantine Policy

No tests are quarantined by default.

A quarantine candidate must be:

- Not pilot-critical.
- Documented with the reason, risk, and owner.
- Still runnable through a focused command.
- Explicitly approved before being removed from release-blocking validation.

Core tests that should generally remain release-blocking:

- Schedule.
- Permissions.
- Project Tracking.
- Client Command Center.
- Workflow/template behavior.
- Operational Intelligence.
- Production Projects.
- Critical API contract tests.

## Adding DB-Backed Tests

Use this checklist before adding a DB-backed release test:

- Create records with a unique test marker or capture inserted ids.
- Prefer fresh test-owned records over shared demo records.
- Clean up only test-owned rows.
- Scope reads by tenant and the record ids created by the test.
- Avoid relying on ambient local data volume or current wall-clock side effects.
- Avoid broad deletes from shared tables.
- Avoid broad app event or audit JSON scans if an exact id lookup is available.
- Avoid real Redis, Microsoft Graph, email, Teams, Outlook, or worker side effects unless that specific integration behavior is the test subject.
- If testing permissions, prefer focused route assertions over broad workflow execution.

## Fresh DB Contract

After migrations and reference seed, a local DB should satisfy the platform contract:

```bash
npm run db:migrate
npm run db:seed
npm run verify:fresh-db-contract
```

This verifier is release-supporting rather than a replacement for the release gate. It proves local reference data, dev-login users, health, and core feature flags are present without relying on accidental ambient rows.

## Demo Data Rule

Demo data is not test data. Use demo-owned seed commands such as:

```bash
npm run seed:mission-control-demo
```

Tests must not rely on those demo rows. If a test needs data, create test-owned fixtures and clean them up by inserted ids or unique markers.

## Focused Commands

Known fragile-area focused tests:

```bash
npm run test -w packages/api -- conciergeSearch.test.ts
npm run test -w packages/api -- operationalIntelligencePhaseG8.test.ts
npm run test -w packages/api -- productionProjects.test.ts
npm run test -w packages/api -- projectTrackingFoundation.test.ts
npm run test -w packages/api -- schedule.test.ts
npm run test -w packages/api -- schedulingAttendance.test.ts
npm run test -w packages/api -- routePermissions.test.ts
npm run test -w packages/api -- urgentWatch.test.ts
```
