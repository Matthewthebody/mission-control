# Client Command Center V1

Client Command Center V1 is the customer context layer for Mission Control. It is not a separate CRM and not a second contact system. It extends the existing canonical Directory tables so future jobs, tasks, events, notes, exceptions, Outlook drafts, Teams notifications, communication readiness, relationship ownership, and client history can share one client brain.

## Dashboard Location

- Main route: `#client-command-center`
- Account detail route: `#client-command-center/accounts/:accountId`
- Navigation: Operations -> Client Command Center

The existing Directory routes remain compatibility and operational surfaces:

- Accounts: `#accounts`
- Contacts: `#directory/contacts`

Those routes continue to use the same canonical Directory tables. They are not a competing client/contact system.

## Existing Contact/Client Audit

Pre-existing client/contact work was found and reused:

- API route: `packages/api/src/routes/organizations.ts`
- Directory service: `packages/api/src/services/organizations.ts`
- Tables: `organization`, `organization_contact`, `organization_contact_relationship`, `directory_touchpoint`, `directory_duplicate_review`
- Admin pages: `packages/admin-web/src/pages/Organizations.tsx` and `packages/admin-web/src/pages/Contacts.tsx`
- Navigation: `#accounts`, `#directory/contacts`, sports account/contact wrappers
- Import/history tables: `directory_import_session`, `directory_import_row`, contact relationship history fields

Decision: reuse and extend the canonical Directory source of truth. No old client/contact data is deleted. No parallel client/contact table was introduced. Existing forms remain compatible because the Client Command Center writes to the same tables.

## Data Model

Client Command Center V1 adds client-specific context to the canonical Directory:

- `organization.client_entity_kind`: `parent_organization` or `account`
- `organization.parent_organization_id`: district/association/company parent for account records
- `organization.client_organization_type`: school district, high school, sports association, studio client, company, nonprofit, other
- `organization.client_lifecycle_status`: active, inactive, prospect, former client, archived
- `organization_contact.display_name`, mobile phone, preferred contact method, and demo marker
- `organization_contact_relationship.client_roles`: relationship-based roles such as principal, head secretary, picture day contact, yearbook contact, billing contact, approval contact, and emergency day-of contact
- `client_internal_owner`: internal ownership including Studio Bestie, CSR owner, department owner, sales owner, escalation owner, production owner, and support owner
- `account_service`: services/products used by an account
- `client_context_link`: generic client context link for future task/event/communication/provider records
- `work_task`: account, contact, service, communication, and source context
- `job_days`: scaffolded client event and communication type fields for future event/calendar support

Account names are duplicate-protected under the same parent organization while allowing the same school/account name under a different district or association.

## API Endpoints

- `GET /api/client-command-center/dashboard`
- `GET /api/client-command-center/accounts/:accountId`
- `GET /api/client-command-center/accounts/:accountId/communication-readiness`
- `POST /api/client-command-center/organizations`
- `POST /api/client-command-center/accounts`
- `POST /api/client-command-center/contacts`
- `POST /api/client-command-center/contact-relationships`
- `POST /api/client-command-center/owners`
- `POST /api/client-command-center/accounts/:accountId/services`
- `POST /api/client-command-center/accounts/:accountId/notes`
- `POST /api/client-command-center/accounts/:accountId/tasks`

Backend authorization is the source of truth. The UI does not override backend permission denials.

## Communication Readiness

Readiness is computed by the backend and not persisted as a separate competing state.

Current checks:

- Primary contact exists
- Picture day contact exists when picture-day services are active
- Yearbook contact exists when yearbook service is active
- Billing contact exists
- Emergency day-of contact exists when active jobs exist
- Internal owner or Studio Bestie exists
- Required contacts have a usable email, phone, or mobile phone

Current communication types prepared:

- `new_client_onboarding`
- `picture_day_confirmation`
- `picture_day_prep`
- `reminder_email`
- `yearbook_deadline`
- `gallery_live`
- `retake_reminder`
- `missing_approval_followup`
- `post_shoot_thank_you`
- `issue_escalation`

V1 does not send emails. It identifies whether future communication can be prepared safely.

## Task and Event Context

Client-aware task creation is implemented through the existing `work_task` model. Tasks created from an account preserve:

- account id
- contact id if selected
- owner/assignee
- service type
- communication type
- source type/source id
- `client_context_link`

Event/calendar readiness is scaffolded through `client_context_link.event_id`, `job_days.client_event_type`, and `job_days.communication_type`. A full standalone account-event creation UX is not implemented in V1.

