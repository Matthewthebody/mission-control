# Photographer Mission Control Home Pulse Next-Phase Plan

## Objective
Finish the transition from a refactored preview-first home surface to a fully live operational command center backed by production data sources.

## Current Foundation
The current pass established the right structure:

- shared home and TV surface in `packages/admin-web/src/components/HomePulseSurface.tsx`
- server-driven payload in `packages/api/src/services/homeDashboard.ts`
- `GET /api/dashboard/home` as the home source of truth
- public-safe TV mode with server-side field restrictions
- feature flags for labor visibility and TV name display

That foundation is solid enough to build on without replacing the interaction model again.

## Priority 1: Live Business Pulse Inputs
### Goal
Replace derived or adapter-backed counts with live operational feeds where available.

### Work
- connect `ID Cards to Print` to the real Monday production queue source
- define the exact Monday board or export contract for queue counts and thresholds
- preserve the current tile and drawer contract so the UI does not need to change again

### Why
This is the highest-value credibility upgrade for the Business Pulse ribbon.

## Priority 2: Live Weather And Travel Watch
### Goal
Turn the current shell into a real risk signal.

### Work
- connect a weather service to scheduled shoot locations and time windows
- connect travel ETA logic to scheduled locations and office origin assumptions
- map the results into the existing `weather_travel_watch` payload
- keep severe changes capable of surfacing through the critical banner

### Why
The widget structure is already right. The next step is improving signal quality.

## Priority 3: TV Mode Controls
### Goal
Make the status board easier to operate in shared office settings.

### Work
- add admin controls for rotation timing
- add page-order configuration
- add a simple on-screen freeze control for supervised viewing
- keep `TV_MODE_SHOW_EMPLOYEE_NAMES` off by default

### Why
The public-safe board is useful now, but office operations will want more control over how it runs.

## Priority 4: Drill-Down Data Depth
### Goal
Increase operational usefulness without making the home surface heavier.

### Work
- deepen the location history drawer behind Places That Need More Love
- refine shoot drill-downs from Today's Shoots with stronger historical context hooks
- keep support drill-down safe and summary-oriented on home while linking to the deeper customer service workspace

### Why
The preview-first pattern is now in place. The next wins are better detail depth, not more front-page density.

## Delivery Order
### Next 2 weeks
- Monday queue contract
- live weather provider contract
- TV controls design and API shape

### Next 30 days
- Monday queue integration
- weather and travel integration
- TV admin controls
- deeper location and shoot history drawer content

## Risks
- Monday queue definitions may still need business clarification before a live contract is final
- weather and ETA quality depends on stable location data
- TV-mode enhancements must preserve public-safe defaults

## Recommendation
Do not redesign the home surface again in the next pass. Keep the current preview-first layout and invest in better live inputs, safer TV controls, and richer drill-down detail. The product structure is now in the right place.
