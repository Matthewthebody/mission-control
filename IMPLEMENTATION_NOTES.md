# Auth And Access Implementation Notes

## Model

This pass keeps the staged identity and membership design the project requested:

- `user_account` is the global identity record used for email, password hash, reset flow, and verification state.
- `app_user` remains the tenant membership and effective access record for this pass.

Existing domain foreign keys still point at `app_user`. That keeps shoot, assignment, alert, mileage, media, push, and other operational data stable while the access model becomes more secure.

## Roles

Implemented roles:

- `owner_admin`
- `admin`
- `leadership`
- `senior_photographer`
- `associate_photographer`
- `office_employee`
- legacy `photographer`

Compatibility rule:

- Existing `admin` and `photographer` behavior stays working during transition.
- Legacy `photographer` remains supported for local compatibility and route-coverage tests.

Role intent:

- `owner_admin`: protected top-tier owner role with anti-lockout protections.
- `admin`: tenant-wide user/access/security-adjacent management role.
- `leadership`: broad operational visibility and edit rights across departments, but no user-access control.
- `senior_photographer`, `associate_photographer`, `photographer`: field workflow roles with assignment-aware access.
- `office_employee`: low-privilege internal role for future office surfaces.

## Departments

Implemented department values:

- `executive`
- `operations`
- `schools`
- `sports`
- `office`
- `production`
- `customer_service`
- `unassigned`

Department does not grant authority by itself. Role remains the source of authority.

## Membership Status Lifecycle

Implemented statuses:

- `invited`
- `pending_approval`
- `active`
- `suspended`
- `revoked`

Current flow:

1. Owner/admin invites by email.
2. Invite acceptance creates or updates the `user_account`, sets password, and moves membership to `pending_approval`.
3. Owner/admin approves the membership with role + department.
4. Membership becomes `active`.
5. Membership can later be suspended, reactivated, or revoked.

## Auth Model

Implemented auth paths:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/session`
- `POST /auth/change-password`
- `POST /auth/password-reset/request`
- `POST /auth/password-reset/confirm`
- `POST /auth/invites/accept`

Local-only path:

- `POST /auth/dev-login`

Important guard:

- `dev-login` is blocked when `NODE_ENV=production`.
- `ALLOW_DEV_LOGIN` is an explicit local-development toggle and should stay disabled outside development.

Sessions:

- JWTs are now session-backed.
- The signed token carries `tenant_id`, `sid`, `ver`, and `sub`.
- Every protected request resolves the live session and live membership from the database.
- Suspension, revocation, role changes, password change, and password reset can revoke sessions immediately.

## Authorization Model

Authorization is centralized in:

- `packages/api/src/authz/policy.ts`

Protected routes now require:

- a valid authenticated session
- active membership
- tenant scope
- centralized action/permission authorization

Field workflow hardening added in this pass:

- field roles only see assigned shoots in list/detail flows
- field time-clock, status-event, upload, media, and mileage actions are assignment-aware

This is intentionally a secure compatibility pass, not a full field-workflow redesign.

## Anti-Lockout And Anti-Escalation

Implemented protections:

- prevent removing or demoting the last active `owner_admin`
- prevent `admin` from creating or promoting `owner_admin`
- prevent `admin` from creating or promoting `admin`
- prevent leadership from owning user-access management
- revoke active sessions after suspension, revocation, and role change

## Audit Logging

Security-sensitive actions now create `audit_log` rows, including:

- login success/failure/block
- logout
- password change
- password reset requested/completed
- invite sent
- invite accepted
- membership approved
- role changed
- department changed
- suspended
- reactivated
- revoked

The admin web now exposes a minimal audit view for privileged users.

## Admin UI Surfaces Added

Minimal admin surfaces added in this pass:

- password login with local dev-login fallback
- `Users & Access`
- `My Account`

`Users & Access` currently supports:

- user list
- status/role/department/search filters
- invite user
- approve pending memberships
- resend invite for still-invited users
- role update
- department update
- suspend
- reactivate
- revoke
- recent audit view

## Seed Notes

Local-only seed credentials:

- password for seeded accounts: `LocalDemo123!`
- owner: `matthew@example.com`
- admin: `admin@example.com`
- leadership: `leadership@example.com`
- senior photographer: `senior@example.com`
- photographer: `photo@example.com`
- associate photographer: `associate@example.com`
- office employee: `office@example.com`
- pending approval: `pending@example.com`
- suspended: `suspended@example.com`

Local invite demo:

- email: `invitee@example.com`
- invite token: `local-invite-token-demo`

## Webhook Hardening Note

Current behavior:

- Outside production, the integration webhook route can still accept local testing traffic using `tenant_id` query param routing.
- In production, webhook requests now require `WEBHOOK_SHARED_SECRET` via `X-PMC-Webhook-Secret`, and the route returns `503` if that secret is not configured.

Follow-up risk:

- Provider-specific signature verification is not fully implemented yet.
- The current production hardening is better than leaving the route casually open, but it should still be treated as an intermediate control until per-provider verification is added.

## Security Follow-Up Items

- Add durable rate-limit storage instead of in-memory limits.
- Add email delivery for invite and password reset flows.
- Add explicit email verification delivery flow.
- Add per-provider webhook signature verification.
- Add frontend invite-accept and password-reset pages if those need browser UX instead of API-only local flows.
- Consider persistent mobile auth storage if the mobile app becomes a daily driver rather than a Phase One scaffold.
