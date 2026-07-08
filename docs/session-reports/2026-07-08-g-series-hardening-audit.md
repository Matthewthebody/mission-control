# Mission Control — G-Series Hardening Program: G1 Part 1 Audit & Roadmap Ledger

**Date:** 2026-07-08
**Branch:** `feature/work-spine-foundation-v1`
**Scope of this report:** G1 Compliance Workspace audit (read-only), the G1–G7 roadmap ledger, the compliance source-of-truth map, the labor/payroll stream relationship map, and the proposed G1 Part 2 contract. Documentation only — no code changed.

---

## 1. Repo / session context

| Item | Value |
|------|-------|
| HEAD at audit time | `7cdc085` — "Add Phase 6A Schools Leadership closure report" (Phase 6A chain `7e484ac..7cdc085` intact; nothing pushed) |
| Working tree | **Dirty — entirely the concurrent labor/payroll stream (category B).** No Phase 6A file dirty; no unknowns. |
| Labor/payroll stream status | **C — still dirty and still actively growing.** During this audit window it advanced to its own *phase 2*: migration `166_labor_command_center_phase2.sql` (bi-weekly payroll calendar config with explicit "NEEDS BUSINESS VERIFICATION" markers, `owner_review` lifecycle status, pay codes, no-break manager approval, 38h company warning threshold + jurisdiction hook), `services/payrollAlerts.ts` (owner-only alert fan-out, deduped), and a `payroll_alert` type added to the existing Teams-webhook operational-alert governance. Earlier in the session it added owner-only `canFinalizePayroll` + `OWNER_ONLY_TRANSITIONS`. **Do not land, isolate, or edit it from this stream; it has a live author.** |
| Migration head | 164 committed; 165 + 166 uncommitted (labor stream; 165 already applied to the local dev DB) |

---

## 2. Headline finding — G1 is EXTEND, not BUILD

A Compliance Workspace **already exists end-to-end** and already enumerates most of the target issue types:

- **Service:** `packages/api/src/services/complianceWorkspace.ts` (~1,840 lines): `listComplianceWorkspaceItems` (:1228) + `getComplianceWorkspaceItemDetail` (:1763). Items are **derived at read time** by unioning three stored sources (:867-907): `time_clock_compliance_flag`, `attendance_exception`, `time_clock_presence_incident`.
- **Route:** `GET /api/compliance/workspace` + `GET /workspace/:sourceKind/:sourceId` (`routes/compliance.ts:30,89`), mounted at `/api/compliance` (`app.ts:206`).
- **UI:** `admin-web/src/pages/Compliance.tsx` at **`#employees/compliance`** (aliases `#compliance`, `#needs-attention`; nav route id `people-ops-compliance`).
- **Gates:** feature flag `complianceWorkspaceV1` (default on) + `canViewComplianceWorkspace` authz.
- **Actions already wired:** approve/reject for no-lunch challenges and missed-punch requests (via `POST /api/attendance/exceptions/:id/review` and `/missed-punches/:id/review`); escalate-in-attendance for presence incidents; auto-resolve semantics on compliance flags.

**G1's real work:** leadership framing + coverage gaps + aggregation unification — not a new workspace. Building `GET /api/compliance/workspace` from scratch would have duplicated a live, tested system (exactly what this audit-first slice exists to prevent).

---

## 3. Compliance issue-type source map

Legend: STORED = has its own row/status columns; DERIVED = computed at read time.

