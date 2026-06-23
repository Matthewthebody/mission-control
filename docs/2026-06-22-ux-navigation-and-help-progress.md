# Global UX Correction — Navigation Continuity & Progressive Help (progress)

Bounded-slice progress for the two-part UX correction: (1) no navigation traps, (2) progressive help.

---

## Slice 1 — Standardize the on-demand Help control + start the rollout

**Commit:** (this commit) `fix: standardize on-demand help control and begin progressive-help rollout`

### What changed

- **Standardized on the single existing `HelpTooltip`** (`packages/admin-web/src/components/HelpTooltip.tsx`)
  rather than adding a second Help implementation, and **hardened it to the full a11y spec**:
  - hidden by default; opens by **click or keyboard** (native `<button>`; Enter/Space activate it),
    with a brief hover preview that is never the only way in;
  - **Escape closes it and keeps focus on the trigger** (previously it `blur()`ed, losing focus to the
    body — now focus is explicitly returned to the `?` button);
  - clicking outside closes it;
  - the description stays in the DOM and is linked via `aria-describedby` for screen readers;
  - **long content scrolls** inside the popover (`max-height` + `overflow-y:auto`) so it never overflows
    the page or a tablet layout;
  - distinct `useId()` per instance, so multiple Help controls never cross-wire.
- **Proof wiring:** the Production operating view (`#production/operations`) had a permanently-visible
  muted description; it is now a `HelpTooltip` labelled **"Help: Production queue"** next to the
  heading — the explanatory copy opens on demand instead of occupying vertical space.

### Description audit (this slice)

| Surface | Previous always-visible text | New Help-control label | Disposition |
|---|---|---|---|
| Production queue (`ProductionOperationsView`) | "Dense operating queue over canonical production work. Counts are server-computed (displayed = filtered)." | `Help: Production queue` | Moved into on-demand Help (expanded slightly with the chip/row hint). Operational truth (counts, empty/error states, Unowned pills, risk) stays visible. |

### Tests

- `helpTooltip.test.tsx` **8/8** — hidden-by-default + aria-describedby; click reveals; keyboard-operable
  focusable button; Escape closes **and returns focus to the trigger**; hover preview; click-outside
  closes; multiple controls independent (distinct ids); long content scrolls.
- `productionOperationsView.test.tsx` **5/5** still green (description swap didn't disturb behavior).
- tsc + vite build clean.

### What is intentionally NOT removed (operational truth stays visible)

Field/button labels, active warnings, validation errors, unavailable-integration explanations
(e.g. "Weather provider not connected"), the exact Needs-Attention reason, required next actions,
and safety-critical instructions remain permanently visible per the spec.

---

## Navigation continuity — audit findings (for the next slices)

A return-context mechanism **already exists** and should be the standard, not re-invented:

- `navigation.ts` route definitions carry an explicit `returnHash` (e.g. `#schools`, `#sports/jobs`);
  `app.tsx` reads `return_hash` from the URL and a record-detail's "Back" uses it.
- `DirectoryWorkspace.tsx` stores `sessionStorage["directory:return-hash"]` before opening a full record;
  `DirectoryRecordDetailPage` reads it for context-preserving Back, falling back to the list mode.

**Plan (next slices):** generalize this into one shared `useReturnContext`/`BackLink` helper, audit the
14 primary surfaces (Dashboard, Job Tracker, Job detail, Urgent Window, Production, Staffing, Capacity,
Team Schedule, Directory + record details, Schools Leadership, CSR, My Work, Diagnostics), and fix:
missing Back, wrong-target Back, intercepted browser Back, lost filter/search/scroll state, stale return
paths, and any `#home` hard-redirects caused by a missing permission-route registration. Add the 10
navigation tests (Dashboard→Job Tracker→Back, browser Back, Job-detail→filtered list, refresh-safe
return context, Back/Forward preserves filters+pagination, Urgent-Window source preserves filter,
Directory restores mode/search/filter, Staffing/Capacity preserve date/filter, unauthorized→Denied not
trapped, stale-context safe fallback).

## Diagnostics Center checks (planned)

- **Navigation-trap check:** flag pages with no parent/Back action, broken return context, unexpected
  Home redirects, or Back/Forward state loss.
- **Persistent-description check:** flag primary operating pages with oversized always-visible
  explanatory blocks that should use the shared Help control.

**Exact next slice:** roll `HelpTooltip` across the remaining primary surfaces (Jobs/Intake/Staffing/
Capacity/Directory/Schools Leadership/CSR/Urgent Window/Team Schedule), recording each in the
description-audit table; then the shared Back/return-context helper + the navigation tests.
