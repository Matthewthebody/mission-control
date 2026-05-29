# Notification Center Architecture

## Philosophy
- `Recent Activity` answers what happened.
- `Notification Center` answers what a user needs to know, acknowledge, or resolve.
- Notifications are operational inbox items tied to real records, not a chat stream.

## Phase 1 Model
- In-app inbox: `ops_notification`
- Append-only lifecycle log: `ops_notification_event`
- Delivery channels: `in_app`, `push`, `sms`, `email`
- States: `new`, `seen`, `acknowledged`, `snoozed`, `resolved`, `expired`, `escalated`
- Severity: `low`, `medium`, `high`, `critical`
- Categories:
  - `urgent_operational_risk`
  - `staffing`
  - `attendance_time`
  - `schedule_change`
  - `pto_availability`
  - `production`
  - `approval_needed`
  - `follow_up_task`
  - `assignment_update`
  - `system_confirmation`
  - `informational_summary`

## Routing Rules
- Primary routing is ownership-first: direct assignee, direct approver, direct manager/coordinator, assigned shoot lead.
- High-importance operational events escalate to leadership visibility when the linked shoot is `Big Shoot` or `Critical Shoot`.
- Quiet hours only defer low/medium secondary channels. `high` and `critical` still keep in-app visibility and can keep interrupt channels.
- Grouping happens by `group_key` so related state flapping does not create inbox spam.

## Where The Logic Lives
- API inbox model and routing helpers:
  - `C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\services\opsNotifications.ts`
- API routes:
  - `C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\api\src\routes\notifications.ts`
- Worker delivery fan-out:
  - `C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\worker\src\handlers\appEventHandler.ts`
- Notification Center page:
  - `C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\packages\admin-web\src\pages\Alerts.tsx`
- Schema migration:
  - `C:\Users\MatthewKemmetmueller\OneDrive - Kemmetmueller\Documents\Codex\db\migrations\063_notification_center_phase1.sql`

## Saved Views
- `All Active`
- `My Action Needed`
- `Team Risk`
- `Approval Queue`
- `Escalated`
- `Resolved Recent`

These are resolved in the API so web and mobile can share the same inbox logic.

## Extending The System
1. Add or refine a routing rule in `ruleFor(...)` inside `opsNotifications.ts`.
2. Route recipients through `findNotificationRecipients(...)` instead of hardcoding page logic.
3. Keep the notification title/body short and tied to a real deep link.
4. If the new alert changes lifecycle meaning, record it in `ops_notification_event`.
5. Add a focused API or page regression when the new notification changes acknowledgment, snooze, resolve, or escalation behavior.

## Guardrails
- Do not use notifications as a second source of truth for staffing, attendance, production, or approvals.
- Do not send every minor state change as a separate inbox row.
- Do not let users disable critical operational alerts that are tied to owned assignments, approvals, or protected operational risk.

## Deferred Phase 2 Ideas
- Stronger user preference controls for digests and low-priority channels
- More explicit SLA-based escalation timers by category
- Full replacement of remaining legacy `/api/alerts` compatibility surfaces
- Broader mobile push preference UI