| Issue type | Source of truth | Stored? | Status model | Blocks | Existing action | Gap for G1 |
|---|---|---|---|---|---|---|
| Missing setup photo | `time_clock_compliance_flag` item_type=`missing_setup_photo` (migration 039; writer `timeClockCompliance.ts:497` from post-shoot eval flow) | STORED | open/resolved + resolution_note; severity warning/high | review | auto-resolve when satisfied | none — surface as-is |
| Missing post-shoot evaluation | same flag table, item_type=`missing_post_shoot_evaluation`; underlying `post_shoot_evaluation` (032) | STORED | open/resolved; severity high | shoot close / mileage | auto-resolve on submit | none |
| Mileage blocked by missing eval | same flag table, item_type=`mileage_blocked_missing_post_shoot_evaluation`; gate = `mileage_reimbursement.status='review_required'` + `review_reason_code='missing_post_shoot_evaluation'` | STORED | open/resolved | **mileage** | auto-resolve | none |
| Upload while off clock | same flag table, item_type=`upload_while_off_clock` (writer `resourceLibraryUploads.ts:152`) | STORED | open/resolved; severity warning | review | none dedicated | consider explicit "reviewed" action (needs status-model support — G1 Part 3 candidate) |
| Unresolved end-of-day confirmation | same flag table + `time_session.status='needs_end_of_day_confirmation'` (writer `timeClockRuntime.ts:2197`) | STORED | open/resolved; severity high | **payroll** | drill to Payroll Review | none |
| No-lunch challenge | `attendance_exception` type `NO_LUNCH_CHALLENGE` + payroll mirror `lunch_challenge_status` on `time_session_payroll_summary` (038) | STORED | exception_request_status enum | payroll | **approve/reject wired** | labor stream's migration 166 adds "manager approved no break" — coordinate, don't duplicate |
| Missed clock-in request | `attendance_exception` (missing_direction=in) + `exception_request` request_type=`missing_clock_in` (034) | STORED | submitted/under_review/approved/rejected/cancelled + approval_record | payroll | **approve/reject wired** | none |
| Likely present / assigned-but-missing | `time_clock_presence_incident` (035; worker `attendanceMonitor.ts`) | STORED | resolution_status open/resolved + geofence classification | trust | escalate-in-attendance | in-workspace resolve absent (status model supports it — Part 3 candidate) |
| Manual time adjustment | **NO standalone issue type** — only `manual_correction_count` on `time_session_payroll_summary`; underlying edits are `exception_request` types `time_segment_correction`/`work_state_change` | partial | n/a (count) | payroll visibility | none | **G1 gap #1: derive a first-class item from exception_request correction types** |
| Mileage exception | `mileage_reimbursement` (037) status enum `candidate/review_required/ineligible/approved/exported/cancelled` + `review_reason_code` | STORED | full approval states | **mileage** | mileage review flows | **G1 gap #2: `review_required` mileage rows are not in the workspace union** |
| Payroll blockers / overtime warnings / self-check status / period readiness / QuickBooks readiness | labor stream (uncommitted): `payroll_period` blocker counts, `overtime_warning`, `payroll_self_check(_item)`, `quickbooks_connection` (165/166) | STORED | full lifecycles | **payroll** | Labor Command Center owns them | **G1 gap #3: after the labor stream lands, surface as LINKED categories (deep-link to `#labor/command-center`), never re-implemented** |

**Unavailable-source rule:** any category whose source is not yet landed (all labor-stream categories) or not connected must render as *unavailable + reason* — never a zero. This matches the Phase 6A / Schools Leadership contract precedent.

---

## 4. Aggregation systems — the unification decision

Two disjoint aggregators exist today and **do not share storage**:

| System | Storage | Scope | Lifecycle | Actions |
|---|---|---|---|---|
| Exception Center / Urgent Watch (`urgent_watch_item`, migration 078; `/api/exceptions`, `/api/watch`) | STORED rows | production / workflow / scheduling (watch_types: blocked_production_work, overdue_production_task, pending_peer_review, final_qc_waiting, release_blocker, stale_production_work, production_intake_issue, missing_acknowledgement, calendar_sync_attention) | active/snoozed/handled/resolved + events | snooze/handle/resolve |
| Compliance Workspace (`complianceWorkspace.ts`; `/api/compliance/workspace`) | DERIVED union over 3 stored tables | time-clock / attendance / accountability | per-source statuses | approve/reject/escalate + auto-resolve |

