# Owner Decision Memo — 2026-07-13

> **RATIFIED 2026-07-13 (same day):** Matthew approved **all recommended defaults** ("Move forward with all your recommendations"). Every ⬜ below whose recommendation states a default is now a ratified decision; implementation began immediately (convergence slice 1 first). **Still awaiting owner input — no default was safe:**
> - **B1** — the three payroll calendar facts (real period anchor date, close day, lock/export day for the QuickBooks run).
> - **B4** — which Teams channel receives payroll alerts.
> Sequenced-by-design items (C6 approve/export=G3, C7 answer-pending after G2, C8 legacy mileage retirement next season, D2 unified registry in Phase 3) are ratified as direction and will land in their stated order.

**For:** Matthew Kemmetmueller
**Purpose:** every open product/policy decision currently blocking engineering, in one place. Each item has context, the question, a recommended default, and what your answer unblocks. Answer inline (check a box or write a line) — a single pass through this memo unblocks Phase 1 convergence, G2/G3 labor consolidation, and the remaining Season Autopilot slices.

Sources: `docs/audits/mission-control-full-system-audit.md` (2026-07-08), `docs/jobs-shoot-convergence-audit.md` (2026-06-19), `docs/session-reports/2026-07-08-school-season-autopilot-sprint1.md` §4, `docs/session-reports/2026-07-08-g2-canonical-labor-mileage-audit.md`, `docs/session-reports/2026-07-08-g-series-hardening-audit.md`.

Legend: ⬜ = needs your answer · ✅ = recommended default stated; a "yes, go with the default" is enough.

---

## A. Job ↔ Shoot convergence (the single biggest decision — blocks Phase 1)

**Context.** Mission Control currently runs two work spines that do not see each other: `shoot` (2,709 rows — scheduling, staffing, time clock, labor, leadership dashboards) and `jobs` (93 rows — closeout, production items, client command center). The bridge table `job_shoot_links` exists but has **zero rows**. Until this is decided, every new feature deepens the fork, and the audit's standing rule is: no new Production Tracker / Season Autopilot slices.

