# Staffing Publish + Acknowledgment Lifecycle — Slice 2 design (locked)

**Date:** 2026-06-18 · Branch `feature/work-spine-foundation-v1`
**Builds on:** `docs/staffing-lifecycle-trace.md` (Phase 2 Step 1). This is the locked design to implement; decisions below are final for Slice 2.

**Principle:** extend the existing canonical models. **No parallel staffing-plan store** — `work_shift` and `shoot_staffing_requirement` stay the assignment/requirement source of truth; we add a per-shoot *published version* ledger and a *per-recipient state* table, and reuse the existing outbox + audit. The content-hash re-ack mechanism is cloned from `shift_note_acknowledgement` (migration 024).

---

## 1. `not_acknowledged` — precise definition (LOCKED)
`not_acknowledged` = the employee has not acknowledged the **current** published assignment **by the centralized acknowledgment-policy deadline**. A freshly published, still-pending assignment is **not** urgent merely because its status starts as pending.

Three separate concepts — never conflated:
- **staffing coverage** — a person is assigned and published.
- **employee confirmation** — the current recipient package is acknowledged.
- **operational readiness** — coverage **and** confirmation satisfy current policy.
A shoot can be fully staffed yet at risk because a required employee has not confirmed.

Behavior:
- Publishing **immediately** shows **Awaiting Acknowledgment** in manager + employee views (not urgent).
- A pending assignment becomes a **Needs Attention / urgent-watch** issue only once it is **past the effective grace boundary** (publish time + grace period, **capped at the shoot start**) **and** (`acknowledgment_due_at` has passed **or** the shoot is inside the **72-hour escalation window**). A freshly published assignment — even one already inside 72h — is "Awaiting Acknowledgment" during grace, **not** urgent; a publication less than the grace period before the shoot has its grace capped at the shoot start. Rule: `isPendingNotAcknowledged({responseStatus, publishedAt, dueAt, shootStartAt, now})` in `staffing-acknowledgment-policy.ts`.
- An **unpublished plan has no acknowledgment obligation**: a null / unparseable `publishedAt` makes the rule return **false** (never inferred overdue). `evaluateAcknowledgmentUrgency` returns `{urgent, missingPublicationTime}` so a *current* recipient missing publication metadata is safely non-urgent **and** flagged for the caller to log (a current recipient structurally has `version.published_at NOT NULL`; the flag is defense-in-depth).
- An explicit **decline** is **immediate** staffing risk.
- An overdue pending assignment rises in severity as the shoot approaches (existing severity conventions).
- The issue resolves/supersedes when the current assignment is acknowledged, removed, canceled, reassigned, or replaced by a newer version.
- **Centralized, configurable policy** for due times + any short publication grace period — one policy module (e.g. `domain/staffing/acknowledgmentPolicy.ts`), **not** timing constants scattered through routes/workers/selectors/UI.

## 2. Shoot-level version + recipient-level hash (LOCKED)
- One **monotonically increasing, immutable** staffing-plan **version per shoot**. The global **`plan_hash`** determines whether a **new published version** exists.
- A deterministic **`recipient_hash`** per employee's *complete* assignment package for that shoot/version. The **`recipient_hash`** determines whether **that employee must acknowledge again**.

When version **N+1** is published:
- changed or newly added recipients → **pending**.
- unchanged acknowledged recipients → **explicitly carried forward** (status stays `acknowledged`, with provenance).
- unchanged pending recipients → remain **pending**, **without** another initial-publish notification.
- unchanged declined recipients → remain **declined** unless their package materially changes.
- removed recipients → **canceled/superseded** for the current plan.
- all historical recipient records remain **immutable + queryable**.

**Do not** use `carried_forward` as a response status. Use:
- **`response_status`**: `pending | acknowledged | declined | canceled` (superseded represented via `superseded_at`).
- **`carried_forward_from_recipient_id`**: nullable provenance pointer.
So the current version can read `acknowledged` while proving the ack carried forward from an earlier identical recipient package.

