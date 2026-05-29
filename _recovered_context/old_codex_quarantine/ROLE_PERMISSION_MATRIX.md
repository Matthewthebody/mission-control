# Role Permission Matrix

## Current Access Model In Code

The repository already uses a layered access model:

- authority tiers
- job-function profiles
- legacy role compatibility
- permission domains and scopes
- employee-only shell gating for narrower users

Current authority tiers:

- `super_admin`
- `leadership`
- `director_admin`
- `supervisor`
- `standard_employee`
- `read_only_viewer`

Current job-function profiles:

- `associate_photographer`
- `seasonal_photographer`
- `part_time_photographer`
- `senior_photographer`
- `schools_client_success`
- `sports_client_success`
- `customer_service_rep`
- `graphic_artist`
- `director_of_photography`
- `director_of_school_photography`
- `director_of_sports_photography`
- `director_of_digital_production`
- `leadership_team_member`
- `leadership_viewer`

## Product Interpretation

For phase 1, use simpler role groups in product and rollout language.

## Recommended Product Role Groups

| Product role group | Current code anchors | Default landing | Can see | Can edit | Can approve | Leadership-only exclusions |
| --- | --- | --- | --- | --- | --- | --- |
| Owner / Super Admin | `super_admin`, `owner_admin` | Dashboard | everything | everything | everything | none |
| Leadership | `leadership`, `leadership_team_member` | Dashboard | all operating and business-health surfaces | operational follow-through, production, directory, schedule, people ops | approvals, exceptions, payroll/compliance decisions | security admin unless explicitly granted |
| Director / Admin | `director_admin`, director profiles | Dashboard | most operational and business-health surfaces | schedule, staffing, production, directory, people ops | most operational approvals | super-admin-only security actions |
| Operations Manager / Coordinator | `supervisor`, `schools_client_success`, `sports_client_success` | Dashboard | Home, Operations, Directory, relevant People Ops | schedule, shoots, staffing, touchpoints, sales pipeline in department, production visibility | limited approvals depending on grant | profitability, security, some exports |
| Digital Production Lead / Production Coordinator | `director_of_digital_production`, `graphic_artist` plus schedule grants | Production or Dashboard | Home, Production, linked shoot detail, directory, own schedule | production items, reviewer assignment if granted, task updates, directory touchpoints if granted | QA/QC only if explicitly granted | profitability, payroll/compliance, security |
| Customer Service | `customer_service_rep` | Dashboard | Home, customer service, directory, relevant schedules | customer-service updates, touchpoints, follow-up notes | generally no broad approvals | profitability, security, full staffing management |
| Sales / Client Success | `schools_client_success`, `sports_client_success` | Dashboard | Home, Sales Pipeline, Directory, department schedule context | opportunities, contact follow-up, some schedule edits in department | no broad operational approvals by default | profitability leadership, payroll/compliance, security |
| Senior Photographer / Lead Photographer | `senior_photographer`, `supervisor` in some cases | My Work | own shifts, assigned shoot context, some lead-scope staffing and exceptions | own attendance items, own follow-through, limited lead-scope review | shoot-lead late/missed-punch approvals in scope | business-health, broad directory management, security |
| Photographer / Seasonal / Associate / Part-Time | field profiles | My Work | own shifts, assigned shoot context, notes, training, own attendance/missed punch/PTO/trade tools | own records only | no broad approvals | leadership, business health, directory management, staffing management |
| Read Only Leadership Viewer | `read_only_viewer`, `leadership_viewer` | Dashboard | leadership dashboards, reports, profitability, read-only operations | none | none | all edit or approve actions |

## Nearly-All-Internal Access Policy

Phase-1 default:

- almost every internal user gets app access
- employees are limited by role scope, not excluded from the product
- the app should always provide at least one useful daily workspace

That means:

- field employees get `My Work` and related self-service flows
- office and department employees get Home plus the parts of Operations, Directory, and follow-through they need
- leadership gets broader operational and business-health visibility

## What Nearly All Internal Users Should Be Able To See

These should be broadly available with appropriate scope:

- Home or My Work
- own schedule
- own assignments
- own attendance state
- own missed punch and exception submission
- own PTO and trade requests
- location and assignment context needed to do the job
- training and basic operational notes

## What Should Remain Leadership Or Director Only

- profitability workspace
- reporting exports with sensitive labor or business-health data
- broad payroll review
- broad compliance review
- access and permission administration
- audit log and security center
- global system integration administration

## What Managers Need That Employees Do Not

- staffing assignment and publish
- lateness and attendance exception review
- team schedule visibility
- operational follow-up queues
- production assignment and reviewer visibility
- department-level customer-service and directory context

## Current Access Gaps To Address

1. `director_of_digital_production` exists as a profile but should be validated as a real phase-1 product role with explicit workflow ownership.
2. Production permissions are currently inherited mostly through schedule access, which is practical but product-wise slightly indirect.
3. Employee-only shell logic is good, but rollout guidance should clearly say who gets Home vs My Work.
4. Read-only leadership viewers need a deliberately documented safe surface list.
5. Customer service and production roles need clearer product-level copy about what they own and what they only observe.

## Recommended Permission Principles For Next Pass

- permissions should be described to the business in role language, not only in technical grant language
- production should have an explicit owner and reviewer permission story
- People Ops review rights should be more clearly grouped
- profitability stays leadership-safe until reliable broader visibility rules are chosen
- directory read should be broad; directory manage should stay narrower

## Assumptions

- leadership and director tiers continue to carry most cross-functional visibility
- field staff remain primarily own-work and assigned-shoot scoped
- client success roles retain stronger department-level schedule and sales access than field staff
