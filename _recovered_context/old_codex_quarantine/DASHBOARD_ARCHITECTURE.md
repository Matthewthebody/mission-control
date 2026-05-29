# Dashboard Architecture

## Purpose

Dashboard is the front door to the app, not a source-of-truth domain.

It answers:

- What matters right now?
- What do I need to do today?
- What is next?
- What is at risk?
- Where should I click next?

Dashboard composes owned modules instead of creating duplicate records:

- Operations owns shoots, schedules, staffing, attendance, travel, and readiness
- Production owns queues, QA, release, and post-shoot workflow
- Directory owns contacts, internal directory, locations, and accounts
- Assets owns gear, kits, custody, and service history
- People Ops owns requests, approvals, training, certifications, and availability
- Growth owns opportunities, proposals, renewals, RFPs, and pipeline
- Business Health owns reports, KPIs, trends, profitability, and executive summaries
- Admin owns roles, permissions, integrations, automations, settings, and audit controls

## Runtime Shape

The dashboard is resolved from three centralized layers:

1. `packages/admin-web/src/components/dashboard/dashboardConfig.ts`
   - widget inventory
   - widget registry metadata
   - role layout definitions
   - quick action definitions

2. `packages/admin-web/src/components/dashboard/dashboardContent.ts`
   - explicit content specs
   - widget titles, subtitles, CTAs, and state copy
   - role-specific content overrides on shared widgets

3. `packages/admin-web/src/components/dashboard/dashboardRuntime.ts`
   - scope resolution
   - preference persistence
   - freshness labels
   - analytics dispatch

`packages/admin-web/src/components/dashboard/RoleDashboardSurface.tsx` is the single renderer that resolves visible widgets, fetches only the needed data families, and renders the role-aware layout.

## Widget Registry Rules

Every widget definition supports the following dashboard-facing metadata:

- `id`
- `title`
- `subtitle`
- `category`
- `sizeHint`
- `presentation`
- `supportedRoles`
- `requiredCapabilities`
- `defaultPriorityRank`
- `aboveFoldEligible`
- `mobilePriority`
- `defaultCollapsed`
- `collapsedPreview`
- `destinationHash`
- `dataDependencies`
- `analyticsId`
- `dataSourceKey`
- `freshnessWindowMinutes`
- `supportedScopes`

Do not add ad hoc widget behavior directly inside page components when it can live in registry metadata.

## Role Layout Rules

Each role layout defines:

- page eyebrow, title, and summary
- ordered sections
- widget order inside each section
- size overrides
- above-the-fold intent
- quick action set
- optional scope selector support

Current supported role layouts:

- `employee`
- `photographer`
- `shoot_lead`
- `production_staff`
- `customer_service_staff`
- `sales_growth_staff`
- `manager`
- `leadership`
- `admin`

## Permissions And Visibility

Dashboard visibility is gated in layers:

1. role and capability gating in `permissions.ts`
2. widget-level visibility from the dashboard registry
3. route and CTA protection from the shared app shell and route guards

Dashboard must never be treated as secure just because a card is hidden. The owning route must still enforce access.

## Scope Switching

Scope switching is intentionally conservative.

Current rule:

- only expose scope selectors on layouts whose backing APIs can honestly honor the scope

At this stage:

- `sales_growth_staff` supports `Me` and `Company`

Scope persistence is stored per user and per role in local storage through `dashboardRuntime.ts`.

Do not add scope selectors to manager, leadership, or admin layouts until the underlying surfaces can actually return scoped data without misleading summaries.

## Preference Persistence

The dashboard currently persists:

- selected scope by role
- collapsed or expanded state for collapsible widgets

Persistence is intentionally lightweight. This pass does not add a drag-and-drop dashboard builder or arbitrary card customization.

## Freshness And Stale States

Where a widget is backed by a local dashboard fetch family, the runtime can show:

- `Updated Xm ago`
- `Stale Xm old`

If a refresh fails but a prior successful payload exists:

- the widget keeps rendering the last successful data
- the card shows a calm stale notice instead of blanking

Do not silently treat stale operational data as fresh.

## Loading, Empty, And Error States

State copy is centralized in `dashboardContent.ts`.

Rules:

- loading states use card-shaped skeletons that resemble final layout
- empty states reassure or redirect
- error states stay plain-English and expose retry
- one widget failure must not blank the whole dashboard

## Analytics

Instrumentation is centralized in `dashboardRuntime.ts`.

Current event names:

- `layout_shown`
- `widget_impression`
- `widget_cta_clicked`
- `quick_action_clicked`
- `widget_error`
- `widget_empty`
- `scope_changed`
- `refresh_requested`
- `widget_toggle`

Analytics dispatches through:

- `window` custom event: `pmc:dashboard-analytics`
- `window.dataLayer` event: `pmc.dashboard`

Use widget `analyticsId` from the registry for consistency.

## Adding A New Widget

1. Add or update the widget definition in `dashboardConfig.ts`
2. Add the content spec in `dashboardContent.ts`
3. Add the render path in `RoleDashboardSurface.tsx`
4. Reuse an owned module data source whenever possible
5. Add the widget to the appropriate role layout
6. Add tests for:
   - visibility
   - empty/loading/error behavior
   - CTA routing if it is role-critical

Do not create dashboard-only records or duplicate edit flows.

## Adding A New Role Layout

1. Add or map the business role in `permissions.ts`
2. Create the role layout in `dashboardConfig.ts`
3. Reuse existing widgets before creating new ones
4. Verify quick actions and owned routes are permission-safe
5. Add integration coverage for the role in dashboard tests

## Deferred Gaps

These are intentionally deferred until the backing data is ready:

- scoped manager and leadership dashboards beyond company-level shared surfaces
- dedicated training reminder and certification reminder widgets
- recently completed production jobs widget
- RFP-specific deadline widget
- recent account activity widget
- recent config changes widget
- standalone location notes widget

These should land by extending owned data sources first, then lifting them into the dashboard.