## 3. Schema (LOCKED, additive — one migration)

### `staffing_plan_version` (append-only, immutable once published)
`id, tenant_id, shoot_id, version int, plan_hash text, published_by_user_id, published_at timestamptz, created_at timestamptz, plan_snapshot jsonb` (immutable normalized plan metadata).
- `UNIQUE (tenant_id, shoot_id, version)`.
- Published versions immutable (no UPDATE of `version`/`plan_hash`/`plan_snapshot`).
- Indexes: `(tenant_id, shoot_id, version DESC)` for current/latest lookup.

### `staffing_plan_recipient` (recipient-**state** table, not ack-only)
`id, tenant_id, staffing_plan_version_id (FK), employee_user_id, recipient_hash text, assignment_snapshot jsonb (immutable), response_status (pending|acknowledged|declined|canceled), acknowledgment_due_at timestamptz, responded_at timestamptz null, responded_by_user_id null, decline_reason text null, carried_forward_from_recipient_id uuid null, superseded_at timestamptz null, created_at timestamptz, updated_at timestamptz` (updated only on permitted response-state changes).
- `UNIQUE (staffing_plan_version_id, employee_user_id)`.
- Tenant consistency enforced (recipient.tenant_id = version.tenant_id, e.g. composite FK or trigger/check).
- Employee response routes may mutate **only the employee's own current** recipient record.
- **One recipient package per employee per shoot** — if an employee has multiple roles/shifts on the same shoot, the normalized `assignment_snapshot` includes all of them so the employee acknowledges **one** current commitment.
- All response transitions go through the existing audit/event infrastructure.

## 4. Material-change rules (LOCKED) — what is hashed
Helper: `domain/staffing/staffing-plan-hash.ts` (`normalizePlan` / `normalizeRecipientPackage` → stable JSON → SHA-256). The normalization algorithm is itself versioned: **`STAFFING_PLAN_HASH_VERSION`** is stored as `hash_version` on the version + recipient rows, and the no-op / carry-forward comparisons require the hash AND `hash_version` to match — a future algorithm change therefore does not make historical plans look changed.

Include (in `plan_hash` and/or `recipient_hash`): assigned employee, **canonical** slot/requirement id, role, shoot date, start/setup(call)/end times, meaningful location, assignment added/removed/canceled/restored.
Exclude: reads, UI state, **display names** (canonical IDs are hashed instead), the **internal `work_shift` instance id** (a re-created shift with identical material is the same commitment), **`work_shift.notes` / free-text instructions** (these are surfaced to employees as pre-service highlights that already carry their own content-hash acknowledgment via `shift_note_acknowledgement`; folding them in here would double the re-ack triggers and risk hashing internal note usage — a dedicated employee-facing assignment-instructions field can be added and hashed in a later slice), harmless metadata, lifecycle/publish status, and **another employee's assignments from this employee's `recipient_hash`**.
Normalization contract (documented in the helper): assignments sort by `(requirement_id, starts_at, role, ends_at)` and recipients by employee id; timestamps collapse to one canonical UTC instant; blank/whitespace strings normalize to null; JSON keys are emitted in a fixed literal order (never rely on property order).
The stored immutable snapshot (`assignment_snapshot`) is built by `buildRecipientSnapshot` — the same material **plus** `source_shift_id` (traceability only, never hashed) and `snapshot_schema_version` — and treats assignments as a **sorted multiset** (identical material stays distinct entries, never deduplicated). Two version columns: `hash_version` governs digest equality (carry-forward + no-op compare it), `snapshot_schema_version` governs how the stored JSON is read; both are `INTEGER NOT NULL DEFAULT 1 CHECK (> 0)` and let a future upgrade read history under its own rules instead of making every historical plan look changed.

