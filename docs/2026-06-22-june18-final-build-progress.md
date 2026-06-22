# June 18 Final Build — Progress Log

Bounded-slice progress for the final June 18 completion program. Newest first.

---

## Slice — Cross-surface metric consistency (Slice 6 of run 2)

- **Commit:** (this commit) `test: enforce june 18 cross-surface metric consistency`
- **Completed slice:** a reusable contract suite proving `displayed count === filtered row total`
  across the canonical read models.
- **Files:** `packages/api/tests/metricConsistency.test.ts`.
- **Runtime behavior:** test-only (no product change). Re-derives each **Production** metric predicate
  directly against `production_project` and asserts equality with the served count; asserts a zero
  metric is a real numeric 0 (never null/disabled); asserts **Schools Leadership** available
  `count === issues.length` and unavailable `count === null` + reason (never zero-as-live); asserts
  scope/tenant deny an unauthenticated request (401) rather than returning a zeroed count; asserts a
  bounded page never lets an absent source inflate the total.
- **Migration/data impact:** none.
- **Tests:** `metricConsistency` **5/5** (Production metric==predicate-total, numeric-zero, Schools
  count==rows + unavailable-null, 401-not-zeroed, page-bounded).
- **Browser verification:** n/a (server-contract suite).
- **Limitation:** covers the two canonical read models with explicit metric contracts (Production,
  Schools Leadership). Company Command / Staffing / Capacity / Jobs cards derive from job-status and
  exception counts already individually tested; folding them into this same harness is a follow-on.
- **Exact next slice:** Slice 5 — API test-runner hardening (trustworthy exit status + per-file
  summary; do not edit mileage) and the runtime debug sweep.

---

## Slice — Final Weather + Client Issues honesty (Slice 3 of run 2)

- **Commit:** (this commit) `fix: keep weather and client issues honestly unavailable`
- **Completed slice:** Weather and Client Issues are honestly unavailable everywhere on the home.
- **Files:** `home/WeatherImpactPanel.tsx` (rewritten); `test/weatherClientIssuesHonesty.test.tsx`.
- **Runtime behavior:** the Weather Impact panel previously rendered **demo forecast rows with a
  count badge** (with a "sample data" note). It now renders a single honest "Weather provider not
  connected" state — **no count, no fabricated forecast rows, no drilldown/CTA, no demo fallback** —
  and documents the future integration requirements in-file (provider, credentials, canonical Shoot
  coordinates, freshness, cache, stale/error, affected-Shoot derivation, thresholds). Travel-pressure
  signals are explicitly never shown here as weather. The Company Command **Weather** card
  (`weather-watch`) and **Client Issues** card were already unavailable targets (disabled "Not
  connected", value "—", no route) — now covered by tests so they can't regress to a fake count or a
  generic Client Success route.
- **Migration/data impact:** none.
- **Tests:** `weatherClientIssuesHonesty` **3/3** (panel not-connected + no count/rows/link; weather
  card unavailable; client-issues card unavailable, no generic route). Regression: dashboard +
  weather suite 14/14; vite build clean.
- **Browser verification:** pending (Company Command live render of the not-connected states).
- **Limitation:** `DEMO_WEATHER_IMPACT` remains exported in homeDemoData (now unused by the panel);
  left in place to avoid touching unrelated references — safe to remove in a later cleanup.
- **Exact next slice:** Slice 4 — cross-surface actionability audit artifact
  (`docs/artifacts/june18-action-and-runtime-audit.json`) + deterministic fixes.

---

## Slice — Shoot date-change workflow UI (Slice 2 of run 2)

- **Commit:** (this commit) `feat: add shoot date change operating workflow`
- **Completed slice:** user-facing date-change workflow over migration 164 / `43de7dd`, reachable
  from the Shoot detail drawer.
- **Files:** `services/dateChangeApi.ts` (client for create/list/detail/feasibility/alternatives/
  transition/decision); `components/schedule/DateChangeRequestPanel.tsx` (create form + request list
  + detail + lifecycle actions + history); `components/ShootDetailDrawer.tsx` (renders the panel for
  any dated shoot, `canApprove` = `canApproveOperationalExceptions`); `test/dateChangeRequestPanel.test.tsx`.
- **Runtime behavior:** original booked date is **read-only**; submitting calls the request endpoint
  (never a shoot-date mutation); the detail shows status, both dates, staffing/capacity/conflict
  feasibility, **equipment honestly "Unavailable (no canonical source)"**, decision, final date, and
  the full transition history. Lifecycle actions (Run feasibility, Record alternative, Await client,
  Approve/Decline [leadership-only], Cancel) call the guarded backend and refresh from the
  authoritative response. Errors are honest; no placeholder buttons.
- **Migration/data impact:** none (consumes migration 164).
- **Tests:** `dateChangeRequestPanel` **4/4** — read-only original + create-without-mutation, list+
  detail + equipment-unavailable honesty, leadership-only approve vs non-approver, run feasibility.
  tsc + vite build clean.
- **Browser verification:** pending (live create→feasibility→approve in the Shoot drawer).
- **Limitation:** wired into the Shoot detail drawer this slice; the additional entry points
  (Team Schedule indicator/link, Schools Leadership, CSR, Urgent Window deep links carrying the
  `shoot_date_change_request.id`) are the next wiring step.
- **Exact next slice:** Slice 3 — Team Schedule acceptance (incl. an active-date-change indicator +
  exact request link), reusing the canonical Capacity service.

---

## Slice — Company Command Production Load → canonical Production truth (Slice 1 of run 2)

- **Commit:** (this commit) `fix: connect company command production load to canonical work`
- **Completed slice:** Company Command "Production Load" now uses the canonical Production read model.
- **Files:** `home/CompanyCommandHome.tsx` (new `useProductionBlockedCount` hook → `getProductionOperations`
  "blocked" metric; honest error copy points to Production); `home/homeDemoData.ts` (card target →
  `{ sourceType:"production", focus:{ stage:"blocked" } }`); `home/actionTargets.ts` (`production`
  route → `#production/operations`); `test/companyCommandJobCards.test.tsx` +
  `test/dashboardPersonalization.test.tsx` (updated to the canonical contract).
- **Runtime behavior:** the Production Load count is the Production read model's **blocked** metric —
  the SAME predicate as `#production/operations?stage=blocked` — so **card count === Production
  filtered total**. The card opens that exact filtered view. Error → "Live count unavailable — open
  the Production queue." (no demo fallback); zero → honest empty copy.
- **Migration/data impact:** none.
- **Tests:** `companyCommandJobCards` 4/4 (canonical count, exact Production destination, honest
  unavailable, honest zero) + `dashboardPersonalization` 15/15 (now 3 live calls incl.
  `/api/production/operations`). vite build clean.
- **Browser verification:** pending (live Company Command → Production Load click-through).
- **Limitation:** other Company Command live cards (Staffing Risk, Late/Not-Clocked-In, Shoots Today)
  were not re-pointed this slice — only Production Load was the documented mismatch.
- **Exact next slice:** Slice 2 — Shoot date-change UI + deep links over migration 164 / `43de7dd`.

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
