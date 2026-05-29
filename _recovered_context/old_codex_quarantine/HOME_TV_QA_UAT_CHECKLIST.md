# Photographer Mission Control Home Screen And TV Mode QA UAT Checklist

## Scope
This checklist covers:

- Home dashboard
- TV / status-board mode
- widget drill-down behavior
- public-safe field restrictions
- refresh and empty-state behavior

## Setup
- Log in as leadership
- Confirm seeded demo data is present
- Confirm `HOME_LABOR_WIDGET_ENABLED` is set as expected for the test
- Confirm `TV_MODE_SHOW_EMPLOYEE_NAMES` is set to `false` for public-safe validation

## Home Screen Layout
- [ ] Business Pulse appears first and full width
- [ ] Today's Shoots appears as the primary hero widget
- [ ] Weather and Travel Watch appears beside or below Today's Shoots based on width
- [ ] Customer Service Pulse appears before Places That Need More Love on desktop third-row layout
- [ ] Labor Snapshot Today appears last and lower emphasis when enabled
- [ ] The surface reads as condensed and scannable, not like a workflow inbox

## Business Pulse
- [ ] Shows Shoots This Week
- [ ] Shows Subjects This Week
- [ ] Shows ID Cards to Print
- [ ] Shows Jobs Needing Attention
- [ ] Shows zeros cleanly without blank states
- [ ] Clicking a tile opens the right-side detail drawer

## Today's Shoots
- [ ] Shows total shoots today
- [ ] Shows coming up, in progress, and needs-attention counts
- [ ] Shows location and time clearly
- [ ] Shows big-shoot badges when applicable
- [ ] Does not show attendance exceptions on the summary rows
- [ ] Clicking a shoot opens the briefing drawer

## Weather And Travel Watch
- [ ] Shows a calm empty state when no issues exist
- [ ] Shows readable risk language when issues exist
- [ ] Clicking opens impacted-shoot detail in the drawer
- [ ] Critical banner appears when severe weather or travel risk exists

## Customer Service Pulse
- [ ] Shows only safe summary counts and health language
- [ ] Does not expose customer names or ticket contents on the home screen
- [ ] Drawer links to deeper customer service only for users with access

## Places That Need More Love
- [ ] Uses warm, supportive wording
- [ ] Shows location name plus a short readiness or friction cue
- [ ] Clicking opens historical context in the drawer
- [ ] Setup photos and recent evaluations appear in drill-down when data exists

## Labor Snapshot Today
- [ ] Only renders when enabled and permitted
- [ ] Shows no payroll, wage, or compensation detail
- [ ] Uses public-safe rolled-up language only
- [ ] Clicking opens rollup detail, not private personnel framing

## Drawer Behavior
- [ ] Right-side drawer opens without leaving the page
- [ ] Drawer updates correctly when switching between widgets
- [ ] Drawer can be closed cleanly
- [ ] Shoot detail includes deeper briefing content
- [ ] Location detail includes highlights, setup photos, and recent evaluations

## TV Mode
- [ ] Business Pulse is always visible
- [ ] Today's Shoots is grouped by time first
- [ ] Weather and Travel uses readable banners or pills, not icon-only alerts
- [ ] Customer Service Pulse stays summary-only
- [ ] Places That Need More Love remains softened and public-safe
- [ ] Employee names are hidden by default
- [ ] Attendance exceptions, staffing gaps, approvals, and payroll data are not shown
- [ ] Rotation advances across pages
- [ ] Rotation can be frozen and resumed manually

## Refresh And States
- [ ] Manual refresh works on home and status-board surfaces
- [ ] Last refresh time is visible
- [ ] Loading state is readable and intentional
- [ ] Empty states use warm, healthy language
- [ ] Error state is visible and does not break layout

## Permission And Safety Checks
- [ ] Leadership can access the home dashboard
- [ ] TV mode payload returns `public_safe: true`
- [ ] Non-leadership users without `dashboard.read` are blocked from the home route
- [ ] Labor widget is absent in TV mode

## Sign-Off Questions
- [ ] Can leadership understand the day in under 10 seconds?
- [ ] Is the home screen safe to leave visible in the office?
- [ ] Does the surface feel operational and positive rather than punitive?
- [ ] Is all important detail still reachable through drill-down?
