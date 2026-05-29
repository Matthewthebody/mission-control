# Performance Budgets

These are V1 targets for Mission Control. They are not hard build failures yet because local machines and DB state vary, but they give us a shared definition of "healthy enough to demo."

## Runtime Targets

| Surface | Target seeded response |
| --- | --- |
| Project Tracking Command Center | under 750ms |
| Workflow Map drill-in | under 750ms |
| Job Closeout create/submit | under 500ms |
| Compliance Workspace | under 1000ms |
| Global search | under 500ms |
| Owner command/dashboard runtime | under 1000ms |
| `/api/exceptions` | under 1000ms seeded |

## Test Targets

| Gate/Test | Target |
| --- | --- |
| individual fragile focused API test | under 5s unless documented |
| `smoke:pilot` | under 5 minutes |
| `verify:release:test` | under 30 minutes short-term |
| `verify:release:test` | under 20 minutes longer-term |
| `verify:pilot-mode` | stable enough to run before pilot review |

## Known Slow Areas

- `jobTruthLayer.test.ts`
- `urgentWatch.test.ts`
- broad Concierge/global search paths
- `/api/exceptions` payload size
- owner-command/dashboard runtime response payloads
- Microsoft smoke tests, due integration fixture breadth

## Query Rules

- Tenant-scoped reads should include tenant filters even when RLS is expected.
- Dashboard/list endpoints should be paginated or capped.
- Search should bound result candidates before scoring.
- Tests should avoid creating large fixture volumes unless volume behavior is the point.
- Avoid N+1 route behavior in command-center and detail pages.

## Safe V1 Enforcement

For now:

- Log slow queries through existing DB slow query diagnostics.
- Document observed slow endpoints in release reports.
- Add performance assertions only for extreme regressions, not tight local thresholds.

Future:

- Add a stable performance smoke command with broad thresholds.
- Capture p50/p95 from runtime smoke artifacts.
- Track search index freshness and outbox lag as health signals.