**Recommendation (G1 decision to confirm with owner):** keep them separate. The Exception Center is operational work-risk; the Compliance Workspace is people/payroll/mileage accountability. Forcing compliance flags into `urgent_watch_item` would create a second copy of stored state that `timeClockCompliance.ts` already lifecycle-manages (the "no parallel store" rule). The leadership need is a **leadership lens over the existing compliance read model**, plus links out to Exception Center and Labor Command Center where those own the record.

---

## 5. Canonical vs legacy findings (feeds G2)

| Domain | Canonical | Legacy | Live risk |
|---|---|---|---|
| Labor time | `time_session` / `time_segment` / `clock_event` (034) + `time_session_payroll_summary` (038) | `time_entry` (003/015) — **still dual-written** by `attendance.ts` (:801 insert on clock-in; :729/:844/:3853 updates) and still read by `clock.ts`, `dashboard.ts`, `scheduling.ts`, `timeClockPayroll.ts:340`, `Attendance.tsx`, and the job-truth view (089:602) | **High.** Anything built on canonical sessions diverges from legacy readers. G2's core job. |
| Mileage | `mileage_reimbursement` + `_source` (037) — full status/approval model; `services/mileage.ts:41` self-declares `source_of_truth: "canonical_mileage_reimbursement"` | `mileage_claim` (003) — still written by the legacy shoot-scoped submit endpoint, which immediately syncs canonical (declared legacy-compat at `mileage.ts:92`) | **Medium.** Dual-write is at least synchronized; retire the legacy submit path in G2. |
| Payroll periods | `payroll_period` + lifecycle (labor stream 165/166, uncommitted) | ad-hoc Monday–Sunday windows computed per request (`timeClockPayroll.getPayPeriod`) | Owned by the labor stream; G2 confirms the calendar config against business truth ("NEEDS BUSINESS VERIFICATION" markers in 166). |

---

## 6. Labor/payroll stream relationship map (audited at ~11:24–11:36, in flux)

| Area | State | G-series owner |
|---|---|---|
| Labor Command Center (`/api/labor/command-center`, `#labor/command-center`, `canReviewTeamTime`/`canManagePayrollPeriods`) | Coherent read model + lifecycle console; canonical sources; honest QuickBooks not-connected | Stays its own surface; G1 links to it |
| Payroll Self Check (`#my-work/payroll-self-check` + MyWork card; self-scoped; discrepancies spawn canonical `exception_request`) | Coherent; employee/manager verification | Stays its own surface; G1 links to it |
| Overtime engine + persisted `overtime_warning` | Coherent; minutes-only, policy-layered | G1 linked category post-landing |
| Payroll periods + `guardSessionMutationForPayroll` + owner-only finalization (`canFinalizePayroll`, `OWNER_ONLY_TRANSITIONS`, 166 `owner_review`) | In active development **right now** | G3 territory (review tools) — already largely being built by the stream |
| QuickBooks scaffolding (no live calls, CSV export only, honest not_connected) | Coherent scaffold | Live sync explicitly out of G-series until credentials/idempotency/tests |
| `payrollAlerts.ts` + `payroll_alert` operational-alert type | New, owner fan-out, deduped, Teams-governed | G4-adjacent but landing with the stream; G4 should reuse this pipeline, not invent one |
| Worker `laborMonitor` (60s sweep; reminder ladder; spam-controlled) | Coherent | G4 pattern precedent |
| Test `laborCommandCenter.test.ts` | 11/11 after my env-isolation fix (parks/restores demo blockers); **invalidated again by the in-flight owner-only lock change** — the author must switch lock steps to an owner token | Stream owner |

**Duplication check:** the stream does **not** duplicate the future Compliance Workspace — it owns payroll operational status; the Compliance Workspace owns cross-domain accountability exceptions. The one seam: migration 166's "manager approved no break" outcome touches the no-lunch flow that the Compliance Workspace also actions — G1 Part 2 must read whatever lands and reuse its status vocabulary.

---

## 7. Proposed G1 Part 2 contract (delta, not greenfield)

