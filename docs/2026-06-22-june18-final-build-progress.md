# June 18 Final Build — Progress Log

Bounded-slice progress for the final June 18 completion program. Newest first.

---

## Slice — Production / Graphics operating UI (Slice 1)

- **Commit:** (this commit) `feat: complete production graphics operating view`
- **Completed slice:** Slice 1 — dense Production operating UI over `GET /api/production/operations`.
- **Files:** `packages/admin-web/src/services/productionOperationsApi.ts` (client + metric labels +
  metric→stage map); `packages/admin-web/src/pages/ProductionOperationsView.tsx` (dense tracker +
  metric chips + URL-backed stage filter + quick-view drawer); `navigation.ts` (render kind +
  `#production/operations` route); `app.tsx` (lazy + dispatch);
  `tests/productionOperationsView.test.tsx`.
- **Runtime behavior:** React never re-totals — metric chips show the server's filtered totals;
  clicking a chip URL-filters the table by the canonical stage (Back/Forward + refresh restore via
  the hash). Dense table shows work item / stage / **live workflow step** / owner (Unowned pill) /
  due / next action / missing inputs / blockers / risk. Row → in-viewport quick-view drawer
  (Production Truth Snapshot: exact step, exact blocker, missing inputs, approval, owner, due, risk,
  next action, age, source id, **Open Full Record** → exact destination). Honest error (no demo
  fallback) + empty states; no placeholder mutation buttons.
- **Migration/data impact:** none (read-only over the committed endpoint).
- **Tests:** `productionOperationsView` **5/5** — metric chips + dense rows + live step, chip
  URL-filters by stage, quick-view drawer w/ exact blocker + source + full-record link, honest error
  (no fabricated rows), honest empty. tsc + vite build clean. Fixed a cross-file hash-state leak
  (afterEach resets `window.location.hash`); admin-web pair re-run 38/38.
- **Browser verification:** pending (the live `#production/operations` route + Company Command
  "Production Load" deep link are the next slices).
- **Limitation:** safe in-drawer Production mutations (e.g. assign owner) are not yet wired — the
  drawer is read + navigate today; Company Command "Production Load" integration is Slice 2.
- **Exact next slice:** Slice 2 — wire Company Command "Production Load" to the same predicate +
  open `#production/operations?stage=...`; then Slice 3 — Shoot date-change UI.

---

## Slice — Canonical Production / Graphics operating read model (backend)

- **Commit:** (this commit) `feat: add canonical production operating read model`
- **Completed slice:** Part 1 backend — Production operating read model over `production_project`.
- **Files:** `packages/api/src/services/productionOperations.ts` (metrics + dense rows + stages);
  `packages/api/src/routes/productionOperations.ts` (`GET /api/production/operations`); `app.ts`;
  `tests/productionOperations.test.ts`.
- **Runtime behavior:** one server-side aggregate. Metrics (ready_to_delegate, working, blocked,
  unowned, behind_promised_delivery, missing_inputs, delivery_risk, done_recently) are each a scoped
  COUNT(*) over an explicit predicate — **displayed count === filtered total**. Dense rows are a
  single query (no N+1), deterministically sorted (blocked → due → priority → id), bounded page.
  Status → normalized stage (To Delegate/Ready · Working · Waiting · Review · Delivery/Launch · Done);
  "Working" exposes the current live step (the active `production_project_task`). Scope: leadership =
  all; otherwise own (owner_user_id = self); 401 unauthenticated.
- **Migration/data impact:** none (read-only over existing canonical tables).
- **Tests:** `productionOperations` **5/5** — metrics+rows+pagination, metric==predicate-total
  invariant (blocked/working/unowned re-derived), row contract + exact destination, deterministic
  pagination, 401. tsc clean.
- **Browser verification:** pending (the dense Production UI is the next slice).
- **Limitation:** the Production UI (dense tracker + quick-view + Company Command "Production Load"
  deep link) is not yet built; the canonical read model + metric invariant + contract are complete.
- **Exact next slice:** Production UI over this read model (`packages/admin-web` Production surface),
  then the Shoot date-change UI deep links.

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