### A1 ⬜ Ratify the semantics: **Job = package/engagement, Shoot = dated operational occurrence, one Job → many Shoots**
The June-19 convergence audit recommends this model (a school's fall picture-day *package* is a Job; picture day, makeup day, retake day are its Shoots).
**Recommended: YES.** No credible alternative surfaced in either audit.

### A2 ⬜ Ratify **Option B**: a *reviewed* `job_shoot_links` relationship table — extended with `relationship_type` (primary/makeup/retake/…), `source`, `status` (proposed/confirmed/rejected), `confidence`, `linked_by`, audit history. **No automatic fuzzy backfill** — a matching script *proposes* links, a human confirms; no `shoot.job_id` column.
**Recommended: YES** (only 2 of 2,313 shoots have any deterministic link signal — auto-matching would fabricate history).

### A3 ⬜ Which intake is the **one creator** going forward?
Today two disjoint intake paths exist: the shoot-spine QuickCreate cascade (`centralJobIntake` — District→School→Location→Contact, dated-commitment snapshots, the flow built for Jessica) and the jobs-spine editor (`jobService`). Neither creates a link row.
**Recommended: the QuickCreate/central intake cascade is the front door; on publish it transactionally creates the Shoot, the Job (engagement) if none exists, and the confirmed link row.** The jobs-spine editor becomes edit-only (no standalone create). Rationale: the cascade already carries all the canonical-directory work and is the workflow Jessica needs.

### A4 ⬜ Backfill review: who reviews proposed links, and is "unlinked" acceptable for historical (pre-2026) shoots?
**Recommended:** you or Jessica review active-season proposals only; historical shoots stay unlinked with an honest "no linked job" state (the audit's interim-behavior rule) rather than a guessed link.

**Unblocks:** audit Prompt 6 (convergence slice 1), Prompt 7 (one status vocabulary), Production Tracker resumption, Season Autopilot 6/7, count-parity dashboards.

---

## B. Payroll calendar & Labor Command Center business rules

**Context.** The Labor Command Center (migrations 165/166) encodes a bi-weekly payroll calendar with a placeholder anchor and rules explicitly marked "NEEDS BUSINESS VERIFICATION."

### B1 ⬜ **Bi-weekly close rule + anchor date.** The system currently assumes bi-weekly periods anchored at **Monday 2026-06-29**. Confirm: (a) the real anchor date of a current period start; (b) the day the period *closes* for review; (c) the day payroll must be *locked/exported* to hit your QuickBooks run.
**Needed from you:** three dates/weekdays. This is configuration (`payroll_calendar_config`), not code — but wrong values poison every period boundary.

### B2 ⬜ **Travel/drive-time pay policy.** Part-time and seasonal photographers' drive time is currently *held for payroll review* (never auto-paid). The `travel_policy` field is a placeholder. State the actual rule (e.g., "paid over X minutes / between shoots only / at a different rate?").
**Recommended default until stated:** keep hold-for-review (safe, but adds manual work every period).

### B3 ⬜ **QuickBooks connection.** The QB transport is deliberately not implemented (honest "not connected"; CSV is the working handoff). To build the real sync we need QB Online OAuth credentials + a sandbox company. Is that a now-thing or a later-thing?
**Recommended: later** — CSV handoff is safe and working; wire QB after a full manual cycle succeeds end-to-end.

### B4 ⬜ **Teams payroll alerts.** The `payroll_alert` type exists but no Teams route is configured in alert governance. Should payroll blockers/overtime warnings post to a Teams channel, and which one?

**Unblocks:** first real payroll period close in the Labor CC; G3 review tools.

---

## C. Post-shoot evaluation & mileage policy (the six questions + two follow-ons)

**Context.** Two evaluation systems coexist and both write `post_shoot_evaluation`: the **shift path** (mobile modal, per photographer per shift) and **Job Closeout V1** (jobs spine, role-tiered). The canonical mileage gate already enforces "no eval → no payable mileage" per photographer — that part is settled and enforced. Since these questions were written, engineering landed obligation tracking and the post-submit eligibility prompt in a system-agnostic way, so nothing has to be rebuilt — but the policy answers still steer what happens next.

### C1 ⬜ **Which evaluation system is canonical going forward** — the shift path (mobile) or Job Closeout V1?
**Recommended: the shift path** (per-photographer, mobile, feeds the mileage gate and the 46-month memory loop directly). Job Closeout V1 remains the *job-level* closeout wrapper and must *reference* photographer evals, not own them.

### C2 ⬜ **Are associate photographers literally required to submit an eval on every shoot?** Your rule #1 says yes; today the shift path requires it only for leads/seniors, and Closeout V1 defaults associates to not-required.
**Recommended: YES, required for everyone who worked the shoot** — the roster-diff obligations model already surfaces who owes one, and the mileage gate gives it teeth without extra enforcement code.

### C3 ⬜ **No-show / cancelled photographers: auto-excused from the eval obligation?** Cancelled *shifts* are already excluded. A photographer who was assigned but didn't show currently still "owes" an eval until someone edits the shift.
**Recommended: auto-excuse on a recorded no-show/removed-from-shift state; excusal must be a manager action, not silent.**

### C4 ⬜ **Eligibility question UX: in-form field, post-submit prompt, or both?** Both now exist (the mobile eval form has the in-form question; a post-submit prompt with change-answer support also landed).
**Recommended: keep both** — in-form for the happy path, the prompt as the safety net and the place to *change* an answer later. Cheap to keep; say the word to remove one.

### C5 ⬜ **Fate of Job Closeout V1's own mileage store (`job_closeout_mileage_review`)** — replace canonical mileage, feed it, or become a read-only reference?
**Recommended: read-only reference to canonical `mileage_reimbursement`; it must never be a second writer.** Payroll is blind to it today — anything entered there does not pay out, which is a silent trap until re-pointed.

### C6 ⬜ **Mileage approve/export: strictly a G3 (owner review tools) feature?** The `approved`/`exported` statuses exist in the schema but nothing can write them yet (guarded so nothing corrupts them).
**Recommended: YES — G3 builds owner-gated approve→export inside the Labor CC**, same lifecycle discipline as payroll lock/export. Until then mileage stays review-only.

### C7 ⬜ *(follow-on)* **"Answer pending" mileage state.** Today "hasn't answered the eligibility question yet" is indistinguishable from "declined" (the field defaults to *no*). Making "not yet answered" explicit is a small migration with backfill.
**Recommended: YES, after the G2 read-side consolidation lands** (already sequenced as option C).

### C8 ⬜ *(follow-on)* **Retire the legacy per-shoot mileage submit (`mileage_claim`)?** It synchronously mirrors into canonical and nothing else reads it.
**Recommended: YES — retire the route next season; drop the table after.** Zero user-visible change expected.

**Unblocks:** SSA-2/SSA-3 enforcement config, G2 retirement sequencing, G3 mileage tools, Closeout V1 reconciliation.

---

## D. Alerting & review-surface ownership

### D1 ⬜ **Exception Center vs Compliance Workspace: stay separate?** Exception Center = production/workflow/scheduling watch items with its own snooze/handle lifecycle; Compliance Workspace = people/payroll/mileage accountability.
**Recommended: keep separate** (they manage different lifecycles; merging would create a parallel copy of state the compliance stack already manages). One label fix needed regardless — two unrelated features are both called "Needs Attention."

### D2 ⬜ **Unified alert registry direction (Phase 3).** Six alert registries exist; `/api/alerts` reads a 0-row table while real signals live elsewhere. The audit's Phase 3 plan: one needs-attention registry with resolution semantics; the others become writers/views into it.
**Recommended: ratify the direction now** (build later, Phase 3) so interim work stops adding seventh registries.

### D3 ⬜ **One payroll surface.** Declare the Labor Command Center the only payroll surface; the older payroll-review page and Labor page become read-only pointers, and their **ungated CSV exports are removed** (today three CSVs exist, only the LCC one is approval-gated — someone will hand QuickBooks an unreviewed export).
**Recommended: YES.** Flagging because it removes two export buttons office staff may currently use.

---

## E. Smaller intent decisions (cheap to answer, each blocks one slice)

### E1 ⬜ **Teams access for `director_admin`.** Job Detail's communications panel 403s for director_admin — the migration-131 grant list omits the role, and use requires a linked Teams identity. Bug or intent?
**Recommended: grant it** (add director_admin + `communication.configure`) — the omission looks accidental.

### E2 ⬜ **Turn ON central job intake (`centralJobIntakeV1`) for Schools** once the missing-state links are clickable (that fix is queued this session). Jessica currently has **no create button** and stays on Monday.
**Recommended: YES — enable right after the clickable-missing-states fix lands.**

### E3 ⬜ **Gallery/delivery modeling.** Ratify: gallery = a *deliverable kind* on existing work records, **not** a fourth production model.
**Recommended: YES** (prevents the next fork before it starts).

### E4 ⬜ **`contact` vs `organization_contact` on work records.** Work-record FKs should point at the *relationship edge* (`organization_contact`), not bare identity, so "who is our contact for this job" survives people changing schools.
**Recommended: YES — adopt as the standing convention for new work-record FKs;** existing FKs migrate opportunistically.

---

## What is explicitly NOT waiting on you

Already decided/enforced, listed so they don't get re-litigated: canonical labor = `time_session`/`time_segment`/`clock_event` + payroll summaries; canonical mileage = `mileage_reimbursement` via the idempotent recalc; `shift_punch` is canonical *input*, never to be frozen; the P1 payroll leak is fixed (`045a7ff`) with RBAC tests; the Compliance Workspace is the one compliance surface (extend, never fork); the home page's demo layer is being replaced with live-or-labeled content this session (audit Prompt 5 — the honest-contract pattern already proven on the same page).

## Suggested answering order
**A first** (it gates the most), then **B1** (three dates), then **C1/C2** (one line each). Everything else can be "yes to default" or a one-liner.