Extend the existing `GET /api/compliance/workspace` (or add a sibling `?lens=leadership` / `/workspace/leadership` view) with:

1. **Leadership summary block:** `payroll_blocking_count`, `mileage_blocking_count`, `needs_manager_review_count`, `needs_employee_correction_count`, `overdue_count`, `resolved_today_count` — every count equal to its filtered rows (Phase 6A invariant).
2. **Two new derived categories:** manual time adjustments (from `exception_request` correction types) and mileage `review_required` rows (from `mileage_reimbursement`).
3. **Linked-category stubs** for labor-stream sources with `available:false + reason` until that stream lands, then `available:true` + deep links (`#labor/command-center`, `#my-work/payroll-self-check`) — never re-implemented counts.
4. **Item contract additions** where missing: `blocks_payroll` / `blocks_mileage` / `blocks_shoot_close` booleans, `urgency` + `time_state`, `exact_destination_hash` + `focus_reason` + `can_act`/`primary_action` (destinations must be verified to actually focus — Phase 6A Part 4 lesson).
5. **Pay-period scoping:** filter by the labor stream's `payroll_period` once landed; until then, the existing week window with an honest label.

**Permission model:** read = existing `canViewComplianceWorkspace`; leadership lens adds no new write paths in Part 2. Actions remain the *existing* wired ones (approve/reject/escalate); "mark reviewed" only where a status model already supports it. No new irreversible actions.

**UI shape (G1 Part 3, after Part 2):** extend `Compliance.tsx` (or a leadership variant of it) — top cards for the six summary counts, grouped inbox by urgency/type, filters (pay period / today / week / overdue / payroll-blocking / mileage-blocking / employee / type), row cap with true-total disclosure, honest unavailable states. Route/nav/permission/resolveRouteId/SECTION_CHILD_ORDER discipline per the Phase 6A checklist if any new route is added (prefer reusing `#employees/compliance`).

---

## 8. G-Series roadmap ledger

| Phase | Name | Purpose | Current repo evidence | Depends on | Not in scope | Recommended first slice | Status | Risks |
|---|---|---|---|---|---|---|---|---|
| G1 | Compliance Workspace | Leadership exception inbox | **Exists** (`complianceWorkspace.ts`, `/api/compliance/workspace`, `Compliance.tsx`, flag+authz); gaps: manual-adjustment type, mileage review_required, labor-stream linked categories, leadership summary | labor stream landing (for linked categories only) | payroll review (G3), QuickBooks sync, background reminders (G4), pattern scores (G6) | Part 2: extend the read model per §7 | **Audit complete (this doc); Part 2 ready** — linked categories blocked on labor stream landing | live labor stream churn; no-lunch status vocabulary seam with 166 |
| G2 | Canonical labor + mileage consolidation | One truth path | `time_entry` still dual-written + widely read (§5); `mileage_claim` legacy submit still writes; payroll calendar "NEEDS BUSINESS VERIFICATION" | labor stream landed | destructive migration of history | read-only divergence audit: canonical vs legacy totals per employee/period | Not started | legacy readers (dashboard/scheduling/job-truth view 089) are load-bearing |
| G3 | Payroll + mileage review tools | Managed review workflow | Largely being built by the live labor stream (periods, lock, export CSV, owner_review, pay codes) | G2 truth clarity; labor stream landed | live QuickBooks sync; new irreversible finalization beyond the stream's owner gate | after stream lands: gap audit against the stream (mileage reconciliation view is the clearest missing piece) | In progress (by the concurrent stream) | duplicating the stream's work; export before G2 reconciliation |
| G4 | Background automation + reminders | Alive, not screen-dependent | `laborMonitor` (60s, spam-controlled), `payrollAlerts` fan-out, `exception-reconcile` worker precedent, `attendanceMonitor` presence sweep | stable status models (G1/G2) | new notification channels | reminder-candidate inventory from G1 categories (setup photo, EOD confirmation) reusing the laborSweep ladder pattern | Not started | reminder spam; duplicate pipelines |
| G5 | Resource Library hardening | Trustworthy permissioned assets | `resourceLibraryUploads.ts` exists (writes `upload_while_off_clock` flags); record-resources routes exist — note pre-existing 403s for director_admin observed 2026-07-08 (service-layer gating; unexplained product intent) | independent after G1 | — | audit of upload approval states + the 403 gating intent | Not started | unclear current permission intent |
| G6 | Pattern reporting | Predict pain | inputs exist (compliance flags, presence incidents, evals, urgent watch) but no scoring layer | G1/G2 consolidation | building on unconsolidated truth | repeated-incident report over `time_clock_compliance_flag` history | Not started | premature scoring on dual-truth data |
| G7 | UX/performance hardening | Stability + velocity | known: Vite chunk warnings, admin-web parallel-test flake (serial required), `limit: 250` vs 200-max validation bug (`JobOperationalCommandPanel.tsx:164`, baseline `308a3c8`), `/api/jobs/:jobId` non-uuid 500, urgent-watch `#scheduling` non-focusing destinations, transient unmount fetches from SharedJobDetailPage | anytime for small fixes | broad refactors | the three one-liners above as a single small commit | Not started | scope creep |

