# June 18 Final Build — Progress Log

Bounded-slice progress for the final June 18 completion program. Newest first.

---

## Slice — Auditable Shoot date-change workflow (backend)

- **Commit:** (this commit) `feat: add auditable shoot date change workflow`
- **Completed slice:** Part 3 backend — canonical, auditable Shoot date-change workflow.
- **Files:** `db/migrations/164_shoot_date_change_request.sql` (new tables `shoot_date_change_request`
  + append-only `shoot_date_change_event`, RLS-forced, CHECK-constrained, idempotency unique index);
  `packages/api/src/services/shootDateChangeRequest.ts` (create / feasibility / alternatives /
  transition / decide / get / list); `packages/api/src/routes/shootDateChange.ts`; `app.ts`
  (registered `/api/shoots/date-change-requests`); `tests/shootDateChangeRequest.test.ts`.
- **Runtime behavior:** creating a request **never** mutates the Shoot; the booked date is captured
  immutably on the request + event log. Feasibility reuses canonical shoot/staffing data and reports
  equipment **honestly unavailable** (no canonical equipment source — never fabricated). Approval is
  leadership-gated, applies the change through the canonical shoot mutation, and **preserves the
  original date** in the request row + audit trail. Decline/cancel retain the request. Idempotent
  retry returns the existing request. Tenant-isolated (RLS + tenant-scoped lookups).
- **Migration/data impact:** migration head **163 → 164**, additive + reversible (DROP TABLE). No
  existing reader affected; no backfill.
- **Tests:** `shootDateChangeRequest` **8/8** — create-without-mutation, immutable original,
  idempotent retry, feasibility (equipment unavailable + staffing review_required), alternatives,
  leadership-gated decision (read-only 403), approval applies + preserves original + full audit
  events, decline retains, tenant isolation. Controlled shoot fixture, cleaned up (0 orphans). tsc clean.
- **Browser verification:** pending (UI deep-links from Schedule/Job/Urgent Window are the next slice).
- **Limitation:** UI surfaces + cross-surface deep links for the workflow are not yet built; the
  canonical model + lifecycle + audit + RBAC are complete and tested at the API layer.
- **Exact next slice:** add the date-change request UI + deep links (Team Schedule, Job/Shoot detail,
  Schools Leadership, CSR, Urgent Window), then the Production operating read model (Part 1).

---
