# Company Command — card source audit (Phase 1 closure)

**Date:** 2026-06-18 · Commit context: Phase 1 truth-and-consistency closure.

Every Company Command top-row card, its count source, honest classification, destination, and verification. A demo or unavailable source never displays an unlabeled operational count; only the **live** card shows a real number, and that number equals the records its destination renders.

| Card | Count source | Classification | Destination | Verified |
|---|---|---|---|---|
| **On Fire** | Live unresolved (open) count from `GET /api/exceptions` (urgent-watch) via `countUnresolvedUrgentRows` | **live** | `#urgent-window?status=open` | Count **= records**: card showed 59, destination rendered 59 (browser smoke). Loading shows "…", error/no-session shows "—" — never a fabricated number. |
| Shoots Today | Demo literal `18` | **sample** (visible "Sample" badge) | `#schedule` | Labeled sample; destination is the live schedule. |
| Staffing Risk | Demo literal `3` | **sample** (visible "Sample" badge) | `#operations/staffing?area=staffing` | Labeled sample; destination is the live staffing board. |
| Late / Not Clocked In | Demo literal `2` | **sample** (visible "Sample" badge) | `#employees/attendance` | Labeled sample; destination is the live Attendance page. |
| Jobs Behind | Demo literal `5` | **sample** (visible "Sample" badge) | `#project-tracking` | Labeled sample; destination is the live Production Tracker. |
| **Weather Watch** | None (no provider) | **unavailable** (disabled, no count) | — | Disabled "Not connected" card; no number, no enabled CTA. |
| Production Load | Demo literal `5 behind` | **sample** (visible "Sample" badge) | `#production` | Labeled sample; destination is the live Production hub. |
| **Client Issues** | None (no canonical client-case feed) | **unavailable** (disabled, no count) | — | Disabled "Not connected" card; the previous fabricated `2` count is removed so it never implies specific unresolved cases exist. |

## Classification rules
- **live** — a real count from a canonical backend, shown as a true number; equals the records its destination filter produces. While loading it shows "…"; on API failure or no session it shows "—". It never falls back to a fabricated number.
- **sample** — illustrative demo data, always rendered with a visible **Sample** badge. The card still navigates to its real destination; the number is explicitly not a live metric.
- **unavailable** — no connected source. Rendered as a disabled "Not connected" card with the reason and **no operational count and no enabled CTA**.

## Follow-ups (documented, out of scope for this closure slice)
- Making Staffing Risk / Late / Jobs Behind / Production Load **live** would require wiring each to its canonical source (attendance, staffing, production) — a later phase, not this closure.
- Client Success and Weather remain unavailable until a canonical case feed / location-linked forecast source exists.
- Urgent Window destination exactness for Production records and Microsoft calendar-sync (route-only) remains a tracked follow-up.