---

## 9. Risks & blockers

1. **Live labor/payroll stream (top blocker):** still uncommitted, still growing (now phase 2, migrations 165+166). Nothing in G1 Part 2 that depends on its tables may build until it lands. The stream's own test is currently invalidated by its in-flight owner-only lock change. **The branch is not push-safe until it lands.**
2. **Legacy dual-truth:** `time_entry` and `mileage_claim` are still written; any new compliance/payroll computation must state which truth it reads (canonical) and G2 must reconcile.
3. **No-lunch vocabulary seam:** migration 166 adds a manager-approval outcome for no-break claims; the existing Compliance Workspace actions the same flow. G1 Part 2 must adopt whatever lands.
4. **Pre-existing defects to fold into G7:** record-resources/communications/approvals 403s for director_admin (intent unclear), workflows command-center `limit` bug, non-uuid job id 500, urgent-watch `#scheduling` destinations that never focus.
5. **Deferred work order:** a KemmGrade / Shoot Truth V1 autonomous build block was issued alongside this task; it targets a different repo (`C:\Dev\kemm-grade`) and is deferred to its own session.

---

## 10. Next prompt (G1 Part 2 — run after the labor/payroll stream lands, or run now with linked categories stubbed unavailable)

> G1 Part 2 — extend the existing Compliance Workspace read model for the leadership lens. Repo `C:\Dev\Codex-integrated-baseline-clean`, branch `feature/work-spine-foundation-v1`. Audit doc: `docs/session-reports/2026-07-08-g-series-hardening-audit.md`. Do NOT build a new workspace: extend `services/complianceWorkspace.ts` + `GET /api/compliance/workspace` (route `routes/compliance.ts`) behind the existing `complianceWorkspaceV1` flag and `canViewComplianceWorkspace` gate. Add: (1) leadership summary counts (payroll_blocking, mileage_blocking, needs_manager_review, needs_employee_correction, overdue, resolved_today) with count==rows invariant; (2) a derived manual-time-adjustment item type from `exception_request` types `time_segment_correction`/`work_state_change`; (3) mileage `review_required` items from `mileage_reimbursement`; (4) `blocks_payroll`/`blocks_mileage`/`blocks_shoot_close` + `exact_destination_hash`/`focus_reason`/`can_act`/`primary_action` on every item (verify destinations focus — Phase 6A Part 4 lesson); (5) labor-stream categories as available:false+reason until landed, then linked (never re-implemented). No new write paths; existing approve/reject/escalate only. Tests: extend the compliance API tests with the count==rows invariant, the two new item types, unavailable-category honesty, and RBAC. No UI this part.

---

*Audit only — no product code changed. The only file in this commit is this document.*