## 5. Draft vs published (LOCKED)
After publication, canonical staffing edits are **draft changes** and must never mutate the immutable version employees acknowledged. The manager UI must be able to show: the **latest published version**, **draft changes since publication**, **republish required**, **which employees will require renewed acknowledgment** (recipient_hash changed), and **which acknowledgments carry forward** (recipient_hash unchanged). *(UI is sub-slice 3; this slice exposes the read model the UI needs.)*

## 6. Publish transaction + idempotency (LOCKED)
`publish` runs atomically:
1. **Lock** the shoot / publication boundary (`SELECT … FOR UPDATE` on the shoot row).
2. Load current canonical staffing + the latest published version.
3. **Normalize** the plan + per-recipient packages.
4. Compute deterministic `plan_hash` + each `recipient_hash`.
5. If `plan_hash` unchanged vs the latest version → **idempotent no-op**, return the existing version.
6. Else create **exactly one** next version.
7. Insert **all** current recipient records.
8. **Carry forward** unchanged response states explicitly (`carried_forward_from_recipient_id` + preserved `response_status`/`responded_at`).
9. Mark changed/new recipients **pending** with `acknowledgment_due_at` from the policy.
10. Create notification-outbox records **only** for recipients who actually need a new notification (new/changed-and-pending), dedupe key **`staffing-publish:<shoot-id>:<version>:<employee-id>:<recipient-hash>`**.
11. **Commit atomically.**

Concurrent publishes / double-clicks / request retries / worker retries must **not** create duplicate versions, recipients, or notifications (the shoot lock + `UNIQUE(tenant,shoot,version)` + `UNIQUE(version,employee)` + `app_event` dedupe guarantee this). **Republishing an unchanged plan is not a reminder mechanism** — a separate **Resend Reminder** action will have its own policy + dedupe/event identity (later sub-slice).
"Idempotent" applies to the **version / recipients / notifications** only — an unchanged-plan publish still runs the **canonical shift-publication loop** (a non-material draft edit must still be published; *"unchanged plan" ≠ "nothing to publish"*). The prior aggregate "staffing published" notification is **preserved as the temporary delivery bridge but fired ONLY when a new version is created** — an unchanged republish never re-delivers (its count-keyed dedupe is not republish-stable because publishing flips draft→published and shifts the counts). It delivers to all assigned recipients **except the publishing actor** (coarse: it re-notifies unchanged carried-forward recipients on any change). The per-recipient version+hash **marker** (`staffing.plan.recipient_published`) is the precise idempotent record and is **not separately delivered** (the worker ignores its event type); per-recipient dispatch that **replaces** the aggregate — notifying only new/changed recipients — is sub-slice 4. All writes — version, recipients, canonical publish mutations, app_event, notification outbox — share the one publish transaction, so a failure rolls everything back atomically (no partial version/recipients/supersede/notification).

## 7. Decline → canonical readiness (LOCKED)
A declined assignment must **not** continue satisfying operational readiness just because its `work_shift` is still `published`. **Three distinct concepts, named explicitly** (do not silently redefine `assigned_staff_count`):
- **Raw assignment truth** — `assigned_staff_count`, `published_staff_count`, `lead_assignment_count` (= `lead_coverage_count`), `lead_name`. Never erased by a decline.
- **Position coverage** — assigned **AND not currently declined**: `coverage_eligible_staff_count`, `coverage_eligible_lead_count`, `coverage_eligible_lead_name(s)`. A still-**pending** (awaiting-acknowledgment) employee **fills the position** (coverage-eligible) but is deliberately **not** called "accepted" — acknowledgment has not occurred. `missing_lead` / `under_staffed` / candidate gap derive from these coverage-eligible counts (a decline drops a position; a pending one does not).
- **Operational readiness** — coverage **plus** acknowledgment: `pending_acknowledgment_count`, `acknowledged_staff_count`, `overdue_acknowledgment_count`, `declined_staff_count`, `declined_lead_name`, `replacement_required`, and the derived **`operational_readiness_status`** ∈ `ready | awaiting_acknowledgment | confirmation_overdue | at_risk`. A covered position whose acknowledgment is overdue is still **operationally at risk** (`confirmation_overdue`), so the dashboard at-risk list also surfaces `overdue_acknowledgment_count > 0`.

