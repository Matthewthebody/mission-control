# Mission Control — School Season Autopilot Sprint 1: Three-Agent Audit & First Fixes

**Date:** 2026-07-08
**Branch:** `feature/work-spine-foundation-v1`
**Scope:** three parallel read-only audits (data spine · eval/mileage enforcement · Teams/chat + cleanup), one bounded fix commit, and the implementation roadmap for the sprint's remaining slices.

---

## 1. Session context

| Item | Value |
|------|-------|
| HEAD at sprint start | `c08e101` (G-series audit) |
| Mid-sprint event | **The labor/payroll stream LANDED** in 3 commits by its own session: `59ba411` (migrations 165–166 + /api/labor), `501fc35` (labor monitor worker), `d76bdcb` (Labor Command Center + Payroll Self-Check surfaces) |
| Sprint fix commit | `78f125d` — route resolution fall-throughs + command panel limit (staged surgically so the two streams' edits in shared files never mixed) |
| Working tree after | **CLEAN — first time today.** The branch is now gateable and push-decidable. |
| Validation of landed stream | api laborCommandCenter 13/13 · web labor pages 12/12 · web tsc 0 · api tsc 0 (pre-landing) |

---

## 2. Fixes shipped this sprint (`78f125d`, browser-verified live)

| Defect | Root cause | Fix |
|---|---|---|
| `#growth/*` deep-links → Home (Sales Pipeline/Renewals/Proposals CTAs) | `resolveRouteId` matched growth paths against sectionKey `"directory"`; growth routes live under `"leadership"` | one-argument fix |
| `#admin/review-tools` → Home | route lives in `hr-admin` behind an `#admin/` prefix; generic admin matcher can't find it | explicit case |
| `#production/operations` → Home (the Home "Production Load" action target) | **two** gaps: no resolver case AND no `canAccessRoute` case (default deny) | both added; gated like the sibling workflow queue |
| Job Detail command panel dead for all roles | `JobOperationalCommandPanel` sent `limit: 250` vs the route schema's 200 max → zod 400 | sends 200 |

New `navigationRouteResolution.test.ts` locks the resolutions (visibility-aware: `pickVisibleRoute` falls back to section siblings when required tabs are absent — tests must pass the routes' `visibleTabs`).

**Lesson reinforced:** a route needs the FULL checklist (ROUTES entry, dispatch, **permission case**, resolver case, section order). `production-operations` had been registered but unreachable — fixing the resolver *exposed* the missing permission case.

---

## 3. Agent 1 — Data spine findings (full report in session transcript)

- **No season object beyond `school_service_term`** (160). Season/year is re-entered free text in ≥4 places (`school_job_profiles.school_year`, `sports_job_profiles.season`, `shoot_sports_detail.season`, `dated_commitment.service_term.period_label`) — no FK anywhere.
- **Two disjoint intake paths**: canonical `jobs` (SharedJobEditorPage → jobService) vs legacy `shoot` spine (QuickCreateJobDrawer → centralJobIntake). Neither creates: shoot↔job link, real staffing, eval obligations, mileage, compliance records, or a chat/thread.
- **Authoritative assigned photographers = `shoot_assignment`** (003) on the shoot spine; `job_staff_assignments` (089) mirrors it for the ~300 canonical jobs only.
- **Top duplicate-truth risks:** location (4 copies), primary contact, season/year, org identity, staffing counts.
- **Season-autopilot derivability:** staffed/prep-packet/setup-photo/eval-completeness/mileage/compliance/production all derivable from the shoot spine; **gallery/launch and rebooking are UNAVAILABLE** (no state exists) — must render `available:false`.
- Recommended read model: per School × current `school_service_term`, shoot-spine projection reusing `schoolsLeadershipOperations` patterns (→ Sprint 2).

## 4. Agent 2 — Eval/mileage findings

- ⚠️ **TWO eval systems coexist**, both writing `post_shoot_evaluation`: the shift path (032, `postShootEvaluations.ts`, mobile modal, eval per (photographer, shift)) and **Job Closeout V1** (146, `jobCloseoutV1.ts`, jobs spine, role-tiered with `submitter_role` + per-role config).
- **The canonical mileage gate already enforces Matthew's rule** per photographer: `timeClockMileage.ts:478-482` → any worked shoot shift without that employee's own eval ⇒ `mileage_reimbursement.status='review_required'`, `review_reason_code='missing_post_shoot_evaluation'`; payroll counts only `candidate/approved/exported` as payable. **Do not rebuild.**
- **But "required" contradicts rule #1 today**: shift path requires the eval only for lead/senior (`requiresLeadCloseout`); V1 defaults associates to not-required (`JOB_CLOSEOUT_REQUIRE_ASSOCIATE_EVALUATION=false`). The missing piece is the **roster-diff obligation** (assigned-but-not-submitted is invisible unless lead).
- **Eligibility question already exists as an in-form field** (`submit_for_mileage`+`vehicle_type`; V1: `mileage_qualified`) — not a post-submit prompt.
- ⚠️ **Dual mileage truth risk:** V1 writes its own `job_closeout_mileage_review` and never feeds canonical `mileage_reimbursement` — payroll reads only the canonical one. Must reconcile before G3 approve/export (which today has **no writer** for `approved`/`exported`).
- **G1 Part 2 plan (file-exact, ready):** extend `complianceWorkspace.ts` enum+builders+summary; both zod lists in `routes/compliance.ts` (:43-53 AND the duplicated :69-78); `Compliance.tsx` absorbs new item types without UI change (actions/summary cards deferred). Tests enumerated.

### Policy questions for Matthew (blocking the eval-obligation slice)
1. **Which eval system is canonical going forward** — shift path (mobile) or Job Closeout V1 (jobs spine)? Everything hangs on this.
2. Associates literally required (rule #1 says yes — confirm the config flip / enforcement path)?
3. No-show/cancelled photographers: auto-excused?
4. Eligibility as in-form field (today) vs distinct post-submit prompt (rule #3 as stated)?
5. Is `job_closeout_mileage_review` meant to replace or feed canonical `mileage_reimbursement`?
6. Mileage approve/export = strictly G3?

## 5. Agent 3 — Teams/chat + cleanup findings

- **Teams integration is real and layered**: outbound webhook alerting (110 governance); Graph message send via outbox→worker (`teams_communication_delivery`); **Graph meeting creation returning `joinUrl`** (`POST /api/communications/meetings` → `teams_meeting_reference`); Teams-embedded admin mode; message-extension search. Credentials env-only; request path never calls Graph (worker does all outbound I/O).
- **V1 "create Teams meeting from a record" is a provisioning exercise, not new code**: enable 3 flags, set Graph creds, grant `communication.meeting.manage`, link an organizer identity.
- **No internal record-thread system exists.** `operational_note` is flat AND its object-type enum is `shoot|shift|location|alert` only — no job/org. Recommended V1: `record_thread` + `record_thread_message` (user_message|system_event), reuse `canViewRecords` gating + mention/attachment patterns, Teams limited to meeting-link launch dropping a `meeting_created` system event. No Graph message sync in V1.
- **The Job Detail 403s are provisioning gaps, not bugs**: migration 131's communication grant list omits `director_admin`, and `can_use` requires a linked Teams identity. Decide intent (add director_admin to grants + `communication.configure`) rather than "fix."
- Cleanup register: P1s fixed this sprint (§2); P2 remaining: `sports-peer-qa` + `directory-internal` missing from SECTION_CHILD_ORDER (sort to end), latent `#growth/rfps|accounts|opportunities` (fixed by the same resolver change), pg pool no `max` config, Vite no chunk-size config, `GET /api/jobs/:jobId` non-uuid 500, urgent-watch `#scheduling` non-focusing destinations.

---

## 6. Sprint roadmap (remaining slices, in order)

| Slice | Content | State |
|---|---|---|
| **G1 Part 2** | Compliance read-model extension per Agent 2's plan: `manual_time_adjustment` + `mileage_review_required` item types, leadership counts (count==rows), `blocks_*`/destination/action fields, labor categories now LINKED (stream landed — deep-link `#labor/command-center`, `#my-work/payroll-self-check`) | **Ready — next implementation slice** |
| SSA-2 eval obligations | Roster-diff obligation model (assigned minus submitted, no-show/cancelled excusal) | **Blocked on policy Q1/Q2** (§4) |
| SSA-3 mileage eligibility UX | Post-submit prompt vs in-form field; recalc is idempotent so either works | Blocked on policy Q4 |
| SSA-5 record threads | `record_thread`/`record_thread_message` two-table slice + `meeting_created` system event via existing meetings endpoint | Design ready |
| SSA-6/7 season autopilot read model + UI | Agent 1's shoot-spine projection; gallery/rebooking `available:false` | After G1 Part 2 |
| G2 | `time_entry` + `mileage_claim` dual-write retirement; V1-vs-canonical mileage reconciliation | After policy Q5 |
| P2 cleanup | SECTION_CHILD_ORDER additions, non-uuid 404 guard, urgent-watch destinations, pg/Vite config | Anytime, small commits |

---

## 7. Next prompt

> Implement G1 Part 2 — Compliance Workspace read-model extension. Repo `C:\Dev\Codex-integrated-baseline-clean`, branch `feature/work-spine-foundation-v1`, tree clean at `78f125d`+doc. Follow the file-exact plan in this doc §4/§5 and `docs/session-reports/2026-07-08-g-series-hardening-audit.md` §10, with one update: the labor stream has LANDED (`59ba411..d76bdcb`), so labor categories are now LINKED (available, deep-linking to `#labor/command-center` and `#my-work/payroll-self-check` with real counts from `payroll_period` blockers / `overtime_warning` / `payroll_self_check`) instead of unavailable stubs. Extend `services/complianceWorkspace.ts` (issue-type enum :22-31, source union :1242, summary :1253-1276, item contract :33-72) and BOTH zod lists in `routes/compliance.ts` (:43-53, :69-78). No new write paths; no UI changes (Compliance.tsx absorbs rows generically). Tests per Agent 2 §7c on `tests/complianceWorkspacePhaseG1.test.ts` conventions. Browser-verify `#employees/compliance` with real demo data. Separately: put the six eval/mileage policy questions (§4) in front of Matthew — SSA-2/SSA-3 unblock on his answers.

*Documentation commit only beyond `78f125d`; no other code changed in this sprint.*