## Activity Timeline

Account notes use the existing `directory_touchpoint` table. Account detail also includes client-aware task activity. This keeps the timeline aligned with existing Directory activity instead of creating a disconnected timeline system.

## Microsoft Readiness

Teams and Outlook delivery are not implemented in V1.

The foundation is ready for future Microsoft work because:

- Client events emit through `app_event`/outbox where available.
- Event payloads are provider-agnostic and include `provider_targets_supported`: `in_app`, `email`, `teams`, `outlook`.
- Users, roles, departments, owners, and contact relationships remain the identity/routing foundation.
- No competing user system was introduced.
- Account, organization, contact, job, task, owner, service, and communication context is preserved outside notes fields.
- Due dates, ownership, account/job references, and communication types are clean enough for later Outlook calendar/task/draft mapping.

Future work:

- Microsoft identity mapping
- Teams notification delivery
- Outlook draft creation
- Outlook calendar/task sync
- provider-specific delivery logs and retries

## Demo Data

Demo data is development-only and requires explicit confirmation.

Load/reset demo data:

```bash
npm run client-command-center:reset-demo
```

Seed without reset:

```bash
npm run client-command-center:seed-demo
```

The reset script deletes only records marked with the `client_command_center_v1` demo marker plus the known demo job/task numbers. It does not delete production-like client data.

Demo includes:

- Wayzata School District and Wayzata High School
- Osseo Area Schools and Maple Grove Senior High
- Tonka United and Tonka United Soccer
- Principal, head secretary, picture day, yearbook, billing, approval, emergency day-of, and sports association contacts
- Studio Bestie/internal ownership examples
- Fall pictures, yearbook, ID cards, and sports services
- Upcoming jobs
- Client-aware tasks
- Account notes/timeline examples
- One account that is communication-ready and one account with visible readiness gaps

## What Matthew Can Demo

1. Open `#client-command-center`.
2. Search accounts by school, district, owner, or account type.
3. Open an account detail page.
4. Show parent organization, key contacts, services, Studio Bestie, upcoming jobs, open tasks, and timeline.
5. Show readiness gaps such as missing yearbook contact, billing contact, emergency day-of contact, or internal owner.
6. Add a parent organization.
7. Add an account under a parent organization.
8. Add a contact and attach relationship-specific roles.
9. Add services/products.
10. Assign yourself as Studio Bestie.
11. Add a note or create a client-aware task.

Pilot walkthrough script:

- Start with the dashboard and explain that this is the customer brain, not a CRM replacement for sales pipeline work.
- Open Wayzata High School to show a cleaner account with contacts, services, Studio Bestie ownership, and readiness in good shape.
- Open Maple Grove Senior High to show useful gaps: missing yearbook contact, billing contact, emergency day-of contact, and Studio Bestie/internal owner.
- Point out that readiness is computed by the backend from real services, roles, owners, active jobs, and contact methods.
- Create a small follow-up task from the account page and explain that account, service, communication, and future Outlook/Teams context stay attached.
- Say clearly that monday.com remains the operational safety net during pilot review.

## Implemented vs Scaffolded

Implemented:

- Client Command Center route and UI
- Account search/detail projection
- Parent organization/account relationship
- Contact creation and relationship roles
- Internal ownership/Studio Bestie
- Account services/products
- Communication readiness projection
- Account notes/activity timeline
- Client-aware task creation
- Safe demo seed/reset
- Permission registration and backend route enforcement
- Provider-agnostic app event payloads

Scaffolded/not complete:

- Full standalone event/calendar creation from account pages
- Outlook email drafts
- Outlook calendar/task sync
- Teams notifications
- Microsoft identity mapping
- Full contact merge tooling
- CSV/17hats import
- Sales pipeline/revenue CRM
- Advanced communication template builder
- Full relationship-risk reporting

## Remaining Risks

- Existing Directory pages still have older labels in places; they use the same source of truth but are not yet fully rebranded around Client Command Center language.
- Dashboard readiness currently uses straightforward backend checks; deeper service-specific readiness rules should be added after pilot feedback.
- Command Center dashboard currently limits to 100 active accounts; scaling beyond that should add pagination and batched readiness aggregation.
- Account-level event creation is scaffolded, not implemented.

## Recommended Next Phase

After this V1 is reviewed and committed, the next phase should be pilot polish:

- Improve account detail UX
- Add richer owner/contact role editing
- Add pagination and batched readiness projections
- Add account-event creation if leadership confirms the workflow
- Start Microsoft identity mapping only after alert/communication behavior is validated