The manager view can therefore represent "Lead: Sarah — Awaiting acknowledgment", "Lead: Sarah — Acknowledged", "Lead: Sarah — Declined; replacement required", and "Lead assigned, but confirmation overdue" — never "nobody assigned".
The decline exclusion is **scoped to the current published version** (`staffing_plan_recipient.superseded_at IS NULL` + `response_status='declined'`): a historical decline from version N never excludes a reassignment / replacement / materially-changed package in version N+1, which follows its own pending/acknowledged state. "Employee once declined this shoot" is never a permanent exclusion.
Decline must: require a reason; retain assignment + response history; update the manager view immediately; make the current plan visibly at risk; activate/reactivate the correct staffing issue; prevent the declined commitment from being treated as confirmed coverage; never let the employee change staffing configuration.

## 8. Permissions
- Publish/assign/reassign/override → `schedule.publish` / `schedule.manage` (owner, leadership, director_admin, dept-scoped client-success via `canManageShootDepartment`).
- Employee ack/decline → employee-scoped guard: actor = the recipient's `employee_user_id` for the **current** version; `schedule.read`-class; **cannot** publish/assign/reassign/override/edit requirements.
- Deep links cannot bypass — every mutation hits a guarded route.

## 9. Audit / history
`staffing_plan_version` append-only (full publish history); `staffing_plan_recipient` retains every recipient state per version (prior acks preserved); one `audit_events` entry per publish + per response transition; `reassignment_history` jsonb continues.

## 10. Tests required with the schema/services sub-slice (LOCKED — 22)
1. First publish → version 1 + one recipient package per employee.
2. Multi-assignment employee → one recipient package.
3. Repeat unchanged publish → returns version 1.
4. Unchanged publish → no duplicate recipient rows or notifications.
5. Changing one employee → version 2.
6. The changed employee → pending.
7. Unchanged acknowledged employee → carried forward explicitly.
8. The prior acknowledgment remains historical.
9. Unchanged pending employee → remains pending, no second initial notification.
10. An unrelated employee's change does not force all to re-acknowledge.
11. Material date/time/location/instruction change → renewed ack for affected employees.
12. Internal-only notes → no new version.
13. Concurrent publishes → no duplicate version numbers.
14. Pending visible immediately but not urgent before policy thresholds.
15. Passing the due time → `not_acknowledged` activates.
16. Entering the 72h window while pending → activates.
17. Acknowledgment resolves the current not-acknowledged issue.
18. Decline → plan immediately operationally at risk.
19. A declined published shift no longer satisfies accepted readiness.
20. Reassignment + newer version supersede old pending issues + reminders.
21. Employee routes reject actions against another employee's recipient record.
22. Employees cannot publish, assign, override, or edit staffing requirements.

## 11. Implementation sub-slices (bounded commits)
1. **Additive schema + services** (this sub-slice) — migration (2 tables), `planHash`/`recipientHash` normalization, `acknowledgmentPolicy`, publish-writes-version + recipient state + carry-forward, decline→readiness in the coverage/candidate calc, the 22 tests above. *(No UI.)*
2. **Publish / version read model** surfaced to the manager snapshot (latest version, draft-since, republish-required, who-re-acks, who-carries-forward).
3. **Employee acknowledgment / decline UI + routes** + RBAC.
4. **Urgent-watch + notification integration** (due/72h activation, decline reactivation, resolve-after-fill domain test, Resend Reminder, idempotency).
5. **Verification** — full suites + browser smoke (publish v1 → ack → change → publish v2 → prior ack historical → ack v2).
